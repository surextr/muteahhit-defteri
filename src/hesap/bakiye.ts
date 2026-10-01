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

/** 100.000 TL alış, 30.000 TL ödeme eşleşti → 70.000 TL. */
export function giderKalanBorc(gider: Gider, eslestirmeler: Eslestirme[]): Kurus {
  return kalanTutar(gider, gider.toplam, eslestirmeler);
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
    if (aktif(g) && g.cariId === cariId) bakiye += g.toplam;
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

/** Kasa/banka bakiyesi, hesabın kendi para biriminde. */
export function hesapBakiye(hesap: Hesap, h: HesapHareketleri): Kurus {
  let bakiye = 0;

  for (const a of h.acilislar) {
    if (aktif(a) && a.hedefTur === 'hesap' && a.hedefId === hesap.id) bakiye += a.tutar;
  }
  for (const o of h.odemeler) {
    if (!aktif(o) || o.hesapId !== hesap.id) continue;
    const t = hesapTutari(hesap, o.tutar, o.doviz);
    bakiye += o.yon === 'tahsilat' ? t : -t;
  }
  for (const tr of h.transferler) {
    if (!aktif(tr)) continue;
    if (tr.kaynakHesapId === hesap.id) bakiye -= tr.tutar;
    if (tr.hedefHesapId === hesap.id) bakiye += tr.hedefTutar ?? tr.tutar;
  }

  const cekler = new Map(h.cekler.filter(aktif).map((c) => [c.id, c]));
  for (const x of h.cekHareketleri) {
    if (!aktif(x) || x.hesapId !== hesap.id) continue;
    const cek = cekler.get(x.cekSenetId);
    if (!cek) continue;
    const t = hesapTutari(hesap, cek.tutar, cek.doviz);
    if (x.durum === 'tahsil_edildi') bakiye += t;
    if (x.durum === 'odendi') bakiye -= t;
  }

  return bakiye;
}
