import { fiyatGruplari, type AlimSatiri, type FiyatGrubu } from '../hesap/fiyatSapmasi';
import type { Depo } from '../veri/depo';
import type { Tarih } from '../veri/tipler';

// Alış fiyatları raporu: alış faturalarının miktarlı satırları (hakediş, kredi faizi ve iade hariç), fiyat kataloğunun
// malzeme ve makine kalemleriyle gruplanır.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);

export interface AlisFiyatlari {
  gruplar: FiyatGrubu[];
  /** Miktarı ya da birimi yazılmadığı için gruplanamayan alış satırı sayısı. */
  miktarsiz: number;
}

export async function alisFiyatlari(depo: Depo, firmaId: string, s: { bas: Tarih | null; projeId: string | null; erisim: Set<string> | null }): Promise<AlisFiyatlari> {
  const k = { firmaId };
  const [giderler, satirlar, cariler, katalog] = await Promise.all([depo.listele('gider', k), depo.listele('giderSatiri', k), depo.listele('cari', k), depo.listele('fiyatKalemi', k)]);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const uygun = new Map(
    aktif(giderler)
      .filter((g) => g.tur === 'alis' && !g.hakedisId && !g.krediId)
      .filter((g) => (!s.bas || g.tarih >= s.bas) && (!s.projeId || g.projeId === s.projeId) && (!s.erisim || (g.projeId !== null && s.erisim.has(g.projeId))))
      .map((g) => [g.id, g]),
  );
  const alimlar: AlimSatiri[] = [];
  let miktarsiz = 0;
  for (const x of aktif(satirlar)) {
    const g = uygun.get(x.giderId);
    if (!g || x.kdvHaricTutar <= 0) continue;
    if (!x.miktar || !x.birim?.trim()) {
      miktarsiz++;
      continue;
    }
    alimlar.push({
      satirId: x.id,
      giderId: g.id,
      tarih: g.tarih,
      cariId: g.cariId,
      cariAdi: g.cariId ? (cariAdi.get(g.cariId) ?? null) : null,
      projeId: g.projeId,
      aciklama: x.aciklama,
      miktar: x.miktar,
      birim: x.birim,
      tutar: x.kdvHaricTutar,
    });
  }
  const malzeme = aktif(katalog)
    .filter((f) => f.tur !== 'iscilik')
    .map((f) => ({ id: f.id, ad: f.ad, birim: f.birim }));
  return { gruplar: fiyatGruplari(alimlar, malzeme), miktarsiz };
}
