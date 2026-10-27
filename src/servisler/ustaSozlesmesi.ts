import {
  TAKIP_YONTEMI_ADI,
  anaIsAlanlari,
  bolumEkle,
  bosIcerik,
  eksikBilgiler,
  sozlesmeMetni,
  sozlesmeTahminiTutari,
  type SozlesmeIcerigi,
  type SozlesmeMetni,
} from '../hesap/ustaSozlesmesi';
import type { Depo } from '../veri/depo';
import { YAPRAK_KALEM_KODLARI } from '../veri/sabit/hazirKalemKodlari';
import { HAKEDIS_SEKLI_ADI } from '../veri/sabit/hazirUstaTipleri';
import type { Cari, CariRol, Firma, Proje, UstaSozlesmesi, UstaTipi } from '../veri/tipler';
import { tamAdres } from './adres';
import { CARI_ROL_ADI, bransliMi } from './cari';
import { sistemKalemiHazirla } from './kalem';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import { ortakMaddeler, ustaTipiGetir } from './ustaTipi';

// Usta sözleşmesi: tipten taslak kurulur (kalemler, sorular, şartlar ve ortak maddeler kopyalanır), doldurulur,
// imzalanınca onaylanır. Taahhüttür, borç doğurmaz. Onaylıda her değişiklik gerekçe ister ve sürüm artar.
// Kalemlerin bütçe kalemleri projede yoksa kayıtta projeye eklenir.

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const tarihMi = (t: string | null) => t === null || TARIH.test(t);
const CARI_ROL_SIRASI = Object.keys(CARI_ROL_ADI) as CariRol[];
const YAPRAK = new Set(YAPRAK_KALEM_KODLARI.map((k) => k.kod));

export async function ustaSozlesmesiGetir(depo: Depo, firmaId: string, id: string): Promise<UstaSozlesmesi | null> {
  const s = await depo.getir('ustaSozlesmesi', id);
  return s && s.firmaId === firmaId && !s.iptal ? s : null;
}

export interface SozlesmeOzeti {
  sozlesme: UstaSozlesmesi;
  cariAdi: string;
  eksikSayisi: number;
}

/** Projenin sözleşmeleri, en yeni önce. */
export async function projeSozlesmeleri(depo: Depo, firmaId: string, projeId: string): Promise<SozlesmeOzeti[]> {
  const [sozlesmeler, cariler] = await Promise.all([depo.listele('ustaSozlesmesi', { firmaId, projeId }), depo.listele('cari', { firmaId })]);
  const ad = new Map(cariler.map((c) => [c.id, c.ad]));
  return aktif(sozlesmeler)
    .sort((a, b) => b.olusturmaZamani.localeCompare(a.olusturmaZamani))
    .map((s) => ({ sozlesme: s, cariAdi: ad.get(s.cariId) ?? '?', eksikSayisi: eksikBilgiler(s).length }));
}

/** Cariye ait sözleşmeler (cari ekranı için), en yeni önce. */
export async function cariSozlesmeleri(depo: Depo, firmaId: string, cariId: string): Promise<UstaSozlesmesi[]> {
  return aktif(await depo.listele('ustaSozlesmesi', { firmaId, cariId })).sort((a, b) => b.olusturmaZamani.localeCompare(a.olusturmaZamani));
}

/**
 * Tiplerden taslak sözleşme kurar; birden çok tip toplu sözleşmedir (ilki ana iş). Her tipin kalemleri fiyatsız,
 * varsayılan cevabı olan soruları cevaplı, olmayanları cevapsız (eksik bilgi) gelir. Ortak maddelerden yalnız bütün
 * tiplerde kapalı olanlar alınmaz. Kart bu tipleri (branşları) bilmiyorsa öğrenir.
 */
export async function ustaSozlesmesiOlustur(
  depo: Depo,
  servis: KayitServisi,
  firma: Firma,
  g: { projeId: string; ustaTipiIdleri: string[]; cariId: string },
): Promise<UstaSozlesmesi> {
  const firmaId = servis.oturum.firmaId;
  const tipIdleri = [...new Set(g.ustaTipiIdleri)];
  return depo.islem(async () => {
    const [proje, cari, ...tipler] = await Promise.all([
      depo.getir('proje', g.projeId),
      depo.getir('cari', g.cariId),
      ...tipIdleri.map((id) => ustaTipiGetir(depo, firmaId, id)),
    ]);
    if (!proje || proje.firmaId !== firmaId || proje.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
    if (!cari || cari.firmaId !== firmaId || cari.iptal) throw new IsKuraliHatasi('Ustayı ya da taşeronu seçin.');
    if (tipler.length === 0) throw new IsKuraliHatasi('En az bir usta tipi (iş) seçin.');
    if (tipler.some((t) => !t)) throw new IsKuraliHatasi('Seçilen usta tiplerinden biri bulunamadı.');
    const gecerli = tipler as UstaTipi[];
    // Usta/taşeron rolü yoksa (örn. tedarikçi kartıyla sözleşme) usta rolü de eklenir; ana branş değişmez.
    const eksikBranslar = gecerli.filter((t) => !cari.ustaTipiIdleri.includes(t.id));
    if (eksikBranslar.length > 0) {
      const roller = bransliMi(cari.roller) ? cari.roller : CARI_ROL_SIRASI.filter((r) => r === 'usta' || cari.roller.includes(r));
      await servis.guncelle(
        'cari',
        cari.id,
        { roller, ustaTipiIdleri: [...cari.ustaTipiIdleri, ...eksikBranslar.map((t) => t.id)] },
        `${eksikBranslar.map((t) => t.ad).join(', ')} sözleşmesiyle branş eklendi.`,
      );
    }
    const maddeler = ortakMaddeler(firma);
    const icerik = gecerli.reduce((ic, tip) => bolumEkle(ic, tip, maddeler), bosIcerik());
    return servis.ekle('ustaSozlesmesi', {
      projeId: proje.id,
      cariId: cari.id,
      ...icerik,
      ...anaIsAlanlari(icerik.bolumler),
      sozlesmeSurumu: 1,
      toplamTutar: 0,
    });
  });
}

function temizle(g: SozlesmeIcerigi): SozlesmeIcerigi {
  return {
    sozlesmeTarihi: g.sozlesmeTarihi || null,
    baslamaTarihi: g.baslamaTarihi || null,
    bitisTarihi: g.bitisTarihi || null,
    bolumler: g.bolumler.map((b) => ({
      ...b,
      ustaTipiAdi: b.ustaTipiAdi.trim(),
      // Aşama listesi yalnız aşamalı takipte saklanır; boş satırlar atılır.
      asamalar: b.takipYontemi === 'asama' ? b.asamalar.map((a) => ({ ...a, ad: a.ad.trim() })).filter((a) => a.ad || a.tutar > 0) : [],
    })),
    fiyatlamaBirimi: g.fiyatlamaBirimi.trim(),
    kalemler: g.kalemler
      .map((k) => ({ ...k, ad: k.ad.trim(), birim: k.birim.trim(), aciklama: k.aciklama.trim(), butceKalemiKodu: k.butceKalemiKodu || null }))
      .filter((k) => k.ad || k.birimFiyat > 0 || k.miktar !== null),
    sorumluluklar: g.sorumluluklar.map((r) => ({ ustaTipiId: r.ustaTipiId, soru: r.soru.trim(), cevap: r.cevap, aciklama: r.cevap === 'sozlesmede' ? r.aciklama.trim() : '' })),
    ortakMaddeler: g.ortakMaddeler.map((m) => ({ ...m, cevap: m.cevap.trim() })),
    ozelSartlar: g.ozelSartlar.trim(),
    odemeKosulu: g.odemeKosulu.trim(),
    teminatOrani: g.teminatOrani,
    sgkTaahhudu: g.sgkTaahhudu?.trim() || null,
    not: g.not.trim(),
  };
}

/** Kaydı engelleyen hatalar (eksik bilgi değil: eksik bilgiyle taslak kaydedilebilir, onaylanamaz). */
export function kayitHatalari(g: SozlesmeIcerigi): string[] {
  const h: string[] = [];
  if (![g.sozlesmeTarihi, g.baslamaTarihi, g.bitisTarihi].every(tarihMi)) h.push('Tarihleri gün.ay.yıl olarak seçin.');
  if (g.baslamaTarihi && g.bitisTarihi && g.bitisTarihi < g.baslamaTarihi) h.push('Bitiş tarihi başlama tarihinden önce olamaz.');
  const bolumler = new Set(g.bolumler.map((b) => b.ustaTipiId));
  if (g.bolumler.length === 0) h.push('Sözleşmede en az bir iş (usta tipi) olmalı.');
  if (bolumler.size !== g.bolumler.length) h.push('Aynı iş sözleşmede iki kez olamaz.');
  for (const b of g.bolumler) {
    const ad = b.ustaTipiAdi || 'İş';
    if (!(b.hakedisSekli in HAKEDIS_SEKLI_ADI)) h.push(`${ad} için hakediş şeklini seçin.`);
    if (!(b.takipYontemi in TAKIP_YONTEMI_ADI)) h.push(`${ad} için takip yöntemini seçin.`);
    if (b.asamalar.some((a) => !a.ad)) h.push(`${ad}: her aşamanın adını yazın.`);
    if (b.asamalar.some((a) => !Number.isInteger(a.tutar) || a.tutar < 0)) h.push(`${ad}: aşama tutarı geçersiz.`);
    if (new Set(b.asamalar.map((a) => a.id)).size !== b.asamalar.length) h.push(`${ad}: aşama kimlikleri tekrarlanıyor.`);
  }
  if (!Number.isFinite(g.teminatOrani) || g.teminatOrani < 0 || g.teminatOrani > 50) h.push('Teminat oranı %0 ile %50 arasında olmalı.');
  if (new Set(g.kalemler.map((k) => k.id)).size !== g.kalemler.length) h.push('Kalem kimlikleri tekrarlanıyor.');
  if ([...g.kalemler, ...g.sorumluluklar].some((x) => !bolumler.has(x.ustaTipiId))) h.push('Kalem ya da sorumluluk sözleşmedeki bir işe bağlı değil.');
  for (const k of g.kalemler) {
    if (!k.ad) h.push('Her kalemin adını yazın.');
    if (!k.birim) h.push(`"${k.ad || 'Adsız'}" kaleminin birimini yazın.`);
    if (!Number.isInteger(k.birimFiyat) || k.birimFiyat < 0) h.push(`"${k.ad || 'Adsız'}" kaleminin birim fiyatı geçersiz.`);
    if (k.miktar !== null && (!Number.isFinite(k.miktar) || k.miktar < 0)) h.push(`"${k.ad || 'Adsız'}" kaleminin miktarı geçersiz.`);
    if (k.butceKalemiKodu && !YAPRAK.has(k.butceKalemiKodu)) h.push(`"${k.ad || 'Adsız'}" için bütçe kalemi olarak alt kalem seçin.`);
  }
  return [...new Set(h)];
}

/** Sözleşmenin düzenlenebilir alanları, forma doldurmak için. */
export function sozlesmeIcerigi(s: UstaSozlesmesi): SozlesmeIcerigi {
  return {
    sozlesmeTarihi: s.sozlesmeTarihi,
    baslamaTarihi: s.baslamaTarihi,
    bitisTarihi: s.bitisTarihi,
    bolumler: s.bolumler.map((b) => ({ ...b, asamalar: b.asamalar.map((a) => ({ ...a })) })),
    fiyatlamaBirimi: s.fiyatlamaBirimi,
    kalemler: s.kalemler.map((k) => ({ ...k })),
    sorumluluklar: s.sorumluluklar.map((r) => ({ ...r })),
    ortakMaddeler: s.ortakMaddeler.map((m) => ({ ...m })),
    ozelSartlar: s.ozelSartlar,
    odemeKosulu: s.odemeKosulu,
    teminatOrani: s.teminatOrani,
    sgkTaahhudu: s.sgkTaahhudu,
    not: s.not,
  };
}

/**
 * Kaydeder. Taslak eksik bilgiyle de kaydedilir. Onaylı (imzalı) sözleşmede gerekçe gerekir, sürüm bir artar
 * ve eksik bilgi bırakılamaz. Kalemlerin bütçe kalemleri projede yoksa eklenir.
 */
export async function ustaSozlesmesiKaydet(depo: Depo, servis: KayitServisi, id: string, girdi: SozlesmeIcerigi, gerekce?: string): Promise<UstaSozlesmesi> {
  const g = temizle(girdi);
  const h = kayitHatalari(g);
  if (h.length > 0) throw new IsKuraliHatasi(h.join(' '));
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const s = await ustaSozlesmesiGetir(depo, firmaId, id);
    if (!s) throw new IsKuraliHatasi('Sözleşme bulunamadı.');
    if (s.onay) {
      const eksik = eksikBilgiler(g);
      if (eksik.length > 0) throw new IsKuraliHatasi(`İmzalı sözleşmede eksik bilgi bırakılamaz: ${eksik.join(' ')}`);
    }
    for (const kod of new Set(g.kalemler.map((k) => k.butceKalemiKodu).filter((k): k is string => !!k))) {
      await sistemKalemiHazirla(depo, servis, s.projeId, kod);
    }
    const toplamTutar = sozlesmeTahminiTutari(g).toplam;
    const guncel = await servis.guncelle('ustaSozlesmesi', id, { ...g, ...anaIsAlanlari(g.bolumler), toplamTutar }, gerekce);
    // Değişiklik olduysa (servis aynı kaydı döndürmediyse) imzalı sözleşmenin sürümü artar.
    if (s.onay && guncel.surum !== s.surum) return servis.guncelle('ustaSozlesmesi', id, { sozlesmeSurumu: s.sozlesmeSurumu + 1 }, gerekce);
    return guncel;
  });
}

/** İmzalanan sözleşme onaylanır; eksik bilgi varsa onaylanamaz. */
export async function ustaSozlesmesiOnayla(depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  const s = await ustaSozlesmesiGetir(depo, servis.oturum.firmaId, id);
  if (!s) throw new IsKuraliHatasi('Sözleşme bulunamadı.');
  const eksik = eksikBilgiler(s);
  if (eksik.length > 0) throw new IsKuraliHatasi(`Önce eksik bilgileri tamamlayın: ${eksik.join(' ')}`);
  await servis.onayla('ustaSozlesmesi', id);
}

/** Hakedişi olan sözleşme iptal edilmez (borç ve maliyet hakedişlerden doğdu); önce hakedişler iptal edilir. */
export async function ustaSozlesmesiIptal(depo: Depo, servis: KayitServisi, id: string, gerekce?: string): Promise<void> {
  const hakedisler = (await depo.listele('hakedis', { sozlesmeId: id, firmaId: servis.oturum.firmaId })).filter((h) => h.iptal === null);
  if (hakedisler.length > 0) throw new IsKuraliHatasi(`Bu sözleşmenin ${hakedisler.length} hakedişi var. Önce hakedişleri iptal edin.`);
  await servis.iptal('ustaSozlesmesi', id, gerekce);
}

export interface SozlesmeBelgesi {
  sozlesme: UstaSozlesmesi;
  metin: SozlesmeMetni;
  proje: Proje;
  cari: Cari;
}

/** Yazdırılacak sözleşme: metin, firma bilgileri (logo ekranda firmadan alınır), proje ve cari. */
export async function sozlesmeBelgesiGetir(depo: Depo, firma: Firma, id: string): Promise<SozlesmeBelgesi | null> {
  const s = await ustaSozlesmesiGetir(depo, firma.id, id);
  if (!s) return null;
  const [proje, cari] = await Promise.all([depo.getir('proje', s.projeId), depo.getir('cari', s.cariId)]);
  if (!proje || !cari) return null;
  return { sozlesme: s, proje, cari, metin: sozlesmeMetni(s, { firma, cari, proje, projeAdresi: tamAdres(proje) }) };
}
