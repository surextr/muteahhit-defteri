import type { CapacitorConfig } from '@capacitor/cli';

// Mağaza uygulaması (Android; iOS için Mac gerekir). Uygulama derlenmiş dist/ klasöründen cihazda açılır; API istekleri
// canlı sunucuya gider (bulut/api.ts). CapacitorHttp: istekler telefonun kendi HTTP katmanından gider, oturum çerezi
// uygulamada saklanır (tarayıcıdaki aynı-site kuralı ve CORS gerekmez). Ayrıntı: MAGAZA.md.
const config: CapacitorConfig = {
  appId: 'tr.surex.muteahhit',
  appName: 'Müteahhit Hesap Defteri',
  webDir: 'dist',
  android: { allowMixedContent: false },
  plugins: {
    CapacitorHttp: { enabled: true },
    CapacitorCookies: { enabled: true },
  },
};

export default config;
