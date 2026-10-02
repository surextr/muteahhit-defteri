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

const GUN_MS = 86_400_000;

/** İki takvim günü arasındaki gün farkı (b − a); saat dilimi ve yaz saatinden etkilenmez. */
export function gunFarki(a: Tarih, b: Tarih): number {
  return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / GUN_MS);
}

export interface TeslimDurumu {
  metin: string;
  /** 'gecikti': planlanan geçti ya da geç teslim; 'yakin': 30 gün ya da az kaldı. */
  durum: 'normal' | 'yakin' | 'gecikti' | 'tamam';
}

/** "Teslime 124 gün kaldı", "12 gün gecikti", "5 gün erken teslim edildi". Planlanan yoksa null. */
export function teslimDurumu(planlanan: Tarih | null, gerceklesen: Tarih | null, bugun: Tarih): TeslimDurumu | null {
  if (gerceklesen) {
    if (!planlanan) return { metin: 'Teslim edildi', durum: 'tamam' };
    const f = gunFarki(planlanan, gerceklesen);
    if (f === 0) return { metin: 'Planlanan günde teslim edildi', durum: 'tamam' };
    return f < 0 ? { metin: `${-f} gün erken teslim edildi`, durum: 'tamam' } : { metin: `${f} gün geç teslim edildi`, durum: 'gecikti' };
  }
  if (!planlanan) return null;
  const kalan = gunFarki(bugun, planlanan);
  if (kalan < 0) return { metin: `Teslim ${-kalan} gün gecikti`, durum: 'gecikti' };
  if (kalan === 0) return { metin: 'Teslim bugün', durum: 'yakin' };
  return { metin: `Teslime ${kalan} gün kaldı`, durum: kalan <= 30 ? 'yakin' : 'normal' };
}
