import { karsilikUyarilari, vadeOzeti, type KarsilikUyarisi, type VadeOzeti } from '../hesap/cek';
import type { Depo } from '../veri/depo';
import type { Cari, CekDurumu, CekHareketi, CekSenet, Hesap, Kurus, Odeme, Tarih } from '../veri/tipler';
import { hesaplariListele } from './hesap';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import { borcaDagit, type Dagitim } from './odeme';

// Çek ve senet. Para hareketi kendi kaydındadır:
// - Alınan çek: alındığında cariden çekle tahsilat (cari alacağı düşer, para hesaba girmez); bankaya tahsile
//   verilebilir (para henüz girmez); tahsil edilince hesaba girer (çek hareketi), ciro edilince ciro edilen
//   cariye ödemedir (faturalarına dağıtılır).
// - Verilen çek: verildiğinde cariye çekle ödeme (faturalarına dağıtılır); ödenince para hesaptan çıkar.
// - Karşılıksız ya da iade: ödeme/tahsilat kalır, cari ekstresi etkisini geri alır (hesap/bakiye.ts);
//   ödemenin fatura eşleştirmeleri kaldırılır, faturalar yeniden açık olur.
// Çek tutarı TL'dir; dövizli çek sonraki adımlarda.

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export const CEK_DURUM_ADI: Record<CekDurumu, string> = {
  portfoyde: 'Portföyde',
  tahsilde: 'Bankada tahsilde',
  ciro_edildi: 'Ciro edildi',
  tahsil_edildi: 'Tahsil edildi',
  verildi: 'Verildi',
  odendi: 'Ödendi',
  karsiliksiz: 'Karşılıksız',
  iade_edildi: 'İade edildi',
};

export const CEK_TUR_ADI: Record<CekSenet['tur'], string> = { cek: 'Çek', senet: 'Senet' };

/** Çekin bir daha hareket görmeyeceği durumlar. */
const KAPALI = new Set<CekDurumu>(['tahsil_edildi', 'odendi', 'karsiliksiz', 'iade_edildi']);
const GERI_DONEN = new Set<CekDurumu>(['karsiliksiz', 'iade_edildi']);

export interface CekGirdisi {
  tur: CekSenet['tur'];
  /** Alınanda çeki veren, verilende çeki alan cari. */
  cariId: string;
  /** Alındığı / verildiği gün. */
  tarih: Tarih;
  vadeTarihi: Tarih;
  tutar: Kurus;
  banka: string | null;
  sube: string | null;
  seriNo: string | null;
  /** Boşsa alınanda çeki veren cari, verilende firma sayılır. */
  kesideci: string | null;
  /** Yalnızca verilende: çekin yazıldığı banka hesabı (isteğe bağlı; vade uyarısı için). */
  hesapId?: string | null;
  projeId: string | null;
  aciklama: string;
}

const cekAdi = (c: Pick<CekSenet, 'tur' | 'seriNo'>) => `${CEK_TUR_ADI[c.tur]}${c.seriNo ? ` ${c.seriNo}` : ''}`;

async function cariGetir(depo: Depo, firmaId: string, cariId: string | null): Promise<Cari> {
  const cari = cariId ? await depo.getir('cari', cariId) : undefined;
  if (!cari || cari.firmaId !== firmaId || cari.iptal) throw new IsKuraliHatasi('Cariyi seçin.');
  return cari;
}

/** Çekin tahsil edildiği / ödendiği hesap: TL kasa ya da banka (`yalnizBanka`: banka hesabı). */
async function hesapGetir(depo: Depo, firmaId: string, hesapId: string | null | undefined, yalnizBanka = false): Promise<Hesap> {
  const hesap = hesapId ? await depo.getir('hesap', hesapId) : undefined;
  if (!hesap || hesap.firmaId !== firmaId || hesap.iptal) throw new IsKuraliHatasi(yalnizBanka ? 'Banka hesabını seçin.' : 'Kasa/banka hesabını seçin.');
  if (hesap.paraBirimi !== 'TRY') throw new IsKuraliHatasi('Dövizli hesap henüz desteklenmiyor; TL hesabı seçin.');
  if (hesap.tur === 'kredi_karti') throw new IsKuraliHatasi('Çek kasa ya da banka hesabına tahsil edilir / oradan ödenir.');
  if (yalnizBanka && hesap.tur !== 'banka') throw new IsKuraliHatasi('Banka hesabı seçin.');
  return hesap;
}

async function cekGetir(depo: Depo, firmaId: string, cekId: string): Promise<CekSenet> {
  const cek = await depo.getir('cekSenet', cekId);
  if (!cek || cek.firmaId !== firmaId || cek.iptal) throw new IsKuraliHatasi('Çek/senet bulunamadı.');
  return cek;
}

function girdiHatalari(g: CekGirdisi): string[] {
  const hatalar: string[] = [];
  if (!TARIH.test(g.tarih)) hatalar.push('Tarihi girin.');
  if (!TARIH.test(g.vadeTarihi)) hatalar.push('Vade tarihini girin.');
  else if (TARIH.test(g.tarih) && g.vadeTarihi < g.tarih) hatalar.push('Vade, alındığı/verildiği günden önce olamaz.');
  if (!Number.isInteger(g.tutar) || g.tutar <= 0) hatalar.push('Tutar sıfırdan büyük olmalı.');
  return hatalar;
}

/** Çek durumunu değiştirir ve hareketini yazar. Çağıran işlem içinde olmalı. */
async function hareketYaz(
  servis: KayitServisi,
  cek: CekSenet,
  durum: CekDurumu,
  ek: { tarih: Tarih; cariId?: string | null; hesapId?: string | null; aciklama?: string },
): Promise<CekHareketi> {
  const x = await servis.ekle('cekHareketi', {
    cekSenetId: cek.id,
    tarih: ek.tarih,
    durum,
    cariId: ek.cariId ?? null,
    hesapId: ek.hesapId ?? null,
    aciklama: ek.aciklama?.trim() ?? '',
  });
  await servis.guncelle('cekSenet', cek.id, { durum });
  return x;
}

async function cekOlustur(servis: KayitServisi, g: CekGirdisi, yon: CekSenet['yon']): Promise<CekSenet> {
  const bos = (m: string | null | undefined) => m?.trim() || null;
  return servis.ekle('cekSenet', {
    tur: g.tur,
    yon,
    cariId: g.cariId,
    vadeTarihi: g.vadeTarihi,
    tutar: g.tutar,
    doviz: null,
    banka: bos(g.banka),
    sube: bos(g.sube),
    seriNo: bos(g.seriNo),
    kesideci: bos(g.kesideci),
    hesapId: yon === 'verilen' ? (g.hesapId ?? null) : null,
    durum: yon === 'alinan' ? 'portfoyde' : 'verildi',
  });
}

/** Cariden çek/senet alınır: çekle tahsilat ve portföye giriş tek işlemde. */
export async function cekAl(depo: Depo, servis: KayitServisi, g: CekGirdisi): Promise<CekSenet> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const hatalar = girdiHatalari(g);
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    await cariGetir(depo, firmaId, g.cariId);
    const cek = await cekOlustur(servis, g, 'alinan');
    await servis.ekle('odeme', {
      tarih: g.tarih,
      yon: 'tahsilat',
      amac: 'cari',
      yontem: g.tur,
      cariId: g.cariId,
      hesapId: null,
      cekSenetId: cek.id,
      projeId: g.projeId,
      tutar: g.tutar,
      doviz: null,
      aciklama: g.aciklama.trim() || cekAdi(cek),
    });
    await servis.ekle('cekHareketi', { cekSenetId: cek.id, tarih: g.tarih, durum: 'portfoyde', cariId: g.cariId, hesapId: null, aciklama: '' });
    return cek;
  });
}

/** Cariye kendi çekimiz/senedimiz verilir: çekle ödeme, faturalara dağıtımı ve çek kaydı tek işlemde. */
export async function cekVer(depo: Depo, servis: KayitServisi, g: CekGirdisi, dagitim: Dagitim[] = []): Promise<CekSenet> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const hatalar = girdiHatalari(g);
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    await cariGetir(depo, firmaId, g.cariId);
    if (g.hesapId) await hesapGetir(depo, firmaId, g.hesapId, true);
    const cek = await cekOlustur(servis, g, 'verilen');
    const odeme = await servis.ekle('odeme', {
      tarih: g.tarih,
      yon: 'odeme',
      amac: 'cari',
      yontem: g.tur,
      cariId: g.cariId,
      hesapId: null,
      cekSenetId: cek.id,
      projeId: g.projeId,
      tutar: g.tutar,
      doviz: null,
      aciklama: g.aciklama.trim() || cekAdi(cek),
    });
    await borcaDagit(depo, servis, odeme, dagitim);
    await servis.ekle('cekHareketi', { cekSenetId: cek.id, tarih: g.tarih, durum: 'verildi', cariId: g.cariId, hesapId: null, aciklama: '' });
    return cek;
  });
}

function durumBekle(cek: CekSenet, yon: CekSenet['yon'], durumlar: CekDurumu[], islem: string) {
  if (cek.yon !== yon || !durumlar.includes(cek.durum)) {
    throw new IsKuraliHatasi(`${CEK_DURUM_ADI[cek.durum]} durumdaki ${cek.yon === 'alinan' ? 'alınan' : 'verilen'} ${CEK_TUR_ADI[cek.tur].toLocaleLowerCase('tr-TR')} ${islem}.`);
  }
}

function tarihDenetle(cek: CekSenet, tarih: Tarih, son: CekHareketi | undefined) {
  if (!TARIH.test(tarih)) throw new IsKuraliHatasi('Tarihi girin.');
  if (son && tarih < son.tarih) throw new IsKuraliHatasi(`Tarih, ${cekAdi(cek)} için son işlemden (${son.tarih}) önce olamaz.`);
}

async function sonHareket(depo: Depo, firmaId: string, cekId: string): Promise<CekHareketi | undefined> {
  return aktif(await depo.listele('cekHareketi', { cekSenetId: cekId, firmaId }))
    .sort((a, b) => a.tarih.localeCompare(b.tarih) || a.olusturmaZamani.localeCompare(b.olusturmaZamani))
    .at(-1);
}

/** Portföydeki alınan çek bankaya tahsile verildi: para henüz girmez, çek bankadadır. */
export async function cekTahsileVer(depo: Depo, servis: KayitServisi, cekId: string, g: { tarih: Tarih; hesapId: string }): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const cek = await cekGetir(depo, firmaId, cekId);
    durumBekle(cek, 'alinan', ['portfoyde'], 'tahsile verilemez');
    tarihDenetle(cek, g.tarih, await sonHareket(depo, firmaId, cekId));
    const hesap = await hesapGetir(depo, firmaId, g.hesapId, true);
    await hareketYaz(servis, cek, 'tahsilde', { tarih: g.tarih, hesapId: hesap.id, aciklama: cekAdi(cek) });
  });
}

/** Portföydeki ya da bankada tahsildeki alınan çek tahsil edildi: para hesaba girer. */
export async function cekTahsil(depo: Depo, servis: KayitServisi, cekId: string, g: { tarih: Tarih; hesapId: string }): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const cek = await cekGetir(depo, firmaId, cekId);
    durumBekle(cek, 'alinan', ['portfoyde', 'tahsilde'], 'tahsil edilemez');
    tarihDenetle(cek, g.tarih, await sonHareket(depo, firmaId, cekId));
    const hesap = await hesapGetir(depo, firmaId, g.hesapId);
    await hareketYaz(servis, cek, 'tahsil_edildi', { tarih: g.tarih, hesapId: hesap.id, aciklama: cekAdi(cek) });
  });
}

/** Verdiğimiz çek vadesinde ödendi: para hesaptan çıkar. */
export async function cekOde(depo: Depo, servis: KayitServisi, cekId: string, g: { tarih: Tarih; hesapId: string }): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const cek = await cekGetir(depo, firmaId, cekId);
    durumBekle(cek, 'verilen', ['verildi'], 'ödenemez');
    tarihDenetle(cek, g.tarih, await sonHareket(depo, firmaId, cekId));
    const hesap = await hesapGetir(depo, firmaId, g.hesapId);
    await hareketYaz(servis, cek, 'odendi', { tarih: g.tarih, hesapId: hesap.id, aciklama: cekAdi(cek) });
  });
}

/**
 * Portföydeki alınan çek bir cariye (tedarikçi, usta) ciro edilir: o cariye ödemedir;
 * faturalarına dağıtılabilir. Çeki veren cari ciro edilemez.
 */
export async function cekCiro(
  depo: Depo,
  servis: KayitServisi,
  cekId: string,
  g: { tarih: Tarih; cariId: string; dagitim: Dagitim[]; aciklama?: string },
): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const cek = await cekGetir(depo, firmaId, cekId);
    durumBekle(cek, 'alinan', ['portfoyde'], 'ciro edilemez');
    tarihDenetle(cek, g.tarih, await sonHareket(depo, firmaId, cekId));
    const cari = await cariGetir(depo, firmaId, g.cariId);
    if (cari.id === cek.cariId) throw new IsKuraliHatasi('Çek, aldığımız cariye ciro edilemez; geri verildiyse "İade edildi" seçin.');
    const odeme = await servis.ekle('odeme', {
      tarih: g.tarih,
      yon: 'odeme',
      amac: 'cari',
      yontem: 'ciro',
      cariId: cari.id,
      hesapId: null,
      cekSenetId: cek.id,
      projeId: null,
      tutar: cek.tutar,
      doviz: null,
      aciklama: g.aciklama?.trim() || `${cekAdi(cek)} ciro`,
    });
    await borcaDagit(depo, servis, odeme, g.dagitim);
    await hareketYaz(servis, cek, 'ciro_edildi', { tarih: g.tarih, cariId: cari.id, aciklama: g.aciklama });
  });
}

/** Çekin ödemelerinden (verilen çekle ödeme ya da ciro) fatura eşleştirmeleri. */
async function odemeEslestirmeleriniKaldir(depo: Depo, servis: KayitServisi, cek: CekSenet, gerekce: string) {
  const firmaId = servis.oturum.firmaId;
  for (const o of aktif(await depo.listele('odeme', { cekSenetId: cek.id, firmaId }))) {
    if (o.yon !== 'odeme') continue;
    for (const e of aktif(await depo.listele('eslestirme', { odemeId: o.id, firmaId }))) {
      await servis.iptal('eslestirme', e.id, gerekce);
    }
  }
}

/**
 * Çek geri döndü: karşılıksız çıktı ya da iade edildi. Alınanda portföydeyken ya da ciro edilmişken,
 * verilende verilmişken olur. Cari ekstresi çekle yapılan ödeme/tahsilatın etkisini geri alır;
 * çekle yapılan ödemenin fatura eşleştirmeleri kaldırılır (faturalar yeniden açılır).
 */
export async function cekGeriDondu(
  depo: Depo,
  servis: KayitServisi,
  cekId: string,
  g: { tarih: Tarih; durum: 'karsiliksiz' | 'iade_edildi'; aciklama?: string },
): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const cek = await cekGetir(depo, firmaId, cekId);
    if (!GERI_DONEN.has(g.durum)) throw new IsKuraliHatasi('Geri dönüş türünü seçin.');
    if (cek.yon === 'alinan') durumBekle(cek, 'alinan', ['portfoyde', 'tahsilde', 'ciro_edildi'], 'geri dönemez');
    else durumBekle(cek, 'verilen', ['verildi'], 'geri dönemez');
    tarihDenetle(cek, g.tarih, await sonHareket(depo, firmaId, cekId));
    await odemeEslestirmeleriniKaldir(depo, servis, cek, `${cekAdi(cek)} ${CEK_DURUM_ADI[g.durum].toLocaleLowerCase('tr-TR')}.`);
    await hareketYaz(servis, cek, g.durum, { tarih: g.tarih, aciklama: g.aciklama });
  });
}

/**
 * Son işlem geri alınır (tahsil, ödeme, ciro ya da geri dönüş); çek önceki durumuna döner.
 * Ciroda ciro ödemesi de iptal edilir. Geri dönüşte kaldırılan fatura eşleştirmeleri kendiliğinden
 * geri gelmez: ödeme açık (avans) kalır, ödeme ekranından yeniden bağlanır.
 */
export async function cekSonIslemiGeriAl(depo: Depo, servis: KayitServisi, cekId: string, gerekce?: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const cek = await cekGetir(depo, firmaId, cekId);
    const hareketler = aktif(await depo.listele('cekHareketi', { cekSenetId: cekId, firmaId })).sort(
      (a, b) => a.tarih.localeCompare(b.tarih) || a.olusturmaZamani.localeCompare(b.olusturmaZamani),
    );
    const son = hareketler.at(-1);
    const onceki = hareketler.at(-2);
    if (!son || !onceki) throw new IsKuraliHatasi('Geri alınacak işlem yok; yanlış girildiyse çeki iptal edin.');
    if (son.durum === 'ciro_edildi') {
      const ciro = aktif(await depo.listele('odeme', { cekSenetId: cekId, firmaId })).find((o) => o.yontem === 'ciro' && o.cariId === son.cariId);
      if (ciro) await servis.iptal('odeme', ciro.id, gerekce);
    }
    await servis.iptal('cekHareketi', son.id, gerekce);
    await servis.guncelle('cekSenet', cek.id, { durum: onceki.durum }, gerekce);
  });
}

/** İlk durumundaki (hiç işlem görmemiş) çek iptal edilir; çekle yapılan tahsilat/ödeme de iptal olur. */
export async function cekIptal(depo: Depo, servis: KayitServisi, cekId: string, gerekce?: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const cek = await cekGetir(depo, firmaId, cekId);
    if (cek.durum !== (cek.yon === 'alinan' ? 'portfoyde' : 'verildi')) {
      throw new IsKuraliHatasi('İşlem görmüş çek iptal edilmez; önce son işlemi geri alın.');
    }
    for (const o of aktif(await depo.listele('odeme', { cekSenetId: cekId, firmaId }))) await servis.iptal('odeme', o.id, gerekce);
    await servis.iptal('cekSenet', cekId, gerekce);
  });
}

// ─── Okuma ─────────────────────────────────────────────────────────

export interface CekOzeti {
  cek: CekSenet;
  cariAdi: string;
  /** Kayıttaki keşideci; boşsa alınanda cari, verilende firma. */
  kesideci: string;
  /** Vadeye kalan gün (geçtiyse eksi); kapalı çekte null. */
  vadeyeGun: number | null;
}

const gunFarki = (a: Tarih, b: Tarih) => Math.round((Date.parse(`${a}T00:00Z`) - Date.parse(`${b}T00:00Z`)) / 86_400_000);

/** Yaklaşan vade uyarısı: bu kadar gün ya da daha az kalan açık çek. */
export const YAKLASAN_VADE_GUNU = 7;

/** Bütün çek/senetler; açıklar önce ve en yakın vade önce, kapalılar en yeni vade önce. */
async function kesideciAdlari(depo: Depo, firmaId: string) {
  const [cariler, firma] = await Promise.all([depo.listele('cari', { firmaId }), depo.getir('firma', firmaId)]);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const kesideci = (cek: CekSenet) => cek.kesideci ?? (cek.yon === 'alinan' ? (cariAdi.get(cek.cariId) ?? '?') : (firma?.ad ?? ''));
  return { cariAdi, kesideci };
}

export async function cekleriListele(depo: Depo, firmaId: string, bugun: Tarih): Promise<CekOzeti[]> {
  const [cekler, { cariAdi, kesideci }] = await Promise.all([depo.listele('cekSenet', { firmaId }), kesideciAdlari(depo, firmaId)]);
  return aktif(cekler)
    .map((cek) => ({
      cek,
      cariAdi: cariAdi.get(cek.cariId) ?? '?',
      kesideci: kesideci(cek),
      vadeyeGun: KAPALI.has(cek.durum) ? null : gunFarki(cek.vadeTarihi, bugun),
    }))
    .sort((a, b) => {
      const acikA = a.vadeyeGun !== null;
      const acikB = b.vadeyeGun !== null;
      if (acikA !== acikB) return acikA ? -1 : 1;
      return acikA ? a.cek.vadeTarihi.localeCompare(b.cek.vadeTarihi) : b.cek.vadeTarihi.localeCompare(a.cek.vadeTarihi);
    });
}

export interface CekDetayi extends CekOzeti {
  /** Eskiden yeniye. */
  hareketler: (CekHareketi & { cariAdi: string | null; hesapAdi: string | null })[];
  /** Çekle yapılan tahsilat/ödeme ve ciro ödemeleri. */
  odemeler: (Odeme & { cariAdi: string | null })[];
  /** Son işlem geri alınabilir mi (ilk hareketten sonra işlem var). */
  geriAlinabilir: boolean;
  /** Verilende çekin yazıldığı hesap; alınan tahsildeyse tahsile verildiği hesap. */
  hesap: { id: string; ad: string } | null;
}

export async function cekDetayiGetir(depo: Depo, firmaId: string, cekId: string, bugun: Tarih): Promise<CekDetayi | null> {
  const cek = await depo.getir('cekSenet', cekId);
  if (!cek || cek.firmaId !== firmaId || cek.iptal) return null;
  const [hareketler, odemeler, { cariAdi, kesideci }, hesaplar] = await Promise.all([
    depo.listele('cekHareketi', { cekSenetId: cekId, firmaId }),
    depo.listele('odeme', { cekSenetId: cekId, firmaId }),
    kesideciAdlari(depo, firmaId),
    depo.listele('hesap', { firmaId }),
  ]);
  const hesapAdi = new Map(hesaplar.map((h) => [h.id, h.ad]));
  const sirali = aktif(hareketler).sort((a, b) => a.tarih.localeCompare(b.tarih) || a.olusturmaZamani.localeCompare(b.olusturmaZamani));
  const hesapId = cek.yon === 'verilen' ? cek.hesapId : cek.durum === 'tahsilde' ? (sirali.at(-1)?.hesapId ?? null) : null;
  return {
    cek,
    cariAdi: cariAdi.get(cek.cariId) ?? '?',
    kesideci: kesideci(cek),
    vadeyeGun: KAPALI.has(cek.durum) ? null : gunFarki(cek.vadeTarihi, bugun),
    hesap: hesapId ? { id: hesapId, ad: hesapAdi.get(hesapId) ?? '?' } : null,
    hareketler: sirali.map((x) => ({
      ...x,
      cariAdi: x.cariId ? (cariAdi.get(x.cariId) ?? null) : null,
      hesapAdi: x.hesapId ? (hesapAdi.get(x.hesapId) ?? null) : null,
    })),
    odemeler: aktif(odemeler)
      .sort((a, b) => a.tarih.localeCompare(b.tarih) || a.olusturmaZamani.localeCompare(b.olusturmaZamani))
      .map((o) => ({ ...o, cariAdi: o.cariId ? (cariAdi.get(o.cariId) ?? null) : null })),
    geriAlinabilir: sirali.length > 1,
  };
}

export interface CekPanosu {
  vade: VadeOzeti;
  /** Vadesi yaklaşan verilen çeklere bağlı banka hesabında bakiye yetmiyor. */
  uyarilar: (KarsilikUyarisi & { hesapAdi: string })[];
}

/** Aylık vade özeti ve karşılık uyarıları (vadesi 7 gün içindeki verilen çekler). */
export async function cekPanosu(depo: Depo, firmaId: string, bugun: Tarih): Promise<CekPanosu> {
  const [cekler, hesaplar] = await Promise.all([depo.listele('cekSenet', { firmaId }), hesaplariListele(depo, firmaId)]);
  const bakiyeler = new Map(hesaplar.map((h) => [h.hesap.id, h.bakiye]));
  const ad = new Map(hesaplar.map((h) => [h.hesap.id, h.hesap.ad]));
  return {
    vade: vadeOzeti(cekler, bugun),
    uyarilar: karsilikUyarilari(cekler, bakiyeler, bugun, YAKLASAN_VADE_GUNU).map((u) => ({ ...u, hesapAdi: ad.get(u.hesapId) ?? '?' })),
  };
}
