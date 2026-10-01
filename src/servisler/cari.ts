import { cariBakiye } from '../hesap/bakiye';
import type { Depo } from '../veri/depo';
import type { AcilisBakiyesi, Cari, CariRol, Kurus, Proje, ProjeOrtagi, Tarih } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Cari: tek kart, çok rol (usta, tedarikçi, müşteri, arsa sahibi, ortak).
// Bakiye saklanmaz; hareketlerden hesaplanır. Açılış bakiyesi ayrı kayıttır.

export const CARI_ROL_ADI: Record<CariRol, string> = {
  usta: 'Usta',
  tedarikci: 'Tedarikçi',
  musteri: 'Müşteri',
  arsa_sahibi: 'Arsa sahibi',
  ortak: 'Ortak',
};

export const CARI_ROLLERI = Object.keys(CARI_ROL_ADI) as CariRol[];

export interface CariGirdisi {
  ad: string;
  roller: CariRol[];
  telefon: string | null;
  vergiNo: string | null;
  adres: string | null;
  not: string;
}

/**
 * Açılış bakiyesi, işaret bakiye hesabıyla aynı: artı = borcumuz, eksi = alacağımız.
 * Programa geçmeden önceki borç/alacak durumu.
 */
export interface AcilisGirdisi {
  tutar: Kurus;
  tarih: Tarih;
}

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const adAnahtari = (ad: string) => ad.trim().replace(/\s+/g, ' ').toLocaleLowerCase('tr-TR');

function temizle(g: CariGirdisi): CariGirdisi {
  const bosIseNull = (m: string | null) => (m?.trim() ? m.trim() : null);
  return {
    ad: g.ad.trim().replace(/\s+/g, ' '),
    // Roller sabit sırada ve tekrarsız saklanır.
    roller: CARI_ROLLERI.filter((r) => g.roller.includes(r)),
    telefon: bosIseNull(g.telefon),
    vergiNo: g.vergiNo?.replace(/\s/g, '') || null,
    adres: bosIseNull(g.adres),
    not: g.not.trim(),
  };
}

/**
 * Aynı adda başka cari var: engel değil, uyarıdır. Aynı adlı iki farklı kişi olabilir;
 * kullanıcı mevcut kart(lar)ı görüp onaylarsa kayıt yapılır (`ayniAdOnayli`).
 */
export class AyniAdliCariUyarisi extends IsKuraliHatasi {
  constructor(readonly mevcutlar: Pick<Cari, 'id' | 'ad' | 'telefon' | 'roller'>[]) {
    super(`"${mevcutlar[0]!.ad}" adlı bir cari zaten var. Aynı kişiyse o kartı düzenleyin; farklı kişiyse onaylayarak açın.`);
    this.name = 'AyniAdliCariUyarisi';
  }
}

export interface CariKayitSecenegi {
  /** Kullanıcı aynı adlı kart olduğunu gördü ve yine de kaydetmek istedi. */
  ayniAdOnayli?: boolean;
}

async function ayniAdlilar(depo: Depo, firmaId: string, ad: string, haricId?: string): Promise<Cari[]> {
  if (!ad) return [];
  return aktif(await depo.listele('cari', { firmaId })).filter(
    (c) => c.id !== haricId && adAnahtari(c.ad) === adAnahtari(ad),
  );
}

async function ayniAdKontrol(depo: Depo, firmaId: string, g: CariGirdisi, secenek: CariKayitSecenegi, haricId?: string) {
  if (secenek.ayniAdOnayli) return;
  const mevcutlar = await ayniAdlilar(depo, firmaId, g.ad, haricId);
  if (mevcutlar.length > 0) {
    throw new AyniAdliCariUyarisi(mevcutlar.map(({ id, ad, telefon, roller }) => ({ id, ad, telefon, roller })));
  }
}

function cariHatalari(g: CariGirdisi): string[] {
  const hatalar: string[] = [];
  if (!g.ad) hatalar.push('Cari adı boş olamaz.');
  if (g.roller.length === 0) hatalar.push('En az bir rol seçin (usta, tedarikçi, müşteri…).');
  if (g.vergiNo && !/^\d{10,11}$/.test(g.vergiNo)) {
    hatalar.push('Vergi no 10 haneli, TC kimlik no 11 haneli olmalı.');
  }
  if (g.telefon && g.telefon.replace(/\D/g, '').length < 10) hatalar.push('Telefon numarası eksik görünüyor.');
  return hatalar;
}

function acilisHatalari(a: AcilisGirdisi | null): string[] {
  if (!a) return [];
  const hatalar: string[] = [];
  if (!Number.isInteger(a.tutar)) hatalar.push('Açılış bakiyesi geçerli bir tutar olmalı.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.tarih)) hatalar.push('Açılış bakiyesinin tarihini girin.');
  return hatalar;
}

/** Cari ve (varsa) açılış bakiyesi tek işlemde oluşturulur. */
export async function cariOlustur(
  depo: Depo,
  servis: KayitServisi,
  girdi: CariGirdisi,
  acilis: AcilisGirdisi | null = null,
  secenek: CariKayitSecenegi = {},
): Promise<Cari> {
  const g = temizle(girdi);
  return depo.islem(async () => {
    const hatalar = [...cariHatalari(g), ...acilisHatalari(acilis)];
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    await ayniAdKontrol(depo, servis.oturum.firmaId, g, secenek);
    const cari = await servis.ekle('cari', g);
    if (acilis && acilis.tutar !== 0) {
      await servis.ekle('acilisBakiyesi', { hedefTur: 'cari', hedefId: cari.id, tarih: acilis.tarih, tutar: acilis.tutar });
    }
    return cari;
  });
}

export async function cariGuncelle(
  depo: Depo,
  servis: KayitServisi,
  cariId: string,
  girdi: CariGirdisi,
  gerekce?: string,
  secenek: CariKayitSecenegi = {},
): Promise<Cari> {
  const g = temizle(girdi);
  return depo.islem(async () => {
    const hatalar = cariHatalari(g);
    const eski = await depo.getir('cari', cariId);
    // Proje ortağı olan carinin ortak rolü kaldırılamaz.
    if (eski?.roller.includes('ortak') && !g.roller.includes('ortak')) {
      const ortakliklar = aktif(await depo.listele('projeOrtagi', { cariId, firmaId: servis.oturum.firmaId }));
      if (ortakliklar.length > 0) hatalar.push('Bu cari bir projede ortak; önce projedeki ortaklığını kaldırın.');
    }
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    // Adı değişmiyorsa (eski aynı adlı kartlar zaten onaylanmıştı) tekrar sorulmaz.
    if (!eski || adAnahtari(eski.ad) !== adAnahtari(g.ad)) {
      await ayniAdKontrol(depo, servis.oturum.firmaId, g, secenek, cariId);
    }
    return servis.guncelle('cari', cariId, g, gerekce);
  });
}

/** Carinin geçerli açılış bakiyesi kaydı (en fazla bir tane olur). */
export async function acilisBakiyesiGetir(depo: Depo, firmaId: string, cariId: string): Promise<AcilisBakiyesi | null> {
  const liste = aktif(await depo.listele('acilisBakiyesi', { hedefId: cariId, firmaId }));
  return liste.find((a) => a.hedefTur === 'cari') ?? null;
}

/**
 * Açılış bakiyesini girer, değiştirir ya da (null / 0 ile) iptal eder.
 * Değişiklik ve iptal işlem geçmişine yazılır; gerekçe kuralı geçerlidir.
 */
export async function acilisBakiyesiAyarla(
  depo: Depo,
  servis: KayitServisi,
  cariId: string,
  acilis: AcilisGirdisi | null,
  gerekce?: string,
): Promise<void> {
  const hatalar = acilisHatalari(acilis);
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  await depo.islem(async () => {
    const mevcut = await acilisBakiyesiGetir(depo, servis.oturum.firmaId, cariId);
    const sifir = !acilis || acilis.tutar === 0;
    if (mevcut && sifir) await servis.iptal('acilisBakiyesi', mevcut.id, gerekce);
    else if (mevcut && acilis) await servis.guncelle('acilisBakiyesi', mevcut.id, { tutar: acilis.tutar, tarih: acilis.tarih }, gerekce);
    else if (acilis && !sifir) {
      await servis.ekle('acilisBakiyesi', { hedefTur: 'cari', hedefId: cariId, tarih: acilis.tarih, tutar: acilis.tutar });
    }
  });
}

/** Cariye bağlı, iptal edilmemiş hareketlerin sayısı (açılış bakiyesi hariç). */
async function bagliHareketSayisi(depo: Depo, firmaId: string, cariId: string): Promise<number> {
  const k = { cariId, firmaId };
  const listeler = await Promise.all([
    depo.listele('gider', k),
    depo.listele('odeme', k),
    depo.listele('hakedis', k),
    depo.listele('cekSenet', k),
    depo.listele('cekHareketi', k),
    depo.listele('projeOrtagi', k),
    depo.listele('ustaSozlesmesi', k),
    depo.listele('satis', k),
    depo.listele('taksit', k),
    depo.listele('arsaSahibiTahsisi', k),
  ]);
  return listeler.reduce((t, l) => t + aktif(l as { iptal: unknown }[]).length, 0);
}

/** Hareketi olmayan cari iptal edilebilir; açılış bakiyesi de onunla iptal olur. */
export async function cariIptal(depo: Depo, servis: KayitServisi, cariId: string, gerekce?: string): Promise<void> {
  await depo.islem(async () => {
    if ((await bagliHareketSayisi(depo, servis.oturum.firmaId, cariId)) > 0) {
      throw new IsKuraliHatasi('Bu carinin kayıtlı hareketleri (alış, ödeme, ortaklık…) var; iptal edilemez.');
    }
    await servis.iptal('cari', cariId, gerekce);
  });
}

// ─── Okuma ─────────────────────────────────────────────────────────

export interface CariOzeti {
  cari: Cari;
  /** Artı = borcumuz, eksi = alacağımız. */
  bakiye: Kurus;
}

/** Bütün cariler bakiyeleriyle, ada göre sıralı. Hareketler bir kez okunur. */
export async function carileriListele(depo: Depo, firmaId: string): Promise<CariOzeti[]> {
  const k = { firmaId };
  const [cariler, acilislar, giderler, hakedisler, odemeler, cekler, cekHareketleri] = await Promise.all([
    depo.listele('cari', k),
    depo.listele('acilisBakiyesi', k),
    depo.listele('gider', k),
    depo.listele('hakedis', k),
    depo.listele('odeme', k),
    depo.listele('cekSenet', k),
    depo.listele('cekHareketi', k),
  ]);
  const hareketler = { acilislar, giderler, hakedisler, odemeler, cekler, cekHareketleri };
  return aktif(cariler)
    .sort((a, b) => a.ad.localeCompare(b.ad, 'tr'))
    .map((cari) => ({ cari, bakiye: cariBakiye(cari.id, hareketler) }));
}

export async function cariGetir(depo: Depo, firmaId: string, cariId: string): Promise<Cari | null> {
  const cari = await depo.getir('cari', cariId);
  return cari && cari.firmaId === firmaId && !cari.iptal ? cari : null;
}

/** Carinin ortak olduğu projeler. */
export async function cariOrtakliklari(
  depo: Depo,
  firmaId: string,
  cariId: string,
): Promise<{ ortaklik: ProjeOrtagi; proje: Proje }[]> {
  const sonuc: { ortaklik: ProjeOrtagi; proje: Proje }[] = [];
  for (const ortaklik of aktif(await depo.listele('projeOrtagi', { cariId, firmaId }))) {
    const proje = await depo.getir('proje', ortaklik.projeId);
    if (proje && !proje.iptal) sonuc.push({ ortaklik, proje });
  }
  return sonuc;
}

// ─── Proje ortakları ───────────────────────────────────────────────

export interface OrtakSatiri {
  ortaklik: ProjeOrtagi;
  cari: Cari;
}

export async function projeOrtaklari(depo: Depo, firmaId: string, projeId: string): Promise<OrtakSatiri[]> {
  const sonuc: OrtakSatiri[] = [];
  for (const ortaklik of aktif(await depo.listele('projeOrtagi', { projeId, firmaId }))) {
    const cari = await depo.getir('cari', ortaklik.cariId);
    if (cari) sonuc.push({ ortaklik, cari });
  }
  return sonuc.sort((a, b) => b.ortaklik.oran - a.ortaklik.oran || a.cari.ad.localeCompare(b.cari.ad, 'tr'));
}

/** Ortak oranları toplamı %100'ü geçemez; kalan pay müteahhit firmanındır. */
async function oranKontrol(depo: Depo, firmaId: string, projeId: string, oran: number, haricId?: string) {
  if (!Number.isFinite(oran) || oran <= 0 || oran > 100) {
    throw new IsKuraliHatasi('Ortaklık oranı 0\'dan büyük, en çok 100 olmalı.');
  }
  const digerleri = aktif(await depo.listele('projeOrtagi', { projeId, firmaId })).filter((o) => o.id !== haricId);
  const toplam = digerleri.reduce((t, o) => t + o.oran, 0) + oran;
  // Ondalıklı oranlarda kayan nokta hatasına pay bırakılır.
  if (toplam > 100 + 1e-9) {
    throw new IsKuraliHatasi(`Ortak oranları toplamı %${(toplam).toLocaleString('tr-TR')} olur; en çok %100 olabilir.`);
  }
  return digerleri;
}

export async function ortakEkle(
  depo: Depo,
  servis: KayitServisi,
  projeId: string,
  cariId: string,
  oran: number,
): Promise<ProjeOrtagi> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const cari = await cariGetir(depo, firmaId, cariId);
    if (!cari) throw new IsKuraliHatasi('Cari bulunamadı.');
    if (!cari.roller.includes('ortak')) throw new IsKuraliHatasi(`${cari.ad} kartında "ortak" rolü yok.`);
    const digerleri = await oranKontrol(depo, firmaId, projeId, oran);
    if (digerleri.some((o) => o.cariId === cariId)) {
      throw new IsKuraliHatasi(`${cari.ad} bu projede zaten ortak; oranını değiştirin.`);
    }
    return servis.ekle('projeOrtagi', { projeId, cariId, oran });
  });
}

export async function ortakOraniDegistir(
  depo: Depo,
  servis: KayitServisi,
  ortaklikId: string,
  oran: number,
  gerekce?: string,
): Promise<void> {
  await depo.islem(async () => {
    const ortaklik = await depo.getir('projeOrtagi', ortaklikId);
    if (!ortaklik || ortaklik.firmaId !== servis.oturum.firmaId) throw new IsKuraliHatasi('Ortaklık bulunamadı.');
    await oranKontrol(depo, ortaklik.firmaId, ortaklik.projeId, oran, ortaklikId);
    await servis.guncelle('projeOrtagi', ortaklikId, { oran }, gerekce);
  });
}
