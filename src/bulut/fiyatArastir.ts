import { arastirmaYanitiniDenetle } from '../hesap/fiyat';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import type { FiyatArastirmasi, FiyatKalemi, Tarih } from '../veri/tipler';
import { cevrimici, istek } from './api';

// Fiyat kataloğundaki kalemleri sunucumuz üzerinden Claude'a (web aramalı) araştırtır. Gönderilen yalnız kalem adı,
// birimi, açıklaması ve il. Yanıt güvenilmez veridir; hesap/fiyat.ts `arastirmaYanitiniDenetle` ile denetlenir.

/** Bir seferde araştırılan kalem sayısı (sunucu sınırı 10; arama uzun sürmesin diye 5). */
export const ARASTIRMA_PAKETI = 5;

export interface ArastirmaYaniti {
  sonuclar: Map<string, FiyatArastirmasi>;
  kalanHak: number;
}

export async function fiyatlariArastir(kalemler: FiyatKalemi[], il: string | null, bugun: Tarih): Promise<ArastirmaYaniti> {
  if (!cevrimici()) throw new IsKuraliHatasi('İnternet yok; fiyat araştırması internet gelince yapılabilir.');
  if (!kalemler.length) throw new IsKuraliHatasi('Araştırılacak kalem seçin.');
  const y = await istek<{ sonuclar?: unknown; kalanHak?: unknown }>('fiyat_arastir', {
    kalemler: kalemler.map((k) => ({ id: k.id, tur: k.tur, ad: k.ad, birim: k.birim, aciklama: k.aciklama })),
    il,
  });
  return {
    sonuclar: arastirmaYanitiniDenetle(y, kalemler.map((k) => k.id), bugun),
    kalanHak: typeof y.kalanHak === 'number' ? y.kalanHak : 0,
  };
}
