import { gecerliIlerlemeler } from '../hesap/ilerleme';
import { anaKalem, karsilastir, type GercekSatir, type Karsilastirma, type PlanSatiri } from '../hesap/karsilastirma';
import { maliyetOzeti } from '../hesap/maliyet';
import type { Depo } from '../veri/depo';
import type { Kalem, MaliyetHesabi } from '../veri/tipler';
import { katalogHaritasi, maliyetHesaplari } from './maliyet';

// Projenin başlangıç maliyeti (en son onaylı revizyon) ile gerçekleşen alış giderlerinin karşılaştırması.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);

export interface KarsilastirmaSonucu {
  /** Karşılaştırılan hesap; projede onaylı hesap yoksa null. */
  hesap: MaliyetHesabi | null;
  /** Projenin onaylanmamış hesapları (yönlendirme için). */
  taslaklar: MaliyetHesabi[];
  sonuc: Karsilastirma | null;
}

export async function karsilastirmaGetir(depo: Depo, firmaId: string, projeId: string, esik: number, hesapId?: string): Promise<KarsilastirmaSonucu> {
  const hesaplar = await maliyetHesaplari(depo, firmaId, projeId);
  const onayli = hesaplar.filter((h) => h.onay).sort((a, b) => b.revizyon - a.revizyon || b.onay!.zaman.localeCompare(a.onay!.zaman));
  const hesap = (hesapId ? onayli.find((h) => h.id === hesapId) : undefined) ?? onayli[0] ?? null;
  const taslaklar = hesaplar.filter((h) => !h.onay);
  if (!hesap) return { hesap: null, taslaklar, sonuc: null };

  const k = { firmaId, projeId };
  const [katalog, giderler, satirlar, kalemler, ilerlemeKayitlari] = await Promise.all([
    katalogHaritasi(depo, firmaId),
    depo.listele('gider', k),
    depo.listele('giderSatiri', { firmaId }),
    depo.listele('kalem', k),
    depo.listele('kalemIlerlemesi', k),
  ]);
  const ozet = maliyetOzeti(hesap, katalog);
  const planlar: PlanSatiri[] = ozet.satirlar.map((x) => ({
    id: x.satir.id,
    ad: x.satir.ad,
    tur: x.satir.tur,
    birim: x.satir.birim,
    kod: x.satir.butceKalemiKodu,
    miktar: x.satir.miktar,
    birimFiyat: x.fiyat.fiyat,
    tutar: x.tutar,
  }));

  const kalem = new Map(kalemler.map((x) => [x.id, x]));
  const anahtar = (x: Kalem) => x.sistemKodu ?? `kalem:${x.id}`;
  const projeGiderleri = new Map(aktif(giderler).map((g) => [g.id, g]));
  const gercekler: GercekSatir[] = [];
  for (const s of aktif(satirlar)) {
    const g = projeGiderleri.get(s.giderId);
    if (!g) continue;
    const yaprak = s.kalemId ? kalem.get(s.kalemId) : undefined;
    const ust = yaprak?.ustKalemId ? kalem.get(yaprak.ustKalemId) : yaprak;
    // Hazır kalemde ana kalem hazır listeden (planla aynı), firmanın açtığı kalemde projedeki ağaçtan.
    const ana = yaprak?.sistemKodu ? anaKalem(yaprak.sistemKodu) : ust ? { kod: anahtar(ust), ad: ust.ad } : { kod: null, ad: 'Kalemsiz' };
    gercekler.push({
      kod: yaprak ? anahtar(yaprak) : null,
      kodAdi: yaprak?.ad ?? 'Kalemsiz',
      anaKod: ana.kod,
      anaAdi: ana.ad,
      aciklama: s.aciklama,
      miktar: s.miktar,
      birim: s.birim,
      tutar: s.kdvHaricTutar,
      tarih: g.tarih,
      giderId: g.id,
    });
  }

  const ilerlemeler = new Map<string, number>();
  for (const [kalemId, kayit] of gecerliIlerlemeler(ilerlemeKayitlari)) {
    const x = kalem.get(kalemId);
    if (x) ilerlemeler.set(anahtar(x), kayit.yuzde);
  }
  return { hesap, taslaklar, sonuc: karsilastir(planlar, gercekler, ilerlemeler, esik) };
}
