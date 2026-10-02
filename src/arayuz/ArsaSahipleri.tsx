import { useEffect, useState } from 'react';
import { arsaPaylari, konutMu, type PayToplami, type SahipPayi } from '../hesap/arsaPayi';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { katKarsiligiKaydet, tahsisEt, tahsisKaldir, type ArsaSahibiDurumu } from '../servisler/arsaSahibi';
import { carileriListele } from '../servisler/cari';
import type { BagimsizBolum, Cari, PayYontemi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, useGerekceliDegisiklik } from './bilesenler';
import type { KrokiRenkleri } from './Kroki';

// Kat karşılığı: paylaşım, arsa sahipleri, beklenen pay; krokide sahiplik renkleri ve tahsis.

export const PAY_YONTEMI_ADI: Record<PayYontemi, string> = {
  brut: 'Brüt m²',
  net: 'Net m²',
  adet: 'Daire/dükkan sayısı',
};

const yuzde = (n: number) => `%${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;
const m2 = (n: number) => `${sayiYaz(Math.round(n * 10) / 10)} m²`;
const RENK_SAYISI = 6;

/** Krokide sahiplik görünümü: müteahhit gri, her arsa sahibi ayrı renk. */
export function sahiplikRenkleri(durum: ArsaSahibiDurumu | null): KrokiRenkleri {
  const sira = new Map(durum?.sahipler.map((s, i) => [s.cari.id, i]) ?? []);
  const sahipAdi = (b: BagimsizBolum) => durum?.sahipler.find((s) => s.cari.id === durum.tahsis.get(b.id))?.cari.ad;
  return {
    sinif: (b) => {
      const i = sira.get(durum?.tahsis.get(b.id) ?? '');
      return i === undefined ? 'sahip-muteahhit' : `sahip-${i % RENK_SAYISI}`;
    },
    durum: (b) => sahipAdi(b) ?? 'Müteahhit',
    lejant: (
      <ul className="lejant" aria-label="Renklerin anlamı">
        <li>
          <span className="cip sahip-muteahhit" aria-hidden="true" /> Müteahhit
        </li>
        {durum?.sahipler.map((s, i) => (
          <li key={s.cari.id}>
            <span className={`cip sahip-${i % RENK_SAYISI}`} aria-hidden="true" /> {s.cari.ad}
          </li>
        ))}
      </ul>
    ),
  };
}

// ─── Seçim çubuğunda: arsa sahibine ver ───────────────────────────

export function TahsisIslemleri(props: {
  projeId: string;
  durum: ArsaSahibiDurumu | null;
  secili: BagimsizBolum[];
  bitir: (mesaj: string) => Promise<void>;
}) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [acik, setAcik] = useState(false);
  const { durum, secili } = props;
  const ids = secili.map((b) => b.id);
  const tahsisli = secili.filter((b) => durum?.tahsis.has(b.id)).length;

  if (!acik) {
    return (
      <button type="button" className="ikincil" onClick={() => setAcik(true)}>
        Arsa sahibine ver
      </button>
    );
  }
  return (
    <div className="tahsis-secimi">
      {!durum || durum.sahipler.length === 0 ? (
        <p className="soluk">Önce “Arsa sahipleri” kartında paylaşımı ve arsa sahiplerini girin.</p>
      ) : (
        <div className="dugmeler">
          {durum.sahipler.map((s) => (
            <button
              key={s.cari.id}
              type="button"
              onClick={() =>
                void degistir(`${secili.length} bölüm ${s.cari.ad} adına tahsis ediliyor`, async (g) => {
                  const n = await tahsisEt(depo, servis, props.projeId, ids, s.cari.id, g);
                  await props.bitir(`${n} bölüm ${s.cari.ad} adına tahsis edildi.`);
                })
              }
            >
              {s.cari.ad}
            </button>
          ))}
          {tahsisli > 0 && (
            <button
              type="button"
              className="ikincil"
              onClick={() =>
                void degistir(`${tahsisli} bölümün tahsisi kaldırılıyor`, async (g) => {
                  const n = await tahsisKaldir(depo, servis, props.projeId, ids, g);
                  await props.bitir(`${n} bölüm müteahhide geri alındı.`);
                })
              }
            >
              Müteahhide geri al
            </button>
          )}
          <button type="button" className="baglanti-dugmesi" onClick={() => setAcik(false)}>
            Vazgeç
          </button>
        </div>
      )}
      {kutu}
      {hata && <Hatalar hatalar={[hata]} />}
    </div>
  );
}

// ─── Arsa sahipleri kartı ─────────────────────────────────────────

interface FormSatiri {
  cariId: string;
  hisse: string;
}

interface Form {
  oran: string;
  yontem: PayYontemi;
  satirlar: FormSatiri[];
}

export function ArsaSahipleriKarti(props: {
  projeId: string;
  bolumler: BagimsizBolum[];
  durum: ArsaSahibiDurumu | null;
  onDegisti: () => Promise<void>;
}) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const { durum } = props;
  const [form, setForm] = useState<Form | null>(null);
  const [adaylar, setAdaylar] = useState<Cari[]>([]);
  const [hatalar, setHatalar] = useState<string[]>([]);

  const formAcik = form !== null;
  useEffect(() => {
    if (!formAcik) return;
    void carileriListele(depo, oturum.firmaId).then((l) => setAdaylar(l.map((c) => c.cari).filter((c) => c.roller.includes('arsa_sahibi'))));
  }, [formAcik, depo, oturum.firmaId]);

  const duzenle = () => {
    setHatalar([]);
    setForm({
      oran: durum ? sayiYaz(durum.sozlesme.arsaSahibiOrani) : '',
      yontem: durum?.sozlesme.payYontemi ?? 'brut',
      satirlar: durum?.sahipler.map((s) => ({ cariId: s.cari.id, hisse: sayiYaz(s.hisse) })) ?? [{ cariId: '', hisse: '100' }],
    });
  };

  function kaydet(f: Form) {
    const h: string[] = [];
    const oran = sayiOku(f.oran.replace('%', ''));
    if (oran === null) h.push('Arsa sahiplerinin payını sayı olarak yazın, örn. 45.');
    const satirlar = f.satirlar.map((s) => ({ cariId: s.cariId, hisse: sayiOku(s.hisse.replace('%', '')) }));
    if (satirlar.some((s) => s.hisse === null)) h.push('Hisseleri sayı olarak yazın, örn. 50 ya da 33,33.');
    setHatalar(h);
    if (h.length > 0) return;
    void degistir('Kat karşılığı paylaşımı değişiyor', async (g) => {
      await katKarsiligiKaydet(
        depo,
        servis,
        props.projeId,
        { arsaSahibiOrani: oran!, payYontemi: f.yontem, arsaSahipleri: satirlar.map((s) => ({ cariId: s.cariId, hisse: s.hisse! })) },
        g,
      );
      setForm(null);
      await props.onDegisti();
    });
  }

  const satirYaz = (i: number, s: Partial<FormSatiri>) =>
    setForm((f) => f && { ...f, satirlar: f.satirlar.map((x, j) => (j === i ? { ...x, ...s } : x)) });

  const paylar =
    durum &&
    arsaPaylari(
      props.bolumler,
      durum.tahsis,
      durum.sozlesme.arsaSahibiOrani,
      durum.sahipler.map((s) => ({ cariId: s.cari.id, hisse: s.hisse })),
      durum.sozlesme.payYontemi,
    );
  const yontem = durum?.sozlesme.payYontemi ?? 'brut';
  const formOrani = form && sayiOku(form.oran.replace('%', ''));
  // Projede dükkan/işyeri yoksa "+ 0 dükkan" yazılmaz.
  const dukkanVar = props.bolumler.some((b) => !konutMu(b));
  const sayilar = (daire: string, dukkan: string) => (dukkanVar ? `${daire} daire + ${dukkan} dükkan` : `${daire} daire`);
  const ondalik = (n: number) => sayiYaz(Math.round(n * 10) / 10);
  const beklenenYaz = (p: SahipPayi) =>
    yontem === 'adet' ? `≈ ${sayilar(ondalik(p.beklenenDaire), ondalik(p.beklenenDukkan))}` : `≈ ${m2(p.beklenen)}`;
  const tahsisYaz = (t: PayToplami) =>
    `${sayilar(String(t.daire), String(t.dukkan))}${yontem === 'adet' ? '' : `, ${m2(yontem === 'net' ? t.netM2 : t.brutM2)}`}`;

  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Arsa sahipleri</h2>
        {!form && (
          <button type="button" className="ikincil" onClick={duzenle}>
            {durum ? 'Düzenle' : 'Gir'}
          </button>
        )}
      </div>
      {kutu}
      {hata && <Hatalar hatalar={[hata]} />}

      {!form && !durum && <p className="soluk">Paylaşım oranı ve arsa sahipleri henüz girilmedi.</p>}

      {!form && durum && paylar && (
        <>
          <p className="soluk">
            Paylaşım: arsa sahipleri {yuzde(durum.sozlesme.arsaSahibiOrani)} · müteahhit {yuzde(durum.sozlesme.muteahhitOrani)} · beklenen pay{' '}
            {PAY_YONTEMI_ADI[yontem].toLocaleLowerCase('tr-TR')} ile
          </p>
          <ul className="liste arsa-paylari">
            {paylar.sahipler.map((p, i) => {
              const s = durum.sahipler.find((x) => x.cari.id === p.cariId)!;
              return (
                <li key={p.cariId}>
                  <span>
                    <span className={`cip sahip-${i % RENK_SAYISI}`} aria-hidden="true" /> <a href={`#/cariler/${p.cariId}`}>{s.cari.ad}</a>{' '}
                    <span className="soluk">{yuzde(p.hisse)} hisse</span>
                  </span>
                  <span className="pay-degerleri">
                    <span>Tahsis: {tahsisYaz(p)}</span>
                    <span className="soluk">Beklenen: {beklenenYaz(p)}</span>
                  </span>
                </li>
              );
            })}
            <li>
              <span>
                <span className="cip sahip-muteahhit" aria-hidden="true" /> Müteahhit
              </span>
              <span className="pay-degerleri">
                <span>Kalan: {tahsisYaz(paylar.muteahhit)}</span>
              </span>
            </li>
          </ul>
          {paylar.eksikAlan > 0 && (
            <p className="mesaj mesaj-uyari">
              {paylar.eksikAlan} bölümün {PAY_YONTEMI_ADI[yontem].toLocaleLowerCase('tr-TR')} bilgisi girilmemiş; beklenen pay eksik hesaplanır.
            </p>
          )}
          <p className="soluk kucuk">Daire vermek için krokide “Seç” ile bölümleri seçip “Arsa sahibine ver”e dokunun.</p>
        </>
      )}

      {form && (
        <div className="kalem-formu">
          <div className="iki-sutun">
            <Alan etiket="Arsa sahiplerinin payı (%)" aciklama={`Müteahhit: ${formOrani === null ? '—' : yuzde(100 - formOrani)}`}>
              <input value={form.oran} inputMode="decimal" placeholder="45" onChange={(e) => setForm({ ...form, oran: e.target.value })} />
            </Alan>
            <Alan etiket="Beklenen pay neye göre">
              <select value={form.yontem} onChange={(e) => setForm({ ...form, yontem: e.target.value as PayYontemi })}>
                {Object.entries(PAY_YONTEMI_ADI).map(([k, ad]) => (
                  <option key={k} value={k}>
                    {ad}
                  </option>
                ))}
              </select>
            </Alan>
          </div>
          <h3>Arsa sahipleri ve hisseleri</h3>
          {adaylar.length === 0 && (
            <p className="soluk">
              Listede “Arsa sahibi” rolündeki cariler çıkar. <a href="#/cariler/yeni/arsa_sahibi">Yeni arsa sahibi kartı aç</a>
            </p>
          )}
          {form.satirlar.map((s, i) => (
            <div key={i} className="arsa-sahibi-satiri">
              <select aria-label={`${i + 1}. arsa sahibi`} value={s.cariId} onChange={(e) => satirYaz(i, { cariId: e.target.value })}>
                <option value="">Seçin</option>
                {adaylar
                  .filter((c) => c.id === s.cariId || !form.satirlar.some((x) => x.cariId === c.id))
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.ad}
                    </option>
                  ))}
              </select>
              <input aria-label={`${i + 1}. arsa sahibinin hissesi (%)`} value={s.hisse} inputMode="decimal" onChange={(e) => satirYaz(i, { hisse: e.target.value })} />
              <button
                type="button"
                className="ikincil"
                aria-label={`${i + 1}. arsa sahibini çıkar`}
                onClick={() => setForm({ ...form, satirlar: form.satirlar.filter((_, j) => j !== i) })}
              >
                ✕
              </button>
            </div>
          ))}
          <p className="soluk kucuk">
            Hisseler toplamı: {yuzde(form.satirlar.reduce((t, s) => t + (sayiOku(s.hisse.replace('%', '')) ?? 0), 0))} (%100 olmalı)
          </p>
          <button type="button" className="baglanti-dugmesi" onClick={() => setForm({ ...form, satirlar: [...form.satirlar, { cariId: '', hisse: '' }] })}>
            + Arsa sahibi ekle
          </button>
          <Hatalar hatalar={hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={() => kaydet(form)}>
              Kaydet
            </button>
            <button type="button" className="ikincil" onClick={() => setForm(null)}>
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
