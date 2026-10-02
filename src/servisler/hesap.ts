import { hesapEkstresi, type HesapHareketi, type HesapHareketleri } from '../hesap/bakiye';
import type { Depo } from '../veri/depo';
import type { AcilisBakiyesi, Hesap, Kurus, ParaBirimi, Tarih, Transfer } from '../veri/tipler';
import { acilisBakiyesiAyarla, acilisBakiyesiGetir, acilisEkle, acilisHatalari, type AcilisGirdisi } from './acilis';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Kasa ve banka hesapları, hesaplar arası transfer.
// Bakiye saklanmaz; açılış, ödeme/tahsilat, transfer ve çek hareketlerinden hesaplanır.
// Transfer gelir/gider değildir: toplam parayı değiştirmez.

export const PARA_BIRIMLERI: ParaBirimi[] = ['TRY', 'USD', 'EUR', 'GBP'];
export const PARA_SIMGESI: Record<ParaBirimi, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' };

export interface HesapGirdisi {
  ad: string;
  tur: Hesap['tur'];
  paraBirimi: ParaBirimi;
  banka: string | null;
  iban: string | null;
}

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const adAnahtari = (ad: string) => ad.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');

/** Boşluklar atılır, harfler büyütülür: "tr12 0006 …" → "TR120006…". */
export const ibanTemizle = (iban: string) => iban.replace(/\s/g, '').toUpperCase();

/** TR IBAN: TR + 24 hane, mod-97 denetimi tutmalı. Yazım hatalarını yakalar. */
export function ibanGecerli(iban: string): boolean {
  const i = ibanTemizle(iban);
  if (!/^TR\d{24}$/.test(i)) return false;
  const sayisal = (i.slice(4) + i.slice(0, 4)).replace(/[A-Z]/g, (h) => String(h.charCodeAt(0) - 55));
  let kalan = 0;
  for (const rakam of sayisal) kalan = (kalan * 10 + Number(rakam)) % 97;
  return kalan === 1;
}

function temizle(g: HesapGirdisi): HesapGirdisi {
  return {
    ad: g.ad.trim().replace(/\s+/g, ' '),
    tur: g.tur,
    paraBirimi: g.paraBirimi,
    banka: g.tur !== 'kasa' ? g.banka?.trim() || null : null,
    iban: g.tur === 'banka' && g.iban?.trim() ? ibanTemizle(g.iban) : null,
  };
}

async function hesapHatalari(depo: Depo, firmaId: string, g: HesapGirdisi, haricId?: string): Promise<string[]> {
  const hatalar: string[] = [];
  if (!g.ad) hatalar.push('Hesap adı boş olamaz.');
  if (!PARA_BIRIMLERI.includes(g.paraBirimi)) hatalar.push('Para birimi geçersiz.');
  if (g.iban && !ibanGecerli(g.iban)) hatalar.push('IBAN hatalı görünüyor: TR ile başlayan 26 karakter olmalı, rakamları kontrol edin.');
  // Transfer ekranında hesaplar adla seçilir; aynı ad karışıklık yaratır.
  if (g.ad && aktif(await depo.listele('hesap', { firmaId })).some((h) => h.id !== haricId && adAnahtari(h.ad) === adAnahtari(g.ad))) {
    hatalar.push(`"${g.ad}" adlı bir hesap zaten var; ayırt edici bir ad verin (örn. "Ziraat TL", "Ziraat USD").`);
  }
  return hatalar;
}

/** Hesap ve (varsa) açılış bakiyesi tek işlemde. Açılış tutarı hesabın para birimindedir. */
export async function hesapOlustur(
  depo: Depo,
  servis: KayitServisi,
  girdi: HesapGirdisi,
  acilis: AcilisGirdisi | null = null,
): Promise<Hesap> {
  const g = temizle(girdi);
  return depo.islem(async () => {
    const hatalar = [...(await hesapHatalari(depo, servis.oturum.firmaId, g)), ...acilisHatalari(acilis)];
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    const hesap = await servis.ekle('hesap', g);
    await acilisEkle(servis, 'hesap', hesap.id, acilis);
    return hesap;
  });
}

/** Hareketi olan hesabın para birimi değiştirilemez; eski tutarlar başka birimde okunurdu. */
export async function hesapGuncelle(
  depo: Depo,
  servis: KayitServisi,
  hesapId: string,
  girdi: HesapGirdisi,
  gerekce?: string,
): Promise<Hesap> {
  const g = temizle(girdi);
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const hatalar = await hesapHatalari(depo, firmaId, g, hesapId);
    const eski = await hesapGetir(depo, firmaId, hesapId);
    if (!eski) throw new IsKuraliHatasi('Hesap bulunamadı.');
    if (eski.paraBirimi !== g.paraBirimi && (await hareketSayisi(depo, firmaId, hesapId, true)) > 0) {
      hatalar.push('Hareketi olan hesabın para birimi değiştirilemez. Yeni para birimi için ayrı hesap açın.');
    }
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    return servis.guncelle('hesap', hesapId, g, gerekce);
  });
}

/** Hesaba bağlı, iptal edilmemiş hareket sayısı; istenirse açılış bakiyesi de sayılır. */
async function hareketSayisi(depo: Depo, firmaId: string, hesapId: string, acilisDahil = false): Promise<number> {
  const listeler = await Promise.all([
    depo.listele('odeme', { hesapId, firmaId }),
    depo.listele('transfer', { kaynakHesapId: hesapId, firmaId }),
    depo.listele('transfer', { hedefHesapId: hesapId, firmaId }),
    depo.listele('cekHareketi', { hesapId, firmaId }),
    acilisDahil ? depo.listele('acilisBakiyesi', { hedefId: hesapId, firmaId }) : Promise.resolve([]),
  ]);
  return listeler.reduce((t, l) => t + aktif(l as { iptal: unknown }[]).length, 0);
}

/** Hareketi olmayan hesap iptal edilir; açılış bakiyesi onunla iptal olur. */
export async function hesapIptal(depo: Depo, servis: KayitServisi, hesapId: string, gerekce?: string): Promise<void> {
  await depo.islem(async () => {
    if ((await hareketSayisi(depo, servis.oturum.firmaId, hesapId)) > 0) {
      throw new IsKuraliHatasi('Bu hesabın hareketleri (ödeme, transfer, çek) var; iptal edilemez. Önce hareketleri iptal edin.');
    }
    await servis.iptal('hesap', hesapId, gerekce);
  });
}

export const hesapAcilisGetir = (depo: Depo, firmaId: string, hesapId: string): Promise<AcilisBakiyesi | null> =>
  acilisBakiyesiGetir(depo, firmaId, 'hesap', hesapId);

/** Artı = hesapta para var; banka hesabı eksiye düşmüşse (KMH) eksi girilir. */
export const hesapAcilisAyarla = (
  depo: Depo,
  servis: KayitServisi,
  hesapId: string,
  acilis: AcilisGirdisi | null,
  gerekce?: string,
): Promise<void> => acilisBakiyesiAyarla(depo, servis, 'hesap', hesapId, acilis, gerekce);

// ─── Transfer ──────────────────────────────────────────────────────

export interface TransferGirdisi {
  tarih: Tarih;
  kaynakHesapId: string;
  hedefHesapId: string;
  /** Kaynak hesabın para biriminde. */
  tutar: Kurus;
  /** Para birimleri farklıysa hedefe giren tutar (hedefin para biriminde); aynıysa null. */
  hedefTutar: Kurus | null;
  aciklama: string;
}

export async function transferYap(depo: Depo, servis: KayitServisi, girdi: TransferGirdisi): Promise<Transfer> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const hatalar: string[] = [];
    const kaynak = await hesapGetir(depo, firmaId, girdi.kaynakHesapId);
    const hedef = await hesapGetir(depo, firmaId, girdi.hedefHesapId);
    if (!kaynak) hatalar.push('Paranın çıkacağı hesabı seçin.');
    if (!hedef) hatalar.push('Paranın gireceği hesabı seçin.');
    if (kaynak && hedef && kaynak.id === hedef.id) hatalar.push('Kaynak ve hedef hesap aynı olamaz.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(girdi.tarih)) hatalar.push('Transfer tarihini girin.');
    if (!Number.isInteger(girdi.tutar) || girdi.tutar <= 0) hatalar.push('Transfer tutarı sıfırdan büyük olmalı.');

    const farkliBirim = !!kaynak && !!hedef && kaynak.paraBirimi !== hedef.paraBirimi;
    if (farkliBirim && (girdi.hedefTutar === null || !Number.isInteger(girdi.hedefTutar) || girdi.hedefTutar <= 0)) {
      hatalar.push(`Para birimleri farklı: ${hedef!.ad} hesabına giren ${hedef!.paraBirimi} tutarını girin.`);
    }
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));

    return servis.ekle('transfer', {
      tarih: girdi.tarih,
      kaynakHesapId: girdi.kaynakHesapId,
      hedefHesapId: girdi.hedefHesapId,
      tutar: girdi.tutar,
      hedefTutar: farkliBirim ? girdi.hedefTutar : null,
      aciklama: girdi.aciklama.trim(),
    });
  });
}

// ─── Okuma ─────────────────────────────────────────────────────────

export async function hesapGetir(depo: Depo, firmaId: string, hesapId: string): Promise<Hesap | null> {
  const hesap = await depo.getir('hesap', hesapId);
  return hesap && hesap.firmaId === firmaId && !hesap.iptal ? hesap : null;
}

export async function transferGetir(depo: Depo, firmaId: string, transferId: string): Promise<Transfer | null> {
  const t = await depo.getir('transfer', transferId);
  return t && t.firmaId === firmaId && !t.iptal ? t : null;
}

async function hareketleriOku(depo: Depo, firmaId: string): Promise<HesapHareketleri> {
  const k = { firmaId };
  const [acilislar, odemeler, transferler, cekler, cekHareketleri] = await Promise.all([
    depo.listele('acilisBakiyesi', k),
    depo.listele('odeme', k),
    depo.listele('transfer', k),
    depo.listele('cekSenet', k),
    depo.listele('cekHareketi', k),
  ]);
  return { acilislar, odemeler, transferler, cekler, cekHareketleri };
}

export interface HesapOzeti {
  hesap: Hesap;
  /** Hesabın kendi para biriminde. */
  bakiye: Kurus;
}

/** Hesaplar bakiyeleriyle: önce kasalar, sonra bankalar; her grupta ada göre. */
export async function hesaplariListele(depo: Depo, firmaId: string): Promise<HesapOzeti[]> {
  const [hesaplar, hareketler] = await Promise.all([depo.listele('hesap', { firmaId }), hareketleriOku(depo, firmaId)]);
  return aktif(hesaplar)
    .sort((a, b) => TUR_SIRASI[a.tur] - TUR_SIRASI[b.tur] || a.ad.localeCompare(b.ad, 'tr'))
    .map((hesap) => ({ hesap, bakiye: hesapEkstresi(hesap, hareketler).at(-1)?.bakiye ?? 0 }));
}

const TUR_SIRASI: Record<Hesap['tur'], number> = { kasa: 0, banka: 1, kredi_karti: 2 };

/**
 * Para birimine göre toplam; farklı birimler toplanmaz.
 * Varsayılan: eldeki para (kasa + banka). `kart`: kredi kartı borçları (eksi bakiye).
 */
export function birimToplamlari(ozetler: HesapOzeti[], kart = false): { paraBirimi: ParaBirimi; toplam: Kurus }[] {
  return PARA_BIRIMLERI.flatMap((pb) => {
    const ait = ozetler.filter((o) => o.hesap.paraBirimi === pb && (o.hesap.tur === 'kredi_karti') === kart);
    return ait.length ? [{ paraBirimi: pb, toplam: ait.reduce((t, o) => t + o.bakiye, 0) }] : [];
  });
}

export interface HesapDetayi {
  hesap: Hesap;
  /** En yeni hareket önce. */
  hareketler: HesapHareketi[];
  bakiye: Kurus;
  /** Transferlerde karşı hesap adları (iptal edilmiş hesaplar dahil). */
  hesapAdlari: Record<string, string>;
}

export async function hesapDetayiGetir(depo: Depo, firmaId: string, hesapId: string): Promise<HesapDetayi | null> {
  const hesap = await hesapGetir(depo, firmaId, hesapId);
  if (!hesap) return null;
  const [hareketler, hesaplar] = await Promise.all([hareketleriOku(depo, firmaId), depo.listele('hesap', { firmaId })]);
  const ekstre = hesapEkstresi(hesap, hareketler);
  return {
    hesap,
    hareketler: [...ekstre].reverse(),
    bakiye: ekstre.at(-1)?.bakiye ?? 0,
    hesapAdlari: Object.fromEntries(hesaplar.map((h) => [h.id, h.ad])),
  };
}
