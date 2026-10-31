import type { Kurus, Tarih } from '../veri/tipler';

// Gelecekteki nakit ihtiyacı (saf): kasa ve bankadaki TL'den başlayarak haftalık giriş/çıkış ve birikimli bakiye.
// Kesin kalemler kayıtlı borç ve alacaklardır (fatura, alacak, çek, kredi); planlı kalemler henüz borca dönüşmemiş
// taahhütlerdir (usta sözleşmesi ödeme planı, arsa sahibine nakit plan ve kira, rezerve satışın planı). Hiçbir şey
// saklanmaz.

export type NakitKaynagi =
  | 'fatura'
  | 'verilen_cek'
  | 'kredi'
  | 'alacak'
  | 'alinan_cek'
  | 'sozlesme_plani'
  | 'arsa_sahibi'
  | 'rezerve_satis'
  | 'siparis'
  | 'tevkifat'
  | 'sabit_gider'
  | 'kdv';

export const NAKIT_KAYNAGI_ADI: Record<NakitKaynagi, string> = {
  fatura: 'Fatura',
  verilen_cek: 'Verilen çek',
  kredi: 'Kredi taksiti',
  alacak: 'Alacak / taksit',
  alinan_cek: 'Alınan çek',
  sozlesme_plani: 'Usta sözleşmesi planı',
  arsa_sahibi: 'Arsa sahibine ödeme',
  rezerve_satis: 'Rezerve satış planı',
  siparis: 'Malzeme siparişi',
  tevkifat: 'KDV tevkifatı',
  sabit_gider: 'Sabit gider',
  kdv: 'KDV (tahmini)',
};

/** Planlı (henüz borç/alacak olmamış) kaynaklar. */
export const PLANLI_KAYNAKLAR: ReadonlySet<NakitKaynagi> = new Set(['sozlesme_plani', 'arsa_sahibi', 'rezerve_satis', 'siparis', 'sabit_gider', 'kdv']);

export interface NakitKalemi {
  yon: 'giris' | 'cikis';
  kaynak: NakitKaynagi;
  /** Vadesi yazılmamış faturada null (başlangıçta ödenecek sayılır). */
  tarih: Tarih | null;
  tutar: Kurus;
  baslik: string;
  ayrinti: string;
  /** Ekran yolu (#/ olmadan). */
  yol: string;
}

export interface NakitDilimi {
  giris: Kurus;
  cikis: Kurus;
  kalemler: NakitKalemi[];
}

export interface NakitHaftasi extends NakitDilimi {
  /** 1, 2, …; 1. hafta bugün dahil 7 gün. */
  no: number;
  baslangic: Tarih;
  bitis: Tarih;
  /** Hafta sonundaki bakiye. */
  birikimli: Kurus;
}

export interface NakitSecenekleri {
  haftaSayisi?: number;
  /** Planlı kalemler (sözleşme planı, arsa sahibi, rezerve satış) sayılsın mı. */
  planli?: boolean;
  /** Vadesi geçmiş tahsilatlar başlangıçta gelmiş sayılsın mı (varsayılan hayır: geleceği belli değil). */
  gecikmisTahsilat?: boolean;
}

export interface NakitTahmini {
  /** Kasa ve bankadaki TL (kart borcu düşülmüş). */
  kasaBanka: Kurus;
  /** Vadesi bugünden önce olanlar (ödenecekler başlangıçta düşülür). */
  gecikmis: NakitDilimi;
  /** Vadesi yazılmamış faturalar (başlangıçta düşülür). */
  vadesiz: NakitDilimi;
  /** Gecikmiş ve vadesiz düşüldükten sonraki başlangıç bakiyesi. */
  baslangic: Kurus;
  haftalar: NakitHaftasi[];
  /** Ufkun sonrasındaki kalemler (toplam). */
  sonrasi: { giris: Kurus; cikis: Kurus };
  enDusuk: { tutar: Kurus; hafta: NakitHaftasi | null };
  /** Bakiyenin ilk eksiye düştüğü hafta (başlangıç eksi ise 0. hafta = null ve `baslangic` < 0). */
  ilkAcik: NakitHaftasi | null;
  planliCikis: Kurus;
  planliGiris: Kurus;
}

const gunEkle = (t: Tarih, n: number): Tarih => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const gunFarki = (a: Tarih, b: Tarih) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

const bosDilim = (): NakitDilimi => ({ giris: 0, cikis: 0, kalemler: [] });
const ekle = (d: NakitDilimi, k: NakitKalemi) => {
  d.kalemler.push(k);
  if (k.yon === 'giris') d.giris += k.tutar;
  else d.cikis += k.tutar;
};

export function nakitTahmini(kalemler: NakitKalemi[], kasaBanka: Kurus, bugun: Tarih, s: NakitSecenekleri = {}): NakitTahmini {
  const haftaSayisi = s.haftaSayisi ?? 13;
  const planli = s.planli ?? true;
  const gecikmis = bosDilim();
  const vadesiz = bosDilim();
  const haftalar: NakitHaftasi[] = Array.from({ length: haftaSayisi }, (_, i) => ({
    no: i + 1,
    baslangic: gunEkle(bugun, i * 7),
    bitis: gunEkle(bugun, i * 7 + 6),
    birikimli: 0,
    ...bosDilim(),
  }));
  const sonrasi = { giris: 0, cikis: 0 };
  let planliCikis = 0;
  let planliGiris = 0;

  const sirali = [...kalemler]
    .filter((k) => k.tutar > 0 && (planli || !PLANLI_KAYNAKLAR.has(k.kaynak)))
    .sort((a, b) => (a.tarih ?? '').localeCompare(b.tarih ?? '') || b.tutar - a.tutar);
  for (const k of sirali) {
    if (k.tarih === null) {
      ekle(vadesiz, k);
      continue;
    }
    if (k.tarih < bugun) {
      ekle(gecikmis, k);
      continue;
    }
    const i = Math.floor(gunFarki(bugun, k.tarih) / 7);
    if (i >= haftaSayisi) {
      if (k.yon === 'giris') sonrasi.giris += k.tutar;
      else sonrasi.cikis += k.tutar;
      continue;
    }
    ekle(haftalar[i]!, k);
    if (PLANLI_KAYNAKLAR.has(k.kaynak)) {
      if (k.yon === 'giris') planliGiris += k.tutar;
      else planliCikis += k.tutar;
    }
  }

  const baslangic = kasaBanka - gecikmis.cikis - vadesiz.cikis + (s.gecikmisTahsilat ? gecikmis.giris : 0);
  let bakiye = baslangic;
  let enDusuk: NakitTahmini['enDusuk'] = { tutar: baslangic, hafta: null };
  let ilkAcik: NakitHaftasi | null = null;
  for (const h of haftalar) {
    bakiye += h.giris - h.cikis;
    h.birikimli = bakiye;
    if (bakiye < enDusuk.tutar) enDusuk = { tutar: bakiye, hafta: h };
    if (!ilkAcik && bakiye < 0 && baslangic >= 0) ilkAcik = h;
  }
  return { kasaBanka, gecikmis, vadesiz, baslangic, haftalar, sonrasi, enDusuk, ilkAcik, planliCikis, planliGiris };
}

/**
 * Plan satırlarından, aynı taahhüdün kayıtlı (ödenmemiş) borcunu en eski vadeden düşer: hakedişle borca dönüşen kısım
 * fatura olarak zaten sayılır, iki kez çıkış yazılmasın.
 */
export function plandanBorcuDus<T extends { tarih: Tarih; tutar: Kurus }>(satirlar: T[], acikBorc: Kurus): T[] {
  let dus = Math.max(0, acikBorc);
  return [...satirlar]
    .sort((a, b) => a.tarih.localeCompare(b.tarih))
    .map((x) => {
      const d = Math.min(dus, x.tutar);
      dus -= d;
      return { ...x, tutar: x.tutar - d };
    })
    .filter((x) => x.tutar > 0);
}

/** "12 Ara haftası", "bu hafta", "gelecek hafta". */
export function haftaMetni(h: Pick<NakitHaftasi, 'no' | 'baslangic'>): string {
  if (h.no === 1) return 'bu hafta (7 gün)';
  if (h.no === 2) return 'gelecek hafta';
  return `${new Date(`${h.baslangic}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' })} haftası`;
}
