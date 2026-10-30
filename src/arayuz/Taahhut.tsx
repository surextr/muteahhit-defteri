import { useCallback, useEffect, useState } from 'react';
import { esitTaksitler, type PlanDurumu, type SozlesmeTaahhudu } from '../hesap/taahhut';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { projeGetir } from '../servisler/proje';
import { odemePlaniKaydet, projeTaahhutleri, sozlesmeOdemePlani, sozlesmeTaahhuduGetir, type TaahhutSatiri } from '../servisler/taahhut';
import type { Proje, UstaSozlesmesi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Hatalar, useGerekceliDegisiklik } from './bilesenler';
import { TutarGirdisi } from './Girdiler';

// Tahmini ödeme planı (sözleşme ekranında) ve projenin taahhüt tablosu: sözleşmelerle bağlanan, hakedişi çıkan,
// ödenen, kalan borç, bekleyen teminat, kalan iş; gecikmiş ve yaklaşan plan ödemeleri.

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');

const DURUM_ADI: Record<PlanDurumu, string> = {
  odendi: 'Ödendi',
  kismen: 'Kısmen ödendi',
  gecikti: 'Gecikti',
  yaklasan: '30 gün içinde',
  ileride: 'İleride',
};

function DurumRozeti({ d }: { d: PlanDurumu }) {
  const sinif = d === 'odendi' ? 'rozet-tamam' : d === 'gecikti' ? 'rozet-gecikti' : 'rozet-taslak';
  return <span className={sinif}>{DURUM_ADI[d]}</span>;
}

// ─── Sözleşme: tahmini ödeme planı ─────────────────────────────────

interface PlanFormu {
  id?: string;
  vadeTarihi: string;
  tutar: string;
  aciklama: string;
}

export function OdemePlaniKarti({ sozlesme, onKaydedilmemis }: { sozlesme: UstaSozlesmesi; onKaydedilmemis?: (var_: boolean) => void }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [satirlar, setSatirlar] = useState<PlanFormu[] | null>(null);
  const [kayitli, setKayitli] = useState('');
  const [taahhut, setTaahhut] = useState<SozlesmeTaahhudu | null>(null);
  const [taksit, setTaksit] = useState('');
  const [mesaj, setMesaj] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    const [plan, t] = await Promise.all([sozlesmeOdemePlani(depo, oturum.firmaId, sozlesme.id), sozlesmeTaahhuduGetir(depo, oturum.firmaId, sozlesme, yerelGun(new Date()))]);
    const f = plan.map((p) => ({ id: p.id, vadeTarihi: p.vadeTarihi, tutar: tutarMetni(p.tutar), aciklama: p.aciklama }));
    setSatirlar(f);
    setKayitli(JSON.stringify(f));
    setTaahhut(t);
  }, [depo, oturum.firmaId, sozlesme]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  if (!satirlar) return null;
  const okunan = satirlar.map((s) => tlOku(s.tutar));
  const okunamayan = okunan.some((x) => x === null);
  const planToplami = okunan.reduce<number>((t, x) => t + (x ?? 0), 0);
  const degisti = JSON.stringify(satirlar) !== kayitli;
  // Kaydedilmemiş plan varken başka işlem (imza) sayfayı yeniden kurup planı silmesin diye üst ekrana bildirilir.
  useEffect(() => onKaydedilmemis?.(satirlar !== null && degisti), [satirlar, degisti, onKaydedilmemis]);
  const durum = new Map((taahhut?.plan ?? []).map((p) => [p.plan.id, p]));
  const yaz = (i: number, d: Partial<PlanFormu>) => (setMesaj(null), setSatirlar(satirlar.map((s, j) => (j === i ? { ...s, ...d } : s))));

  function bol() {
    const adet = Number(taksit);
    const toplam = sozlesme.toplamTutar;
    if (!Number.isInteger(adet) || adet < 1 || adet > 60 || toplam <= 0) return;
    const ilk = sozlesme.baslamaTarihi ?? yerelGun(new Date());
    setSatirlar(esitTaksitler(toplam, adet, ilk).map((x, i) => ({ vadeTarihi: x.vadeTarihi, tutar: tutarMetni(x.tutar), aciklama: `${i + 1}. taksit` })));
    setMesaj(null);
  }

  async function kaydet() {
    if (okunamayan) return;
    await degistir('Ödeme planı değişikliği', async (gerekce) => {
      await odemePlaniKaydet(
        depo,
        servis,
        sozlesme.id,
        satirlar!.map((s, i) => ({ id: s.id, vadeTarihi: s.vadeTarihi, tutar: okunan[i]!, aciklama: s.aciklama })),
        gerekce,
      );
      await yukle();
      setMesaj('Kaydedildi.');
    });
  }

  return (
    <section className="kart">
      <h2>Tahmini ödeme planı</h2>
      <p className="soluk kucuk">Ne zaman ne kadar ödemeyi düşündüğünüz. Borç değildir; ödemeler en eski vadeden kapanmış sayılır.</p>
      {satirlar.map((s, i) => {
        const d = s.id ? durum.get(s.id) : undefined;
        return (
          <div key={s.id ?? `y${i}`} className="plan-satiri">
            <input type="date" value={s.vadeTarihi} aria-label={`${i + 1}. vade`} onChange={(e) => yaz(i, { vadeTarihi: e.target.value })} />
            <TutarGirdisi value={s.tutar} placeholder="Tutar" onChange={(v) => yaz(i, { tutar: v })} />
            <button type="button" className="ikincil" aria-label={`${i + 1}. satırı çıkar`} onClick={() => setSatirlar(satirlar.filter((_, j) => j !== i))}>
              ✕
            </button>
            <input className="plan-aciklama" value={s.aciklama} placeholder="Açıklama (isteğe bağlı)" aria-label={`${i + 1}. satırın açıklaması`} onChange={(e) => yaz(i, { aciklama: e.target.value })} />
            {d && !degisti && (
              <span className="plan-durum">
                <DurumRozeti d={d.durum} />
                {d.durum !== 'odendi' && d.kalan !== d.plan.tutar && <span className="soluk kucuk"> kalan {tlYaz(d.kalan)}</span>}
              </span>
            )}
          </div>
        );
      })}
      <div className="dugmeler">
        <button
          type="button"
          className="baglanti-dugmesi"
          onClick={() => setSatirlar([...satirlar, { vadeTarihi: satirlar.at(-1)?.vadeTarihi ?? sozlesme.baslamaTarihi ?? yerelGun(new Date()), tutar: '', aciklama: '' }])}
        >
          + Vade ekle
        </button>
      </div>
      {sozlesme.toplamTutar > 0 && (
        <div className="satir-ici">
          <input className="kisa" inputMode="numeric" value={taksit} placeholder="Taksit" aria-label="Taksit sayısı" onChange={(e) => setTaksit(e.target.value)} />
          <button type="button" className="ikincil" disabled={!Number(taksit)} onClick={bol}>
            Sözleşme tutarını eşit böl
          </button>
        </div>
      )}
      <p className="ara-toplam">
        <span>Plan toplamı{sozlesme.toplamTutar > 0 ? ` · sözleşme ${tlYaz(sozlesme.toplamTutar)}` : ''}</span>
        <span>{tlYaz(planToplami)}</span>
      </p>
      {kutu}
      {okunamayan && <Hatalar hatalar={['Okunamayan tutar var (örn. 25.000 ya da 1.250,50).']} />}
      {hata && <Hatalar hatalar={[hata]} />}
      {mesaj && !degisti && <p className="mesaj mesaj-basari">{mesaj}</p>}
      {degisti && (
        <div className="dugmeler">
          <button type="button" disabled={okunamayan} onClick={() => void kaydet()}>
            Planı kaydet
          </button>
          <button type="button" className="ikincil" onClick={() => setSatirlar(JSON.parse(kayitli) as PlanFormu[])}>
            Vazgeç
          </button>
        </div>
      )}
    </section>
  );
}

// ─── Proje: taahhüt tablosu ────────────────────────────────────────

function Tutar({ etiket, tutar, sinif }: { etiket: string; tutar: number; sinif?: string }) {
  return (
    <p className={`ozet-tutar ${sinif ?? ''}`}>
      <span>{etiket}</span>
      <span>{tlYaz(tutar)}</span>
    </p>
  );
}

export function TaahhutEkrani({ projeId }: { projeId: string }) {
  const { depo, oturum } = useUygulama();
  const [proje, setProje] = useState<Proje | null | undefined>(undefined);
  const [veri, setVeri] = useState<Awaited<ReturnType<typeof projeTaahhutleri>> | null>(null);
  const bugun = yerelGun(new Date());

  useEffect(() => {
    void (async () => {
      const [p, v] = await Promise.all([projeGetir(depo, oturum.firmaId, projeId), projeTaahhutleri(depo, oturum.firmaId, projeId, bugun)]);
      setProje(p);
      setVeri(v);
    })();
  }, [depo, oturum.firmaId, projeId, bugun]);

  if (proje === undefined || !veri) return <p>Yükleniyor…</p>;
  if (proje === null) return <p className="hata">Proje bulunamadı.</p>;
  const { toplam } = veri;
  // Gecikmiş ve 30 gün içindeki plan ödemeleri, bütün sözleşmelerden, vade sırasıyla.
  const bekleyen = veri.satirlar
    .flatMap((x: TaahhutSatiri) => x.taahhut.plan.filter((p) => p.durum === 'gecikti' || p.durum === 'yaklasan' || p.durum === 'kismen').map((p) => ({ ...p, satir: x })))
    .sort((a, b) => a.plan.vadeTarihi.localeCompare(b.plan.vadeTarihi));

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <h1>Taahhüt tablosu</h1>
      <p className="soluk">İmzalı usta sözleşmeleri: bağlanan tutar, hakedişi çıkan, ödenen ve kalan.</p>
      {veri.satirlar.length === 0 ? (
        <section className="kart">
          <p className="soluk">İmzalı sözleşme yok.{veri.taslakSayisi > 0 && ` ${veri.taslakSayisi} taslak sözleşme imzalanınca burada görünür.`}</p>
        </section>
      ) : (
        <>
          <section className="kart">
            <h2>Proje toplamı</h2>
            <Tutar etiket={`Sözleşmeler${toplam.eksikMiktar ? ' (miktarı yazılı kalemler)' : ''}`} tutar={toplam.sozlesmeTutari} />
            {toplam.eksikMiktar && <p className="soluk kucuk">Miktarı boş (yalnız birim fiyatı anlaşılmış) kalemler sözleşme tutarına ve kalan işe girmez.</p>}
            <Tutar etiket="Hakedişi çıkan" tutar={toplam.hakedisTutari} />
            <Tutar etiket="Kalan iş" tutar={toplam.kalanIs} />
            <Tutar etiket="Hakediş borcu (KDV dahil)" tutar={toplam.borc} sinif="ozet-ara" />
            <Tutar etiket="Ödenen" tutar={toplam.odenen} />
            <p className="ozet-tutar ozet-toplam">
              <span>Kalan borç</span>
              <strong>{tlYaz(toplam.kalanBorc)}</strong>
            </p>
            {toplam.bekleyenTeminat > 0 && <p className="soluk kucuk">Kalan borcun {tlYaz(toplam.bekleyenTeminat)} kadarı teminat (iş bitiminde ödenir).</p>}
            {toplam.geciken > 0 && <p className="mesaj mesaj-uyari">Ödeme planında vadesi geçmiş {tlYaz(toplam.geciken)} var.</p>}
            {veri.taslakSayisi > 0 && <p className="soluk kucuk">{veri.taslakSayisi} taslak sözleşme toplama girmedi.</p>}
          </section>

          {bekleyen.length > 0 && (
            <section className="kart">
              <h2>Gecikmiş ve yaklaşan ödemeler</h2>
              <ul className="liste">
                {bekleyen.map((b) => (
                  <li key={b.plan.id}>
                    <a href={`#/sozlesmeler/${b.satir.sozlesme.id}`} className="genis-satir">
                      <strong>{b.satir.cariAdi}</strong> <DurumRozeti d={b.durum} />
                      <span className="soluk blok kucuk">
                        {tarihYaz(b.plan.vadeTarihi)} · {tlYaz(b.kalan)}
                        {b.plan.aciklama && ` · ${b.plan.aciklama}`}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="kart">
            <h2>Sözleşmeler</h2>
            <ul className="liste">
              {veri.satirlar.map(({ sozlesme: s, cariAdi, taahhut: t }) => (
                <li key={s.id}>
                  <a href={`#/sozlesmeler/${s.id}`} className="genis-satir">
                    <span className="baslik-satiri">
                      <strong>{cariAdi}</strong>
                      <span className={t.kalanBorc > 0 ? 'bakiye bakiye-borc' : 'bakiye bakiye-sifir'}>{t.kalanBorc > 0 ? `Kalan ${tlYaz(t.kalanBorc)}` : 'Borç yok'}</span>
                    </span>
                    <span className="soluk blok kucuk">{s.ustaTipiAdi}</span>
                    <span className="soluk blok kucuk">
                      Sözleşme {t.sozlesmeTutari > 0 ? tlYaz(t.sozlesmeTutari) : 'birim fiyatlı'} · hakediş {tlYaz(t.hakedisTutari)} · ödenen {tlYaz(t.odenen)}
                      {t.bekleyenTeminat > 0 && ` · teminat ${tlYaz(t.bekleyenTeminat)}`}
                      {t.geciken > 0 && ` · geciken ${tlYaz(t.geciken)}`}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </>
  );
}

/** Proje sayfasındaki sözleşme kartına bağlantı. */
export function TaahhutBaglantisi({ projeId }: { projeId: string }) {
  return (
    <a className="baglanti-dugmesi" href={`#/projeler/${projeId}/taahhut`}>
      Taahhüt tablosu
    </a>
  );
}

