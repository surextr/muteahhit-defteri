import { bolumNo } from '../hesap/bolum';
import type { Depo } from '../veri/depo';
import type { BagimsizBolum, Blok, Kat } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import {
  binaPlaniHazirla,
  blokHatalari,
  planBlogunuYaz,
  projeGetir,
  SINIRLAR,
  yeniBolum,
  type BlokGirdisi,
  type BlokOzellikleri,
  type PlanBolumu,
} from './proje';

// Bina krokisi işlemleri: hat ya da çoklu seçimle toplu özellik, bloktan kopyalama, blok özellikleri.
// Hat şablonu ayrıca saklanmaz: değer seçilen her bölüme ayrı yazılır, böylece farklı olan tek tek düzeltilir
// ve her değişiklik bölümün kendi geçmişinde görünür.

/** Toplu verilebilen (fiziksel) özellikler. Satış, teslim ve sahiplik burada değişmez. */
export type BolumOzellikleri = Pick<BagimsizBolum, 'odaTipi' | 'brutM2' | 'netM2' | 'cephe' | 'balkon' | 'otopark' | 'depo' | 'ozellikler'>;

export const OZELLIK_ALANLARI: (keyof BolumOzellikleri)[] = ['odaTipi', 'brutM2', 'netM2', 'cephe', 'balkon', 'otopark', 'depo', 'ozellikler'];

export { YONLER } from '../hesap/bolum';

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const esit = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Bölümde, verilen değişikliğe göre değeri farklı olan alanlar (önizlemede "üzerine yazılacak"). */
export function farkliAlanlar(bolum: BolumOzellikleri, degisiklik: Partial<BolumOzellikleri>): (keyof BolumOzellikleri)[] {
  return (Object.keys(degisiklik) as (keyof BolumOzellikleri)[]).filter((a) => !esit(bolum[a], degisiklik[a]));
}

function ozellikHatalari(o: Partial<BolumOzellikleri>, etiket = ''): string[] {
  const hatalar: string[] = [];
  for (const a of ['brutM2', 'netM2'] as const) {
    const d = o[a];
    if (d !== undefined && d !== null && (!Number.isFinite(d) || d <= 0)) hatalar.push(`${etiket}${a === 'brutM2' ? 'Brüt' : 'Net'} m² sıfırdan büyük olmalı.`);
  }
  if (o.brutM2 != null && o.netM2 != null && o.netM2 > o.brutM2) hatalar.push(`${etiket}Net m² brüt m²'den büyük olamaz.`);
  return hatalar;
}

/**
 * Seçilen bölümlere yalnızca verilen alanları yazar (verilmeyen alan değişmez). Tek işlemdir.
 * Dönüş: gerçekten değişen bölüm sayısı.
 */
export async function topluOzellikVer(
  depo: Depo,
  servis: KayitServisi,
  bolumIdler: string[],
  degisiklik: Partial<BolumOzellikleri>,
): Promise<number> {
  const alanlar = (Object.keys(degisiklik) as (keyof BolumOzellikleri)[]).filter((a) => OZELLIK_ALANLARI.includes(a));
  if (bolumIdler.length === 0) throw new IsKuraliHatasi('Önce bölüm seçin.');
  if (alanlar.length === 0) throw new IsKuraliHatasi('Değiştirilecek en az bir özellik girin.');
  const temiz = Object.fromEntries(alanlar.map((a) => [a, degisiklik[a]])) as Partial<BolumOzellikleri>;
  const hatalar = ozellikHatalari(temiz);
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  const firmaId = servis.oturum.firmaId;

  return depo.islem(async () => {
    let degisen = 0;
    for (const id of new Set(bolumIdler)) {
      const bolum = await depo.getir('bagimsizBolum', id);
      if (!bolum || bolum.firmaId !== firmaId || bolum.iptal) throw new IsKuraliHatasi('Seçilen bölümlerden biri bulunamadı.');
      // Yalnız net ya da brüt verildiyse bölümün diğer değeriyle birlikte denetlenir.
      const sonra = { ...bolum, ...temiz };
      const blok = await depo.getir('blok', bolum.blokId);
      const h = ozellikHatalari({ brutM2: sonra.brutM2, netM2: sonra.netM2 }, `${bolumNo(blok?.ad, bolum.no)}: `);
      if (h.length > 0) throw new IsKuraliHatasi(h.join(' '));
      if (farkliAlanlar(bolum, temiz).length === 0) continue;
      await servis.guncelle('bagimsizBolum', id, temiz);
      degisen++;
    }
    return degisen;
  });
}

/**
 * Kaynak bloğun bölüm özelliklerini hedef bloğa kopyalar; eşleşme kat sırası + hat ile yapılır
 * ("A Blok 3. kat 2. hat" → "B Blok 3. kat 2. hat"). Eşleşmeyen bölümler değişmez.
 */
export async function blokOzellikleriniKopyala(
  depo: Depo,
  servis: KayitServisi,
  kaynakBlokId: string,
  hedefBlokId: string,
): Promise<{ kopyalanan: number; eslesmeyen: number }> {
  if (kaynakBlokId === hedefBlokId) throw new IsKuraliHatasi('Kaynak ve hedef blok aynı olamaz.');
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const yukle = async (blokId: string) => {
      const blok = await depo.getir('blok', blokId);
      if (!blok || blok.firmaId !== firmaId || blok.iptal) throw new IsKuraliHatasi('Blok bulunamadı.');
      const katlar = new Map(aktif(await depo.listele('kat', { blokId, firmaId })).map((k) => [k.id, k]));
      const bolumler = aktif(await depo.listele('bagimsizBolum', { projeId: blok.projeId, firmaId })).filter((b) => b.blokId === blokId);
      return { blok, anahtar: (b: BagimsizBolum) => `${katlar.get(b.katId)?.sira}:${b.hat}`, bolumler };
    };
    const kaynak = await yukle(kaynakBlokId);
    const hedef = await yukle(hedefBlokId);
    if (kaynak.blok.projeId !== hedef.blok.projeId) throw new IsKuraliHatasi('Bloklar aynı projede olmalı.');
    const kaynakHarita = new Map(kaynak.bolumler.map((b) => [kaynak.anahtar(b), b]));
    let kopyalanan = 0;
    let eslesmeyen = 0;
    for (const b of hedef.bolumler) {
      const k = kaynakHarita.get(hedef.anahtar(b));
      if (!k) {
        eslesmeyen++;
        continue;
      }
      const ozellik = Object.fromEntries(OZELLIK_ALANLARI.map((a) => [a, k[a]])) as BolumOzellikleri;
      if (farkliAlanlar(b, ozellik).length === 0) continue;
      await servis.guncelle('bagimsizBolum', b.id, ozellik);
      kopyalanan++;
    }
    return { kopyalanan, eslesmeyen };
  });
}

/** Asansör, kapalı otopark, sığınak, jeneratör. */
export async function blokOzellikleriniDegistir(servis: KayitServisi, blokId: string, o: BlokOzellikleri): Promise<Blok> {
  if (!Number.isInteger(o.asansorSayisi) || o.asansorSayisi < 0 || o.asansorSayisi > 10) {
    throw new IsKuraliHatasi('Asansör sayısı 0 ile 10 arasında olmalı.');
  }
  return servis.guncelle('blok', blokId, {
    asansorSayisi: o.asansorSayisi,
    kapaliOtopark: o.kapaliOtopark,
    siginak: o.siginak,
    jenerator: o.jenerator,
  });
}

// ─── Sonradan blok ve kat ekleme ───────────────────────────────────

/**
 * Var olan projeye blok ekler (sihirbazdaki blok formuyla). `kopyaKaynakBlokId` verilirse
 * kaynak bloğun daire özellikleri kat sırası + hat eşleşmesiyle yeni bloğa da yazılır.
 */
export async function blokEkle(
  depo: Depo,
  servis: KayitServisi,
  projeId: string,
  girdi: BlokGirdisi,
  kopyaKaynakBlokId: string | null = null,
): Promise<Blok> {
  const hatalar = blokHatalari(girdi, `${girdi.ad.trim() || 'Yeni'} Blok`);
  const { plan, hatalar: planHatalari } = binaPlaniHazirla([girdi]);
  if (hatalar.length > 0 || !plan) throw new IsKuraliHatasi([...hatalar, ...planHatalari].join(' ') || 'Blok planı hazırlanamadı.');
  const firmaId = servis.oturum.firmaId;

  return depo.islem(async () => {
    if (!(await projeGetir(depo, firmaId, projeId))) throw new IsKuraliHatasi('Proje bulunamadı.');
    const bloklar = aktif(await depo.listele('blok', { projeId, firmaId }));
    if (bloklar.length >= SINIRLAR.blok) throw new IsKuraliHatasi(`En fazla ${SINIRLAR.blok} blok eklenebilir.`);
    const ad = plan.bloklar[0]!.ad;
    const anahtar = (x: string) => x.trim().toLocaleUpperCase('tr-TR');
    if (bloklar.some((b) => anahtar(b.ad) === anahtar(ad))) throw new IsKuraliHatasi(`${ad} Blok zaten var; başka bir ad verin.`);
    const sira = Math.max(0, ...bloklar.map((b) => b.sira)) + 1;
    const blok = await planBlogunuYaz(servis, projeId, plan.bloklar[0]!, sira);
    if (kopyaKaynakBlokId) await blokOzellikleriniKopyala(depo, servis, kopyaKaynakBlokId, blok.id);
    return blok;
  });
}

export interface KatGirdisi {
  /** normal: en üst normal katın üstüne (çatı katı varsa altına); cati: çatı dubleksi katı; bodrum: en alta. */
  tur: 'normal' | 'cati' | 'bodrum';
  bolumSayisi: number;
  bolumTipi: 'daire' | 'dukkan';
  /** Yalnız normal katta: alttaki katın daire özellikleri (oda tipi, m², cephe…) hat eşleşmesiyle kopyalanır. */
  ozellikleriKopyala: boolean;
}

/**
 * Bloğa kat ekler. Mevcut bölüm numaraları değişmez (sözleşme ve tapuda geçer);
 * yeni bölümler bloktaki en büyük numaradan devam eder (daire 23, 24…; dükkan D3…).
 */
export async function katEkle(depo: Depo, servis: KayitServisi, blokId: string, g: KatGirdisi): Promise<Kat> {
  const enAz = g.tur === 'bodrum' ? 0 : 1;
  if (!Number.isInteger(g.bolumSayisi) || g.bolumSayisi < enAz || g.bolumSayisi > SINIRLAR.katBasina) {
    throw new IsKuraliHatasi(`Bölüm sayısı ${enAz} ile ${SINIRLAR.katBasina} arasında bir tam sayı olmalı.`);
  }
  const firmaId = servis.oturum.firmaId;

  return depo.islem(async () => {
    const blok = await depo.getir('blok', blokId);
    if (!blok || blok.firmaId !== firmaId || blok.iptal) throw new IsKuraliHatasi('Blok bulunamadı.');
    const { projeId } = blok;
    const katlar = aktif(await depo.listele('kat', { blokId, firmaId }));
    const bolumler = aktif(await depo.listele('bagimsizBolum', { projeId, firmaId })).filter((b) => b.blokId === blokId);
    const cati = katlar.find((k) => k.tip === 'cati_dubleksi');
    const normaller = katlar.filter((k) => k.tip === 'normal').sort((a, b) => a.sira - b.sira);

    let yeni: Pick<Kat, 'ad' | 'tip' | 'sira'>;
    if (g.tur === 'normal') {
      if (normaller.length >= SINIRLAR.normalKat) throw new IsKuraliHatasi(`En fazla ${SINIRLAR.normalKat} normal kat olabilir.`);
      const sira = (normaller.at(-1)?.sira ?? 0) + 1;
      yeni = { ad: `${normaller.length + 1}. Kat`, tip: 'normal', sira };
      // Çatı katı yeni katın üstünde kalır.
      if (cati && cati.sira <= sira) await servis.guncelle('kat', cati.id, { sira: sira + 1 });
    } else if (g.tur === 'cati') {
      if (cati) throw new IsKuraliHatasi('Bu blokta çatı katı zaten var.');
      yeni = { ad: 'Çatı Katı', tip: 'cati_dubleksi', sira: Math.max(0, ...katlar.map((k) => k.sira)) + 1 };
    } else {
      const bodrumlar = katlar.filter((k) => k.tip === 'bodrum');
      if (bodrumlar.length >= SINIRLAR.bodrumKat) throw new IsKuraliHatasi(`En fazla ${SINIRLAR.bodrumKat} bodrum kat olabilir.`);
      const sira = Math.min(0, ...katlar.map((k) => k.sira)) - 1;
      yeni = { ad: `${-sira}. Bodrum`, tip: 'bodrum', sira };
    }

    const enBuyuk = (desen: RegExp) => Math.max(0, ...bolumler.map((b) => Number(desen.exec(b.no)?.[1] ?? 0)));
    let daireNo = enBuyuk(/^(\d+)$/);
    let dukkanNo = enBuyuk(/^D(\d+)$/i);
    const tip = g.tur === 'cati' ? 'daire' : g.bolumTipi;
    const plan: PlanBolumu[] = Array.from({ length: g.bolumSayisi }, (_, i) =>
      tip === 'daire' ? { no: String(++daireNo), tip, hat: i + 1 } : { no: `D${++dukkanNo}`, tip, hat: i + 1 },
    );

    // Kopya kaynağı: eklenmeden önceki en üst normal kat, yoksa zemin.
    const kaynakKat = g.tur === 'normal' && g.ozellikleriKopyala ? (normaller.at(-1) ?? katlar.find((k) => k.tip === 'zemin')) : undefined;
    const kaynak = new Map(bolumler.filter((b) => b.katId === kaynakKat?.id).map((b) => [b.hat, b]));

    const kat = await servis.ekle('kat', { projeId, blokId, ...yeni });
    for (const b of plan) {
      const k = kaynak.get(b.hat);
      const ozellik = k ? (Object.fromEntries(OZELLIK_ALANLARI.map((a) => [a, k[a]])) as BolumOzellikleri) : {};
      await servis.ekle('bagimsizBolum', yeniBolum({ projeId, blokId, katId: kat.id }, b, ozellik));
    }
    return kat;
  });
}
