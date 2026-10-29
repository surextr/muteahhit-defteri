import { useEffect, useState } from 'react';
import { ayAdi, type FirmaRaporu, type KarZarar, type NakitAyi } from '../hesap/karZarar';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { projeGetir } from '../servisler/proje';
import { firmaRaporuGetir, karZararGetir } from '../servisler/rapor';
import type { Proje } from '../veri/tipler';
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
        <a href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <h1>Kâr / zarar</h1>

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
          <div className={kar.tahmini < 0 ? 'kz-zarar' : 'kz-kar'}>
            <span className="soluk">{kar.tahmini < 0 ? 'Tahmini zarar' : 'Tahmini kâr'}</span>
            <strong>{tl(Math.abs(kar.tahmini))}</strong>
            {kar.marj !== null && <small>{yuzde(kar.marj)} marj</small>}
          </div>
        </div>
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
  const enDusuk = r.aylar.reduce<NakitAyi | null>((m, a) => (!m || a.birikimli < m.birikimli ? a : m), null);

  return (
    <>
      <p>
        <a href="#/projeler">← Projeler</a>
      </p>
      <h1>Firma raporu</h1>

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
          <div className={r.kar < 0 ? 'kz-zarar' : 'kz-kar'}>
            <span className="soluk">{r.kar < 0 ? 'Tahmini zarar' : 'Tahmini kâr'}</span>
            <strong>{tl(Math.abs(r.kar))}</strong>
            {r.marj !== null && <small>{yuzde(r.marj)} marj</small>}
          </div>
        </div>
        <p className="mesaj-not">
          {r.projeler.length} proje{erisim ? ' (erişiminiz olanlar)' : ''}; genel giderler (projesiz) {tl(r.genel.harcanan)} maliyete eklendi. Gelir KDV hariç,
          maliyet {kdvDahil ? 'KDV dahil' : 'KDV hariç'}.
        </p>
      </section>

      <section className="kart">
        <h2>Projeler</h2>
        {r.projeler.length === 0 ? (
          <p className="soluk">Proje yok.</p>
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
