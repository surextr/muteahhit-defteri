import { butceAgaci, kalemGerceklesen } from '../hesap/butce';
import {
  takipCelismeleri,
  devamEdenAsama,
  gecerliIlerlemeler,
  hakedisOnerileri,
  ILERLEME_UYARI_ESIGI,
  projeIlerlemesi,
  yuzdeHatasi,
  type HakedisOnerisi,
  type ProjeIlerlemesi,
} from '../hesap/ilerleme';
import type { Depo } from '../veri/depo';
import type { KalemIlerlemesi, Tarih } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

/**
 * İlerleme takibi: ana kalem yüzdesi girişi ve iptali, proje ilerlemesi ve erken uyarı, hakedişten öneri.
 * Giriş eski kaydı değiştirmez; her güncelleme yeni tarihli satırdır (geçmiş buradan).
 */

export interface IlerlemeGirdisi {
  projeId: string;
  kalemId: string;
  tarih: Tarih;
  yuzde: number;
  kaynak: KalemIlerlemesi['kaynak'];
  hakedisId: string | null;
  not: string;
}

export async function ilerlemeKaydet(depo: Depo, servis: KayitServisi, g: IlerlemeGirdisi): Promise<KalemIlerlemesi> {
  const hata = yuzdeHatasi(g.yuzde);
  if (hata) throw new IsKuraliHatasi(hata);
  const kalem = await depo.getir('kalem', g.kalemId);
  if (!kalem || kalem.iptal || kalem.projeId !== g.projeId) throw new IsKuraliHatasi('Kalem bulunamadı.');
  if (kalem.ustKalemId !== null) throw new IsKuraliHatasi('İlerleme ana kalemde tutulur.');
  if (!g.tarih) throw new IsKuraliHatasi('Tarih seçin.');
  return servis.ekle('kalemIlerlemesi', {
    projeId: g.projeId,
    kalemId: g.kalemId,
    tarih: g.tarih,
    yuzde: Math.round(g.yuzde * 10) / 10,
    kaynak: g.kaynak,
    hakedisId: g.kaynak === 'hakedis' ? g.hakedisId : null,
    not: g.not.trim(),
  });
}

/** Yanlış girişi iptal eder; kalemin bir önceki kaydı yeniden geçerli olur. */
export async function ilerlemeIptal(servis: KayitServisi, id: string, gerekce?: string): Promise<void> {
  await servis.iptal('kalemIlerlemesi', id, gerekce);
}

export interface ProjeIlerlemeDetayi {
  ilerleme: ProjeIlerlemesi;
  /** Ana kalem kimliğine göre hakediş önerileri (geçerli yüzdeden farklı olanlar). */
  oneriler: Map<string, HakedisOnerisi>;
  /** Bütün girişler (iptal edilenler dahil), geçmiş için. */
  kayitlar: KalemIlerlemesi[];
  devamEden: string | null;
  /** Kalem ilerlemesi ile takip başlığı durumu çelişkileri. */
  celismeler: string[];
}

export async function projeIlerlemesiGetir(
  depo: Depo,
  firmaId: string,
  projeId: string,
  kdvDahil: boolean,
  esik = ILERLEME_UYARI_ESIGI,
): Promise<ProjeIlerlemeDetayi> {
  const k = { projeId, firmaId };
  const [kalemler, giderler, kayitlar, basliklar, sozlesmeler, hakedisler] = await Promise.all([
    depo.listele('kalem', k),
    depo.listele('gider', k),
    depo.listele('kalemIlerlemesi', k),
    depo.listele('takipBasligi', k),
    depo.listele('ustaSozlesmesi', k),
    depo.listele('hakedis', k),
  ]);
  const satirlar = (await Promise.all(giderler.map((g) => depo.listele('giderSatiri', { giderId: g.id, firmaId })))).flat();
  const gecerli = gecerliIlerlemeler(kayitlar);
  const ilerleme = projeIlerlemesi(butceAgaci(kalemler, kalemGerceklesen(satirlar, giderler, kdvDahil)), gecerli, esik);
  const oneriler = hakedisOnerileri(kalemler, sozlesmeler, hakedisler);
  for (const [id, o] of oneriler) if (gecerli.get(id)?.yuzde === o.yuzde) oneriler.delete(id);
  const celismeler = takipCelismeleri(
    ilerleme.kalemler.map((x) => ({ ad: x.kalem.ad, yuzde: x.yuzde })),
    basliklar,
  );
  return { ilerleme, oneriler, kayitlar, devamEden: devamEdenAsama(basliklar), celismeler };
}

export interface ProjeIlerlemeOzeti {
  ilerleme: number | null;
  harcamaYuzdesi: number | null;
  /** Bütçe yoksa yüzde yerine gösterilir. */
  harcanan: number;
  uyari: boolean;
  /** Uyarı veren ana kalem sayısı. */
  uyariKalemSayisi: number;
  devamEden: string | null;
}

/** Projeler listesi için bütün projelerin ilerleme özeti; firmanın tablolarını birer kez okur. */
export async function projeIlerlemeOzetleri(
  depo: Depo,
  firmaId: string,
  kdvDahil: boolean,
  esik = ILERLEME_UYARI_ESIGI,
): Promise<Map<string, ProjeIlerlemeOzeti>> {
  const k = { firmaId };
  const [projeler, kalemler, giderler, satirlar, kayitlar, basliklar] = await Promise.all([
    depo.listele('proje', k),
    depo.listele('kalem', k),
    depo.listele('gider', k),
    depo.listele('giderSatiri', k),
    depo.listele('kalemIlerlemesi', k),
    depo.listele('takipBasligi', k),
  ]);
  const grupla = <T extends { projeId: string | null }>(x: T[]) => {
    const m = new Map<string, T[]>();
    for (const e of x) if (e.projeId) m.set(e.projeId, [...(m.get(e.projeId) ?? []), e]);
    return m;
  };
  const giderProjesi = new Map(giderler.map((g) => [g.id, g.projeId]));
  const satirGrubu = new Map<string, typeof satirlar>();
  for (const s of satirlar) {
    const p = giderProjesi.get(s.giderId);
    if (p) satirGrubu.set(p, [...(satirGrubu.get(p) ?? []), s]);
  }
  const [kalemG, giderG, kayitG, baslikG] = [grupla(kalemler), grupla(giderler), grupla(kayitlar), grupla(basliklar)];

  const sonuc = new Map<string, ProjeIlerlemeOzeti>();
  for (const p of projeler) {
    if (p.iptal) continue;
    const agac = butceAgaci(kalemG.get(p.id) ?? [], kalemGerceklesen(satirGrubu.get(p.id) ?? [], giderG.get(p.id) ?? [], kdvDahil));
    const i = projeIlerlemesi(agac, gecerliIlerlemeler(kayitG.get(p.id) ?? []), esik);
    sonuc.set(p.id, {
      ilerleme: i.ilerleme,
      harcamaYuzdesi: i.harcamaYuzdesi,
      harcanan: i.harcanan,
      uyari: i.uyari,
      uyariKalemSayisi: i.kalemler.filter((x) => x.uyari).length,
      devamEden: devamEdenAsama(baslikG.get(p.id) ?? []),
    });
  }
  return sonuc;
}
