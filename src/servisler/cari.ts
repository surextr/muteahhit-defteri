import { cariBakiye } from '../hesap/bakiye';
import { addanBransOner, type BransAyirmaOnerisi } from '../hesap/brans';
import { aramaAnahtari } from '../hesap/metin';
import type { Depo } from '../veri/depo';
import { bosSabitId } from '../veri/kimlik';
import type { AcilisBakiyesi, Cari, CariRol, Kurus, Proje, ProjeOrtagi } from '../veri/tipler';
import {
  acilisBakiyesiAyarla as acilisAyarla,
  acilisBakiyesiGetir as acilisGetir,
  acilisEkle,
  acilisHatalari,
  type AcilisGirdisi,
} from './acilis';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

export type { AcilisGirdisi } from './acilis';

// Cari: tek kart, çok rol (usta, taşeron, tedarikçi, müşteri, arsa sahibi, ortak).
// Usta/taşeronun mesleği adda değil, branş listesinde (usta tipleri) tutulur: "Ahmet Demir" · Duvarcı.
// Bakiye saklanmaz; hareketlerden hesaplanır. Açılış bakiyesi ayrı kayıttır.

export const CARI_ROL_ADI: Record<CariRol, string> = {
  usta: 'Usta',
  taseron: 'Taşeron',
  tedarikci: 'Tedarikçi',
  musteri: 'Müşteri',
  arsa_sahibi: 'Arsa sahibi',
  ortak: 'Ortak',
  vergi_dairesi: 'Vergi dairesi',
};

/** Kullanıcının seçebildiği roller; 'vergi_dairesi' sistemin hazır kartındadır. */
export const CARI_ROLLERI: CariRol[] = (Object.keys(CARI_ROL_ADI) as CariRol[]).filter((r) => r !== 'vergi_dairesi');

/**
 * Kartta rol yoksa ekler (roller hazır sıradadır) ve güncel kartı döndürür. Bir yerde seçilen mevcut cari o işin
 * rolünü (arsa sahibi, ortak) kendiliğinden alır; kullanıcı kartı ayrıca düzenlemek zorunda kalmaz.
 */
export async function rolEkle(servis: KayitServisi, cari: Cari, rol: CariRol, aciklama: string): Promise<Cari> {
  if (cari.roller.includes(rol)) return cari;
  if (cari.roller.includes('vergi_dairesi')) throw new IsKuraliHatasi('Vergi dairesi kartı bu işte kullanılamaz.');
  const sira = Object.keys(CARI_ROL_ADI) as CariRol[];
  return servis.guncelle('cari', cari.id, { roller: sira.filter((r) => r === rol || cari.roller.includes(r)) }, aciklama);
}

/** Tevkif edilen KDV bu kartın ekstresine borç yazılır; ödemesi normal ödeme gibi kapanır. */
export const VERGI_DAIRESI_ADI = 'Vergi dairesi';

export interface CariGirdisi {
  ad: string;
  roller: CariRol[];
  telefon: string | null;
  vergiNo: string | null;
  adres: string | null;
  not: string;
  /** Branşlar (usta tipi kimlikleri), ilki ana branş. Verilmezse güncellemede eskisi korunur, yeni kartta boş. */
  ustaTipiIdleri?: string[];
  /** Firma adına imzalayan kişi. Verilmezse güncellemede eskisi korunur. */
  yetkili?: string | null;
}

/** Branş seçilebilen roller. */
export const BRANSLI_ROLLER: CariRol[] = ['usta', 'taseron'];
export const bransliMi = (roller: CariRol[]) => roller.some((r) => BRANSLI_ROLLER.includes(r));


const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
/** Ad tekrarı denetimi: büyük/küçük ve Türkçe harfsiz yazım aynı ad sayılır ("Celik" = "Çelik"). */
const adAnahtari = aramaAnahtari;

type TemizCari = Omit<CariGirdisi, 'ustaTipiIdleri' | 'yetkili'> & { ustaTipiIdleri: string[]; yetkili: string | null };

/**
 * Girdiyi saklanacak biçime getirir. Verilmeyen branş/yetkili `eski`den alınır. Branşlar tekrarsız, sırası korunur
 * (ilki ana branş) ve yalnız firmanın usta tiplerinden olur; usta ya da taşeron rolü yoksa boşalır.
 */
function temizle(g: CariGirdisi, gecerliTipler: Set<string>, eski?: Cari | null): TemizCari {
  const bosIseNull = (m: string | null | undefined) => (m?.trim() ? m.trim().replace(/\s+/g, ' ') : null);
  // Roller sabit sırada ve tekrarsız saklanır; sistem rolü girdiden alınmaz.
  const roller = CARI_ROLLERI.filter((r) => g.roller.includes(r));
  const branslar = g.ustaTipiIdleri ?? eski?.ustaTipiIdleri ?? [];
  return {
    ad: g.ad.trim().replace(/\s+/g, ' '),
    roller,
    telefon: bosIseNull(g.telefon),
    vergiNo: g.vergiNo?.replace(/\s/g, '') || null,
    adres: bosIseNull(g.adres),
    not: g.not.trim(),
    ustaTipiIdleri: bransliMi(roller) ? [...new Set(branslar)].filter((id) => gecerliTipler.has(id)) : [],
    yetkili: g.yetkili === undefined ? (eski?.yetkili ?? null) : bosIseNull(g.yetkili),
  };
}

async function gecerliUstaTipleri(depo: Depo, firmaId: string): Promise<Set<string>> {
  return new Set(aktif(await depo.listele('ustaTipi', { firmaId })).map((u) => u.id));
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

async function ayniAdKontrol(depo: Depo, firmaId: string, g: TemizCari, secenek: CariKayitSecenegi, haricId?: string) {
  if (secenek.ayniAdOnayli) return;
  const mevcutlar = await ayniAdlilar(depo, firmaId, g.ad, haricId);
  if (mevcutlar.length > 0) {
    throw new AyniAdliCariUyarisi(mevcutlar.map(({ id, ad, telefon, roller }) => ({ id, ad, telefon, roller })));
  }
}

function cariHatalari(g: TemizCari): string[] {
  const hatalar: string[] = [];
  if (!g.ad) hatalar.push('Cari adı boş olamaz.');
  if (g.roller.length === 0) hatalar.push('En az bir rol seçin (usta, taşeron, tedarikçi, müşteri…).');
  if (g.vergiNo && !/^\d{10,11}$/.test(g.vergiNo)) {
    hatalar.push('Vergi no 10 haneli, TC kimlik no 11 haneli olmalı.');
  }
  if (g.telefon && g.telefon.replace(/\D/g, '').length < 10) hatalar.push('Telefon numarası eksik görünüyor.');
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
  return depo.islem(async () => {
    const g = temizle(girdi, await gecerliUstaTipleri(depo, servis.oturum.firmaId));
    const hatalar = [...cariHatalari(g), ...acilisHatalari(acilis)];
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    await ayniAdKontrol(depo, servis.oturum.firmaId, g, secenek);
    const cari = await servis.ekle('cari', g);
    await acilisEkle(servis, 'cari', cari.id, acilis);
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
  return depo.islem(async () => {
    const eski = await depo.getir('cari', cariId);
    const g = temizle(girdi, await gecerliUstaTipleri(depo, servis.oturum.firmaId), eski);
    // Vergi dairesi kartı rolünü korur; tek rolü o olabilir.
    if (eski?.roller.includes('vergi_dairesi')) g.roller = ['vergi_dairesi', ...g.roller];
    const hatalar = cariHatalari(g);
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
export const acilisBakiyesiGetir = (depo: Depo, firmaId: string, cariId: string): Promise<AcilisBakiyesi | null> =>
  acilisGetir(depo, firmaId, 'cari', cariId);

/** Artı = borcumuz, eksi = alacağımız. Null ya da 0 ile iptal edilir. */
export const acilisBakiyesiAyarla = (
  depo: Depo,
  servis: KayitServisi,
  cariId: string,
  acilis: AcilisGirdisi | null,
  gerekce?: string,
): Promise<void> => acilisAyarla(depo, servis, 'cari', cariId, acilis, gerekce);

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
  const sozlesmede = aktif(await depo.listele('katKarsiligiSozlesme', { firmaId })).filter((s) =>
    s.arsaSahipleri.some((a) => a.cariId === cariId),
  ).length;
  return listeler.reduce((t, l) => t + aktif(l as { iptal: unknown }[]).length, 0) + sozlesmede;
}

/** Hareketi olmayan cari iptal edilebilir; açılış bakiyesi de onunla iptal olur. */
export async function cariIptal(depo: Depo, servis: KayitServisi, cariId: string, gerekce?: string): Promise<void> {
  await depo.islem(async () => {
    const cari = await depo.getir('cari', cariId);
    if (cari?.roller.includes('vergi_dairesi')) throw new IsKuraliHatasi('Vergi dairesi kartı sistemindir; iptal edilemez.');
    if ((await bagliHareketSayisi(depo, servis.oturum.firmaId, cariId)) > 0) {
      throw new IsKuraliHatasi('Bu carinin kayıtlı hareketleri (alış, ödeme, ortaklık, arsa sahipliği…) var; iptal edilemez.');
    }
    await servis.iptal('cari', cariId, gerekce);
  });
}

// ─── Eski kart adlarından branş ayırma ─────────────────────────────

export interface KartBransOnerisi extends BransAyirmaOnerisi {
  cari: Cari;
  tipAdi: string;
}

/** Usta/taşeron kartlarında adın içine yazılmış meslek: "Ahmet Demir Tuğlası" → "Ahmet Demir" + Duvarcı. */
export async function bransAyirmaOnerileri(depo: Depo, firmaId: string): Promise<KartBransOnerisi[]> {
  const [cariler, tipler] = await Promise.all([depo.listele('cari', { firmaId }), depo.listele('ustaTipi', { firmaId })]);
  const aktifTipler = aktif(tipler);
  const sonuc: KartBransOnerisi[] = [];
  for (const cari of aktif(cariler)) {
    if (!bransliMi(cari.roller)) continue;
    const oneri = addanBransOner(cari.ad, aktifTipler);
    if (oneri) sonuc.push({ ...oneri, cari, tipAdi: aktifTipler.find((t) => t.id === oneri.ustaTipiId)!.ad });
  }
  return sonuc.sort((a, b) => a.cari.ad.localeCompare(b.cari.ad, 'tr'));
}

/**
 * Seçilen önerileri uygular: ad kısalır, branş karta eklenir (kartın branşı yoksa ana branş olur). Kısalan ad başka
 * bir kartla aynı olursa o kart atlanır (aynı kişi olabilir; kullanıcı elle birleştirir) ve adı döner.
 */
export async function bransAyirmaUygula(
  depo: Depo,
  servis: KayitServisi,
  secilenler: { cariId: string; yeniAd: string; ustaTipiId: string }[],
): Promise<{ duzeltilen: number; atlanan: string[] }> {
  let duzeltilen = 0;
  const atlanan: string[] = [];
  for (const x of secilenler) {
    const cari = await cariGetir(depo, servis.oturum.firmaId, x.cariId);
    if (!cari) continue;
    try {
      await cariGuncelle(depo, servis, cari.id, {
        ad: x.yeniAd,
        roller: cari.roller,
        telefon: cari.telefon,
        vergiNo: cari.vergiNo,
        adres: cari.adres,
        not: cari.not,
        ustaTipiIdleri: cari.ustaTipiIdleri.includes(x.ustaTipiId) ? cari.ustaTipiIdleri : [...cari.ustaTipiIdleri, x.ustaTipiId],
      });
      duzeltilen++;
    } catch (e) {
      if (e instanceof AyniAdliCariUyarisi) atlanan.push(cari.ad);
      else throw e;
    }
  }
  return { duzeltilen, atlanan };
}

// ─── Vergi dairesi ─────────────────────────────────────────────────

/** Firmanın vergi dairesi kartı; yoksa null. */
export async function vergiDairesiGetir(depo: Depo, firmaId: string): Promise<Cari | null> {
  return aktif(await depo.listele('cari', { firmaId })).find((c) => c.roller.includes('vergi_dairesi')) ?? null;
}

/**
 * Vergi dairesi kartı yoksa açar; aynı adlı (elle açılmış) kart varsa onu vergi dairesi yapar.
 * Kurulumda, açılışta ve tevkifatlı giderde çağrılır; varsa hiçbir şey yazmaz.
 */
export async function vergiDairesiHazirla(depo: Depo, servis: KayitServisi): Promise<Cari> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const mevcut = await vergiDairesiGetir(depo, firmaId);
    if (mevcut) return mevcut;
    const ayniAdli = (await ayniAdlilar(depo, firmaId, VERGI_DAIRESI_ADI))[0];
    if (ayniAdli) {
      return servis.guncelle('cari', ayniAdli.id, { roller: ['vergi_dairesi', ...ayniAdli.roller] }, 'Tevkifat takibi için vergi dairesi kartı yapıldı.');
    }
    return servis.ekle('cari', {
      ad: VERGI_DAIRESI_ADI,
      roller: ['vergi_dairesi'],
      ustaTipiIdleri: [],
      yetkili: null,
      telefon: null,
      vergiNo: null,
      adres: null,
      not: 'Tevkif edilen KDV bu karta borç yazılır. Adını kendi vergi dairenizle değiştirebilirsiniz.',
    }, await bosSabitId((id) => depo.getir('cari', id), firmaId, 'vergi-dairesi'));
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
  const [cariler, acilislar, giderler, hakedisler, odemeler, cekler, cekHareketleri, alacaklar] = await Promise.all([
    depo.listele('cari', k),
    depo.listele('acilisBakiyesi', k),
    depo.listele('gider', k),
    depo.listele('hakedis', k),
    depo.listele('odeme', k),
    depo.listele('cekSenet', k),
    depo.listele('cekHareketi', k),
    depo.listele('alacak', k),
  ]);
  const vergiDairesiId = aktif(cariler).find((c) => c.roller.includes('vergi_dairesi'))?.id ?? null;
  const hareketler = { acilislar, giderler, hakedisler, odemeler, cekler, cekHareketleri, alacaklar, vergiDairesiId };
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
    const digerleri = await oranKontrol(depo, firmaId, projeId, oran);
    if (digerleri.some((o) => o.cariId === cariId)) {
      throw new IsKuraliHatasi(`${cari.ad} bu projede zaten ortak; oranını değiştirin.`);
    }
    await rolEkle(servis, cari, 'ortak', 'Projeye ortak eklenince ortak rolü verildi.');
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
