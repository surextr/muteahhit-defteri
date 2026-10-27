import { eksikBilgiler, sozlesmeMetni, sozlesmeToplami, type SozlesmeIcerigi, type SozlesmeMetni } from '../hesap/ustaSozlesmesi';
import type { Depo } from '../veri/depo';
import { YAPRAK_KALEM_KODLARI } from '../veri/sabit/hazirKalemKodlari';
import { HAKEDIS_SEKLI_ADI } from '../veri/sabit/hazirUstaTipleri';
import type { Cari, Firma, Proje, UstaSozlesmesi } from '../veri/tipler';
import { tamAdres } from './adres';
import { sistemKalemiHazirla } from './kalem';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import { ortakMaddeler, ustaTipiGetir } from './ustaTipi';

// Usta sözleşmesi: tipten taslak kurulur (kalemler, sorular, şartlar ve ortak maddeler kopyalanır), doldurulur,
// imzalanınca onaylanır. Taahhüttür, borç doğurmaz. Onaylıda her değişiklik gerekçe ister ve sürüm artar.
// Kalemlerin bütçe kalemleri projede yoksa kayıtta projeye eklenir.

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const tarihMi = (t: string | null) => t === null || TARIH.test(t);
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
 * Tipten taslak sözleşme kurar. Kalemler fiyatsız gelir; varsayılan cevabı olan sorular cevaplı, olmayanlar
 * cevapsız (eksik bilgi) gelir. Ortak maddelerden tipte kapalı olanlar alınmaz.
 */
export async function ustaSozlesmesiOlustur(
  depo: Depo,
  servis: KayitServisi,
  firma: Firma,
  g: { projeId: string; ustaTipiId: string; cariId: string },
): Promise<UstaSozlesmesi> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const [proje, cari, tip] = await Promise.all([depo.getir('proje', g.projeId), depo.getir('cari', g.cariId), ustaTipiGetir(depo, firmaId, g.ustaTipiId)]);
    if (!proje || proje.firmaId !== firmaId || proje.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
    if (!cari || cari.firmaId !== firmaId || cari.iptal) throw new IsKuraliHatasi('Ustayı (cari) seçin.');
    if (!tip) throw new IsKuraliHatasi('Usta tipini seçin.');
    const kapali = new Set(tip.kapaliOrtakMaddeler);
    const kalemler = tip.kalemler.map((k) => ({
      ad: k.ad,
      birim: k.birim,
      aciklama: k.aciklama,
      miktar: null,
      birimFiyat: 0,
      butceKalemiKodu: k.butceKalemiKodu ?? tip.butceKalemiKodu,
    }));
    return servis.ekle('ustaSozlesmesi', {
      projeId: proje.id,
      cariId: cari.id,
      ustaTipiId: tip.id,
      ustaTipiAdi: tip.ad,
      sablonSurumu: tip.sablonSurumu,
      sozlesmeTarihi: null,
      baslamaTarihi: null,
      bitisTarihi: null,
      fiyatlamaBirimi: tip.fiyatlamaBirimi,
      kalemler,
      sorumluluklar: tip.sorular.map((s) => ({ soru: s.soru, cevap: s.varsayilan, aciklama: '' })),
      ortakMaddeler: ortakMaddeler(firma)
        .filter((m) => !kapali.has(m.id))
        .map((m) => ({ id: m.id, baslik: m.metin, cevap: '' })),
      ozelSartlar: tip.ozelSartlar.join('\n'),
      hakedisSekli: tip.hakedisSekli,
      odemeKosulu: '',
      sgkTaahhudu: null,
      sozlesmeSurumu: 1,
      toplamTutar: 0,
      not: '',
    });
  });
}

function temizle(g: SozlesmeIcerigi): SozlesmeIcerigi {
  return {
    sozlesmeTarihi: g.sozlesmeTarihi || null,
    baslamaTarihi: g.baslamaTarihi || null,
    bitisTarihi: g.bitisTarihi || null,
    fiyatlamaBirimi: g.fiyatlamaBirimi.trim(),
    kalemler: g.kalemler
      .map((k) => ({ ...k, ad: k.ad.trim(), birim: k.birim.trim(), aciklama: k.aciklama.trim(), butceKalemiKodu: k.butceKalemiKodu || null }))
      .filter((k) => k.ad || k.birimFiyat > 0 || k.miktar !== null),
    sorumluluklar: g.sorumluluklar.map((r) => ({ soru: r.soru.trim(), cevap: r.cevap, aciklama: r.cevap === 'sozlesmede' ? r.aciklama.trim() : '' })),
    ortakMaddeler: g.ortakMaddeler.map((m) => ({ ...m, cevap: m.cevap.trim() })),
    ozelSartlar: g.ozelSartlar.trim(),
    hakedisSekli: g.hakedisSekli,
    odemeKosulu: g.odemeKosulu.trim(),
    sgkTaahhudu: g.sgkTaahhudu?.trim() || null,
    not: g.not.trim(),
  };
}

/** Kaydı engelleyen hatalar (eksik bilgi değil: eksik bilgiyle taslak kaydedilebilir, onaylanamaz). */
export function kayitHatalari(g: SozlesmeIcerigi): string[] {
  const h: string[] = [];
  if (![g.sozlesmeTarihi, g.baslamaTarihi, g.bitisTarihi].every(tarihMi)) h.push('Tarihleri gün.ay.yıl olarak seçin.');
  if (g.baslamaTarihi && g.bitisTarihi && g.bitisTarihi < g.baslamaTarihi) h.push('Bitiş tarihi başlama tarihinden önce olamaz.');
  if (!(g.hakedisSekli in HAKEDIS_SEKLI_ADI)) h.push('Hakediş şeklini seçin.');
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
    fiyatlamaBirimi: s.fiyatlamaBirimi,
    kalemler: s.kalemler.map((k) => ({ ...k })),
    sorumluluklar: s.sorumluluklar.map((r) => ({ ...r })),
    ortakMaddeler: s.ortakMaddeler.map((m) => ({ ...m })),
    ozelSartlar: s.ozelSartlar,
    hakedisSekli: s.hakedisSekli,
    odemeKosulu: s.odemeKosulu,
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
    const toplamTutar = sozlesmeToplami(g.kalemler).toplam;
    const guncel = await servis.guncelle('ustaSozlesmesi', id, { ...g, toplamTutar }, gerekce);
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

export async function ustaSozlesmesiIptal(servis: KayitServisi, id: string, gerekce?: string): Promise<void> {
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
