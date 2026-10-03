import { giderBorcu, giderKalanBorc, iadeAcikTutar, tevkifatKalan } from '../hesap/bakiye';
import { giderToplamlari, satirHesapla, tevkifatGecerli, type SatirTutarlari } from '../hesap/gider';
import type { Depo } from '../veri/depo';
import type { Eslestirme, Gider, GiderSatiri, Hesap, Kalem, Kurus, Odeme, OdemeYontemi, Tarih, Tevkifat } from '../veri/tipler';
import { vergiDairesiHazirla } from './cari';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Alış/gider: maliyet ve (carisi varsa) borç bu kayıttan doğar. Ödeme ayrı kayıttır;
// hangi ödemenin hangi gideri kapattığı eşleştirmede durur. Kalan borç saklanmaz.
// İade faturası eksi giderdir: maliyetten ve cari borcundan düşer; alacağı mahsup ya da tahsilatla kapanır.

export interface SatirFormGirdisi {
  /** Düzenlemede var olan satırın kimliği; yeni satırda yok. */
  id?: string;
  kalemId: string | null;
  aciklama: string;
  miktar: number | null;
  birim: string | null;
  /** Kullanıcının yazdığı tutar; kdvDahil ise satır toplamı (KDV dahil). */
  tutar: Kurus;
  kdvDahil: boolean;
  kdvOrani: number;
  tevkifat: Tevkifat | null;
  /** İsteğe bağlı: bu satır bir ilave imalatın maliyeti. */
  ilaveImalatId?: string | null;
}

/** Gider girilirken hemen yapılan ödeme (peşin ya da kısmi). */
export interface PesinOdeme {
  hesapId: string;
  tutar: Kurus;
}

export interface GiderGirdisi {
  tarih: Tarih;
  projeId: string | null;
  cariId: string | null;
  faturaNo: string | null;
  vadeTarihi: Tarih | null;
  aciklama: string;
  /** Kullanıcı tutarları artı yazar; iadede eksiye çevrilerek saklanır. */
  satirlar: SatirFormGirdisi[];
  /** Yalnızca iadede: iade edilen asıl fatura. */
  iadeEdilenGiderId?: string | null;
}

export interface GiderKayitSecenegi {
  /** Aynı carinin aynı fatura numaralı başka gideri var; kullanıcı gördü ve onayladı. */
  mukerrerOnayli?: boolean;
}

/** Aynı cari + fatura no ile kayıtlı gider: engel değil, uyarı. */
export class MukerrerFaturaUyarisi extends IsKuraliHatasi {
  constructor(readonly mevcut: Pick<Gider, 'id' | 'tarih' | 'toplam' | 'faturaNo'>) {
    super(`${mevcut.faturaNo} numaralı fatura bu cariden zaten girilmiş. Aynı fatura iki kez maliyete yazılmasın.`);
    this.name = 'MukerrerFaturaUyarisi';
  }
}

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** Ödeme yöntemi hesabın türünden: kasa nakit, banka havale, kredi kartı kart. */
export const hesapYontemi = (h: Pick<Hesap, 'tur'>): OdemeYontemi =>
  h.tur === 'kasa' ? 'nakit' : h.tur === 'kredi_karti' ? 'kart' : 'havale';

interface HesaplanmisSatir extends SatirTutarlari {
  girdi: SatirFormGirdisi;
}

/** İadede bütün tutarlar eksi saklanır. */
function satirlariHesapla(satirlar: SatirFormGirdisi[], iade: boolean): HesaplanmisSatir[] {
  const isaret = iade ? -1 : 1;
  return satirlar.map((girdi) => {
    const t = satirHesapla(girdi);
    return {
      girdi,
      kdvHaricTutar: isaret * t.kdvHaricTutar,
      kdvTutari: isaret * t.kdvTutari,
      tevkifatTutari: isaret * t.tevkifatTutari,
      toplam: isaret * t.toplam,
      odenecek: isaret * t.odenecek,
    };
  });
}

/** Girdiyi denetler; sorun varsa hepsini birlikte bildirir. */
async function denetle(
  depo: Depo,
  firmaId: string,
  g: GiderGirdisi,
  iade = false,
): Promise<{ satirlar: HesaplanmisSatir[]; kalemler: Kalem[] }> {
  const hatalar: string[] = [];
  if (!TARIH.test(g.tarih)) hatalar.push('Gider tarihini girin.');
  if (g.vadeTarihi && (!TARIH.test(g.vadeTarihi) || g.vadeTarihi < g.tarih)) hatalar.push('Vade tarihi gider tarihinden önce olamaz.');
  if (g.satirlar.length === 0) hatalar.push('En az bir satır girin.');

  let kalemler: Kalem[] = [];
  if (g.projeId) {
    const proje = await depo.getir('proje', g.projeId);
    if (!proje || proje.firmaId !== firmaId || proje.iptal) hatalar.push('Proje bulunamadı.');
    kalemler = aktif(await depo.listele('kalem', { projeId: g.projeId, firmaId }));
  }
  if (g.cariId) {
    const cari = await depo.getir('cari', g.cariId);
    if (!cari || cari.firmaId !== firmaId || cari.iptal) hatalar.push('Cari bulunamadı.');
  }

  g.satirlar.forEach((s, i) => {
    const no = g.satirlar.length > 1 ? `${i + 1}. satır: ` : '';
    if (!Number.isInteger(s.tutar) || s.tutar <= 0) hatalar.push(`${no}tutar sıfırdan büyük olmalı.`);
    if (!Number.isFinite(s.kdvOrani) || s.kdvOrani < 0 || s.kdvOrani > 100) hatalar.push(`${no}KDV oranı geçersiz.`);
    if (!tevkifatGecerli(s.tevkifat)) hatalar.push(`${no}tevkifat oranı geçersiz.`);
    if (s.tevkifat && s.kdvOrani === 0) hatalar.push(`${no}KDV'siz satırda tevkifat olmaz.`);
    if (s.miktar !== null && (!Number.isFinite(s.miktar) || s.miktar <= 0)) hatalar.push(`${no}miktar sıfırdan büyük olmalı.`);
    if (s.kalemId) {
      const kalem = kalemler.find((k) => k.id === s.kalemId);
      if (!g.projeId) hatalar.push(`${no}kalem seçmek için önce proje seçin.`);
      else if (!kalem) hatalar.push(`${no}kalem bu projede yok.`);
      else if (kalemler.some((k) => k.ustKalemId === kalem.id)) {
        hatalar.push(`${no}"${kalem.ad}" ana kalem; altındaki kalemlerden birini seçin.`);
      }
    }
  });
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  return { satirlar: satirlariHesapla(g.satirlar, iade), kalemler };
}

async function mukerrerKontrol(depo: Depo, firmaId: string, g: GiderGirdisi, secenek: GiderKayitSecenegi, haricId?: string) {
  const faturaNo = g.faturaNo?.trim();
  if (secenek.mukerrerOnayli || !g.cariId || !faturaNo) return;
  const ayni = aktif(await depo.listele('gider', { cariId: g.cariId, firmaId })).find(
    (x) => x.id !== haricId && x.faturaNo?.trim().toLocaleUpperCase('tr-TR') === faturaNo.toLocaleUpperCase('tr-TR'),
  );
  if (ayni) throw new MukerrerFaturaUyarisi({ id: ayni.id, tarih: ayni.tarih, toplam: ayni.toplam, faturaNo: ayni.faturaNo });
}

const basliktan = (g: GiderGirdisi) => ({
  tarih: g.tarih,
  projeId: g.projeId,
  cariId: g.cariId,
  faturaNo: g.faturaNo?.trim() || null,
  vadeTarihi: g.vadeTarihi || null,
  aciklama: g.aciklama.trim(),
});

const satirKaydi = (giderId: string, s: HesaplanmisSatir) => ({
  giderId,
  kalemId: s.girdi.kalemId,
  aciklama: s.girdi.aciklama.trim(),
  miktar: s.girdi.miktar,
  birim: s.girdi.birim?.trim() || null,
  birimFiyat: s.girdi.miktar ? Math.round(s.kdvHaricTutar / s.girdi.miktar) : null,
  kdvHaricTutar: s.kdvHaricTutar,
  kdvOrani: s.girdi.kdvOrani,
  kdvTutari: s.kdvTutari,
  tevkifat: s.girdi.tevkifat,
  tevkifatTutari: s.tevkifatTutari,
  toplam: s.toplam,
  ilaveImalatId: s.girdi.ilaveImalatId ?? null,
});

/** Ödeme kaydı ve eşleştirmesi; hesap kontrolüyle. Çağıran işlem içinde olmalı. */
async function pesinOde(depo: Depo, servis: KayitServisi, gider: Gider, odeme: PesinOdeme): Promise<Odeme> {
  const hesap = await depo.getir('hesap', odeme.hesapId);
  if (!hesap || hesap.firmaId !== servis.oturum.firmaId || hesap.iptal) throw new IsKuraliHatasi('Ödemenin yapıldığı hesabı seçin.');
  if (hesap.paraBirimi !== 'TRY') throw new IsKuraliHatasi('Dövizli hesaptan ödeme henüz desteklenmiyor; TL hesabı seçin.');
  const o = await servis.ekle('odeme', {
    tarih: gider.tarih,
    yon: 'odeme',
    amac: 'cari',
    yontem: hesapYontemi(hesap),
    cariId: gider.cariId,
    hesapId: hesap.id,
    cekSenetId: null,
    projeId: gider.projeId,
    tutar: odeme.tutar,
    doviz: null,
    aciklama: gider.aciklama || (gider.faturaNo ? `Fatura ${gider.faturaNo}` : ''),
  });
  await servis.ekle('eslestirme', { kaynakTur: 'odeme', odemeId: o.id, hedefTur: 'gider', hedefId: gider.id, tutar: odeme.tutar });
  return o;
}

/** İadede geri alınan para: tahsilat kaydı ve iade alacağına eşleştirmesi. Çağıran işlem içinde olmalı. */
async function geriAl(depo: Depo, servis: KayitServisi, iade: Gider, para: PesinOdeme): Promise<Odeme> {
  const hesap = await depo.getir('hesap', para.hesapId);
  if (!hesap || hesap.firmaId !== servis.oturum.firmaId || hesap.iptal) throw new IsKuraliHatasi('Paranın girdiği hesabı seçin.');
  if (hesap.paraBirimi !== 'TRY') throw new IsKuraliHatasi('Dövizli hesap henüz desteklenmiyor; TL hesabı seçin.');
  if (hesap.tur === 'kredi_karti') throw new IsKuraliHatasi('Geri alınan para kasa ya da banka hesabına girer.');
  const o = await servis.ekle('odeme', {
    tarih: iade.tarih,
    yon: 'tahsilat',
    amac: 'cari',
    yontem: hesapYontemi(hesap),
    cariId: iade.cariId,
    hesapId: hesap.id,
    cekSenetId: null,
    projeId: iade.projeId,
    tutar: para.tutar,
    doviz: null,
    aciklama: `İade${iade.faturaNo ? ` ${iade.faturaNo}` : ''}`,
  });
  await servis.ekle('eslestirme', { kaynakTur: 'odeme', odemeId: o.id, hedefTur: 'iade', hedefId: iade.id, tutar: para.tutar });
  return o;
}

const oranAnahtari = (t: Tevkifat | null) => (t ? `${t.pay}/${t.payda}` : '');

/**
 * Bağlı iadede tevkifat oranı asıl faturadan gelir: faturanın tek oranı varsa bütün satırlara uygulanır
 * (tevkifatsız faturada iade de tevkifatsızdır); birden çok oranı varsa her satır onlardan biri olmalı.
 */
async function asilOranlariniUygula(depo: Depo, firmaId: string, g: GiderGirdisi): Promise<GiderGirdisi> {
  if (!g.iadeEdilenGiderId) return g;
  const satirlar = aktif(await depo.listele('giderSatiri', { giderId: g.iadeEdilenGiderId, firmaId }));
  const oranlar = new Map(satirlar.map((s) => [oranAnahtari(s.tevkifat), s.tevkifat]));
  if (oranlar.size === 0) return g;
  if (oranlar.size === 1) {
    const oran = [...oranlar.values()][0]!;
    return { ...g, satirlar: g.satirlar.map((s) => ({ ...s, tevkifat: s.kdvOrani === 0 ? null : oran })) };
  }
  if (g.satirlar.some((s) => !oranlar.has(oranAnahtari(s.tevkifat)))) {
    throw new IsKuraliHatasi(`İade edilen faturadaki tevkifat oranlarından birini seçin: ${[...oranlar.keys()].map((k) => k || 'yok').join(', ')}.`);
  }
  return g;
}

/**
 * İade bağlantısını denetler: asıl fatura bu carinin alışı olmalı ve ona bağlı iadelerin toplamı
 * faturayı aşamaz. Asıl faturayı döndürür.
 */
async function iadeBagiDenetle(depo: Depo, firmaId: string, g: GiderGirdisi, iadeToplami: Kurus, haricId?: string): Promise<Gider | null> {
  if (!g.iadeEdilenGiderId) return null;
  const asil = await depo.getir('gider', g.iadeEdilenGiderId);
  if (!asil || asil.firmaId !== firmaId || asil.iptal || asil.tur !== 'alis') throw new IsKuraliHatasi('İade edilen fatura bulunamadı.');
  if (asil.cariId !== g.cariId) throw new IsKuraliHatasi('İade edilen fatura başka bir carinin.');
  const oncekiler = aktif(await depo.listele('gider', { iadeEdilenGiderId: asil.id, firmaId })).filter((x) => x.id !== haricId);
  const kalan = asil.toplam + oncekiler.reduce((t, x) => t + x.toplam, 0);
  if (-iadeToplami > kalan) {
    throw new IsKuraliHatasi(`Bu faturadan en çok ${(kalan / 100).toLocaleString('tr-TR')} TL daha iade edilebilir.`);
  }
  return asil;
}

/**
 * İade faturası, satırları, (bağlıysa) asıl faturaya mahsubu ve (varsa) geri alınan para tek işlemde.
 * Cariden düşen tutar tevkifat sonrası tutardır; asıl faturanın kalan borcu kadar mahsup edilir,
 * artanı alacak kalır (sonra mahsup ya da tahsilat). İadenin tevkifatı vergi dairesi borcunu azaltır:
 * bağlıysa asıl faturanın ödenmemiş tevkifatından düşülür, artanı vergi dairesinden alacak görünür.
 * Bağlı iadede tevkifat oranı asıl faturadan gelir. Carisiz iadede para hemen geri alınmış olmalıdır.
 */
export async function iadeOlustur(
  depo: Depo,
  servis: KayitServisi,
  girdi: GiderGirdisi,
  geriAlinan: PesinOdeme | null = null,
  secenek: GiderKayitSecenegi = {},
): Promise<Gider> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    girdi = await asilOranlariniUygula(depo, firmaId, girdi);
    const { satirlar } = await denetle(depo, firmaId, girdi, true);
    const t = giderToplamlari(satirlar);
    const asil = await iadeBagiDenetle(depo, firmaId, girdi, t.toplam);
    const asilEslestirmeleri = asil ? await depo.listele('eslestirme', { hedefId: asil.id, firmaId }) : [];
    const asilKalan = asil ? giderKalanBorc(asil, asilEslestirmeleri) : 0;
    // Cari alacağı tevkifat sonrası tutardır (t.odenecek eksi).
    const mahsup = Math.max(0, Math.min(-t.odenecek, asilKalan));
    const serbest = -t.odenecek - mahsup;
    const tevkifatDusumu = asil ? Math.max(0, Math.min(-t.tevkifatToplam, tevkifatKalan(asil, asilEslestirmeleri))) : 0;

    const hatalar: string[] = [];
    if (geriAlinan && (!Number.isInteger(geriAlinan.tutar) || geriAlinan.tutar <= 0)) hatalar.push('Geri alınan tutar sıfırdan büyük olmalı.');
    if (geriAlinan && geriAlinan.tutar > serbest) {
      hatalar.push(`Faturanın kalan borcundan düşüldükten sonra en çok ${(serbest / 100).toLocaleString('tr-TR')} TL geri alınabilir.`);
    }
    if (!girdi.cariId && (!geriAlinan || geriAlinan.tutar !== serbest)) {
      hatalar.push('Carisi seçilmeyen iadede para hemen geri alınmış olmalı; alacak kalacaksa cariyi seçin.');
    }
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    await mukerrerKontrol(depo, firmaId, girdi, secenek);

    const iade = await servis.ekle('gider', {
      ...basliktan(girdi),
      tur: 'iade',
      iadeEdilenGiderId: asil?.id ?? null,
      kdvHaricToplam: t.kdvHaricToplam,
      kdvToplam: t.kdvToplam,
      toplam: t.toplam,
      tevkifatToplam: t.tevkifatToplam,
      paraBirimi: 'TRY',
      kur: null,
    });
    for (const s of satirlar) await servis.ekle('giderSatiri', satirKaydi(iade.id, s));
    if (asil && mahsup > 0) {
      await servis.ekle('eslestirme', { kaynakTur: 'iade', odemeId: iade.id, hedefTur: 'gider', hedefId: asil.id, tutar: mahsup });
    }
    if (asil && tevkifatDusumu > 0) {
      await servis.ekle('eslestirme', { kaynakTur: 'iade', odemeId: iade.id, hedefTur: 'tevkifat', hedefId: asil.id, tutar: tevkifatDusumu });
    }
    if (geriAlinan) await geriAl(depo, servis, iade, geriAlinan);
    if (t.tevkifatToplam !== 0) await vergiDairesiHazirla(depo, servis);
    return iade;
  });
}

/**
 * Gider, satırları ve (varsa) peşin ödemesi tek işlemde.
 * Carisiz gider peşin ödenmiş olmalıdır: kime borçlu olunduğu bilinmez.
 */
export async function giderOlustur(
  depo: Depo,
  servis: KayitServisi,
  girdi: GiderGirdisi,
  odeme: PesinOdeme | null = null,
  secenek: GiderKayitSecenegi = {},
): Promise<Gider> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const { satirlar } = await denetle(depo, firmaId, girdi);
    const t = giderToplamlari(satirlar);
    const hatalar: string[] = [];
    if (odeme && (!Number.isInteger(odeme.tutar) || odeme.tutar <= 0)) hatalar.push('Ödenen tutar sıfırdan büyük olmalı.');
    if (odeme && odeme.tutar > t.odenecek) hatalar.push('Ödenen tutar fatura tutarından büyük olamaz.');
    if (!girdi.cariId && (!odeme || odeme.tutar !== t.odenecek)) {
      hatalar.push('Carisi seçilmeyen gider tamamen peşin ödenmiş olmalı; veresiye alışta cariyi seçin.');
    }
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    await mukerrerKontrol(depo, firmaId, girdi, secenek);

    const gider = await servis.ekle('gider', {
      ...basliktan(girdi),
      tur: 'alis',
      iadeEdilenGiderId: null,
      kdvHaricToplam: t.kdvHaricToplam,
      kdvToplam: t.kdvToplam,
      toplam: t.toplam,
      tevkifatToplam: t.tevkifatToplam,
      paraBirimi: 'TRY',
      kur: null,
    });
    for (const s of satirlar) await servis.ekle('giderSatiri', satirKaydi(gider.id, s));
    if (odeme) await pesinOde(depo, servis, gider, odeme);
    // Tevkif edilen KDV vergi dairesi kartının ekstresinde borç olarak görünür.
    if (t.tevkifatToplam > 0) await vergiDairesiHazirla(depo, servis);
    return gider;
  });
}

/**
 * Başlığı ve satırları değiştirir: var olan satır güncellenir, yenisi eklenir, çıkarılan iptal edilir.
 * Ödenmiş tutarın altına inilemez; cari değişecekse önce ödemeler kaldırılmalı.
 */
export async function giderGuncelle(
  depo: Depo,
  servis: KayitServisi,
  giderId: string,
  girdi: GiderGirdisi,
  gerekce?: string,
  secenek: GiderKayitSecenegi = {},
): Promise<Gider> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const eski = await depo.getir('gider', giderId);
    if (!eski || eski.firmaId !== firmaId || eski.iptal) throw new IsKuraliHatasi('Gider bulunamadı.');
    const iade = eski.tur === 'iade';
    // İadede bağlantı sonradan değişmez; oran asıl faturadan gelir.
    if (iade) girdi = await asilOranlariniUygula(depo, firmaId, { ...girdi, iadeEdilenGiderId: eski.iadeEdilenGiderId });
    const { satirlar } = await denetle(depo, firmaId, girdi, iade);
    const t = giderToplamlari(satirlar);
    if (iade) {
      await iadeBagiDenetle(depo, firmaId, girdi, t.toplam, giderId);
      const tumEslestirmeler = await depo.listele('eslestirme', { firmaId });
      const kullanilan = -giderBorcu(eski) - iadeAcikTutar(eski, tumEslestirmeler);
      const tevkifatDusulen = tevkifatKalan(eski, tumEslestirmeler) - eski.tevkifatToplam;
      if (-t.tevkifatToplam < tevkifatDusulen) {
        throw new IsKuraliHatasi('Bu iadenin asıl faturanın tevkifatından düşülen kısmı yeni tevkifattan fazla.');
      }
      if (-t.odenecek < kullanilan) {
        throw new IsKuraliHatasi('Bu iadenin mahsup edilen ya da geri alınan kısmı yeni tutardan fazla. Önce o eşleştirmeleri azaltın.');
      }
      if (kullanilan > 0 && eski.cariId !== girdi.cariId) {
        throw new IsKuraliHatasi('Mahsup edilmiş iadenin carisi değiştirilemez. Önce eşleştirmeleri kaldırın.');
      }
      if (!girdi.cariId && kullanilan !== -t.odenecek) throw new IsKuraliHatasi('Carisi seçilmeyen iadenin parası tamamen geri alınmış olmalı.');
    } else {
      const iadeler = aktif(await depo.listele('gider', { iadeEdilenGiderId: giderId, firmaId }));
      const iadeToplami = -iadeler.reduce((s, x) => s + x.toplam, 0);
      if (t.toplam < iadeToplami) throw new IsKuraliHatasi(`Bu faturadan ${(iadeToplami / 100).toLocaleString('tr-TR')} TL iade girilmiş; toplam bunun altına inemez.`);
      if (iadeler.length > 0 && eski.cariId !== girdi.cariId) throw new IsKuraliHatasi('İadesi girilmiş faturanın carisi değiştirilemez.');
      const eslestirmeler = aktif(await depo.listele('eslestirme', { hedefId: giderId, firmaId }));
      const toplamla = (tur: string) => eslestirmeler.filter((e) => e.hedefTur === tur).reduce((s, e) => s + e.tutar, 0);
      const eslesen = toplamla('gider');
      if (t.odenecek < eslesen) {
        throw new IsKuraliHatasi('Bu gidere yapılan ödeme yeni tutardan fazla. Önce ödeme eşleştirmesini azaltın.');
      }
      if (t.tevkifatToplam < toplamla('tevkifat')) {
        throw new IsKuraliHatasi('Bu giderin tevkifatı için vergi dairesine yapılan ödeme yeni tevkifattan fazla. Önce o eşleştirmeyi azaltın.');
      }
      if (eslesen > 0 && eski.cariId !== girdi.cariId) {
        throw new IsKuraliHatasi('Ödemesi olan giderin carisi değiştirilemez. Önce ödeme eşleştirmesini kaldırın.');
      }
      if (!girdi.cariId && t.odenecek !== eslesen) {
        throw new IsKuraliHatasi('Carisi seçilmeyen gider tamamen ödenmiş olmalı.');
      }
    }
    await mukerrerKontrol(depo, firmaId, girdi, secenek, giderId);

    const guncel = await servis.guncelle(
      'gider',
      giderId,
      {
        ...basliktan(girdi),
        kdvHaricToplam: t.kdvHaricToplam,
        kdvToplam: t.kdvToplam,
        toplam: t.toplam,
        tevkifatToplam: t.tevkifatToplam,
      },
      gerekce,
    );

    const mevcutlar = aktif(await depo.listele('giderSatiri', { giderId, firmaId }));
    const kalanIdler = new Set(satirlar.map((s) => s.girdi.id).filter(Boolean));
    for (const m of mevcutlar) if (!kalanIdler.has(m.id)) await servis.iptal('giderSatiri', m.id, gerekce);
    for (const s of satirlar) {
      const m = mevcutlar.find((x) => x.id === s.girdi.id);
      if (m) await servis.guncelle('giderSatiri', m.id, satirKaydi(giderId, s), gerekce);
      else await servis.ekle('giderSatiri', satirKaydi(giderId, s));
    }
    if (t.tevkifatToplam !== 0) await vergiDairesiHazirla(depo, servis);
    return guncel;
  });
}

/**
 * Gider iptal edilir; satırları ve eşleştirmeleri de iptal olur (KayitServisi.BAGLI_KAYITLAR).
 * `odemeleriDeIptal`: yalnızca bu gidere bağlı ödemeler de iptal edilir (para hesaba döner);
 * aksi halde avans olarak açık kalırlar. Carisiz giderin ödemesi her zaman iptal edilir.
 * İadede aynı kural geri alınan para (tahsilat) için geçerlidir; mahsuplar iadeyle iptal olur.
 * Asıl fatura iptal edilirse ona yapılan iade mahsubu kalkar, iade alacağı açık kalır.
 * Vergi dairesine yapılan tevkifat ödemesi iptal edilmez; vergi dairesinde avans olarak kalır.
 */
export async function giderIptal(
  depo: Depo,
  servis: KayitServisi,
  giderId: string,
  gerekce?: string,
  odemeleriDeIptal = false,
): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const gider = await depo.getir('gider', giderId);
    if (!gider || gider.firmaId !== firmaId || gider.iptal) throw new IsKuraliHatasi('Gider bulunamadı.');
    // Gidere yapılan ödemeler ya da iadede geri alınan para; iade mahsupları kaynağıyla iptal olmaz.
    const odemeIdler = aktif(await depo.listele('eslestirme', { hedefId: giderId, firmaId }))
      .filter((e) => e.kaynakTur === 'odeme' && (e.hedefTur === 'gider' || e.hedefTur === 'iade'))
      .map((e) => e.odemeId);
    await servis.iptal('gider', giderId, gerekce);
    if (!odemeleriDeIptal && gider.cariId) return;
    for (const id of new Set(odemeIdler)) {
      // Başka gidere de bağlı ödeme iptal edilmez; yalnızca bu giderin payı serbest kalır.
      const digerleri = aktif(await depo.listele('eslestirme', { odemeId: id, firmaId }));
      const odeme = await depo.getir('odeme', id);
      if (digerleri.length === 0 && odeme && !odeme.iptal) {
        await servis.iptal('odeme', id, `Gider iptaliyle. ${gerekce ?? ''}`.trim());
      }
    }
  });
}

// ─── Okuma ─────────────────────────────────────────────────────────

export interface GiderOzeti {
  gider: Gider;
  cariAdi: string | null;
  projeAdi: string | null;
  /** Cariye borç (tevkifat düşülmüş); iadede eksi. */
  borc: Kurus;
  kalan: Kurus;
  /** İadede kapanmamış alacak; alışta 0. */
  iadeAcik: Kurus;
  /** Vadesi bugünden önce ve kalanı var. */
  vadesiGecti: boolean;
}

export interface GiderSuzgeci {
  projeId?: string;
  cariId?: string;
  yalnizcaOdenmemis?: boolean;
}

/** En yeni gider önce. */
export async function giderleriListele(depo: Depo, firmaId: string, suzgec: GiderSuzgeci = {}, bugun: Tarih): Promise<GiderOzeti[]> {
  const kosul = { firmaId, ...(suzgec.projeId ? { projeId: suzgec.projeId } : {}), ...(suzgec.cariId ? { cariId: suzgec.cariId } : {}) };
  const [giderler, eslestirmeler, cariler, projeler] = await Promise.all([
    depo.listele('gider', kosul),
    depo.listele('eslestirme', { firmaId }),
    depo.listele('cari', { firmaId }),
    depo.listele('proje', { firmaId }),
  ]);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const projeAdi = new Map(projeler.map((p) => [p.id, p.ad]));
  return aktif(giderler)
    .sort((a, b) => b.tarih.localeCompare(a.tarih) || b.olusturmaZamani.localeCompare(a.olusturmaZamani))
    .map((gider) => {
      const kalan = giderKalanBorc(gider, eslestirmeler);
      return {
        gider,
        cariAdi: gider.cariId ? (cariAdi.get(gider.cariId) ?? '?') : null,
        projeAdi: gider.projeId ? (projeAdi.get(gider.projeId) ?? '?') : null,
        borc: giderBorcu(gider),
        kalan,
        iadeAcik: iadeAcikTutar(gider, eslestirmeler),
        vadesiGecti: kalan > 0 && !!gider.vadeTarihi && gider.vadeTarihi < bugun,
      };
    })
    .filter((o) => !suzgec.yalnizcaOdenmemis || o.kalan > 0 || o.iadeAcik > 0);
}

export interface GiderDetayi extends GiderOzeti {
  satirlar: (GiderSatiri & { kalemAdi: string | null })[];
  /** Alışta cariye yapılan ödemeler; iadede geri alınan para (tahsilat). */
  odemeler: { eslestirme: Eslestirme; odeme: Odeme; hesapAdi: string | null }[];
  /** Alışta düşülen iadeler; iadede mahsup edildiği faturalar. `gider` karşı taraftır. */
  mahsuplar: { eslestirme: Eslestirme; gider: Gider }[];
  /** İadede asıl fatura. */
  iadeEdilen: Gider | null;
  /** Tevkif edilen KDV'nin vergi dairesine ödenmemiş kısmı. */
  tevkifatKalan: Kurus;
}

export async function giderDetayiGetir(depo: Depo, firmaId: string, giderId: string, bugun: Tarih): Promise<GiderDetayi | null> {
  const gider = await depo.getir('gider', giderId);
  if (!gider || gider.firmaId !== firmaId || gider.iptal) return null;
  const [satirlar, eslestirmeler, kaynakOlduklari, kalemler, cari, proje] = await Promise.all([
    depo.listele('giderSatiri', { giderId, firmaId }),
    depo.listele('eslestirme', { hedefId: giderId, firmaId }),
    depo.listele('eslestirme', { odemeId: giderId, firmaId }),
    gider.projeId ? depo.listele('kalem', { projeId: gider.projeId, firmaId }) : Promise.resolve([]),
    gider.cariId ? depo.getir('cari', gider.cariId) : Promise.resolve(undefined),
    gider.projeId ? depo.getir('proje', gider.projeId) : Promise.resolve(undefined),
  ]);
  const kalemAdi = (id: string | null) => {
    const k = kalemler.find((x) => x.id === id);
    if (!k) return null;
    const ust = kalemler.find((x) => x.id === k.ustKalemId);
    return ust ? `${ust.ad} › ${k.ad}` : k.ad;
  };
  const iade = gider.tur === 'iade';
  const mahsuplar = [];
  for (const e of aktif([...eslestirmeler, ...kaynakOlduklari])) {
    if (e.kaynakTur !== 'iade') continue;
    const karsi = await depo.getir('gider', e.odemeId === giderId ? e.hedefId : e.odemeId);
    if (karsi) mahsuplar.push({ eslestirme: e, gider: karsi });
  }
  const odemeler = [];
  for (const e of aktif(eslestirmeler)) {
    if (e.kaynakTur !== 'odeme' || e.hedefTur !== (iade ? 'iade' : 'gider')) continue;
    const odeme = await depo.getir('odeme', e.odemeId);
    if (!odeme || odeme.iptal) continue;
    const hesap = odeme.hesapId ? await depo.getir('hesap', odeme.hesapId) : undefined;
    odemeler.push({ eslestirme: e, odeme, hesapAdi: hesap?.ad ?? null });
  }
  const kalan = giderKalanBorc(gider, eslestirmeler);
  const iadeEdilen = gider.iadeEdilenGiderId ? ((await depo.getir('gider', gider.iadeEdilenGiderId)) ?? null) : null;
  return {
    gider,
    cariAdi: cari?.ad ?? null,
    projeAdi: proje?.ad ?? null,
    borc: giderBorcu(gider),
    kalan,
    vadesiGecti: kalan > 0 && !!gider.vadeTarihi && gider.vadeTarihi < bugun,
    satirlar: aktif(satirlar).map((s) => ({ ...s, kalemAdi: kalemAdi(s.kalemId) })),
    odemeler: odemeler.sort((a, b) => a.odeme.tarih.localeCompare(b.odeme.tarih)),
    tevkifatKalan: tevkifatKalan(gider, eslestirmeler),
    iadeAcik: iadeAcikTutar(gider, [...eslestirmeler, ...kaynakOlduklari]),
    mahsuplar: mahsuplar.sort((a, b) => a.gider.tarih.localeCompare(b.gider.tarih)),
    iadeEdilen,
  };
}

/**
 * Gider formunda cari önerileri. `son`: firmadaki giderlerde en son kullanılan cariler (en yeni önce, tekrarsız);
 * `kalemeGore`: projede her kalem için o kalemle en son girilen cari. Cari hiçbir zaman hazır seçili gelmez;
 * ekran bunları yalnızca düğme olarak sunar.
 */
export async function sonCariler(
  depo: Depo,
  firmaId: string,
  projeId: string | null,
  sinir = 3,
): Promise<{ son: string[]; kalemeGore: Map<string, string> }> {
  const giderler = aktif(await depo.listele('gider', { firmaId }))
    .filter((g) => g.cariId)
    .sort((a, b) => b.olusturmaZamani.localeCompare(a.olusturmaZamani));
  const son: string[] = [];
  for (const g of giderler) {
    if (!son.includes(g.cariId!)) son.push(g.cariId!);
    if (son.length >= sinir) break;
  }
  const kalemeGore = new Map<string, string>();
  if (projeId) {
    // En yeni gider önce gezildiği için kalemin ilk görülen carisi en sonuncusudur.
    for (const g of giderler.filter((x) => x.projeId === projeId)) {
      for (const s of aktif(await depo.listele('giderSatiri', { giderId: g.id, firmaId }))) {
        if (s.kalemId && !kalemeGore.has(s.kalemId)) kalemeGore.set(s.kalemId, g.cariId!);
      }
    }
  }
  return { son, kalemeGore };
}
