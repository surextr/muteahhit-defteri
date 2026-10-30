import { MALIYET_FORMULLERI } from '../veri/sabit/maliyetFormulleri';
import type { BinaGirdileri, EkIstek, FiyatKaynagi, FiyatKalemi, Kurus, MaliyetHesabi, MaliyetSatiri, Tarih } from '../veri/tipler';
import { sayiYaz } from './sayi';

// Maliyet hesabı (saf): bina girdilerinden formül miktarları, satır tutarları, malzeme / işçilik / makine toplamları.

export const BOS_GIRDILER: BinaGirdileri = {
  insaatAlani: null,
  tabanAlani: null,
  normalKatSayisi: null,
  bodrumKatSayisi: null,
  katYuksekligi: null,
  disCevre: null,
  daireSayisi: null,
  islakHacimSayisi: null,
  sureAy: null,
};

export const GIRDI_ADI: Record<keyof BinaGirdileri, { ad: string; birim: string }> = {
  insaatAlani: { ad: 'Toplam inşaat alanı', birim: 'm²' },
  tabanAlani: { ad: 'Taban (oturum) alanı', birim: 'm²' },
  normalKatSayisi: { ad: 'Zemin + üst kat sayısı', birim: 'kat' },
  bodrumKatSayisi: { ad: 'Bodrum kat sayısı', birim: 'kat' },
  katYuksekligi: { ad: 'Kat yüksekliği', birim: 'm' },
  disCevre: { ad: 'Dış çevre', birim: 'm' },
  daireSayisi: { ad: 'Bağımsız bölüm sayısı', birim: 'adet' },
  islakHacimSayisi: { ad: 'Islak hacim (banyo + WC)', birim: 'adet' },
  sureAy: { ad: 'İnşaat süresi', birim: 'ay' },
};

const yaz = (n: number) => sayiYaz(Math.round(n * 100) / 100);
const yuvarla = (n: number) => Math.round(n * 100) / 100;

export interface Taban {
  deger: number;
  metin: string;
}

/** Bina değerleri; girdi eksikse null ve eksik girdinin adı. */
export function tabanBul(kod: string, g: BinaGirdileri): Taban | { eksik: (keyof BinaGirdileri)[] } {
  const iste = (...k: (keyof BinaGirdileri)[]) => k.filter((x) => g[x] === null || g[x]! < 0);
  const h = g.katYuksekligi ?? 0;
  const cevre = (): { deger: number; tahmini: boolean } | null =>
    g.disCevre !== null ? { deger: g.disCevre, tahmini: false } : g.tabanAlani !== null ? { deger: 4 * Math.sqrt(g.tabanAlani), tahmini: true } : null;
  switch (kod) {
    case 'insaat':
      return g.insaatAlani === null ? { eksik: ['insaatAlani'] } : { deger: g.insaatAlani, metin: `İnşaat alanı ${yaz(g.insaatAlani)} m²` };
    case 'taban':
      return g.tabanAlani === null ? { eksik: ['tabanAlani'] } : { deger: g.tabanAlani, metin: `Taban alanı ${yaz(g.tabanAlani)} m²` };
    case 'daire':
      return g.daireSayisi === null ? { eksik: ['daireSayisi'] } : { deger: g.daireSayisi, metin: `${g.daireSayisi} bağımsız bölüm` };
    case 'islakHacim':
      return g.islakHacimSayisi === null ? { eksik: ['islakHacimSayisi'] } : { deger: g.islakHacimSayisi, metin: `${g.islakHacimSayisi} ıslak hacim` };
    case 'sure':
      return g.sureAy === null ? { eksik: ['sureAy'] } : { deger: g.sureAy, metin: `${yaz(g.sureAy)} ay` };
    case 'hafriyat': {
      const e = iste('tabanAlani', 'bodrumKatSayisi', ...(g.bodrumKatSayisi ? (['katYuksekligi'] as const) : []));
      if (e.length) return { eksik: e };
      const derinlik = g.bodrumKatSayisi! * h + 1;
      return { deger: g.tabanAlani! * derinlik, metin: `Taban ${yaz(g.tabanAlani!)} m² × ${yaz(derinlik)} m derinlik (${g.bodrumKatSayisi} bodrum + 1 m temel)` };
    }
    case 'cephe': {
      const c = cevre();
      const e = [...(c ? [] : (['disCevre'] as const)), ...iste('normalKatSayisi', 'katYuksekligi')];
      if (e.length || !c) return { eksik: e };
      const deger = c.deger * g.normalKatSayisi! * h;
      return { deger, metin: `Cephe: çevre ${yaz(c.deger)} m${c.tahmini ? ' (tahmini)' : ''} × ${g.normalKatSayisi} kat × ${yaz(h)} m` };
    }
    case 'temelYalitim': {
      const c = cevre();
      const e = [...iste('tabanAlani', 'bodrumKatSayisi'), ...(c ? [] : (['disCevre'] as const)), ...(g.bodrumKatSayisi ? iste('katYuksekligi') : [])];
      if (e.length || !c) return { eksik: e };
      const perde = c.deger * g.bodrumKatSayisi! * h;
      return { deger: g.tabanAlani! + perde, metin: `Taban ${yaz(g.tabanAlani!)} m² + bodrum perdesi ${yaz(perde)} m²` };
    }
    case 'asansor': {
      const e = iste('normalKatSayisi', 'bodrumKatSayisi');
      if (e.length) return { eksik: e };
      const kat = g.normalKatSayisi! + g.bodrumKatSayisi!;
      return { deger: kat >= 4 ? 1 : 0, metin: `${kat} katlı bina` };
    }
    default:
      return { eksik: [] };
  }
}

export interface FormulSonucu {
  miktar: number | null;
  dayanak: string;
  eksik: (keyof BinaGirdileri)[];
}

/**
 * Bütün formüllerin sonuçları (satırı olmayanlar da hesaplanır, başka formül dayanabilir). Katsayı hesaptaki satırdan,
 * yoksa formülün varsayılanı.
 */
export function formulleriHesapla(
  g: BinaGirdileri,
  katsayilar: Map<string, number> = new Map(),
  adlar: Map<string, string> = new Map(),
  /** Elle ya da projeden girilmiş miktarlar: formül yerine bunlar kullanılır, ona dayanan formüller de bunu alır. */
  sabitler: Map<string, number> = new Map(),
): Map<string, FormulSonucu> {
  const sonuc = new Map<string, FormulSonucu>();
  const formulAdi = new Map(MALIYET_FORMULLERI.map((f) => [f.kod, adlar.get(f.kod) ?? f.ad ?? f.kod]));
  for (const f of MALIYET_FORMULLERI) {
    const sabit = sabitler.get(f.kod);
    if (sabit !== undefined) {
      sonuc.set(f.kod, { miktar: sabit, dayanak: '', eksik: [] });
      continue;
    }
    const k = katsayilar.get(f.kod) ?? f.katsayi;
    const parcalar: Taban[] = [];
    const eksik = new Set<keyof BinaGirdileri>();
    for (const t of f.taban) {
      if (t.startsWith('f:')) {
        const o = sonuc.get(t.slice(2));
        if (!o || o.miktar === null) o?.eksik.forEach((x) => eksik.add(x));
        else parcalar.push({ deger: o.miktar, metin: `${formulAdi.get(t.slice(2))} ${yaz(o.miktar)}` });
      } else {
        const b = tabanBul(t, g);
        if ('eksik' in b) b.eksik.forEach((x) => eksik.add(x));
        else parcalar.push(b);
      }
    }
    if (eksik.size || parcalar.length !== f.taban.length) {
      sonuc.set(f.kod, { miktar: null, dayanak: `Girdi eksik: ${[...eksik].map((x) => GIRDI_ADI[x].ad).join(', ')}`, eksik: [...eksik] });
      continue;
    }
    const toplam = parcalar.reduce((a, p) => a + p.deger, 0);
    const tabanMetni = parcalar.length > 1 ? `(${parcalar.map((p) => p.metin).join(' + ')})` : parcalar[0]!.metin;
    sonuc.set(f.kod, { miktar: yuvarla(toplam * k), dayanak: `${tabanMetni} × ${yaz(k)} ${f.katsayiBirimi}`, eksik: [] });
  }
  return sonuc;
}

/** Formül satırlarının miktar ve dayanağını yeniden yazar (elle ve projeden satırlar olduğu gibi kalır). */
export function satirlariGuncelle(g: BinaGirdileri, satirlar: MaliyetSatiri[]): MaliyetSatiri[] {
  const katsayilar = new Map(satirlar.filter((s) => s.formulKodu && s.katsayi !== null).map((s) => [s.formulKodu!, s.katsayi!]));
  const adlar = new Map(satirlar.filter((s) => s.formulKodu).map((s) => [s.formulKodu!, s.ad]));
  const sabitler = new Map(satirlar.filter((s) => s.formulKodu && s.miktarKaynagi !== 'formul' && s.miktar !== null).map((s) => [s.formulKodu!, s.miktar!]));
  const sonuc = formulleriHesapla(g, katsayilar, adlar, sabitler);
  return satirlar.map((s) => {
    if (s.ekIstek) return { ...s, miktar: ekIstekMiktari(s.ekIstek) };
    if (s.miktarKaynagi !== 'formul' || !s.formulKodu) return s;
    const o = sonuc.get(s.formulKodu);
    return o ? { ...s, miktar: o.miktar, dayanak: o.dayanak } : s;
  });
}

/** Ek istek satırının miktarı: bölüm başı miktar × bölüm sayısı. */
export const ekIstekMiktari = (e: EkIstek) => Math.round(e.birimMiktar * e.bolumIdleri.length * 100) / 100;

// ─── Fiyat ve toplamlar ───────────────────────────────────────────

export interface SatirFiyati {
  fiyat: Kurus | null;
  kaynak: FiyatKaynagi | 'ozel' | null;
  tarih: Tarih | null;
  kdvOrani: number;
}

/** Birim fiyat: onaylıda dondurulan; değilse hesaba özel, yoksa listedeki. */
export function satirFiyati(s: MaliyetSatiri, katalog: FiyatKalemi | undefined): SatirFiyati {
  if (s.dondurulan) return s.dondurulan;
  const kdvOrani = katalog?.kdvOrani ?? (s.tur === 'iscilik' ? 0 : 20);
  if (s.ozelFiyat !== null) return { fiyat: s.ozelFiyat, kaynak: 'ozel', tarih: null, kdvOrani };
  return { fiyat: katalog?.fiyat ?? null, kaynak: katalog?.fiyatKaynagi ?? null, tarih: katalog?.fiyatTarihi ?? null, kdvOrani };
}

export interface HesaplananSatir {
  satir: MaliyetSatiri;
  fiyat: SatirFiyati;
  /** KDV hariç; miktar ya da fiyat yoksa null. */
  tutar: Kurus | null;
  kdv: Kurus;
}

export interface TurToplami {
  tutar: Kurus;
  kdv: Kurus;
  satir: number;
}

export interface MaliyetOzeti {
  satirlar: HesaplananSatir[];
  turler: Record<MaliyetSatiri['tur'], TurToplami>;
  toplam: Kurus;
  kdv: Kurus;
  /** Miktarı olup fiyatı olmayan satırlar. */
  fiyatsiz: HesaplananSatir[];
  /** Formül girdisi eksik satırlar. */
  miktarsiz: HesaplananSatir[];
  /** Bütçe kalemi kodu → toplam (KDV hariç). */
  butceKalemleri: Map<string | null, Kurus>;
  /** İnşaat alanı m² başına (KDV hariç); alan yoksa null. */
  m2Basina: Kurus | null;
  /** Daire bazında ek istekler (toplamın içinde). */
  ekIstekler: TurToplami;
  /** Bölüm kimliği → o bölümün ek istekleri (KDV hariç). */
  bolumEkleri: Map<string, Kurus>;
}

export function maliyetOzeti(h: Pick<MaliyetHesabi, 'satirlar' | 'girdiler'>, katalog: Map<string, FiyatKalemi>): MaliyetOzeti {
  const bos = (): TurToplami => ({ tutar: 0, kdv: 0, satir: 0 });
  const turler = { malzeme: bos(), iscilik: bos(), makine: bos() };
  const butceKalemleri = new Map<string | null, Kurus>();
  const ekIstekler = bos();
  const bolumEkleri = new Map<string, Kurus>();
  const satirlar = h.satirlar.map((s): HesaplananSatir => {
    const fiyat = satirFiyati(s, s.fiyatKalemiId ? katalog.get(s.fiyatKalemiId) : undefined);
    const tutar = s.miktar === null || fiyat.fiyat === null ? null : Math.round(s.miktar * fiyat.fiyat);
    const kdv = tutar === null ? 0 : Math.round((tutar * fiyat.kdvOrani) / 100);
    const t = turler[s.tur];
    t.satir++;
    if (tutar !== null) {
      t.tutar += tutar;
      t.kdv += kdv;
      butceKalemleri.set(s.butceKalemiKodu, (butceKalemleri.get(s.butceKalemiKodu) ?? 0) + tutar);
      if (s.ekIstek) {
        ekIstekler.satir++;
        ekIstekler.tutar += tutar;
        ekIstekler.kdv += kdv;
        const birTane = Math.round(s.ekIstek.birimMiktar * fiyat.fiyat!);
        for (const b of s.ekIstek.bolumIdleri) bolumEkleri.set(b, (bolumEkleri.get(b) ?? 0) + birTane);
      }
    }
    return { satir: s, fiyat, tutar, kdv };
  });
  const toplam = turler.malzeme.tutar + turler.iscilik.tutar + turler.makine.tutar;
  return {
    satirlar,
    turler,
    toplam,
    kdv: turler.malzeme.kdv + turler.iscilik.kdv + turler.makine.kdv,
    fiyatsiz: satirlar.filter((x) => x.satir.miktar !== null && x.satir.miktar > 0 && x.fiyat.fiyat === null),
    miktarsiz: satirlar.filter((x) => x.satir.miktar === null),
    butceKalemleri,
    m2Basina: h.girdiler.insaatAlani ? Math.round(toplam / h.girdiler.insaatAlani) : null,
    ekIstekler,
    bolumEkleri,
  };
}

/** Kayıt öncesi denetim: elle satırda dayanak zorunlu, miktar eksi olamaz, ad/birim boş olamaz. */
export function satirHatalari(satirlar: MaliyetSatiri[]): string[] {
  const hatalar: string[] = [];
  for (const s of satirlar) {
    const ad = s.ad.trim() || 'Adsız satır';
    if (!s.ad.trim()) hatalar.push('Satırın adını yazın.');
    if (!s.birim.trim()) hatalar.push(`${ad}: birimi yazın.`);
    if (s.miktarKaynagi === 'elle' && !s.dayanak.trim()) hatalar.push(`${ad}: elle girilen miktarın dayanağını yazın (ölçü, teklif, usta tahmini…).`);
    if (s.miktarKaynagi === 'elle' && !s.ekIstek && (s.miktar === null || !Number.isFinite(s.miktar))) hatalar.push(`${ad}: miktarı yazın.`);
    if (s.miktar !== null && s.miktar < 0) hatalar.push(`${ad}: miktar eksi olamaz.`);
    if (s.katsayi !== null && (!Number.isFinite(s.katsayi) || s.katsayi < 0)) hatalar.push(`${ad}: katsayı geçersiz.`);
    if (s.ozelFiyat !== null && (!Number.isInteger(s.ozelFiyat) || s.ozelFiyat < 0)) hatalar.push(`${ad}: fiyat geçersiz.`);
    if (s.ekIstek && !s.ekIstek.bolumIdleri.length) hatalar.push(`${ad}: ek isteğin bölümlerini seçin.`);
    if (s.ekIstek && (!Number.isFinite(s.ekIstek.birimMiktar) || s.ekIstek.birimMiktar <= 0)) hatalar.push(`${ad}: bölüm başı miktarı yazın.`);
  }
  return [...new Set(hatalar)];
}

export function girdiHatalari(g: BinaGirdileri): string[] {
  return (Object.keys(GIRDI_ADI) as (keyof BinaGirdileri)[])
    .filter((k) => g[k] !== null && (!Number.isFinite(g[k]) || g[k]! < 0))
    .map((k) => `${GIRDI_ADI[k].ad} geçersiz.`);
}
