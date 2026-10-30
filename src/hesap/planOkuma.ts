import type { BinaGirdileri } from '../veri/tipler';
import type { BlokYeri, Yazi } from './dxf';
import { aramaAnahtari } from './metin';
import { sayiYaz } from './sayi';

// Projeden okuma (saf): mimari PDF ya da DXF'teki yazı ve çizgilerden kat planları, mahaller (oda adı + m²), duvar uzunluğu
// ve blok (kapı, vitrifiye…) adetleri. Program önerir, kullanıcı ekranda onaylar; hesaba "📐 projeden" satırları gider.

export interface Cizim {
  /** 'yz': taranmış PDF ya da fotoğraf, yapay zekâ okudu (konum yok; rakamlar yaklaşık sayılır). */
  kaynak: 'pdf' | 'dxf' | 'yz';
  dosyaAdi: string;
  birimKodu: number | null;
  yazilar: Yazi[];
  bloklar: BlokYeri[];
  /** Katman → [ortaX, ortaY, uzunluk, …]; PDF'te boş. */
  parcalar: Map<string, ArrayLike<number>>;
}

export type KatTipi = 'bodrum' | 'normal' | 'cati' | 'diger';

export interface KatBasligi {
  metin: string;
  /** "Zemin kat", "1. bodrum kat"… */
  ad: string;
  kot: number | null;
  tip: KatTipi;
  x: number;
  y: number;
  h: number;
}

const kotOku = (s: string) => Number(s.replace(',', '.'));

/** "+3,25 KOTU ASMA KAT PLANI" → { ad: 'Asma kat', kot: 3.25, tip: 'normal' }; plan başlığı değilse null. */
export function katBasligiCoz(metin: string): Omit<KatBasligi, 'x' | 'y' | 'h' | 'metin'> | null {
  const m = /^\s*(?:([+-]?\d+[.,]\d+)\s*KOTU\s+)?(.*?)\s*PLANI\b/i.exec(metin);
  if (!m) return null;
  const govde = m[2]!.trim();
  const a = aramaAnahtari(govde);
  if (!a || /vaziyet|kesit|gorunus|detay|vaziyet/.test(a)) return null;
  const kot = m[1] ? kotOku(m[1]) : null;
  let tip: KatTipi;
  if (/bodrum|siginak/.test(a) || (kot !== null && kot < 0)) tip = 'bodrum';
  else if (/\bkat\b/.test(a) && /cati/.test(a)) tip = 'cati';
  else if (/\bkat\b/.test(a)) tip = 'normal';
  else tip = 'diger'; // "ÇATI PLANI" (çatı örtüsü), vb.
  const ad = govde.charAt(0).toLocaleUpperCase('tr-TR') + govde.slice(1).toLocaleLowerCase('tr-TR');
  return { ad, kot, tip };
}

export function katBasliklari(yazilar: Yazi[]): KatBasligi[] {
  return yazilar.flatMap((y) => {
    const b = katBasligiCoz(y.metin);
    return b ? [{ ...b, metin: y.metin, x: y.x, y: y.y, h: y.h }] : [];
  });
}

// ─── Mahaller ─────────────────────────────────────────────────────

export type OdaSinifi = 'kuru' | 'islak' | 'balkon' | 'ortak' | 'bosluk';

export const ODA_SINIFI_ADI: Record<OdaSinifi, string> = {
  kuru: 'Oda (kuru)',
  islak: 'Islak hacim',
  balkon: 'Balkon / teras',
  ortak: 'Ortak alan',
  bosluk: 'Boşluk (hesaba girmez)',
};

/** Oda adından sınıf: WC/banyo ıslak, galeri/kullanılmayan teras boşluk, merdiven/hol(ü) ortak… */
export function odaSinifi(ad: string): OdaSinifi {
  const a = aramaAnahtari(ad);
  if (/galeri|bosluk|kullanilmayan|saft|baca|asansor/.test(a)) return 'bosluk';
  if (/\bwc\b|banyo|dus\b|tuvalet|lavabo|\bwc|wc\b/.test(a)) return 'islak';
  if (/balkon|teras/.test(a)) return 'balkon';
  if (/merdiven|apt|bina giris|giris holu|yangin|kacis|guvenlik|otopark|siginak|kazan|jenerator|pano|depo|rampa|koridor/.test(a)) return 'ortak';
  return 'kuru';
}

export interface Mahal {
  ad: string;
  /** m²; çizimde yazılmamışsa null. */
  alan: number | null;
  x: number;
  y: number;
  sinif: OdaSinifi;
}

const ALAN = /^(.*?)\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*m(?:²|2)\s*$/i;
const ALANSIZ = /^(\D+?)\s*m(?:²|2)\s*$/i;
const SAYI = /^\d{1,4}(?:[.,]\d{1,2})?$/;
const M2 = /^m(?:²|2)$/i;
const ISIM_DEGIL = /^[\d\s.,/x×=+\-()%°ØhH:]+$|^(?:h|s|x|=)$/;

/** Yazılardan mahaller: "OFİS 12,10 m²" tek yazı, ya da ad üstte ayrı, alan altta ("12,70 m²" / "12,70" + "m²"). */
export function mahalleriBul(yazilar: Yazi[]): Mahal[] {
  const yatay = yazilar.filter((y) => Math.abs(y.aci % 180) < 1);
  const sonuc: Mahal[] = [];
  const adBul = (x: number, y: number, h: number) => {
    let en: Yazi | null = null;
    let enUzaklik = Infinity;
    for (const t of yatay) {
      const dy = t.y - y;
      if (dy <= 0.2 * h || dy > 3 * h) continue;
      const dx = Math.abs(t.x - x);
      if (dx > 6 * h) continue;
      const m = t.metin.trim();
      if (ISIM_DEGIL.test(m) || ALAN.test(m) || M2.test(m) || m.length > 40) continue;
      const u = dy + dx * 0.5;
      if (u < enUzaklik) {
        enUzaklik = u;
        en = t;
      }
    }
    return en?.metin.trim() ?? '';
  };
  for (const y of yatay) {
    const m = y.metin.trim();
    let ad: string | null = null;
    let alan: number | null = null;
    const a = ALAN.exec(m);
    if (a) {
      ad = a[1]!.trim();
      alan = kotOku(a[2]!);
    } else if (SAYI.test(m) && yatay.some((t) => M2.test(t.metin.trim()) && Math.abs(t.y - y.y) < 0.5 * y.h && t.x > y.x && t.x - y.x < 6 * y.h)) {
      ad = '';
      alan = kotOku(m);
    } else {
      const s = ALANSIZ.exec(m);
      if (s && s[1]!.trim().length >= 2) ad = s[1]!.trim();
    }
    if (ad === null) continue;
    if (/toplam|alan\s*:|^net\b|^br[uü]t\b/i.test(ad)) continue;
    if (!ad) ad = adBul(y.x, y.y, y.h || 1);
    if (!ad) ad = 'Adsız mahal';
    if (alan !== null && (alan <= 0 || alan > 5000)) continue;
    sonuc.push({ ad, alan, x: y.x, y: y.y, sinif: odaSinifi(ad) });
  }
  return sonuc;
}

// ─── Planlar (kümeleme) ───────────────────────────────────────────

export interface Kutu {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const kutuUzakligi = (k: Kutu, x: number, y: number) => Math.hypot(Math.max(k.x0 - x, 0, x - k.x1), Math.max(k.y0 - y, 0, y - k.y1));

/** Noktaları tek bağlantılı kümeler (eşik içindeki komşular aynı küme); ızgara ile hızlı. */
export function kumele(noktalar: { x: number; y: number }[], esik: number): number[][] {
  const ana = noktalar.map((_, i) => i);
  const bul = (i: number): number => (ana[i] === i ? i : (ana[i] = bul(ana[i]!)));
  const izgara = new Map<string, number[]>();
  const hucre = (x: number, y: number) => `${Math.floor(x / esik)},${Math.floor(y / esik)}`;
  noktalar.forEach((n, i) => {
    const k = hucre(n.x, n.y);
    izgara.set(k, [...(izgara.get(k) ?? []), i]);
  });
  noktalar.forEach((n, i) => {
    const hx = Math.floor(n.x / esik);
    const hy = Math.floor(n.y / esik);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const j of izgara.get(`${hx + dx},${hy + dy}`) ?? []) {
          if (j <= i) continue;
          const m = noktalar[j]!;
          if (Math.hypot(m.x - n.x, m.y - n.y) <= esik) ana[bul(i)] = bul(j);
        }
  });
  const gruplar = new Map<number, number[]>();
  noktalar.forEach((_, i) => gruplar.set(bul(i), [...(gruplar.get(bul(i)) ?? []), i]));
  return [...gruplar.values()];
}

/**
 * Yatay/dikey boşluktan bölme (XY kesimi): noktaların x ya da y izdüşümünde `esik`ten geniş boş bant varsa oradan ikiye
 * ayırır, parçalarda tekrarlar. Yan yana ya da alt alta çizilmiş planlar birbirinden ayrılır.
 */
export function xyKes(noktalar: { x: number; y: number }[], esik: number): number[][] {
  const kes = (idx: number[]): number[][] => {
    if (idx.length < 2) return [idx];
    let en = { bosluk: 0, eksen: 'x' as 'x' | 'y', sinir: 0 };
    for (const eksen of ['x', 'y'] as const) {
      const s = idx.map((i) => noktalar[i]![eksen]).sort((a, b) => a - b);
      for (let i = 1; i < s.length; i++) if (s[i]! - s[i - 1]! > en.bosluk) en = { bosluk: s[i]! - s[i - 1]!, eksen, sinir: (s[i]! + s[i - 1]!) / 2 };
    }
    if (en.bosluk <= esik) return [idx];
    const a = idx.filter((i) => noktalar[i]![en.eksen] < en.sinir);
    const b = idx.filter((i) => noktalar[i]![en.eksen] >= en.sinir);
    return [...kes(a), ...kes(b)];
  };
  return kes(noktalar.map((_, i) => i));
}

/**
 * Birbirine çok yakın çizilmiş planlar tek küme olabilir: kümenin altında/yanında birden çok kat başlığı varsa, ardışık
 * iki başlık arasındaki en geniş yatay boşluktan bölünür.
 */
export function basliklaBol(kume: number[], noktalar: { x: number; y: number }[], basliklar: { x: number; y: number }[]): number[][] {
  const xs = kume.map((i) => noktalar[i]!.x);
  const ys = kume.map((i) => noktalar[i]!.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const px = (x1 - x0) * 0.1;
  const py = Math.max((y1 - y0) * 0.5, (x1 - x0) * 0.25);
  const icinde = basliklar.filter((b) => b.x >= x0 - px && b.x <= x1 + px && b.y >= y0 - py && b.y <= y1 + py).sort((a, b) => a.x - b.x);
  if (icinde.length < 2) return [kume];
  const siniflar: number[] = [];
  for (let k = 1; k < icinde.length; k++) {
    const sol = icinde[k - 1]!.x;
    const sag = icinde[k]!.x;
    const arada = xs.filter((x) => x > sol && x < sag).sort((a, b) => a - b);
    let en = { bosluk: 0, sinir: (sol + sag) / 2 };
    const l = [sol, ...arada, sag];
    for (let i = 1; i < l.length; i++) if (l[i]! - l[i - 1]! > en.bosluk) en = { bosluk: l[i]! - l[i - 1]!, sinir: (l[i]! + l[i - 1]!) / 2 };
    siniflar.push(en.sinir);
  }
  const parcalar: number[][] = siniflar.map(() => []).concat([[]]);
  for (const i of kume) {
    const x = noktalar[i]!.x;
    let k = 0;
    while (k < siniflar.length && x >= siniflar[k]!) k++;
    parcalar[k]!.push(i);
  }
  return parcalar.filter((p) => p.length);
}

/** En küçük toplam uzaklıkla bire bir eşleme (açgözlü başlangıç + takas iyileştirmesi; plan sayısı küçük). */
export function eslestir(maliyet: number[][]): (number | null)[] {
  const n = maliyet.length;
  const atama: (number | null)[] = new Array(n).fill(null);
  const dolu = new Set<number>();
  const ciftler = maliyet.flatMap((s, i) => s.map((c, j) => ({ i, j, c }))).sort((a, b) => a.c - b.c);
  for (const { i, j } of ciftler) if (atama[i] === null && !dolu.has(j)) (atama[i] = j), dolu.add(j);
  for (let iyilesti = true, tur = 0; iyilesti && tur < 50; tur++) {
    iyilesti = false;
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const ja = atama[a] ?? null;
        const jb = atama[b] ?? null;
        const once = (ja !== null ? maliyet[a]![ja]! : 0) + (jb !== null ? maliyet[b]![jb]! : 0);
        const sonra = (jb !== null ? maliyet[a]![jb]! : 0) + (ja !== null ? maliyet[b]![ja]! : 0);
        if (sonra + 1e-9 < once && (ja !== null || jb !== null)) {
          atama[a] = jb;
          atama[b] = ja;
          iyilesti = true;
        }
      }
  }
  return atama;
}

export interface Plan {
  /** Kümenin sırası (kimlik). */
  no: number;
  kutu: Kutu;
  mahaller: Mahal[];
  /** Eşlenen başlık (listedeki sıra); bulunamadıysa null. */
  baslik: number | null;
}

export interface OkumaSonucu {
  basliklar: KatBasligi[];
  planlar: Plan[];
}

const ortanca = (l: number[]) => {
  if (!l.length) return 0;
  const s = [...l].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * Mahaller kümelenir (her plan bir küme), kümeler başlıklarla en küçük toplam uzaklıkla eşlenir. Mahalsiz başlık plan
 * çıkarmaz (alan bilgisi yok). Az mahalli (1–2) ve başlıksız kümeler ayrıntı/lejant sayılıp atılır.
 */
export function planlariBul(c: Pick<Cizim, 'yazilar'>): OkumaSonucu {
  const basliklar = katBasliklari(c.yazilar);
  const mahaller = mahalleriBul(c.yazilar);
  if (!mahaller.length) return { basliklar, planlar: [] };
  // Eşik: mahallerin en yakın komşu uzaklığının ortancasının 2,5 katı (bir planın odaları birbirine bağlanır).
  const yakin = mahaller.map((m, i) => {
    let en = Infinity;
    mahaller.forEach((n, j) => {
      if (i !== j) en = Math.min(en, Math.hypot(m.x - n.x, m.y - n.y));
    });
    return en;
  });
  const esik = Math.max(ortanca(yakin.filter(Number.isFinite)) * 2.5, 1e-6);
  const katKonumlari = basliklar.filter((b) => b.tip !== 'diger');
  const kumeler = xyKes(mahaller, esik)
    .flatMap((k) => basliklaBol(k, mahaller, katKonumlari))
    .filter((k) => k.length >= 3);
  const planlar: Plan[] = kumeler.map((k, no) => {
    const ms = k.map((i) => mahaller[i]!);
    return {
      no,
      mahaller: ms,
      kutu: { x0: Math.min(...ms.map((m) => m.x)), y0: Math.min(...ms.map((m) => m.y)), x1: Math.max(...ms.map((m) => m.x)), y1: Math.max(...ms.map((m) => m.y)) },
      baslik: null,
    };
  });
  const katlar = basliklar.map((b, i) => ({ b, i })).filter((x) => x.b.tip !== 'diger');
  if (katlar.length && planlar.length) {
    const maliyet = planlar.map((p) => katlar.map(({ b }) => kutuUzakligi(p.kutu, b.x, b.y)));
    eslestir(maliyet).forEach((j, pi) => {
      if (j !== null) planlar[pi]!.baslik = katlar[j]!.i;
    });
  }
  return { basliklar, planlar: planlar.sort((a, b) => (basliklar[a.baslik ?? -1]?.kot ?? 999) - (basliklar[b.baslik ?? -1]?.kot ?? 999) || a.no - b.no) };
}

/**
 * Yapay zekânın plan okuması (güvenilmez veri) denetlenir: { katlar: [{ ad, kot, mahaller: [{ ad, alan }] }], kat_yuksekligi }.
 * Konum olmadığından plan kutuları boştur; başlık ve plan sırası bire birdir.
 */
export function yzPlanCoz(veri: unknown): (OkumaSonucu & { katYuksekligi: number | null }) | null {
  const v = veri as { katlar?: unknown; kat_yuksekligi?: unknown } | null;
  if (!v || !Array.isArray(v.katlar)) return null;
  const metin = (x: unknown, uz = 60) => (typeof x === 'string' ? x.trim().slice(0, uz) : '');
  const sayi = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && /^[+-]?\d+([.,]\d+)?$/.test(x.trim()) ? kotOku(x.trim()) : null);
  const basliklar: KatBasligi[] = [];
  const planlar: Plan[] = [];
  for (const k of (v.katlar as Record<string, unknown>[]).slice(0, 40)) {
    if (!k || typeof k !== 'object') continue;
    const mahaller: Mahal[] = (Array.isArray(k.mahaller) ? (k.mahaller as Record<string, unknown>[]) : [])
      .slice(0, 300)
      .flatMap((m) => {
        const ad = metin(m?.ad, 40);
        const alan = sayi(m?.alan);
        if (!ad || /toplam/i.test(ad)) return [];
        return [{ ad, alan: alan !== null && alan > 0 && alan < 5000 ? Math.round(alan * 100) / 100 : null, x: 0, y: 0, sinif: odaSinifi(ad) }];
      });
    if (!mahaller.length) continue;
    const ad = metin(k.ad) || `Plan ${planlar.length + 1}`;
    const kot = sayi(k.kot);
    const coz = katBasligiCoz(`${kot !== null ? `${kot >= 0 ? '+' : ''}${String(kot).replace('.', ',')} KOTU ` : ''}${ad.replace(/\s*plan[ıi]?\s*$/i, '')} PLANI`);
    const tip: KatTipi = coz && coz.tip !== 'diger' ? coz.tip : kot !== null && kot < 0 ? 'bodrum' : 'normal';
    basliklar.push({ metin: ad, ad: ad.charAt(0).toLocaleUpperCase('tr-TR') + ad.slice(1), kot, tip, x: 0, y: 0, h: 0 });
    planlar.push({ no: planlar.length, kutu: { x0: 0, y0: 0, x1: 0, y1: 0 }, mahaller, baslik: basliklar.length - 1 });
  }
  if (!planlar.length) return null;
  const h = sayi(v.kat_yuksekligi);
  return { basliklar, planlar, katYuksekligi: h !== null && h >= 2.2 && h <= 8 ? h : null };
}

/** Katman başına plan kutusu içindeki çizgi uzunluğu (kutu `pay` kadar genişletilir). */
export function katmanUzunluklari(parcalar: Map<string, ArrayLike<number>>, kutu: Kutu, pay: number): Map<string, number> {
  const s = new Map<string, number>();
  for (const [katman, l] of parcalar) {
    let t = 0;
    for (let i = 0; i < l.length; i += 3) {
      const x = l[i]!;
      const y = l[i + 1]!;
      if (x >= kutu.x0 - pay && x <= kutu.x1 + pay && y >= kutu.y0 - pay && y <= kutu.y1 + pay) t += l[i + 2]!;
    }
    if (t > 0) s.set(katman, t);
  }
  return s;
}

/** Duvar katmanı önerisi: adında duvar/wall geçen, en uzun çizgili katman. */
export function duvarKatmaniOner(uzunluklar: Map<string, number>): string | null {
  const adaylar = [...uzunluklar.entries()].filter(([k]) => /duvar|wall/i.test(k) && !/yazi|text|tara|hatch/i.test(aramaAnahtari(k)));
  return adaylar.sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/**
 * Çizim biriminin metreye çarpanı: duvar kalınlığı ölçüsünden (en sık kısa parça 10–30 cm). Duvar katmanının kısa
 * parçalarının ortancası ~0,1–0,3 ise metre, ~10–30 santimetre, ~100–300 milimetre.
 */
export function birimTahmini(parcalar: ArrayLike<number> | undefined, birimKodu: number | null): number {
  const kodla: Record<number, number> = { 4: 0.001, 5: 0.01, 6: 1 };
  if (parcalar?.length) {
    const kisa: number[] = [];
    // Çok büyük katmanda örnek yeter.
    const adim = Math.max(1, Math.floor(parcalar.length / 3 / 20000)) * 3;
    for (let i = 2; i < parcalar.length; i += adim) kisa.push(parcalar[i]!);
    const k = ortanca(kisa.sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(kisa.length * 0.3))));
    if (k > 0) {
      if (k < 1) return 1;
      if (k < 60) return 0.01;
      return 0.001;
    }
  }
  return birimKodu !== null && kodla[birimKodu] ? kodla[birimKodu]! : 0.01;
}

export function blokSayilari(bloklar: BlokYeri[], kutu: Kutu, pay: number): Map<string, number> {
  const s = new Map<string, number>();
  for (const b of bloklar) if (b.x >= kutu.x0 - pay && b.x <= kutu.x1 + pay && b.y >= kutu.y0 - pay && b.y <= kutu.y1 + pay) s.set(b.ad, (s.get(b.ad) ?? 0) + 1);
  return s;
}

/** Blok adından maliyet formülü önerisi (kapı → iç kapı, klozet, lavabo, kombi…). */
export function blokFormulOner(ad: string): string | null {
  const a = aramaAnahtari(ad);
  if (/^\*|^a\$/.test(a)) return null;
  if (/celik kapi|daire kapi|giris kapi/.test(a)) return 'celik_kapi';
  if (/kapi|door/.test(a) && !/pervaz|kesit|yangin/.test(a)) return 'ic_kapi';
  if (/klozet|wc|alafranga/.test(a)) return 'klozet';
  if (/lavabo/.test(a)) return 'lavabo';
  if (/kombi/.test(a)) return 'kombi';
  return null;
}

// ─── Hesaba aktarım ───────────────────────────────────────────────

export interface PlanSecimi {
  no: number;
  dahil: boolean;
  /** Bu plan kaç katta tekrar ediyor (normal kat × 3). */
  tekrar: number;
  /** Başlık yerine kullanıcının verdiği kat adı. */
  ad: string;
  tip: KatTipi;
  kot: number | null;
}

export interface AktarimGirdisi {
  dosyaAdi: string;
  planlar: { plan: Plan; secim: PlanSecimi; duvarUzunlugu: number | null; bloklar: Map<string, number> }[];
  /** Mahal sınıfı düzeltmeleri: `${planNo}:${mahalSırası}` → sınıf. */
  siniflar: Map<string, OdaSinifi>;
  /** Blok adı → formül kodu. */
  blokFormulleri: Map<string, string>;
  /** Kat yüksekliği (m): girdiden ya da kotlardan. */
  katYuksekligi: number | null;
  /** Yapay zekâ okudu: bütün satırlar yaklaşık işaretlenir. */
  yz?: boolean;
  /** Mahal adına göre kaplama seçimi (`mahalAnahtari`); verilmeyen ad varsayılanı alır (`varsayilanKaplama`). */
  kaplamalar?: Map<string, Kaplama>;
}

export interface AktarimSatiri {
  /** Listede tekil anahtar: formül kodu ya da "k:" + fiyat kalemi kodu. */
  anahtar: string;
  /** Hesaptaki formül satırına yazılır… */
  formulKodu: string | null;
  /** …ya da fiyat listesindeki bu kalemin satırına (yoksa satır eklenir). */
  fiyatKalemiKodu: string | null;
  miktar: number;
  dayanak: string;
  yaklasik: boolean;
}

// ─── Kaplama: mahal adına göre zemin ve duvar ─────────────────────

export type ZeminKaplama = 'seramik' | 'parke' | 'mermer' | 'yok';
export type DuvarKaplama = 'boya' | 'fayans' | 'yok';
export interface Kaplama {
  zemin: ZeminKaplama;
  duvar: DuvarKaplama;
}
export const ZEMIN_KAPLAMA_ADI: Record<ZeminKaplama, string> = { seramik: 'Seramik', parke: 'Parke', mermer: 'Mermer', yok: 'Yok (şap / epoksi)' };
export const DUVAR_KAPLAMA_ADI: Record<DuvarKaplama, string> = { boya: 'Sıva + boya', fayans: 'Fayans', yok: 'Yok' };

/** Aynı adlı mahaller ("YATAK ODASI 1", "Yatak odası 2") bir kaplama grubudur: sondaki numara atılır. */
export const mahalAnahtari = (ad: string) => aramaAnahtari(ad).replace(/[\s\-.]*\d+$/, '').trim() || aramaAnahtari(ad);

/** Varsayılan kaplama: yaşam odaları parke, ıslak hacim seramik + fayans, merdiven mermer, otopark/depo/teknik kaplamasız. */
export function varsayilanKaplama(ad: string, sinif: OdaSinifi): Kaplama {
  const a = aramaAnahtari(ad);
  if (sinif === 'bosluk') return { zemin: 'yok', duvar: 'yok' };
  if (sinif === 'islak') return { zemin: 'seramik', duvar: 'fayans' };
  if (sinif === 'balkon') return { zemin: 'seramik', duvar: 'yok' };
  if (/otopark|siginak|depo|kazan|jenerator|teknik|tesisat|pano|rampa|su deposu/.test(a)) return { zemin: 'yok', duvar: 'boya' };
  if (/merdiven/.test(a)) return { zemin: 'mermer', duvar: 'boya' };
  if (sinif === 'kuru' && /salon|oturma|yatak|ebeveyn|cocuk|misafir|calisma|yemek|\boda(si)?\b/.test(a)) return { zemin: 'parke', duvar: 'boya' };
  return { zemin: 'seramik', duvar: 'boya' };
}

export interface MahalGrubu {
  anahtar: string;
  /** Gruptaki ilk mahalin adı (numarasız). */
  ad: string;
  sinif: OdaSinifi;
  /** Tekrarlarla. */
  adet: number;
  alan: number;
  kaplama: Kaplama;
}

const gruplanabilir = (g: AktarimGirdisi) =>
  g.planlar
    .filter((p) => p.secim.dahil && p.secim.tekrar > 0)
    .flatMap((p) => p.plan.mahaller.map((m, i) => ({ m, sinif: g.siniflar.get(`${p.plan.no}:${i}`) ?? m.sinif, tekrar: p.secim.tekrar })));

/** Seçili planlardaki mahaller ada göre gruplu (büyük alan önce), kaplamasıyla. */
export function mahalGruplari(g: AktarimGirdisi): MahalGrubu[] {
  const l = new Map<string, MahalGrubu>();
  for (const { m, sinif, tekrar } of gruplanabilir(g)) {
    const k = mahalAnahtari(m.ad);
    const x = l.get(k) ?? { anahtar: k, ad: m.ad.replace(/[\s\-.]*\d+$/, '').trim() || m.ad, sinif, adet: 0, alan: 0, kaplama: g.kaplamalar?.get(k) ?? varsayilanKaplama(m.ad, sinif) };
    x.adet += tekrar;
    x.alan = y2(x.alan + (m.alan ?? 0) * tekrar);
    l.set(k, x);
  }
  return [...l.values()].sort((a, b) => b.alan - a.alan);
}

export interface AktarimOnerisi {
  girdiler: Partial<BinaGirdileri>;
  girdiNotlari: string[];
  satirlar: AktarimSatiri[];
  uyarilar: string[];
  /** Sınıf başına toplam alan (tekrarlarla). */
  alanlar: Record<OdaSinifi, number>;
}

const y2 = (n: number) => Math.round(n * 100) / 100;

/** Kotlardan kat yüksekliği: ardışık kot farklarının ortancası. */
export function kotlardanKatYuksekligi(kotlar: (number | null)[]): number | null {
  const s = [...new Set(kotlar.filter((k): k is number => k !== null))].sort((a, b) => a - b);
  const farklar = s.slice(1).map((k, i) => y2(k - s[i]!)).filter((f) => f >= 2.4 && f <= 6);
  return farklar.length ? ortanca(farklar) : null;
}

/**
 * Seçilen planlardan hesap önerisi. Duvar ve tavan alanları oda alanından yaklaşık (oda kare kabul edilir: çevre = 4√alan,
 * net yükseklik = kat yüksekliği − 0,35 m döşeme); duvar örgüsü DXF'te ölçülen duvar uzunluğundan (iki yüz → ÷2).
 */
export function aktarimOnerisi(g: AktarimGirdisi): AktarimOnerisi {
  const dahil = g.planlar.filter((p) => p.secim.dahil && p.secim.tekrar > 0);
  const alanlar: Record<OdaSinifi, number> = { kuru: 0, islak: 0, balkon: 0, ortak: 0, bosluk: 0 };
  const uyarilar: string[] = [];
  const h = g.katYuksekligi;
  const hNet = h !== null ? Math.max(h - 0.35, 2.2) : null;
  const kaplamaOf = new Map(mahalGruplari(g).map((x) => [x.anahtar, x.kaplama]));
  let islakSayisi = 0;
  let alansiz = 0;
  const zemin: Record<ZeminKaplama, number> = { seramik: 0, parke: 0, mermer: 0, yok: 0 };
  const supurgelik: Record<ZeminKaplama, number> = { seramik: 0, parke: 0, mermer: 0, yok: 0 };
  const duvarCevre: Record<DuvarKaplama, number> = { boya: 0, fayans: 0, yok: 0 };
  let tavan = 0;
  for (const { m, sinif, tekrar } of gruplanabilir(g)) {
    if (sinif === 'islak') islakSayisi += tekrar;
    if (m.alan === null) {
      alansiz++;
      continue;
    }
    const k = kaplamaOf.get(mahalAnahtari(m.ad)) ?? varsayilanKaplama(m.ad, sinif);
    const a = m.alan * tekrar;
    alanlar[sinif] += a;
    if (sinif === 'bosluk') continue;
    const cevre = 4 * Math.sqrt(m.alan) * tekrar;
    zemin[k.zemin] += a;
    // Fayanslı duvarda süpürgelik olmaz; balkonda da sayılmaz.
    if (k.duvar !== 'fayans' && sinif !== 'balkon') supurgelik[k.zemin] += cevre;
    duvarCevre[k.duvar] += cevre;
    if (sinif !== 'balkon') tavan += a;
  }
  if (alansiz) uyarilar.push(`${alansiz} mahalin alanı çizimde yazmıyor; alan toplamlarına girmedi.`);
  const katlar = dahil.map((p) => `${p.secim.ad}${p.secim.tekrar > 1 ? ` ×${p.secim.tekrar}` : ''}`).join(', ');
  const kaynak = `${g.dosyaAdi} (${katlar}${g.yz ? '; yapay zekâ okudu, yaklaşık' : ''})`;
  const satirlar: AktarimSatiri[] = [];
  const formul = (kod: string, miktar: number, yaklasik: boolean, dayanak: string) =>
    satirlar.push({ anahtar: kod, formulKodu: kod, fiyatKalemiKodu: null, miktar: y2(miktar), yaklasik, dayanak });
  const kalem = (kod: string, miktar: number, yaklasik: boolean, dayanak: string) =>
    satirlar.push({ anahtar: `k:${kod}`, formulKodu: null, fiyatKalemiKodu: kod, miktar: y2(miktar), yaklasik, dayanak });
  const doseme = alanlar.kuru + alanlar.islak + alanlar.ortak + alanlar.balkon;
  if (doseme > 0) {
    formul('sap', doseme, false, `${kaynak}: mahal alanları toplamı ${sayiYaz(y2(doseme))} m² (boşluklar hariç)`);
    if (zemin.seramik > 0) formul('yer_seramigi', zemin.seramik, false, `${kaynak}: seramik seçilen mahaller ${sayiYaz(y2(zemin.seramik))} m²`);
    if (zemin.parke > 0) kalem('m_parke', zemin.parke, false, `${kaynak}: parke seçilen mahaller ${sayiYaz(y2(zemin.parke))} m²`);
    if (zemin.mermer > 0) {
      kalem('m_mermer_doseme', zemin.mermer, false, `${kaynak}: mermer seçilen mahaller ${sayiYaz(y2(zemin.mermer))} m²`);
      kalem('i_mermerci_1', zemin.mermer, false, `${kaynak}: mermer döşeme ${sayiYaz(y2(zemin.mermer))} m²`);
    }
    const sp = (z: ZeminKaplama, kod: string) => {
      if (supurgelik[z] > 0) kalem(kod, supurgelik[z], true, `${kaynak}: ${ZEMIN_KAPLAMA_ADI[z].toLocaleLowerCase('tr')} döşemeli oda çevresi ≈ ${sayiYaz(y2(supurgelik[z]))} m (kapılar düşülmedi, yaklaşık)`);
    };
    sp('seramik', 'm_seramik_supurgelik');
    sp('parke', 'm_parke_supurgelik');
  }
  if (hNet !== null && duvarCevre.fayans > 0) {
    formul('fayans', duvarCevre.fayans * hNet, true, `${kaynak}: fayanslı mahallerin çevresi ≈ ${sayiYaz(y2(duvarCevre.fayans))} m × ${sayiYaz(y2(hNet))} m (yaklaşık)`);
  }
  if (hNet !== null && (duvarCevre.boya > 0 || tavan > 0)) {
    formul(
      'ic_siva',
      duvarCevre.boya * hNet + tavan,
      true,
      `${kaynak}: boyalı duvarlar ≈ ${sayiYaz(y2(duvarCevre.boya))} m × ${sayiYaz(y2(hNet))} m + tavanlar ${sayiYaz(y2(tavan))} m² (yaklaşık)`,
    );
  } else if (hNet === null && doseme > 0) uyarilar.push('Kat yüksekliği bilinmediği için duvar sıvası ve fayans hesaplanmadı.');
  const duvarli = dahil.filter((p) => p.duvarUzunlugu !== null);
  if (duvarli.length && h !== null) {
    const L = y2(duvarli.reduce((t, p) => t + (p.duvarUzunlugu! / 2) * p.secim.tekrar, 0));
    formul('duvar', L * h, true, `${kaynak}: duvar uzunluğu ${sayiYaz(L)} m × ${sayiYaz(h)} m kat yüksekliği (boşluklar düşülmedi)`);
  }
  const bloklar = new Map<string, { adet: number; adlar: string[] }>();
  for (const p of dahil)
    for (const [ad, n] of p.bloklar) {
      const f = g.blokFormulleri.get(ad);
      if (!f) continue;
      const b = bloklar.get(f) ?? { adet: 0, adlar: [] };
      b.adet += n * p.secim.tekrar;
      if (!b.adlar.includes(ad)) b.adlar.push(ad);
      bloklar.set(f, b);
    }
  for (const [f, b] of bloklar) formul(f, b.adet, false, `${kaynak}: "${b.adlar.join('", "')}" bloğu ${b.adet} adet`);

  const girdiler: Partial<BinaGirdileri> = {};
  const girdiNotlari: string[] = [];
  if (islakSayisi) {
    girdiler.islakHacimSayisi = islakSayisi;
    girdiNotlari.push(`Islak hacim: ${islakSayisi} (WC, banyo…)`);
  }
  if (h !== null) girdiler.katYuksekligi = h;
  const normal = dahil.filter((p) => p.secim.tip === 'normal' || p.secim.tip === 'cati').reduce((t, p) => t + p.secim.tekrar, 0);
  const bodrum = dahil.filter((p) => p.secim.tip === 'bodrum').reduce((t, p) => t + p.secim.tekrar, 0);
  if (normal) {
    girdiler.normalKatSayisi = normal;
    girdiNotlari.push(`Zemin + üst kat: ${normal}`);
  }
  if (bodrum) {
    girdiler.bodrumKatSayisi = bodrum;
    girdiNotlari.push(`Bodrum: ${bodrum}`);
  }
  return { girdiler, girdiNotlari, satirlar: g.yz ? satirlar.map((x) => ({ ...x, yaklasik: true })) : satirlar, uyarilar, alanlar };
}
