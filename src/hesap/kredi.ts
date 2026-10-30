import type { Gider, Kredi, KrediTaksiti, Kurus, Odeme, Tarih } from '../veri/tipler';
import { esitTaksitler } from './taahhut';

// Banka kredisi (saf): eşit taksitli plan önerisi, taksit ve kredi durumu, kayıt denetimi.
// Ödenen anapara = taksite bağlı anapara ödemeleri; ödenen faiz = taksite bağlı faiz giderleri (iptal edilmemiş).

/**
 * Eşit taksitli (anüite) plan: aylık faiz oranı % ise her ay faiz = kalan anapara × oran, anapara = taksit − faiz;
 * kuruş farkı son taksitte. Oran 0 ya da boşsa anapara eşit bölünür, faiz 0.
 */
export function esitTaksitPlani(anapara: Kurus, aylikFaiz: number | null, adet: number, ilkVade: Tarih, yeniId: () => string): KrediTaksiti[] {
  if (!(anapara > 0) || !Number.isInteger(adet) || adet < 1) return [];
  const vadeler = esitTaksitler(anapara, adet, ilkVade);
  const r = (aylikFaiz ?? 0) / 100;
  if (r <= 0) return vadeler.map((v) => ({ id: yeniId(), vadeTarihi: v.vadeTarihi, anapara: v.tutar, faiz: 0 }));
  const taksit = (anapara * r) / (1 - (1 + r) ** -adet);
  let kalan = anapara;
  return vadeler.map((v, i) => {
    const faiz = Math.round(kalan * r);
    const ana = i === adet - 1 ? kalan : Math.min(kalan, Math.round(taksit - faiz));
    kalan -= ana;
    return { id: yeniId(), vadeTarihi: v.vadeTarihi, anapara: ana, faiz };
  });
}

export type TaksitDurumu = 'odendi' | 'kismen' | 'gecikti' | 'yaklasan' | 'bekliyor';

export const TAKSIT_DURUMU_ADI: Record<TaksitDurumu, string> = {
  odendi: 'Ödendi',
  kismen: 'Kısmen ödendi',
  gecikti: 'Vadesi geçti',
  yaklasan: 'Yaklaşıyor',
  bekliyor: 'Bekliyor',
};

export interface TaksitDurumSatiri {
  taksit: KrediTaksiti;
  odenenAnapara: Kurus;
  odenenFaiz: Kurus;
  kalanAnapara: Kurus;
  kalanFaiz: Kurus;
  durum: TaksitDurumu;
}

export interface KrediOzeti {
  kredi: Kredi;
  taksitler: TaksitDurumSatiri[];
  odenenAnapara: Kurus;
  odenenFaiz: Kurus;
  /** Bankaya kalan anapara borcu. */
  kalanAnapara: Kurus;
  kalanFaiz: Kurus;
  toplamFaiz: Kurus;
  /** İlk ödenmemiş taksit. */
  sonraki: TaksitDurumSatiri | null;
  geciken: Kurus;
}

const gunFarki = (a: Tarih, b: Tarih) => Math.round((Date.parse(`${b}T00:00Z`) - Date.parse(`${a}T00:00Z`)) / 86_400_000);

/** Bugünden `yaklasanGun` gün içinde vadesi gelen ödenmemiş taksit "yaklaşıyor". */
export function krediOzeti(
  kredi: Kredi,
  odemeler: Pick<Odeme, 'iptal' | 'krediId' | 'krediTaksitId' | 'tutar' | 'yon'>[],
  giderler: Pick<Gider, 'iptal' | 'krediId' | 'krediTaksitId' | 'toplam'>[],
  bugun: Tarih,
  yaklasanGun = 7,
): KrediOzeti {
  const ana = new Map<string, Kurus>();
  const faiz = new Map<string, Kurus>();
  for (const o of odemeler)
    if (!o.iptal && o.krediId === kredi.id && o.krediTaksitId && o.yon === 'odeme') ana.set(o.krediTaksitId, (ana.get(o.krediTaksitId) ?? 0) + o.tutar);
  for (const g of giderler) if (!g.iptal && g.krediId === kredi.id && g.krediTaksitId) faiz.set(g.krediTaksitId, (faiz.get(g.krediTaksitId) ?? 0) + g.toplam);
  const taksitler = [...kredi.taksitler]
    .sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi))
    .map((t): TaksitDurumSatiri => {
      const odenenAnapara = ana.get(t.id) ?? 0;
      const odenenFaiz = faiz.get(t.id) ?? 0;
      const kalanAnapara = Math.max(0, t.anapara - odenenAnapara);
      const kalanFaiz = Math.max(0, t.faiz - odenenFaiz);
      const kalan = kalanAnapara + kalanFaiz;
      const durum: TaksitDurumu =
        kalan === 0
          ? 'odendi'
          : t.vadeTarihi < bugun
            ? 'gecikti'
            : odenenAnapara + odenenFaiz > 0
              ? 'kismen'
              : gunFarki(bugun, t.vadeTarihi) <= yaklasanGun
                ? 'yaklasan'
                : 'bekliyor';
      return { taksit: t, odenenAnapara, odenenFaiz, kalanAnapara, kalanFaiz, durum };
    });
  const topla = (f: (x: TaksitDurumSatiri) => number) => taksitler.reduce((s, x) => s + f(x), 0);
  const planAnapara = topla((x) => x.taksit.anapara);
  const odenenAnapara = topla((x) => x.odenenAnapara);
  return {
    kredi,
    taksitler,
    odenenAnapara,
    odenenFaiz: topla((x) => x.odenenFaiz),
    // Plan anaparadan azsa (eksik plan) kalan borç kullanılan anaparadan hesaplanır.
    kalanAnapara: Math.max(0, Math.max(planAnapara, kredi.anapara) - odenenAnapara),
    kalanFaiz: topla((x) => x.kalanFaiz),
    toplamFaiz: topla((x) => x.taksit.faiz),
    sonraki: taksitler.find((x) => x.durum !== 'odendi') ?? null,
    geciken: topla((x) => (x.durum === 'gecikti' ? x.kalanAnapara + x.kalanFaiz : 0)),
  };
}

export interface KrediIcerigi {
  ad: string;
  bankaCariId: string | null;
  hesapId: string;
  projeId: string | null;
  kullanimTarihi: Tarih;
  anapara: Kurus;
  faizOrani: number | null;
  taksitler: KrediTaksiti[];
  aciklama: string;
}

/** Kaydı engelleyen hatalar. Taksitlerin anapara toplamı kullanılan anaparaya eşit olmalı. */
export function krediHatalari(k: KrediIcerigi): string[] {
  const h: string[] = [];
  const tarih = /^\d{4}-\d{2}-\d{2}$/;
  if (!k.ad.trim()) h.push('Krediye bir ad verin (örn. "Ziraat proje kredisi").');
  if (!k.hesapId) h.push('Paranın girdiği hesabı seçin.');
  if (!tarih.test(k.kullanimTarihi)) h.push('Kullanım tarihini seçin.');
  if (!Number.isInteger(k.anapara) || k.anapara <= 0) h.push('Kredi tutarını yazın.');
  if (k.faizOrani !== null && (!Number.isFinite(k.faizOrani) || k.faizOrani < 0 || k.faizOrani > 100)) h.push('Faiz oranı geçersiz.');
  if (k.taksitler.length === 0) h.push('Geri ödeme planı yok: taksitleri ekleyin ya da "Eşit taksit öner"i kullanın.');
  for (const t of k.taksitler) {
    if (!tarih.test(t.vadeTarihi)) h.push('Her taksitin vadesini seçin.');
    else if (tarih.test(k.kullanimTarihi) && t.vadeTarihi < k.kullanimTarihi) h.push('Taksit vadesi kullanım tarihinden önce olamaz.');
    if (!Number.isInteger(t.anapara) || t.anapara < 0 || !Number.isInteger(t.faiz) || t.faiz < 0) h.push('Taksit tutarları geçersiz.');
    if (t.anapara + t.faiz <= 0) h.push('Boş taksit satırı var.');
  }
  const toplam = k.taksitler.reduce((s, t) => s + t.anapara, 0);
  if (k.taksitler.length > 0 && Number.isInteger(k.anapara) && toplam !== k.anapara)
    h.push(`Taksitlerin anapara toplamı (${(toplam / 100).toLocaleString('tr-TR')} TL) kredi tutarına eşit olmalı.`);
  if (new Set(k.taksitler.map((t) => t.id)).size !== k.taksitler.length) h.push('Taksit satırları tekrarlanıyor.');
  return [...new Set(h)];
}
