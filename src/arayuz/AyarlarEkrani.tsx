import { useEffect, useState } from 'react';
import { cihaz } from '../cihaz';
import type { DepolamaDurumu } from '../cihaz/cihaz';
import { firmaAyariDegistir, firmaBilgileriniDegistir, firmaLogosunuDegistir } from '../servisler/firma';
import type { FirmaBilgileri } from '../veri/tipler';
import { TelefonGirdisi } from './Girdiler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
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

const FIRMA_ALANLARI: { alan: keyof FirmaBilgileri; etiket: string; tip?: string }[] = [
  { alan: 'yetkili', etiket: 'Yetkili' },
  { alan: 'eposta', etiket: 'E-posta', tip: 'email' },
  { alan: 'web', etiket: 'Web sitesi' },
  { alan: 'vergiDairesi', etiket: 'Vergi dairesi' },
  { alan: 'vergiNo', etiket: 'Vergi / TC no' },
];

/** Firma adı, iletişim ve vergi bilgileri, logo. PDF başlıklarında kullanılacak. */
function FirmaKarti() {
  const { depo, firma, servis, yenile } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [form, setForm] = useState({ ad: firma.ad, bilgiler: firma.bilgiler });
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [kaydedildi, setKaydedildi] = useState(false);
  const yaz = (alan: keyof FirmaBilgileri, deger: string) => {
    setKaydedildi(false);
    setForm((f) => ({ ...f, bilgiler: { ...f.bilgiler, [alan]: deger } }));
  };

  async function logoSec() {
    setHatalar([]);
    const dosya = await cihaz.dosyaSec('image/png,image/jpeg,image/svg+xml,image/webp');
    if (!dosya) return;
    try {
      const logo = await cihaz.logoHazirla(dosya);
      void degistir('Logo değişiyor', async (g) => {
        await firmaLogosunuDegistir(servis, firma, logo, g);
        await yenile();
      });
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <section className="kart">
      <h2>Firma bilgileri</h2>
      <p className="soluk">Sözleşme, rapor ve PDF başlıklarında kullanılır.</p>
      <div className="logo-satiri">
        {firma.logo ? <img className="logo-onizleme" src={firma.logo} alt="Firma logosu" /> : <span className="logo-bos">Logo yok</span>}
        <div className="dugmeler">
          <button type="button" className="ikincil" onClick={() => void logoSec()}>
            {firma.logo ? 'Logoyu değiştir' : 'Logo yükle'}
          </button>
          {firma.logo && (
            <button
              type="button"
              className="baglanti-dugmesi"
              onClick={() =>
                void degistir('Logo kaldırılıyor', async (g) => {
                  await firmaLogosunuDegistir(servis, firma, null, g);
                  await yenile();
                })
              }
            >
              Logoyu kaldır
            </button>
          )}
        </div>
      </div>
      <Alan etiket="Firma adı">
        <input value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} />
      </Alan>
      <div className="iki-sutun">
        <Alan etiket="Telefon">
          <TelefonGirdisi value={form.bilgiler.telefon} onChange={(v) => yaz('telefon', v)} placeholder="0 242 000 00 00" />
        </Alan>
        {FIRMA_ALANLARI.map(({ alan, etiket, tip }) => (
          <Alan key={alan} etiket={etiket}>
            <input
              type={tip ?? 'text'}
              value={form.bilgiler[alan]}
              inputMode={alan === 'vergiNo' ? 'numeric' : undefined}
              onChange={(e) => yaz(alan, e.target.value)}
            />
          </Alan>
        ))}
      </div>
      <Alan etiket="Adres">
        <input value={form.bilgiler.adres} onChange={(e) => yaz('adres', e.target.value)} />
      </Alan>
      {kutu}
      <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
      {kaydedildi && (
        <p className="mesaj mesaj-basari" role="status">
          Kaydedildi.
        </p>
      )}
      <button
        type="button"
        onClick={() =>
          void degistir('Firma bilgileri değişiyor', async (g) => {
            const guncel = await firmaBilgileriniDegistir(servis, firma, form, g);
            setForm({ ad: guncel.ad, bilgiler: guncel.bilgiler });
            setKaydedildi(true);
            await yenile();
          })
        }
      >
        Firma bilgilerini kaydet
      </button>
      <p className="mesaj-not">Veritabanı şema sürümü {depo.semaSurumu}</p>
    </section>
  );
}

function MaliyetAyarlari() {
  const { firma, servis, yenile } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const dahil = firma.ayarlar.kdvMaliyeteDahil;

  const sec = (kdvMaliyeteDahil: boolean) =>
    kdvMaliyeteDahil !== dahil &&
    void degistir('KDV gösterimi değişiyor', async (g) => {
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
  const { depo, arsiv, kullanici, yenile } = useUygulama();
  return (
    <>
      <h1>Ayarlar</h1>
      <FirmaKarti />
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
