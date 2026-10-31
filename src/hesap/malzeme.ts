import type { Kurus, MalzemeHareketi, MalzemeTalebi, MalzemeTeklifi, Tarih } from '../veri/tipler';
import { birimAnahtari } from './fiyat';
import { aramaAnahtari } from './metin';

// Malzeme talebi ve şantiye stoku (saf): talep durumu, teklif karşılaştırması, stok özeti, kayıt denetimi.

export type TalepDurumu = 'acik' | 'teklif' | 'onay' | 'siparis' | 'kismen' | 'teslim' | 'kapandi';

export const TALEP_DURUMU_ADI: Record<TalepDurumu, string> = {
  acik: 'Teklif bekliyor',
  teklif: 'Teklif seçilecek',
  onay: 'Sipariş onayı bekliyor',
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

/** Sipariş verildi mi: teklif seçildi ve onaylandı (eski kayıtta `siparis` alanı yok: seçim sipariş sayılır). */
export const siparisVerildi = (t: Pick<MalzemeTalebi, 'seciliTeklifId' | 'siparis'>) => !!t.seciliTeklifId && t.siparis !== null;

export function talepDurumu(t: Pick<MalzemeTalebi, 'satirlar' | 'teklifler' | 'seciliTeklifId' | 'kapandi' | 'siparis'>, teslim: ReadonlyMap<string, number>): TalepDurumu {
  const tamam = t.satirlar.length > 0 && t.satirlar.every((s) => (teslim.get(s.id) ?? 0) >= s.miktar - 1e-9);
  if (tamam) return 'teslim';
  if (t.kapandi) return 'kapandi';
  if ([...teslim.values()].some((x) => x > 0)) return 'kismen';
  if (t.seciliTeklifId && t.siparis === null) return 'onay';
  if (t.seciliTeklifId) return 'siparis';
  return t.teklifler.length ? 'teklif' : 'acik';
}

export interface TeklifToplami {
  teklif: MalzemeTeklifi;
  /** Fiyatı verilen satırların toplamı + nakliye (KDV hariç). */
  tutar: Kurus;
  nakliye: Kurus;
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
    const nakliye = k.nakliye ?? 0;
    tutar += nakliye;
    return { teklif: k, tutar, nakliye, kdv: Math.round((tutar * k.kdvOrani) / 100), eksik };
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

// ─── Satın alma zinciri: sipariş → teslim → fatura → ödeme ─────────────

export interface TalepFaturasi {
  giderId: string;
  tarih: Tarih;
  faturaNo: string | null;
  /** Cariye borç (KDV dahil, tevkifat düşülmüş) ve kalanı; ödenen = borç − kalan. */
  borc: Kurus;
  kalan: Kurus;
  /** KDV dahil toplam. */
  toplam: Kurus;
  satirlar: { aciklama: string; birim: string | null; miktar: number | null; kdvHaricTutar: Kurus; kdvTutari: Kurus }[];
}

export interface SatinAlmaSatiri {
  satirId: string;
  ad: string;
  birim: string;
  siparisMiktari: number;
  /** Sipariş birim fiyatı (KDV hariç); seçilen teklifte yoksa null. */
  siparisFiyati: Kurus | null;
  teslim: number;
  faturaMiktari: number;
  /** Faturalanan tutar (KDV hariç). */
  faturaTutari: Kurus;
  /** Fatura tutarı − faturalanan miktar × sipariş fiyatı (artı = pahalı faturalandı). */
  fiyatFarki: Kurus;
}

export type SatinAlmaUyariKodu = 'odenen_fazla' | 'fatura_fazla' | 'fiyat_farki' | 'faturasiz_teslim';

export interface SatinAlmaUyarisi {
  kod: SatinAlmaUyariKodu;
  metin: string;
  tutar: Kurus;
}

export interface SatinAlmaDurumu {
  satirlar: SatinAlmaSatiri[];
  /** KDV dahil, nakliye dahil sipariş tutarı. */
  siparisTutari: Kurus;
  /** Teslim alınanın KDV dahil değeri (sipariş fiyatıyla; teslim başladıysa nakliye dahil). */
  teslimDegeri: Kurus;
  faturaToplami: Kurus;
  odenen: Kurus;
  /** Faturalanmamış KDV dahil sipariş (siparişten kalan); nakit tahmini için. */
  faturalanmamis: Kurus;
  /** Talep satırına uymayan fatura satırları (nakliye vb., KDV hariç). */
  digerFatura: Kurus;
  uyarilar: SatinAlmaUyarisi[];
}

const PAY = 100; // 1 TL: yuvarlama farkı uyarı sayılmaz

/**
 * Seçilen teklif (sipariş), teslim hareketleri ve talebe bağlı faturalar karşılaştırılır. Fatura satırı talep satırına
 * ad + birim ile eşlenir (talepten "Fatura gir" bu adla doldurur); eşlenmeyen satır "diğer" (nakliye vb.) sayılır.
 */
export function satinAlmaDurumu(
  t: Pick<MalzemeTalebi, 'satirlar' | 'teklifler' | 'seciliTeklifId'>,
  teslim: ReadonlyMap<string, number>,
  faturalar: TalepFaturasi[],
): SatinAlmaDurumu {
  const teklif = t.teklifler.find((k) => k.id === t.seciliTeklifId) ?? null;
  const kdv = (teklif?.kdvOrani ?? 20) / 100;
  const anahtar = new Map(t.satirlar.map((s) => [stokAnahtari(s.ad, s.birim), s.id]));
  const adla = new Map(t.satirlar.map((s) => [aramaAnahtari(s.ad).replace(/\s+/g, ' ').trim(), s.id]));
  const fatura = new Map<string, { miktar: number; tutar: Kurus }>();
  let digerFatura = 0;
  for (const f of faturalar)
    for (const x of f.satirlar) {
      const id = anahtar.get(stokAnahtari(x.aciklama, x.birim ?? '')) ?? (x.birim ? undefined : adla.get(aramaAnahtari(x.aciklama).replace(/\s+/g, ' ').trim()));
      if (!id) {
        digerFatura += x.kdvHaricTutar;
        continue;
      }
      const v = fatura.get(id) ?? { miktar: 0, tutar: 0 };
      v.miktar = yuvarla(v.miktar + (x.miktar ?? 0));
      v.tutar += x.kdvHaricTutar;
      fatura.set(id, v);
    }

  const satirlar = t.satirlar.map((s): SatinAlmaSatiri => {
    const fiyat = teklif?.fiyatlar[s.id] ?? null;
    const f = fatura.get(s.id) ?? { miktar: 0, tutar: 0 };
    return {
      satirId: s.id,
      ad: s.ad,
      birim: s.birim,
      siparisMiktari: s.miktar,
      siparisFiyati: fiyat,
      teslim: teslim.get(s.id) ?? 0,
      faturaMiktari: f.miktar,
      faturaTutari: f.tutar,
      fiyatFarki: fiyat === null || f.miktar === 0 ? 0 : f.tutar - Math.round(f.miktar * fiyat),
    };
  });
  const nakliye = teklif?.nakliye ?? 0;
  const kdvli = (n: number) => Math.round(n * (1 + kdv));
  const siparisTutari = kdvli(satirlar.reduce((x, s) => x + Math.round(s.siparisMiktari * (s.siparisFiyati ?? 0)), 0) + nakliye);
  const teslimBasladi = satirlar.some((s) => s.teslim > 0);
  const teslimDegeri = kdvli(satirlar.reduce((x, s) => x + Math.round(s.teslim * (s.siparisFiyati ?? 0)), 0) + (teslimBasladi ? nakliye : 0));
  const faturaToplami = faturalar.reduce((x, f) => x + f.toplam, 0);
  const odenen = faturalar.reduce((x, f) => x + (f.borc - f.kalan), 0);

  const uyarilar: SatinAlmaUyarisi[] = [];
  const tl = (k: Kurus) => `${Math.round(k / 100).toLocaleString('tr-TR')} TL`;
  const sayi = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
  if (odenen > teslimDegeri + Math.max(PAY, teslimDegeri / 100))
    uyarilar.push({
      kod: 'odenen_fazla',
      metin: `Ödenen (${tl(odenen)}) teslim alınanın değerinden (${tl(teslimDegeri)}) fazla: parası ödenen malzemenin bir kısmı gelmedi.`,
      tutar: odenen - teslimDegeri,
    });
  for (const s of satirlar) {
    if (s.faturaMiktari > s.teslim + 1e-9)
      uyarilar.push({
        kod: 'fatura_fazla',
        metin: `${s.ad}: ${sayi(s.faturaMiktari)} ${s.birim} faturalandı, ${sayi(s.teslim)} ${s.birim} teslim alındı.`,
        tutar: s.siparisFiyati === null ? 0 : kdvli(Math.round((s.faturaMiktari - s.teslim) * s.siparisFiyati)),
      });
    if (Math.abs(s.fiyatFarki) > Math.max(PAY, Math.abs(s.faturaTutari) / 100))
      uyarilar.push({
        kod: 'fiyat_farki',
        metin: `${s.ad}: fatura sipariş fiyatından ${s.fiyatFarki > 0 ? 'pahalı' : 'ucuz'} (${s.fiyatFarki > 0 ? '+' : '−'}${tl(Math.abs(s.fiyatFarki))}, KDV hariç).`,
        tutar: s.fiyatFarki,
      });
    if (s.teslim > s.faturaMiktari + 1e-9)
      uyarilar.push({
        kod: 'faturasiz_teslim',
        metin: `${s.ad}: ${sayi(s.teslim - s.faturaMiktari)} ${s.birim} teslim alındı, faturası girilmedi.`,
        tutar: s.siparisFiyati === null ? 0 : kdvli(Math.round((s.teslim - s.faturaMiktari) * s.siparisFiyati)),
      });
  }
  const faturalanmamis = Math.max(0, siparisTutari - kdvli(satirlar.reduce((x, s) => x + Math.round(Math.min(s.faturaMiktari, s.siparisMiktari) * (s.siparisFiyati ?? 0)), 0) + Math.min(nakliye, digerFatura)));
  return { satirlar, siparisTutari, teslimDegeri, faturaToplami, odenen, faturalanmamis, digerFatura, uyarilar };
}

export const SATIN_ALMA_UYARI_ADI: Record<SatinAlmaUyariKodu, string> = {
  odenen_fazla: 'Ödenen teslimden fazla',
  fatura_fazla: 'Faturalanan teslimden fazla',
  fiyat_farki: 'Fatura fiyatı farklı',
  faturasiz_teslim: 'Fatura bekleniyor',
};
