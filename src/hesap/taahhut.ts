import type { Hakedis, Kurus, OdemePlani, Tarih } from '../veri/tipler';
import { teminatDurumu } from './hakedis';

// Taahhüt: usta sözleşmeleriyle bağlanan tutar, hakedişle doğan borç, ödenen ve kalan. Saf fonksiyonlar.
// Tahmini ödeme planı borç değildir; yalnız "ne zaman ne kadar ödemeyi düşünüyoruz" bilgisidir. Plan satırları,
// sözleşmeye yapılan ödemeyle en eski vadeden başlayarak kapanmış sayılır.

export type PlanDurumu = 'odendi' | 'kismen' | 'gecikti' | 'yaklasan' | 'ileride';

export interface PlanSatiriDurumu {
  plan: Pick<OdemePlani, 'id' | 'vadeTarihi' | 'tutar' | 'aciklama'>;
  /** Bu satıra düşen ödeme. */
  odenen: Kurus;
  kalan: Kurus;
  durum: PlanDurumu;
}

const gunEkle = (t: Tarih, gun: number): Tarih => {
  const d = new Date(`${t}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + gun);
  return d.toISOString().slice(0, 10);
};

/** Plan satırları vade sırasıyla; ödenen tutar en eski vadeden dağıtılır. Önümüzdeki 30 gün "yaklaşan" sayılır. */
export function planDurumu(plan: Pick<OdemePlani, 'id' | 'vadeTarihi' | 'tutar' | 'aciklama'>[], odenen: Kurus, bugun: Tarih): PlanSatiriDurumu[] {
  let kalanOdeme = Math.max(0, odenen);
  const sinir = gunEkle(bugun, 30);
  return [...plan]
    .sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi))
    .map((p) => {
      const pay = Math.min(p.tutar, kalanOdeme);
      kalanOdeme -= pay;
      const kalan = p.tutar - pay;
      let durum: PlanDurumu;
      if (kalan === 0) durum = 'odendi';
      else if (p.vadeTarihi < bugun) durum = 'gecikti';
      else if (pay > 0) durum = 'kismen';
      else if (p.vadeTarihi <= sinir) durum = 'yaklasan';
      else durum = 'ileride';
      return { plan: p, odenen: pay, kalan, durum };
    });
}

/** Toplam tutarı `adet` eşit taksite böler (kuruş farkı sonuncuya), vadeler `ilkVade`den başlayıp aylık. */
export function esitTaksitler(toplam: Kurus, adet: number, ilkVade: Tarih): { vadeTarihi: Tarih; tutar: Kurus }[] {
  if (adet <= 0 || toplam <= 0) return [];
  const taksit = Math.floor(toplam / adet);
  const [y, a, g] = ilkVade.split('-').map(Number) as [number, number, number];
  return Array.from({ length: adet }, (_, i) => {
    const ay = a - 1 + i;
    const yil = y + Math.floor(ay / 12);
    const ayNo = (ay % 12) + 1;
    // Ayın son gününü aşmasın (31 Ocak → 28/29 Şubat).
    const sonGun = new Date(Date.UTC(yil, ayNo, 0)).getUTCDate();
    return {
      vadeTarihi: `${yil}-${String(ayNo).padStart(2, '0')}-${String(Math.min(g, sonGun)).padStart(2, '0')}`,
      tutar: i === adet - 1 ? toplam - taksit * (adet - 1) : taksit,
    };
  });
}

export interface SozlesmeTaahhudu {
  /** Miktarı yazılı kalemlerin toplamı; birim fiyatlı sözleşmede eksik olabilir. */
  sozlesmeTutari: Kurus;
  /** Sözleşmede miktarı boş kalem var: toplam kesin değil. */
  eksikMiktar: boolean;
  /** Onaylı hakedişlerin tutarı (kesinti düşülmüş, KDV hariç). */
  hakedisTutari: Kurus;
  /** Onaylı hakedişlerle doğan borç (KDV dahil, tevkifat düşülmüş). */
  borc: Kurus;
  /** Hakediş giderlerine eşleşen ödemeler. */
  odenen: Kurus;
  kalanBorc: Kurus;
  bekleyenTeminat: Kurus;
  /** Sözleşmede kalan iş: sözleşme tutarı − hakediş (eksiye düşmez). */
  kalanIs: Kurus;
  /** Planda vadesi geçmiş, ödenmemiş toplam. */
  geciken: Kurus;
  plan: PlanSatiriDurumu[];
}

export function sozlesmeTaahhudu(g: {
  sozlesmeTutari: Kurus;
  eksikMiktar: boolean;
  hakedisler: Pick<Hakedis, 'onay' | 'iptal' | 'brutTutar' | 'kesintiToplam' | 'borcTutari' | 'teminatTutari'>[];
  teminatIadeleri: { iptal: unknown; tutar: Kurus }[];
  odenen: Kurus;
  plan: Pick<OdemePlani, 'id' | 'vadeTarihi' | 'tutar' | 'aciklama'>[];
  bugun: Tarih;
}): SozlesmeTaahhudu {
  const onayli = g.hakedisler.filter((h) => h.onay && h.iptal === null);
  const hakedisTutari = onayli.reduce((t, h) => t + h.brutTutar - h.kesintiToplam, 0);
  const borc = onayli.reduce((t, h) => t + h.borcTutari, 0);
  const plan = planDurumu(g.plan, g.odenen, g.bugun);
  return {
    sozlesmeTutari: g.sozlesmeTutari,
    eksikMiktar: g.eksikMiktar,
    hakedisTutari,
    borc,
    odenen: g.odenen,
    kalanBorc: borc - g.odenen,
    bekleyenTeminat: teminatDurumu(g.hakedisler, g.teminatIadeleri).bekleyen,
    kalanIs: Math.max(0, g.sozlesmeTutari - hakedisTutari),
    geciken: plan.filter((p) => p.durum === 'gecikti').reduce((t, p) => t + p.kalan, 0),
    plan,
  };
}

/** Proje toplamı (satırların toplamı; eksik miktarlı sözleşme varsa sözleşme toplamı kesin değildir). */
export function taahhutToplami(satirlar: SozlesmeTaahhudu[]): Omit<SozlesmeTaahhudu, 'plan'> {
  const t = (f: (x: SozlesmeTaahhudu) => Kurus) => satirlar.reduce((s, x) => s + f(x), 0);
  return {
    sozlesmeTutari: t((x) => x.sozlesmeTutari),
    eksikMiktar: satirlar.some((x) => x.eksikMiktar),
    hakedisTutari: t((x) => x.hakedisTutari),
    borc: t((x) => x.borc),
    odenen: t((x) => x.odenen),
    kalanBorc: t((x) => x.kalanBorc),
    bekleyenTeminat: t((x) => x.bekleyenTeminat),
    kalanIs: t((x) => x.kalanIs),
    geciken: t((x) => x.geciken),
  };
}
