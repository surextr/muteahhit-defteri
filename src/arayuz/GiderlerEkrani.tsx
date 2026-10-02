import { useCallback, useEffect, useState } from 'react';
import { tevkifatYaz } from '../hesap/gider';
import { tlYaz } from '../hesap/para';
import { sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import { kayitGecmisiGetir, type GecmisSatiri } from '../servisler/gecmis';
import { giderDetayiGetir, giderIptal, giderleriListele, type GiderDetayi, type GiderOzeti } from '../servisler/gider';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { useUygulama } from './baglam';
import { Hatalar, useGerekceliDegisiklik } from './bilesenler';
import { GecmisListesi, type AlanBicimi } from './GecmisListesi';
import { GiderFormu } from './GiderFormu';
import { git } from './rota';

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');

// ─── Hızlı kayıt menüsü ────────────────────────────────────────────

export function KayitEkrani() {
  return (
    <>
      <h1>Yeni kayıt</h1>
      <ul className="kayit-secenekleri">
        <li>
          <a className="kart kart-baglanti" href="#/giderler/yeni">
            <strong>🧾 Gider / alış</strong>
            <span className="soluk">Fatura, fiş, malzeme, işçilik</span>
          </a>
        </li>
        <li>
          <a className="kart kart-baglanti" href="#/odemeler/yeni">
            <strong>↗ Ödeme</strong>
            <span className="soluk">Tedarikçi ve ustaya; açık borçlara dağıtılır</span>
          </a>
        </li>
        <li>
          <a className="kart kart-baglanti" href="#/odemeler/tahsilat">
            <strong>↙ Tahsilat</strong>
            <span className="soluk">Cariden gelen para, ortak sermayesi, kredi</span>
          </a>
        </li>
        <li>
          <a className="kart kart-baglanti" href="#/hesaplar/transfer">
            <strong>⇄ Transfer</strong>
            <span className="soluk">Kasa, banka ve kart arasında; kart borcu ödemesi</span>
          </a>
        </li>
      </ul>
      <h2 className="ara-baslik">Listeler</h2>
      <ul className="kayit-secenekleri">
        <li>
          <a className="kart kart-baglanti" href="#/giderler">
            <strong>Giderler</strong>
            <span className="soluk">Ödenmemiş ve vadesi geçenler</span>
          </a>
        </li>
      </ul>
    </>
  );
}

// ─── Liste ─────────────────────────────────────────────────────────

export function GiderlerEkrani({ projeId }: { projeId?: string }) {
  const { depo, oturum } = useUygulama();
  const [projeler, setProjeler] = useState<ProjeOzeti[]>([]);
  const [proje, setProje] = useState(projeId ?? '');
  const [odenmemis, setOdenmemis] = useState(false);
  const [giderler, setGiderler] = useState<GiderOzeti[] | null>(null);

  useEffect(() => {
    void projeleriListele(depo, oturum.firmaId).then(setProjeler);
  }, [depo, oturum.firmaId]);

  useEffect(() => {
    setGiderler(null);
    void giderleriListele(depo, oturum.firmaId, { projeId: proje || undefined, yalnizcaOdenmemis: odenmemis }, yerelGun(new Date())).then(
      setGiderler,
    );
  }, [depo, oturum.firmaId, proje, odenmemis]);

  const toplamKalan = (giderler ?? []).reduce((t, g) => t + g.kalan, 0);
  const vadesiGecen = (giderler ?? []).filter((g) => g.vadesiGecti);

  return (
    <>
      <div className="baslik-satiri">
        <h1>Giderler</h1>
        <button type="button" onClick={() => git(proje ? `giderler/yeni/${proje}` : 'giderler/yeni')}>
          + Gider
        </button>
      </div>
      <select className="arama" value={proje} onChange={(e) => setProje(e.target.value)} aria-label="Proje">
        <option value="">Bütün projeler ve genel giderler</option>
        {projeler.map(({ proje: p }) => (
          <option key={p.id} value={p.id}>
            {p.ad}
          </option>
        ))}
      </select>
      <div className="filtreler" role="group" aria-label="Süzgeç">
        <button type="button" aria-pressed={!odenmemis} onClick={() => setOdenmemis(false)}>
          Tümü
        </button>
        <button type="button" aria-pressed={odenmemis} onClick={() => setOdenmemis(true)}>
          Ödenmemiş
        </button>
      </div>
      {giderler === null && <p>Yükleniyor…</p>}
      {giderler && (
        <p className="ozet-satiri">
          <span>
            Ödenmemiş <strong className="bakiye-borc">{tlYaz(toplamKalan)}</strong>
          </span>
          {vadesiGecen.length > 0 && (
            <span>
              Vadesi geçen <strong className="bakiye-borc">{vadesiGecen.length}</strong>
            </span>
          )}
        </p>
      )}
      {giderler?.length === 0 && <p className="soluk">Kayıt yok.</p>}
      <ul className="kart-listesi">
        {giderler?.map((g) => (
          <li key={g.gider.id}>
            <a className="kart kart-baglanti" href={`#/giderler/${g.gider.id}`}>
              <span className="baslik-satiri">
                <strong>{g.cariAdi ?? 'Carisiz (peşin)'}</strong>
                <span className="bakiye">{tlYaz(g.gider.toplam)}</span>
              </span>
              <span className="soluk">
                {tarihYaz(g.gider.tarih)} · {g.projeAdi ?? 'Genel gider'}
                {g.gider.faturaNo && ` · ${g.gider.faturaNo}`}
              </span>
              {g.kalan > 0 ? (
                <span className={g.vadesiGecti ? 'bakiye-borc' : undefined}>
                  Kalan {tlYaz(g.kalan)}
                  {g.gider.vadeTarihi && ` · vade ${tarihYaz(g.gider.vadeTarihi)}`}
                  {g.vadesiGecti && ' · vadesi geçti'}
                </span>
              ) : (
                <span className="bakiye-alacak">Ödendi</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

// ─── Detay ─────────────────────────────────────────────────────────

const GIDER_BICIMI: AlanBicimi = {
  etiketler: {
    tarih: 'Tarih',
    projeId: 'Proje',
    cariId: 'Cari',
    faturaNo: 'Fatura no',
    vadeTarihi: 'Vade',
    aciklama: 'Açıklama',
    kdvHaricToplam: 'KDV hariç',
    kdvToplam: 'KDV',
    toplam: 'Fatura toplamı',
    tevkifatToplam: 'Tevkifat',
  },
  degerYaz: (alan, d) => {
    if (['kdvHaricToplam', 'kdvToplam', 'toplam', 'tevkifatToplam'].includes(alan) && typeof d === 'number') return tlYaz(d);
    if ((alan === 'projeId' || alan === 'cariId') && typeof d === 'string') return 'değişti';
    return undefined;
  },
};

export function GiderDetay({ giderId, duzenle }: { giderId: string; duzenle: boolean }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  /** undefined: okunuyor, null: bulunamadı */
  const [detay, setDetay] = useState<GiderDetayi | null | undefined>(undefined);
  const [gecmis, setGecmis] = useState<GecmisSatiri[]>([]);
  const [iptalSoruluyor, setIptalSoruluyor] = useState(false);
  const [odemelerDeIptal, setOdemelerDeIptal] = useState(false);

  const yenile = useCallback(async () => {
    const [d, g] = await Promise.all([
      giderDetayiGetir(depo, oturum.firmaId, giderId, yerelGun(new Date())),
      kayitGecmisiGetir(depo, oturum.firmaId, giderId),
    ]);
    setDetay(d);
    setGecmis(g);
  }, [depo, oturum.firmaId, giderId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  if (detay === undefined) return <p>Yükleniyor…</p>;
  if (detay === null) return <p className="hata">Gider bulunamadı ya da iptal edilmiş.</p>;
  if (duzenle) return <GiderFormu duzenlenen={detay} />;

  const { gider } = detay;
  const odenen = detay.borc - detay.kalan;

  return (
    <>
      <p>
        <a href={gider.projeId ? `#/giderler/proje/${gider.projeId}` : '#/giderler'}>← Giderler</a>
      </p>
      <h1>{detay.cariAdi ?? 'Carisiz alış'}</h1>

      <section className="kart">
        <dl className="bilgi">
          <dt>Tarih</dt>
          <dd>{tarihYaz(gider.tarih)}</dd>
          <dt>Proje</dt>
          <dd>{gider.projeId ? <a href={`#/projeler/${gider.projeId}`}>{detay.projeAdi}</a> : 'Şirket genel gideri'}</dd>
          {gider.cariId && (
            <div className="bilgi-satir">
              <dt>Cari</dt>
              <dd>
                <a href={`#/cariler/${gider.cariId}`}>{detay.cariAdi}</a>
              </dd>
            </div>
          )}
          {gider.faturaNo && (
            <div className="bilgi-satir">
              <dt>Fatura no</dt>
              <dd>{gider.faturaNo}</dd>
            </div>
          )}
          {gider.vadeTarihi && (
            <div className="bilgi-satir">
              <dt>Vade</dt>
              <dd className={detay.vadesiGecti ? 'bakiye-borc' : undefined}>{tarihYaz(gider.vadeTarihi)}</dd>
            </div>
          )}
          {gider.aciklama && (
            <div className="bilgi-satir">
              <dt>Açıklama</dt>
              <dd>{gider.aciklama}</dd>
            </div>
          )}
        </dl>
        <div className="dugmeler">
          <a className="dugme ikincil" href={`#/giderler/${gider.id}/duzenle`}>
            Düzenle
          </a>
          <a className="dugme ikincil" href={gider.projeId ? `#/giderler/yeni/${gider.projeId}` : '#/giderler/yeni'}>
            + Yeni gider
          </a>
        </div>
      </section>

      <section className="kart">
        <h2>Satırlar</h2>
        <ul className="liste">
          {detay.satirlar.map((s) => (
            <li key={s.id} className="satir-blok">
              <div className="ekstre-satir">
                <div>
                  <strong>{s.kalemAdi ?? 'Kalemsiz'}</strong>
                  <div className="soluk">
                    {[
                      s.aciklama,
                      s.miktar !== null ? `${sayiYaz(s.miktar)} ${s.birim ?? ''} × ${tlYaz(s.birimFiyat ?? 0)}` : '',
                      `KDV %${s.kdvOrani}`,
                      s.tevkifat ? `tevkifat ${tevkifatYaz(s.tevkifat)}` : '',
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="ekstre-tutar">
                  <strong>{tlYaz(s.toplam)}</strong>
                  <div className="soluk">{tlYaz(s.kdvHaricTutar)} + KDV</div>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <dl className="bilgi toplam-tablosu">
          <dt>KDV hariç</dt>
          <dd>{tlYaz(gider.kdvHaricToplam)}</dd>
          <dt>KDV</dt>
          <dd>{tlYaz(gider.kdvToplam)}</dd>
          <dt>Fatura toplamı</dt>
          <dd>
            <strong>{tlYaz(gider.toplam)}</strong>
          </dd>
          {gider.tevkifatToplam > 0 && (
            <div className="bilgi-satir">
              <dt>Tevkif edilen KDV</dt>
              <dd>
                {tlYaz(gider.tevkifatToplam)}{' '}
                <span className="soluk">
                  (vergi dairesine; {detay.tevkifatKalan === 0 ? 'ödendi' : detay.tevkifatKalan < gider.tevkifatToplam ? `kalan ${tlYaz(detay.tevkifatKalan)}` : 'ödenmedi'})
                </span>
              </dd>
            </div>
          )}
        </dl>
      </section>

      <section className="kart">
        <h2>Ödeme durumu</h2>
        <dl className="bilgi">
          <dt>{gider.cariId ? 'Cariye borç' : 'Tutar'}</dt>
          <dd>{tlYaz(detay.borc)}</dd>
          <dt>Ödenen</dt>
          <dd>{tlYaz(odenen)}</dd>
          <dt>Kalan</dt>
          <dd className={detay.kalan > 0 ? 'bakiye-borc' : 'bakiye-alacak'}>
            <strong>{detay.kalan > 0 ? tlYaz(detay.kalan) : 'Ödendi'}</strong>
          </dd>
        </dl>
        {gider.cariId && detay.kalan > 0 && (
          <a className="dugme" href={`#/odemeler/yeni/${gider.cariId}/${gider.id}`}>
            Ödeme yap
          </a>
        )}
        {detay.odemeler.length > 0 && (
          <ul className="liste">
            {detay.odemeler.map(({ eslestirme, odeme, hesapAdi }) => (
              <li key={eslestirme.id}>
                <a href={`#/odemeler/${odeme.id}`}>
                  {tarihYaz(odeme.tarih)} · {hesapAdi ?? odeme.yontem}
                </a>
                <strong>{tlYaz(eslestirme.tutar)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="kart">
        <h2>Gideri iptal et</h2>
        <p className="soluk">Kayıt silinmez; maliyet ve borç hesaplardan çıkar, geçmişte görünür.</p>
        {kutu}
        <Hatalar hatalar={hata ? [hata] : []} />
        {iptalSoruluyor ? (
          <div className="mesaj mesaj-uyari" role="alertdialog" aria-labelledby="gider-iptal-baslik">
            <h3 id="gider-iptal-baslik">Bu gider iptal edilsin mi?</h3>
            {gider.cariId && detay.odemeler.length > 0 && (
              <label className="onay-kutusu">
                <input type="checkbox" checked={odemelerDeIptal} onChange={(e) => setOdemelerDeIptal(e.target.checked)} /> Bağlı ödemeler de
                iptal edilsin (para hesaba geri döner). İşaretlenmezse ödeme cariye avans olarak kalır.
              </label>
            )}
            {!gider.cariId && detay.odemeler.length > 0 && <p>Peşin ödemesi de iptal edilir; para hesaba geri döner.</p>}
            <div className="dugmeler">
              <button
                type="button"
                className="tehlikeli"
                onClick={() => {
                  setIptalSoruluyor(false);
                  void degistir(gider, 'Gider iptal ediliyor', async (g) => {
                    await giderIptal(depo, servis, gider.id, g, odemelerDeIptal);
                    git(gider.projeId ? `giderler/proje/${gider.projeId}` : 'giderler');
                  });
                }}
              >
                Evet, iptal et
              </button>
              <button type="button" className="ikincil" onClick={() => setIptalSoruluyor(false)}>
                Hayır
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="ikincil" onClick={() => setIptalSoruluyor(true)}>
            İptal et
          </button>
        )}
      </section>

      {gecmis.length > 1 && (
        <section className="kart">
          <h2>Değişiklik geçmişi</h2>
          <GecmisListesi satirlar={gecmis} bicim={GIDER_BICIMI} />
        </section>
      )}
    </>
  );
}
