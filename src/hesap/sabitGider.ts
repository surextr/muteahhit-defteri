import type { Kurus, SabitGider, SabitGiderPeriyodu, Tarih } from '../veri/tipler';

// Sabit giderler (saf): tekrar günleri, o ay girilmiş mi, nakit tahminine girecek tekrarlar, girilmemiş geçmiş tekrarlar.

export const PERIYOT_ADI: Record<SabitGiderPeriyodu, string> = { aylik: 'Her ay', ucAylik: 'Üç ayda bir', yillik: 'Yılda bir' };
const ARALIK: Record<SabitGiderPeriyodu, number> = { aylik: 1, ucAylik: 3, yillik: 12 };

const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const ayGunu = (yil: number, ay: number) => new Date(Date.UTC(yil, ay, 0)).getUTCDate();
const iki = (n: number) => String(n).padStart(2, '0');

export type SabitGiderIcerigi = Pick<SabitGider, 'ad' | 'tutar' | 'periyot' | 'gun' | 'baslangic' | 'bitis' | 'cariId' | 'projeId' | 'kalemId' | 'not'>;

export function sabitGiderHatalari(g: SabitGiderIcerigi): string[] {
  const h: string[] = [];
  if (!g.ad.trim()) h.push('Adını yazın (kira, maaş…).');
  if (!Number.isInteger(g.tutar) || g.tutar <= 0) h.push('Tutarı yazın.');
  if (!Number.isInteger(g.gun) || g.gun < 1 || g.gun > 31) h.push('Ayın günü 1 ile 31 arasında olmalı.');
  if (!TARIH.test(g.baslangic)) h.push('Başlangıç tarihini seçin.');
  if (g.bitis && (!TARIH.test(g.bitis) || g.bitis < g.baslangic)) h.push('Bitiş başlangıçtan önce olamaz.');
  return h;
}

/** Aylık karşılığı (üç aylık / 3, yıllık / 12). */
export const aylikKarsilik = (s: Pick<SabitGider, 'tutar' | 'periyot'>): Kurus => Math.round(s.tutar / ARALIK[s.periyot]);

/** `bas`–`bit` (dahil) arasındaki tekrar günleri; kısa ayda ayın son günü. */
export function tekrarTarihleri(s: Pick<SabitGider, 'periyot' | 'gun' | 'baslangic' | 'bitis'>, bas: Tarih, bit: Tarih): Tarih[] {
  const sonuc: Tarih[] = [];
  const by = Number(s.baslangic.slice(0, 4));
  const ba = Number(s.baslangic.slice(5, 7));
  const son = s.bitis && s.bitis < bit ? s.bitis : bit;
  for (let i = 0; ; i += ARALIK[s.periyot]) {
    const t = by * 12 + (ba - 1) + i;
    const yil = Math.floor(t / 12);
    const ay = (t % 12) + 1;
    const tarih = `${yil}-${iki(ay)}-${iki(Math.min(s.gun, ayGunu(yil, ay)))}`;
    if (tarih > son) break;
    if (tarih >= bas && tarih >= s.baslangic) sonuc.push(tarih);
  }
  return sonuc;
}

/** Ay içinde girilmiş giderler: cari ve satır kalemleri. */
export interface AyGideri {
  ay: string;
  cariId: string | null;
  kalemIdleri: string[];
}

/** O ay bu sabit gidere uyan gider girildi mi: carili sabitte aynı cari, carisizde aynı kalem. */
export function ayindaGirildi(s: Pick<SabitGider, 'cariId' | 'kalemId'>, ay: string, giderler: AyGideri[]): boolean {
  if (!s.cariId && !s.kalemId) return false;
  return giderler.some((g) => g.ay === ay && (s.cariId ? g.cariId === s.cariId : g.kalemIdleri.includes(s.kalemId!)));
}

export interface SabitTekrar {
  sabit: SabitGider;
  tarih: Tarih;
}

/** Bugünden `bit`e kadar girilmemiş tekrarlar (nakit tahmini). */
export function gelecekTekrarlar(sabitler: SabitGider[], giderler: AyGideri[], bugun: Tarih, bit: Tarih): SabitTekrar[] {
  return sabitler
    .filter((s) => s.iptal === null)
    .flatMap((s) => tekrarTarihleri(s, bugun, bit).filter((t) => !ayindaGirildi(s, t.slice(0, 7), giderler)).map((tarih) => ({ sabit: s, tarih })));
}

/** Bu ay günü geçmiş, gideri girilmemiş tekrarlar (Tamamlanacak işler). */
export function girilmeyenTekrarlar(sabitler: SabitGider[], giderler: AyGideri[], bugun: Tarih): SabitTekrar[] {
  const ayBasi = `${bugun.slice(0, 7)}-01`;
  return sabitler
    .filter((s) => s.iptal === null && (s.cariId || s.kalemId))
    .flatMap((s) => tekrarTarihleri(s, ayBasi, bugun).filter((t) => t < bugun && !ayindaGirildi(s, t.slice(0, 7), giderler)).map((tarih) => ({ sabit: s, tarih })));
}
