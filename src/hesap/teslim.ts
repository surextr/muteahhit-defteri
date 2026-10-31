import type { Cari, DaireTeslimi, EksikIs, EksikIsKaynagi, Firma, Proje, Tarih, TeslimMaddesi, TeslimSayaci } from '../veri/tipler';
import { bolumNo } from './bolum';
import { bolumTanimi, type BolumKunyesi } from './satis';
import type { MetinMaddesi, SozlesmeMetni } from './ustaSozlesmesi';

// Daire teslimi ve eksik işler (saf): kontrol listesi, tamamlama denetimi, eksik iş durumu, teslim tutanağı ve
// sorumluya gönderilecek eksik listesi metni. Hiçbir şey saklanmaz.

export const HAZIR_TESLIM_MADDELERI: { grup: string; ad: string }[] = [
  { grup: 'Genel', ad: 'Daire giriş kapısı, kilit ve göz' },
  { grup: 'Genel', ad: 'İç kapılar ve kolları' },
  { grup: 'Genel', ad: 'Pencereler, doğramalar ve camlar' },
  { grup: 'Genel', ad: 'Sineklik ve panjur / kepenk' },
  { grup: 'Genel', ad: 'Duvar ve tavan boyası' },
  { grup: 'Genel', ad: 'Zemin kaplamaları (parke, seramik)' },
  { grup: 'Genel', ad: 'Süpürgelikler' },
  { grup: 'Mutfak', ad: 'Dolaplar ve kapak ayarları' },
  { grup: 'Mutfak', ad: 'Tezgâh, evye ve batarya' },
  { grup: 'Mutfak', ad: 'Ankastre cihazlar' },
  { grup: 'Mutfak', ad: 'Fayans ve derzler' },
  { grup: 'Banyo ve WC', ad: 'Klozet ve rezervuar' },
  { grup: 'Banyo ve WC', ad: 'Lavabo, dolap ve batarya' },
  { grup: 'Banyo ve WC', ad: 'Duşakabin / küvet' },
  { grup: 'Banyo ve WC', ad: 'Fayans, derz ve silikon' },
  { grup: 'Banyo ve WC', ad: 'Yer süzgeçleri ve gider akışı' },
  { grup: 'Banyo ve WC', ad: 'Aspiratör / havalandırma' },
  { grup: 'Tesisat', ad: 'Prizler, anahtarlar ve aydınlatma' },
  { grup: 'Tesisat', ad: 'Sigorta panosu ve kaçak akım rölesi' },
  { grup: 'Tesisat', ad: 'Kombi, petekler ve termostat' },
  { grup: 'Tesisat', ad: 'Doğalgaz tesisatı' },
  { grup: 'Tesisat', ad: 'Su basıncı, sıcak su ve sızıntı' },
  { grup: 'Tesisat', ad: 'Görüntülü diafon' },
  { grup: 'Tesisat', ad: 'TV, internet ve telefon prizleri' },
  { grup: 'Balkon ve dış', ad: 'Balkon korkuluğu' },
  { grup: 'Balkon ve dış', ad: 'Balkon zemini ve gideri' },
  { grup: 'Ortak alan', ad: 'Otopark yeri' },
  { grup: 'Ortak alan', ad: 'Depo / kiler' },
];

export const SAYAC_ADI: Record<TeslimSayaci['tur'], string> = { elektrik: 'Elektrik', su: 'Su', dogalgaz: 'Doğalgaz' };
export const MADDE_DURUMU_ADI: Record<NonNullable<TeslimMaddesi['durum']>, string> = { uygun: 'Uygun', eksik: 'Eksik', yok: 'Yok / gerekmiyor' };
export const EKSIK_KAYNAGI_ADI: Record<EksikIsKaynagi, string> = { teslim: 'Teslim kontrolü', kontrol: 'Şantiye kontrolü', musteri: 'Müşteri bildirimi' };

export function teslimMaddeleriOlustur(liste: { grup: string; ad: string }[] | undefined, yeniId: () => string): TeslimMaddesi[] {
  const kaynak = liste && liste.length > 0 ? liste : HAZIR_TESLIM_MADDELERI;
  return kaynak.map((m) => ({ id: yeniId(), grup: m.grup, ad: m.ad, durum: null, not: '', eksikIsId: null }));
}

export const bosSayaclar = (): TeslimSayaci[] => (['elektrik', 'su', 'dogalgaz'] as const).map((tur) => ({ tur, no: '', endeks: '' }));

export interface TeslimSayimi {
  toplam: number;
  uygun: number;
  eksik: number;
  yok: number;
  bakilmadi: number;
}

export function teslimSayimi(maddeler: TeslimMaddesi[]): TeslimSayimi {
  const say = (d: TeslimMaddesi['durum']) => maddeler.filter((m) => m.durum === d).length;
  return { toplam: maddeler.length, uygun: say('uygun'), eksik: say('eksik'), yok: say('yok'), bakilmadi: say(null) };
}

/** Grupları ilk geçtikleri sırayla. */
export function maddeGruplari(maddeler: TeslimMaddesi[]): { grup: string; maddeler: TeslimMaddesi[] }[] {
  const m = new Map<string, TeslimMaddesi[]>();
  for (const x of maddeler) {
    const g = x.grup.trim() || 'Diğer';
    m.set(g, [...(m.get(g) ?? []), x]);
  }
  return [...m].map(([grup, l]) => ({ grup, maddeler: l }));
}

/** Kaydetmeyi engelleyen hatalar. */
export function teslimHatalari(t: Pick<DaireTeslimi, 'tarih' | 'maddeler' | 'anahtarSayisi' | 'eksikSonTarih'>): string[] {
  const h: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.tarih)) h.push('Kontrol gününü seçin.');
  if (t.maddeler.some((m) => !m.ad.trim())) h.push('Adı boş madde var.');
  if (t.anahtarSayisi !== null && (!Number.isInteger(t.anahtarSayisi) || t.anahtarSayisi < 0)) h.push('Anahtar sayısı tam sayı olmalı.');
  if (t.eksikSonTarih && t.eksikSonTarih < t.tarih) h.push('Eksiklerin giderilme günü kontrol gününden önce olamaz.');
  return h;
}

/** Teslimi tamamlamayı engelleyenler: bakılmamış madde, eksik varken giderilme günü. */
export function tamamlamaEksikleri(t: Pick<DaireTeslimi, 'maddeler' | 'eksikSonTarih'>): string[] {
  const s = teslimSayimi(t.maddeler);
  const h: string[] = [];
  if (s.bakilmadi > 0) h.push(`${s.bakilmadi} maddeye bakılmadı (Uygun, Eksik ya da Yok seçin).`);
  if (s.eksik > 0 && !t.eksikSonTarih) h.push('Eksik var: eksiklerin giderileceği günü yazın (tutanağa girer).');
  return h;
}

export type EksikIsDurumu = 'acik' | 'gecikti' | 'yapildi';

export function eksikIsDurumu(e: Pick<EksikIs, 'yapildi' | 'sonTarih'>, bugun: Tarih): EksikIsDurumu {
  if (e.yapildi) return 'yapildi';
  return e.sonTarih && e.sonTarih < bugun ? 'gecikti' : 'acik';
}

export function eksikIsHatalari(e: Pick<EksikIs, 'baslik' | 'sonTarih' | 'yapildi'>): string[] {
  const h: string[] = [];
  if (!e.baslik.trim()) h.push('Eksik işin ne olduğunu yazın.');
  for (const t of [e.sonTarih, e.yapildi]) if (t && !/^\d{4}-\d{2}-\d{2}$/.test(t)) h.push('Tarih geçersiz.');
  return h;
}

/** Açık işler önce (geciken, sonra son tarihe göre, tarihsizler sonda), yapılanlar en yeni önce. */
export function eksikIsleriSirala<T extends Pick<EksikIs, 'yapildi' | 'sonTarih' | 'olusturmaZamani'>>(l: T[], bugun: Tarih): T[] {
  const sira = (e: T) => ({ yapildi: 2, gecikti: 0, acik: 1 })[eksikIsDurumu(e, bugun)];
  return [...l].sort(
    (a, b) =>
      sira(a) - sira(b) ||
      (a.yapildi && b.yapildi ? b.yapildi.localeCompare(a.yapildi) : (a.sonTarih ?? '9999').localeCompare(b.sonTarih ?? '9999')) ||
      a.olusturmaZamani.localeCompare(b.olusturmaZamani),
  );
}

const tarihYaz = (t: Tarih | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '…/…/……');
const dolu = (x: (string | false | null | undefined)[]) => x.filter((y): y is string => !!y);

/** Sorumlu ustaya gönderilecek eksik listesi (WhatsApp). */
export function eksikListesiMesaji(g: { firmaAdi: string; projeAdi: string; isler: { bolum: string | null; baslik: string; aciklama: string; sonTarih: Tarih | null }[] }): string {
  const satirlar = g.isler.map(
    (e, i) => `${i + 1}. ${e.bolum ? `${e.bolum} · ` : ''}${e.baslik}${e.aciklama.trim() ? ` (${e.aciklama.trim()})` : ''}${e.sonTarih ? ` · en geç ${tarihYaz(e.sonTarih)}` : ''}`,
  );
  return [`Merhaba, ${g.projeAdi} projesinde giderilmesi gereken eksikler:`, '', ...satirlar, '', 'Bittiğinde fotoğrafıyla haber verir misiniz?', g.firmaAdi].join('\n');
}

export const TESLIM_EDEN = 'Teslim eden';
export const TESLIM_ALAN = 'Teslim alan';

export interface TutanakKaynaklari extends BolumKunyesi {
  firma: Pick<Firma, 'ad' | 'bilgiler'>;
  cari: Pick<Cari, 'ad' | 'telefon' | 'vergiNo' | 'adres'> | null;
  proje: Pick<Proje, 'ad'>;
  projeAdresi: string;
  /** Teslim alan arsa sahibiyse "Arsa sahibi", alıcıysa "Alıcı". */
  sifat: string;
}

/** Teslim tutanağı: bölüm, kontrol listesi (eksikler ayrı), sayaçlar, anahtar, eksiklerin giderilme taahhüdü, imzalar. */
export function teslimTutanagi(t: DaireTeslimi, k: TutanakKaynaklari): SozlesmeMetni {
  const b = k.firma.bilgiler;
  const s = teslimSayimi(t.maddeler);
  const maddeler: MetinMaddesi[] = [];
  const teslimGunu = t.tamamlandi ?? t.tarih;
  const alan = t.teslimAlan.trim() || k.cari?.ad || '…';

  maddeler.push({
    baslik: 'Konu',
    paragraflar: dolu([
      `"${k.proje.ad}" projesindeki${k.projeAdresi ? ` (${k.projeAdresi})` : ''} ${bolumTanimi(k)} ${tarihYaz(teslimGunu)} tarihinde birlikte gezilerek kontrol edilmiş ve aşağıdaki durumuyla teslim edilmiştir.`,
      t.teslimAlan.trim() && k.cari && t.teslimAlan.trim() !== k.cari.ad && `Bölüm ${k.cari.ad} adına ${t.teslimAlan.trim()} tarafından teslim alınmıştır.`,
    ]),
  });

  maddeler.push({
    baslik: 'Kontrol listesi',
    paragraflar: [`${s.toplam} madde kontrol edildi: ${s.uygun} uygun, ${s.eksik} eksik${s.yok ? `, ${s.yok} bu bölümde yok` : ''}${s.bakilmadi ? `, ${s.bakilmadi} bakılmadı` : ''}.`],
    tablo: {
      basliklar: ['Madde', 'Not', 'Durum'],
      satirlar: maddeGruplari(t.maddeler).flatMap((g) => [[g.grup], ...g.maddeler.map((m) => [m.ad, m.not.trim(), m.durum ? MADDE_DURUMU_ADI[m.durum] : '…'])]),
      satirTurleri: maddeGruplari(t.maddeler).flatMap((g) => ['grup' as const, ...g.maddeler.map(() => 'kalem' as const)]),
      alt: null,
    },
  });

  const eksikler = t.maddeler.filter((m) => m.durum === 'eksik');
  maddeler.push({
    baslik: 'Eksikler',
    paragraflar:
      eksikler.length === 0
        ? ['Teslim sırasında eksik ya da kusur tespit edilmemiştir.']
        : [`Aşağıdaki eksikler teslim eden firma tarafından en geç ${tarihYaz(t.eksikSonTarih)} tarihine kadar giderilecektir. Eksikler bölümün teslim alınmasına engel değildir.`],
    ...(eksikler.length > 0 ? { liste: eksikler.map((m) => `${m.grup} · ${m.ad}${m.not.trim() ? `: ${m.not.trim()}` : ''}`) } : {}),
  });

  const sayaclar = t.sayaclar.filter((x) => x.no.trim() || x.endeks.trim());
  maddeler.push({
    baslik: 'Sayaçlar ve anahtarlar',
    paragraflar: dolu([
      sayaclar.length === 0 && 'Sayaç bilgisi yazılmamıştır.',
      `Teslim edilen anahtar: ${t.anahtarSayisi ?? '…'} adet.`,
      `Teslim gününden sonraki sayaç tüketimleri ve aidatlar teslim alana aittir.`,
    ]),
    ...(sayaclar.length > 0
      ? { tablo: { basliklar: ['Sayaç', 'Numara', 'Endeks'], satirlar: sayaclar.map((x) => [SAYAC_ADI[x.tur], x.no.trim() || '…', x.endeks.trim() || '…']), alt: null } }
      : {}),
  });

  if (t.not.trim()) maddeler.push({ baslik: 'Notlar', paragraflar: [t.not.trim()] });

  maddeler.push({
    baslik: 'Onay',
    paragraflar: [`Bu tutanak ${tarihYaz(teslimGunu)} tarihinde iki nüsha olarak düzenlenmiş, taraflarca okunarak imzalanmıştır.`],
  });

  return {
    baslik: 'DAİRE TESLİM TUTANAĞI',
    altBaslik: `${k.proje.ad} · ${bolumNo(k.blokAdi, k.bolum.no)}`,
    taraflar: [
      {
        rol: TESLIM_EDEN,
        ad: k.firma.ad,
        satirlar: dolu([b.yetkili && `Yetkili: ${b.yetkili}`, b.adres, b.telefon && `Tel: ${b.telefon}`]),
      },
      {
        rol: `${TESLIM_ALAN} (${k.sifat})`,
        ad: k.cari?.ad ?? alan,
        satirlar: dolu([
          t.teslimAlan.trim() && k.cari && t.teslimAlan.trim() !== k.cari.ad && `Teslim alan: ${t.teslimAlan.trim()}`,
          k.cari?.adres,
          k.cari?.vergiNo && `TC / Vergi no: ${k.cari.vergiNo}`,
          k.cari?.telefon && `Tel: ${k.cari.telefon}`,
        ]),
      },
    ],
    maddeler,
    imzaTarihi: tarihYaz(teslimGunu),
    imzalar: [
      { rol: TESLIM_EDEN, ad: dolu([k.firma.ad, b.yetkili]).join(' · ') },
      { rol: TESLIM_ALAN, ad: alan },
    ],
  };
}
