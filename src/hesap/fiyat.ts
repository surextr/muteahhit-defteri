import type { FiyatArastirmasi, FiyatKaynagi, Kurus, Tarih } from '../veri/tipler';
import { aramaAnahtari } from './metin';

// Malzeme / işçilik fiyat kataloğu (saf): fiyatın eskiliği, birim eşleştirme, giderlerden "son alış" ve imzalı
// sözleşmelerden "son sözleşme" önerisi, yapay zekâ araştırma yanıtının denetimi.

export const FIYAT_KAYNAGI_ADI: Record<FiyatKaynagi, string> = {
  elle: 'Bildiğim fiyat',
  arastirma: 'Araştırdım',
  yz: 'Yapay zekâ araştırdı',
  sonAlis: 'Son alış',
  sonSozlesme: 'Son sözleşme',
};

/** Bu kadar günden eski fiyat "güncelleyin" diye işaretlenir. */
export const FIYAT_ESKIME_GUNU = 90;

export function gunFarki(a: Tarih, b: Tarih): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export const fiyatEskiMi = (tarih: Tarih | null, bugun: Tarih, gun = FIYAT_ESKIME_GUNU) => !!tarih && gunFarki(tarih, bugun) > gun;

export type FiyatDurumu = 'yok' | 'eski' | 'guncel';
export const fiyatDurumu = (k: { fiyat: Kurus | null; fiyatTarihi: Tarih | null }, bugun: Tarih): FiyatDurumu =>
  k.fiyat === null ? 'yok' : fiyatEskiMi(k.fiyatTarihi, bugun) ? 'eski' : 'guncel';

/** Birim yazımlarını birleştirir: "m3" = "m³", "mt" = "metre", "Ad." = "adet"… */
export function birimAnahtari(b: string | null | undefined): string {
  const s = aramaAnahtari(b ?? '').replace(/[.\s]/g, '');
  const esit: Record<string, string> = {
    m3: 'm³', 'm³': 'm³', metrekup: 'm³', m2: 'm²', 'm²': 'm²', metrekare: 'm²', mt: 'metre', m: 'metre', metre: 'metre', mtul: 'metre',
    ad: 'adet', adet: 'adet', ade: 'adet', tk: 'adet', takim: 'adet', kg: 'kg', kilo: 'kg', ton: 'ton', tn: 'ton', lt: 'litre', l: 'litre', litre: 'litre',
    torba: 'torba', torb: 'torba', paket: 'paket', saat: 'saat', sa: 'saat', gun: 'gün', ay: 'ay', sefer: 'sefer', daire: 'daire', goturu: 'götürü',
  };
  return esit[s] ?? s;
}

/** Bir birimdeki fiyatı katalog birimine çevirme çarpanı (kg↔ton); çevrilemiyorsa null. */
export function birimCarpani(kaynak: string | null | undefined, hedef: string): number | null {
  const a = birimAnahtari(kaynak);
  const b = birimAnahtari(hedef);
  if (a === b) return 1;
  if (a === 'kg' && b === 'ton') return 1000;
  if (a === 'ton' && b === 'kg') return 1 / 1000;
  return null;
}

const ANLAMSIZ = new Set(['ve', 'ile', 'icin', 'dahil', 'hazir', 'tip', 'cins', 'cm', 'mm', 'kg', 'adet', 'ton']);

/** Ad parçaları: sayılı parçalar ("c30", "12", "13,5") ve anlamlı sözcükler. Parantez içi ve "/37" eki atılır. */
export function adParcalari(ad: string): { sayili: string[]; sozcuk: string[] } {
  const parcalar = aramaAnahtari(ad.replace(/\(.*?\)/g, ' '))
    .replace(/\/\d+/g, ' ')
    .split(/[^a-z0-9,]+/)
    .map((x) => x.replace(/^,+|,+$/g, ''))
    .filter(Boolean);
  return {
    sayili: parcalar.filter((x) => /\d/.test(x)),
    sozcuk: parcalar.filter((x) => !/\d/.test(x) && x.length >= 3 && !ANLAMSIZ.has(x)),
  };
}

/** Gider satırı katalog kalemine benziyor mu: sayılı parçaların hepsi, sözcüklerin en az yarısı geçmeli. */
export function adBenzer(katalogAdi: string, metin: string): boolean {
  const k = adParcalari(katalogAdi);
  if (!k.sozcuk.length) return false;
  const m = adParcalari(metin);
  const sayilar = new Set(m.sayili);
  if (!k.sayili.every((x) => sayilar.has(x))) return false;
  const bulunan = k.sozcuk.filter((x) => m.sozcuk.some((y) => y.startsWith(x) || x.startsWith(y))).length;
  return bulunan >= Math.max(1, Math.ceil(k.sozcuk.length / 2));
}

export interface AlisSatiri {
  tarih: Tarih;
  aciklama: string;
  birim: string | null;
  birimFiyat: Kurus | null;
  miktar: number | null;
  kdvHaricTutar: Kurus;
  cariAdi: string | null;
}

export interface FiyatOnerisi {
  kaynak: 'sonAlis' | 'sonSozlesme';
  tarih: Tarih;
  /** Katalog birimine çevrilmiş, KDV hariç. */
  fiyat: Kurus;
  aciklama: string;
}

/** Giderlerden son alış: adı benzeyen, birimi uyan (kg↔ton çevrilir) en yeni satır. */
export function sonAlis(kalem: { ad: string; birim: string }, satirlar: AlisSatiri[]): FiyatOnerisi | null {
  let en: FiyatOnerisi | null = null;
  for (const s of satirlar) {
    if (!adBenzer(kalem.ad, s.aciklama)) continue;
    const carpan = birimCarpani(s.birim, kalem.birim);
    const birimFiyat = s.birimFiyat ?? (s.miktar ? Math.round(s.kdvHaricTutar / s.miktar) : null);
    if (carpan === null || birimFiyat === null || birimFiyat <= 0) continue;
    if (en && en.tarih >= s.tarih) continue;
    en = { kaynak: 'sonAlis', tarih: s.tarih, fiyat: Math.round(birimFiyat * carpan), aciklama: `${s.aciklama}${s.cariAdi ? ` · ${s.cariAdi}` : ''}` };
  }
  return en;
}

export interface SozlesmeFiyati {
  tarih: Tarih;
  ustaTipiKodu: string | null;
  ad: string;
  birim: string;
  birimFiyat: Kurus;
  cariAdi: string;
}

/** İmzalı sözleşmelerden son işçilik fiyatı: aynı usta tipi, aynı kalem adı ve birim. */
export function sonSozlesme(kalem: { ad: string; birim: string; ustaTipiKodu: string | null }, liste: SozlesmeFiyati[]): FiyatOnerisi | null {
  const kalemAdi = aramaAnahtari(kalem.ad.split(' · ').at(-1) ?? kalem.ad);
  let en: FiyatOnerisi | null = null;
  for (const s of liste) {
    if (s.birimFiyat <= 0 || birimAnahtari(s.birim) !== birimAnahtari(kalem.birim)) continue;
    if (kalem.ustaTipiKodu && s.ustaTipiKodu !== kalem.ustaTipiKodu) continue;
    if (aramaAnahtari(s.ad) !== kalemAdi) continue;
    if (en && en.tarih >= s.tarih) continue;
    en = { kaynak: 'sonSozlesme', tarih: s.tarih, fiyat: s.birimFiyat, aciklama: `${s.cariAdi} sözleşmesi` };
  }
  return en;
}

// ─── Yapay zekâ araştırma yanıtı ──────────────────────────────────

const tl = (x: unknown): Kurus | null => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1e9 ? Math.round(x * 100) : null);
const metin = (x: unknown, uz = 300) => (typeof x === 'string' ? x.trim().slice(0, uz) : '');

/**
 * Sunucudan gelen araştırma yanıtını denetler (yapay zekâ çıktısı güvenilmez): { sonuclar: [{ id, en_dusuk, en_yuksek,
 * onerilen, birim_notu, kaynaklar: [{ baslik, url, fiyat }] }] }. Bilinmeyen id ve bozuk alan atılır; https olmayan
 * bağlantı alınmaz; önerilen aralık dışındaysa aralığa çekilir.
 */
export function arastirmaYanitiniDenetle(veri: unknown, idler: string[], bugun: Tarih): Map<string, FiyatArastirmasi> {
  const sonuc = new Map<string, FiyatArastirmasi>();
  const liste = (veri as { sonuclar?: unknown } | null)?.sonuclar;
  if (!Array.isArray(liste)) return sonuc;
  const izinli = new Set(idler);
  for (const x of liste as Record<string, unknown>[]) {
    const id = typeof x?.id === 'string' ? x.id : '';
    if (!izinli.has(id) || sonuc.has(id)) continue;
    let enDusuk = tl(x.en_dusuk);
    let enYuksek = tl(x.en_yuksek);
    if (enDusuk !== null && enYuksek !== null && enDusuk > enYuksek) [enDusuk, enYuksek] = [enYuksek, enDusuk];
    let onerilen = tl(x.onerilen);
    if (onerilen !== null && enDusuk !== null && onerilen < enDusuk) onerilen = enDusuk;
    if (onerilen !== null && enYuksek !== null && onerilen > enYuksek) onerilen = enYuksek;
    const kaynaklar = (Array.isArray(x.kaynaklar) ? (x.kaynaklar as Record<string, unknown>[]) : [])
      .map((k) => ({ baslik: metin(k?.baslik, 120), url: metin(k?.url, 500), fiyat: tl(k?.fiyat) }))
      .filter((k) => /^https:\/\/[^\s]+$/.test(k.url))
      .slice(0, 6);
    sonuc.set(id, { tarih: bugun, enDusuk, enYuksek, onerilen, not: metin(x.birim_notu), kaynaklar });
  }
  return sonuc;
}
