import { tanimaToplami } from '../hesap/eFatura';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Belge, Cari, Gider, HavuzBelgesi, HavuzTanima, KayitTabloAdi } from '../veri/tipler';
import { BELGE_KABUL, BELGE_TUR_ADI, EN_BUYUK_BELGE, type BelgeBagi } from './belge';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Belge havuzu: her türlü belge tek kapıdan yüklenir, onay bekler; onaylanınca asıl kayda bağlanır.
// Dosya bir `belge` kaydıdır (bagliTur 'belgeHavuzu'); onayda yalnız bağı değişir, dosya taşınmaz.

/** Havuza yüklenebilenler: belgelerdekiler + e-Fatura XML dosyası. */
export const HAVUZ_KABUL = `${BELGE_KABUL},application/xml,text/xml,.xml`;
const IZINLI = new Set([...BELGE_KABUL.split(','), 'application/xml', 'text/xml']);
export const xmlMi = (mime: string) => mime === 'application/xml' || mime === 'text/xml';

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const bugun = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Dosyanın SHA-256 özeti (hex). */
export async function dosyaOzeti(dosya: Blob): Promise<string> {
  const ozet = await crypto.subtle.digest('SHA-256', await dosya.arrayBuffer());
  return [...new Uint8Array(ozet)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface HavuzGirdisi {
  dosya: Blob;
  ad: string;
  /** Yüklerken cihazda okunan fatura bilgisi (karekod/XML). */
  tanima: HavuzTanima | null;
}

/** Tanımadan belge türü tahmini. */
const turTahmini = (g: HavuzGirdisi): Belge['tur'] => (g.tanima ? 'fatura' : g.dosya.type.startsWith('image/') ? 'fotograf' : 'diger');

/**
 * Dosyaları havuza ekler. Aynı dosya (özeti aynı) havuzda zaten varsa eklenmez, adı `tekrar`da döner.
 * Fotoğraflar önceden cihazda küçültülmüş olmalıdır.
 */
export async function havuzaEkle(depo: Depo, servis: KayitServisi, girdiler: HavuzGirdisi[]): Promise<{ eklenen: HavuzBelgesi[]; tekrar: string[] }> {
  const firmaId = servis.oturum.firmaId;
  for (const g of girdiler) {
    if (!IZINLI.has(g.dosya.type)) throw new IsKuraliHatasi(`${g.ad}: yalnızca fotoğraf, PDF ya da e-Fatura XML dosyası yüklenebilir.`);
    if (g.dosya.size === 0) throw new IsKuraliHatasi(`${g.ad}: dosya boş.`);
    if (g.dosya.size > EN_BUYUK_BELGE) throw new IsKuraliHatasi(`${g.ad}: dosya çok büyük (en çok ${EN_BUYUK_BELGE / 1024 / 1024} MB).`);
  }
  const ozetler = await Promise.all(girdiler.map((g) => dosyaOzeti(g.dosya)));
  return depo.islem(async () => {
    const mevcut = new Set(aktif(await depo.listele('belgeHavuzu', { firmaId })).map((h) => h.ozet));
    const eklenen: HavuzBelgesi[] = [];
    const tekrar: string[] = [];
    for (const [i, g] of girdiler.entries()) {
      const ozet = ozetler[i]!;
      if (mevcut.has(ozet)) {
        tekrar.push(g.ad);
        continue;
      }
      mevcut.add(ozet);
      const havuzId = yeniId();
      const belgeId = yeniId();
      const tur = turTahmini(g);
      await servis.ekle(
        'belge',
        {
          tur,
          tarih: g.tanima?.tarih ?? bugun(),
          ad: g.ad.trim() || BELGE_TUR_ADI[tur],
          bagliTur: 'belgeHavuzu',
          bagliId: havuzId,
          mime: g.dosya.type,
          boyut: g.dosya.size,
        },
        belgeId,
      );
      await depo.ekle('belgeDosyasi', { id: yeniId(), firmaId, belgeId, dosya: g.dosya });
      eklenen.push(await servis.ekle('belgeHavuzu', { belgeId, durum: 'bekliyor', ozet, tanima: g.tanima, not: '', sonuc: null }, havuzId));
    }
    return { eklenen, tekrar };
  });
}

export interface HavuzSatiri {
  havuz: HavuzBelgesi;
  belge: Belge;
}

/** Onay bekleyenler, en yeni önce. */
export async function bekleyenler(depo: Depo, firmaId: string): Promise<HavuzSatiri[]> {
  const [havuz, belgeler] = await Promise.all([depo.listele('belgeHavuzu', { firmaId }), depo.listele('belge', { firmaId })]);
  const belge = new Map(belgeler.map((b) => [b.id, b]));
  return aktif(havuz)
    .filter((h) => h.durum === 'bekliyor')
    .flatMap((h) => {
      const b = belge.get(h.belgeId);
      return b && !b.iptal ? [{ havuz: h, belge: b }] : [];
    })
    .sort((a, b) => b.havuz.olusturmaZamani.localeCompare(a.havuz.olusturmaZamani));
}

export async function bekleyenSayisi(depo: Depo, firmaId: string): Promise<number> {
  return aktif(await depo.listele('belgeHavuzu', { firmaId })).filter((h) => h.durum === 'bekliyor').length;
}

export async function havuzSatiriGetir(depo: Depo, firmaId: string, havuzId: string): Promise<HavuzSatiri | null> {
  const h = await depo.getir('belgeHavuzu', havuzId);
  if (!h || h.firmaId !== firmaId || h.iptal) return null;
  const b = await depo.getir('belge', h.belgeId);
  return b && !b.iptal ? { havuz: h, belge: b } : null;
}

// ─── Eşleştirme ────────────────────────────────────────────────────

export interface HavuzOnerisi {
  /** VKN/TCKN'si tutan cari (birden çoksa ilki). */
  cari: Cari | null;
  /** Aynı fatura daha önce girilmiş olabilir: aynı cari ve fatura no, ya da aynı cari, tutar ve yakın tarih. */
  mevcutGiderler: Gider[];
  /** Fatura başka bir VKN'ye kesilmişse uyarı. */
  aliciUyarisi: string | null;
}

const gunFarki = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00Z`) - Date.parse(`${b}T00:00Z`)) / 86_400_000;
const noYaz = (s: string | null) => (s ?? '').replace(/\s/g, '').toLocaleUpperCase('tr-TR');

export async function havuzOnerisi(depo: Depo, firmaId: string, havuz: HavuzBelgesi): Promise<HavuzOnerisi> {
  const t = havuz.tanima;
  if (!t) return { cari: null, mevcutGiderler: [], aliciUyarisi: null };
  const [cariler, firma] = await Promise.all([depo.listele('cari', { firmaId }), depo.getir('firma', firmaId)]);
  const vkn = t.satici.vergiNo;
  const cari = vkn ? (aktif(cariler).find((c) => (c.vergiNo ?? '').replace(/\D/g, '') === vkn) ?? null) : null;
  let mevcutGiderler: Gider[] = [];
  if (cari) {
    const giderler = aktif(await depo.listele('gider', { cariId: cari.id, firmaId }));
    const no = noYaz(t.faturaNo);
    const toplam = tanimaToplami(t) * (t.iade ? -1 : 1);
    mevcutGiderler = giderler.filter(
      (g) => (no && noYaz(g.faturaNo) === no) || (!g.faturaNo && Math.abs(g.toplam - toplam) <= 100 && (!t.tarih || gunFarki(g.tarih, t.tarih) <= 7)),
    );
  }
  const firmaVkn = (firma?.bilgiler?.vergiNo ?? '').replace(/\D/g, '');
  const aliciUyarisi =
    firmaVkn && t.aliciVergiNo && t.aliciVergiNo !== firmaVkn ? `Fatura başka bir vergi numarasına (${t.aliciVergiNo}) kesilmiş; firmanızın faturası olmayabilir.` : null;
  return { cari, mevcutGiderler, aliciUyarisi };
}

// ─── Onay ──────────────────────────────────────────────────────────

const BAGLANABILIR = new Set<string>(['gider', 'odeme', 'cekSenet', 'proje', 'bagimsizBolum', 'cari', 'katKarsiligiSozlesme', 'ilaveImalat', 'ustaSozlesmesi', 'hakedis', 'satis']);

/**
 * Havuzdaki belgeyi bir kayda bağlar (onay): belgenin bağı ve türü değişir, havuz kaydı "bağlandı" olur.
 * Asıl kayıt (gider, ödeme…) önceden kendi formunda, kendi yetkisiyle oluşturulmuş olmalıdır.
 */
export async function havuzBagla(
  depo: Depo,
  servis: KayitServisi,
  havuzId: string,
  bag: { tablo: BelgeBagi; id: string; tur?: Belge['tur']; ad?: string },
): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  if (!BAGLANABILIR.has(bag.tablo)) throw new IsKuraliHatasi('Belge bu kayda bağlanamaz.');
  await depo.islem(async () => {
    const satir = await havuzSatiriGetir(depo, firmaId, havuzId);
    if (!satir) throw new IsKuraliHatasi('Belge havuzda bulunamadı.');
    if (satir.havuz.durum !== 'bekliyor') throw new IsKuraliHatasi('Bu belge zaten bir kayda bağlanmış.');
    const kayit = await depo.getir(bag.tablo as KayitTabloAdi, bag.id);
    if (!kayit || (kayit as { firmaId?: string }).firmaId !== firmaId || kayit.iptal) throw new IsKuraliHatasi('Belgenin bağlanacağı kayıt bulunamadı.');
    await servis.guncelle('belge', satir.belge.id, {
      bagliTur: bag.tablo,
      bagliId: bag.id,
      ...(bag.tur ? { tur: bag.tur } : {}),
      ...(bag.ad?.trim() ? { ad: bag.ad.trim() } : {}),
    });
    await servis.guncelle('belgeHavuzu', havuzId, { durum: 'baglandi', sonuc: { tablo: bag.tablo, id: bag.id } });
  });
}

/** Gereksiz belge: havuzdan kalkar (iptal; dosyası da iptal olur, geçmişte ve yedekte kalır). */
export const havuzdanKaldir = (servis: KayitServisi, havuzId: string): Promise<void> => servis.iptal('belgeHavuzu', havuzId);

/** Havuz notu (örn. "Ali Usta'nın fişi, sorulacak"). */
export const havuzNotu = (servis: KayitServisi, havuzId: string, not: string) => servis.guncelle('belgeHavuzu', havuzId, { not: not.trim() });
