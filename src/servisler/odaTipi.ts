import { BOS_ODA_TIPI_AYARI, HAZIR_ODA_TIPLERI, bolumOdaTipi, odaTipiAnahtari, odaTipiOku } from '../hesap/odaTipi';
import type { Depo } from '../veri/depo';
import type { Firma } from '../veri/tipler';
import { firmaAyariDegistir } from './firma';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Firmanın oda tipi listesi: kullanım sıklığı, yeni tip ekleme, gizleme. Liste firma ayarında durur;
// her değişiklik firmanın geçmişine yazılır (ayar olduğu için gerekçe istenmez).

/** Firmadaki (iptal edilmemiş) bölümlerde her oda tipinin kaç kez kullanıldığı. */
export async function odaTipiKullanimi(depo: Depo, firmaId: string): Promise<Map<string, number>> {
  const sayilar = new Map<string, number>();
  for (const b of await depo.listele('bagimsizBolum', { firmaId })) {
    const t = b.iptal === null ? bolumOdaTipi(b) : null;
    if (t) sayilar.set(t, (sayilar.get(t) ?? 0) + 1);
  }
  return sayilar;
}

const ayarOku = (firma: Firma) => firma.ayarlar.odaTipleri ?? BOS_ODA_TIPI_AYARI;

/** "4+2" gibi yeni tip ekler; listede gizliyse yeniden gösterir. Dönüş: eklenen tipin anahtarı. */
export async function odaTipiEkle(servis: KayitServisi, firma: Firma, metin: string): Promise<string> {
  const t = odaTipiOku(metin);
  if (!t) throw new IsKuraliHatasi('Oda tipini "4+2" gibi yazın: oda sayısı (1–20), artı, salon sayısı (0–9).');
  const anahtar = odaTipiAnahtari(t.oda, t.salon);
  const ayar = ayarOku(firma);
  const listede = (HAZIR_ODA_TIPLERI as readonly string[]).includes(anahtar) || ayar.eklenen.includes(anahtar);
  if (listede && !ayar.gizli.includes(anahtar)) return anahtar;
  await firmaAyariDegistir(servis, firma, {
    odaTipleri: {
      eklenen: listede ? ayar.eklenen : [...ayar.eklenen, anahtar],
      gizli: ayar.gizli.filter((g) => g !== anahtar),
    },
  });
  return anahtar;
}

/** Tipi seçim listesinde gizler ya da yeniden gösterir. Kayıtlardaki değerler değişmez. */
export async function odaTipiGizle(servis: KayitServisi, firma: Firma, anahtar: string, gizli: boolean): Promise<void> {
  const ayar = ayarOku(firma);
  if (ayar.gizli.includes(anahtar) === gizli) return;
  await firmaAyariDegistir(servis, firma, {
    odaTipleri: { ...ayar, gizli: gizli ? [...ayar.gizli, anahtar] : ayar.gizli.filter((g) => g !== anahtar) },
  });
}
