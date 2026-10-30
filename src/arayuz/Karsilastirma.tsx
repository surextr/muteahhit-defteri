import { useEffect, useState } from 'react';
import { uyariEsigi, yuzdeYaz } from '../hesap/ilerleme';
import type { Eslesme, Karsilastirma, KalemKarsilastirmasi } from '../hesap/karsilastirma';
import { tlYaz } from '../hesap/para';
import { sayiYaz } from '../hesap/sayi';
import { karsilastirmaGetir, type KarsilastirmaSonucu } from '../servisler/karsilastirma';
import { projeGetir } from '../servisler/proje';
import type { Proje } from '../veri/tipler';
import { AktarmaDugmeleri } from './Aktarma';
import { useUygulama } from './baglam';
import { BosDurum } from './bilesenler';
import { tarihYaz } from './Fiyatlar';
import { IlerlemeCubuklari } from './Ilerleme';

// Başlangıç maliyeti (onaylı maliyet hesabı) ile gerçekleşen giderler: ana kalem başına plan, harcanan, ilerleme,
// beklenen, sapma; eşleşen kalemde fiyat ve miktar farkı; planda olmayan harcamalar.

const isaretli = (k: number) => `${k > 0 ? '+' : k < 0 ? '−' : ''}${tlYaz(Math.abs(k))}`;
const yuzdesi = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null);

export function KarsilastirmaEkrani({ projeId }: { projeId: string }) {
  const { depo, oturum, firma } = useUygulama();
  const [proje, setProje] = useState<Proje | null>(null);
  const [v, setV] = useState<KarsilastirmaSonucu | null>(null);
  const [acik, setAcik] = useState<string | null>(null);
  const esik = uyariEsigi(firma.ayarlar);

  useEffect(() => {
    void projeGetir(depo, oturum.firmaId, projeId).then((p) => setProje(p ?? null));
    void karsilastirmaGetir(depo, oturum.firmaId, projeId, esik).then(setV);
  }, [depo, oturum.firmaId, projeId, esik]);

  if (!v) return <p>Yükleniyor…</p>;
  const geri = (
    <p>
      <a className="geri-baglanti" href={`#/projeler/${projeId}`}>← {proje?.ad ?? 'Proje'}</a>
    </p>
  );
  if (!v.hesap || !v.sonuc)
    return (
      <>
        {geri}
        <h1>Maliyet karşılaştırması</h1>
        <BosDurum
          metin={
            v.taslaklar.length
              ? 'Karşılaştırma onaylanmış (başlangıç maliyeti olarak dondurulmuş) maliyet hesabıyla yapılır. Projenin hesabı henüz onaylanmamış.'
              : 'Bu projenin maliyet hesabı yok. Önce maliyet hesabı açıp onaylayın; sonra gerçekleşen giderlerle karşılaştırılır.'
          }
          eylemler={v.taslaklar.length ? [{ yol: `maliyet/${v.taslaklar[0]!.id}`, ad: 'Hesabı aç' }] : [{ yol: `maliyet/proje/${projeId}`, ad: 'Maliyet hesabı aç' }]}
        />
      </>
    );
  const s = v.sonuc;
  const h = v.hesap;
  const harcama = yuzdesi(s.gercek, s.plan);
  // İlerlemesi girilen ana kalemlerin harcaması (ilerleme ile aynı kapsamda karşılaştırılsın).
  const ilerlemeli = s.kalemler.filter((k) => k.ilerleme !== null);
  const ilerlemeliHarcama = yuzdesi(
    ilerlemeli.reduce((t, k) => t + k.gercek, 0),
    ilerlemeli.reduce((t, k) => t + k.plan, 0),
  );
  const kismi = ilerlemeli.length > 0 && ilerlemeli.length < s.kalemler.filter((k) => k.plan > 0).length;

  return (
    <>
      {geri}
      <div className="baslik-satiri">
        <h1>Maliyet karşılaştırması</h1>
        <AktarmaDugmeleri dosyaAdi={`${proje?.ad ?? 'Proje'} maliyet karşılaştırması`} sayfalar={() => excelSayfalari(s, `${proje?.ad ?? ''} · ${h.ad} Rev. ${h.revizyon}`)} />
      </div>
      <p className="soluk">
        Başlangıç: <a href={`#/maliyet/${h.id}`}>{h.ad} · Rev. {h.revizyon}</a> ({tarihYaz(h.onay!.zaman.slice(0, 10))} onaylı) · Tutarlar KDV hariç
      </p>

      <section className="kart karsilastirma-ozeti">
        <div className="ko-izgara">
          <div>
            <span className="soluk">Başlangıç maliyeti</span>
            <strong>{tlYaz(s.plan)}</strong>
          </div>
          <div>
            <span className="soluk">Gerçekleşen</span>
            <strong>{tlYaz(s.gercek)}</strong>
            <span className="soluk">{harcama !== null && `plana göre ${yuzdeYaz(harcama)}`}</span>
          </div>
          {s.beklenen !== null && s.sapma !== null && (
            <div>
              <span className="soluk">{kismi ? `Bu ilerlemede beklenen (${ilerlemeli.length} ana kalem)` : 'Bu ilerlemede beklenen'}</span>
              <strong>{tlYaz(s.beklenen)}</strong>
              <span className={s.sapma > 0 ? 'ko-kotu' : 'ko-iyi'}>sapma {isaretli(s.sapma)}</span>
            </div>
          )}
          <div>
            <span className="soluk">Fiyat farkı (eşleşen kalemler)</span>
            <strong className={s.fiyatFarki > 0 ? 'ko-kotu' : s.fiyatFarki < 0 ? 'ko-iyi' : ''}>{isaretli(s.fiyatFarki)}</strong>
            <span className="soluk">{s.fiyatFarki > 0 ? 'planlanandan pahalı alındı' : s.fiyatFarki < 0 ? 'planlanandan ucuz alındı' : ''}</span>
          </div>
          {s.plandaYok !== 0 && (
            <div>
              <span className="soluk">Planda olmayan harcama</span>
              <strong>{tlYaz(s.plandaYok)}</strong>
            </div>
          )}
        </div>
        {s.ilerleme !== null ? (
          <>
            <IlerlemeCubuklari ilerleme={s.ilerleme} harcama={ilerlemeliHarcama} uyari={ilerlemeliHarcama !== null && ilerlemeliHarcama - s.ilerleme > esik} />
            {kismi && <p className="mesaj-not">İlerleme yalnız {ilerlemeli.length} ana kalemde girilmiş; çubuklar ve beklenen bu kalemleri kapsar.</p>}
          </>
        ) : (
          <p className="mesaj-not">
            Projede ilerleme yüzdesi girilmediği için "beklenen" hesaplanmıyor; harcanan yalnız planla karşılaştırılıyor.{' '}
            <a href={`#/projeler/${projeId}/ilerleme`}>İlerleme gir</a>
          </p>
        )}
      </section>

      <ul className="kart-listesi">
        {s.kalemler.map((k) => (
          <li key={k.kod ?? 'yok'}>
            <KalemKarti k={k} esik={esik} acik={acik === (k.kod ?? 'yok')} onAc={() => setAcik((a) => (a === (k.kod ?? 'yok') ? null : (k.kod ?? 'yok')))} />
          </li>
        ))}
      </ul>
      <p className="mesaj-not">
        Fiyat farkı = gerçek tutar − alınan miktar × planlanan birim fiyat. Miktar farkı iş sürerken eksi görünür (henüz alınmadı). Gider satırı plan satırıyla adından ve
        bütçe kaleminden eşleşir; miktarı ya da birimi yazılmamış faturada yalnız tutar karşılaştırılır.
      </p>
    </>
  );
}

function KalemKarti({ k, esik, acik, onAc }: { k: KalemKarsilastirmasi; esik: number; acik: boolean; onAc: () => void }) {
  const harcama = yuzdesi(k.gercek, k.plan);
  return (
    <div className={`kart karsilastirma-kalemi ${k.uyari ? 'kk-uyari' : ''}`}>
      <button type="button" className="kk-baslik" onClick={onAc} aria-expanded={acik}>
        <strong>{k.ad}</strong>
        <span>
          {tlYaz(k.gercek)} <span className="soluk">/ {tlYaz(k.plan)}</span>
        </span>
      </button>
      {k.plan > 0 && <IlerlemeCubuklari ilerleme={k.ilerleme} harcama={harcama} uyari={k.uyari} />}
      <p className="kucuk-bilgi">
        {k.plan === 0 && 'Planda yok · '}
        {k.sapma !== null && <span className={k.sapma > 0 ? 'ko-kotu' : 'ko-iyi'}>beklenene göre {isaretli(k.sapma)} · </span>}
        {k.uyari && <span className="rozet-gecikti">⚠ Harcama ilerlemenin {esik} puandan fazla önünde</span>}{' '}
        <button type="button" className="baglanti-dugmesi" onClick={onAc}>
          {acik ? 'Ayrıntıyı gizle ▲' : `Ayrıntı (${k.eslesmeler.length + k.plandaYok.length + k.harcanmamis.length}) ▼`}
        </button>
      </p>
      {acik && (
        <div className="kk-ayrinti">
          {k.eslesmeler.map((e) => (
            <EslesmeSatiri key={e.plan.id} e={e} />
          ))}
          {k.plandaYok.length > 0 && (
            <>
              <h3>Planda olmayan harcamalar</h3>
              <ul className="kk-liste">
                {k.plandaYok.map((g, i) => (
                  <li key={`${g.giderId}-${i}`}>
                    <a href={`#/giderler/${g.giderId}`}>{g.aciklama || g.kodAdi}</a>
                    <span>
                      {tlYaz(g.tutar)} <span className="soluk">· {tarihYaz(g.tarih)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {k.harcanmamis.length > 0 && (
            <>
              <h3>Henüz harcaması olmayan</h3>
              <ul className="kk-liste">
                {k.harcanmamis.map((p) => (
                  <li key={p.id}>
                    <span>{p.ad}</span>
                    <span className="soluk">plan {tlYaz(p.tutar ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EslesmeSatiri({ e }: { e: Eslesme }) {
  const p = e.plan;
  const oran = e.gercekMiktar !== null && p.miktar ? (e.gercekMiktar / p.miktar) * 100 : null;
  return (
    <div className="kk-eslesme">
      <div className="kk-eslesme-ust">
        <strong>{p.ad}</strong>
        <span>
          {tlYaz(e.gercekTutar)} <span className="soluk">/ {tlYaz(p.tutar ?? 0)}</span>
        </span>
      </div>
      <p className="kucuk-bilgi">
        {e.gercekMiktar !== null ? (
          <>
            {sayiYaz(e.gercekMiktar)} / {sayiYaz(p.miktar)} {p.birim} alındı{oran !== null && ` (plana göre ${yuzdeYaz(oran)})`}
            {e.ortalamaFiyat !== null && p.birimFiyat !== null && (
              <>
                {' · '}ortalama {tlYaz(e.ortalamaFiyat)}, plan {tlYaz(p.birimFiyat)} / {p.birim}
              </>
            )}
          </>
        ) : (
          <span className="soluk">Faturalarda miktar ya da birim yok; yalnız tutar karşılaştırılıyor.</span>
        )}
      </p>
      {(e.fiyatFarki !== null || e.miktarFarki !== null) && (
        <p className="kucuk-bilgi">
          {e.fiyatFarki !== null && <span className={e.fiyatFarki > 0 ? 'ko-kotu' : e.fiyatFarki < 0 ? 'ko-iyi' : ''}>Fiyat farkı {isaretli(e.fiyatFarki)}</span>}
          {e.miktarFarki !== null && <span className="soluk"> · miktar farkı {isaretli(e.miktarFarki)}</span>}
        </p>
      )}
    </div>
  );
}

function excelSayfalari(s: Karsilastirma, baslik: string) {
  return [
    {
      ad: 'Ana kalemler',
      ust: [`Maliyet karşılaştırması · ${baslik} · KDV hariç`],
      basliklar: ['Ana kalem', 'Başlangıç', 'Gerçekleşen', 'Harcama %', 'İlerleme %', 'Beklenen', 'Sapma', 'Fiyat farkı', 'Planda olmayan'],
      satirlar: [
        ...s.kalemler.map((k) => [
          k.ad,
          { tl: k.plan },
          { tl: k.gercek },
          k.plan > 0 ? Math.round((k.gercek / k.plan) * 1000) / 10 : null,
          k.ilerleme,
          k.beklenen === null ? null : { tl: k.beklenen },
          k.sapma === null ? null : { tl: k.sapma },
          { tl: k.eslesmeler.reduce((t, e) => t + (e.fiyatFarki ?? 0), 0) },
          { tl: k.plandaYok.reduce((t, g) => t + g.tutar, 0) },
        ]),
        [{ kalin: 'Toplam' }, { tl: s.plan }, { tl: s.gercek }, s.plan > 0 ? Math.round((s.gercek / s.plan) * 1000) / 10 : null, s.ilerleme, s.beklenen === null ? null : { tl: s.beklenen }, s.sapma === null ? null : { tl: s.sapma }, { tl: s.fiyatFarki }, { tl: s.plandaYok }],
      ],
    },
    {
      ad: 'Kalem eşleşmeleri',
      ust: [baslik],
      basliklar: ['Ana kalem', 'Kalem', 'Birim', 'Plan miktar', 'Alınan miktar', 'Plan birim fiyat', 'Ortalama fiyat', 'Plan tutar', 'Gerçek tutar', 'Fiyat farkı', 'Miktar farkı'],
      satirlar: s.kalemler.flatMap((k) =>
        k.eslesmeler.map((e) => [
          k.ad,
          e.plan.ad,
          e.plan.birim,
          e.plan.miktar,
          e.gercekMiktar,
          e.plan.birimFiyat === null ? null : { tl: e.plan.birimFiyat },
          e.ortalamaFiyat === null ? null : { tl: e.ortalamaFiyat },
          e.plan.tutar === null ? null : { tl: e.plan.tutar },
          { tl: e.gercekTutar },
          e.fiyatFarki === null ? null : { tl: e.fiyatFarki },
          e.miktarFarki === null ? null : { tl: e.miktarFarki },
        ]),
      ),
    },
    {
      ad: 'Planda olmayan',
      ust: [baslik],
      basliklar: ['Ana kalem', 'Kalem', 'Açıklama', 'Tarih', 'Tutar'],
      satirlar: s.kalemler.flatMap((k) => k.plandaYok.map((g) => [k.ad, g.kodAdi, g.aciklama, { tarih: g.tarih }, { tl: g.tutar }])),
    },
  ];
}
