import type { Cari, Firma, HakedisSekli, Kurus, Proje, SozlesmeKalemi, SozlesmeOrtakMaddesi, SozlesmeSorumlulugu, Tarih } from '../veri/tipler';
import { HAKEDIS_SEKLI_ADI } from '../veri/sabit/hazirUstaTipleri';
import { tlYaz } from './para';
import { sayiYaz } from './sayi';

// Usta sözleşmesi: tutar, eksik bilgi ve sözleşme metni. Saf fonksiyonlar; veritabanını bilmez.
// Metin bir taslaktır: program eksik tutar, tarih ya da sorumluluğu kendisi doldurmaz, eksik bilgi olarak sorar.

/** Sözleşmenin düzenlenebilir alanları (ekran formu ve servis girdisi aynı yapıyı kullanır). */
export interface SozlesmeIcerigi {
  sozlesmeTarihi: Tarih | null;
  baslamaTarihi: Tarih | null;
  bitisTarihi: Tarih | null;
  fiyatlamaBirimi: string;
  kalemler: SozlesmeKalemi[];
  sorumluluklar: SozlesmeSorumlulugu[];
  ortakMaddeler: SozlesmeOrtakMaddesi[];
  ozelSartlar: string;
  hakedisSekli: HakedisSekli;
  odemeKosulu: string;
  sgkTaahhudu: string | null;
  not: string;
}

/** Miktar × birim fiyat, kuruşa yuvarlanır; miktar boşsa null. */
export function kalemTutari(k: Pick<SozlesmeKalemi, 'miktar' | 'birimFiyat'>): Kurus | null {
  return k.miktar === null ? null : Math.round(k.miktar * k.birimFiyat);
}

/** Miktarı yazılı kalemlerin toplamı. `eksikMiktar`: miktarı boş kalem var mı (toplam o kalemleri içermez). */
export function sozlesmeToplami(kalemler: Pick<SozlesmeKalemi, 'miktar' | 'birimFiyat'>[]): { toplam: Kurus; eksikMiktar: boolean } {
  let toplam = 0;
  let eksikMiktar = false;
  for (const k of kalemler) {
    const t = kalemTutari(k);
    if (t === null) eksikMiktar = true;
    else toplam += t;
  }
  return { toplam, eksikMiktar };
}

/**
 * İmzadan önce doldurulması gerekenler. Liste boş değilse sözleşme onaylanamaz.
 * Başlama/bitiş tarihi ve miktar zorunlu değildir (birim fiyatlı sözleşmede miktar ölçümle belli olur).
 */
export function eksikBilgiler(s: Pick<SozlesmeIcerigi, 'sozlesmeTarihi' | 'kalemler' | 'sorumluluklar' | 'ortakMaddeler'>): string[] {
  const e: string[] = [];
  if (!s.sozlesmeTarihi) e.push('Sözleşme tarihi seçilmedi.');
  if (s.kalemler.length === 0) e.push('En az bir kalem ekleyin.');
  for (const k of s.kalemler) {
    if (!k.ad.trim()) e.push('Adı yazılmamış kalem var.');
    else if (k.birimFiyat <= 0) e.push(`"${k.ad}" kaleminin birim fiyatı yazılmadı.`);
  }
  for (const r of s.sorumluluklar) {
    if (r.cevap === null) e.push(`Cevaplanmadı: ${r.soru}`);
    else if (r.cevap === 'sozlesmede' && !r.aciklama.trim()) e.push(`Sözleşmeye yazılacak hüküm boş: ${r.soru}`);
  }
  for (const m of s.ortakMaddeler) if (!m.cevap.trim()) e.push(`Hüküm yazılmadı: ${m.baslik}`);
  return [...new Set(e)];
}

/** Zorunlu olmayan ama gözden kaçmaması gerekenler. */
export function sozlesmeUyarilari(s: Pick<SozlesmeIcerigi, 'baslamaTarihi' | 'bitisTarihi' | 'kalemler'>): string[] {
  const u: string[] = [];
  if (!s.baslamaTarihi) u.push('İşe başlama tarihi yazılmadı.');
  if (!s.bitisTarihi) u.push('İş bitiş (teslim) tarihi yazılmadı.');
  if (s.kalemler.some((k) => k.miktar === null)) u.push('Miktarı boş kalemler toplam tutara girmez; ödeme ölçülen miktara göre yapılır.');
  return u;
}

// ─── Sözleşme metni ────────────────────────────────────────────────

export interface MetinTablosu {
  basliklar: string[];
  satirlar: string[][];
  /** Tablonun altındaki toplam satırı. */
  alt: string[] | null;
}

export interface MetinMaddesi {
  baslik: string;
  paragraflar: string[];
  tablo?: MetinTablosu;
  /** Numaralı alt maddeler (ör. özel şartlar). */
  liste?: string[];
}

export interface TarafBilgisi {
  rol: string;
  ad: string;
  satirlar: string[];
}

export interface SozlesmeMetni {
  baslik: string;
  altBaslik: string;
  taraflar: TarafBilgisi[];
  maddeler: MetinMaddesi[];
  imzaTarihi: string;
  imzalar: { rol: string; ad: string }[];
}

export interface MetinKaynaklari {
  firma: Pick<Firma, 'ad' | 'bilgiler'>;
  cari: Pick<Cari, 'ad' | 'telefon' | 'vergiNo' | 'adres'>;
  proje: Pick<Proje, 'ad' | 'parseller'>;
  /** İl/ilçe/mahalle dahil tam adres (servis hesaplar). */
  projeAdresi: string;
}

export const ISVEREN = 'İşveren';
export const YUKLENICI = 'Yüklenici';

const tarihYaz = (t: Tarih | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '…/…/……');
const dolu = (satirlar: (string | false | null | undefined)[]) => satirlar.filter((x): x is string => !!x);

function sorumlulukMetni(r: SozlesmeSorumlulugu): string {
  const soru = r.soru.trim().replace(/\?$/, '');
  if (r.cevap === 'muteahhit') return `${soru}: ${ISVEREN}'e aittir.`;
  if (r.cevap === 'usta') return `${soru}: ${YUKLENICI}'ye aittir.`;
  if (r.cevap === 'sozlesmede') return `${soru}: ${r.aciklama.trim() || '…'}`;
  return `${soru}: …`;
}

/** Ekranda ve yazdırılan sözleşmede aynı metin. Boş bilgi "…" olarak kalır (program uydurmaz). */
export function sozlesmeMetni(s: SozlesmeIcerigi & { ustaTipiAdi: string }, k: MetinKaynaklari): SozlesmeMetni {
  const b = k.firma.bilgiler;
  const parsel = k.proje.parseller
    .filter((p) => p.ada || p.parsel)
    .map((p) => `${p.ada || '…'} ada ${p.parsel || '…'} parsel`)
    .join(', ');
  const yer = dolu([k.projeAdresi, parsel]).join(', ');
  const { toplam, eksikMiktar } = sozlesmeToplami(s.kalemler);
  const tumuMiktarli = s.kalemler.length > 0 && !eksikMiktar;

  const maddeler: MetinMaddesi[] = [];
  maddeler.push({
    baslik: 'Sözleşmenin konusu',
    paragraflar: [
      `${ISVEREN}'in yaptırdığı "${k.proje.ad}" projesinde${yer ? ` (${yer})` : ''} ${s.ustaTipiAdi} işlerinin, aşağıdaki kalem ve birim fiyatlarla ve bu sözleşmedeki şartlarla ${YUKLENICI} tarafından yapılmasıdır.`,
    ],
  });

  maddeler.push({
    baslik: 'İş kalemleri ve fiyatlar',
    paragraflar: dolu([
      s.kalemler.some((x) => x.miktar !== null) && 'Miktarlar tahminîdir; ödeme, işin bitmiş kısmının ölçülen miktarı üzerinden yapılır.',
      s.kalemler.some((x) => x.aciklama.trim()) && s.kalemler.filter((x) => x.aciklama.trim()).map((x) => `${x.ad}: ${x.aciklama.trim()}`).join(' · '),
    ]),
    tablo: {
      basliklar: ['Kalem', 'Birim', 'Miktar', 'Birim fiyat', 'Tutar'],
      satirlar: s.kalemler.map((x) => {
        const t = kalemTutari(x);
        return [x.ad, x.birim, x.miktar === null ? '—' : sayiYaz(x.miktar), x.birimFiyat > 0 ? tlYaz(x.birimFiyat) : '…', t === null ? '—' : tlYaz(t)];
      }),
      alt: s.kalemler.length === 0 ? null : [tumuMiktarli ? 'Tahmini toplam' : 'Miktarı yazılı kalemlerin toplamı', '', '', '', tlYaz(toplam)],
    },
  });

  const sure = dolu([
    `İşe başlama tarihi: ${tarihYaz(s.baslamaTarihi)}.`,
    `İşin bitiş (teslim) tarihi: ${tarihYaz(s.bitisTarihi)}.`,
  ]);
  maddeler.push({ baslik: 'Süre', paragraflar: sure });

  maddeler.push({
    baslik: 'Hakediş ve ödeme',
    paragraflar: dolu([`Hakediş şekli: ${HAKEDIS_SEKLI_ADI[s.hakedisSekli]}.`, s.odemeKosulu.trim() && `Ödeme: ${s.odemeKosulu.trim()}`]),
  });

  if (s.sorumluluklar.length > 0) {
    maddeler.push({ baslik: 'Malzeme ve sorumluluklar', paragraflar: [], liste: s.sorumluluklar.map(sorumlulukMetni) });
  }
  if (s.ortakMaddeler.length > 0) {
    maddeler.push({ baslik: 'Genel hükümler', paragraflar: [], liste: s.ortakMaddeler.map((m) => `${m.baslik}: ${m.cevap.trim() || '…'}`) });
  }
  if (s.sgkTaahhudu?.trim()) maddeler.push({ baslik: 'Sosyal güvenlik', paragraflar: [s.sgkTaahhudu.trim()] });

  const sartlar = s.ozelSartlar
    .split('\n')
    .map((x) => x.trim().replace(/^\d+[.)-]\s*/, ''))
    .filter(Boolean);
  if (sartlar.length > 0) maddeler.push({ baslik: 'Özel şartlar', paragraflar: [], liste: sartlar });

  maddeler.push({
    baslik: 'Yürürlük',
    paragraflar: [`Bu sözleşme ${tarihYaz(s.sozlesmeTarihi)} tarihinde iki nüsha olarak düzenlenmiş, taraflarca okunarak imzalanmıştır.`],
  });

  return {
    baslik: 'USTA (TAŞERON) SÖZLEŞMESİ',
    altBaslik: s.ustaTipiAdi,
    taraflar: [
      {
        rol: ISVEREN,
        ad: k.firma.ad,
        satirlar: dolu([b.yetkili && `Yetkili: ${b.yetkili}`, b.adres, (b.vergiDairesi || b.vergiNo) && `Vergi: ${dolu([b.vergiDairesi, b.vergiNo]).join(' / ')}`, b.telefon && `Tel: ${b.telefon}`]),
      },
      {
        rol: YUKLENICI,
        ad: k.cari.ad,
        satirlar: dolu([k.cari.adres, k.cari.vergiNo && `TC / Vergi no: ${k.cari.vergiNo}`, k.cari.telefon && `Tel: ${k.cari.telefon}`]),
      },
    ],
    maddeler,
    imzaTarihi: tarihYaz(s.sozlesmeTarihi),
    imzalar: [
      { rol: ISVEREN, ad: dolu([k.firma.ad, b.yetkili]).join(' · ') },
      { rol: YUKLENICI, ad: k.cari.ad },
    ],
  };
}
