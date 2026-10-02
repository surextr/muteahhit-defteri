import { yerelGun } from '../hesap/tarih';
import type { Depo, GecistenOnce, TabloIcerigi } from '../veri/depo';
import { TABLO_DONUSTURUCULERI } from '../veri/gecisler';
import { yeniId } from '../veri/kimlik';
import type { Zaman } from '../veri/tipler';
import type { YedekArsivi } from '../veri/yedekArsivi';
import { IsKuraliHatasi } from './kayitServisi';
import { META_CIHAZ, cihazKimligi, oturumuYukle } from './kurulum';

export const YEDEK_UYGULAMA = 'muteahhit-hesap-defteri';
/** Yedek dosyasının kendi biçimi; şema sürümünden bağımsızdır. */
export const YEDEK_BICIM_SURUMU = 1;

export interface YedekDosyasi {
  uygulama: typeof YEDEK_UYGULAMA;
  bicimSurumu: number;
  /** Yedeğin alındığı veritabanı şeması sürümü. */
  semaSurumu: number;
  olusturmaZamani: Zaman;
  tur: 'elle' | 'otomatik';
  neden: string;
  /** Cihaza özel olmayan meta değerleri (aktif firma, kullanıcı…). */
  meta: Record<string, unknown>;
  /** Tablo adı → kayıtlar. Dosyalar (Blob) metne çevrilmiştir. */
  tablolar: Record<string, unknown[]>;
  /**
   * false: "sadece veri" yedeği; belge dosyaları (belgeDosyasi) yoktur, künyeleri vardır.
   * Yoksa (eski yedekler) dosyalar dahildir.
   */
  belgelerDahil?: boolean;
}

/**
 * Eski şemalı yedeği bir sonraki sürüme çeviren adımlar: n → n+1.
 * Şemaya yeni sürüm eklendiğinde (veri/indexeddb/sema.ts) karşılığı buraya yazılır.
 */
const DONUSTURUCULER = TABLO_DONUSTURUCULERI;

// ─── Dosyalar (Blob) ⇄ metin ───────────────────────────────────────

interface KodluBlob {
  __blob: true;
  tur: string;
  veri: string;
}

const kodluBlobMu = (d: unknown): d is KodluBlob =>
  typeof d === 'object' && d !== null && (d as KodluBlob).__blob === true;

async function blobKodla(deger: unknown): Promise<unknown> {
  if (deger instanceof Blob) {
    const baytlar = new Uint8Array(await deger.arrayBuffer());
    let ikili = '';
    for (let i = 0; i < baytlar.length; i += 0x8000) {
      ikili += String.fromCharCode(...baytlar.subarray(i, i + 0x8000));
    }
    return { __blob: true, tur: deger.type, veri: btoa(ikili) } satisfies KodluBlob;
  }
  if (Array.isArray(deger)) return Promise.all(deger.map(blobKodla));
  if (typeof deger === 'object' && deger !== null) {
    const sonuc: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(deger)) sonuc[k] = await blobKodla(v);
    return sonuc;
  }
  return deger;
}

function blobCoz(deger: unknown): unknown {
  if (kodluBlobMu(deger)) {
    const ikili = atob(deger.veri);
    const baytlar = new Uint8Array(ikili.length);
    for (let i = 0; i < ikili.length; i++) baytlar[i] = ikili.charCodeAt(i);
    return new Blob([baytlar], { type: deger.tur });
  }
  if (Array.isArray(deger)) return deger.map(blobCoz);
  if (typeof deger === 'object' && deger !== null) {
    return Object.fromEntries(Object.entries(deger).map(([k, v]) => [k, blobCoz(v)]));
  }
  return deger;
}

// ─── Yedek oluşturma ───────────────────────────────────────────────

async function yedekNesnesi(girdi: {
  icerik: TabloIcerigi;
  meta: Record<string, unknown>;
  semaSurumu: number;
  tur: YedekDosyasi['tur'];
  neden: string;
  zaman: Date;
}): Promise<YedekDosyasi> {
  const { [META_CIHAZ]: _cihaz, ...meta } = girdi.meta;
  return {
    uygulama: YEDEK_UYGULAMA,
    bicimSurumu: YEDEK_BICIM_SURUMU,
    semaSurumu: girdi.semaSurumu,
    olusturmaZamani: girdi.zaman.toISOString(),
    tur: girdi.tur,
    neden: girdi.neden,
    meta,
    tablolar: (await blobKodla(girdi.icerik)) as Record<string, unknown[]>,
  };
}

export async function yedekOlustur(
  depo: Depo,
  secenek: { tur: YedekDosyasi['tur']; neden: string },
  saat: () => Date = () => new Date(),
): Promise<YedekDosyasi> {
  const [icerik, meta] = await Promise.all([depo.hepsiniOku(), depo.metaHepsi()]);
  return yedekNesnesi({ icerik, meta, semaSurumu: depo.semaSurumu, ...secenek, zaman: saat() });
}

export const yedekMetni = (yedek: YedekDosyasi): string => JSON.stringify(yedek);

/** hesap-defteri-yedek-2026-10-01-2359.json */
export function yedekDosyaAdi(yedek: YedekDosyasi): string {
  const z = new Date(yedek.olusturmaZamani);
  const saat = `${String(z.getHours()).padStart(2, '0')}${String(z.getMinutes()).padStart(2, '0')}`;
  return `hesap-defteri-yedek-${yerelGun(z)}-${saat}${yedek.belgelerDahil === false ? '-sadece-veri' : ''}.json`;
}

export const META_SON_YEDEK = 'sonYedekZamani';

/** Kullanıcının istediği yedek: dosya olarak indirilecek. Son yedek zamanı hatırlanır. */
/**
 * Kullanıcının istediği yedek: dosya olarak indirilecek. Son yedek zamanı hatırlanır.
 * `belgeler: false`: "sadece veri"; fotoğraf/PDF dosyaları girmez (küçük dosya), belge künyeleri girer.
 */
export async function elleYedekAl(
  depo: Depo,
  saat: () => Date = () => new Date(),
  secenek: { belgeler: boolean } = { belgeler: true },
): Promise<{ dosyaAdi: string; metin: string; yedek: YedekDosyasi }> {
  const [icerik, meta] = await Promise.all([depo.hepsiniOku(), depo.metaHepsi()]);
  if (!secenek.belgeler) icerik.belgeDosyasi = [];
  const yedek = await yedekNesnesi({ icerik, meta, semaSurumu: depo.semaSurumu, tur: 'elle', neden: '', zaman: saat() });
  if (!secenek.belgeler) yedek.belgelerDahil = false;
  await depo.metaYaz(META_SON_YEDEK, yedek.olusturmaZamani);
  return { dosyaAdi: yedekDosyaAdi(yedek), metin: yedekMetni(yedek), yedek };
}

export async function arsiveKaydet(arsiv: YedekArsivi, yedek: YedekDosyasi): Promise<string> {
  const id = yeniId();
  const icerik = yedekMetni(yedek);
  await arsiv.kaydet({
    id,
    zaman: yedek.olusturmaZamani,
    tur: yedek.tur,
    neden: yedek.neden,
    semaSurumu: yedek.semaSurumu,
    boyut: icerik.length,
    icerik,
  });
  return id;
}

/** Veritabanı yapısı güncellenmeden önce eski veriyi arşive yedekler. */
export function gecisOncesiYedekleyici(arsiv: YedekArsivi, saat: () => Date = () => new Date()): GecistenOnce {
  return async ({ eskiSurum, yeniSurum, icerik, meta }) => {
    const yedek = await yedekNesnesi({
      icerik,
      meta,
      semaSurumu: eskiSurum,
      tur: 'otomatik',
      neden: `Veritabanı güncellemesi öncesi (sürüm ${eskiSurum} → ${yeniSurum})`,
      zaman: saat(),
    });
    await arsiveKaydet(arsiv, yedek);
  };
}

// ─── Okuma ve geri yükleme ─────────────────────────────────────────

/** Dosya metnini doğrular, gerekiyorsa eski şemadan bugünküne çevirir. */
export function yedegiCoz(metin: string, mevcutSemaSurumu: number): YedekDosyasi {
  let veri: Partial<YedekDosyasi>;
  try {
    veri = JSON.parse(metin);
  } catch {
    throw new IsKuraliHatasi('Dosya okunamadı: geçerli bir yedek dosyası değil.');
  }
  if (typeof veri !== 'object' || veri === null || veri.uygulama !== YEDEK_UYGULAMA) {
    throw new IsKuraliHatasi('Bu dosya bir Müteahhit Hesap Defteri yedeği değil.');
  }
  if (typeof veri.bicimSurumu !== 'number' || typeof veri.semaSurumu !== 'number') {
    throw new IsKuraliHatasi('Yedek dosyası bozuk: sürüm bilgisi eksik.');
  }
  if (veri.bicimSurumu > YEDEK_BICIM_SURUMU || veri.semaSurumu > mevcutSemaSurumu) {
    throw new IsKuraliHatasi(
      `Bu yedek uygulamanın daha yeni bir sürümüyle alınmış (şema ${veri.semaSurumu}, bu cihazda ${mevcutSemaSurumu}). Önce uygulamayı güncelleyin.`,
    );
  }
  const tablolar = veri.tablolar;
  if (typeof tablolar !== 'object' || tablolar === null || Array.isArray(tablolar)) {
    throw new IsKuraliHatasi('Yedek dosyası bozuk: tablolar eksik.');
  }
  if (!Object.values(tablolar).every(Array.isArray)) {
    throw new IsKuraliHatasi('Yedek dosyası bozuk: tablo içeriği liste değil.');
  }

  let donusmus = tablolar;
  for (let s = veri.semaSurumu; s < mevcutSemaSurumu; s++) {
    const donustur = DONUSTURUCULER[s];
    if (!donustur) {
      throw new IsKuraliHatasi(`Şema ${s} sürümündeki yedek bu sürüme çevrilemiyor.`);
    }
    donusmus = donustur(donusmus);
  }
  return { ...(veri as YedekDosyasi), semaSurumu: mevcutSemaSurumu, tablolar: donusmus };
}

export interface YedekOzeti {
  olusturmaZamani: Zaman;
  semaSurumu: number;
  firmaAdi: string | null;
  kayitSayisi: number;
  tur: YedekDosyasi['tur'];
  neden: string;
  belgelerDahil: boolean;
  /** Belge künyesi sayısı (dosyalar dahil olmasa da). */
  belgeSayisi: number;
}

export function yedekOzeti(yedek: YedekDosyasi): YedekOzeti {
  const firma = yedek.tablolar.firma?.[0] as { ad?: string } | undefined;
  return {
    olusturmaZamani: yedek.olusturmaZamani,
    semaSurumu: yedek.semaSurumu,
    firmaAdi: firma?.ad ?? null,
    kayitSayisi: Object.entries(yedek.tablolar)
      .filter(([ad]) => ad !== 'islemGecmisi')
      .reduce((t, [, kayitlar]) => t + kayitlar.length, 0),
    tur: yedek.tur,
    neden: yedek.neden,
    belgelerDahil: yedek.belgelerDahil !== false,
    belgeSayisi: (yedek.tablolar.belge as { iptal?: unknown }[] | undefined)?.filter((b) => !b.iptal).length ?? 0,
  };
}

/**
 * Yedeği geri yükler:
 * 1. mevcut verinin otomatik yedeği arşive alınır,
 * 2. bütün veri tek işlemde yedektekiyle değiştirilir (bu cihazın kimliği korunur);
 *    "sadece veri" yedeğinde, yedekteki belgelerin bu cihazda bulunan dosyaları korunur,
 * 3. işlem geçmişine not düşülür.
 * Dönüş: geri alma için öncesinde alınan otomatik yedeğin kimliği.
 */
export async function geriYukle(
  depo: Depo,
  arsiv: YedekArsivi,
  yedek: YedekDosyasi,
  saat: () => Date = () => new Date(),
): Promise<{ oncekiYedekId: string }> {
  const onceki = await yedekOlustur(depo, { tur: 'otomatik', neden: 'Geri yükleme öncesi' }, saat);
  const oncekiYedekId = await arsiveKaydet(arsiv, onceki);

  const cihazId = await cihazKimligi(depo);
  const icerik = blobCoz(yedek.tablolar) as TabloIcerigi;
  if (yedek.belgelerDahil === false) {
    const belgeIdleri = new Set((icerik.belge ?? []).map((b) => b.id));
    icerik.belgeDosyasi = (await depo.listele('belgeDosyasi')).filter((d) => belgeIdleri.has(d.belgeId));
  }
  await depo.hepsiniDegistir(icerik, { ...yedek.meta, [META_CIHAZ]: cihazId });

  const oturum = await oturumuYukle(depo);
  if (oturum) {
    await depo.ekle('islemGecmisi', {
      id: yeniId(),
      firmaId: oturum.firmaId,
      kayitTur: 'yedek',
      kayitId: oncekiYedekId,
      islem: 'geriYukle',
      eski: null,
      yeni: { yedekTarihi: yedek.olusturmaZamani, semaSurumu: yedek.semaSurumu, oncekiYedekId },
      kullaniciId: oturum.kullaniciId,
      cihazId,
      zaman: saat().toISOString(),
      gerekce: null,
    });
  }
  return { oncekiYedekId };
}
