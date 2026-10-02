import type {
  AcilisBakiyesi,
  CekHareketi,
  CekSenet,
  DovizBilgisi,
  Eslestirme,
  Gider,
  Hakedis,
  Hesap,
  Kurus,
  Odeme,
  Tarih,
  Transfer,
} from '../veri/tipler';

// Bakiyeler hiçbir yerde saklanmaz; her seferinde buradaki kurallarla hesaplanır.
// İptal edilmiş kayıtlar hesaba girmez.

const aktif = (k: { iptal: unknown }): boolean => k.iptal === null;

/** Gider/hakediş/taksitin ödemelerle kapanmamış kısmı. */
export function kalanTutar(
  hedef: { id: string; iptal: unknown },
  hedefTutari: Kurus,
  eslestirmeler: Eslestirme[],
): Kurus {
  if (!aktif(hedef)) return 0;
  const kapanan = eslestirmeler
    .filter((e) => aktif(e) && e.hedefId === hedef.id)
    .reduce((t, e) => t + e.tutar, 0);
  return hedefTutari - kapanan;
}

/**
 * Gider karşılığında cariye borcumuz: fatura toplamından tevkif edilen KDV düşülür
 * (o kısmı satıcıya değil vergi dairesine biz öderiz).
 */
export const giderBorcu = (gider: Gider): Kurus => gider.toplam - gider.tevkifatToplam;

/** 100.000 TL alış, 30.000 TL ödeme eşleşti → 70.000 TL. Tevkifatlı faturada tevkifat düşülmüş tutardan. */
export function giderKalanBorc(gider: Gider, eslestirmeler: Eslestirme[]): Kurus {
  return kalanTutar(gider, giderBorcu(gider), eslestirmeler);
}

/** Ödemenin hiçbir borca bağlanmamış kısmı (avans gibi). */
export function odemeAcikTutar(odeme: Odeme, eslestirmeler: Eslestirme[]): Kurus {
  if (!aktif(odeme)) return 0;
  const bagli = eslestirmeler
    .filter((e) => aktif(e) && e.odemeId === odeme.id)
    .reduce((t, e) => t + e.tutar, 0);
  return odeme.tutar - bagli;
}

// ─── Cari bakiyesi ─────────────────────────────────────────────────

export interface CariHareketleri {
  acilislar: AcilisBakiyesi[];
  giderler: Gider[];
  hakedisler: Hakedis[];
  odemeler: Odeme[];
  cekler: CekSenet[];
  cekHareketleri: CekHareketi[];
}

/** Çekin bir kez geri döndüğü durumlar: karşılıksız ya da iade. */
const GERI_DONEN = new Set(['karsiliksiz', 'iade_edildi']);

/**
 * Cari bakiyesi, TL. Artı = borcumuz, eksi = alacağımız.
 *
 * + açılış bakiyesi
 * + gider (alış) ve onaylı hakediş: bize borç doğurur
 * − yaptığımız ödemeler, + aldığımız tahsilatlar (amacı ne olursa olsun)
 * ± geri dönen çek: o çekle yapılan ödeme/tahsilatın etkisi geri alınır
 *
 * Satış/taksit alacakları 3. aşamada eklenecek.
 */
export function cariBakiye(cariId: string, h: CariHareketleri): Kurus {
  let bakiye = 0;

  for (const a of h.acilislar) {
    if (aktif(a) && a.hedefTur === 'cari' && a.hedefId === cariId) bakiye += a.tutar;
  }
  for (const g of h.giderler) {
    if (aktif(g) && g.cariId === cariId) bakiye += giderBorcu(g);
  }
  for (const hk of h.hakedisler) {
    if (aktif(hk) && hk.onay !== null && hk.cariId === cariId) bakiye += hk.netTutar;
  }
  for (const o of h.odemeler) {
    if (aktif(o) && o.cariId === cariId) bakiye += o.yon === 'tahsilat' ? o.tutar : -o.tutar;
  }

  const cekHareketleri = h.cekHareketleri.filter(aktif);
  for (const cek of h.cekler) {
    if (!aktif(cek)) continue;
    const hareketler = cekHareketleri.filter((x) => x.cekSenetId === cek.id);
    if (!hareketler.some((x) => GERI_DONEN.has(x.durum))) continue;

    if (cek.yon === 'alinan') {
      // Müşterinin tahsilatı geri alınır: yine bize borçlu.
      if (cek.cariId === cariId) bakiye -= cek.tutar;
      // Çeki ciro ettiğimiz cariye olan borcumuz geri gelir.
      const ciro = hareketler.find((x) => x.durum === 'ciro_edildi');
      if (ciro?.cariId === cariId) bakiye += cek.tutar;
    } else if (cek.cariId === cariId) {
      // Verdiğimiz çek ödenmedi: borcumuz geri gelir.
      bakiye += cek.tutar;
    }
  }

  return bakiye;
}

// ─── Kasa/banka bakiyesi ───────────────────────────────────────────

export interface HesapHareketleri {
  acilislar: AcilisBakiyesi[];
  odemeler: Odeme[];
  transferler: Transfer[];
  cekler: CekSenet[];
  cekHareketleri: CekHareketi[];
}

/** Hareketin hesabın para birimindeki tutarı. */
function hesapTutari(hesap: Hesap, tlTutar: Kurus, doviz: DovizBilgisi | null): Kurus {
  if (hesap.paraBirimi === 'TRY') return tlTutar;
  if (doviz?.paraBirimi === hesap.paraBirimi) return doviz.tutar;
  throw new Error(`${hesap.ad} hesabı ${hesap.paraBirimi}; hareketin ${hesap.paraBirimi} tutarı yok.`);
}

export type HesapHareketTuru =
  | 'acilis'
  | 'tahsilat'
  | 'odeme'
  | 'transferGiris'
  | 'transferCikis'
  | 'cekTahsil'
  | 'cekOdeme';

/** Hesap ekstresinin bir satırı; tutar hesabın para biriminde, giriş artı, çıkış eksi. */
export interface HesapHareketi {
  tur: HesapHareketTuru;
  tarih: Tarih;
  /** Kaynak kayıt (iptal ve ayrıntı için). */
  kayitTur: 'acilisBakiyesi' | 'odeme' | 'transfer' | 'cekHareketi';
  kayitId: string;
  /** Aynı gündeki hareketlerin giriş sırası. */
  olusturmaZamani: string;
  tutar: Kurus;
  aciklama: string;
  /** Transferde karşı hesap. */
  karsiHesapId: string | null;
  /** Bu satırdan sonraki bakiye. */
  bakiye: Kurus;
}

/**
 * Kasa/banka ekstresi: hareketler tarih sırasıyla, her satırda yürüyen bakiye.
 * Bakiye de buradan hesaplanır; ekstre ile bakiye hiçbir zaman ayrışmaz.
 */
export function hesapEkstresi(hesap: Hesap, h: HesapHareketleri): HesapHareketi[] {
  const satirlar: Omit<HesapHareketi, 'bakiye'>[] = [];
  const ekle = (x: Omit<HesapHareketi, 'bakiye' | 'karsiHesapId'> & { karsiHesapId?: string | null }) =>
    satirlar.push({ karsiHesapId: null, ...x });

  for (const a of h.acilislar) {
    if (!aktif(a) || a.hedefTur !== 'hesap' || a.hedefId !== hesap.id) continue;
    ekle({ tur: 'acilis', tarih: a.tarih, kayitTur: 'acilisBakiyesi', kayitId: a.id, olusturmaZamani: a.olusturmaZamani, tutar: a.tutar, aciklama: '' });
  }
  for (const o of h.odemeler) {
    if (!aktif(o) || o.hesapId !== hesap.id) continue;
    const t = hesapTutari(hesap, o.tutar, o.doviz);
    const tahsilat = o.yon === 'tahsilat';
    ekle({ tur: tahsilat ? 'tahsilat' : 'odeme', tarih: o.tarih, kayitTur: 'odeme', kayitId: o.id, olusturmaZamani: o.olusturmaZamani, tutar: tahsilat ? t : -t, aciklama: o.aciklama });
  }
  for (const tr of h.transferler) {
    if (!aktif(tr)) continue;
    const ortak = { tarih: tr.tarih, kayitTur: 'transfer' as const, kayitId: tr.id, olusturmaZamani: tr.olusturmaZamani, aciklama: tr.aciklama };
    if (tr.kaynakHesapId === hesap.id) ekle({ ...ortak, tur: 'transferCikis', tutar: -tr.tutar, karsiHesapId: tr.hedefHesapId });
    if (tr.hedefHesapId === hesap.id) ekle({ ...ortak, tur: 'transferGiris', tutar: tr.hedefTutar ?? tr.tutar, karsiHesapId: tr.kaynakHesapId });
  }

  const cekler = new Map(h.cekler.filter(aktif).map((c) => [c.id, c]));
  for (const x of h.cekHareketleri) {
    if (!aktif(x) || x.hesapId !== hesap.id) continue;
    const cek = cekler.get(x.cekSenetId);
    if (!cek || (x.durum !== 'tahsil_edildi' && x.durum !== 'odendi')) continue;
    const t = hesapTutari(hesap, cek.tutar, cek.doviz);
    const tahsil = x.durum === 'tahsil_edildi';
    ekle({ tur: tahsil ? 'cekTahsil' : 'cekOdeme', tarih: x.tarih, kayitTur: 'cekHareketi', kayitId: x.id, olusturmaZamani: x.olusturmaZamani, tutar: tahsil ? t : -t, aciklama: x.aciklama });
  }

  let bakiye = 0;
  return satirlar
    .sort((a, b) => a.tarih.localeCompare(b.tarih) || a.olusturmaZamani.localeCompare(b.olusturmaZamani))
    .map((x) => ({ ...x, bakiye: (bakiye += x.tutar) }));
}

/** Kasa/banka bakiyesi, hesabın kendi para biriminde. */
export function hesapBakiye(hesap: Hesap, h: HesapHareketleri): Kurus {
  return hesapEkstresi(hesap, h).at(-1)?.bakiye ?? 0;
}
