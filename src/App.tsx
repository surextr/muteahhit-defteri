import { useCallback, useEffect, useMemo, useState } from 'react';
import { AyarlarEkrani } from './arayuz/AyarlarEkrani';
import { ButceEkrani } from './arayuz/ButceEkrani';
import { CariDetay } from './arayuz/CariDetay';
import { GiderDetay, GiderlerEkrani, KayitEkrani } from './arayuz/GiderlerEkrani';
import { GiderFormu } from './arayuz/GiderFormu';
import { OdemeDetay, OdemeFormu, TahsilatFormu } from './arayuz/OdemeEkrani';
import { HesapDetay } from './arayuz/HesapDetay';
import { HesapYeni, HesaplarEkrani, TransferEkrani } from './arayuz/HesaplarEkrani';
import { CariYeni, CarilerEkrani, cariRoluMu } from './arayuz/CarilerEkrani';
import { UygulamaSaglayici, type Uygulama } from './arayuz/baglam';
import { GuncellemeUyarisi } from './arayuz/GuncellemeUyarisi';
import { Kabuk } from './arayuz/Kabuk';
import { KurulumEkrani } from './arayuz/KurulumEkrani';
import { ProjeDetay } from './arayuz/ProjeDetay';
import { ProjeDuzenle } from './arayuz/ProjeDuzenle';
import { ProjelerEkrani } from './arayuz/ProjelerEkrani';
import { ProjeSihirbazi } from './arayuz/ProjeSihirbazi';
import { useRota } from './arayuz/rota';
import { KayitServisi, type Oturum } from './servisler/kayitServisi';
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

function Sayfa({ yol }: { yol: string[] }) {
  const [bolum, alt, ek, ek2] = yol;
  if (bolum === 'ayarlar') return <AyarlarEkrani />;
  if (bolum === 'kayit') return <KayitEkrani />;
  if (bolum === 'odemeler' && alt === 'yeni') return <OdemeFormu key={`${ek ?? ''}-${ek2 ?? ''}`} cariId={ek} giderId={ek2} />;
  if (bolum === 'odemeler' && alt === 'tahsilat') return <TahsilatFormu key={ek ?? ''} cariId={ek} />;
  if (bolum === 'odemeler' && alt) return <OdemeDetay key={alt} odemeId={alt} />;
  if (bolum === 'giderler' && alt === 'yeni') return <GiderFormu key={ek ?? ''} projeId={ek} />;
  if (bolum === 'giderler' && alt === 'proje' && ek) return <GiderlerEkrani key={ek} projeId={ek} />;
  if (bolum === 'giderler' && alt) return <GiderDetay key={`${alt}-${ek ?? ''}`} giderId={alt} duzenle={ek === 'duzenle'} />;
  if (bolum === 'giderler') return <GiderlerEkrani />;
  if (bolum === 'cariler' && alt === 'yeni') return <CariYeni rol={cariRoluMu(ek) ? ek : undefined} />;
  if (bolum === 'cariler' && alt) return <CariDetay key={alt} cariId={alt} duzenle={ek === 'duzenle'} />;
  if (bolum === 'cariler') return <CarilerEkrani />;
  if (bolum === 'hesaplar' && alt === 'yeni') return <HesapYeni />;
  if (bolum === 'hesaplar' && alt === 'transfer') return <TransferEkrani key={ek ?? ''} kaynakId={ek} />;
  if (bolum === 'hesaplar' && alt) return <HesapDetay key={alt} hesapId={alt} duzenle={ek === 'duzenle'} />;
  if (bolum === 'hesaplar') return <HesaplarEkrani />;
  if (bolum === 'projeler' && alt === 'yeni') return <ProjeSihirbazi />;
  if (bolum === 'projeler' && alt && ek === 'butce') return <ButceEkrani key={alt} projeId={alt} />;
  if (bolum === 'projeler' && alt && ek === 'duzenle') return <ProjeDuzenle key={alt} projeId={alt} />;
  if (bolum === 'projeler' && alt) return <ProjeDetay key={alt} projeId={alt} />;
  return <ProjelerEkrani />;
}

export function App() {
  const [kaynaklar, setKaynaklar] = useState<Kaynaklar | null>(null);
  /** undefined: okunuyor, null: bu cihazda kurulum yapılmamış */
  const [giris, setGiris] = useState<{ oturum: Oturum; firma: Firma } | null | undefined>(undefined);
  const [hata, setHata] = useState<string | null>(null);
  const yol = useRota();

  const girisiOku = useCallback(async (depo: Depo) => {
    const oturum = await oturumuYukle(depo);
    const firma = oturum ? await depo.getir('firma', oturum.firmaId) : undefined;
    setGiris(oturum && firma ? { oturum, firma } : null);
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

  const uygulama = useMemo<Uygulama | null>(
    () =>
      kaynaklar && giris
        ? {
            ...kaynaklar,
            ...giris,
            servis: new KayitServisi(kaynaklar.depo, giris.oturum),
            yenile: () => girisiOku(kaynaklar.depo),
          }
        : null,
    [kaynaklar, giris, girisiOku],
  );

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
        <Kabuk aktif={yol[0] === 'giderler' || yol[0] === 'odemeler' ? 'kayit' : (yol[0] ?? 'projeler')}>
          <Sayfa yol={yol} />
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
