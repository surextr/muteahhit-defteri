import type { Kurus, MalzemeHareketi, MalzemeTalebi, MalzemeTeklifi, Tarih } from '../veri/tipler';
import { birimAnahtari } from './fiyat';
import { aramaAnahtari } from './metin';

// Malzeme talebi ve şantiye stoku (saf): talep durumu, teklif karşılaştırması, stok özeti, kayıt denetimi.

export type TalepDurumu = 'acik' | 'teklif' | 'siparis' | 'kismen' | 'teslim' | 'kapandi';

export const TALEP_DURUMU_ADI: Record<TalepDurumu, string> = {
  acik: 'Teklif bekliyor',
  teklif: 'Teklif seçilecek',
  siparis: 'Sipariş verildi',
  kismen: 'Kısmen teslim',
  teslim: 'Teslim alındı',
  kapandi: 'Kapatıldı',
};

/** Talebin satırlarına teslim alınan miktarlar (iptal edilmemiş giriş hareketleri). */
export function teslimMiktarlari(talepId: string, hareketler: Pick<MalzemeHareketi, 'iptal' | 'talepId' | 'talepSatiriId' | 'tur' | 'miktar'>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of hareketler)
    if (!h.iptal && h.tur === 'giris' && h.talepId === talepId && h.talepSatiriId) m.set(h.talepSatiriId, (m.get(h.talepSatiriId) ?? 0) + h.miktar);
  return m;
}

export function talepDurumu(t: Pick<MalzemeTalebi, 'satirlar' | 'teklifler' | 'seciliTeklifId' | 'kapandi'>, teslim: ReadonlyMap<string, number>): TalepDurumu {
  const tamam = t.satirlar.length > 0 && t.satirlar.every((s) => (teslim.get(s.id) ?? 0) >= s.miktar - 1e-9);
  if (tamam) return 'teslim';
  if (t.kapandi) return 'kapandi';
  if ([...teslim.values()].some((x) => x > 0)) return 'kismen';
  if (t.seciliTeklifId) return 'siparis';
  return t.teklifler.length ? 'teklif' : 'acik';
}

export interface TeklifToplami {
  teklif: MalzemeTeklifi;
  /** Fiyatı verilen satırların toplamı (KDV hariç). */
  tutar: Kurus;
  kdv: Kurus;
  /** Fiyat verilmeyen satır sayısı (eksik teklif). */
  eksik: number;
}

export interface TeklifKarsilastirmasi {
  toplamlar: TeklifToplami[];
  /** Satır → en düşük birim fiyatlı teklif kimliği. */
  enUcuz: Map<string, string>;
  /** Bütün satırlara fiyat veren teklifler içinde toplamı en düşük olan. */
  enIyi: string | null;
}

export function teklifKarsilastir(t: Pick<MalzemeTalebi, 'satirlar' | 'teklifler'>): TeklifKarsilastirmasi {
  const toplamlar = t.teklifler.map((k): TeklifToplami => {
    let tutar = 0;
    let eksik = 0;
    for (const s of t.satirlar) {
      const f = k.fiyatlar[s.id];
      if (f === null || f === undefined) eksik++;
      else tutar += Math.round(f * s.miktar);
    }
    return { teklif: k, tutar, kdv: Math.round((tutar * k.kdvOrani) / 100), eksik };
  });
  const enUcuz = new Map<string, string>();
  for (const s of t.satirlar) {
    let en: { id: string; f: Kurus } | null = null;
    for (const k of t.teklifler) {
      const f = k.fiyatlar[s.id];
      if (f !== null && f !== undefined && (!en || f < en.f)) en = { id: k.id, f };
    }
    if (en) enUcuz.set(s.id, en.id);
  }
  const tam = toplamlar.filter((x) => x.eksik === 0);
  const enIyi = tam.length ? tam.reduce((a, b) => (b.tutar + b.kdv < a.tutar + a.kdv ? b : a)).teklif.id : null;
  return { toplamlar, enUcuz, enIyi };
}

export interface StokSatiri {
  anahtar: string;
  ad: string;
  birim: string;
  giris: number;
  cikis: number;
  kalan: number;
  sonTarih: Tarih;
}

const yuvarla = (n: number) => Math.round(n * 1000) / 1000;

/** Aynı ad (Türkçe harfsiz, büyük/küçük farksız) ve birim bir stok kalemidir. */
export const stokAnahtari = (ad: string, birim: string) => `${aramaAnahtari(ad).replace(/\s+/g, ' ').trim()}|${birimAnahtari(birim)}`;

export function stokOzeti(hareketler: MalzemeHareketi[]): StokSatiri[] {
  const m = new Map<string, StokSatiri>();
  for (const h of [...hareketler].sort((a, b) => a.tarih.localeCompare(b.tarih))) {
    if (h.iptal) continue;
    const k = stokAnahtari(h.ad, h.birim);
    const x = m.get(k) ?? { anahtar: k, ad: h.ad, birim: h.birim, giris: 0, cikis: 0, kalan: 0, sonTarih: h.tarih };
    if (h.tur === 'giris') x.giris = yuvarla(x.giris + h.miktar);
    else x.cikis = yuvarla(x.cikis + h.miktar);
    x.kalan = yuvarla(x.giris - x.cikis);
    x.sonTarih = h.tarih;
    m.set(k, x);
  }
  return [...m.values()].sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
}

export type TalepIcerigi = Pick<MalzemeTalebi, 'tarih' | 'gerekenTarih' | 'satirlar' | 'aciklama'>;

export function talepHatalari(t: TalepIcerigi): string[] {
  const h: string[] = [];
  const tarih = /^\d{4}-\d{2}-\d{2}$/;
  if (!tarih.test(t.tarih)) h.push('Talep tarihini seçin.');
  if (t.gerekenTarih && !tarih.test(t.gerekenTarih)) h.push('Gereken tarihi gün.ay.yıl olarak seçin.');
  if (!t.satirlar.length) h.push('En az bir malzeme yazın.');
  for (const s of t.satirlar) {
    if (!s.ad.trim()) h.push('Malzemenin adını yazın.');
    if (!s.birim.trim()) h.push(`${s.ad || 'Malzeme'}: birimi yazın.`);
    if (!Number.isFinite(s.miktar) || s.miktar <= 0) h.push(`${s.ad || 'Malzeme'}: miktarı yazın.`);
  }
  if (new Set(t.satirlar.map((s) => s.id)).size !== t.satirlar.length) h.push('Satırlar tekrarlanıyor.');
  return [...new Set(h)];
}
