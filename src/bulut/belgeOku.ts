import { IsKuraliHatasi } from '../servisler/kayitServisi';
import { cevrimici, istek } from './api';

// Belgeyi (fotoğraf/PDF) sunucumuz üzerinden Claude'a okutur. Yalnız kullanıcı Ayarlar'da rıza verdiyse çağrılır.
// Yanıt güvenilmez veridir; hesap/yzOkuma.ts ile denetlenerek kullanılır.

export const YZ_OKUNUR = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

async function base64(dosya: Blob): Promise<string> {
  const bayt = new Uint8Array(await dosya.arrayBuffer());
  let ikili = '';
  for (let i = 0; i < bayt.length; i += 0x8000) ikili += String.fromCharCode(...bayt.subarray(i, i + 0x8000));
  return btoa(ikili);
}

export interface BelgeOkumaYaniti {
  sonuc: unknown;
  kalanHak: number;
}

export async function belgeyiOkut(dosya: Blob, amac: 'tani' | 'sozlesme', firma: { ad: string; vergiNo: string }): Promise<BelgeOkumaYaniti> {
  if (!cevrimici()) throw new IsKuraliHatasi('İnternet yok; belge internet gelince okunabilir.');
  if (!YZ_OKUNUR.has(dosya.type)) throw new IsKuraliHatasi('Yapay zekâ yalnızca fotoğraf ve PDF okur.');
  const y = await istek<{ sonuc?: unknown; kalanHak?: unknown }>('belge_oku', { mime: dosya.type, veri: await base64(dosya), amac, firma });
  if (!y.sonuc || typeof y.sonuc !== 'object') throw new IsKuraliHatasi('Belge okunamadı; formu elle doldurun.');
  return { sonuc: y.sonuc, kalanHak: typeof y.kalanHak === 'number' ? y.kalanHak : 0 };
}
