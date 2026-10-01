import type { Tarih } from '../veri/tipler';

const iki = (n: number) => String(n).padStart(2, '0');

const zamanBicimi = new Intl.DateTimeFormat('tr-TR', { dateStyle: 'medium', timeStyle: 'short' });

/** "1 Eki 2026 09:00" */
export function zamanYaz(zaman: string): string {
  return zamanBicimi.format(new Date(zaman));
}

/** Cihazın yerel saatine göre takvim günü, 'YYYY-AA-GG'. */
export function yerelGun(zaman: Date): Tarih {
  return `${zaman.getFullYear()}-${iki(zaman.getMonth() + 1)}-${iki(zaman.getDate())}`;
}
