import { BosDurum } from './bilesenler';
import { AktarmaDugmeleri } from './Aktarma';
import type { ExcelSayfasi, Hucre } from '../hesap/excel';
import { useEffect, useState } from 'react';
import { ayAdi, type FirmaRaporu, type KarZarar, type NakitAyi } from '../hesap/karZarar';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { projeGetir } from '../servisler/proje';
import { firmaRaporuGetir, karZararGetir } from '../servisler/rapor';
import type { Kurus, Proje } from '../veri/tipler';
import { useProjeErisimi, useUygulama } from './baglam';

/** Kuruşsuz kısa tutar: "₺1.250.000". */
const tl = (k: number) => tlYaz(Math.round(k / 100) * 100).replace(/,00$/, '');
const yuzde = (n: number) => `%${n.toLocaleString('tr-TR', { maximumFractionDigits: 1 })}`;

function Satir({ ad, deger, aciklama, sinif }: { ad: string; deger: string; aciklama?: string; sinif?: string }) {
  return (
    <div className="kz-satir">
      <dt>
        {ad}
        {aciklama && <small className="blok soluk">{aciklama}</small>}
      </dt>
      <dd className={sinif}>{deger}</dd>
    </div>
  );
}

export function KarZararEkrani({ projeId }: { projeId: string }) {
  const { depo, oturum, firma } = useUygulama();
  const [proje, setProje] = useState<Proje | null | undefined>(undefined);
  const [r, setR] = useState<KarZarar | null>(null);
  const kdvDahil = firma.ayarlar.kdvMaliyeteDahil;

  useEffect(() => {
    void Promise.all([projeGetir(depo, oturum.firmaId, projeId), karZararGetir(depo, oturum.firmaId, projeId, kdvDahil, yerelGun(new Date()))]).then(
      ([p, x]) => {
        setProje(p ?? null);
        setR(x);
      },
    );
  }, [depo, oturum.firmaId, projeId, kdvDahil]);

  if (proje === undefined || !r) return <p>Yükleniyor…</p>;
  if (proje === null) return <p className="hata">Proje bulunamadı.</p>;
  const { gelir, maliyet, kar, nakit } = r;
  const kdv = kdvDahil ? 'KDV dahil' : 'KDV hariç';

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <div className="baslik-satiri">
        <h1>Kâr / zarar · {proje.ad}</h1>
        <AktarmaDugmeleri dosyaAdi={`${proje.ad} kâr zarar`} sayfalar={() => karZararSayfalari(proje.ad, r, kdv)} />
      </div>

      <section className="kart kz-ozet">
        <div className="kz-kutular">
          <div>
            <span className="soluk">Tahmini gelir</span>
            <strong>{tl(gelir.tahmini)}</strong>
          </div>
          <div>
            <span className="soluk">Tahmini maliyet</span>
            <strong>{tl(maliyet.tahmini)}</strong>
          </div>
          <div className={kar.eksikler.length ? 'kz-eksik' : kar.tahmini < 0 ? 'kz-zarar' : 'kz-kar'}>
            <span className="soluk">
              {kar.tahmini < 0 ? 'Tahmini zarar' : 'Tahmini kâr'}
              {kar.eksikler.length > 0 && ' (eksik veriyle)'}
            </span>
            <strong>{tl(Math.abs(kar.tahmini))}</strong>
            {kar.marj !== null && <small>{yuzde(kar.marj)} marj</small>}
          </div>
        </div>
        {kar.eksikler.length > 0 && (
          <div className="mesaj mesaj-uyari">
            <strong>Bu tahmin eksik veriye dayanıyor; sonuç olarak okunmamalı.</strong>
            <ul>
              {kar.eksikler.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        <p className="ozet-tutar">
          <span>
            Gerçekleşen (bugüne kadar)
            <br />
            <span className="soluk kucuk">İmzalı satışlar + ilave imalat − harcanan; tahmin içermez</span>
          </span>
          <strong className={kar.gerceklesen < 0 ? 'bakiye-borc' : undefined}>{tl(kar.gerceklesen)}</strong>
        </p>
        {kar.basabasBolumBasina !== null && gelir.satilmamis.adet > 0 && (
          <p className="mesaj-not">
            {kar.basabasIcinGereken === 0
              ? 'Satılan ve rezerve daireler tahmini maliyeti karşılıyor; kalan satışlar kârdır.'
              : `Başa baş için satılmamış ${gelir.satilmamis.adet} bölümden toplam ${tl(kar.basabasIcinGereken)} (bölüm başına ortalama ${tl(kar.basabasBolumBasina)}, KDV hariç) gerekir.`}
          </p>
        )}
        {maliyet.butcesizKalemVar && <p className="mesaj-not">Bütçesi girilmemiş kalemler var; tahmini maliyet şimdiye kadarki harcamayla sınırlı kalır.</p>}
      </section>

      <section className="kart">
        <h2>Gelir (KDV hariç)</h2>
        <dl className="kz-liste">
          <Satir
            ad={`İmzalı satışlar (${gelir.imzali.adet})`}
            deger={tl(gelir.imzali.kdvHaric)}
            aciklama={gelir.imzali.takas > 0 ? `${tl(gelir.imzali.takas)} takas dahil` : undefined}
          />
          {gelir.rezerve.adet > 0 && <Satir ad={`Rezerve (${gelir.rezerve.adet})`} deger={tl(gelir.rezerve.kdvHaric)} aciklama="Protokolü henüz imzalanmadı" />}
          {gelir.ilaveImalat > 0 && <Satir ad="İlave imalat" deger={tl(gelir.ilaveImalat)} aciklama="Arsa sahibinden alacak" />}
          <Satir
            ad={`Satılmamış (${gelir.satilmamis.adet})`}
            deger={gelir.satilmamis.tahmin === null ? '—' : `≈ ${tl(gelir.satilmamis.tahmin)}`}
            aciklama={
              gelir.satilmamis.adet === 0
                ? undefined
                : gelir.satilmamis.yontem === 'm2'
                  ? 'İmzalı satışların brüt m² ortalamasıyla tahmin'
                  : gelir.satilmamis.yontem === 'adet'
                    ? 'İmzalı satışların daire başı ortalamasıyla tahmin'
                    : 'İmzalı satış olunca tahmin edilir'
            }
          />
          {gelir.arsaSahibiAdet > 0 && <Satir ad={`Arsa sahibine (${gelir.arsaSahibiAdet})`} deger="—" aciklama="Kat karşılığı; gelir doğurmaz" />}
          <Satir ad="Toplam" deger={tl(gelir.tahmini)} sinif="kz-toplam" />
        </dl>
      </section>

      <section className="kart">
        <h2>Maliyet ({kdv})</h2>
        <dl className="kz-liste">
          <Satir ad="Bütçe" deger={tl(maliyet.butce)} />
          <Satir ad="Harcanan" deger={tl(maliyet.gerceklesen)} />
          <Satir ad="Kalan (tahmini)" deger={tl(maliyet.kalan)} aciklama="Bütçenin harcanmamış kısmı; aşılan kalemde aşım tahmine eklenir" />
          <Satir ad="Toplam" deger={tl(maliyet.tahmini)} sinif="kz-toplam" />
        </dl>
        <p className="mesaj-not">
          Bu tahmin bütçeye dayanır. İlerlemeye ve imzalı sözleşmelere göre güncel tahmin:{' '}
          <a href={`#/projeler/${projeId}/is-sonu`}>İş sonu tahmini</a>
        </p>
        <p className="mesaj-not">
          Ayar: <a href="#/ayarlar">Ayarlar → Maliyet ve KDV</a>. Satışın KDV'si devlete ödendiği için gelir KDV hariç alınır.
        </p>
      </section>

      <section className="kart">
        <h2>Nakit</h2>
        <dl className="kz-liste">
          <Satir ad="Tahsil edilen" deger={tl(nakit.tahsilEdilen)} aciklama="Satış ve ilave imalat" />
          <Satir ad="Ödenen" deger={tl(nakit.odenen)} aciklama="Proje giderlerine" />
          <Satir ad="Fark" deger={tl(nakit.fark)} sinif={nakit.fark < 0 ? 'bakiye-borc' : 'kz-toplam'} />
          <Satir ad="Bekleyen tahsilat" deger={tl(nakit.bekleyenTahsilat)} />
          <Satir ad="Ödenecek borç" deger={tl(nakit.odenecekBorc)} aciklama="Vadeli ve açık faturalar, hakedişler" />
        </dl>
        {nakit.aylar.some((a) => a.giris || a.cikis) ? (
          <>
            <h3>Önümüzdeki aylar</h3>
            <NakitTablosu aylar={nakit.aylar} />
            <p className="mesaj-not">
              Giriş: satış taksitleri ve ilave imalat alacakları vadesine göre. Çıkış: ödenmemiş faturalar ve hakedişler vadesine göre (vadesizler fatura
              tarihinde). Bütçede kalan, henüz faturası olmayan harcama burada yoktur.
            </p>
          </>
        ) : (
          <p className="soluk">Bekleyen tahsilat ya da ödenecek borç yok.</p>
        )}
      </section>
    </>
  );
}

/** Aylık nakit tablosu (proje ve firma raporunda ortak). */
function NakitTablosu({ aylar, baslangic }: { aylar: NakitAyi[]; baslangic?: number }) {
  return (
    <table className="kz-tablo">
      <thead>
        <tr>
          <th>Ay</th>
          <th>Giriş</th>
          <th>Çıkış</th>
          <th>Birikimli</th>
        </tr>
      </thead>
      <tbody>
        {baslangic !== undefined && (
          <tr>
            <td>Kasa ve banka</td>
            <td>—</td>
            <td>—</td>
            <td className={baslangic < 0 ? 'bakiye-borc' : undefined}>{tl(baslangic)}</td>
          </tr>
        )}
        {aylar.map((a) => (
          <tr key={a.ay} className={a.ay === 'gecmis' ? 'kz-gecmis' : undefined}>
            <td>{ayAdi(a.ay)}</td>
            <td>{a.giris ? tl(a.giris) : '—'}</td>
            <td>{a.cikis ? tl(a.cikis) : '—'}</td>
            <td className={a.birikimli < 0 ? 'bakiye-borc' : undefined}>{tl(a.birikimli)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Firma geneli: bütün projelerin kâr/zararı, genel giderler ve birleşik nakit akışı. */
export function FirmaRaporuEkrani() {
  const { depo, oturum, firma } = useUygulama();
  const erisim = useProjeErisimi();
  const [r, setR] = useState<FirmaRaporu | null>(null);
  const kdvDahil = firma.ayarlar.kdvMaliyeteDahil;

  useEffect(() => {
    void firmaRaporuGetir(depo, oturum.firmaId, kdvDahil, yerelGun(new Date()), erisim).then(setR);
  }, [depo, oturum.firmaId, kdvDahil, erisim]);

  if (!r) return <p>Yükleniyor…</p>;
  const eksikli = r.projeler.filter((p) => p.rapor.kar.eksikler.length > 0);
  const enDusuk = r.aylar.reduce<NakitAyi | null>((m, a) => (!m || a.birikimli < m.birikimli ? a : m), null);

  return (
    <>
      <p>
        <a className="geri-baglanti" href="#/projeler">← Projeler</a>
      </p>
      <div className="baslik-satiri">
        <h1>Firma raporu</h1>
        <AktarmaDugmeleri dosyaAdi={`${firma.ad} firma raporu`} sayfalar={() => firmaRaporuSayfalari(firma.ad, r, kdvDahil ? 'KDV dahil' : 'KDV hariç')} />
      </div>
      <p className="yazdirma-gizle">
        <a href="#/nakit">Nakit tahmini</a> · <a href="#/maliyet/alislar">Alış fiyatları (artan kalemler, pahalı alımlar)</a>
      </p>

      <section className="kart kz-ozet">
        <div className="kz-kutular">
          <div>
            <span className="soluk">Tahmini gelir</span>
            <strong>{tl(r.gelir)}</strong>
          </div>
          <div>
            <span className="soluk">Tahmini maliyet</span>
            <strong>{tl(r.maliyet)}</strong>
          </div>
          <div className={eksikli.length ? 'kz-eksik' : r.kar < 0 ? 'kz-zarar' : 'kz-kar'}>
            <span className="soluk">
              {r.kar < 0 ? 'Tahmini zarar' : 'Tahmini kâr'}
              {eksikli.length > 0 && ' (eksik veriyle)'}
            </span>
            <strong>{tl(Math.abs(r.kar))}</strong>
            {r.marj !== null && <small>{yuzde(r.marj)} marj</small>}
          </div>
        </div>
        {eksikli.length > 0 && (
          <p className="mesaj mesaj-uyari">
            Tahmin eksik veriye dayanıyor ({eksikli.map((p) => p.ad).join(', ')}: bütçe ya da satış fiyatı eksik). Ayrıntı projenin kâr/zarar sayfasında.
          </p>
        )}
        <p className="mesaj-not">
          {r.projeler.length} proje{erisim ? ' (erişiminiz olanlar)' : ''}; genel giderler (projesiz) {tl(r.genel.harcanan)} maliyete eklendi. Gelir KDV hariç,
          maliyet {kdvDahil ? 'KDV dahil' : 'KDV hariç'}.
        </p>
      </section>

      <section className="kart">
        <h2>Projeler</h2>
        {r.projeler.length === 0 ? (
          <BosDurum metin="Henüz proje yok." eylemler={[{ yol: 'projeler/yeni', ad: '+ Yeni proje' }]} />
        ) : (
          <table className="kz-tablo">
            <thead>
              <tr>
                <th>Proje</th>
                <th>Kâr</th>
                <th>Marj</th>
                <th>Bekleyen</th>
              </tr>
            </thead>
            <tbody>
              {r.projeler.map((p) => (
                <tr key={p.projeId}>
                  <td>
                    <a href={`#/projeler/${p.projeId}/rapor`}>{p.ad}</a>
                  </td>
                  <td className={p.rapor.kar.tahmini < 0 ? 'bakiye-borc' : undefined}>{tl(p.rapor.kar.tahmini)}</td>
                  <td>{p.rapor.kar.marj === null ? '—' : yuzde(p.rapor.kar.marj)}</td>
                  <td>{tl(p.rapor.nakit.bekleyenTahsilat)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mesaj-not">Bekleyen: satış taksitleri ve ilave imalattan tahsil edilecek. Projeye dokunarak ayrıntısını açın.</p>
      </section>

      <section className="kart">
        <h2>Nakit</h2>
        <dl className="kz-liste">
          <Satir ad="Kasa ve bankada (TL)" deger={tl(r.eldeki)} aciklama="Kredi kartı borcu düşülmüş" />
          <Satir ad="Bekleyen tahsilat" deger={tl(r.bekleyenTahsilat)} />
          <Satir ad="Ödenecek borç" deger={tl(r.odenecekBorc)} aciklama={r.genel.odenecek > 0 ? `${tl(r.genel.odenecek)} genel giderlerden` : undefined} />
        </dl>
        <p className="mesaj-not">
          Haftalık ve planlı ödemelerle (sözleşme planı, arsa sahibi, rezerve satış): <a href="#/nakit">Nakit tahmini</a>
        </p>
        <h3>Önümüzdeki aylar</h3>
        <NakitTablosu aylar={r.aylar} baslangic={r.eldeki} />
        {enDusuk && enDusuk.birikimli < 0 && (
          <p className="mesaj mesaj-uyari">
            {ayAdi(enDusuk.ay)} sonunda kasa {tl(-enDusuk.birikimli)} eksiye düşüyor; o tarihten önce tahsilat ya da finansman gerekir.
          </p>
        )}
        <p className="mesaj-not">Giriş: satış taksitleri ve ilave imalat vadesine göre. Çıkış: ödenmemiş faturalar ve hakedişler. Bütçede kalan, henüz faturası olmayan harcama yoktur.</p>
      </section>
    </>
  );
}

// ─── Excel ───

const ayMetni = (ay: string) => (ay === 'gecmis' ? 'Vadesi geçmiş' : ay === 'sonra' ? 'Sonrası' : ayAdi(ay));
const nakitSayfasi = (aylar: NakitAyi[], ust: string, birikimliBaslik = 'Birikimli'): ExcelSayfasi => ({
  ad: 'Nakit akışı',
  ust: [ust],
  basliklar: ['Ay', 'Giriş', 'Çıkış', 'Net', birikimliBaslik],
  satirlar: aylar.map((a) => [ayMetni(a.ay), { tl: a.giris }, { tl: a.cikis }, { tl: a.net }, { tl: a.birikimli }]),
});

function karZararSayfalari(projeAd: string, r: KarZarar, kdv: string): ExcelSayfasi[] {
  const { gelir, maliyet, kar, nakit } = r;
  const satir = (ad: string, t: Kurus | null, not = ''): Hucre[] => [ad, t === null ? null : { tl: t }, not];
  return [
    {
      ad: 'Özet',
      ust: [`${projeAd} · kâr / zarar`, `Gelir KDV hariç, maliyet ${kdv}.`],
      basliklar: ['Kalem', 'Tutar', 'Not'],
      satirlar: [
        [{ kalin: 'Gelir' }, null, null],
        satir('İmzalı satışlar', gelir.imzali.kdvHaric, `${gelir.imzali.adet} bölüm`),
        satir('Rezerve satışlar', gelir.rezerve.kdvHaric, `${gelir.rezerve.adet} bölüm`),
        satir('İlave imalat', gelir.ilaveImalat),
        satir('Satılmamış (tahmini)', gelir.satilmamis.tahmin, `${gelir.satilmamis.adet} bölüm`),
        [{ kalin: 'Tahmini gelir' }, { tl: gelir.tahmini }, null],
        [{ kalin: 'Maliyet' }, null, null],
        satir('Gerçekleşen', maliyet.gerceklesen),
        satir('Bütçe', maliyet.butce, maliyet.butcesizKalemVar ? 'Bütçesiz kalem var' : ''),
        satir('Kalan (tahmini)', maliyet.kalan),
        [{ kalin: 'Tahmini maliyet' }, { tl: maliyet.tahmini }, null],
        [{ kalin: 'Tahmini kâr' }, { tl: kar.tahmini }, kar.marj === null ? '' : `%${kar.marj.toFixed(1).replace('.', ',')} marj`],
        satir('Başa baş için satılmamışlardan gereken', kar.basabasIcinGereken),
        [{ kalin: 'Nakit' }, null, null],
        satir('Tahsil edilen', nakit.tahsilEdilen),
        satir('Ödenen', nakit.odenen),
        satir('Fark', nakit.fark),
        satir('Bekleyen tahsilat', nakit.bekleyenTahsilat),
        satir('Ödenecek borç', nakit.odenecekBorc),
      ],
    },
    nakitSayfasi(nakit.aylar, `${projeAd} · aylık nakit akışı`),
  ];
}

function firmaRaporuSayfalari(firmaAd: string, r: FirmaRaporu, kdv: string): ExcelSayfasi[] {
  return [
    {
      ad: 'Projeler',
      ust: [`${firmaAd} · firma raporu`, `Gelir KDV hariç, maliyet ${kdv}.`],
      basliklar: ['Proje', 'Tahmini gelir', 'Tahmini maliyet', 'Tahmini kâr', 'Tahsil edilen', 'Ödenen', 'Bekleyen tahsilat', 'Ödenecek borç'],
      satirlar: [
        ...r.projeler.map((p) => [
          p.ad,
          { tl: p.rapor.gelir.tahmini },
          { tl: p.rapor.maliyet.tahmini },
          { tl: p.rapor.kar.tahmini },
          { tl: p.rapor.nakit.tahsilEdilen },
          { tl: p.rapor.nakit.odenen },
          { tl: p.rapor.nakit.bekleyenTahsilat },
          { tl: p.rapor.nakit.odenecekBorc },
        ]),
        ['Genel giderler (projesiz)', null, { tl: r.genel.harcanan }, { tl: -r.genel.harcanan }, null, null, null, { tl: r.genel.odenecek }],
        [{ kalin: 'Toplam' }, { tl: r.gelir }, { tl: r.maliyet }, { tl: r.kar }, { tl: r.tahsilEdilen }, { tl: r.odenen }, { tl: r.bekleyenTahsilat }, { tl: r.odenecekBorc }],
      ],
    },
    nakitSayfasi(r.aylar, `Aylık nakit akışı · başlangıç kasa ve bankadaki ${(r.eldeki / 100).toLocaleString('tr-TR')} TL`, 'Kasa (birikimli)'),
  ];
}
