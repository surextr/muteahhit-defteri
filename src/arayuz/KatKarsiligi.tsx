import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { vadeDurumu, type KatKarsiligiVadesi } from '../hesap/katKarsiligi';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { teslimDurumu, yerelGun } from '../hesap/tarih';
import type { ArsaSahibiDurumu } from '../servisler/arsaSahibi';
import { SISTEM_KALEMI, sistemKalemiHazirla } from '../servisler/kalem';
import {
  arsaSahibiOdemesiEkle,
  cariKatKarsiligiOzeti,
  ilaveImalatDurumuDegistir,
  ilaveImalatEkle,
  katKarsiligiAyrintilariKaydet,
  katKarsiligiOnayla,
  katKarsiligiOzeti,
  type KatKarsiligiAyrintilari,
  type KatKarsiligiOzeti,
} from '../servisler/katKarsiligi';
import type { GecikmeCezasi, IlaveImalat, IlaveImalatDurumu } from '../veri/tipler';
import { useUygulama } from './baglam';
import { BelgelerKarti } from './Belgeler';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { TutarGirdisi } from './Girdiler';
import { git } from './rota';

// Kat karşılığı sözleşmesinin ayrıntıları: teslim, gecikme cezası, kira yardımı, nakit ödeme planı, ilave imalat.
// Yükümlülükler cari borcu değildir; "Ödeme yap" gider formunu arsa sahibi, kalem ve Peşin hazır açar.

const tarihYaz = (t: string | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '—');

const DURUM_ADI: Record<IlaveImalatDurumu, string> = { talep: 'Talep', onaylandi: 'Onaylandı', reddedildi: 'Reddedildi', yapildi: 'Yapıldı' };
const VADE_ETIKETI = { gecti: 'vadesi geçti', yaklasiyor: 'yaklaşıyor', ileride: '', kosullu: 'koşullu' } as const;


export function KatKarsiligiKarti(props: { projeId: string; arsa: ArsaSahibiDurumu | null; bolumEtiketi: (bolumId: string) => string }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [ozet, setOzet] = useState<KatKarsiligiOzeti | null | undefined>(undefined);
  const [acik, setAcik] = useState<'ayrinti' | 'plan' | 'imalat' | null>(null);
  const bugun = yerelGun(new Date());

  const yenile = useCallback(async () => {
    setOzet(await katKarsiligiOzeti(depo, oturum.firmaId, props.projeId, bugun));
  }, [depo, oturum.firmaId, props.projeId, bugun]);

  useEffect(() => {
    void yenile();
  }, [yenile, props.arsa]);

  if (!ozet || !props.arsa) return null;
  const { sozlesme } = ozet;
  const ad = (cariId: string) => props.arsa?.sahipler.find((s) => s.cari.id === cariId)?.cari.ad ?? '?';
  const kapat = async () => {
    setAcik(null);
    await yenile();
  };
  const teslim = teslimDurumu(ozet.teslim, null, bugun);
  /** Gider formunu arsa sahibi, sistem kodlu kalem ve Peşin hazır açar; kalem projede yoksa oluşturulur. */
  const odemeAc = async (cariId: string, kod: string) => {
    const kalem = await sistemKalemiHazirla(depo, servis, props.projeId, kod);
    git(`giderler/yeni/${props.projeId}/${cariId}/${kalem.id}`);
  };
  const uyarilar = vadeUyarilari(ozet.yukumlulukler.flatMap((y) => y.vadeler), bugun);

  return (
    <>
      <section className="kart">
        <div className="baslik-satiri">
          <h2>Kat karşılığı sözleşmesi</h2>
          {acik !== 'ayrinti' && (
            <button type="button" className="ikincil" onClick={() => setAcik('ayrinti')}>
              Ayrıntılar
            </button>
          )}
        </div>
        {kutu}
        {hata && <Hatalar hatalar={[hata]} />}

        {acik === 'ayrinti' ? (
          <AyrintiFormu ozet={ozet} ad={ad} onBitti={kapat} onVazgec={() => setAcik(null)} />
        ) : (
          <dl className="bilgi">
            <dt>Sözleşme</dt>
            <dd>
              {tarihYaz(sozlesme.sozlesmeTarihi)} ·{' '}
              {sozlesme.onay ? (
                <strong>Onaylı ✓</strong>
              ) : (
                <button
                  type="button"
                  className="baglanti-dugmesi"
                  onClick={() =>
                    void degistir('Sözleşme onaylanıyor', async () => {
                      await katKarsiligiOnayla(depo, servis, props.projeId);
                      await yenile();
                    })
                  }
                >
                  Onayla (imzalandı)
                </button>
              )}
            </dd>
            <dt>Teslim</dt>
            <dd>
              {sozlesme.teslimSuresiAy !== null
                ? `Ruhsattan ${sozlesme.teslimSuresiAy} ay${ozet.teslim ? ` · ${tarihYaz(ozet.teslim)}` : ' (ruhsat bekleniyor)'}`
                : tarihYaz(ozet.teslim)}
              {teslim && <span className={`teslim-rozeti teslim-${teslim.durum} satir-ici-rozet`}>{teslim.metin}</span>}
            </dd>
            <dt>Gecikme cezası</dt>
            <dd>{cezaYaz(sozlesme.gecikmeCezasi)}</dd>
            {sozlesme.not && (
              <div className="bilgi-satir">
                <dt>Not</dt>
                <dd className="cok-satir">{sozlesme.not}</dd>
              </div>
            )}
          </dl>
        )}

        {ozet.toplamCeza > 0 && (
          <div className="mesaj mesaj-uyari" role="status">
            <strong>Gecikme cezası doğdu: {tlYaz(ozet.toplamCeza)}</strong>
            <ul>
              {ozet.yukumlulukler
                .filter((y) => y.cezaDogan > 0)
                .map((y) => (
                  <li key={y.cariId}>
                    {ad(y.cariId)}: {sozlesme.gecikmeCezasi?.birim === 'gun' ? `${y.cezaGun} gün` : `${y.cezaAy} ay`} · {tlYaz(y.cezaDogan)}
                    {y.cezaOdenen > 0 && ` · ödenen ${tlYaz(y.cezaOdenen)}`}
                  </li>
                ))}
            </ul>
            <p className="kucuk">Otomatik borç değildir; ödenirse “Ceza öde” ile Gecikme cezası kalemine gider olarak girilir.</p>
          </div>
        )}

        {uyarilar.length > 0 && (
          <div className="mesaj mesaj-uyari">
            <strong>Vade uyarıları</strong>
            <ul>
              {uyarilar.map((u) => (
                <li key={u.anahtar}>
                  {u.adet > 1 ? `${tarihYaz(u.ilk)} – ${tarihYaz(u.son)}` : tarihYaz(u.ilk)} · {ad(u.cariId)} ·{' '}
                  {u.tur === 'kira' ? `Kira yardımı${u.adet > 1 ? ` (${u.adet} ay)` : ''}` : u.aciklama || 'Nakit ödeme'} · {tlYaz(u.kalan)}{' '}
                  <span className={u.durum === 'gecti' ? 'bakiye-borc' : 'soluk'}>({VADE_ETIKETI[u.durum]})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <h3>Arsa sahiplerine yükümlülükler</h3>
        <ul className="liste yukumlulukler">
          {ozet.yukumlulukler.map((y) => (
            <li key={y.cariId}>
              <div className="genis-satir">
                <a href={`#/cariler/${y.cariId}`}>
                  <strong>{ad(y.cariId)}</strong>
                </a>
                <dl className="bilgi kucuk-bilgi">
                  <dt>Nakit ödeme</dt>
                  <dd>{tlYaz(y.nakitToplam)}</dd>
                  <dt>Kira yardımı</dt>
                  <dd>{y.kiraAy > 0 ? `${y.kiraAy} ay · ${tlYaz(y.kiraDogan)}` : '—'}</dd>
                  <dt>Ödenen</dt>
                  <dd>{tlYaz(y.odenen)}</dd>
                  <dt>Kalan</dt>
                  <dd>
                    <strong>{tlYaz(y.kalan)}</strong>
                    {y.vadesiGecen > 0 && <span className="bakiye-borc"> · vadesi geçen {tlYaz(y.vadesiGecen)}</span>}
                  </dd>
                  {y.cezaDogan > 0 && (
                    <div className="bilgi-satir">
                      <dt>Doğan ceza</dt>
                      <dd className="bakiye-borc">
                        {tlYaz(y.cezaDogan)}
                        {y.cezaOdenen > 0 && <span className="soluk"> · ödenen {tlYaz(y.cezaOdenen)}</span>}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="dugmeler">
                  <button type="button" className="ikincil" onClick={() => void odemeAc(y.cariId, SISTEM_KALEMI.nakit)}>
                    Nakit ödeme yap
                  </button>
                  {y.kiraAy > 0 && (
                    <button type="button" className="ikincil" onClick={() => void odemeAc(y.cariId, SISTEM_KALEMI.kira)}>
                      Kira öde
                    </button>
                  )}
                  {y.cezaDogan > 0 && (
                    <button type="button" className="ikincil" onClick={() => void odemeAc(y.cariId, SISTEM_KALEMI.ceza)}>
                      Ceza öde
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        <p className="soluk kucuk">
          Ödenen: bu projede “Arsa ve kat karşılığı giderleri” kalemlerinde arsa sahibine yazılan giderler (gecikme cezası hariç). Kalan:
          nakit ödeme planı ve bugüne kadar doğan kira, eksi ödenen.
        </p>
      </section>

      <section className="kart">
        <div className="baslik-satiri">
          <h2>Nakit ödeme planı</h2>
          {acik !== 'plan' && (
            <button type="button" className="ikincil" onClick={() => setAcik('plan')}>
              + Satır ekle
            </button>
          )}
        </div>
        {acik === 'plan' && <PlanFormu projeId={props.projeId} sahipler={props.arsa.sahipler} onBitti={kapat} onVazgec={() => setAcik(null)} />}
        {ozet.plan.length === 0 ? (
          <p className="soluk">Arsa sahiplerine yapılacak nakit ödeme yok.</p>
        ) : (
          <ul className="liste">
            {ozet.plan.map((p) => {
              const kalan = acikVade(ozet.yukumlulukler.flatMap((y) => y.vadeler), p.id);
              const durum = vadeDurumu(p.vadeTarihi, bugun);
              return (
                <li key={p.id}>
                  <span>
                    <strong>{p.vadeTarihi ? tarihYaz(p.vadeTarihi) : p.kosul}</strong> · {ad(p.cariId)}
                    {p.aciklama && <span className="soluk"> · {p.aciklama}</span>}
                  </span>
                  <span className="satir-ici">
                    <span>{tlYaz(p.tutar)}</span>
                    {kalan === 0 ? (
                      <span className="rozet-tamam">ödendi</span>
                    ) : (
                      kalan < p.tutar && <span className="soluk">kalan {tlYaz(kalan)}</span>
                    )}
                    {kalan > 0 && VADE_ETIKETI[durum] && <span className={durum === 'gecti' ? 'bakiye-borc' : 'soluk'}>{VADE_ETIKETI[durum]}</span>}
                    <button
                      type="button"
                      className="baglanti-dugmesi"
                      aria-label={`${tarihYaz(p.vadeTarihi)} ${ad(p.cariId)} ödeme satırını iptal et`}
                      onClick={() =>
                        void degistir('Ödeme planı satırı iptal ediliyor', async (g) => {
                          await servis.iptal('arsaSahibiOdemesi', p.id, g);
                          await yenile();
                        })
                      }
                    >
                      İptal
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="kart">
        <div className="baslik-satiri">
          <h2>İlave imalat</h2>
          {acik !== 'imalat' && (
            <button type="button" className="ikincil" onClick={() => setAcik('imalat')}>
              + Talep ekle
            </button>
          )}
        </div>
        {acik === 'imalat' && (
          <ImalatFormu
            projeId={props.projeId}
            arsa={props.arsa}
            bolumEtiketi={props.bolumEtiketi}
            onBitti={kapat}
            onVazgec={() => setAcik(null)}
          />
        )}
        {ozet.ilaveImalatlar.length === 0 ? (
          <p className="soluk">Arsa sahiplerinin ek iş talebi yok.</p>
        ) : (
          <ul className="liste">
            {ozet.ilaveImalatlar.map(({ imalat: i, maliyet, alinacak, tahsilEdilen }) => (
              <li key={i.id}>
                <div className="genis-satir">
                  <span>
                    <strong>{i.aciklama}</strong>
                    {i.bolumId && <span> · {props.bolumEtiketi(i.bolumId)}</span>} · {ad(i.cariId)} · {tlYaz(i.tutar)}
                  </span>
                  <span className="soluk kucuk blok">
                    {i.oder === 'arsa_sahibi' ? 'Arsa sahibi öder' : 'Müteahhit üstlenir'} · maliyet {tlYaz(maliyet)}
                    {i.oder === 'arsa_sahibi' && alinacak > 0 && ` · alınacak ${tlYaz(alinacak)}, tahsil edilen ${tlYaz(tahsilEdilen)}`}
                  </span>
                  <label className="satir-ici">
                    <span className="soluk">Durum</span>
                    <select
                      value={i.durum}
                      onChange={(e) => {
                        const durum = e.target.value as IlaveImalatDurumu;
                        void degistir(`${i.aciklama}: ${DURUM_ADI[durum]}`, async (g) => {
                          await ilaveImalatDurumuDegistir(depo, servis, i.id, durum, g);
                          await yenile();
                        });
                      }}
                    >
                      {Object.entries(DURUM_ADI).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="soluk kucuk">
          Arsa sahibinin ödeyeceği iş onaylanınca carisinde alacak olur; tahsilat Ödeme ekranından girilir. Maliyet, gider satırında bu işe bağlanan
          tutarlardır.
        </p>
      </section>

      <BelgelerKarti bagliTur="katKarsiligiSozlesme" bagliId={sozlesme.id} varsayilanTur="sozlesme" baslik="Sözleşme belgeleri" />
    </>
  );
}

const cezaYaz = (c: GecikmeCezasi | null) =>
  !c ? '—' : c.birim === 'gun' ? `Geciken her gün ${tlYaz(c.tutar)}` : `Geciken her ay ${c.birim === 'daire_ay' ? 'daire başına ' : ''}${tlYaz(c.tutar)}`;

/**
 * Vadesi geçen ve 30 gün içinde gelen ödenmemiş vadeler. Aynı kişinin aynı durumdaki kira ayları tek satırda
 * toplanır ("01.03 – 01.10 · Kira yardımı (8 ay)"); nakit ödemeler tek tek.
 */
function vadeUyarilari(vadeler: KatKarsiligiVadesi[], bugun: string) {
  const gruplar = new Map<
    string,
    { anahtar: string; cariId: string; tur: KatKarsiligiVadesi['tur']; durum: 'gecti' | 'yaklasiyor'; ilk: string; son: string; adet: number; kalan: number; aciklama: string }
  >();
  for (const v of vadeler) {
    const durum = vadeDurumu(v.vade, bugun);
    if (durum !== 'gecti' && durum !== 'yaklasiyor') continue;
    const anahtar = v.tur === 'kira' ? `${v.cariId}-kira-${durum}` : `${v.cariId}-${v.planId ?? v.vade}`;
    const g = gruplar.get(anahtar);
    if (g) {
      g.son = v.vade!;
      g.adet++;
      g.kalan += v.kalan;
    } else {
      gruplar.set(anahtar, { anahtar, cariId: v.cariId, tur: v.tur, durum, ilk: v.vade!, son: v.vade!, adet: 1, kalan: v.kalan, aciklama: v.aciklama });
    }
  }
  return [...gruplar.values()].sort((a, b) => a.ilk.localeCompare(b.ilk));
}

/** Plan satırının ödenmemiş kısmı (vadeler listesinde yoksa ödenmiştir). */
const acikVade = (vadeler: KatKarsiligiVadesi[], planId: string) => vadeler.find((v) => v.planId === planId)?.kalan ?? 0;

// ─── Formlar ───────────────────────────────────────────────────────

function FormKabugu(props: { children: ReactNode; hatalar: string[]; onKaydet: () => void; onVazgec: () => void; islemde?: boolean }) {
  return (
    <div className="kalem-formu">
      {props.children}
      <Hatalar hatalar={props.hatalar} />
      <div className="dugmeler">
        <button type="button" onClick={props.onKaydet} disabled={props.islemde}>
          Kaydet
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

function AyrintiFormu(props: { ozet: KatKarsiligiOzeti; ad: (cariId: string) => string; onBitti: () => Promise<void>; onVazgec: () => void }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const s = props.ozet.sozlesme;
  const [f, setF] = useState({
    sozlesmeTarihi: s.sozlesmeTarihi ?? '',
    teslimTuru: s.teslimSuresiAy !== null ? ('ruhsat' as const) : ('tarih' as const),
    teslimTarihi: s.teslimTarihi ?? '',
    teslimSuresiAy: s.teslimSuresiAy === null ? '' : String(s.teslimSuresiAy),
    ceza: s.gecikmeCezasi ? tutarMetni(s.gecikmeCezasi.tutar) : '',
    cezaBirimi: s.gecikmeCezasi?.birim ?? ('daire_ay' as GecikmeCezasi['birim']),
    not: s.not,
    kiralar: s.arsaSahipleri.map((a) => ({
      cariId: a.cariId,
      kiraAylik: a.kiraAylik === null ? '' : tutarMetni(a.kiraAylik),
      kiraBaslangic: a.kiraBaslangic ?? '',
      teslimAlindi: a.teslimAlindi ?? '',
    })),
  });
  const [hatalar, setHatalar] = useState<string[]>([]);
  const yaz = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  function kaydet() {
    const h: string[] = [];
    const ceza = f.ceza.trim() ? tlOku(f.ceza) : null;
    if (f.ceza.trim() && ceza === null) h.push('Ceza tutarını sayı olarak yazın.');
    const ay = f.teslimTuru === 'ruhsat' ? Number(f.teslimSuresiAy) : null;
    if (f.teslimTuru === 'ruhsat' && !f.teslimSuresiAy.trim()) h.push('Ruhsattan kaç ay sonra teslim edileceğini yazın.');
    const kiralar = f.kiralar.map((k) => {
      const aylik = k.kiraAylik.trim() ? tlOku(k.kiraAylik) : null;
      if (k.kiraAylik.trim() && aylik === null) h.push(`${props.ad(k.cariId)}: aylık kirayı sayı olarak yazın.`);
      return { cariId: k.cariId, kiraAylik: aylik, kiraBaslangic: k.kiraBaslangic || null, teslimAlindi: k.teslimAlindi || null };
    });
    setHatalar(h);
    if (h.length > 0) return;
    const a: KatKarsiligiAyrintilari = {
      sozlesmeTarihi: f.sozlesmeTarihi || null,
      teslimTarihi: f.teslimTuru === 'tarih' ? f.teslimTarihi || null : null,
      teslimSuresiAy: ay,
      gecikmeCezasi: ceza ? { tutar: ceza, birim: f.cezaBirimi } : null,
      not: f.not,
      kiralar,
    };
    void degistir('Kat karşılığı sözleşmesi değişiyor', async (g) => {
      await katKarsiligiAyrintilariKaydet(depo, servis, s.projeId, a, g);
      await props.onBitti();
    });
  }

  return (
    <FormKabugu hatalar={hata ? [...hatalar, hata] : hatalar} onKaydet={kaydet} onVazgec={props.onVazgec}>
      {kutu}
      <Alan etiket="Sözleşme tarihi">
        <input type="date" value={f.sozlesmeTarihi} onChange={(e) => yaz('sozlesmeTarihi', e.target.value)} />
      </Alan>
      <fieldset className="secenekler">
        <legend>Teslim</legend>
        <label>
          <input type="radio" name="teslim" checked={f.teslimTuru === 'tarih'} onChange={() => yaz('teslimTuru', 'tarih')} /> Kesin tarih
        </label>
        <label>
          <input type="radio" name="teslim" checked={f.teslimTuru === 'ruhsat'} onChange={() => yaz('teslimTuru', 'ruhsat')} /> Ruhsattan itibaren
        </label>
      </fieldset>
      {f.teslimTuru === 'tarih' ? (
        <Alan etiket="Teslim tarihi">
          <input type="date" value={f.teslimTarihi} onChange={(e) => yaz('teslimTarihi', e.target.value)} />
        </Alan>
      ) : (
        <Alan etiket="Ruhsattan kaç ay sonra" aciklama="Tarih, Ruhsat takip başlığı tamamlanınca hesaplanır.">
          <input value={f.teslimSuresiAy} inputMode="numeric" placeholder="24" onChange={(e) => yaz('teslimSuresiAy', e.target.value)} />
        </Alan>
      )}
      <div className="iki-sutun">
        <Alan etiket="Gecikme cezası (₺)" aciklama="Boşsa ceza yok.">
          <TutarGirdisi value={f.ceza} onChange={(v) => yaz('ceza', v)} />
        </Alan>
        <Alan etiket="Ceza birimi">
          <select value={f.cezaBirimi} onChange={(e) => yaz('cezaBirimi', e.target.value as GecikmeCezasi['birim'])}>
            <option value="daire_ay">Her ay, daire başına</option>
            <option value="ay">Her ay, toplam</option>
            <option value="gun">Her gün, toplam</option>
          </select>
        </Alan>
      </div>
      <h3>Kira yardımı</h3>
      {f.kiralar.map((k, i) => (
        <fieldset key={k.cariId} className="kira-satiri">
          <legend>{props.ad(k.cariId)}</legend>
          <div className="iki-sutun">
            <Alan etiket="Aylık (₺)">
              <TutarGirdisi
                value={k.kiraAylik}
                onChange={(v) => yaz('kiralar', f.kiralar.map((x, j) => (j === i ? { ...x, kiraAylik: v } : x)))}
              />
            </Alan>
            <Alan etiket="İlk ay (tahliye)">
              <input
                type="date"
                value={k.kiraBaslangic}
                onChange={(e) => yaz('kiralar', f.kiralar.map((x, j) => (j === i ? { ...x, kiraBaslangic: e.target.value } : x)))}
              />
            </Alan>
          </div>
          <Alan etiket="Dairelerini teslim aldı" aciklama="Kira yardımı ve gecikme cezası bu tarihte durur.">
            <input
              type="date"
              value={k.teslimAlindi}
              onChange={(e) => yaz('kiralar', f.kiralar.map((x, j) => (j === i ? { ...x, teslimAlindi: e.target.value } : x)))}
            />
          </Alan>
        </fieldset>
      ))}
      <Alan etiket="Not">
        <textarea value={f.not} rows={3} onChange={(e) => yaz('not', e.target.value)} />
      </Alan>
      <p className="soluk kucuk">Sözleşme metni burada yazılmaz; imzalı sözleşmeyi aşağıdaki “Sözleşme belgeleri”ne ekleyin.</p>
    </FormKabugu>
  );
}

function PlanFormu(props: { projeId: string; sahipler: ArsaSahibiDurumu['sahipler']; onBitti: () => Promise<void>; onVazgec: () => void }) {
  const { depo, servis } = useUygulama();
  const [f, setF] = useState({ cariId: props.sahipler[0]?.cari.id ?? '', vadeTarihi: '', kosul: '', tutar: '', aciklama: '' });
  const [hatalar, setHatalar] = useState<string[]>([]);

  async function kaydet() {
    const tutar = tlOku(f.tutar);
    if (tutar === null) return setHatalar(['Tutarı yazın.']);
    try {
      await arsaSahibiOdemesiEkle(depo, servis, props.projeId, { ...f, vadeTarihi: f.vadeTarihi || null, tutar });
      await props.onBitti();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <FormKabugu hatalar={hatalar} onKaydet={() => void kaydet()} onVazgec={props.onVazgec}>
      <div className="iki-sutun">
        <Alan etiket="Arsa sahibi">
          <select value={f.cariId} onChange={(e) => setF({ ...f, cariId: e.target.value })}>
            {props.sahipler.map((s) => (
              <option key={s.cari.id} value={s.cari.id}>
                {s.cari.ad}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Tutar (₺)">
          <TutarGirdisi value={f.tutar} onChange={(v) => setF({ ...f, tutar: v })} />
        </Alan>
        <Alan etiket="Vade">
          <input type="date" value={f.vadeTarihi} onChange={(e) => setF({ ...f, vadeTarihi: e.target.value })} />
        </Alan>
        <Alan etiket="ya da koşul" aciklama="Tarih yoksa">
          <input value={f.kosul} placeholder="Ruhsat alınınca" disabled={!!f.vadeTarihi} onChange={(e) => setF({ ...f, kosul: e.target.value })} />
        </Alan>
      </div>
      <Alan etiket="Açıklama">
        <input value={f.aciklama} placeholder="Peşinat" onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      </Alan>
    </FormKabugu>
  );
}

function ImalatFormu(props: {
  projeId: string;
  arsa: ArsaSahibiDurumu;
  bolumEtiketi: (bolumId: string) => string;
  onBitti: () => Promise<void>;
  onVazgec: () => void;
}) {
  const { depo, servis } = useUygulama();
  const [f, setF] = useState({
    cariId: props.arsa.sahipler[0]?.cari.id ?? '',
    bolumId: '',
    tarih: yerelGun(new Date()),
    aciklama: '',
    tutar: '',
    oder: 'arsa_sahibi' as IlaveImalat['oder'],
  });
  const [hatalar, setHatalar] = useState<string[]>([]);
  const daireler = [...props.arsa.tahsis.entries()].filter(([, cari]) => cari === f.cariId).map(([bolumId]) => bolumId);

  async function kaydet() {
    const tutar = f.tutar.trim() ? tlOku(f.tutar) : 0;
    if (tutar === null) return setHatalar(['Tutarı sayı olarak yazın.']);
    try {
      await ilaveImalatEkle(depo, servis, props.projeId, { ...f, bolumId: f.bolumId || null, tutar });
      await props.onBitti();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <FormKabugu hatalar={hatalar} onKaydet={() => void kaydet()} onVazgec={props.onVazgec}>
      <Alan etiket="Yapılacak iş">
        <input value={f.aciklama} placeholder="Jakuzi, ek priz, parke…" onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      </Alan>
      <div className="iki-sutun">
        <Alan etiket="Arsa sahibi">
          <select value={f.cariId} onChange={(e) => setF({ ...f, cariId: e.target.value, bolumId: '' })}>
            {props.arsa.sahipler.map((s) => (
              <option key={s.cari.id} value={s.cari.id}>
                {s.cari.ad}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Daire">
          <select value={f.bolumId} onChange={(e) => setF({ ...f, bolumId: e.target.value })}>
            <option value="">Belirtilmedi</option>
            {daireler.map((id) => (
              <option key={id} value={id}>
                {props.bolumEtiketi(id)}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Tutar (₺)">
          <TutarGirdisi value={f.tutar} onChange={(v) => setF({ ...f, tutar: v })} />
        </Alan>
        <Alan etiket="Talep tarihi">
          <input type="date" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} />
        </Alan>
      </div>
      <fieldset className="secenekler">
        <legend>Kim öder</legend>
        <label>
          <input type="radio" name="oder" checked={f.oder === 'arsa_sahibi'} onChange={() => setF({ ...f, oder: 'arsa_sahibi' })} /> Arsa sahibi
        </label>
        <label>
          <input type="radio" name="oder" checked={f.oder === 'muteahhit'} onChange={() => setF({ ...f, oder: 'muteahhit' })} /> Müteahhit
          üstlenir
        </label>
      </fieldset>
    </FormKabugu>
  );
}

/** Arsa sahibinin cari ekranında: kat karşılığı yükümlülükleri, bakiyeye karışmaz. */
export function CariKatKarsiligiKutusu({ cariId }: { cariId: string }) {
  const { depo, oturum } = useUygulama();
  const [ozet, setOzet] = useState<{ odenen: number; kalan: number; cezaDogan: number } | null>(null);
  useEffect(() => {
    void cariKatKarsiligiOzeti(depo, oturum.firmaId, cariId, yerelGun(new Date())).then(setOzet);
  }, [depo, oturum.firmaId, cariId]);
  if (!ozet) return null;
  return (
    <section className="kart bilgi-kutusu">
      <h2>Kat karşılığı yükümlülükleri</h2>
      <p>
        Ödenen <strong>{tlYaz(ozet.odenen)}</strong> · kalan <strong>{tlYaz(ozet.kalan)}</strong>
        {ozet.cezaDogan > 0 && <span className="bakiye-borc"> · doğan gecikme cezası {tlYaz(ozet.cezaDogan)}</span>}
      </p>
      <p className="soluk kucuk">Nakit ödeme planı ve kira yardımından hesaplanır; yukarıdaki bakiyeye karışmaz.</p>
    </section>
  );
}
