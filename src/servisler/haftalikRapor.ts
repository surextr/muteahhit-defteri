import { bolumNo } from '../hesap/bolum';
import { butceAgaci, kalemGerceklesen } from '../hesap/butce';
import { haftalikRapor, haftaSonu, type HaftalikRapor } from '../hesap/haftalikRapor';
import { gecerliIlerlemeler, projeIlerlemesi } from '../hesap/ilerleme';
import type { Depo } from '../veri/depo';
import type { Firma, Proje, Tarih } from '../veri/tipler';
import { giderleriListele } from './gider';

// Haftalık şantiye raporu: projenin kayıtlarını okuyup saf `haftalikRapor`a verir. İlerleme ve harcama hafta başından önceki
// ve hafta sonundaki duruma göre (kayıtların kendi tarihleriyle) iki kez hesaplanır.

const gunEkle = (t: Tarih, n: number): Tarih => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface HaftalikRaporSonucu {
  proje: Proje;
  rapor: HaftalikRapor;
}

export async function haftalikRaporGetir(depo: Depo, firma: Firma, projeId: string, baslangic: Tarih, bugun: Tarih): Promise<HaftalikRaporSonucu | null> {
  const firmaId = firma.id;
  const proje = await depo.getir('proje', projeId);
  if (!proje || proje.firmaId !== firmaId || proje.iptal) return null;
  const k = { firmaId, projeId };
  const [gunlukler, kalemler, giderler, kayitlar, hareketler, fotograflar, hakedisler, sozlesmeler, satislar, teslimler, eksikler, talepler, basliklar, cariler, bolumler, bloklar, giderOzetleri] =
    await Promise.all([
      depo.listele('santiyeGunlugu', k),
      depo.listele('kalem', k),
      depo.listele('gider', k),
      depo.listele('kalemIlerlemesi', k),
      depo.listele('malzemeHareketi', k),
      depo.listele('projeFotografi', k),
      depo.listele('hakedis', k),
      depo.listele('ustaSozlesmesi', k),
      depo.listele('satis', k),
      depo.listele('daireTeslimi', k),
      depo.listele('eksikIs', k),
      depo.listele('malzemeTalebi', k),
      depo.listele('takipBasligi', k),
      depo.listele('cari', { firmaId }),
      depo.listele('bagimsizBolum', k),
      depo.listele('blok', k),
      giderleriListele(depo, firmaId, { projeId }, bugun),
    ]);
  const satirlar = (await Promise.all(giderler.map((g) => depo.listele('giderSatiri', { giderId: g.id, firmaId })))).flat();
  const kdv = firma.ayarlar.kdvMaliyeteDahil;
  const durum = (t: Tarih) => {
    const g = giderler.filter((x) => x.tarih <= t);
    return projeIlerlemesi(butceAgaci(kalemler, kalemGerceklesen(satirlar, g, kdv)), gecerliIlerlemeler(kayitlar.filter((x) => x.tarih <= t)));
  };
  const bit = haftaSonu(baslangic);
  const blokAdi = new Map(bloklar.map((b) => [b.id, b.ad]));
  const rapor = haftalikRapor({
    baslangic,
    bugun,
    gunlukler,
    cariAdi: new Map(cariler.map((c) => [c.id, c.ad])),
    bolumAdi: new Map(bolumler.map((b) => [b.id, bolumNo(blokAdi.get(b.blokId), b.no)])),
    ilerlemeOnce: durum(gunEkle(baslangic, -1)),
    ilerlemeSonra: durum(bit),
    faturaSayisi: giderler.filter((g) => g.iptal === null && g.tur !== 'iade' && g.tarih >= baslangic && g.tarih <= bit).length,
    hareketler,
    fotograflar,
    hakedisler,
    sozlesmeler,
    satislar,
    teslimler,
    eksikler,
    talepler,
    basliklar,
    odenecek: giderOzetleri
      .filter((x) => x.kalan > 0 && x.gider.vadeTarihi)
      .map((x) => ({ baslik: [x.cariAdi, x.gider.faturaNo && `Fatura ${x.gider.faturaNo}`].filter(Boolean).join(' · ') || 'Fatura', vade: x.gider.vadeTarihi!, tutar: x.kalan })),
  });
  return { proje, rapor };
}
