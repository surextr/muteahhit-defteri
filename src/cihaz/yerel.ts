import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import type { KaliciDepolamaSonucu } from './cihaz';
import type { OrtamBilgisi } from './ortam';
import { TarayiciCihaz } from './tarayici';

// Mağaza uygulaması (Capacitor, Android ve iPhone). Uygulamanın web görünümünde indirme (a[download], blob adresi) ve
// dosyalı Web Share çalışmaz: dosya uygulamanın geçici klasörüne yazılır, telefonun paylaş menüsü açılır (Dosyalar'a /
// Drive'a kaydet, WhatsApp, e-posta…). Kamera, dosya seçme ve konum web görünümünün kendi desteğiyle çalışır.

const base64 = (b: Blob) =>
  new Promise<string>((coz, red) => {
    const r = new FileReader();
    r.onload = () => coz(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => red(new Error('Dosya okunamadı.'));
    r.readAsDataURL(b);
  });

const guvenliAd = (ad: string) => ad.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'dosya';

/** Dosyayı geçici klasöre yazar, paylaş menüsünü açar. Vazgeçilirse false. */
export async function yerelPaylas(dosya: Blob, dosyaAdi: string, metin?: string): Promise<boolean> {
  const { uri } = await Filesystem.writeFile({
    path: `paylasim/${guvenliAd(dosyaAdi)}`,
    data: await base64(dosya),
    directory: Directory.Cache,
    recursive: true,
  });
  try {
    await Share.share({ title: dosyaAdi, text: metin, files: [uri], dialogTitle: dosyaAdi });
    return true;
  } catch (e) {
    // Kullanıcı menüyü kapatınca eklenti hata verir ("Share canceled").
    if (/cancel/i.test(String((e as Error)?.message ?? e))) return false;
    throw e;
  }
}

export class YerelCihaz extends TarayiciCihaz {
  /** Uygulama verisi telefonun uygulama alanındadır; tarayıcı gibi kendiliğinden silinmez. */
  override async kaliciDepolamaIste(): Promise<KaliciDepolamaSonucu> {
    return 'verildi';
  }

  override ortamBilgisi(): OrtamBilgisi {
    return { ...super.ortamBilgisi(), anaEkranUygulamasi: true };
  }

  override async dosyaKaydet(dosya: Blob, dosyaAdi: string): Promise<void> {
    await yerelPaylas(dosya, dosyaAdi);
  }

  override dosyaAc(dosya: Blob, dosyaAdi: string): void {
    void yerelPaylas(dosya, dosyaAdi);
  }
}
