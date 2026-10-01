import type { Tarih } from '../veri/tipler';

const iki = (n: number) => String(n).padStart(2, '0');

/** Cihazın yerel saatine göre takvim günü, 'YYYY-AA-GG'. */
export function yerelGun(zaman: Date): Tarih {
  return `${zaman.getFullYear()}-${iki(zaman.getMonth() + 1)}-${iki(zaman.getDate())}`;
}
