import type { Cari } from '../veri/tipler';

// Usta/taşeron branşları (usta tipleri) için saf yardımcılar. Branş adı usta tipinin adıdır ("Duvarcı");
// listelerde ve sözleşmenin yüklenici satırında parantezli açıklama atılır ("Kalıpçı (demir işçiliği dahil)" → "Kalıpçı").

/** Parantez içindeki açıklamayı atar: "Sucu (sıhhi tesisat)" → "Sucu". Parantezden başka bir şey kalmazsa adın kendisi. */
export function bransKisaAdi(tipAdi: string): string {
  const kisa = tipAdi.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return kisa || tipAdi.trim();
}

/** Kimliklerden kısa adlar; bilinmeyen (silinmiş) tip atlanır. */
export function bransAdlari(ids: readonly string[], tipAdlari: ReadonlyMap<string, string>): string[] {
  return ids.flatMap((id) => {
    const ad = tipAdlari.get(id);
    return ad ? [bransKisaAdi(ad)] : [];
  });
}

/**
 * Listelerde adın yanında görünen kısa açıklama: branşlı kartta "Taşeron · Sıvacı, Boyacı" ya da yalnız "Duvarcı";
 * branş yoksa null (ekran rolleri gösterir).
 */
export function bransOzeti(cari: Pick<Cari, 'roller' | 'ustaTipiIdleri'>, tipAdlari: ReadonlyMap<string, string>): string | null {
  const adlar = bransAdlari(cari.ustaTipiIdleri ?? [], tipAdlari);
  if (adlar.length === 0) return null;
  return `${cari.roller.includes('taseron') ? 'Taşeron · ' : ''}${adlar.join(', ')}`;
}
