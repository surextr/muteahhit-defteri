import { krediOzetleri, krediVadeleri } from './kredi';
import { giderBorcu, giderKalanBorc, kalanTutar } from '../hesap/bakiye';
import { butceAgaci, kalemGerceklesen } from '../hesap/butce';
import { firmaRaporu, karZarar, type FirmaRaporu, type KarZarar, type RaporSatisi } from '../hesap/karZarar';
import { satisPlanDurumu } from '../hesap/satis';
import type { Depo } from '../veri/depo';
import type { Tarih } from '../veri/tipler';
import { birimToplamlari, hesaplariListele } from './hesap';

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

/**
 * Firma geneli: kişinin girebildiği projelerin raporları, projesiz (genel) giderler ve kasa/bankadaki TL ile başlayan
 * birleşik nakit akışı.
 */
export async function firmaRaporuGetir(depo: Depo, firmaId: string, kdvDahil: boolean, bugun: Tarih, erisim: Set<string> | null = null): Promise<FirmaRaporu> {
  const [projeler, giderler, eslestirmeler, hesaplar] = await Promise.all([
    depo.listele('proje', { firmaId }),
    depo.listele('gider', { firmaId }),
    depo.listele('eslestirme', { firmaId }),
    hesaplariListele(depo, firmaId),
  ]);
  const satirlar = [];
  for (const p of aktif(projeler).filter((x) => !erisim || erisim.has(x.id))) {
    satirlar.push({ projeId: p.id, ad: p.ad, rapor: await karZararGetir(depo, firmaId, p.id, kdvDahil, bugun) });
  }
  const genel = aktif(giderler).filter((g) => g.projeId === null);
  const genelSatirlar = (await Promise.all(genel.map((g) => depo.listele('giderSatiri', { giderId: g.id, firmaId })))).flat();
  const genelHarcanan = [...kalemGerceklesen(genelSatirlar, genel, kdvDahil).values()].reduce((t, x) => t + x, 0);
  const tl = (kart: boolean) => birimToplamlari(hesaplar, kart).find((x) => x.paraBirimi === 'TRY')?.toplam ?? 0;
  return firmaRaporu({
    projeler: satirlar,
    genelHarcanan,
    genelBorclar: genel
      .filter((g) => g.tur === 'alis')
      .map((g) => ({ tarih: g.tarih, vadeTarihi: g.vadeTarihi, borc: giderBorcu(g), kalan: Math.max(0, giderKalanBorc(g, eslestirmeler)) }))
      // Kredi taksitlerinin ödenmemiş kısmı vadesine göre çıkış (kişinin projeleri ve firma geneli krediler).
      .concat(
        krediVadeleri(await krediOzetleri(depo, firmaId, bugun))
          .filter((v) => !erisim || v.projeId === null || erisim.has(v.projeId))
          .map((v) => ({ tarih: v.vadeTarihi, vadeTarihi: v.vadeTarihi, borc: v.kalan, kalan: v.kalan })),
      ),
    eldeki: tl(false) + tl(true),
    bugun,
  });
}
