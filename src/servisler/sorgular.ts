import { cariBakiye, giderKalanBorc, hesapBakiye } from '../hesap/bakiye';
import type { Depo } from '../veri/depo';
import type { CekHareketi, CekSenet, Kurus } from '../veri/tipler';

// Depodan ilgili hareketleri yükleyip src/hesap kurallarıyla hesaplar.

async function cekleriYukle(depo: Depo, idler: Iterable<string>) {
  const cekler: CekSenet[] = [];
  const cekHareketleri: CekHareketi[] = [];
  for (const id of new Set(idler)) {
    const cek = await depo.getir('cekSenet', id);
    if (cek) cekler.push(cek);
    cekHareketleri.push(...(await depo.listele('cekHareketi', { cekSenetId: id })));
  }
  return { cekler, cekHareketleri };
}

/** Artı = borcumuz, eksi = alacağımız. */
export async function cariBakiyesiGetir(depo: Depo, firmaId: string, cariId: string): Promise<Kurus> {
  const [acilislar, giderler, hakedisler, odemeler, kendiCekleri, ciroHareketleri] = await Promise.all([
    depo.listele('acilisBakiyesi', { hedefId: cariId, firmaId }),
    depo.listele('gider', { cariId, firmaId }),
    depo.listele('hakedis', { cariId, firmaId }),
    depo.listele('odeme', { cariId, firmaId }),
    depo.listele('cekSenet', { cariId, firmaId }),
    depo.listele('cekHareketi', { cariId, firmaId }),
  ]);
  const ceklerVeHareketler = await cekleriYukle(depo, [
    ...kendiCekleri.map((c) => c.id),
    ...ciroHareketleri.map((x) => x.cekSenetId),
  ]);
  return cariBakiye(cariId, { acilislar, giderler, hakedisler, odemeler, ...ceklerVeHareketler });
}

export async function giderKalanBorcuGetir(depo: Depo, firmaId: string, giderId: string): Promise<Kurus> {
  const gider = await depo.getir('gider', giderId);
  if (!gider || gider.firmaId !== firmaId) throw new Error('Gider bulunamadı.');
  return giderKalanBorc(gider, await depo.listele('eslestirme', { hedefId: giderId, firmaId }));
}

/** Hesabın kendi para biriminde. */
export async function hesapBakiyesiGetir(depo: Depo, firmaId: string, hesapId: string): Promise<Kurus> {
  const hesap = await depo.getir('hesap', hesapId);
  if (!hesap || hesap.firmaId !== firmaId) throw new Error('Hesap bulunamadı.');
  const [acilislar, odemeler, cikan, giren, cekHareketleri] = await Promise.all([
    depo.listele('acilisBakiyesi', { hedefId: hesapId, firmaId }),
    depo.listele('odeme', { hesapId, firmaId }),
    depo.listele('transfer', { kaynakHesapId: hesapId, firmaId }),
    depo.listele('transfer', { hedefHesapId: hesapId, firmaId }),
    depo.listele('cekHareketi', { hesapId, firmaId }),
  ]);
  const { cekler } = await cekleriYukle(depo, cekHareketleri.map((x) => x.cekSenetId));
  return hesapBakiye(hesap, { acilislar, odemeler, transferler: [...cikan, ...giren], cekler, cekHareketleri });
}
