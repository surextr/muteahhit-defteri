import { IsKuraliHatasi, type Oturum } from '../servisler/kayitServisi';
import { META_BULUT } from '../servisler/kurulum';
export { META_BULUT };
import { blobCoz, blobKodla } from '../servisler/yedek';
import type { BekleyenKayit, Depo, DisKayit } from '../veri/depo';
import type { TabloAdi } from '../veri/tipler';
import { BaglantiHatasi, cevrimici, istek, SunucuHatasi } from './api';
import { birlestir } from './birlestir';

/**
 * Bulut eşitleme (kendi sunucumuz, sunucu/api/_ic/esitleme.php).
 *
 * Cihaz önce çalışır (internetsiz de); her yazılan kayıt veri katmanında "bekleyen" işaretlenir. Eşitleme:
 *  1. Bekleyenleri gönderir. Sunucu yetkiyi ve sürümü denetler; reddettiği kaydın sunucudaki hâli bu cihaza yazılır.
 *  2. Son alınan sıradan sonraki değişiklikleri çeker; bu cihazda hâlâ gönderilmeyi bekleyen kayıt üzerine yazılmaz.
 * Aynı kayıt iki cihazda değişirse sunucu ikinci gelenin sürümünü reddeder; o cihaz kendi değiştirdiği alanları
 * sunucudaki hâlin üstüne koyup yeniden gönderir (aynı alanı ikisi de değiştirdiyse sonra gönderenin değeri kalır).
 * İşlem geçmişi iki değişikliği de tutar.
 */


/** Cihazın bulut bağlantısı (meta, cihaza özel; yedeğe girmez). */
export interface BulutBaglantisi {
  firmaId: string;
  kullaniciId: string;
  /** Sunucudan en son alınan değişikliğin sırası. */
  sonSira: number;
  /** Son başarılı eşitleme (ISO). */
  sonEsitleme: string | null;
}

export interface Reddedilen {
  tablo: string;
  id: string;
  sebep: 'yetki' | 'eski' | 'firma' | 'boyut' | string;
}

export interface EsitlemeSonucu {
  gonderilen: number;
  alinan: number;
  /** Başka cihazdaki değişiklikle alan alan birleştirilip yeniden gönderilen kayıtlar. */
  birlestirilen: number;
  /** Geri alınan (yetkisiz) değişiklikler. */
  reddedilen: Reddedilen[];
}

// ─── Sunucu arayüzü (testte sahtesi kullanılır) ───────────────────────

export interface SunucuKaydi {
  tablo: string;
  veri: Record<string, unknown> & { id: string };
}

export interface BulutApi {
  firmalarim(): Promise<{ firmalar: { id: string; ad: string; kullaniciId: string }[] }>;
  firmaOlustur(g: { firmaId: string; ad: string; kullaniciId: string }): Promise<{ firmaId: string; yeni: boolean }>;
  davetOlustur(g: { firmaId: string; kullaniciId: string }): Promise<{ kod: string; gun: number }>;
  davetKabul(kod: string): Promise<{ firmaId: string; kullaniciId: string; ad: string }>;
  uyeler(firmaId: string): Promise<{ uyeler: { kullaniciId: string; eposta: string }[] }>;
  baglantiKaldir(g: { firmaId: string; kullaniciId: string }): Promise<unknown>;
  gonder(g: { firmaId: string; kayitlar: SunucuKaydi[] }): Promise<{
    kabul: { tablo: string; id: string }[];
    red: (Reddedilen & { sunucu: SunucuKaydi['veri'] | null })[];
    sonSira: number;
  }>;
  cek(firmaId: string, sonra: number): Promise<{ kayitlar: (SunucuKaydi & { sira: number })[]; sonSira: number; devam: boolean }>;
}

export const sunucuApi: BulutApi = {
  firmalarim: () => istek('firmalarim'),
  firmaOlustur: (g) => istek('firma_olustur', g),
  davetOlustur: (g) => istek('davet_olustur', g),
  davetKabul: (kod) => istek('davet_kabul', { kod }),
  uyeler: (firmaId) => istek('uyeler', undefined, { firma: firmaId }),
  baglantiKaldir: (g) => istek('baglanti_kaldir', g),
  gonder: (g) => istek('gonder', g),
  cek: (firmaId, sonra) => istek('cek', undefined, { firma: firmaId, sonra }),
};

// ─── Bağlantı ─────────────────────────────────────────────────────────

export function bulutBaglantisi(depo: Depo): Promise<BulutBaglantisi | undefined> {
  return depo.metaGetir<BulutBaglantisi>(META_BULUT);
}

/** Bir gönderimde en çok bu kadar bayt (JSON); büyük belge dosyası tek başına gider. */
const GONDERIM_BAYT = 2_000_000;
const GONDERIM_KAYIT = 300;

async function sunucuyaHazirla(depo: Depo, b: BekleyenKayit): Promise<SunucuKaydi | null> {
  const kayit = await depo.getir(b.tablo, b.id);
  if (!kayit) return null;
  return { tablo: b.tablo, veri: (await blobKodla(kayit)) as SunucuKaydi['veri'] };
}

const cihazaHazirla = (k: SunucuKaydi): DisKayit => ({ tablo: k.tablo as TabloAdi, kayit: blobCoz(k.veri) as DisKayit['kayit'] });

let suren: Promise<EsitlemeSonucu> | null = null;

/** Gönder ve çek. Aynı anda tek eşitleme çalışır; ikinci çağrı süreni bekler. */
export function esitle(depo: Depo, api: BulutApi = sunucuApi): Promise<EsitlemeSonucu> {
  if (!suren) {
    suren = esitleIc(depo, api).finally(() => {
      suren = null;
    });
  }
  return suren;
}

async function esitleIc(depo: Depo, api: BulutApi): Promise<EsitlemeSonucu> {
  const baglanti = await bulutBaglantisi(depo);
  if (!baglanti) throw new IsKuraliHatasi('Bu cihaz buluta bağlı değil.');
  const sonuc: EsitlemeSonucu = { gonderilen: 0, alinan: 0, birlestirilen: 0, reddedilen: [] };

  // 1. Gönder
  for (;;) {
    const bekleyen = await depo.bekleyenler(GONDERIM_KAYIT);
    if (bekleyen.length === 0) break;
    const paket: SunucuKaydi[] = [];
    const giden: BekleyenKayit[] = [];
    let bayt = 0;
    for (const b of bekleyen) {
      const k = await sunucuyaHazirla(depo, b);
      giden.push(b);
      if (!k) continue;
      const boyut = JSON.stringify(k).length;
      if (paket.length > 0 && bayt + boyut > GONDERIM_BAYT) {
        giden.pop();
        break;
      }
      paket.push(k);
      bayt += boyut;
    }
    if (paket.length > 0) {
      const y = await api.gonder({ firmaId: baglanti.firmaId, kayitlar: paket });
      sonuc.gonderilen += y.kabul.length;
      for (const r of y.red) {
        if (!r.sunucu) continue;
        const sunucudaki = cihazaHazirla({ tablo: r.tablo, veri: r.sunucu });
        const benim = await depo.getir(r.tablo as TabloAdi, r.id);
        if (r.sebep === 'eski' && benim) {
          // Başka cihaz önce değiştirmiş: bu cihazın değiştirdiği alanlar sunucudakinin üstüne konup yeniden gönderilir.
          const taban = await depo.bekleyenTabani(r.tablo as TabloAdi, r.id);
          const birlesik = birlestir(taban, benim as unknown as Record<string, unknown>, sunucudaki.kayit, new Date().toISOString());
          await depo.birlesikYaz({ tablo: sunucudaki.tablo, kayit: birlesik as DisKayit['kayit'] }, sunucudaki.kayit);
          sonuc.birlestirilen++;
        } else {
          // Yetkisiz: sunucudaki hâl geri gelir (sunucuda hiç yoksa yerel kayıt kalır ama gönderilmez).
          await depo.disaridanYaz([sunucudaki], true);
        }
      }
      sonuc.reddedilen.push(...y.red.filter((r) => r.sebep !== 'eski').map(({ tablo, id, sebep }) => ({ tablo, id, sebep })));
    }
    await depo.bekleyenleriTemizle(giden);
  }

  // 2. Çek
  let sonSira = baglanti.sonSira;
  for (;;) {
    const y = await api.cek(baglanti.firmaId, sonSira);
    if (y.kayitlar.length > 0) sonuc.alinan += await depo.disaridanYaz(y.kayitlar.map(cihazaHazirla));
    sonSira = y.sonSira;
    await depo.metaYaz(META_BULUT, { ...baglanti, sonSira, sonEsitleme: new Date().toISOString() } satisfies BulutBaglantisi);
    if (!y.devam) break;
  }
  return sonuc;
}

/**
 * Bu cihazdaki firmayı buluta açar (yalnız yönetici): sunucuda firma kurulur, bütün kayıtlar gönderilir. Daha önce
 * açılmışsa (aynı hesapla) yeniden bağlanır ve eksikler gönderilir.
 */
export async function bulutaAc(depo: Depo, oturum: Oturum, firmaAdi: string, api: BulutApi = sunucuApi): Promise<EsitlemeSonucu> {
  await api.firmaOlustur({ firmaId: oturum.firmaId, ad: firmaAdi, kullaniciId: oturum.kullaniciId });
  await depo.hepsiniBekleyenYap();
  await depo.metaYaz(META_BULUT, { firmaId: oturum.firmaId, kullaniciId: oturum.kullaniciId, sonSira: 0, sonEsitleme: null } satisfies BulutBaglantisi);
  return esitle(depo, api);
}

/**
 * Kurulumu yapılmamış (boş) cihaz buluttaki firmaya katılır: bütün kayıtlar çekilir, cihazın kullanıcısı davetteki
 * (ya da hesabın bağlı olduğu) kullanıcı olur. Dönüş: oturum bilgileri (meta yazıldıktan sonra uygulama açılır).
 */
export async function bulutFirmasinaKatil(depo: Depo, firma: { firmaId: string; kullaniciId: string }, api: BulutApi = sunucuApi): Promise<void> {
  if (await depo.metaGetir('aktifFirmaId')) throw new IsKuraliHatasi('Bu cihazda zaten bir firma var.');
  await depo.metaYaz(META_BULUT, { ...firma, sonSira: 0, sonEsitleme: null } satisfies BulutBaglantisi);
  try {
    await esitle(depo, api);
    if (!(await depo.getir('firma', firma.firmaId))) throw new IsKuraliHatasi('Firmanın kayıtları buluttan alınamadı.');
  } catch (e) {
    await depo.metaSil(META_BULUT);
    throw e;
  }
  await depo.metaYaz('aktifFirmaId', firma.firmaId);
  await depo.metaYaz('aktifKullaniciId', firma.kullaniciId);
}

/** Cihaz eşitlemeyi bırakır; veriler cihazda kalır. Gönderilmemiş değişiklik varsa önce eşitlenmeli (ekran sorar). */
export async function bulutBaglantisiniKes(depo: Depo): Promise<void> {
  await depo.metaSil(META_BULUT);
}

// ─── Kendiliğinden eşitleme ───────────────────────────────────────────

export type EsitlemeDurumu =
  | { tur: 'bagli_degil' }
  | { tur: 'esitleniyor' }
  | { tur: 'tamam'; zaman: string | null; bekleyen: number }
  | { tur: 'cevrimdisi'; bekleyen: number }
  | { tur: 'giris_gerekli'; bekleyen: number }
  | { tur: 'hata'; mesaj: string; bekleyen: number };

export interface Yonetici {
  /** Hemen eşitle (düğme). */
  simdi(): Promise<void>;
  durdur(): void;
}

/**
 * Uygulama açıkken eşitler: açılışta, internet gelince, sayfaya dönülünce, kayıt yazılınca (birkaç saniye sonra) ve
 * belirli aralıklarla. `veriGeldi`: başka cihazdan kayıt geldi (ekran yenilensin); `reddedildi`: değişiklik geri alındı.
 */
export function kendiligindenEsitle(
  depo: Depo,
  geri: { durum: (d: EsitlemeDurumu) => void; veriGeldi: () => void; reddedildi: (r: Reddedilen[]) => void },
  api: BulutApi = sunucuApi,
  aralik = 60_000,
): Yonetici {
  let durdu = false;
  let zamanlayici: ReturnType<typeof setTimeout> | null = null;

  async function calistir() {
    if (durdu) return;
    const baglanti = await bulutBaglantisi(depo);
    if (!baglanti) return geri.durum({ tur: 'bagli_degil' });
    const bekleyen = async () => depo.bekleyenSayisi();
    if (!cevrimici()) return geri.durum({ tur: 'cevrimdisi', bekleyen: await bekleyen() });
    geri.durum({ tur: 'esitleniyor' });
    try {
      const s = await esitle(depo, api);
      if (s.alinan > 0 || s.birlestirilen > 0 || s.reddedilen.length > 0) geri.veriGeldi();
      if (s.reddedilen.length > 0) geri.reddedildi(s.reddedilen);
      geri.durum({ tur: 'tamam', zaman: new Date().toISOString(), bekleyen: await bekleyen() });
    } catch (e) {
      if (e instanceof BaglantiHatasi) geri.durum({ tur: 'cevrimdisi', bekleyen: await bekleyen() });
      else if (e instanceof SunucuHatasi && e.durum === 401) geri.durum({ tur: 'giris_gerekli', bekleyen: await bekleyen() });
      else geri.durum({ tur: 'hata', mesaj: e instanceof Error ? e.message : String(e), bekleyen: await bekleyen() });
    }
  }

  const sonra = (ms: number) => {
    if (durdu) return;
    if (zamanlayici) clearTimeout(zamanlayici);
    zamanlayici = setTimeout(() => void calistir().finally(() => sonra(aralik)), ms);
  };

  const cevrimiciOldu = () => sonra(500);
  const gorunurOldu = () => document.visibilityState === 'visible' && sonra(500);
  depo.degisinceHaberVer(() => sonra(3000));
  if (typeof window !== 'undefined') {
    window.addEventListener('online', cevrimiciOldu);
    document.addEventListener('visibilitychange', gorunurOldu);
  }
  sonra(0);

  return {
    simdi: async () => {
      if (zamanlayici) clearTimeout(zamanlayici);
      await calistir();
      sonra(aralik);
    },
    durdur: () => {
      durdu = true;
      if (zamanlayici) clearTimeout(zamanlayici);
      depo.degisinceHaberVer(null);
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', cevrimiciOldu);
        document.removeEventListener('visibilitychange', gorunurOldu);
      }
    },
  };
}
