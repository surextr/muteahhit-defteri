import { HAZIR_KALEM_KODU } from '../veri/sabit/hazirKalemKodlari';
import type { Kurus, MaliyetSatiri, Tarih } from '../veri/tipler';
import { adBenzer, birimCarpani } from './fiyat';

// Başlangıç maliyeti (onaylı maliyet hesabı) ile gerçekleşen giderlerin karşılaştırması (saf). Karşılaştırma KDV hariçtir
// (fiyat listesi ve hesap KDV hariç). Eşleşen kalemde sapma ikiye ayrılır:
//   fiyat farkı  = gerçek tutar − gerçek miktar × planlanan birim fiyat   (pahalıya / ucuza alındı)
//   miktar farkı = (gerçek miktar − planlanan miktar) × planlanan birim fiyat  (fazla / eksik alındı; iş sürerken eksi olur)
// Ana kalemde ilerleme yüzdesi varsa "bu ilerlemede beklenen" = plan × yüzde; sapma = gerçek − beklenen.

export interface PlanSatiri {
  id: string;
  ad: string;
  tur: MaliyetSatiri['tur'];
  birim: string;
  /** Bütçe kalemi sistem kodu. */
  kod: string | null;
  miktar: number | null;
  birimFiyat: Kurus | null;
  tutar: Kurus | null;
}

export interface GercekSatir {
  /** Kalem anahtarı: sistem kodu ya da "kalem:<id>"; kalemsiz null. */
  kod: string | null;
  kodAdi: string;
  anaKod: string | null;
  anaAdi: string;
  aciklama: string;
  miktar: number | null;
  birim: string | null;
  /** KDV hariç; iadede eksi. */
  tutar: Kurus;
  tarih: Tarih;
  giderId: string;
}

export interface Eslesme {
  plan: PlanSatiri;
  gercekler: GercekSatir[];
  gercekTutar: Kurus;
  /** Plan biriminde; birim çevrilemiyor ya da miktar yazılmamışsa null. */
  gercekMiktar: number | null;
  ortalamaFiyat: Kurus | null;
  fiyatFarki: Kurus | null;
  miktarFarki: Kurus | null;
}

export interface KalemKarsilastirmasi {
  kod: string | null;
  ad: string;
  plan: Kurus;
  gercek: Kurus;
  /** Ana kalemin ilerleme yüzdesi (0–100). */
  ilerleme: number | null;
  beklenen: Kurus | null;
  sapma: Kurus | null;
  /** Harcama yüzdesi − ilerleme > eşik. */
  uyari: boolean;
  eslesmeler: Eslesme[];
  /** Plan satırı olup harcaması olmayanlar. */
  harcanmamis: PlanSatiri[];
  /** Harcaması olup planda karşılığı bulunmayanlar. */
  plandaYok: GercekSatir[];
}

export interface Karsilastirma {
  kalemler: KalemKarsilastirmasi[];
  plan: Kurus;
  gercek: Kurus;
  /** Plan ağırlıklı genel ilerleme; ilerleme girilmemişse null. */
  ilerleme: number | null;
  beklenen: Kurus | null;
  sapma: Kurus | null;
  fiyatFarki: Kurus;
  plandaYok: Kurus;
}

const KOD_ADI = new Map<string, { ad: string; ana: string }>();
for (const [yol, kod] of Object.entries(HAZIR_KALEM_KODU)) {
  const p = yol.split(' › ');
  KOD_ADI.set(kod, { ad: p.at(-1)!, ana: p.length > 1 ? HAZIR_KALEM_KODU[p[0]!]! : kod });
}

/** Hazır kalem kodunun ana kalemi ve adı. */
export function anaKalem(kod: string | null): { kod: string | null; ad: string } {
  if (!kod) return { kod: null, ad: 'Kalemsiz' };
  const k = KOD_ADI.get(kod);
  if (!k) return { kod, ad: kod };
  return { kod: k.ana, ad: KOD_ADI.get(k.ana)?.ad ?? k.ad };
}

export const kalemAdi = (kod: string | null) => (kod ? (KOD_ADI.get(kod)?.ad ?? kod) : 'Kalemsiz');

/**
 * Gider satırına en uygun plan satırı: adı benzeyen; birimi plana çevrilebilen (ya da miktarı yazılmamış) önce, aynı alt kalemdeki
 * önce. Miktarı ve birimi yazılı ama hiçbir benzer satırın birimine uymayan gider (örn. "beton pompası · sefer" ile "beton · m³")
 * eşlenmez, planda yok sayılır.
 */
function eslesenPlan(g: GercekSatir, adaylar: PlanSatiri[]): PlanSatiri | null {
  const benzer = adaylar.filter((p) => adBenzer(p.ad, g.aciklama) || adBenzer(g.aciklama, p.ad));
  const birimli = g.miktar !== null && !!g.birim;
  const uyan = birimli ? benzer.filter((p) => birimCarpani(g.birim, p.birim) !== null) : benzer;
  return uyan.find((p) => p.kod === g.kod) ?? uyan[0] ?? null;
}

export function karsilastir(planlar: PlanSatiri[], gercekler: GercekSatir[], ilerlemeler: Map<string, number>, esik: number): Karsilastirma {
  const gruplar = new Map<string | null, KalemKarsilastirmasi>();
  const grup = (kod: string | null, ad: string) => {
    let g = gruplar.get(kod);
    if (!g) {
      g = { kod, ad, plan: 0, gercek: 0, ilerleme: null, beklenen: null, sapma: null, uyari: false, eslesmeler: [], harcanmamis: [], plandaYok: [] };
      gruplar.set(kod, g);
    }
    return g;
  };
  const planAnasi = new Map<string, string | null>();
  for (const p of planlar) {
    const a = anaKalem(p.kod);
    planAnasi.set(p.id, a.kod);
    grup(a.kod, a.ad).plan += p.tutar ?? 0;
  }
  const eslesme = new Map<string, Eslesme>();
  for (const g of gercekler) {
    const k = grup(g.anaKod, g.anaAdi);
    k.gercek += g.tutar;
    const p = eslesenPlan(
      g,
      planlar.filter((x) => planAnasi.get(x.id) === g.anaKod),
    );
    if (!p) {
      k.plandaYok.push(g);
      continue;
    }
    const e = eslesme.get(p.id) ?? { plan: p, gercekler: [], gercekTutar: 0, gercekMiktar: null, ortalamaFiyat: null, fiyatFarki: null, miktarFarki: null };
    e.gercekler.push(g);
    e.gercekTutar += g.tutar;
    eslesme.set(p.id, e);
  }
  for (const e of eslesme.values()) {
    // birimCarpani fiyat içindir (kg fiyatı × 1000 = ton fiyatı); miktar ters yönde çevrilir.
    const carpanlar = e.gercekler.map((g) => {
      const c = g.miktar === null ? null : birimCarpani(g.birim ?? e.plan.birim, e.plan.birim);
      return c === null ? null : 1 / c;
    });
    if (carpanlar.every((c) => c !== null)) {
      e.gercekMiktar = Math.round(e.gercekler.reduce((t, g, i) => t + g.miktar! * carpanlar[i]!, 0) * 100) / 100;
      if (e.gercekMiktar > 0) e.ortalamaFiyat = Math.round(e.gercekTutar / e.gercekMiktar);
      if (e.plan.birimFiyat !== null) {
        e.fiyatFarki = Math.round(e.gercekTutar - e.gercekMiktar * e.plan.birimFiyat);
        if (e.plan.miktar !== null) e.miktarFarki = Math.round((e.gercekMiktar - e.plan.miktar) * e.plan.birimFiyat);
      }
    }
    grup(planAnasi.get(e.plan.id) ?? null, anaKalem(e.plan.kod).ad).eslesmeler.push(e);
  }
  for (const p of planlar) if (!eslesme.has(p.id) && (p.tutar ?? 0) > 0) gruplar.get(planAnasi.get(p.id) ?? null)!.harcanmamis.push(p);

  let agirlik = 0;
  let ilerlemeToplami = 0;
  for (const k of gruplar.values()) {
    const y = k.kod ? ilerlemeler.get(k.kod) : undefined;
    if (y !== undefined && k.plan > 0) {
      k.ilerleme = y;
      k.beklenen = Math.round((k.plan * y) / 100);
      k.sapma = k.gercek - k.beklenen;
      k.uyari = (k.gercek / k.plan) * 100 - y > esik;
      agirlik += k.plan;
      ilerlemeToplami += k.plan * y;
    }
  }
  const kalemler = [...gruplar.values()].sort((a, b) => b.plan - a.plan || b.gercek - a.gercek);
  const plan = kalemler.reduce((t, k) => t + k.plan, 0);
  const gercek = kalemler.reduce((t, k) => t + k.gercek, 0);
  const ilerleme = agirlik > 0 ? Math.round((ilerlemeToplami / agirlik) * 10) / 10 : null;
  const beklenen = ilerleme !== null ? kalemler.reduce((t, k) => t + (k.beklenen ?? 0), 0) : null;
  return {
    kalemler,
    plan,
    gercek,
    ilerleme,
    beklenen,
    sapma: beklenen !== null ? kalemler.filter((k) => k.beklenen !== null).reduce((t, k) => t + k.gercek, 0) - beklenen : null,
    fiyatFarki: kalemler.reduce((t, k) => t + k.eslesmeler.reduce((s, e) => s + (e.fiyatFarki ?? 0), 0), 0),
    plandaYok: kalemler.reduce((t, k) => t + k.plandaYok.reduce((s, g) => s + g.tutar, 0), 0),
  };
}
