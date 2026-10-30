import { META_SON_YEDEK } from '../servisler/yedek';
import { Simge, type SimgeAdi } from './Simge';
import { META_BULUT } from '../servisler/kurulum';
import { useEffect, useState } from 'react';
import { toplam, vadeGorunur, vadeMetni, type VadeKalemi, type VadeTuru } from '../hesap/bugun';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { genelArama, type AramaSonucu } from '../servisler/arama';
import { bugunOzeti, type BugunOzeti } from '../servisler/bugun';
import { useUygulama, useProjeErisimi, useYetki } from './baglam';
import { git } from './rota';
import { YapilacaklarKarti } from './Yapilacaklar';

// Ana ekran: hızlı işlemler, onay bekleyen belgeler, vadesi geçen ve bu hafta dolacak ödeme/tahsilat/çekler,
// kasa/banka ve imza bekleyen taslaklar. Bilgisayarda iki sütun, telefonda tek sütun.

const TUR: Record<VadeTuru, { simge: SimgeAdi; ad: string; sinif: string }> = {
  odenecek_fatura: { simge: 'odeme', ad: 'Ödenecek fatura', sinif: 'vade-cikis' },
  verilen_cek: { simge: 'odeme', ad: 'Ödenecek çek', sinif: 'vade-cikis' },
  tahsil_alacak: { simge: 'tahsilat', ad: 'Tahsil edilecek', sinif: 'vade-giris' },
  alinan_cek: { simge: 'tahsilat', ad: 'Tahsil edilecek çek', sinif: 'vade-giris' },
  kredi_taksiti: { simge: 'odeme', ad: 'Kredi taksiti', sinif: 'vade-cikis' },
};

function VadeListesi({ baslik, kalemler, bugun, bos }: { baslik: string; kalemler: VadeKalemi[]; bugun: string; bos: string }) {
  const cikis = toplam(kalemler, 'odenecek_fatura') + toplam(kalemler, 'verilen_cek') + toplam(kalemler, 'kredi_taksiti');
  const giris = toplam(kalemler, 'tahsil_alacak') + toplam(kalemler, 'alinan_cek');
  return (
    <section className="kart">
      <h2>{baslik}</h2>
      {kalemler.length === 0 ? (
        <p className="soluk">{bos}</p>
      ) : (
        <>
          <p className="vade-toplam">
            {cikis > 0 && (
              <span className="vade-cikis">
                Ödenecek <strong>{tlYaz(cikis)}</strong>
              </span>
            )}
            {giris > 0 && (
              <span className="vade-giris">
                Tahsil edilecek <strong>{tlYaz(giris)}</strong>
              </span>
            )}
          </p>
          <ul className="vade-listesi">
            {kalemler.slice(0, 12).map((k) => (
              <li key={`${k.tur}-${k.id}`}>
                <a href={`#/${k.yol}`}>
                  <span className={`vade-simge ${TUR[k.tur].sinif}`} role="img" aria-label={TUR[k.tur].ad}>
                    <Simge ad={TUR[k.tur].simge} boyut={18} />
                  </span>
                  <span className="vade-bilgi">
                    <strong>{k.baslik}</strong>
                    <span className="soluk">{k.ayrinti}</span>
                  </span>
                  <span className="vade-tutar">
                    <strong>{tlYaz(k.tutar)}</strong>
                    <span className={k.vade < bugun ? 'hata' : 'soluk'}>{vadeMetni(k.vade, bugun)}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {kalemler.length > 12 && <p className="soluk kucuk">+{kalemler.length - 12} kayıt daha</p>}
        </>
      )}
    </section>
  );
}

/** Yeni firmada yol gösteren liste; hepsi yapılınca kendiliğinden kaybolur. */
function IlkAdimlar({ durum }: { durum: BugunOzeti['baslangic'] }) {
  const yetki = useYetki();
  const adimlar = [
    { tamam: durum.hesap, yol: 'hesaplar/yeni', ad: 'Kasa ya da banka hesabı açın', yetki: yetki('kasa') },
    { tamam: durum.proje, yol: 'projeler/yeni', ad: 'İlk projeyi kurun (bina, katlar, daireler)', yetki: yetki('proje') },
    { tamam: durum.cari, yol: 'cariler/yeni', ad: 'Usta, tedarikçi ya da müşteri kartı açın', yetki: yetki('cari') },
    { tamam: durum.gider, yol: 'giderler/yeni', ad: 'İlk gideri ya da fişi girin', yetki: yetki('gider') },
  ].filter((a) => a.yetki);
  if (adimlar.every((a) => a.tamam)) return null;
  return (
    <section className="kart ilk-adimlar">
      <h2>İlk adımlar</h2>
      <ol>
        {adimlar.map((a) => (
          <li key={a.yol} className={a.tamam ? 'tamam' : undefined}>
            {a.tamam ? (
              <span>✔ {a.ad}</span>
            ) : (
              <a href={`#/${a.yol}`}>{a.ad}</a>
            )}
          </li>
        ))}
      </ol>
      <p className="soluk kucuk">Eski kayıtlarınız yedek dosyasındaysa Ayarlar › Yedekten geri yükle.</p>
    </section>
  );
}

export { vadeGorunur };

export function BugunEkrani() {
  const { depo, oturum, kullanici } = useUygulama();
  const erisim = useProjeErisimi();
  const yetki = useYetki();
  const [ozet, setOzet] = useState<BugunOzeti | null>(null);
  const bugun = yerelGun(new Date());

  useEffect(() => {
    void bugunOzeti(depo, oturum.firmaId, bugun, erisim).then(setOzet);
  }, [depo, oturum.firmaId, bugun, erisim]);
  // Buluta bağlı olmayan cihazda kayıtların tek kopyası buradadır: haftada bir yedek hatırlatılır.
  const [yedek, setYedek] = useState<{ bulut: boolean; son: string | null } | null>(null);
  useEffect(() => {
    void Promise.all([depo.metaGetir(META_BULUT), depo.metaGetir<string>(META_SON_YEDEK)]).then(([b, s]) => setYedek({ bulut: !!b, son: s ?? null }));
  }, [depo]);
  const yedekGunu = yedek?.son ? Math.floor((Date.now() - Date.parse(yedek.son)) / 86_400_000) : null;
  const veriVar = !!ozet && (ozet.baslangic.proje || ozet.baslangic.gider || ozet.baslangic.cari);
  const yedekHatirlat = !!yedek && !yedek.bulut && veriVar && (yedekGunu === null || yedekGunu >= 7);

  const gorur = (k: VadeKalemi) => vadeGorunur(yetki, k);
  const tarih = new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const islemler: { yol: string; simge: SimgeAdi; ad: string; yetki: boolean }[] = [
    { yol: 'giderler/yeni', simge: 'fis', ad: 'Gider / fiş', yetki: yetki('gider') },
    { yol: 'havuz', simge: 'belge', ad: 'Belge yükle', yetki: true },
    { yol: 'odemeler/yeni', simge: 'odeme', ad: 'Ödeme', yetki: yetki('odeme') },
    { yol: 'odemeler/tahsilat', simge: 'tahsilat', ad: 'Tahsilat', yetki: yetki('odeme') },
  ];

  return (
    <>
      <div className="baslik-satiri bugun-baslik">
        <h1>Merhaba {kullanici.ad}</h1>
        <span className="soluk">{tarih}</span>
      </div>
      <HizliArama />
      <div className="pano">
        <div className="pano-sutun">
          <section className="kart">
            <h2>Hızlı işlem</h2>
            <div className="hizli-islemler">
              {islemler.filter((x) => x.yetki).map((x) => (
                <a key={x.yol} className="hizli-islem" href={`#/${x.yol}`}>
                  <Simge ad={x.simge} boyut={26} />
                  {x.ad}
                </a>
              ))}
              <a className="hizli-islem ikincil" href="#/kayit">
                <Simge ad="ekle" boyut={26} />
                Diğer kayıtlar
              </a>
            </div>
          </section>
          {ozet && <IlkAdimlar durum={ozet.baslangic} />}
          <YapilacaklarKarti />
          {yedekHatirlat && (
            <a className="kart kart-baglanti havuz-uyarisi" href="#/ayarlar">
              <strong><Simge ad="yedek" /> {yedekGunu === null ? 'Henüz yedek alınmadı' : `Son yedek ${yedekGunu} gün önce`}</strong>
              <span className="soluk">Kayıtlar yalnız bu cihazda. Ayarlar › Yedek ve depolama'dan yedek alın ya da buluta bağlayın.</span>
            </a>
          )}
          {!ozet && <p>Yükleniyor…</p>}
          {ozet && (
            <>
              <VadeListesi baslik="Vadesi geçenler" kalemler={ozet.vadeler.gecikmis.filter(gorur)} bugun={bugun} bos="Vadesi geçmiş ödeme ya da tahsilat yok." />
              <VadeListesi baslik="Önümüzdeki 7 gün" kalemler={ozet.vadeler.yaklasan.filter(gorur)} bugun={bugun} bos="Bu hafta vadesi dolan bir şey yok." />
              {ozet.vadesizBorc.adet > 0 && (yetki('gider') || yetki('odeme')) && (
                <p className="soluk kucuk">
                  Vadesi yazılmamış {ozet.vadesizBorc.adet} ödenmemiş fatura ({tlYaz(ozet.vadesizBorc.tutar)}) listede yok.{' '}
                  <a href="#/giderler">Giderler</a>
                </p>
              )}
            </>
          )}
        </div>
        <div className="pano-sutun">
          {ozet && yetki('kasa') && ozet.hesaplar.length > 0 && (
            <section className="kart">
              <div className="baslik-satiri">
                <h2>Kasa ve banka</h2>
                <a href="#/hesaplar">Tümü</a>
              </div>
              <ul className="liste">
                {ozet.hesaplar.map((h) => (
                  <li key={h.hesap.id}>
                    <a href={`#/hesaplar/${h.hesap.id}`}>{h.hesap.ad}</a>
                    <strong className={h.bakiye < 0 ? 'hata' : undefined}>
                      {h.hesap.paraBirimi === 'TRY' ? tlYaz(h.bakiye) : `${(h.bakiye / 100).toLocaleString('tr-TR')} ${h.hesap.paraBirimi}`}
                    </strong>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {ozet && (ozet.taslakSozlesmeler.length > 0 || ozet.imzasizSatislar.length > 0) && (
            <section className="kart">
              <h2>İmza bekleyenler</h2>
              <ul className="liste">
                {yetki('sozlesme') &&
                  ozet.taslakSozlesmeler.map((s) => (
                    <li key={s.id}>
                      <a href={`#/${s.yol}`}>{s.ad}</a>
                      <span className="soluk">Usta sözleşmesi</span>
                    </li>
                  ))}
                {yetki('satis') &&
                  ozet.imzasizSatislar.map((s) => (
                    <li key={s.id}>
                      <a href={`#/${s.yol}`}>{s.ad}</a>
                      <span className="soluk">Satış (rezerve)</span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
          <section className="kart">
            <h2>Kısayollar</h2>
            <div className="kisayol-izgarasi">
              <a href="#/projeler"><Simge ad="proje" /> Projeler</a>
              {yetki('gider') && <a href="#/giderler"><Simge ad="fis" /> Giderler</a>}
              {yetki('odeme') && <a href="#/cekler"><Simge ad="cek" /> Çek ve senetler</a>}
              <a href="#/belgeler"><Simge ad="dosya" /> Belgeler</a>
              {yetki('rapor') && <a href="#/rapor"><Simge ad="rapor" /> Firma raporu</a>}
              <a href="#/maliyet"><Simge ad="hesap" /> Maliyet hesabı</a>
              <a href="#/gecmis"><Simge ad="gecmis" /> İşlem geçmişi</a>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/** Telefonda Bugün ekranının üstünde arama kutusu (bilgisayarda sol menüde). */
function HizliArama() {
  const [q, setQ] = useState('');
  return (
    <form
      className="hizli-arama"
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        git(`ara/${encodeURIComponent(q.trim())}`);
      }}
    >
      <input type="search" value={q} placeholder="Cari, proje, fatura no, tutar…" aria-label="Ara" onChange={(e) => setQ(e.target.value)} />
    </form>
  );
}

export function AramaEkrani({ ilk }: { ilk?: string }) {
  const { depo, oturum } = useUygulama();
  const erisim = useProjeErisimi();
  const [q, setQ] = useState(ilk ?? '');
  const [sonuc, setSonuc] = useState<AramaSonucu[] | null>(null);

  useEffect(() => {
    if (q.trim().length < 2) return setSonuc(null);
    let iptal = false;
    const zaman = setTimeout(() => {
      void genelArama(depo, oturum.firmaId, q, erisim).then((s) => !iptal && setSonuc(s));
    }, 200);
    return () => {
      iptal = true;
      clearTimeout(zaman);
    };
  }, [q, depo, oturum.firmaId, erisim]);

  const gruplar = [...new Set(sonuc?.map((s) => s.grup) ?? [])];
  return (
    <>
      <h1>Ara</h1>
      <input
        className="arama-kutusu"
        type="search"
        value={q}
        autoFocus
        placeholder="Cari, proje, fatura no, tutar, çek no, belge…"
        aria-label="Ara"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && sonuc?.[0]) git(sonuc[0].yol);
        }}
      />
      {q.trim().length < 2 && <p className="soluk">En az iki harf yazın. Türkçe harfsiz de olur ("sahin" → Şahin). Tutar için rakam yazın (12500).</p>}
      {sonuc?.length === 0 && (
        <p className="soluk">
          "{q.trim()}" için sonuç yok. Daha kısa yazmayı ya da tek kelimeyle aramayı deneyin.
        </p>
      )}
      {gruplar.map((g) => (
        <section key={g} className="kart">
          <h2>{g}</h2>
          <ul className="arama-listesi">
            {sonuc!
              .filter((s) => s.grup === g)
              .map((s) => (
                <li key={s.yol}>
                  <a href={`#/${s.yol}`}>
                    <strong>{s.baslik}</strong>
                    {s.ayrinti && <span className="soluk">{s.ayrinti}</span>}
                  </a>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </>
  );
}
