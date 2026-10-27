import type { Hakedis, HakedisKesintisi, HakedisSatiri, Kurus, SozlesmeAsamasi, SozlesmeBolumu, SozlesmeKalemi, Tarih, Tevkifat } from '../veri/tipler';
import { bransKisaAdi } from './brans';
import { satirHesapla, tevkifatGecerli } from './gider';
import { tlYaz } from './para';
import { sayiYaz } from './sayi';

// Hakediş hesabı. Saf fonksiyonlar; veritabanını bilmez.
// Brüt = satırlar (metrajda miktar × birim fiyat, aşamada aşama tutarı, tutarda yazılan). Kesintiler brütten düşer ve
// maliyeti de düşürür (işlere oranla dağıtılır). KDV ve tevkifat kesinti sonrası tutar üzerinden, gider satırı başına
// gider modülüyle aynı yuvarlamayla hesaplanır; böylece onayla oluşan giderin borcu hakedişin borcuyla aynıdır.
// Teminat borcun içindedir ama iş bitimine kadar ödenmez; avans mahsubu açık ödemelerden kapanan kısımdır.

/** Ekran ve servis girdisi; tutarlar ve gider bağı kayıtta hesaplanır. */
export interface HakedisGirdisi {
  tarih: Tarih;
  donemAsama: string;
  satirlar: HakedisSatiri[];
  kesintiler: HakedisKesintisi[];
  kdvOrani: number;
  tevkifat: Tevkifat | null;
  teminatOrani: number;
  avansMahsubu: Kurus;
  sgkPrimiDahil: boolean;
  not: string;
}

/** Onayla oluşacak gider satırı: iş ve bütçe kalemi başına bir satır, KDV hariç ve kesinti düşülmüş. */
export interface HakedisGiderSatiri {
  ustaTipiId: string;
  butceKalemiKodu: string | null;
  aciklama: string;
  tutar: Kurus;
}

export interface HakedisTutarlari {
  brutTutar: Kurus;
  kesintiToplam: Kurus;
  kdvTutari: Kurus;
  tevkifatTutari: Kurus;
  borcTutari: Kurus;
  teminatTutari: Kurus;
  netTutar: Kurus;
  giderSatirlari: HakedisGiderSatiri[];
}

/** Toplamı `toplam` olan tamsayıları ağırlıklara oranla dağıtır (en büyük kalan yöntemi); ağırlıklar artı. */
export function oranlaDagit(toplam: Kurus, agirliklar: Kurus[]): Kurus[] {
  const payda = agirliklar.reduce((t, a) => t + a, 0);
  if (payda <= 0 || toplam === 0) return agirliklar.map(() => 0);
  const kesirli = agirliklar.map((a) => (toplam * a) / payda);
  const sonuc = kesirli.map(Math.floor);
  let kalan = toplam - sonuc.reduce((t, x) => t + x, 0);
  const sira = kesirli.map((k, i) => ({ i, artik: k - Math.floor(k) })).sort((a, b) => b.artik - a.artik || a.i - b.i);
  for (const { i } of sira) {
    if (kalan <= 0) break;
    sonuc[i]! += 1;
    kalan--;
  }
  return sonuc;
}

/** Hakediş tutarları ve onayla oluşacak gider satırları. `isAdi` iş (usta tipi) kimliğinden kısa ad verir. */
export function hakedisTutarlari(
  g: Pick<HakedisGirdisi, 'satirlar' | 'kesintiler' | 'kdvOrani' | 'tevkifat' | 'teminatOrani' | 'avansMahsubu'>,
  isAdi: (ustaTipiId: string) => string = () => '',
): HakedisTutarlari {
  const brutTutar = g.satirlar.reduce((t, s) => t + s.tutar, 0);
  const kesintiToplam = g.kesintiler.reduce((t, k) => t + k.tutar, 0);

  // İş ve bütçe kalemine göre gruplanır; sıra satırların sırasıdır.
  const gruplar = new Map<string, HakedisGiderSatiri & { adlar: string[] }>();
  for (const s of g.satirlar) {
    if (s.tutar <= 0) continue;
    const anahtar = `${s.ustaTipiId}|${s.butceKalemiKodu ?? ''}`;
    const grup = gruplar.get(anahtar) ?? { ustaTipiId: s.ustaTipiId, butceKalemiKodu: s.butceKalemiKodu, aciklama: '', tutar: 0, adlar: [] };
    grup.tutar += s.tutar;
    grup.adlar.push(s.aciklama);
    gruplar.set(anahtar, grup);
  }
  const liste = [...gruplar.values()];
  const kesintiPaylari = kesintiToplam > 0 && kesintiToplam < brutTutar ? oranlaDagit(kesintiToplam, liste.map((x) => x.tutar)) : liste.map(() => 0);
  const giderSatirlari: HakedisGiderSatiri[] = liste
    .map((x, i) => {
      const ad = isAdi(x.ustaTipiId);
      const ayrinti = x.adlar.filter(Boolean).join(', ');
      const aciklama = `${ad ? `${ad} hakedişi` : 'Hakediş'}${ayrinti ? `: ${ayrinti}` : ''}`;
      return { ustaTipiId: x.ustaTipiId, butceKalemiKodu: x.butceKalemiKodu, aciklama: aciklama.length > 160 ? `${aciklama.slice(0, 157)}…` : aciklama, tutar: x.tutar - kesintiPaylari[i]! };
    })
    .filter((x) => x.tutar > 0);

  let kdvTutari = 0;
  let tevkifatTutari = 0;
  let toplam = 0;
  for (const s of giderSatirlari) {
    const t = satirHesapla({ tutar: s.tutar, kdvDahil: false, kdvOrani: g.kdvOrani, tevkifat: g.kdvOrani > 0 ? g.tevkifat : null });
    kdvTutari += t.kdvTutari;
    tevkifatTutari += t.tevkifatTutari;
    toplam += t.toplam;
  }
  const borcTutari = toplam - tevkifatTutari;
  const teminatTutari = Math.round(((brutTutar - kesintiToplam) * Math.max(0, g.teminatOrani)) / 100);
  return {
    brutTutar,
    kesintiToplam,
    kdvTutari,
    tevkifatTutari,
    borcTutari,
    teminatTutari: Math.max(0, teminatTutari),
    netTutar: borcTutari - Math.max(0, teminatTutari) - g.avansMahsubu,
    giderSatirlari,
  };
}

// ─── Önceki hakedişler ─────────────────────────────────────────────

export interface OncekiDurum {
  /** Sözleşme kalemi kimliği → önceki hakedişlerde yazılan toplam miktar. */
  kalemMiktari: Map<string, number>;
  /** Önceki hakedişlerde ödenen aşamalar. */
  asamalar: Set<string>;
  /** İş (usta tipi) → önceki hakedişlerdeki brüt toplam. */
  isTutari: Map<string, Kurus>;
}

/** Aynı sözleşmenin iptal edilmemiş diğer hakedişleri (taslaklar dahil, `haricId` hariç). */
export function oncekiDurum(hakedisler: Pick<Hakedis, 'id' | 'iptal' | 'satirlar'>[], haricId?: string | null): OncekiDurum {
  const d: OncekiDurum = { kalemMiktari: new Map(), asamalar: new Set(), isTutari: new Map() };
  for (const h of hakedisler) {
    if (h.iptal !== null || h.id === haricId) continue;
    for (const s of h.satirlar) {
      d.isTutari.set(s.ustaTipiId, (d.isTutari.get(s.ustaTipiId) ?? 0) + s.tutar);
      if (s.tur === 'metraj' && s.kaynakId && s.miktar !== null) d.kalemMiktari.set(s.kaynakId, (d.kalemMiktari.get(s.kaynakId) ?? 0) + s.miktar);
      if (s.tur === 'asama' && s.kaynakId) d.asamalar.add(s.kaynakId);
    }
  }
  return d;
}

// ─── Satır kurucuları ──────────────────────────────────────────────

/** Bölümün kalemlerinden ilk bütçe kalemi kodu (aşama ve tutar satırları için). */
export function isButceKodu(kalemler: Pick<SozlesmeKalemi, 'ustaTipiId' | 'butceKalemiKodu'>[], ustaTipiId: string): string | null {
  return kalemler.find((k) => k.ustaTipiId === ustaTipiId && k.butceKalemiKodu)?.butceKalemiKodu ?? null;
}

/** Metraj satırı: tutar = miktar × birim fiyat (kuruşa yuvarlanır). */
export function metrajSatiri(k: SozlesmeKalemi, miktar: number): HakedisSatiri {
  return {
    ustaTipiId: k.ustaTipiId,
    tur: 'metraj',
    kaynakId: k.id,
    aciklama: `${k.ad} ${sayiYaz(miktar)} ${k.birim}`.trim(),
    miktar,
    birim: k.birim,
    birimFiyat: k.birimFiyat,
    tutar: Math.round(miktar * k.birimFiyat),
    butceKalemiKodu: k.butceKalemiKodu,
  };
}

export function asamaSatiri(ustaTipiId: string, a: SozlesmeAsamasi, butceKalemiKodu: string | null): HakedisSatiri {
  return { ustaTipiId, tur: 'asama', kaynakId: a.id, aciklama: a.ad, miktar: null, birim: '', birimFiyat: null, tutar: a.tutar, butceKalemiKodu };
}

export function tutarSatiri(ustaTipiId: string, tutar: Kurus, aciklama: string, butceKalemiKodu: string | null): HakedisSatiri {
  return { ustaTipiId, tur: 'tutar', kaynakId: null, aciklama: aciklama.trim(), miktar: null, birim: '', birimFiyat: null, tutar, butceKalemiKodu };
}

// ─── Denetim ───────────────────────────────────────────────────────

export interface HakedisSozlesmesi {
  bolumler: SozlesmeBolumu[];
  kalemler: SozlesmeKalemi[];
}

const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Kaydı engelleyen hatalar. Satırların kaynağı sözleşmede olmalı; ödenmiş aşama tekrar ödenmez; kesinti brütten
 * küçük, avans mahsubu ödenecek tutardan büyük olamaz.
 */
export function hakedisHatalari(g: HakedisGirdisi, s: HakedisSozlesmesi, onceki: OncekiDurum, acikAvans: Kurus): string[] {
  const h: string[] = [];
  if (!TARIH.test(g.tarih)) h.push('Hakediş tarihini seçin.');
  const isler = new Map(s.bolumler.map((b) => [b.ustaTipiId, b]));
  const satirlar = g.satirlar.filter((x) => x.tutar !== 0 || (x.miktar ?? 0) !== 0);
  if (satirlar.length === 0) h.push('En az bir iş için miktar, aşama ya da tutar girin.');
  const asamalar = new Set<string>();
  for (const x of satirlar) {
    const b = isler.get(x.ustaTipiId);
    if (!b) {
      h.push('Satırlardan biri sözleşmedeki bir işe bağlı değil.');
      continue;
    }
    const ad = bransKisaAdi(b.ustaTipiAdi);
    if (!Number.isInteger(x.tutar) || x.tutar < 0) h.push(`${ad}: tutar geçersiz.`);
    if (x.tur === 'metraj') {
      if (!s.kalemler.some((k) => k.id === x.kaynakId && k.ustaTipiId === x.ustaTipiId)) h.push(`${ad}: kalem sözleşmede yok.`);
      if (x.miktar === null || !Number.isFinite(x.miktar) || x.miktar <= 0) h.push(`${ad}: "${x.aciklama}" miktarı sıfırdan büyük olmalı.`);
    }
    if (x.tur === 'asama') {
      if (!x.kaynakId || !b.asamalar.some((a) => a.id === x.kaynakId)) h.push(`${ad}: aşama sözleşmede yok.`);
      else if (onceki.asamalar.has(x.kaynakId)) h.push(`${ad}: "${x.aciklama}" aşaması önceki bir hakedişte var.`);
      else if (asamalar.has(x.kaynakId)) h.push(`${ad}: "${x.aciklama}" iki kez seçilmiş.`);
      asamalar.add(x.kaynakId ?? '');
    }
    if (x.tur === 'tutar' && x.tutar <= 0) h.push(`${ad}: tutar sıfırdan büyük olmalı.`);
  }
  for (const k of g.kesintiler) {
    if (!k.aciklama.trim()) h.push('Her kesintinin açıklamasını yazın (örn. Gecikme cezası).');
    if (!Number.isInteger(k.tutar) || k.tutar <= 0) h.push('Kesinti tutarı sıfırdan büyük olmalı.');
  }
  if (!Number.isFinite(g.kdvOrani) || g.kdvOrani < 0 || g.kdvOrani > 100) h.push('KDV oranı geçersiz.');
  if (!tevkifatGecerli(g.tevkifat)) h.push('Tevkifat oranı geçersiz.');
  if (g.tevkifat && g.kdvOrani === 0) h.push("KDV'siz hakedişte tevkifat olmaz.");
  if (!Number.isFinite(g.teminatOrani) || g.teminatOrani < 0 || g.teminatOrani > 50) h.push('Teminat oranı %0 ile %50 arasında olmalı.');
  if (!Number.isInteger(g.avansMahsubu) || g.avansMahsubu < 0) h.push('Avans mahsubu geçersiz.');
  if (g.avansMahsubu > acikAvans) h.push(`Mahsup edilecek avans, ustanın açık avansından (${tlYaz(acikAvans)}) büyük olamaz.`);
  const t = hakedisTutarlari(g);
  if (t.brutTutar > 0 && t.kesintiToplam >= t.brutTutar) h.push('Kesintiler hakediş tutarından küçük olmalı.');
  if (g.avansMahsubu > 0 && g.avansMahsubu > t.borcTutari - t.teminatTutari) h.push('Avans mahsubu, teminat düşüldükten sonraki tutardan büyük olamaz.');
  return [...new Set(h)];
}

/** Engel olmayan uyarılar: metrajda sözleşme miktarının, tutarda iş toplamının aşılması. */
export function hakedisUyarilari(g: Pick<HakedisGirdisi, 'satirlar'>, s: HakedisSozlesmesi, onceki: OncekiDurum): string[] {
  const u: string[] = [];
  for (const x of g.satirlar) {
    if (x.tur !== 'metraj' || !x.kaynakId || x.miktar === null) continue;
    const k = s.kalemler.find((y) => y.id === x.kaynakId);
    if (!k || k.miktar === null) continue;
    const toplam = (onceki.kalemMiktari.get(k.id) ?? 0) + x.miktar;
    if (toplam > k.miktar) u.push(`"${k.ad}": toplam ${sayiYaz(toplam)} ${k.birim}, sözleşmedeki ${sayiYaz(k.miktar)} ${k.birim} miktarını aşıyor.`);
  }
  return u;
}
