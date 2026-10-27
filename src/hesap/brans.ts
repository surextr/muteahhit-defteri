import type { Cari } from '../veri/tipler';
import { aramaAnahtari } from './metin';

// Usta/taşeron branşları (usta tipleri) için saf yardımcılar. Branş adı usta tipinin adıdır ("Duvarcı");
// listelerde ve sözleşmenin yüklenici satırında parantezli açıklama atılır ("Kalıpçı (demir işçiliği dahil)" → "Kalıpçı").

/** Parantez içindeki açıklamayı atar: "Sucu (sıhhi tesisat)" → "Sucu". Parantezden başka bir şey kalmazsa adın kendisi. */
export function bransKisaAdi(tipAdi: string): string {
  const kisa = tipAdi.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  return kisa || tipAdi.trim();
}

/** Kimliklerden kısa adlar; bilinmeyen (silinmiş) tip atlanır. */
export function bransAdlari(ids: readonly string[], tipAdlari: ReadonlyMap<string, string>): string[] {
  return ids.flatMap((id) => {
    const ad = tipAdlari.get(id);
    return ad ? [bransKisaAdi(ad)] : [];
  });
}

/**
 * Listelerde adın yanında görünen kısa açıklama: branşlı kartta "Taşeron · Sıvacı, Boyacı" ya da yalnız "Duvarcı";
 * branş yoksa null (ekran rolleri gösterir).
 */
export function bransOzeti(cari: Pick<Cari, 'roller' | 'ustaTipiIdleri'>, tipAdlari: ReadonlyMap<string, string>): string | null {
  const adlar = bransAdlari(cari.ustaTipiIdleri ?? [], tipAdlari);
  if (adlar.length === 0) return null;
  return `${cari.roller.includes('taseron') ? 'Taşeron · ' : ''}${adlar.join(', ')}`;
}

// ─── Eski kart adlarından branş ayırma ─────────────────────────────

/**
 * Hazır tiplerin adda geçebilecek kelime kökleri (Türkçe harfsiz, küçük harf). Kelime kökle başlıyorsa eşleşir:
 * "Tuğlası", "tuğlacı" → duvarcı; "sıvacı", "SIVA" → sıvacı.
 */
const HAZIR_KOKLER: Record<string, string[]> = {
  kalipci: ['kalip', 'betonarme'],
  duvarci: ['duvar', 'tugla', 'bims', 'gazbeton', 'ytong'],
  sivaci: ['siva'],
  alcici: ['alci', 'alcipan'],
  elektrikci: ['elektrik'],
  sucu: ['sucu', 'tesisat', 'sihhi'],
  boyaci: ['boya'],
  mermerci: ['mermer', 'granit'],
  asansorcu: ['asansor'],
  catici: ['cati'],
  sapci: ['sap'],
  hafriyatci: ['hafriyat', 'kepce'],
  iskeleci: ['iskele'],
  su_yalitimci: ['yalitim', 'izolasyon'],
  mantolamaci: ['mantolama', 'mantolamaci', 'mantolu'],
  seramikci: ['seramik', 'fayans'],
  dogramaci: ['pvc', 'aluminyum', 'dograma'],
  marangoz: ['marangoz', 'kapici'],
  demir_dograma: ['korkuluk', 'ferforje'],
  dogalgazci: ['dogalgaz'],
  dolapci: ['dolap', 'mutfakci'],
};

/** Branşın yanında adda kalan ve atılan sözcükler ("usta", "ustası", "ekibi"). */
const DOLGU = new Set(['usta', 'ustasi', 'ustalari', 'ekibi', 'ekip', 'isleri', 've']);

export interface BransAyirmaTipi {
  id: string;
  ad: string;
  sistemKodu: string | null;
}

export interface BransAyirmaOnerisi {
  /** Meslek atılmış ad: "Ahmet Demir". */
  yeniAd: string;
  ustaTipiId: string;
  /** Adda bulunan kelime ("Tuğlası"). */
  bulunan: string;
}

function kokler(t: BransAyirmaTipi): string[] {
  const hazir = t.sistemKodu ? HAZIR_KOKLER[t.sistemKodu] : undefined;
  if (hazir) return hazir;
  // Firmanın açtığı tip: kısa adın ilk kelimesi, sonundaki -cı/-ci/-cu/-cü atılmış (en az 4 harf).
  const ilk = (aramaAnahtari(bransKisaAdi(t.ad)).split(/[\s/]+/)[0] ?? '').replace(/(ci|cu)$/, '');
  return ilk.length >= 4 ? [ilk] : [];
}

/**
 * Adın sonundaki (ya da parantez içindeki) meslek sözcüğünü bulur: "Ahmet Demir Tuğlası" → "Ahmet Demir" + duvarcı;
 * "Ali Yılmaz (kalıpçı)" → "Ali Yılmaz" + kalıpçı; "Sıvacı Mehmet" → "Mehmet" + sıvacı. Adda en az bir sözcük kalır.
 * Eşleşme yoksa null. Adın ortasındaki sözcüklere dokunulmaz (soyadı "Boyacı" olabilir: yalnız uçlar denenir).
 */
export function addanBransOner(ad: string, tipler: BransAyirmaTipi[]): BransAyirmaOnerisi | null {
  const parantez = ad.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  const govde = parantez ? parantez[1]! : ad;
  const ek = parantez ? parantez[2]! : null;
  const bul = (sozcuk: string) => {
    const a = aramaAnahtari(sozcuk).replace(/[^a-z0-9]/g, '');
    if (a.length < 3) return null;
    return tipler.find((t) => kokler(t).some((k) => a.startsWith(k))) ?? null;
  };

  if (ek !== null) {
    const tip = ek.split(/\s+/).map(bul).find(Boolean);
    if (tip && govde.trim()) return { yeniAd: govde.trim().replace(/\s+/g, ' '), ustaTipiId: tip.id, bulunan: ek.trim() };
  }

  const sozcukler = govde.trim().split(/\s+/);
  if (sozcukler.length < 2) return null;
  const dolgu = (s: string) => DOLGU.has(aramaAnahtari(s).replace(/[^a-z]/g, ''));
  // Sondan: dolgu sözcükleri atlanır, ilk anlamlı sözcük meslek mi diye bakılır.
  let son = sozcukler.length - 1;
  while (son > 0 && dolgu(sozcukler[son]!)) son--;
  const sondaki = bul(sozcukler[son]!);
  if (sondaki && son >= 1) {
    let bas = son;
    while (bas > 1 && dolgu(sozcukler[bas - 1]!)) bas--;
    const kalan = sozcukler.slice(0, bas);
    if (kalan.length > 0) return { yeniAd: kalan.join(' '), ustaTipiId: sondaki.id, bulunan: sozcukler.slice(bas).join(' ') };
  }
  // Baştan: "Sıvacı Mehmet", "Usta Kalıpçı Ali".
  let ilk = 0;
  while (ilk < sozcukler.length - 1 && dolgu(sozcukler[ilk]!)) ilk++;
  const bastaki = bul(sozcukler[ilk]!);
  if (bastaki && ilk < sozcukler.length - 1) {
    let bitis = ilk + 1;
    while (bitis < sozcukler.length - 1 && dolgu(sozcukler[bitis]!)) bitis++;
    return { yeniAd: sozcukler.slice(bitis).join(' '), ustaTipiId: bastaki.id, bulunan: sozcukler.slice(0, bitis).join(' ') };
  }
  return null;
}
