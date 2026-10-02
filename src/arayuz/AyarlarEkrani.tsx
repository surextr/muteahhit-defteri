import { useEffect, useState } from 'react';
import { cihaz } from '../cihaz';
import type { DepolamaDurumu } from '../cihaz/cihaz';
import { firmaAyariDegistir } from '../servisler/firma';
import { useUygulama } from './baglam';
import { Hatalar, useGerekceliDegisiklik } from './bilesenler';
import { kaliciDepolamaMesaji, type DepolamaMesaji } from './kaliciDepolamaMesaji';
import { YedekPaneli } from './YedekPaneli';

const mb = (bayt: number | null) =>
  bayt === null ? '?' : `${(bayt / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`;

function DepolamaKarti() {
  const [durum, setDurum] = useState<DepolamaDurumu | null>(null);
  const [isteniyor, setIsteniyor] = useState(false);
  const [mesaj, setMesaj] = useState<DepolamaMesaji | null>(null);

  useEffect(() => {
    void cihaz.depolamaDurumu().then(setDurum);
  }, []);

  async function iste() {
    setIsteniyor(true);
    setMesaj(null);
    try {
      setMesaj(kaliciDepolamaMesaji(await cihaz.kaliciDepolamaIste(), cihaz.ortamBilgisi()));
      setDurum(await cihaz.depolamaDurumu());
    } finally {
      setIsteniyor(false);
    }
  }

  return (
    <section className="kart">
      <h2>Veri saklama</h2>
      {durum && (
        <p>
          Kalıcı depolama: {durum.kalici ? 'izin verildi' : 'izin yok'} · kullanılan {mb(durum.kullanilan)} /{' '}
          {mb(durum.kota)}
        </p>
      )}
      {durum && !durum.kalici && (
        <button type="button" onClick={iste} disabled={isteniyor}>
          {isteniyor ? 'İzin isteniyor…' : 'Kalıcı depolama izni iste'}
        </button>
      )}
      {mesaj && (
        <div className={`mesaj mesaj-${mesaj.tur}`} role="status" aria-live="polite">
          <h3>{mesaj.baslik}</h3>
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
        </div>
      )}
    </section>
  );
}

function MaliyetAyarlari() {
  const { firma, servis, yenile } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const dahil = firma.ayarlar.kdvMaliyeteDahil;

  const sec = (kdvMaliyeteDahil: boolean) =>
    kdvMaliyeteDahil !== dahil &&
    void degistir(firma, 'KDV gösterimi değişiyor', async (g) => {
      await firmaAyariDegistir(servis, firma, { kdvMaliyeteDahil }, g);
      await yenile();
    });

  return (
    <section className="kart">
      <h2>Maliyet ve KDV</h2>
      <fieldset className="secenekler secenekler-dikey">
        <legend>Bütçe ve raporlarda maliyet</legend>
        <label>
          <input type="radio" name="kdv" checked={dahil} onChange={() => sec(true)} /> KDV dahil gösterilsin
        </label>
        <label>
          <input type="radio" name="kdv" checked={!dahil} onChange={() => sec(false)} /> KDV hariç gösterilsin
        </label>
      </fieldset>
      <p className="soluk">
        KDV her gider satırında oranıyla ayrı saklanır; bu ayar yalnızca gösterimi değiştirir. İndirebildiğiniz KDV'yi maliyet
        saymıyorsanız "hariç" seçin. Değişiklik geçmişe yazılır.
      </p>
      {kutu}
      <Hatalar hatalar={hata ? [hata] : []} />
    </section>
  );
}

export function AyarlarEkrani() {
  const { depo, arsiv, firma, kullanici, yenile } = useUygulama();
  return (
    <>
      <h1>Ayarlar</h1>
      <section className="kart">
        <h2>Firma</h2>
        <p>{firma.ad}</p>
        <p className="soluk">Veritabanı şema sürümü {depo.semaSurumu}</p>
      </section>
      <ul className="kayit-secenekleri liste-arasi">
        <li>
          <a className="kart kart-baglanti" href="#/ayarlar/kullanicilar">
            <strong>Kullanıcılar ve roller</strong>
            <span className="soluk">Bu cihazı kullanan: {kullanici.ad}</span>
          </a>
        </li>
        <li>
          <a className="kart kart-baglanti" href="#/gecmis">
            <strong>İşlem geçmişi ve iptaller</strong>
            <span className="soluk">Kim, ne zaman, neyi değiştirdi ya da iptal etti</span>
          </a>
        </li>
      </ul>
      <MaliyetAyarlari />
      <DepolamaKarti />
      <YedekPaneli depo={depo} arsiv={arsiv} onDegisti={() => void yenile()} />
    </>
  );
}
