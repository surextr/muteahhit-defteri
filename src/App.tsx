import { useCallback, useEffect, useState } from 'react';
import { GuncellemeUyarisi } from './arayuz/GuncellemeUyarisi';
import { kaliciDepolamaMesaji, type DepolamaMesaji } from './arayuz/kaliciDepolamaMesaji';
import { YedekPaneli } from './arayuz/YedekPaneli';
import { cihaz } from './cihaz';
import type { DepolamaDurumu } from './cihaz/cihaz';
import { oturumuYukle } from './servisler/kurulum';
import { gecisOncesiYedekleyici } from './servisler/yedek';
import { VERITABANI_ADI, veriKatmaniniAc, yedekArsiviniAc } from './veri';
import type { Depo } from './veri/depo';
import type { YedekArsivi } from './veri/yedekArsivi';

// Geçici durum ekranı. Uygulama kabuğu ve ilk kurulum ekranı sonraki adımda gelecek.

interface Kaynaklar {
  depo: Depo;
  arsiv: YedekArsivi;
}

interface Durum {
  semaSurumu: number;
  firmaAdi: string | null;
  depolama: DepolamaDurumu;
}

const mb = (bayt: number | null) =>
  bayt === null ? '?' : `${(bayt / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;

async function kaynaklariAc(): Promise<Kaynaklar> {
  const arsiv = await yedekArsiviniAc();
  const depo = await veriKatmaniniAc(VERITABANI_ADI, gecisOncesiYedekleyici(arsiv));
  return { depo, arsiv };
}

export function App() {
  const [kaynaklar, setKaynaklar] = useState<Kaynaklar | null>(null);
  const [durum, setDurum] = useState<Durum | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [isteniyor, setIsteniyor] = useState(false);
  const [mesaj, setMesaj] = useState<DepolamaMesaji | null>(null);

  const durumuYenile = useCallback(async (depo: Depo) => {
    const [oturum, depolama] = await Promise.all([oturumuYukle(depo), cihaz.depolamaDurumu()]);
    const firma = oturum ? await depo.getir('firma', oturum.firmaId) : undefined;
    setDurum({ semaSurumu: depo.semaSurumu, firmaAdi: firma?.ad ?? null, depolama });
  }, []);

  useEffect(() => {
    let iptal = false;
    kaynaklariAc()
      .then(async (k) => {
        if (iptal) return;
        setKaynaklar(k);
        await durumuYenile(k.depo);
      })
      .catch((e: unknown) => setHata(e instanceof Error ? e.message : String(e)));
    return () => {
      iptal = true;
    };
  }, [durumuYenile]);

  async function kaliciIste() {
    if (!kaynaklar) return;
    setIsteniyor(true);
    setMesaj(null);
    try {
      const sonuc = await cihaz.kaliciDepolamaIste();
      setMesaj(kaliciDepolamaMesaji(sonuc, cihaz.ortamBilgisi()));
      await durumuYenile(kaynaklar.depo);
    } finally {
      setIsteniyor(false);
    }
  }

  return (
    <main className="sayfa">
      <GuncellemeUyarisi />
      <h1>Müteahhit Hesap Defteri</h1>
      {hata && <p className="hata">Veritabanı açılamadı: {hata}</p>}
      {!durum && !hata && <p>Yükleniyor…</p>}
      {durum && (
        <section className="kart">
          <p>Veritabanı hazır · şema sürümü {durum.semaSurumu}</p>
          <p>Firma: {durum.firmaAdi ?? 'kurulum henüz yapılmadı'}</p>
          <p>
            Kalıcı depolama: {durum.depolama.kalici ? 'izin verildi' : 'izin yok'} · kullanılan{' '}
            {mb(durum.depolama.kullanilan)} / {mb(durum.depolama.kota)}
          </p>
          {!durum.depolama.kalici && (
            <button type="button" onClick={kaliciIste} disabled={isteniyor}>
              {isteniyor ? 'İzin isteniyor…' : 'Kalıcı depolama izni iste'}
            </button>
          )}
        </section>
      )}
      {mesaj && (
        <section className={`mesaj mesaj-${mesaj.tur}`} role="status" aria-live="polite">
          <h2>{mesaj.baslik}</h2>
          <p>
            <strong>Neden: </strong>
            {mesaj.neden}
          </p>
          {mesaj.adimlar.length > 0 && (
            <>
              <p>
                <strong>Ne yapmalısınız:</strong>
              </p>
              <ol>
                {mesaj.adimlar.map((adim) => (
                  <li key={adim}>{adim}</li>
                ))}
              </ol>
            </>
          )}
          {mesaj.not && <p className="mesaj-not">{mesaj.not}</p>}
        </section>
      )}
      {kaynaklar && (
        <YedekPaneli depo={kaynaklar.depo} arsiv={kaynaklar.arsiv} onDegisti={() => void durumuYenile(kaynaklar.depo)} />
      )}
    </main>
  );
}
