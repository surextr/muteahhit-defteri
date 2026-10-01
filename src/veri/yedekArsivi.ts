import type { Zaman } from './tipler';

export interface ArsivKaydi {
  id: string;
  zaman: Zaman;
  tur: 'otomatik' | 'elle';
  /** örn. "Geri yükleme öncesi" */
  neden: string;
  semaSurumu: number;
  /** Yedek metninin uzunluğu (karakter). */
  boyut: number;
  /** Yedek dosyasının metni (servisler/yedek → yedekMetni). */
  icerik: string;
}

export type ArsivOzeti = Omit<ArsivKaydi, 'icerik'>;

/**
 * Cihazda tutulan otomatik yedekler. Ana veritabanından ayrı saklanır;
 * böylece geri yükleme ana veritabanını boşalttığında bunlar etkilenmez.
 */
export interface YedekArsivi {
  /** Kaydeder; en yeni `ARSIV_SINIRI` yedek kalacak şekilde eskileri atar. */
  kaydet(kayit: ArsivKaydi): Promise<void>;
  /** En yeni önce. */
  listele(): Promise<ArsivOzeti[]>;
  getir(id: string): Promise<ArsivKaydi | undefined>;
  kapat(): void;
}

export const ARSIV_SINIRI = 5;
