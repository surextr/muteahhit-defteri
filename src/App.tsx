import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AyarlarEkrani } from './arayuz/AyarlarEkrani';
import { ButceEkrani } from './arayuz/ButceEkrani';
import { IlerlemeEkrani } from './arayuz/Ilerleme';
import { KarZararEkrani } from './arayuz/KarZarar';
import { BelgeGoster, BelgelerEkrani } from './arayuz/Belgeler';
import { CariDetay } from './arayuz/CariDetay';
import { CekDetay, CekFormu, CeklerEkrani } from './arayuz/CeklerEkrani';
import { GiderDetay, GiderlerEkrani, KayitEkrani } from './arayuz/GiderlerEkrani';
import { UstaTipiDuzenle, UstaTipleriEkrani } from './arayuz/UstaTipleri';
import { SozlesmeMetniEkrani, UstaSozlesmesiEkrani, UstaSozlesmesiYeni } from './arayuz/UstaSozlesmesi';
import { GiderFormu } from './arayuz/GiderFormu';
import { GecmisEkrani } from './arayuz/GecmisEkrani';
import { KullanicilarEkrani } from './arayuz/KullanicilarEkrani';
import { OdemeDetay, OdemeFormu, TahsilatFormu } from './arayuz/OdemeEkrani';
import { HesapDetay } from './arayuz/HesapDetay';
import { HesapYeni, HesaplarEkrani, TransferEkrani } from './arayuz/HesaplarEkrani';
import { CariYeni, CarilerEkrani, cariRoluMu } from './arayuz/CarilerEkrani';
import { UygulamaSaglayici, useYetki, type AktifKullanici, type Uygulama } from './arayuz/baglam';
import { GuncellemeUyarisi } from './arayuz/GuncellemeUyarisi';
import { Kabuk } from './arayuz/Kabuk';
import { KurulumEkrani } from './arayuz/KurulumEkrani';
import { ProjeDetay } from './arayuz/ProjeDetay';
import { ProjeDuzenle } from './arayuz/ProjeDuzenle';
import { ProjelerEkrani } from './arayuz/ProjelerEkrani';
import { BransAyirmaEkrani } from './arayuz/BransAyirma';
import { HakedisBelgesiEkrani, HakedisEkrani } from './arayuz/Hakedis';
import { TaahhutEkrani } from './arayuz/Taahhut';
import { ProtokolEkrani, SatisEkrani, SatisYeni } from './arayuz/Satis';
import { SgkEkrani } from './arayuz/Sgk';
import { ProjeSihirbazi } from './arayuz/ProjeSihirbazi';
import { useRota } from './arayuz/rota';
import { kendiligindenEsitle, type EsitlemeDurumu, type Reddedilen, type Yonetici } from './bulut/esitleme';
import { YETKILER, type Yetki } from './hesap/yetki';
import { KayitServisi, type Oturum } from './servisler/kayitServisi';
import { vergiDairesiHazirla } from './servisler/cari';
import { oturumuYukle } from './servisler/kurulum';
import { gecisOncesiYedekleyici } from './servisler/yedek';
import { VERITABANI_ADI, veriKatmaniniAc, yedekArsiviniAc } from './veri';
import type { Depo } from './veri/depo';
import type { Firma } from './veri/tipler';
import type { YedekArsivi } from './veri/yedekArsivi';

interface Kaynaklar {
  depo: Depo;
  arsiv: YedekArsivi;
}

async function kaynaklariAc(): Promise<Kaynaklar> {
  const arsiv = await yedekArsiviniAc();
  const depo = await veriKatmaniniAc(VERITABANI_ADI, gecisOncesiYedekleyici(arsiv));
  return { depo, arsiv };
}

/** Alt menüde hangi düğme seçili görünsün: alt ekranlar bağlı oldukları bölümü işaretler. */
function menuBolumu(bolum: string | undefined): string {
  if (bolum && ['giderler', 'odemeler', 'cekler', 'belgeler'].includes(bolum)) return 'kayit';
  if (bolum === 'gecmis') return 'ayarlar';
  if (bolum === 'sozlesmeler' || bolum === 'hakedisler' || bolum === 'satislar') return 'projeler';
  return bolum ?? 'projeler';
}

/** Ekranın gerektirdiği yetki; yoksa ekran açılmaz (asıl denetim kayıt servisinde ve sunucuda). */
function ekranYetkisi([bolum, alt, ek]: string[]): Yetki | null {
  if (bolum === 'sozlesmeler' || bolum === 'hakedisler') return 'sozlesme';
  if (bolum === 'satislar') return 'satis';
  if (bolum === 'odemeler' || bolum === 'cekler') return 'odeme';
  if (bolum === 'giderler') return 'gider';
  if (bolum === 'cariler') return 'cari';
  if (bolum === 'hesaplar') return 'kasa';
  if (bolum === 'projeler' && alt === 'yeni') return 'proje';
  if (bolum === 'projeler' && (ek === 'sgk' || ek === 'taahhut')) return 'sozlesme';
  if (bolum === 'projeler' && ek === 'rapor') return 'rapor';
  if (bolum === 'projeler' && ek === 'duzenle') return 'proje';
  return null;
}

function Sayfa({ yol }: { yol: string[] }) {
  const yetki = useYetki();
  const gerek = ekranYetkisi(yol);
  if (gerek && !yetki(gerek)) {
    return (
      <section className="kart">
        <h1>Yetkiniz yok</h1>
        <p>Bu ekran için "{YETKILER.find((y) => y.kod === gerek)?.ad}" yetkisi gerekiyor. Yöneticiniz Ayarlar › Kullanıcılar'dan verebilir.</p>
        <a className="dugme ikincil" href="#/projeler">
          Projelere dön
        </a>
      </section>
    );
  }
  return <SayfaIcerigi yol={yol} />;
}

function SayfaIcerigi({ yol }: { yol: string[] }) {
  const [bolum, alt, ek, ek2, ek3] = yol;
  if (bolum === 'ayarlar' && alt === 'kullanicilar') return <KullanicilarEkrani />;
  if (bolum === 'ayarlar' && alt === 'usta-tipleri' && ek) return <UstaTipiDuzenle key={ek} id={ek === 'yeni' ? null : ek} />;
  if (bolum === 'ayarlar' && alt === 'usta-tipleri') return <UstaTipleriEkrani />;
  if (bolum === 'ayarlar') return <AyarlarEkrani />;
  if (bolum === 'gecmis') return <GecmisEkrani />;
  if (bolum === 'sozlesmeler' && alt === 'yeni' && ek) return <UstaSozlesmesiYeni key={ek} projeId={ek} />;
  if (bolum === 'sozlesmeler' && alt && ek === 'metin') return <SozlesmeMetniEkrani key={alt} id={alt} />;
  if (bolum === 'sozlesmeler' && alt) return <UstaSozlesmesiEkrani key={alt} id={alt} />;
  if (bolum === 'hakedisler' && alt === 'yeni' && ek) return <HakedisEkrani key={`yeni-${ek}`} sozlesmeId={ek} />;
  if (bolum === 'satislar' && alt === 'yeni' && ek) return <SatisYeni key={`${ek}-${ek2 ?? ''}`} projeId={ek} bolumId={ek2} />;
  if (bolum === 'satislar' && alt && ek === 'protokol') return <ProtokolEkrani key={alt} id={alt} />;
  if (bolum === 'satislar' && alt) return <SatisEkrani key={alt} id={alt} />;
  if (bolum === 'hakedisler' && alt && ek === 'belge') return <HakedisBelgesiEkrani key={alt} id={alt} />;
  if (bolum === 'hakedisler' && alt) return <HakedisEkrani key={alt} id={alt} />;
  if (bolum === 'kayit') return <KayitEkrani />;
  if (bolum === 'odemeler' && alt === 'yeni') return <OdemeFormu key={`${ek ?? ''}-${ek2 ?? ''}`} cariId={ek} giderId={ek2} />;
  if (bolum === 'odemeler' && alt === 'tahsilat') return <TahsilatFormu key={`${ek ?? ''}-${ek2 ?? ''}`} cariId={ek} iadeId={ek2} />;
  if (bolum === 'odemeler' && alt) return <OdemeDetay key={alt} odemeId={alt} />;
  if (bolum === 'belgeler' && alt) return <BelgeGoster key={alt} belgeId={alt} />;
  if (bolum === 'belgeler') return <BelgelerEkrani />;
  if (bolum === 'cekler' && (alt === 'al' || alt === 'ver')) return <CekFormu key={`${alt}-${ek ?? ''}`} yon={alt === 'al' ? 'alinan' : 'verilen'} cariId={ek} />;
  if (bolum === 'cekler' && alt) return <CekDetay key={alt} cekId={alt} />;
  if (bolum === 'cekler') return <CeklerEkrani />;
  // giderler/yeni/:projeId[/:cariId[/:kalemId]]: kat karşılığı "Ödeme yap" cari ve kalemi hazır açar.
  if (bolum === 'giderler' && alt === 'yeni') return <GiderFormu key={`${ek ?? ''}-${ek2 ?? ''}-${ek3 ?? ''}`} projeId={ek} cariId={ek2} kalemId={ek3} />;
  if (bolum === 'giderler' && alt === 'iade') return <GiderFormu key={`iade-${ek ?? ''}`} iade asilGiderId={ek} />;
  if (bolum === 'giderler' && alt === 'proje' && ek) return <GiderlerEkrani key={ek} projeId={ek} />;
  if (bolum === 'giderler' && alt) return <GiderDetay key={`${alt}-${ek ?? ''}`} giderId={alt} duzenle={ek === 'duzenle'} />;
  if (bolum === 'giderler') return <GiderlerEkrani />;
  if (bolum === 'cariler' && alt === 'brans-ayir') return <BransAyirmaEkrani />;
  if (bolum === 'cariler' && alt === 'yeni') return <CariYeni rol={cariRoluMu(ek) ? ek : undefined} />;
  if (bolum === 'cariler' && alt) return <CariDetay key={alt} cariId={alt} duzenle={ek === 'duzenle'} />;
  if (bolum === 'cariler') return <CarilerEkrani />;
  if (bolum === 'hesaplar' && alt === 'yeni') return <HesapYeni />;
  if (bolum === 'hesaplar' && alt === 'transfer') return <TransferEkrani key={ek ?? ''} kaynakId={ek} />;
  if (bolum === 'hesaplar' && alt) return <HesapDetay key={alt} hesapId={alt} duzenle={ek === 'duzenle'} />;
  if (bolum === 'hesaplar') return <HesaplarEkrani />;
  if (bolum === 'projeler' && alt === 'yeni') return <ProjeSihirbazi />;
  if (bolum === 'projeler' && alt && ek === 'sgk') return <SgkEkrani key={alt} projeId={alt} />;
  if (bolum === 'projeler' && alt && ek === 'taahhut') return <TaahhutEkrani key={alt} projeId={alt} />;
  if (bolum === 'projeler' && alt && ek === 'butce') return <ButceEkrani key={alt} projeId={alt} />;
  if (bolum === 'projeler' && alt && ek === 'rapor') return <KarZararEkrani key={alt} projeId={alt} />;
  if (bolum === 'projeler' && alt && ek === 'ilerleme') return <IlerlemeEkrani key={alt} projeId={alt} />;
  if (bolum === 'projeler' && alt && ek === 'duzenle') return <ProjeDuzenle key={alt} projeId={alt} />;
  if (bolum === 'projeler' && alt) return <ProjeDetay key={alt} projeId={alt} />;
  return <ProjelerEkrani />;
}

export function App() {
  const [kaynaklar, setKaynaklar] = useState<Kaynaklar | null>(null);
  /** undefined: okunuyor, null: bu cihazda kurulum yapılmamış */
  const [giris, setGiris] = useState<{ oturum: Oturum; firma: Firma; kullanici: AktifKullanici } | null | undefined>(undefined);
  const [hata, setHata] = useState<string | null>(null);
  const yol = useRota();
  const [bulutDurumu, setBulutDurumu] = useState<EsitlemeDurumu>({ tur: 'bagli_degil' });
  const [yeniVeri, setYeniVeri] = useState(false);
  const [geriAlinan, setGeriAlinan] = useState<Reddedilen[]>([]);
  const [sayfaAnahtari, setSayfaAnahtari] = useState(0);
  const [esitlemeTuru, setEsitlemeTuru] = useState(0);
  const yonetici = useRef<Yonetici | null>(null);

  const girisiOku = useCallback(async (depo: Depo) => {
    const oturum = await oturumuYukle(depo);
    const firma = oturum ? await depo.getir('firma', oturum.firmaId) : undefined;
    // Bu özellikten önce kurulmuş firmalarda (ve geri yüklenen eski yedekte) vergi dairesi kartı açılır.
    if (oturum && firma) await vergiDairesiHazirla(depo, new KayitServisi(depo, oturum));
    if (!oturum || !firma) return setGiris(null);
    const kullanici = await depo.getir('kullanici', oturum.kullaniciId);
    const uyelik = (await depo.listele('uyelik', { firmaId: oturum.firmaId, kullaniciId: oturum.kullaniciId })).find((u) => u.iptal === null);
    setGiris({ oturum, firma, kullanici: { ad: kullanici?.ad ?? '?', rol: uyelik?.rol ?? null } });
  }, []);

  useEffect(() => {
    let iptal = false;
    kaynaklariAc()
      .then(async (k) => {
        if (iptal) return;
        setKaynaklar(k);
        await girisiOku(k.depo);
      })
      .catch((e: unknown) => setHata(e instanceof Error ? e.message : String(e)));
    return () => {
      iptal = true;
    };
  }, [girisiOku]);

  // Uygulama açıkken bulut eşitleme (cihaz buluta bağlıysa).
  const oturumVar = !!giris;
  useEffect(() => {
    if (!kaynaklar || !oturumVar) return;
    const y = kendiligindenEsitle(kaynaklar.depo, {
      durum: setBulutDurumu,
      veriGeldi: () => setYeniVeri(true),
      reddedildi: (r) => setGeriAlinan((g) => [...g, ...r]),
    });
    yonetici.current = y;
    return () => {
      y.durdur();
      yonetici.current = null;
    };
  }, [kaynaklar, oturumVar, esitlemeTuru]);

  const uygulama = useMemo<Uygulama | null>(
    () =>
      kaynaklar && giris
        ? {
            ...kaynaklar,
            ...giris,
            servis: new KayitServisi(kaynaklar.depo, giris.oturum),
            yenile: () => girisiOku(kaynaklar.depo),
            bulut: {
              durum: bulutDurumu,
              simdi: async () => {
                await yonetici.current?.simdi();
              },
              yenidenBaslat: () => setEsitlemeTuru((n) => n + 1),
            },
          }
        : null,
    [kaynaklar, giris, girisiOku, bulutDurumu],
  );

  async function yeniVeriyiGoster() {
    setYeniVeri(false);
    setGeriAlinan([]);
    if (kaynaklar) await girisiOku(kaynaklar.depo);
    setSayfaAnahtari((n) => n + 1);
  }

  let icerik;
  if (hata) {
    icerik = (
      <main className="sayfa">
        <p className="hata">Veritabanı açılamadı: {hata}</p>
      </main>
    );
  } else if (!kaynaklar || giris === undefined) {
    icerik = (
      <main className="sayfa">
        <p>Yükleniyor…</p>
      </main>
    );
  } else if (!uygulama) {
    icerik = (
      <main className="sayfa">
        <h1>Müteahhit Hesap Defteri</h1>
        <KurulumEkrani depo={kaynaklar.depo} onKuruldu={() => void girisiOku(kaynaklar.depo)} />
      </main>
    );
  } else {
    icerik = (
      <UygulamaSaglayici value={uygulama}>
        <Kabuk aktif={menuBolumu(yol[0])}>
          {(yeniVeri || geriAlinan.length > 0) && (
            <div className="mesaj mesaj-not yeni-veri" role="status">
              <span>
                {geriAlinan.length > 0
                  ? `${geriAlinan.length} değişiklik yetkiniz olmadığı için sunucudaki hâline döndü.`
                  : 'Başka cihazdan yeni kayıtlar geldi.'}
              </span>
              <button type="button" className="ikincil" onClick={() => void yeniVeriyiGoster()}>
                Yenile
              </button>
            </div>
          )}
          <Sayfa key={sayfaAnahtari} yol={yol} />
        </Kabuk>
      </UygulamaSaglayici>
    );
  }

  return (
    <>
      <GuncellemeUyarisi />
      {icerik}
    </>
  );
}
