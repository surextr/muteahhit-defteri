import type { Kurus, Tarih } from '../veri/tipler';
import { adParcalari, birimAnahtari, birimCarpani, gunFarki } from './fiyat';
import { aramaAnahtari } from './metin';

// Alış fiyatları (saf): alış faturası satırları kaleme göre gruplanır (fiyat kataloğundaki malzeme/makine kalemine benzeyen
// satır o kalemin birimine çevrilir; benzemeyen, açıklama + birimle kendi grubunu kurar). Her grupta fiyat geçmişi, ilk → son
// değişim, tedarikçi ortalamaları; her alımda yakın dönemdeki (±90 gün) diğer alımların ortancasından sapma ve fazla ödenen.
// Fiyatlar KDV hariç, birim başına.

export const SAPMA_ESIGI = 0.15;
export const SAPMA_PENCERESI_GUN = 90;

export interface AlimSatiri {
  satirId: string;
  giderId: string;
  tarih: Tarih;
  cariId: string | null;
  cariAdi: string | null;
  projeId: string | null;
  aciklama: string;
  miktar: number;
  birim: string;
  /** KDV hariç satır tutarı. */
  tutar: Kurus;
}

export interface KatalogKalemi {
  id: string;
  ad: string;
  birim: string;
}

export interface Alim extends AlimSatiri {
  /** Grup biriminde birim fiyat. */
  fiyat: Kurus;
  /** Grup birimindeki miktar. */
  grupMiktari: number;
  /** ±90 gündeki diğer alımların ortancası (en az iki alım varsa). */
  ortanca: Kurus | null;
  /** fiyat / ortanca − 1. */
  sapma: number | null;
  /** Ortancanın üstündeyse (fiyat − ortanca) × miktar. */
  fazla: Kurus;
}

export interface Tedarikci {
  cariId: string | null;
  ad: string;
  ortalama: Kurus;
  adet: number;
  miktar: number;
}

export interface FiyatGrubu {
  anahtar: string;
  ad: string;
  birim: string;
  katalogId: string | null;
  alimlar: Alim[];
  ilk: Alim;
  son: Alim;
  /** son / ilk − 1. */
  degisim: number;
  /** İlk ile son alım arası gün. */
  gun: number;
  /** Miktar ağırlıklı ortalama. */
  ortalama: Kurus;
  min: Kurus;
  max: Kurus;
  toplamMiktar: number;
  toplamTutar: Kurus;
  tedarikciler: Tedarikci[];
  fazla: Kurus;
}

const ortanca = (l: number[]): number => {
  const s = [...l].sort((a, b) => a - b);
  const o = Math.floor(s.length / 2);
  return s.length % 2 ? s[o]! : (s[o - 1]! + s[o]!) / 2;
};

/** Satırı katalog kalemine eşler: sayılı parçaların hepsi, sözcüklerin en az yarısı; birim çevrilebilmeli. En özgül olan seçilir. */
function katalogEsle(katalog: { k: KatalogKalemi; p: ReturnType<typeof adParcalari> }[], aciklama: string, birim: string) {
  const m = adParcalari(aciklama);
  const sayilar = new Set(m.sayili);
  let en: { k: KatalogKalemi; carpan: number; puan: number } | null = null;
  for (const { k, p } of katalog) {
    if (!p.sozcuk.length || !p.sayili.every((x) => sayilar.has(x))) continue;
    const bulunan = p.sozcuk.filter((x) => m.sozcuk.some((y) => y.startsWith(x) || x.startsWith(y))).length;
    if (bulunan < Math.max(1, Math.ceil(p.sozcuk.length / 2))) continue;
    const carpan = birimCarpani(birim, k.birim);
    if (carpan === null) continue;
    const puan = p.sayili.length * 10 + bulunan;
    if (!en || puan > en.puan) en = { k, carpan, puan };
  }
  return en;
}

export function fiyatGruplari(satirlar: AlimSatiri[], katalog: KatalogKalemi[]): FiyatGrubu[] {
  const kp = katalog.map((k) => ({ k, p: adParcalari(k.ad) }));
  const gruplar = new Map<string, { ad: string; birim: string; katalogId: string | null; alimlar: Alim[] }>();
  for (const s of satirlar) {
    if (!(s.miktar > 0) || !(s.tutar > 0) || !s.birim.trim()) continue;
    const esles = katalogEsle(kp, s.aciklama, s.birim);
    const birim = esles ? esles.k.birim : birimAnahtari(s.birim);
    // Fiyat katalog biriminde: kg fiyatı × 1000 = ton fiyatı; miktar ters yönde.
    const carpan = esles?.carpan ?? 1;
    const anahtar = esles ? `k:${esles.k.id}` : `a:${aramaAnahtari(s.aciklama).replace(/\s+/g, ' ').trim()}|${birim}`;
    const g = gruplar.get(anahtar) ?? { ad: esles?.k.ad ?? s.aciklama.trim(), birim, katalogId: esles?.k.id ?? null, alimlar: [] };
    g.alimlar.push({ ...s, fiyat: Math.round((s.tutar / s.miktar) * carpan), grupMiktari: s.miktar / carpan, ortanca: null, sapma: null, fazla: 0 });
    gruplar.set(anahtar, g);
  }

  const sonuc: FiyatGrubu[] = [];
  for (const [anahtar, g] of gruplar) {
    const alimlar = g.alimlar.sort((a, b) => a.tarih.localeCompare(b.tarih) || a.satirId.localeCompare(b.satirId));
    for (const a of alimlar) {
      const diger = alimlar.filter((b) => b !== a && Math.abs(gunFarki(a.tarih, b.tarih)) <= SAPMA_PENCERESI_GUN).map((b) => b.fiyat);
      if (diger.length < 2) continue;
      a.ortanca = Math.round(ortanca(diger));
      a.sapma = a.ortanca > 0 ? a.fiyat / a.ortanca - 1 : null;
      a.fazla = a.fiyat > a.ortanca ? Math.round((a.fiyat - a.ortanca) * a.grupMiktari) : 0;
    }
    const toplamMiktar = alimlar.reduce((t, a) => t + a.grupMiktari, 0);
    const toplamTutar = alimlar.reduce((t, a) => t + a.tutar, 0);
    const ted = new Map<string, Tedarikci & { tutar: number }>();
    for (const a of alimlar) {
      const k = a.cariId ?? '';
      const t = ted.get(k) ?? { cariId: a.cariId, ad: a.cariAdi ?? 'Carisiz', ortalama: 0, adet: 0, miktar: 0, tutar: 0 };
      t.adet++;
      t.miktar += a.grupMiktari;
      t.tutar += a.fiyat * a.grupMiktari;
      ted.set(k, t);
    }
    const ilk = alimlar[0]!;
    const son = alimlar.at(-1)!;
    sonuc.push({
      anahtar,
      ad: g.ad,
      birim: g.birim,
      katalogId: g.katalogId,
      alimlar,
      ilk,
      son,
      degisim: ilk.fiyat > 0 ? son.fiyat / ilk.fiyat - 1 : 0,
      gun: gunFarki(ilk.tarih, son.tarih),
      ortalama: Math.round(alimlar.reduce((t, a) => t + a.fiyat * a.grupMiktari, 0) / toplamMiktar),
      min: Math.min(...alimlar.map((a) => a.fiyat)),
      max: Math.max(...alimlar.map((a) => a.fiyat)),
      toplamMiktar,
      toplamTutar,
      tedarikciler: [...ted.values()].map(({ tutar, ...t }) => ({ ...t, ortalama: Math.round(tutar / t.miktar) })).sort((a, b) => a.ortalama - b.ortalama),
      fazla: alimlar.reduce((t, a) => t + (a.sapma !== null && a.sapma > SAPMA_ESIGI ? a.fazla : 0), 0),
    });
  }
  return sonuc.sort((a, b) => b.toplamTutar - a.toplamTutar);
}

/** Fiyatı değişen kalemler (en az iki alım, aralarında en az 14 gün): artanlar büyükten, azalanlar küçükten. */
export function fiyatDegisimleri(gruplar: FiyatGrubu[]): { artanlar: FiyatGrubu[]; azalanlar: FiyatGrubu[] } {
  const l = gruplar.filter((g) => g.alimlar.length >= 2 && g.gun >= 14 && g.degisim !== 0);
  return {
    artanlar: l.filter((g) => g.degisim > 0).sort((a, b) => b.degisim - a.degisim),
    azalanlar: l.filter((g) => g.degisim < 0).sort((a, b) => a.degisim - b.degisim),
  };
}

export interface Sapma {
  grup: FiyatGrubu;
  alim: Alim;
}

/** Ortancanın %15'ten fazla üstünde alımlar, fazla ödenen tutara göre. */
export function pahaliAlimlar(gruplar: FiyatGrubu[], esik = SAPMA_ESIGI): Sapma[] {
  return gruplar
    .flatMap((grup) => grup.alimlar.filter((a) => a.sapma !== null && a.sapma > esik).map((alim) => ({ grup, alim })))
    .sort((a, b) => b.alim.fazla - a.alim.fazla);
}

/** "%12,5" */
export const oranYaz = (o: number): string => `${o > 0 ? '+' : o < 0 ? '−' : ''}%${(Math.round(Math.abs(o) * 1000) / 10).toLocaleString('tr-TR')}`;
