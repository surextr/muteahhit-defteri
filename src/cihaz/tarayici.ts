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

  dosyaSec(kabul: string): Promise<File | null> {
    return dosyaGirdisi(kabul, false).then((l) => l[0] ?? null);
  }

  dosyalarSec(kabul: string): Promise<File[]> {
    return dosyaGirdisi(kabul, true);
  }

  fotografCek(): Promise<File | null> {
    return dosyaGirdisi('image/*', false, 'environment').then((l) => l[0] ?? null);
  }

  async resimKucult(dosya: Blob, enUzun = 1600, kalite = 0.8): Promise<Blob> {
    if (!dosya.type.startsWith('image/') || dosya.type === 'image/svg+xml' || dosya.type === 'image/gif') return dosya;
    let resim: ImageBitmap;
    try {
      resim = await createImageBitmap(dosya, { imageOrientation: 'from-image' });
    } catch {
      return dosya; // HEIC gibi tarayıcının açamadığı biçim
    }
    const oran = Math.min(1, enUzun / Math.max(resim.width, resim.height));
    const tuval = document.createElement('canvas');
    tuval.width = Math.round(resim.width * oran);
    tuval.height = Math.round(resim.height * oran);
    tuval.getContext('2d')?.drawImage(resim, 0, 0, tuval.width, tuval.height);
    resim.close();
    const kucuk = await new Promise<Blob | null>((coz) => tuval.toBlob(coz, 'image/jpeg', kalite));
    return kucuk && kucuk.size < dosya.size ? kucuk : dosya;
  }

  dosyaAc(dosya: Blob, dosyaAdi: string): void {
    const url = URL.createObjectURL(dosya);
    // Açılmazsa (açılır pencere engeli) indirilir.
    if (!window.open(url, '_blank')) void this.dosyaKaydet(dosya, dosyaAdi);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function dosyaGirdisi(kabul: string, coklu: boolean, kamera?: 'environment'): Promise<File[]> {
  return new Promise((coz) => {
    const girdi = document.createElement('input');
    girdi.type = 'file';
    girdi.accept = kabul;
    girdi.multiple = coklu;
    if (kamera) girdi.setAttribute('capture', kamera);
    girdi.addEventListener('change', () => coz([...(girdi.files ?? [])]));
    girdi.addEventListener('cancel', () => coz([]));
    girdi.click();
  });
}
