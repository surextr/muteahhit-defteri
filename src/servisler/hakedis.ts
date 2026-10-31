import { esikUstu, onayAkisi } from '../hesap/onay';
import { bransKisaAdi } from '../hesap/brans';
import {
  hakedisHatalari,
  hakedisTutarlari,
  ilaveSatiri,
  isButceKodu,
  oncekiDurum,
  teminatDurumu,
  type HakedisGirdisi,
  type TeminatDurumu,
  type OncekiDurum,
} from '../hesap/hakedis';
import type { Depo } from '../veri/depo';
import type { SozlesmeMetni } from '../hesap/ustaSozlesmesi';
import { hakedisBelgesi, oncekiOnaylilar } from '../hesap/hakedisBelgesi';
import { tamAdres } from './adres';
import type { Cari, Firma, Hakedis, HakedisSatiri, Kurus, TeminatIadesi, UstaSozlesmesi } from '../veri/tipler';
import { giderOlustur } from './gider';
import { sistemKalemiHazirla } from './kalem';
import { IsKuraliHatasi, YetkiHatasi, type KayitServisi } from './kayitServisi';
import { acikOdemeler, avansEslestir } from './odeme';
import { ustaSozlesmesiGetir } from './ustaSozlesmesi';

// Hakediş: imzalı usta sözleşmesinden çıkarılır. Taslak serbestçe düzenlenir; onaylanınca bir gider kaydı oluşur
// (borç ve maliyet oradan doğar, satırlar işlerin bütçe kalemlerine yazılır) ve avans mahsubu açık ödemelerden o
// gidere eşleştirilir. Onaylı hakediş değiştirilmez; iptal edilince gideri ve eşleştirmeleri de iptal olur, ödemeler
// yeniden açık avans olur.

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);

export interface HakedisBaglami {
  sozlesme: UstaSozlesmesi;
  cari: Cari;
  /** Sözleşmenin iptal edilmemiş hakedişleri, numara sırasıyla. */
  hakedisler: Hakedis[];
  /** Bu hakediş dışındakilerin toplamları. */
  onceki: OncekiDurum;
  /** Ustanın gidere bağlanmamış ödemeleri (avans) toplamı. */
  acikAvans: Kurus;
}

export async function sozlesmeHakedisleri(depo: Depo, firmaId: string, sozlesmeId: string): Promise<Hakedis[]> {
  return aktif(await depo.listele('hakedis', { sozlesmeId, firmaId })).sort((a, b) => a.no - b.no);
}

export async function hakedisGetir(depo: Depo, firmaId: string, id: string): Promise<Hakedis | null> {
  const h = await depo.getir('hakedis', id);
  return h && h.firmaId === firmaId && !h.iptal ? h : null;
}

/** Hakediş ekranının ihtiyaç duyduğu her şey; `haricId` düzenlenen hakediş (önceki toplamlara girmez). */
export async function hakedisBaglami(depo: Depo, firmaId: string, sozlesmeId: string, haricId: string | null = null): Promise<HakedisBaglami | null> {
  const sozlesme = await ustaSozlesmesiGetir(depo, firmaId, sozlesmeId);
  if (!sozlesme) return null;
  const cari = await depo.getir('cari', sozlesme.cariId);
  if (!cari) return null;
  const [hakedisler, avanslar] = await Promise.all([sozlesmeHakedisleri(depo, firmaId, sozlesmeId), acikOdemeler(depo, firmaId, sozlesme.cariId)]);
  return { sozlesme, cari, hakedisler, onceki: oncekiDurum(hakedisler, haricId), acikAvans: avanslar.reduce((t, a) => t + a.acik, 0) };
}

/**
 * Satırların tutarı sözleşmeden yeniden hesaplanır: metrajda kalemin birim fiyatı, aşamada aşamanın tutarı geçerlidir
 * (ekranın gönderdiği tutar değil). Tutarsız (boş) satırlar atılır.
 */
function satirlariSozlesmedenKur(satirlar: HakedisSatiri[], s: UstaSozlesmesi): HakedisSatiri[] {
  return satirlar
    .map((x) => {
      if (x.tur === 'metraj') {
        const k = s.kalemler.find((y) => y.id === x.kaynakId);
        if (!k || x.miktar === null) return x;
        return { ...x, birim: k.birim, birimFiyat: k.birimFiyat, tutar: Math.round(x.miktar * k.birimFiyat), butceKalemiKodu: k.butceKalemiKodu };
      }
      // Aşama ve tutar satırının bütçe kalemi, işin kalemlerindeki ilk bütçe kalemidir (boş bırakılmışsa).
      const butceKalemiKodu = x.butceKalemiKodu ?? isButceKodu(s.kalemler, x.ustaTipiId);
      if (x.tur === 'asama') {
        const a = s.bolumler.find((b) => b.ustaTipiId === x.ustaTipiId)?.asamalar.find((y) => y.id === x.kaynakId);
        return a ? { ...x, aciklama: a.ad, tutar: a.tutar, butceKalemiKodu } : x;
      }
      if (x.tur === 'ilave') return ilaveSatiri(x.ustaTipiId, { ...x, butceKalemiKodu });
      return { ...x, aciklama: x.aciklama.trim(), butceKalemiKodu };
    })
    .filter((x) => x.tutar !== 0 || (x.miktar ?? 0) !== 0);
}

/** Kaydın düzenlenebilir alanları (form girdisi). */
export function hakedisGirdisi(h: Hakedis): HakedisGirdisi {
  return {
    tarih: h.tarih,
    donemAsama: h.donemAsama,
    satirlar: h.satirlar.map((x) => ({ ...x })),
    kesintiler: h.kesintiler.map((x) => ({ ...x })),
    kdvOrani: h.kdvOrani,
    tevkifat: h.tevkifat,
    teminatOrani: h.teminatOrani,
    avansMahsubu: h.avansMahsubu,
    sgkPrimiDahil: h.sgkPrimiDahil,
    not: h.not,
  };
}

function temizle(g: HakedisGirdisi, s: UstaSozlesmesi): HakedisGirdisi {
  return {
    tarih: g.tarih,
    donemAsama: g.donemAsama.trim(),
    satirlar: satirlariSozlesmedenKur(g.satirlar, s),
    kesintiler: g.kesintiler.map((k) => ({ aciklama: k.aciklama.trim(), tutar: k.tutar })).filter((k) => k.aciklama || k.tutar),
    kdvOrani: g.kdvOrani,
    tevkifat: g.kdvOrani > 0 ? g.tevkifat : null,
    teminatOrani: g.teminatOrani,
    avansMahsubu: g.avansMahsubu,
    sgkPrimiDahil: g.sgkPrimiDahil,
    not: g.not.trim(),
  };
}

const isAdiBulucu = (s: UstaSozlesmesi) => (tipId: string) => bransKisaAdi(s.bolumler.find((b) => b.ustaTipiId === tipId)?.ustaTipiAdi ?? '');

function hesaplanmisAlanlar(g: HakedisGirdisi, s: UstaSozlesmesi) {
  const t = hakedisTutarlari(g, isAdiBulucu(s));
  return {
    brutTutar: t.brutTutar,
    kesintiToplam: t.kesintiToplam,
    kdvTutari: t.kdvTutari,
    tevkifatTutari: t.tevkifatTutari,
    borcTutari: t.borcTutari,
    teminatTutari: t.teminatTutari,
    netTutar: t.netTutar,
  };
}

async function denetle(depo: Depo, firmaId: string, sozlesmeId: string, girdi: HakedisGirdisi, haricId: string | null) {
  const b = await hakedisBaglami(depo, firmaId, sozlesmeId, haricId);
  if (!b) throw new IsKuraliHatasi('Sözleşme bulunamadı.');
  if (!b.sozlesme.onay) throw new IsKuraliHatasi('Hakediş yalnız imzalı (onaylı) sözleşmeden çıkarılır. Önce sözleşmeyi imzalandı olarak işaretleyin.');
  const g = temizle(girdi, b.sozlesme);
  const h = hakedisHatalari(g, b.sozlesme, b.onceki, b.acikAvans);
  if (h.length > 0) throw new IsKuraliHatasi(h.join(' '));
  return { b, g };
}

/** Taslak hakediş açar; numara sözleşmedeki sıradır. */
export async function hakedisOlustur(depo: Depo, servis: KayitServisi, sozlesmeId: string, girdi: HakedisGirdisi): Promise<Hakedis> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const { b, g } = await denetle(depo, firmaId, sozlesmeId, girdi, null);
    const tumu = await depo.listele('hakedis', { sozlesmeId, firmaId });
    // İptal edilenler de sayılır: numara bir kez verilir, yeniden kullanılmaz.
    const no = Math.max(0, ...tumu.map((x) => x.no ?? 0)) + 1;
    return servis.ekle('hakedis', {
      sozlesmeId,
      projeId: b.sozlesme.projeId,
      cariId: b.sozlesme.cariId,
      no,
      ...g,
      ...hesaplanmisAlanlar(g, b.sozlesme),
      giderId: null,
    });
  });
}

/** Taslağı değiştirir; onaylı hakediş değişmez (iptal edilip yeniden çıkarılır). */
export async function hakedisGuncelle(depo: Depo, servis: KayitServisi, id: string, girdi: HakedisGirdisi, gerekce?: string): Promise<Hakedis> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const h = await hakedisGetir(depo, firmaId, id);
    if (!h) throw new IsKuraliHatasi('Hakediş bulunamadı.');
    if (h.onay) throw new IsKuraliHatasi('Onaylı hakediş değiştirilemez. Yanlışsa iptal edip yeniden çıkarın.');
    const { b, g } = await denetle(depo, firmaId, h.sozlesmeId, girdi, id);
    return servis.guncelle('hakedis', id, { ...g, ...hesaplanmisAlanlar(g, b.sozlesme) }, gerekce);
  });
}

/**
 * Onay: gider kaydı oluşturulur (iş ve bütçe kalemi başına satır, KDV/tevkifat hakedişten), bütçe kalemleri projede
 * yoksa eklenir, avans mahsubu en eski açık ödemeden başlayarak gidere eşleştirilir.
 */
export async function hakedisOnayla(depo: Depo, servis: KayitServisi, id: string): Promise<Hakedis> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const h = await hakedisGetir(depo, firmaId, id);
    if (!h) throw new IsKuraliHatasi('Hakediş bulunamadı.');
    if (h.onay) throw new IsKuraliHatasi('Bu hakediş zaten onaylı.');
    // Onay akışı: eşik üstünde yalnız yönetici, kontrol adımı açıksa muhasebe kontrolünden sonra.
    const akis = onayAkisi(await servis.firmaAyarlari());
    if (esikUstu(akis, 'hakedis', h.borcTutari)) {
      if ((await servis.rol()) !== 'yonetici') throw new YetkiHatasi('Bu tutardaki hakedişi yönetici onaylar; muhasebe kontrol edebilir.');
      if (akis!.kontrol && !h.kontrol) throw new IsKuraliHatasi('Önce muhasebe hakedişi kontrol etmeli.');
    }
    // Sözleşme ya da avanslar taslaktan sonra değişmiş olabilir: aynı denetim yeniden yapılır.
    const { b, g } = await denetle(depo, firmaId, h.sozlesmeId, hakedisGirdisi(h), id);
    const t = hakedisTutarlari(g, isAdiBulucu(b.sozlesme));

    const satirlar = [];
    for (const s of t.giderSatirlari) {
      const kalem = s.butceKalemiKodu ? await sistemKalemiHazirla(depo, servis, b.sozlesme.projeId, s.butceKalemiKodu) : null;
      satirlar.push({ kalemId: kalem?.id ?? null, aciklama: s.aciklama, miktar: null, birim: null, tutar: s.tutar, kdvDahil: false, kdvOrani: g.kdvOrani, tevkifat: g.tevkifat });
    }
    const gider = await giderOlustur(
      depo,
      servis,
      {
        tarih: g.tarih,
        projeId: b.sozlesme.projeId,
        cariId: b.sozlesme.cariId,
        faturaNo: null,
        vadeTarihi: null,
        aciklama: `Hakediş ${h.no} · ${b.sozlesme.ustaTipiAdi}${g.donemAsama ? ` · ${g.donemAsama}` : ''}`,
        satirlar,
      },
      null,
      { hakedisId: h.id },
    );

    let kalan = g.avansMahsubu;
    for (const { odeme, acik } of await acikOdemeler(depo, firmaId, b.sozlesme.cariId)) {
      if (kalan <= 0) break;
      const tutar = Math.min(acik, kalan);
      await avansEslestir(depo, servis, odeme.id, [{ giderId: gider.id, tutar }]);
      kalan -= tutar;
    }
    if (kalan > 0) throw new IsKuraliHatasi('Açık avans, mahsup edilecek tutara yetmiyor.');

    await servis.guncelle('hakedis', id, { ...g, ...hesaplanmisAlanlar(g, b.sozlesme), giderId: gider.id });
    await servis.onayla('hakedis', id);
    return (await hakedisGetir(depo, firmaId, id))!;
  });
}

/** İptal: oluşturduğu gider, gider satırları ve eşleştirmeler de iptal olur; mahsup edilen ödemeler yeniden açık avans olur. */
export async function hakedisIptal(servis: KayitServisi, id: string, gerekce?: string): Promise<void> {
  await servis.iptal('hakedis', id, gerekce);
}

/** Sözleşmenin onaylı hakedişlerinin toplamları (sözleşme ekranındaki özet). */
export function hakedisOzeti(hakedisler: Hakedis[]): { onayli: number; brut: Kurus; borc: Kurus; teminat: Kurus } {
  const onayli = hakedisler.filter((h) => h.onay);
  return {
    onayli: onayli.length,
    brut: onayli.reduce((t, h) => t + h.brutTutar - h.kesintiToplam, 0),
    borc: onayli.reduce((t, h) => t + h.borcTutari, 0),
    teminat: onayli.reduce((t, h) => t + h.teminatTutari, 0),
  };
}

/**
 * Aşama önerisi için binanın katları, aşağıdan yukarı: "Temel" ve her kat için "<kat> betonu"; birden çok blokta
 * blok adıyla ("A Blok 1. kat betonu"). Tutarlar boş gelir, kullanıcı yazar.
 */
export async function katAsamaOnerisi(depo: Depo, firmaId: string, projeId: string): Promise<string[]> {
  const [bloklar, katlar] = await Promise.all([depo.listele('blok', { projeId, firmaId }), depo.listele('kat', { projeId, firmaId })]);
  const aktifBloklar = aktif(bloklar).sort((a, b) => a.sira - b.sira);
  const cokBlok = aktifBloklar.length > 1;
  const adlar = ['Temel'];
  for (const blok of aktifBloklar) {
    for (const kat of aktif(katlar).filter((k) => k.blokId === blok.id).sort((a, b) => a.sira - b.sira)) {
      adlar.push(`${cokBlok ? `${blok.ad} ` : ''}${kat.ad} betonu`);
    }
  }
  return adlar;
}

// ─── Teminat iadesi ────────────────────────────────────────────────

export async function sozlesmeTeminati(depo: Depo, firmaId: string, sozlesmeId: string): Promise<TeminatDurumu & { iadeler: TeminatIadesi[] }> {
  const [hakedisler, iadeler] = await Promise.all([depo.listele('hakedis', { sozlesmeId, firmaId }), depo.listele('teminatIadesi', { sozlesmeId, firmaId })]);
  const aktifIadeler = aktif(iadeler).sort((a, b) => a.tarih.localeCompare(b.tarih));
  return { ...teminatDurumu(hakedisler, aktifIadeler), iadeler: aktifIadeler };
}

/**
 * Bekleyen teminatın tamamını ya da bir kısmını serbest bırakır (iş teslim alındı). Borç değişmez; para ödeme
 * ekranından ödenir. Bekleyenden fazlası serbest bırakılamaz.
 */
export async function teminatSerbestBirak(
  depo: Depo,
  servis: KayitServisi,
  sozlesmeId: string,
  g: { tarih: string; tutar: Kurus; aciklama: string },
): Promise<TeminatIadesi> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const s = await ustaSozlesmesiGetir(depo, firmaId, sozlesmeId);
    if (!s) throw new IsKuraliHatasi('Sözleşme bulunamadı.');
    const d = await sozlesmeTeminati(depo, firmaId, sozlesmeId);
    const h: string[] = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.tarih)) h.push('Tarihi seçin.');
    if (!Number.isInteger(g.tutar) || g.tutar <= 0) h.push('Tutar sıfırdan büyük olmalı.');
    else if (g.tutar > d.bekleyen) h.push(`Bekleyen teminat ${(d.bekleyen / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL; fazlası serbest bırakılamaz.`);
    if (h.length > 0) throw new IsKuraliHatasi(h.join(' '));
    return servis.ekle('teminatIadesi', { sozlesmeId, cariId: s.cariId, tarih: g.tarih, tutar: g.tutar, aciklama: g.aciklama.trim() });
  });
}

export async function teminatIadesiIptal(servis: KayitServisi, id: string, gerekce?: string): Promise<void> {
  await servis.iptal('teminatIadesi', id, gerekce);
}

// ─── Yazdırılabilir belge ──────────────────────────────────────────

export interface HakedisBelgesiVerisi {
  hakedis: Hakedis;
  metin: SozlesmeMetni;
}

/** Hakediş belgesi: taraflar sözleşmeden, "önceki" yalnız numarası küçük onaylı hakedişler. */
export async function hakedisBelgesiGetir(depo: Depo, firma: Firma, id: string): Promise<HakedisBelgesiVerisi | null> {
  const h = await hakedisGetir(depo, firma.id, id);
  if (!h) return null;
  const [sozlesme, cari, proje, hepsi] = await Promise.all([
    ustaSozlesmesiGetir(depo, firma.id, h.sozlesmeId),
    depo.getir('cari', h.cariId),
    depo.getir('proje', h.projeId),
    depo.listele('hakedis', { sozlesmeId: h.sozlesmeId, firmaId: firma.id }),
  ]);
  if (!sozlesme || !cari || !proje) return null;
  return {
    hakedis: h,
    metin: hakedisBelgesi(h, { sozlesme, firma, cari, proje, projeAdresi: tamAdres(proje), oncekiler: oncekiOnaylilar(hepsi, h.no) }),
  };
}
