import type { KaliciDepolamaSonucu } from '../cihaz/cihaz';
import type { OrtamBilgisi } from '../cihaz/ortam';

export interface DepolamaMesaji {
  tur: 'basari' | 'uyari';
  baslik: string;
  neden: string;
  /** Kullanıcının sırayla yapacakları. */
  adimlar: string[];
  not: string | null;
}

const YEDEK_NOTU =
  'İzin olmadan da uygulama çalışır; ancak cihazda yer azalırsa tarayıcı verileri silebilir. Bu yüzden düzenli yedek alın.';
const TEKRAR_DENE = 'Uygulamayı simgesinden açıp bu düğmeye tekrar basın.';

const TARAYICI_ADI: Record<OrtamBilgisi['tarayici'], string> = {
  chrome: 'Chrome',
  edge: 'Edge',
  samsung: 'Samsung Internet',
  firefox: 'Firefox',
  safari: 'Safari',
  diger: 'Tarayıcı',
};

/** Kalıcı depolama isteğinin sonucunu, nedeni ve yapılacaklarla birlikte Türkçe anlatır. */
export function kaliciDepolamaMesaji(sonuc: KaliciDepolamaSonucu, ortam: OrtamBilgisi): DepolamaMesaji {
  if (sonuc === 'verildi') {
    return {
      tur: 'basari',
      baslik: 'Kalıcı depolama izni verildi',
      neden: 'Tarayıcı bu uygulamanın verilerini kendiliğinden silmeyecek.',
      adimlar: [],
      not: null,
    };
  }

  const uyari = (neden: string, adimlar: string[]): DepolamaMesaji => ({
    tur: 'uyari',
    baslik: 'Kalıcı depolama izni alınamadı',
    neden,
    adimlar,
    not: YEDEK_NOTU,
  });

  if (sonuc === 'guvensiz_baglanti') {
    return uyari('Sayfa güvenli bağlantı (https) üzerinden açılmadığı için tarayıcı bu izni istemeye izin vermiyor.', [
      'Uygulamayı https:// ile başlayan adresinden açın.',
    ]);
  }

  if (sonuc === 'desteklenmiyor') {
    return uyari(
      'Bu tarayıcı kalıcı depolama iznini desteklemiyor.',
      ortam.platform === 'ios'
        ? ['iOS\'u güncelleyin (Ayarlar → Genel → Yazılım Güncelleme).', ...iosAnaEkranAdimlari()]
        : ['Uygulamayı Chrome\'un güncel sürümüyle açın.', ...chromeYukleAdimlari(ortam)],
    );
  }

  // sonuc === 'reddedildi'
  if (ortam.platform === 'ios') {
    return ortam.anaEkranUygulamasi
      ? uyari('Uygulama ana ekrandan açık olduğu hâlde iOS izni vermedi.', [
          'iOS\'u güncelleyin (Ayarlar → Genel → Yazılım Güncelleme).',
          TEKRAR_DENE,
        ])
      : uyari(
          'iPhone ve iPad\'de bu izin yalnızca ana ekrana eklenmiş uygulamalara verilir. Uygulama şu an tarayıcıda site olarak açık.',
          iosAnaEkranAdimlari(),
        );
  }

  if (ortam.tarayici === 'firefox') {
    return uyari('Firefox bu izni size sordu ve izin verilmedi.', [
      'Adres çubuğunun solundaki kilit simgesine dokunun.',
      '"Kalıcı depolama" iznindeki engeli kaldırın.',
      'Bu düğmeye tekrar basın.',
    ]);
  }

  if (ortam.tarayici === 'safari') {
    return ortam.anaEkranUygulamasi
      ? uyari('Uygulama Dock\'tan açık olduğu hâlde Safari izni vermedi.', ['macOS\'u güncelleyin.', TEKRAR_DENE])
      : uyari('Safari bu izni yalnızca Dock\'a eklenmiş uygulamalara verir.', [
          'Safari\'de Dosya menüsünden "Dock\'a Ekle"yi seçin.',
          'Uygulamayı Dock\'taki simgesinden açıp bu düğmeye tekrar basın.',
        ]);
  }

  // Chrome, Edge, Samsung Internet ve tanınmayan tarayıcılar
  const ad = TARAYICI_ADI[ortam.tarayici];
  if (ortam.anaEkranUygulamasi) {
    return uyari(
      `Uygulama yüklü olduğu hâlde ${ad} izni vermedi. ${ad} bu izni soru sormadan, kendi ölçütlerine göre verir.`,
      [`${ad} uygulamasını güncelleyin.`, TEKRAR_DENE],
    );
  }
  return uyari(
    ortam.tarayici === 'diger'
      ? 'Bu tarayıcı izni vermedi. En iyi sonuç için uygulamayı Chrome\'a yükleyin.'
      : `${ad} bu izni soru penceresi göstermeden kendisi verir ya da vermez. Uygulama yalnızca tarayıcı sekmesinde açıkken genellikle vermez; uygulama yüklendiğinde verir.`,
    chromeYukleAdimlari(ortam),
  );
}

function iosAnaEkranAdimlari(): string[] {
  return [
    'Uygulamayı Safari\'de açın ve alttaki Paylaş düğmesine dokunun.',
    '"Ana Ekrana Ekle"yi seçip "Ekle"ye dokunun.',
    'Uygulamayı ana ekrandaki simgesinden açıp bu düğmeye tekrar basın.',
  ];
}

function chromeYukleAdimlari(ortam: OrtamBilgisi): string[] {
  if (ortam.tarayici === 'samsung') {
    return ['Alttaki menüye (≡) dokunun.', '"Sayfayı ekle" → "Ana ekran"ı seçin.', TEKRAR_DENE];
  }
  if (ortam.tarayici === 'edge') {
    return ortam.platform === 'android'
      ? ['Edge menüsünü (…) açın.', '"Telefona ekle" ya da "Uygulamayı yükle"yi seçin.', TEKRAR_DENE]
      : ['Edge menüsünü (…) açın.', '"Uygulamalar → Bu siteyi uygulama olarak yükle"yi seçin.', TEKRAR_DENE];
  }
  const chrome = ortam.tarayici === 'chrome' ? [] : ['Uygulamayı Chrome ile açın.'];
  return ortam.platform === 'android'
    ? [...chrome, 'Chrome menüsünü (⋮) açın.', '"Uygulamayı yükle" ya da "Ana ekrana ekle"yi seçin.', TEKRAR_DENE]
    : [
        ...chrome,
        'Adres çubuğunun sağındaki yükleme simgesine ya da Chrome menüsünde (⋮) "Yükle…" seçeneğine tıklayın.',
        'Uygulamayı açılan pencereden ya da masaüstü kısayolundan açıp bu düğmeye tekrar basın.',
      ];
}
