import { ortamiTani } from '../cihaz/ortam';

/** Cihaz veritabanı kapalıyken (iPhone Kilitleme Modu, bazı gizli pencereler) gösterilen yönlendirme. */
export function DepolamaYok({ ayrinti }: { ayrinti?: string | null }) {
  const ortam = ortamiTani(navigator.userAgent, navigator.maxTouchPoints ?? 0, matchMedia?.('(display-mode: standalone)').matches ?? false);
  const apple = ortam.platform === 'ios' || /Macintosh/.test(navigator.userAgent);
  const site = location.host || 'muteahhit.surex.tr';
  return (
    <main className="sayfa">
      <h1>Müteahhit Hesap Defteri</h1>
      <section className="kart">
        <h2>Bu tarayıcıda kayıt saklanamıyor</h2>
        <p>
          Program kayıtlarınızı cihazınızdaki veritabanında tutar. Bu tarayıcı o veritabanını kapatmış
          {apple ? '; büyük olasılıkla Kilitleme Modu (Lockdown Mode) açık.' : '; gizli pencere ya da tarayıcı ayarı olabilir.'}
        </p>
        {apple ? (
          <>
            <h3>Yalnız bu site için Kilitleme Modunu kapatın</h3>
            <ol>
              <li>Bu sayfayı Safari'de açın ({site}).</li>
              <li>Adres çubuğundaki sayfa menüsü düğmesine (aA) dokunun.</li>
              <li>Aşağı kaydırıp <strong>Web Sitesi Ayarları</strong>'na dokunun.</li>
              <li>
                <strong>Kilitleme Modu</strong> anahtarını kapatın ve sayfayı yenileyin.
              </li>
            </ol>
            <p className="soluk">
              Telefonun geri kalanında Kilitleme Modu açık kalır. Kapattığınız siteleri Ayarlar › Gizlilik ve Güvenlik › Kilitleme Modu › Web
              sitelerini özelleştir bölümünden görebilir, geri açabilirsiniz.
            </p>
            <p className="soluk">
              Ana ekrana eklenmiş uygulamadan açıyorsanız ve yine bu ekran geliyorsa, programı bir kez Safari'den açıp yukarıdaki ayarı yapın; olmazsa
              Safari'den kullanmaya devam edin.
            </p>
          </>
        ) : (
          <p>Gizli (özel) pencere kullanıyorsanız normal pencerede açın; tarayıcı ayarlarında site verilerine izin verin.</p>
        )}
        {ayrinti && <p className="soluk">Ayrıntı: {ayrinti}</p>}
        <div className="dugmeler">
          <button type="button" onClick={() => location.reload()}>
            Yeniden dene
          </button>
        </div>
      </section>
    </main>
  );
}
