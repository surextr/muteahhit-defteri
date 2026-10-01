import { useRegisterSW } from 'virtual:pwa-register/react';

/** Uygulama açıkken yeni sürüm var mı diye bu aralıkla bakılır. */
const KONTROL_ARALIGI_MS = 60 * 60 * 1000;

/**
 * Yeni sürüm başka bir sekmede zaten etkinleştirildiyse bekleyen service worker kalmaz
 * ve updateServiceWorker sayfayı yenilemez. Bu süre içinde yenilenmezse sayfa elle yenilenir;
 * etkin olan yeni sürüm yüklenir.
 */
const YEDEK_YENILEME_MS = 1500;

function guncelle(updateServiceWorker: (yenile?: boolean) => Promise<void>) {
  void updateServiceWorker(true);
  setTimeout(() => window.location.reload(), YEDEK_YENILEME_MS);
}

/**
 * Service worker kaydı ve kullanıcı bildirimleri:
 * - ilk kurulumda "internetsiz kullanıma hazır"
 * - yeni sürüm yayınlanınca "Güncelle" (veriler IndexedDB'de olduğu için korunur)
 */
export function GuncellemeUyarisi() {
  const {
    needRefresh: [yeniSurum, setYeniSurum],
    offlineReady: [cevrimdisiHazir, setCevrimdisiHazir],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_adres, kayit) {
      if (kayit) setInterval(() => void kayit.update(), KONTROL_ARALIGI_MS);
    },
  });

  if (yeniSurum) {
    return (
      <div className="bildirim" role="alert">
        <p>Yeni sürüm hazır. Güncellemede verileriniz korunur.</p>
        <div className="bildirim-dugmeler">
          <button type="button" onClick={() => guncelle(updateServiceWorker)}>
            Güncelle
          </button>
          <button type="button" className="ikincil" onClick={() => setYeniSurum(false)}>
            Sonra
          </button>
        </div>
      </div>
    );
  }

  if (cevrimdisiHazir) {
    return (
      <div className="bildirim" role="status">
        <p>Uygulama internetsiz kullanıma hazır.</p>
        <div className="bildirim-dugmeler">
          <button type="button" className="ikincil" onClick={() => setCevrimdisiHazir(false)}>
            Tamam
          </button>
        </div>
      </div>
    );
  }

  return null;
}
