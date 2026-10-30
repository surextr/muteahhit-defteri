import type { Kurus, Tarih } from '../veri/tipler';

// "Bugün" ekranı: vadesi geçmiş ve yaklaşan işler (saf).

export type VadeTuru = 'odenecek_fatura' | 'tahsil_alacak' | 'alinan_cek' | 'verilen_cek' | 'kredi_taksiti';

export interface VadeKalemi {
  tur: VadeTuru;
  id: string;
  vade: Tarih;
  tutar: Kurus;
  /** Cari adı ve kısa açıklama (örn. "Ayşe Kaya · A-6 taksit"). */
  baslik: string;
  ayrinti: string;
  /** Ekran yolu (#/ olmadan). */
  yol: string;
}

export interface VadeGruplari {
  gecikmis: VadeKalemi[];
  /** Bugün dahil `gun` gün içinde. */
  yaklasan: VadeKalemi[];
}

export const gunFarki = (a: Tarih, b: Tarih) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** Vadesi geçmişler (en eski önce) ve `gun` gün içinde dolacaklar (en yakın önce); sonrakiler atılır. */
export function vadeleriGrupla(kalemler: VadeKalemi[], bugun: Tarih, gun = 7): VadeGruplari {
  const sirali = [...kalemler].filter((k) => k.tutar > 0).sort((a, b) => a.vade.localeCompare(b.vade) || b.tutar - a.tutar);
  return {
    gecikmis: sirali.filter((k) => k.vade < bugun),
    yaklasan: sirali.filter((k) => k.vade >= bugun && gunFarki(k.vade, bugun) <= gun),
  };
}

/** "3 gün geçti", "bugün", "yarın", "5 gün sonra". */
export function vadeMetni(vade: Tarih, bugun: Tarih): string {
  const f = gunFarki(vade, bugun);
  if (f === 0) return 'bugün';
  if (f === 1) return 'yarın';
  if (f < 0) return `${-f} gün geçti`;
  return `${f} gün sonra`;
}

/** Bir türün toplamı. */
export const toplam = (kalemler: VadeKalemi[], tur?: VadeTuru) => kalemler.filter((k) => !tur || k.tur === tur).reduce((t, k) => t + k.tutar, 0);
