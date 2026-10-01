import { describe, expect, it } from 'vitest';
import { ortamiTani } from '../cihaz/ortam';
import { kaliciDepolamaMesaji } from './kaliciDepolamaMesaji';

const UA = {
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/28.0 Chrome/130.0.0.0 Mobile Safari/537.36',
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0 Mobile/15E148 Safari/604.1',
  ipadMasaustu:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:145.0) Gecko/20100101 Firefox/145.0',
};

describe('ortamiTani', () => {
  it.each([
    ['windowsChrome', 0, 'masaustu', 'chrome'],
    ['windowsEdge', 0, 'masaustu', 'edge'],
    ['androidChrome', 5, 'android', 'chrome'],
    ['androidSamsung', 5, 'android', 'samsung'],
    ['iphoneSafari', 5, 'ios', 'safari'],
    ['iphoneChrome', 5, 'ios', 'chrome'],
    ['ipadMasaustu', 5, 'ios', 'safari'],
    ['ipadMasaustu', 0, 'masaustu', 'safari'],
    ['firefox', 0, 'masaustu', 'firefox'],
  ] as const)('%s (dokunma %i) → %s / %s', (ad, dokunma, platform, tarayici) => {
    expect(ortamiTani(UA[ad], dokunma, false)).toEqual({ platform, tarayici, anaEkranUygulamasi: false });
  });
});

describe('kaliciDepolamaMesaji', () => {
  it('izin verilince başarı mesajı, adım yok', () => {
    const m = kaliciDepolamaMesaji('verildi', ortamiTani(UA.windowsChrome, 0, false));
    expect(m.tur).toBe('basari');
    expect(m.adimlar).toEqual([]);
  });

  it('masaüstü Chrome sekmesinde: nedeni sessiz karar, çözüm uygulamayı yüklemek', () => {
    const m = kaliciDepolamaMesaji('reddedildi', ortamiTani(UA.windowsChrome, 0, false));
    expect(m.tur).toBe('uyari');
    expect(m.neden).toContain('soru penceresi göstermeden');
    expect(m.adimlar.join(' ')).toContain('Yükle');
    expect(m.not).toContain('yedek');
  });

  it('Android Chrome: menüden uygulamayı yükle', () => {
    const m = kaliciDepolamaMesaji('reddedildi', ortamiTani(UA.androidChrome, 5, false));
    expect(m.adimlar).toContain('"Uygulamayı yükle" ya da "Ana ekrana ekle"yi seçin.');
  });

  it('iPhone tarayıcıda: ana ekrana ekle (Chrome ile açılmış olsa da)', () => {
    for (const ua of [UA.iphoneSafari, UA.iphoneChrome]) {
      const m = kaliciDepolamaMesaji('reddedildi', ortamiTani(ua, 5, false));
      expect(m.neden).toContain('ana ekrana eklenmiş');
      expect(m.adimlar.join(' ')).toContain('Ana Ekrana Ekle');
    }
  });

  it('zaten yüklü uygulamada yükleme adımı tekrar önerilmez', () => {
    const m = kaliciDepolamaMesaji('reddedildi', ortamiTani(UA.androidChrome, 5, true));
    expect(m.neden).toContain('yüklü olduğu hâlde');
    expect(m.adimlar.join(' ')).not.toContain('Uygulamayı yükle');
  });

  it('Firefox: kilit simgesinden izni açma', () => {
    const m = kaliciDepolamaMesaji('reddedildi', ortamiTani(UA.firefox, 0, false));
    expect(m.adimlar[0]).toContain('kilit simgesine');
  });

  it('güvensiz bağlantı ve desteklenmeyen tarayıcı ayrı anlatılır', () => {
    const ortam = ortamiTani(UA.windowsChrome, 0, false);
    expect(kaliciDepolamaMesaji('guvensiz_baglanti', ortam).neden).toContain('https');
    expect(kaliciDepolamaMesaji('desteklenmiyor', ortam).neden).toContain('desteklemiyor');
  });
});
