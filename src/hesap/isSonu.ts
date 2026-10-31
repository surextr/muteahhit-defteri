import type { Alacak, BagimsizBolum, Gider, GiderSatiri, Hakedis, Kalem, KalemIlerlemesi, Kurus, Satis, Tarih, UstaSozlesmesi } from '../veri/tipler';
import { butceAgaci, kalemGerceklesen, type ButceOzeti } from './butce';
import { gecerliIlerlemeler, kalemSozlesmeToplamlari } from './ilerleme';
import { karZarar } from './karZarar';

// İş sonu maliyet tahmini (saf): bugüne kadar harcanan + işi bitirmek için gereken, ana kalem başına.
// - İlerleme girilmişse (en az %10): harcanan ÷ ilerleme (harcama hızı aynı kalırsa).
// - Girilmemişse: bütçe.
// - Alt sınır her zaman: harcanan + kalan taahhüt (imzalı sözleşmelerde hakedişi yapılmamış iş, arsa sahibine kalan ödeme).
// Bütçeden ayrıdır: bütçe başlangıçtaki plan, tahmin bugünkü bilgiyle iş sonu. Hiçbir sonuç saklanmaz.

export const ILERLEME_ESIGI = 10;

export type TahminYontemi = 'ilerleme' | 'butce' | 'taahhut' | 'harcanan';

export const TAHMIN_YONTEMI_ADI: Record<TahminYontemi, string> = {
  ilerleme: 'İlerlemeye göre',
  butce: 'Bütçeye göre',
  taahhut: 'Sözleşmelere göre',
  harcanan: 'Yalnız harcanan',
};

export interface IsSonuKalemi {
  kalemId: string;
  ad: string;
  butce: Kurus | null;
  harcanan: Kurus;
  /** Girilen fiziksel ilerleme; projede giriş varsa girilmemiş kalem 0, hiç yoksa null. */
  ilerleme: number | null;
  /** İmzalı sözleşmelerde yapılmamış iş + arsa sahibine kalan ödeme. */
  taahhut: Kurus;
  tahmin: Kurus;
  /** tahmin − harcanan: işi bitirmek için gereken. */
  kalanIs: Kurus;
  /** tahmin − bütçe (artı = aşım); bütçe yoksa null. */
  sapma: Kurus | null;
  yontem: TahminYontemi;
}

export interface IsSonuTahmini {
  kalemler: IsSonuKalemi[];
  /** Kalemi seçilmemiş harcama (tahmine olduğu gibi girer). */
  kalemsiz: Kurus;
  butce: Kurus;
  harcanan: Kurus;
  tahmin: Kurus;
  kalanIs: Kurus;
  /** tahmin − bütçe (bütçesi olan kalemlerde). */
  sapma: Kurus;
  gelir: Kurus;
  /** gelir − iş sonu tahmini. */
  kar: Kurus;
  marj: number | null;
  /** Kâr/zarar raporundaki bütçeye göre kâr (karşılaştırma için). */
  butceyeGoreKar: Kurus;
}

export function kalemTahmini(g: { butce: Kurus | null; harcanan: Kurus; ilerleme: number | null; taahhut: Kurus }): { tahmin: Kurus; yontem: TahminYontemi } {
  const taban = g.harcanan + Math.max(0, g.taahhut);
  if (g.ilerleme !== null && g.ilerleme >= ILERLEME_ESIGI) {
    const hiz = g.ilerleme >= 100 ? g.harcanan : Math.round((g.harcanan * 100) / g.ilerleme);
    return hiz >= taban ? { tahmin: hiz, yontem: 'ilerleme' } : { tahmin: taban, yontem: 'taahhut' };
  }
  if (g.butce !== null) return g.butce >= taban ? { tahmin: g.butce, yontem: 'butce' } : { tahmin: taban, yontem: g.taahhut > 0 ? 'taahhut' : 'harcanan' };
  return { tahmin: taban, yontem: g.taahhut > 0 ? 'taahhut' : 'harcanan' };
}

export function isSonuTahmini(g: {
  butce: ButceOzeti;
  /** Ana kalem → yüzde (geçerli ilerleme). */
  ilerlemeler: ReadonlyMap<string, number>;
  /** Ana kalem → kalan taahhüt. */
  taahhutler: ReadonlyMap<string, Kurus>;
  gelir: Kurus;
  butceyeGoreKar: Kurus;
}): IsSonuTahmini {
  const girildi = g.ilerlemeler.size > 0;
  const kalemler = g.butce.dugumler.map((d): IsSonuKalemi => {
    const ilerleme = g.ilerlemeler.get(d.kalem.id) ?? (girildi ? 0 : null);
    const taahhut = g.taahhutler.get(d.kalem.id) ?? 0;
    const { tahmin, yontem } = kalemTahmini({ butce: d.butce, harcanan: d.gerceklesen, ilerleme, taahhut });
    return {
      kalemId: d.kalem.id,
      ad: d.kalem.ad,
      butce: d.butce,
      harcanan: d.gerceklesen,
      ilerleme,
      taahhut,
      tahmin,
      kalanIs: tahmin - d.gerceklesen,
      sapma: d.butce === null ? null : tahmin - d.butce,
      yontem,
    };
  });
  const t = (f: (k: IsSonuKalemi) => number) => kalemler.reduce((s, k) => s + f(k), 0);
  const tahmin = t((k) => k.tahmin) + g.butce.kalemsiz;
  const kar = g.gelir - tahmin;
  return {
    kalemler,
    kalemsiz: g.butce.kalemsiz,
    butce: g.butce.butce,
    harcanan: g.butce.gerceklesen,
    tahmin,
    kalanIs: tahmin - g.butce.gerceklesen,
    sapma: t((k) => k.sapma ?? 0),
    gelir: g.gelir,
    kar,
    marj: g.gelir > 0 ? (kar * 100) / g.gelir : null,
    butceyeGoreKar: g.butceyeGoreKar,
  };
}

// ─── Belli bir günkü bilgiyle (geçmiş) ──────────────────────────────

export interface IsSonuHamVerisi {
  kalemler: Kalem[];
  giderler: Gider[];
  satirlar: GiderSatiri[];
  ilerlemeKayitlari: KalemIlerlemesi[];
  sozlesmeler: UstaSozlesmesi[];
  hakedisler: Hakedis[];
  satislar: Satis[];
  bolumler: BagimsizBolum[];
  /** İlave imalat alacakları. */
  ilaveImalat: Alacak[];
  /** Ana kalem → arsa sahibine kalan ödeme (bugünkü; geçmişte de aynı alınır). */
  katKarsiligiTaahhudu: ReadonlyMap<string, Kurus>;
  kdvDahil: boolean;
}

const gunSonu = (t: Tarih) => `${t}T23:59:59.999Z`;
/** Onaylı kaydın geçerli olduğu gün: kendi tarihi (sözleşme tarihi, hakediş/satış tarihi), yoksa onay günü. */
const onayliMi = (o: { onay: { zaman: string } | null }, tarih: Tarih | null, gun: Tarih) => o.onay !== null && (tarih ? tarih <= gun : o.onay.zaman <= gunSonu(gun));

/**
 * `gun` sonundaki durumla iş sonu tahmini: kayıtların kendi tarihine göre (fatura, ilerleme, sözleşme, hakediş, satış
 * tarihi); sonradan girilen geçmiş fatura kendi gününe yazılır. Bütçe, bölümler ve arsa sahibi taahhüdü bugünkü.
 */
export function isSonuAnlik(h: IsSonuHamVerisi, gun: Tarih): IsSonuTahmini {
  const giderler = h.giderler.filter((g) => g.iptal === null && g.tarih <= gun);
  const giderIdleri = new Set(giderler.map((g) => g.id));
  const butce = butceAgaci(h.kalemler, kalemGerceklesen(h.satirlar.filter((s) => giderIdleri.has(s.giderId)), giderler, h.kdvDahil));

  const ilerlemeler = new Map<string, number>();
  for (const [id, k] of gecerliIlerlemeler(h.ilerlemeKayitlari.filter((k) => k.tarih <= gun))) ilerlemeler.set(id, k.yuzde);

  const sozlesmeler = h.sozlesmeler.filter((s) => onayliMi(s, s.sozlesmeTarihi, gun));
  const hakedisler = h.hakedisler.filter((x) => onayliMi(x, x.tarih, gun));
  const taahhutler = new Map<string, Kurus>(h.katKarsiligiTaahhudu);
  for (const [id, t] of kalemSozlesmeToplamlari(h.kalemler, sozlesmeler, hakedisler)) taahhutler.set(id, (taahhutler.get(id) ?? 0) + Math.max(0, t.sozlesme - t.yapilan));

  const bolum = new Map(h.bolumler.map((b) => [b.id, b]));
  const kz = karZarar({
    butce,
    satislar: h.satislar
      .filter((s) => s.iptal === null && s.tarih <= gun && bolum.has(s.bolumId))
      .map((s) => ({ satis: onayliMi(s, s.tarih, gun) ? s : { ...s, onay: null }, bolum: bolum.get(s.bolumId)!, durumlar: [] })),
    bolumler: h.bolumler,
    ilaveImalat: h.ilaveImalat
      .filter((a) => a.iptal === null && a.tarih <= gun)
      .map((a) => ({ tarih: a.tarih, vadeTarihi: a.vadeTarihi, tutar: a.tutar, kalan: 0 })),
    borclar: [],
    bugun: gun,
  });
  return isSonuTahmini({ butce, ilerlemeler, taahhutler, gelir: kz.gelir.tahmini, butceyeGoreKar: kz.kar.tahmini });
}

export interface TahminDegisimi {
  gun: Tarih;
  tahmin: IsSonuTahmini;
  /** Bir önceki noktaya göre kârın değişimi. */
  karFarki: Kurus | null;
  /** Değişimin en büyük nedenleri (gelir ve kalemler), en çok 4. */
  nedenler: string[];
}

const tl = (k: Kurus) => `${k < 0 ? '−' : '+'}${Math.round(Math.abs(k) / 100).toLocaleString('tr-TR')} TL`;
const yuzde = (n: number | null) => (n === null ? '—' : `%${Math.round(n)}`);

/** İki tahmin arasında kârı değiştiren başlıca nedenler. */
export function degisimNedenleri(once: IsSonuTahmini, sonra: IsSonuTahmini): string[] {
  const nedenler: { etki: number; metin: string }[] = [];
  const gelirFarki = sonra.gelir - once.gelir;
  if (gelirFarki !== 0) nedenler.push({ etki: Math.abs(gelirFarki), metin: `Gelir tahmini ${tl(gelirFarki)}` });
  const onceki = new Map(once.kalemler.map((k) => [k.kalemId, k]));
  for (const k of sonra.kalemler) {
    const o = onceki.get(k.kalemId);
    const fark = k.tahmin - (o?.tahmin ?? 0);
    if (fark === 0) continue;
    const ayrinti: string[] = [];
    if (o && k.harcanan !== o.harcanan) ayrinti.push(`harcanan ${tl(k.harcanan - o.harcanan)}`);
    if (o && k.ilerleme !== o.ilerleme) ayrinti.push(`ilerleme ${yuzde(o.ilerleme)} → ${yuzde(k.ilerleme)}`);
    if (o && k.taahhut !== o.taahhut) ayrinti.push(`sözleşmelerde kalan ${tl(k.taahhut - o.taahhut)}`);
    nedenler.push({ etki: Math.abs(fark), metin: `${k.ad}: maliyet ${tl(fark)}${ayrinti.length ? ` (${ayrinti.join(', ')})` : ''}` });
  }
  const kalemsizFarki = sonra.kalemsiz - once.kalemsiz;
  if (kalemsizFarki !== 0) nedenler.push({ etki: Math.abs(kalemsizFarki), metin: `Kalemsiz harcama ${tl(kalemsizFarki)}` });
  return nedenler
    .sort((a, b) => b.etki - a.etki)
    .slice(0, 4)
    .map((x) => x.metin);
}

/** Son `ay` ayın ay sonları + bugün; her noktada o günkü bilgiyle tahmin ve değişim nedenleri. */
export function tahminGecmisi(h: IsSonuHamVerisi, bugun: Tarih, ay = 6): TahminDegisimi[] {
  const [y, a] = bugun.split('-').map(Number) as [number, number];
  const gunler: Tarih[] = [];
  for (let i = ay; i >= 1; i--) gunler.push(new Date(Date.UTC(y, a - i, 0)).toISOString().slice(0, 10));
  gunler.push(bugun);
  const sonuc: TahminDegisimi[] = [];
  for (const gun of gunler) {
    const tahmin = isSonuAnlik(h, gun);
    const once = sonuc.at(-1)?.tahmin;
    sonuc.push({ gun, tahmin, karFarki: once ? tahmin.kar - once.kar : null, nedenler: once ? degisimNedenleri(once, tahmin) : [] });
  }
  return sonuc;
}
