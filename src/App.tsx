import { useEffect, useState } from 'react';
import { GuncellemeUyarisi } from './arayuz/GuncellemeUyarisi';
import { kaliciDepolamaMesaji, type DepolamaMesaji } from './arayuz/kaliciDepolamaMesaji';
import { cihaz } from './cihaz';
import type { DepolamaDurumu } from './cihaz/cihaz';
import { oturumuYukle } from './servisler/kurulum';
import { veriKatmaniniAc } from './veri';

// Geçici durum ekranı (1. adım). Uygulama kabuğu ve ilk kurulum ekranı 2. adımda gelecek.

interface Durum {
  semaSurumu: number;
  kurulumVar: boolean;
  depolama: DepolamaDurumu;
}

const mb = (bayt: number | null) => (bayt === null ? '?' : `${(bayt / 1024 / 1024).toFixed(1)} MB`);

export function App() {
  const [durum, setDurum] = useState<Durum | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [isteniyor, setIsteniyor] = useState(false);
  const [mesaj, setMesaj] = useState<DepolamaMesaji | null>(null);

  async function yukle() {
    try {
      const depo = await veriKatmaniniAc();
      const [oturum, depolama] = await Promise.all([oturumuYukle(depo), cihaz.depolamaDurumu()]);
      setDurum({ semaSurumu: depo.semaSurumu, kurulumVar: oturum !== null, depolama });
    } catch (e) {
      setHata(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    void yukle();
  }, []);

  async function kaliciIste() {
    setIsteniyor(true);
    setMesaj(null);
    try {
      const sonuc = await cihaz.kaliciDepolamaIste();
      setMesaj(kaliciDepolamaMesaji(sonuc, cihaz.ortamBilgisi()));
      await yukle();
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
          <p>Kurulum: {durum.kurulumVar ? 'yapıldı' : 'henüz yapılmadı'}</p>
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
    </main>
  );
}
