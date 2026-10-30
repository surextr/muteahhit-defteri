import { bolumTanimi, PLAN_TURU_ADI, satisTutarlari } from '../hesap/satis';
import type { Depo } from '../veri/depo';
import type { Firma, Kurus, Tarih } from '../veri/tipler';
import { devamEdenAsama } from '../hesap/ilerleme';
import { projeIlerlemeOzetleri } from './ilerleme';
import { satisDetayi } from './satis';

// Alıcı bağlantısının içeriği: alıcının görmesi gerekenler (ödeme planı, tahsilat durumu, inşaat ilerlemesi, son şantiye
// fotoğrafları). Maliyet, diğer alıcılar ya da firma içi bilgi girmez. Sunucuya bu nesne gider.

export interface AliciVerisi {
  surum: 1;
  firma: { ad: string; logo: string | null; telefon: string; eposta: string };
  alici: string;
  proje: string;
  bolum: string;
  bolumTanimi: string;
  teslimTarihi: Tarih | null;
  bedel: Kurus;
  plan: { ad: string; vade: Tarih; tutar: Kurus; tahsil: Kurus; kalan: Kurus; durum: string }[];
  ozet: { tahsil: Kurus; kalan: Kurus; geciken: Kurus };
  ilerleme: number | null;
  asama: string | null;
  fotograflar: { tarih: Tarih; aciklama: string; resim: string }[];
  guncelleme: string;
}

const EN_COK_FOTOGRAF = 12;

export async function aliciVerisi(depo: Depo, firma: Firma, satisId: string, bugun: Tarih): Promise<AliciVerisi | null> {
  const d = await satisDetayi(depo, firma.id, satisId, bugun);
  if (!d) return null;
  const s = d.satis;
  const [proje, fotolar, basliklar, ilerlemeler] = await Promise.all([
    depo.getir('proje', s.projeId),
    depo.listele('projeFotografi', { firmaId: firma.id, projeId: s.projeId }),
    depo.listele('takipBasligi', { firmaId: firma.id, projeId: s.projeId }),
    projeIlerlemeOzetleri(depo, firma.id, firma.ayarlar.kdvMaliyeteDahil),
  ]);
  const sirali = [...d.durumlar].sort((a, b) => a.satir.vadeTarihi.localeCompare(b.satir.vadeTarihi));
  return {
    surum: 1,
    firma: { ad: firma.ad, logo: firma.logo, telefon: firma.bilgiler.telefon, eposta: firma.bilgiler.eposta },
    alici: d.cari.ad,
    proje: proje?.ad ?? '',
    bolum: d.bolumNo,
    bolumTanimi: bolumTanimi({ bolum: d.bolum, blokAdi: d.blok?.ad ?? null, katAdi: d.kat?.ad ?? null }),
    teslimTarihi: s.teslimTarihi,
    bedel: satisTutarlari(s).net,
    plan: sirali.map((x, i) => ({
      ad: x.satir.aciklama || `${PLAN_TURU_ADI[x.satir.tur]}${x.satir.tur === 'taksit' ? ` ${sirali.slice(0, i + 1).filter((y) => y.satir.tur === 'taksit').length}` : ''}`,
      vade: x.satir.vadeTarihi,
      tutar: x.satir.tutar,
      tahsil: x.tahsil,
      kalan: x.kalan,
      durum: x.durum,
    })),
    ozet: { tahsil: d.ozet.tahsil, kalan: d.ozet.kalan, geciken: d.ozet.geciken },
    ilerleme: ilerlemeler.get(s.projeId)?.ilerleme ?? null,
    asama: devamEdenAsama(basliklar.filter((b) => !b.iptal)),
    fotograflar: fotolar
      .filter((f) => !f.iptal && f.kucukResim)
      .sort((a, b) => `${b.cekimTarihi}${b.cekimZamani ?? ''}`.localeCompare(`${a.cekimTarihi}${a.cekimZamani ?? ''}`))
      .slice(0, EN_COK_FOTOGRAF)
      .map((f) => ({ tarih: f.cekimTarihi, aciklama: f.aciklama, resim: f.kucukResim })),
    guncelleme: new Date().toISOString(),
  };
}
