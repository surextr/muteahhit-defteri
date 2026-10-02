import type { Depo } from '../veri/depo';
import type { BagimsizBolum, Blok } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import type { BlokOzellikleri } from './proje';

// Bina krokisi işlemleri: hat ya da çoklu seçimle toplu özellik, bloktan kopyalama, blok özellikleri.
// Hat şablonu ayrıca saklanmaz: değer seçilen her bölüme ayrı yazılır, böylece farklı olan tek tek düzeltilir
// ve her değişiklik bölümün kendi geçmişinde görünür.

/** Toplu verilebilen (fiziksel) özellikler. Satış, teslim ve sahiplik burada değişmez. */
export type BolumOzellikleri = Pick<BagimsizBolum, 'odaTipi' | 'brutM2' | 'netM2' | 'cephe' | 'balkon' | 'otopark' | 'depo' | 'ozellikler'>;

export const OZELLIK_ALANLARI: (keyof BolumOzellikleri)[] = ['odaTipi', 'brutM2', 'netM2', 'cephe', 'balkon', 'otopark', 'depo', 'ozellikler'];

/** Sekiz yön; cephe birden çoksa virgülle yazılır ("Güney, Doğu"). */
export const YONLER = ['Kuzey', 'Kuzeydoğu', 'Doğu', 'Güneydoğu', 'Güney', 'Güneybatı', 'Batı', 'Kuzeybatı'] as const;

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
      const h = ozellikHatalari({ brutM2: sonra.brutM2, netM2: sonra.netM2 }, `No ${bolum.no}: `);
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
