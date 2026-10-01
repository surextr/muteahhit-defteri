import type { Cihaz, DepolamaDurumu, KaliciDepolamaSonucu } from './cihaz';
import { ortamiTani, type OrtamBilgisi } from './ortam';

export class TarayiciCihaz implements Cihaz {
  async kaliciDepolamaIste(): Promise<KaliciDepolamaSonucu> {
    if (!isSecureContext) return 'guvensiz_baglanti';
    if (!navigator.storage?.persist) return 'desteklenmiyor';
    try {
      if (await navigator.storage.persisted()) return 'verildi';
      return (await navigator.storage.persist()) ? 'verildi' : 'reddedildi';
    } catch {
      return 'desteklenmiyor';
    }
  }

  ortamBilgisi(): OrtamBilgisi {
    const anaEkran =
      matchMedia('(display-mode: standalone)').matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    return ortamiTani(navigator.userAgent, navigator.maxTouchPoints ?? 0, anaEkran);
  }

  async depolamaDurumu(): Promise<DepolamaDurumu> {
    const kalici = (await navigator.storage?.persisted?.()) ?? false;
    const tahmin = await navigator.storage?.estimate?.();
    return { kalici, kullanilan: tahmin?.usage ?? null, kota: tahmin?.quota ?? null };
  }

  async dosyaKaydet(dosya: Blob, dosyaAdi: string): Promise<void> {
    const url = URL.createObjectURL(dosya);
    const a = document.createElement('a');
    a.href = url;
    a.download = dosyaAdi;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
