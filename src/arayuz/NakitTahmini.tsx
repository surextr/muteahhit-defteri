import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ExcelSayfasi } from '../hesap/excel';
import { haftaMetni, NAKIT_KAYNAGI_ADI, nakitTahmini, PLANLI_KAYNAKLAR, type NakitDilimi, type NakitHaftasi, type NakitKalemi, type NakitTahmini } from '../hesap/nakitTahmini';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { nakitKalemleri, type NakitKalemleri } from '../servisler/nakitTahmini';
import { AktarmaDugmeleri } from './Aktarma';
import { useProjeErisimi, useUygulama, useYetki } from './baglam';
import { Simge } from './Simge';

// Gelecekteki nakit ihtiyacı: kasa ve bankadaki paradan başlayarak 13 hafta; kayıtlı borç/alacak (kesin) ve sözleşme
// planı, arsa sahibi, rezerve satış (planlı). Seçenekler kalemleri yeniden okumadan uygulanır.

/** Tabloda kuruşsuz ve ₺ başlıkta: telefonda dört sütun sığsın. */
const tlKisa = (n: number) => `${n < 0 ? '−' : ''}${Math.round(Math.abs(n) / 100).toLocaleString('tr-TR')}`;
const tarihKisa = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
const gunSonra = (bugun: string, t: string) => Math.round((Date.parse(`${t}T00:00:00Z`) - Date.parse(`${bugun}T00:00:00Z`)) / 86_400_000);

/** Kalemleri bir kez okur; ekran ve Bugün kartı ortak kullanır. */
export function useNakitKalemleri(): NakitKalemleri | null {
  const { depo, oturum } = useUygulama();
  const erisim = useProjeErisimi();
  const bugun = yerelGun(new Date());
  const [n, setN] = useState<NakitKalemleri | null>(null);
  useEffect(() => {
    let iptal = false;
    void nakitKalemleri(depo, oturum.firmaId, bugun, erisim).then((x) => !iptal && setN(x));
    return () => {
      iptal = true;
    };
  }, [depo, oturum.firmaId, bugun, erisim]);
  return n;
}

/** Açık uyarısı metni; açık yoksa null. */
export function acikMetni(t: NakitTahmini, bugun: string): { baslik: string; ayrinti: string } | null {
  if (t.baslangic < 0)
    return {
      baslik: `Şimdiden ${tlYaz(-t.baslangic)} açık var`,
      ayrinti: 'Vadesi geçmiş ve vadesiz ödemeler kasa ve bankadaki paradan fazla.',
    };
  if (!t.ilkAcik) return null;
  const en = t.enDusuk;
  return {
    baslik: `${gunSonra(bugun, t.ilkAcik.baslangic)} gün sonra yaklaşık ${tlYaz(-t.ilkAcik.birikimli)} açık oluşacak`,
    ayrinti: `Bakiye ${haftaMetni(t.ilkAcik)} eksiye düşüyor; en düşük ${tlYaz(en.tutar)}${en.hafta ? ` (${haftaMetni(en.hafta)})` : ''}.`,
  };
}

function Grafik({ t }: { t: NakitTahmini }) {
  const [secili, setSecili] = useState<number | null>(null);
  // Çizim alanı gerçek genişlikte (yazılar küçülmesin): kutunun genişliği izlenir.
  const kutu = useRef<HTMLElement>(null);
  const [G, setG] = useState(640);
  useEffect(() => {
    const el = kutu.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const g = new ResizeObserver(([e]) => e && e.contentRect.width > 0 && setG(Math.round(e.contentRect.width)));
    g.observe(el);
    return () => g.disconnect();
  }, []);
  const Y = 200;
  const kenar = { sol: 8, sag: 8, ust: 16, alt: 24 };
  const degerler = [t.baslangic, ...t.haftalar.map((h) => h.birikimli)];
  const enAz = Math.min(0, ...degerler);
  const enCok = Math.max(0, ...degerler);
  const aralik = enCok - enAz || 1;
  const x = (i: number) => kenar.sol + (i * (G - kenar.sol - kenar.sag)) / (degerler.length - 1);
  const y = (v: number) => kenar.ust + ((enCok - v) * (Y - kenar.ust - kenar.alt)) / aralik;
  const yol = degerler.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const s = secili === null ? null : secili === 0 ? { ad: 'Başlangıç', v: t.baslangic } : { ad: haftaMetni(t.haftalar[secili - 1]!), v: t.haftalar[secili - 1]!.birikimli };
  const adim = (G - kenar.sol - kenar.sag) / (degerler.length - 1);
  return (
    <figure className="nakit-grafik" ref={kutu} onMouseLeave={() => setSecili(null)}>
      <svg viewBox={`0 0 ${G} ${Y}`} role="img" aria-label="Haftalık birikimli bakiye; ayrıntılar aşağıdaki tabloda">
        <line x1={kenar.sol} x2={G - kenar.sag} y1={y(0)} y2={y(0)} className="ng-sifir" />
        {enAz < 0 && <rect x={kenar.sol} y={y(0)} width={G - kenar.sol - kenar.sag} height={y(enAz) - y(0)} className="ng-eksi-alan" />}
        <path d={yol} className="ng-cizgi" />
        {degerler.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={secili === i ? 6 : 4} className={v < 0 ? 'ng-nokta ng-eksi' : 'ng-nokta'} />
        ))}
        {degerler.map((_, i) => (
          <rect
            key={`h${i}`}
            x={x(i) - adim / 2}
            y={0}
            width={adim}
            height={Y}
            fill="transparent"
            onMouseEnter={() => setSecili(i)}
            onClick={() => setSecili(i)}
          />
        ))}
        <text x={kenar.sol} y={Y - 6} className="ng-etiket">
          Bugün
        </text>
        <text x={G - kenar.sag} y={Y - 6} className="ng-etiket" textAnchor="end">
          {tarihKisa(t.haftalar.at(-1)!.bitis)}
        </text>
        <text x={G - kenar.sag} y={y(0) - 4} className="ng-etiket" textAnchor="end">
          0 TL
        </text>
      </svg>
      <figcaption className="soluk kucuk">
        {s ? (
          <>
            {s.ad}: <strong className={s.v < 0 ? 'hata' : undefined}>{tlYaz(s.v)}</strong>
          </>
        ) : (
          'Haftalık bakiye (hafta sonunda). Noktaya dokunun ya da üzerine gelin.'
        )}
      </figcaption>
    </figure>
  );
}

function KalemListesi({ kalemler }: { kalemler: NakitKalemi[] }) {
  return (
    <ul className="nakit-kalemleri">
      {kalemler.map((k, i) => (
        <li key={i}>
          <a href={`#/${k.yol}`}>
            <span className={k.yon === 'giris' ? 'vade-giris' : 'vade-cikis'} role="img" aria-label={k.yon === 'giris' ? 'Giriş' : 'Çıkış'}>
              <Simge ad={k.yon === 'giris' ? 'tahsilat' : 'odeme'} />
            </span>
            <span className="nk-bilgi">
              <strong>{k.baslik}</strong>
              <span className="soluk">
                {NAKIT_KAYNAGI_ADI[k.kaynak]}
                {PLANLI_KAYNAKLAR.has(k.kaynak) ? ' (planlı)' : ''} · {k.ayrinti}
                {k.tarih ? ` · ${tarihKisa(k.tarih)}` : ''}
              </span>
            </span>
            <strong className={k.yon === 'giris' ? 'vade-giris' : 'vade-cikis'}>
              {k.yon === 'giris' ? '+' : '−'}
              {tlYaz(k.tutar)}
            </strong>
          </a>
        </li>
      ))}
    </ul>
  );
}

function satirAdi(h: NakitHaftasi) {
  return `${tarihKisa(h.baslangic)} – ${tarihKisa(h.bitis)}`;
}

function excelSayfalari(firmaAdi: string, t: NakitTahmini, bugun: string): ExcelSayfasi[] {
  const tl = (n: number) => ({ tl: n });
  const tumKalemler: [string, NakitKalemi][] = [
    ...t.gecikmis.kalemler.map((k) => ['Vadesi geçmiş', k] as [string, NakitKalemi]),
    ...t.vadesiz.kalemler.map((k) => ['Vadesiz', k] as [string, NakitKalemi]),
    ...t.haftalar.flatMap((h) => h.kalemler.map((k) => [satirAdi(h), k] as [string, NakitKalemi])),
  ];
  return [
    {
      ad: 'Haftalık',
      ust: [`${firmaAdi} · Nakit tahmini`, `Hazırlanma: ${new Date(`${bugun}T00:00`).toLocaleDateString('tr-TR')} · Kasa ve banka: ${tlYaz(t.kasaBanka)}`],
      basliklar: ['Hafta', 'Giriş', 'Çıkış', 'Net', 'Bakiye'],
      satirlar: [
        ['Başlangıç (gecikmiş ve vadesiz düşüldü)', null, tl(t.gecikmis.cikis + t.vadesiz.cikis), null, tl(t.baslangic)],
        ...t.haftalar.map((h) => [satirAdi(h), tl(h.giris), tl(h.cikis), tl(h.giris - h.cikis), tl(h.birikimli)]),
      ],
    },
    {
      ad: 'Kalemler',
      basliklar: ['Dönem', 'Tarih', 'Yön', 'Kaynak', 'Kim', 'Açıklama', 'Tutar'],
      satirlar: tumKalemler.map(([d, k]) => [
        d,
        k.tarih ? { tarih: k.tarih } : null,
        k.yon === 'giris' ? 'Giriş' : 'Çıkış',
        `${NAKIT_KAYNAGI_ADI[k.kaynak]}${PLANLI_KAYNAKLAR.has(k.kaynak) ? ' (planlı)' : ''}`,
        k.baslik,
        k.ayrinti,
        tl(k.yon === 'giris' ? k.tutar : -k.tutar),
      ]),
    },
  ];
}

export function NakitTahminiEkrani() {
  const { firma } = useUygulama();
  const yetki = useYetki();
  const n = useNakitKalemleri();
  const bugun = yerelGun(new Date());
  const [planli, setPlanli] = useState(true);
  const [gecikmisTahsilat, setGecikmisTahsilat] = useState(false);
  const [acik, setAcik] = useState<string | null>(null);
  const t = useMemo(() => (n ? nakitTahmini(n.kalemler, n.kasaBanka, bugun, { planli, gecikmisTahsilat }) : null), [n, bugun, planli, gecikmisTahsilat]);

  if (!yetki('kasa') && !yetki('rapor') && !yetki('odeme')) return <p>Bu ekran için kasa, ödeme ya da rapor yetkisi gerekir.</p>;
  if (!n || !t) return <p>Yükleniyor…</p>;
  const uyari = acikMetni(t, bugun);
  const toplamGiris = t.haftalar.reduce((s, h) => s + h.giris, 0);
  const toplamCikis = t.haftalar.reduce((s, h) => s + h.cikis, 0);
  const dilimSatiri = (anahtar: string, ad: string, d: NakitDilimi, not: string) =>
    d.kalemler.length > 0 && (
      <Fragment key={anahtar}>
        <tr className="nt-satir" onClick={() => setAcik(acik === anahtar ? null : anahtar)}>
          <th scope="row">
            <button type="button" className="baglanti-dugmesi" aria-expanded={acik === anahtar}>
              {ad}
            </button>
            {not && <span className="nt-not soluk">{not}</span>}
          </th>
          <td className="vade-giris">{d.giris ? tlKisa(d.giris) : '—'}</td>
          <td className="vade-cikis">{d.cikis ? tlKisa(d.cikis) : '—'}</td>
          <td />
        </tr>
        {acik === anahtar && (
          <tr>
            <td colSpan={4}>
              <KalemListesi kalemler={d.kalemler} />
            </td>
          </tr>
        )}
      </Fragment>
    );

  return (
    <>
      <div className="baslik-satiri baslik-sarar">
        <h1>Nakit tahmini</h1>
        <AktarmaDugmeleri dosyaAdi={`${firma.ad} nakit tahmini`} sayfalar={() => excelSayfalari(firma.ad, t, bugun)} />
      </div>
      <p className="soluk">
        Önümüzdeki 13 hafta: kasa ve bankadaki paradan başlayarak kayıtlı ödeme ve tahsilatlar, usta sözleşmelerinin ödeme planı, arsa
        sahibine ödemeler ve rezerve satışların planı.
      </p>

      {uyari ? (
        <div className="kart nakit-uyari onem-kenar-acil" role="alert">
          <strong>
            <Simge ad="uyari" /> {uyari.baslik}
          </strong>
          <span>{uyari.ayrinti} Tahsilatları hızlandırmak ya da ödemeleri ötelemek gerekebilir.</span>
        </div>
      ) : (
        <div className="kart nakit-uyari nakit-iyi">
          <strong>13 hafta içinde bakiye eksiye düşmüyor.</strong>
          <span>En düşük bakiye {tlYaz(t.enDusuk.tutar)}{t.enDusuk.hafta ? ` (${haftaMetni(t.enDusuk.hafta)})` : ''}.</span>
        </div>
      )}

      <div className="yazdirma-gizle nakit-secenekler">
        <label className="onay-kutusu">
          <input type="checkbox" checked={planli} onChange={(e) => setPlanli(e.target.checked)} />
          Planlı kalemleri say (sözleşme planı, arsa sahibi, rezerve satış)
        </label>
        <label className="onay-kutusu">
          <input type="checkbox" checked={gecikmisTahsilat} onChange={(e) => setGecikmisTahsilat(e.target.checked)} />
          Vadesi geçmiş tahsilatlar hemen gelecekmiş gibi say
        </label>
      </div>

      <section className="kart kz-ozet">
        <div className="kz-kutular">
          <div>
            <span className="soluk">Kasa ve banka (şimdi)</span>
            <strong>{tlYaz(t.kasaBanka)}</strong>
          </div>
          {t.gecikmis.cikis + t.vadesiz.cikis > 0 && (
            <div>
              <span className="soluk">Vadesi geçmiş ve vadesiz ödenecek</span>
              <strong className="vade-cikis">−{tlYaz(t.gecikmis.cikis + t.vadesiz.cikis)}</strong>
            </div>
          )}
          <div>
            <span className="soluk">13 haftada girecek</span>
            <strong className="vade-giris">+{tlYaz(toplamGiris)}</strong>
          </div>
          <div>
            <span className="soluk">13 haftada çıkacak</span>
            <strong className="vade-cikis">−{tlYaz(toplamCikis)}</strong>
          </div>
          <div>
            <span className="soluk">13. hafta sonunda</span>
            <strong className={t.haftalar.at(-1)!.birikimli < 0 ? 'hata' : undefined}>{tlYaz(t.haftalar.at(-1)!.birikimli)}</strong>
          </div>
          {(t.planliCikis > 0 || t.planliGiris > 0) && (
            <small className="soluk">
              Planlı: çıkış {tlYaz(t.planliCikis)}, giriş {tlYaz(t.planliGiris)}
            </small>
          )}
        </div>
      </section>

      <section className="kart">
        <Grafik t={t} />
      </section>

      <section className="kart">
        <h2>Haftalar</h2>
        <div className="tablo-kaydir">
          <table className="veri-tablosu nakit-tablosu">
            <thead>
              <tr>
                <th scope="col">Hafta başı</th>
                <th scope="col">Giriş ₺</th>
                <th scope="col">Çıkış ₺</th>
                <th scope="col">Bakiye ₺</th>
              </tr>
            </thead>
            <tbody>
              {dilimSatiri('gecikmis', 'Vadesi geçmiş', t.gecikmis, gecikmisTahsilat ? '' : '(tahsilatlar sayılmadı)')}
              {dilimSatiri('vadesiz', 'Vadesiz faturalar', t.vadesiz, '(hemen ödenecek sayıldı)')}
              <tr className="nt-baslangic">
                <th scope="row">Başlangıç</th>
                <td />
                <td />
                <td className={t.baslangic < 0 ? 'hata' : undefined}>
                  <strong>{tlKisa(t.baslangic)}</strong>
                </td>
              </tr>
              {t.haftalar.map((h) => {
                const anahtar = `h${h.no}`;
                const negatif = h.birikimli < 0;
                return (
                  <Fragment key={anahtar}>
                    <tr className={`nt-satir${negatif ? ' nt-eksi' : ''}`} onClick={() => h.kalemler.length && setAcik(acik === anahtar ? null : anahtar)}>
                      <th scope="row">
                        {h.kalemler.length ? (
                          <button type="button" className="baglanti-dugmesi" aria-expanded={acik === anahtar} title={satirAdi(h)}>
                            {tarihKisa(h.baslangic)}
                          </button>
                        ) : (
                          <span title={satirAdi(h)}>{tarihKisa(h.baslangic)}</span>
                        )}
                        {h === t.ilkAcik && (
                          <span className="onem-etiketi onem-acil">
                            <Simge ad="uyari" boyut={12} /> açık
                          </span>
                        )}
                      </th>
                      <td className="vade-giris">{h.giris ? tlKisa(h.giris) : '—'}</td>
                      <td className="vade-cikis">{h.cikis ? tlKisa(h.cikis) : '—'}</td>
                      <td className={negatif ? 'hata' : undefined}>
                        <strong>{tlKisa(h.birikimli)}</strong>
                      </td>
                    </tr>
                    {acik === anahtar && (
                      <tr>
                        <td colSpan={4}>
                          <KalemListesi kalemler={h.kalemler} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {(t.sonrasi.giris > 0 || t.sonrasi.cikis > 0) && (
          <p className="soluk kucuk">
            13 haftadan sonrası: giriş {tlYaz(t.sonrasi.giris)}, çıkış {tlYaz(t.sonrasi.cikis)}.
          </p>
        )}
        {n.kosulluArsa > 0 && <p className="soluk kucuk">Arsa sahibine koşula bağlı {tlYaz(n.kosulluArsa)} nakit ödeme tarihi belli olmadığı için tahmine girmedi.</p>}
        <p className="soluk kucuk">
          Tahmine girmeyenler: sabit giderler (kira, maaş), henüz sözleşmesi ya da faturası olmayan harcamalar, KDV ve tevkifat ödemeleri.
        </p>
      </section>
    </>
  );
}
