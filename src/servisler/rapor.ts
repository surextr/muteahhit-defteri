import { giderBorcu, giderKalanBorc, kalanTutar } from '../hesap/bakiye';
import { butceAgaci, kalemGerceklesen } from '../hesap/butce';
import { karZarar, type KarZarar, type RaporSatisi } from '../hesap/karZarar';
import { satisPlanDurumu } from '../hesap/satis';
import type { Depo } from '../veri/depo';
import type { Tarih } from '../veri/tipler';

const aktif = <T extends { iptal: unknown }>(x: T[]) => x.filter((k) => k.iptal === null);

/** Projenin kâr/zarar ve nakit akışı raporu; kayıtlardan her seferinde hesaplanır. */
export async function karZararGetir(depo: Depo, firmaId: string, projeId: string, kdvDahil: boolean, bugun: Tarih): Promise<KarZarar> {
  const k = { projeId, firmaId };
  const [kalemler, giderler, satislar, bolumler, alacaklar, eslestirmeler] = await Promise.all([
    depo.listele('kalem', k),
    depo.listele('gider', k),
    depo.listele('satis', k),
    depo.listele('bagimsizBolum', k),
    depo.listele('alacak', k),
    depo.listele('eslestirme', { firmaId }),
  ]);
  const satirlar = (await Promise.all(giderler.map((g) => depo.listele('giderSatiri', { giderId: g.id, firmaId })))).flat();
  const butce = butceAgaci(kalemler, kalemGerceklesen(satirlar, giderler, kdvDahil));

  const aktifAlacaklar = aktif(alacaklar);
  const kalan = new Map(aktifAlacaklar.map((a) => [a.id, kalanTutar('alacak', a, a.tutar, eslestirmeler)]));
  const bolumHaritasi = new Map(aktif(bolumler).map((b) => [b.id, b]));
  const raporSatislari: RaporSatisi[] = [];
  for (const s of aktif(satislar)) {
    const bolum = bolumHaritasi.get(s.bolumId);
    if (bolum) raporSatislari.push({ satis: s, bolum, durumlar: satisPlanDurumu(s.plan, kalan, bugun) });
  }

  return karZarar({
    butce,
    satislar: raporSatislari,
    bolumler: [...bolumHaritasi.values()],
    ilaveImalat: aktifAlacaklar
      .filter((a) => a.kaynakTur === 'ilaveImalat')
      .map((a) => ({ tarih: a.tarih, vadeTarihi: a.vadeTarihi, tutar: a.tutar, kalan: Math.max(0, kalan.get(a.id) ?? 0) })),
    borclar: aktif(giderler)
      .filter((g) => g.tur === 'alis')
      .map((g) => ({ tarih: g.tarih, vadeTarihi: g.vadeTarihi, borc: giderBorcu(g), kalan: Math.max(0, giderKalanBorc(g, eslestirmeler)) })),
    bugun,
  });
}
