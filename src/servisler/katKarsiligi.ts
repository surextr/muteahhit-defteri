import { kalanTutar } from '../hesap/bakiye';
import { arsaSahibiYukumlulukleri, teslimTarihiHesapla, type ArsaSahibiYukumlulugu } from '../hesap/katKarsiligi';
import { yerelGun } from '../hesap/tarih';
import type { Depo } from '../veri/depo';
import type {
  ArsaSahibiOdemesi,
  GecikmeCezasi,
  IlaveImalat,
  IlaveImalatDurumu,
  KatKarsiligiSozlesme,
  Kurus,
  Tarih,
} from '../veri/tipler';
import { katKarsiligiGetir } from './arsaSahibi';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Kat karşılığı sözleşmesinin ayrıntıları: tarih, teslim, gecikme cezası, kira yardımı, arsa sahibine nakit
// ödeme planı ve ilave imalat. Yükümlülükler cari borcu değildir (hesap/katKarsiligi.ts); ödeme gider olarak
// girilir. Arsa sahibinin ödeyeceği ilave imalat onaylanınca alacak doğar.

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const tarihMi = (t: Tarih | null) => t === null || TARIH.test(t);

async function sozlesmeGerekli(depo: Depo, firmaId: string, projeId: string): Promise<KatKarsiligiSozlesme> {
  const s = await katKarsiligiGetir(depo, firmaId, projeId);
  if (!s) throw new IsKuraliHatasi('Önce paylaşım oranını ve arsa sahiplerini girin.');
  return s;
}

function arsaSahibiDenetle(s: KatKarsiligiSozlesme, cariId: string) {
  if (!s.arsaSahipleri.some((a) => a.cariId === cariId)) throw new IsKuraliHatasi('Bu kişi sözleşmede arsa sahibi değil.');
}

// ─── Ayrıntılar ve onay ────────────────────────────────────────────

export interface KatKarsiligiAyrintilari {
  sozlesmeTarihi: Tarih | null;
  teslimTarihi: Tarih | null;
  /** Doluysa teslim "ruhsattan itibaren X ay"dır; kesin tarih kullanılmaz. */
  teslimSuresiAy: number | null;
  gecikmeCezasi: GecikmeCezasi | null;
  not: string;
  kiralar: { cariId: string; kiraAylik: Kurus | null; kiraBaslangic: Tarih | null; teslimAlindi: Tarih | null }[];
}

export function ayrintiHatalari(a: KatKarsiligiAyrintilari): string[] {
  const h: string[] = [];
  if (!tarihMi(a.sozlesmeTarihi) || !tarihMi(a.teslimTarihi)) h.push('Tarihleri gün.ay.yıl olarak seçin.');
  if (a.teslimSuresiAy !== null && (!Number.isInteger(a.teslimSuresiAy) || a.teslimSuresiAy < 1 || a.teslimSuresiAy > 120)) {
    h.push('Teslim süresi 1 ile 120 ay arasında olmalı.');
  }
  if (a.gecikmeCezasi && (!Number.isInteger(a.gecikmeCezasi.tutar) || a.gecikmeCezasi.tutar <= 0)) h.push("Gecikme cezası 0'dan büyük olmalı.");
  for (const k of a.kiralar) {
    if (!tarihMi(k.kiraBaslangic) || !tarihMi(k.teslimAlindi)) h.push('Kira tarihlerini seçin.');
    if (k.kiraAylik !== null && (!Number.isInteger(k.kiraAylik) || k.kiraAylik <= 0)) h.push("Aylık kira 0'dan büyük olmalı.");
    if (k.kiraAylik !== null && !k.kiraBaslangic) h.push('Kira yardımının başladığı ayı seçin.');
    if (k.kiraBaslangic && k.teslimAlindi && k.teslimAlindi < k.kiraBaslangic) h.push('Teslim alma tarihi kira başlangıcından önce olamaz.');
  }
  return [...new Set(h)];
}

/** Tarih, teslim, ceza, not ve her arsa sahibinin kira yardımı. Onaylı sözleşmede gerekçe ister. */
export async function katKarsiligiAyrintilariKaydet(
  depo: Depo,
  servis: KayitServisi,
  projeId: string,
  a: KatKarsiligiAyrintilari,
  gerekce?: string,
): Promise<KatKarsiligiSozlesme> {
  const hatalar = ayrintiHatalari(a);
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  return depo.islem(async () => {
    const s = await sozlesmeGerekli(depo, servis.oturum.firmaId, projeId);
    const kira = new Map(a.kiralar.map((k) => [k.cariId, k]));
    return servis.guncelle(
      'katKarsiligiSozlesme',
      s.id,
      {
        sozlesmeTarihi: a.sozlesmeTarihi,
        teslimTarihi: a.teslimSuresiAy === null ? a.teslimTarihi : null,
        teslimSuresiAy: a.teslimSuresiAy,
        gecikmeCezasi: a.gecikmeCezasi,
        not: a.not.trim(),
        arsaSahipleri: s.arsaSahipleri.map((x) => {
          const k = kira.get(x.cariId);
          return k ? { ...x, kiraAylik: k.kiraAylik, kiraBaslangic: k.kiraBaslangic, teslimAlindi: k.teslimAlindi } : x;
        }),
      },
      gerekce,
    );
  });
}

/** İmzalanan sözleşme onaylanır; sonraki her değişiklik gerekçe ister. */
export async function katKarsiligiOnayla(depo: Depo, servis: KayitServisi, projeId: string): Promise<void> {
  const s = await sozlesmeGerekli(depo, servis.oturum.firmaId, projeId);
  await servis.onayla('katKarsiligiSozlesme', s.id);
}

// ─── Nakit ödeme planı ─────────────────────────────────────────────

export interface NakitOdemeGirdisi {
  cariId: string;
  vadeTarihi: Tarih | null;
  kosul: string;
  tutar: Kurus;
  aciklama: string;
}

export async function arsaSahibiOdemesiEkle(depo: Depo, servis: KayitServisi, projeId: string, g: NakitOdemeGirdisi): Promise<ArsaSahibiOdemesi> {
  const h: string[] = [];
  if (!Number.isInteger(g.tutar) || g.tutar <= 0) h.push("Tutar 0'dan büyük olmalı.");
  if (!g.vadeTarihi && !g.kosul.trim()) h.push('Vade tarihini seçin ya da koşulu yazın (örn. "Ruhsat alınınca").');
  if (!tarihMi(g.vadeTarihi)) h.push('Vade tarihini seçin.');
  if (h.length > 0) throw new IsKuraliHatasi(h.join(' '));
  return depo.islem(async () => {
    const s = await sozlesmeGerekli(depo, servis.oturum.firmaId, projeId);
    arsaSahibiDenetle(s, g.cariId);
    return servis.ekle('arsaSahibiOdemesi', {
      sozlesmeId: s.id,
      projeId,
      cariId: g.cariId,
      vadeTarihi: g.vadeTarihi,
      kosul: g.vadeTarihi ? '' : g.kosul.trim(),
      tutar: g.tutar,
      aciklama: g.aciklama.trim(),
    });
  });
}

// ─── İlave imalat ve alacak ────────────────────────────────────────

export interface IlaveImalatGirdisi {
  cariId: string;
  bolumId: string | null;
  tarih: Tarih;
  aciklama: string;
  tutar: Kurus;
  oder: IlaveImalat['oder'];
}

export async function ilaveImalatEkle(depo: Depo, servis: KayitServisi, projeId: string, g: IlaveImalatGirdisi): Promise<IlaveImalat> {
  const h: string[] = [];
  if (!g.aciklama.trim()) h.push('Yapılacak işi yazın.');
  if (!Number.isInteger(g.tutar) || g.tutar < 0) h.push('Tutarı yazın.');
  if (!TARIH.test(g.tarih)) h.push('Talep tarihini seçin.');
  if (h.length > 0) throw new IsKuraliHatasi(h.join(' '));
  return depo.islem(async () => {
    const s = await sozlesmeGerekli(depo, servis.oturum.firmaId, projeId);
    arsaSahibiDenetle(s, g.cariId);
    if (g.bolumId) {
      const b = await depo.getir('bagimsizBolum', g.bolumId);
      if (!b || b.projeId !== projeId || b.iptal) throw new IsKuraliHatasi('Daire bulunamadı.');
    }
    return servis.ekle('ilaveImalat', { sozlesmeId: s.id, projeId, ...g, aciklama: g.aciklama.trim(), durum: 'talep' });
  });
}

/** Arsa sahibinin ödeyeceği, onaylanmış ya da yapılmış imalat alacak doğurur. */
const alacakGerekir = (i: Pick<IlaveImalat, 'oder' | 'durum'>) => i.oder === 'arsa_sahibi' && (i.durum === 'onaylandi' || i.durum === 'yapildi');

/**
 * Durumu değiştirir ve alacağı buna göre açar ya da iptal eder. Tahsilatı yapılmış alacak kaldırılamaz
 * (önce tahsilat iptal edilir).
 */
export async function ilaveImalatDurumuDegistir(
  depo: Depo,
  servis: KayitServisi,
  imalatId: string,
  durum: IlaveImalatDurumu,
  gerekce?: string,
  bugun: Tarih = yerelGun(new Date()),
): Promise<IlaveImalat> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const i = await depo.getir('ilaveImalat', imalatId);
    if (!i || i.firmaId !== firmaId || i.iptal) throw new IsKuraliHatasi('İlave imalat bulunamadı.');
    const guncel = await servis.guncelle('ilaveImalat', imalatId, { durum }, gerekce);
    const alacaklar = aktif(await depo.listele('alacak', { kaynakId: imalatId, firmaId }));
    if (alacakGerekir(guncel) && alacaklar.length === 0 && guncel.tutar > 0) {
      await servis.ekle('alacak', {
        projeId: i.projeId,
        cariId: i.cariId,
        tarih: bugun,
        vadeTarihi: null,
        tutar: i.tutar,
        aciklama: `İlave imalat: ${i.aciklama}`,
        kaynakTur: 'ilaveImalat',
        kaynakId: i.id,
      });
    } else if (!alacakGerekir(guncel)) {
      const eslestirmeler = await depo.listele('eslestirme', { firmaId });
      for (const a of alacaklar) {
        if (kalanTutar('alacak', a, a.tutar, eslestirmeler) < a.tutar) {
          throw new IsKuraliHatasi('Bu ilave imalatın tahsilatı yapılmış; önce tahsilatı iptal edin.');
        }
        await servis.iptal('alacak', a.id, gerekce);
      }
    }
    return guncel;
  });
}

// ─── Özet ──────────────────────────────────────────────────────────

export interface IlaveImalatSatiri {
  imalat: IlaveImalat;
  /** Bağlı gider satırlarının toplamı. */
  maliyet: Kurus;
  /** Arsa sahibinden alınacak (alacak) ve tahsil edilen. */
  alinacak: Kurus;
  tahsilEdilen: Kurus;
}

export interface KatKarsiligiOzeti {
  sozlesme: KatKarsiligiSozlesme;
  ruhsatTarihi: Tarih | null;
  teslim: Tarih | null;
  yukumlulukler: ArsaSahibiYukumlulugu[];
  plan: ArsaSahibiOdemesi[];
  ilaveImalatlar: IlaveImalatSatiri[];
  toplamCeza: Kurus;
}

/** Ruhsat takip başlığı tamamlandıysa bitiş tarihi. */
async function ruhsatTarihi(depo: Depo, firmaId: string, projeId: string): Promise<Tarih | null> {
  const r = aktif(await depo.listele('takipBasligi', { projeId, firmaId })).find((t) => t.ad === 'Ruhsat');
  return r?.durum === 'tamamlandi' ? r.bitisTarihi : null;
}

export async function katKarsiligiOzeti(depo: Depo, firmaId: string, projeId: string, bugun: Tarih): Promise<KatKarsiligiOzeti | null> {
  const sozlesme = await katKarsiligiGetir(depo, firmaId, projeId);
  if (!sozlesme) return null;
  const [ruhsat, plan, imalatlar, tahsisler, giderler, eslestirmeler] = await Promise.all([
    ruhsatTarihi(depo, firmaId, projeId),
    depo.listele('arsaSahibiOdemesi', { sozlesmeId: sozlesme.id, firmaId }),
    depo.listele('ilaveImalat', { sozlesmeId: sozlesme.id, firmaId }),
    depo.listele('arsaSahibiTahsisi', { sozlesmeId: sozlesme.id, firmaId }),
    depo.listele('gider', { projeId, firmaId }),
    depo.listele('eslestirme', { firmaId }),
  ]);
  const sahipler = new Set(sozlesme.arsaSahipleri.map((s) => s.cariId));
  const odenen = new Map<string, Kurus>();
  for (const g of aktif(giderler)) {
    if (g.cariId && sahipler.has(g.cariId)) odenen.set(g.cariId, (odenen.get(g.cariId) ?? 0) + g.toplam);
  }
  const daireSayisi = new Map<string, number>();
  for (const t of aktif(tahsisler)) daireSayisi.set(t.cariId, (daireSayisi.get(t.cariId) ?? 0) + 1);
  const teslim = teslimTarihiHesapla(sozlesme, ruhsat);
  const aktifPlan = aktif(plan);
  const yukumlulukler = arsaSahibiYukumlulukleri({ sozlesme, plan: aktifPlan, odenen, daireSayisi, teslim, bugun });

  const ilaveImalatlar: IlaveImalatSatiri[] = [];
  for (const imalat of aktif(imalatlar)) {
    const satirlar = aktif(await depo.listele('giderSatiri', { ilaveImalatId: imalat.id, firmaId }));
    let maliyet = 0;
    for (const s of satirlar) {
      const g = await depo.getir('gider', s.giderId);
      if (g && !g.iptal) maliyet += s.toplam;
    }
    const alacaklar = aktif(await depo.listele('alacak', { kaynakId: imalat.id, firmaId }));
    const alinacak = alacaklar.reduce((t, a) => t + a.tutar, 0);
    const kalan = alacaklar.reduce((t, a) => t + kalanTutar('alacak', a, a.tutar, eslestirmeler), 0);
    ilaveImalatlar.push({ imalat, maliyet, alinacak, tahsilEdilen: alinacak - kalan });
  }

  return {
    sozlesme,
    ruhsatTarihi: ruhsat,
    teslim,
    yukumlulukler,
    plan: aktifPlan.sort((a, b) => (a.vadeTarihi ?? '9999').localeCompare(b.vadeTarihi ?? '9999')),
    ilaveImalatlar: ilaveImalatlar.sort((a, b) => b.imalat.tarih.localeCompare(a.imalat.tarih)),
    toplamCeza: yukumlulukler.reduce((t, y) => t + y.cezaDogan, 0),
  };
}

/** Cari ekranındaki bilgi kutusu: carinin arsa sahibi olduğu bütün projelerde ödenen ve kalan (bakiyeye karışmaz). */
export async function cariKatKarsiligiOzeti(
  depo: Depo,
  firmaId: string,
  cariId: string,
  bugun: Tarih,
): Promise<{ odenen: Kurus; kalan: Kurus; cezaDogan: Kurus } | null> {
  const sozlesmeler = aktif(await depo.listele('katKarsiligiSozlesme', { firmaId })).filter((s) => s.arsaSahipleri.some((a) => a.cariId === cariId));
  if (sozlesmeler.length === 0) return null;
  const toplam = { odenen: 0, kalan: 0, cezaDogan: 0 };
  for (const s of sozlesmeler) {
    const o = await katKarsiligiOzeti(depo, firmaId, s.projeId, bugun);
    const y = o?.yukumlulukler.find((x) => x.cariId === cariId);
    if (!y) continue;
    toplam.odenen += y.odenen;
    toplam.kalan += y.kalan;
    toplam.cezaDogan += y.cezaDogan;
  }
  return toplam;
}

/** Gider satırının bağlanabileceği ilave imalatlar (talep ve reddedilen hariç). */
export async function baglanabilirIlaveImalatlar(depo: Depo, firmaId: string, projeId: string): Promise<IlaveImalat[]> {
  return aktif(await depo.listele('ilaveImalat', { projeId, firmaId })).filter((i) => i.durum === 'onaylandi' || i.durum === 'yapildi');
}
