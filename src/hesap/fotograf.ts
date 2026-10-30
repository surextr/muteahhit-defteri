import type { Tarih } from '../veri/tipler';

// Şantiye fotoğrafları (saf): fotoğraftaki EXIF bilgisinden çekim tarihi ve konum, dosya adından tarih, konuma göre proje,
// aylara gruplama. Fotoğraf telefonda küçültülünce EXIF silinir; bu yüzden okuma küçültmeden önce yapılır.

export interface Konum {
  enlem: number;
  boylam: number;
}

export interface ExifBilgisi {
  tarih: Tarih | null;
  /** 'SS:DD' */
  zaman: string | null;
  konum: Konum | null;
}

export type TarihKaynagi = 'exif' | 'dosyaAdi' | 'elle';

const BOS: ExifBilgisi = { tarih: null, zaman: null, konum: null };

const gecerliTarih = (y: number, a: number, g: number) => {
  if (y < 1990 || y > 2100 || a < 1 || a > 12 || g < 1) return false;
  return g <= new Date(Date.UTC(y, a, 0)).getUTCDate();
};
const iki = (n: number) => String(n).padStart(2, '0');

/** "2026:10:12 14:35:22" → tarih ve saat. */
function exifTarihi(s: string): Pick<ExifBilgisi, 'tarih' | 'zaman'> | null {
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/.exec(s.trim());
  if (!m) return null;
  const [y, a, g, sa, dk] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (!gecerliTarih(y, a, g) || sa > 23 || dk > 59) return null;
  return { tarih: `${y}-${iki(a)}-${iki(g)}`, zaman: `${iki(sa)}:${iki(dk)}` };
}

/**
 * JPEG içindeki EXIF'ten çekim tarihi (DateTimeOriginal, yoksa DateTimeDigitized, yoksa DateTime) ve GPS konumu.
 * Bozuk ya da EXIF'siz dosyada boş döner; hiçbir zaman hata atmaz.
 */
export function exifOku(b: Uint8Array): ExifBilgisi {
  try {
    if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return BOS;
    let i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) return BOS;
      const isaret = b[i + 1]!;
      if (isaret === 0xda || isaret === 0xd9) return BOS; // görüntü verisi başladı; EXIF yok
      const uzunluk = (b[i + 2]! << 8) | b[i + 3]!;
      if (isaret === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 && b[i + 8] === 0 && b[i + 9] === 0) {
        return tiffOku(b.subarray(i + 10, i + 2 + uzunluk));
      }
      i += 2 + uzunluk;
    }
  } catch {
    /* bozuk dosya */
  }
  return BOS;
}

function tiffOku(t: Uint8Array): ExifBilgisi {
  const v = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const kucukUclu = t[0] === 0x49 && t[1] === 0x49;
  if (!kucukUclu && !(t[0] === 0x4d && t[1] === 0x4d)) return BOS;
  const u16 = (o: number) => v.getUint16(o, kucukUclu);
  const u32 = (o: number) => v.getUint32(o, kucukUclu);
  if (u16(2) !== 42) return BOS;

  /** IFD'deki etiketler: etiket → { tür, sayı, değerin yeri }. */
  const ifd = (konum: number) => {
    const m = new Map<number, { tur: number; sayi: number; deger: number }>();
    if (konum <= 0 || konum + 2 > t.length) return m;
    const adet = u16(konum);
    for (let k = 0; k < adet && konum + 2 + k * 12 + 12 <= t.length; k++) {
      const g = konum + 2 + k * 12;
      const tur = u16(g + 2);
      const sayi = u32(g + 4);
      const boyut = ({ 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 } as Record<number, number>)[tur] ?? 1;
      m.set(u16(g), { tur, sayi, deger: boyut * sayi <= 4 ? g + 8 : u32(g + 8) });
    }
    return m;
  };
  const metin = (e?: { sayi: number; deger: number }) => {
    if (!e || e.deger + e.sayi > t.length) return '';
    let s = '';
    for (let k = 0; k < e.sayi && t[e.deger + k] !== 0; k++) s += String.fromCharCode(t[e.deger + k]!);
    return s;
  };
  const rasyonel = (e: { tur: number; sayi: number; deger: number } | undefined, n: number) => {
    if (!e || e.tur !== 5 || e.sayi < n || e.deger + n * 8 > t.length) return null;
    return Array.from({ length: n }, (_, k) => {
      const pay = u32(e.deger + k * 8);
      const payda = u32(e.deger + k * 8 + 4);
      return payda === 0 ? 0 : pay / payda;
    });
  };

  const ana = ifd(u32(4));
  const exifKonumu = ana.get(0x8769);
  const exif = exifKonumu ? ifd(u32(exifKonumu.deger)) : new Map();
  const zaman = exifTarihi(metin(exif.get(0x9003))) ?? exifTarihi(metin(exif.get(0x9004))) ?? exifTarihi(metin(ana.get(0x0132)));

  let konum: Konum | null = null;
  const gpsKonumu = ana.get(0x8825);
  if (gpsKonumu) {
    const gps = ifd(u32(gpsKonumu.deger));
    const en = rasyonel(gps.get(2), 3);
    const boy = rasyonel(gps.get(4), 3);
    if (en && boy) {
      const derece = (d: number[]) => d[0]! + d[1]! / 60 + d[2]! / 3600;
      const enlem = derece(en) * (metin(gps.get(1)) === 'S' ? -1 : 1);
      const boylam = derece(boy) * (metin(gps.get(3)) === 'W' ? -1 : 1);
      // 0,0 çoğu zaman "konum yok" demektir.
      if (Math.abs(enlem) <= 90 && Math.abs(boylam) <= 180 && !(enlem === 0 && boylam === 0)) konum = { enlem, boylam };
    }
  }
  return { tarih: zaman?.tarih ?? null, zaman: zaman?.zaman ?? null, konum };
}

/**
 * Dosya adındaki tarih: "IMG-20261012-WA0003.jpg", "IMG_20261012_143522.jpg", "PXL_20261012_…", "20261012_143522.jpg",
 * "WhatsApp Image 2026-10-12 at 14.35.22.jpeg", "Screenshot_2026-10-12-14-35-22.png".
 */
export function dosyaAdindanTarih(ad: string): { tarih: Tarih; zaman: string | null } | null {
  const m = /(?:^|[^\d])(20\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:(?:[ _-]|\sat\s|T)(\d{2})[-_.:]?(\d{2})(?:[-_.:]?\d{2})?)?(?!\d)/.exec(ad);
  if (!m) return null;
  const [y, a, g] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!gecerliTarih(y, a, g)) return null;
  const sa = m[4] !== undefined ? Number(m[4]) : null;
  const dk = m[5] !== undefined ? Number(m[5]) : null;
  const zaman = sa !== null && dk !== null && sa <= 23 && dk <= 59 ? `${iki(sa)}:${iki(dk)}` : null;
  return { tarih: `${y}-${iki(a)}-${iki(g)}`, zaman };
}

/** Çekim tarihi: önce EXIF, sonra dosya adı; ikisi de yoksa elle girilecek (tarih null). */
export function cekimTarihiBul(exif: ExifBilgisi, dosyaAdi: string): { tarih: Tarih | null; zaman: string | null; kaynak: TarihKaynagi } {
  if (exif.tarih) return { tarih: exif.tarih, zaman: exif.zaman, kaynak: 'exif' };
  const d = dosyaAdindanTarih(dosyaAdi);
  if (d) return { ...d, kaynak: 'dosyaAdi' };
  return { tarih: null, zaman: null, kaynak: 'elle' };
}

/** İki nokta arası kuş uçuşu km (haversine). */
export function mesafeKm(a: Konum, b: Konum): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const h = Math.sin(r(b.enlem - a.enlem) / 2) ** 2 + Math.cos(r(a.enlem)) * Math.cos(r(b.enlem)) * Math.sin(r(b.boylam - a.boylam) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Şantiyeye bu kadar yakın çekilen fotoğraf o projenindir. */
export const SANTIYE_YARICAPI_KM = 1;

/** Fotoğrafın çekildiği yere en yakın, yarıçap içindeki proje. */
export function konumdanProje<T extends { id: string; konum: Konum | null }>(konum: Konum | null, projeler: T[], yaricapKm = SANTIYE_YARICAPI_KM): T | null {
  if (!konum) return null;
  let en: { p: T; d: number } | null = null;
  for (const p of projeler) {
    if (!p.konum) continue;
    const d = mesafeKm(konum, p.konum);
    if (d <= yaricapKm && (!en || d < en.d)) en = { p, d };
  }
  return en?.p ?? null;
}

/** "41.0082, 28.9784", Google Haritalar bağlantısı ("@41.0082,28.9784,17z", "?q=41.0082,28.9784", "!3d41.0082!4d28.9784"). */
export function konumMetniCoz(s: string): Konum | null {
  const t = s.trim();
  const desen = [/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/, /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/, /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/, /^(-?\d+(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d+(?:[.,]\d+)?)$/];
  for (const d of desen) {
    const m = d.exec(t);
    if (!m) continue;
    const enlem = Number(m[1]!.replace(',', '.'));
    const boylam = Number(m[2]!.replace(',', '.'));
    if (Number.isFinite(enlem) && Number.isFinite(boylam) && Math.abs(enlem) <= 90 && Math.abs(boylam) <= 180) return { enlem, boylam };
  }
  return null;
}

/** Fotoğrafları aylara gruplar, en yeni ay ve en yeni fotoğraf önce. */
export function aylaraGore<T extends { cekimTarihi: Tarih; cekimZamani: string | null; olusturmaZamani: string }>(liste: T[]): { ay: string; fotograflar: T[] }[] {
  const sirali = [...liste].sort(
    (a, b) => b.cekimTarihi.localeCompare(a.cekimTarihi) || (b.cekimZamani ?? '').localeCompare(a.cekimZamani ?? '') || b.olusturmaZamani.localeCompare(a.olusturmaZamani),
  );
  const gruplar = new Map<string, T[]>();
  for (const f of sirali) {
    const ay = f.cekimTarihi.slice(0, 7);
    gruplar.set(ay, [...(gruplar.get(ay) ?? []), f]);
  }
  return [...gruplar].map(([ay, fotograflar]) => ({ ay, fotograflar }));
}
