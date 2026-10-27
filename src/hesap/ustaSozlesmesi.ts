import { yeniId } from '../veri/kimlik';
import { bransKisaAdi } from './brans';
import type {
  Cari,
  Firma,
  Kurus,
  OrtakMadde,
  Proje,
  SozlesmeBolumu,
  SozlesmeKalemi,
  SozlesmeOrtakMaddesi,
  SozlesmeSorumlulugu,
  TakipYontemi,
  Tarih,
  UstaTipi,
} from '../veri/tipler';
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
  /** İşler (usta tipleri), ilki ana iş; her birinin hakediş şekli kendinde. */
  bolumler: SozlesmeBolumu[];
  fiyatlamaBirimi: string;
  kalemler: SozlesmeKalemi[];
  sorumluluklar: SozlesmeSorumlulugu[];
  ortakMaddeler: SozlesmeOrtakMaddesi[];
  ozelSartlar: string;
  odemeKosulu: string;
  /** Her hakedişten tutulan teminat yüzdesi; 0 ise yok. */
  teminatOrani: number;
  sgkTaahhudu: string | null;
  not: string;
}

// ─── Bölümler (toplu sözleşme) ─────────────────────────────────────

/** Hakediş şeklinden varsayılan takip yöntemi: beton/kat/aşamalı → aşama, iş bitimi → tutar, diğerleri → metraj. */
export function varsayilanTakipYontemi(hakedisSekli: unknown): TakipYontemi {
  if (hakedisSekli === 'beton_dokumu' || hakedisSekli === 'kat' || hakedisSekli === 'asamali') return 'asama';
  if (hakedisSekli === 'is_bitimi') return 'tutar';
  return 'metraj';
}

export const TAKIP_YONTEMI_ADI: Record<TakipYontemi, string> = {
  metraj: 'Metraj (yapılan miktar)',
  asama: 'Aşama (tamamlanan aşamalar)',
  tutar: 'Tutar (doğrudan)',
};

/** Bölüm eklemek için tipten gereken bilgiler. */
export type BolumSablonu = Pick<
  UstaTipi,
  'id' | 'ad' | 'sablonSurumu' | 'hakedisSekli' | 'takipYontemi' | 'fiyatlamaBirimi' | 'butceKalemiKodu' | 'kalemler' | 'sorular' | 'ozelSartlar' | 'kapaliOrtakMaddeler'
>;

export const bosIcerik = (): SozlesmeIcerigi => ({
  sozlesmeTarihi: null,
  baslamaTarihi: null,
  bitisTarihi: null,
  bolumler: [],
  fiyatlamaBirimi: '',
  kalemler: [],
  sorumluluklar: [],
  ortakMaddeler: [],
  ozelSartlar: '',
  odemeKosulu: '',
  teminatOrani: 0,
  sgkTaahhudu: null,
  not: '',
});

const satirlar = (metin: string) =>
  metin
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

/**
 * Sözleşmeye bir iş (usta tipi) ekler: kalemler fiyatsız, sorular (varsayılanı olan cevaplı) ve tipin özel şartları
 * (sözleşmede olmayan satırlar) eklenir. Firmanın ortak maddelerinden bu tipte kapalı olmayan ve sözleşmede bulunmayan
 * eklenir; sıra firma listesinin sırasıdır. Tip zaten sözleşmedeyse içerik değişmez.
 */
export function bolumEkle(ic: SozlesmeIcerigi, tip: BolumSablonu, firmaMaddeleri: Pick<OrtakMadde, 'id' | 'metin'>[]): SozlesmeIcerigi {
  if (ic.bolumler.some((b) => b.ustaTipiId === tip.id)) return ic;
  const kapali = new Set(tip.kapaliOrtakMaddeler);
  const mevcut = new Map(ic.ortakMaddeler.map((m) => [m.id, m]));
  const firmaSirasi = firmaMaddeleri
    .filter((m) => mevcut.has(m.id) || !kapali.has(m.id))
    .map((m) => mevcut.get(m.id) ?? { id: m.id, baslik: m.metin, cevap: '' });
  const firmadaYok = ic.ortakMaddeler.filter((m) => !firmaMaddeleri.some((f) => f.id === m.id));
  const sartlar = satirlar(ic.ozelSartlar);
  const yeniSartlar = tip.ozelSartlar.map((x) => x.trim()).filter((x) => x && !sartlar.includes(x));
  return {
    ...ic,
    bolumler: [
      ...ic.bolumler,
      {
        ustaTipiId: tip.id,
        ustaTipiAdi: tip.ad,
        sablonSurumu: tip.sablonSurumu,
        hakedisSekli: tip.hakedisSekli,
        takipYontemi: tip.takipYontemi,
        asamalar: [],
      },
    ],
    fiyatlamaBirimi: ic.fiyatlamaBirimi || tip.fiyatlamaBirimi,
    kalemler: [
      ...ic.kalemler,
      ...tip.kalemler.map((k) => ({
        id: yeniId(),
        ustaTipiId: tip.id,
        ad: k.ad,
        birim: k.birim,
        aciklama: k.aciklama,
        miktar: null,
        birimFiyat: 0,
        butceKalemiKodu: k.butceKalemiKodu ?? tip.butceKalemiKodu,
      })),
    ],
    sorumluluklar: [...ic.sorumluluklar, ...tip.sorular.map((q) => ({ ustaTipiId: tip.id, soru: q.soru, cevap: q.varsayilan, aciklama: '' }))],
    ortakMaddeler: [...firmaSirasi, ...firmadaYok],
    ozelSartlar: [...sartlar, ...yeniSartlar].join('\n'),
  };
}

/** İşi kalemleri ve sorumluluklarıyla çıkarır; son iş çıkarılmaz. Özel şartlar ve ortak maddeler değişmez. */
export function bolumCikar(ic: SozlesmeIcerigi, ustaTipiId: string): SozlesmeIcerigi {
  if (ic.bolumler.length <= 1) return ic;
  return {
    ...ic,
    bolumler: ic.bolumler.filter((b) => b.ustaTipiId !== ustaTipiId),
    kalemler: ic.kalemler.filter((k) => k.ustaTipiId !== ustaTipiId),
    sorumluluklar: ic.sorumluluklar.filter((r) => r.ustaTipiId !== ustaTipiId),
  };
}

/** "Sıvacı, Boyacı ve Alçıcı" (kısa adlarla). */
export function isAdlariMetni(bolumler: Pick<SozlesmeBolumu, 'ustaTipiAdi'>[]): string {
  const adlar = bolumler.map((b) => bransKisaAdi(b.ustaTipiAdi));
  return adlar.length <= 1 ? (adlar[0] ?? '') : `${adlar.slice(0, -1).join(', ')} ve ${adlar.at(-1)}`;
}

/** Sözleşmenin ana iş alanları (listeler ve dizin için): ilk bölümün tipi/sürümü/hakediş şekli, adlar " + " ile. */
export function anaIsAlanlari(bolumler: SozlesmeBolumu[]): { ustaTipiId: string; ustaTipiAdi: string; sablonSurumu: number; hakedisSekli: SozlesmeBolumu['hakedisSekli'] } {
  const ana = bolumler[0]!;
  return { ustaTipiId: ana.ustaTipiId, ustaTipiAdi: bolumler.map((b) => b.ustaTipiAdi).join(' + '), sablonSurumu: ana.sablonSurumu, hakedisSekli: ana.hakedisSekli };
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
export function eksikBilgiler(s: Pick<SozlesmeIcerigi, 'sozlesmeTarihi' | 'bolumler' | 'kalemler' | 'sorumluluklar' | 'ortakMaddeler'>): string[] {
  const e: string[] = [];
  if (!s.sozlesmeTarihi) e.push('Sözleşme tarihi seçilmedi.');
  if (s.kalemler.length === 0) e.push('En az bir kalem ekleyin.');
  else if (s.bolumler.length > 1) {
    for (const b of s.bolumler) {
      if (!s.kalemler.some((k) => k.ustaTipiId === b.ustaTipiId)) e.push(`${bransKisaAdi(b.ustaTipiAdi)} işi için kalem yok.`);
    }
  }
  for (const k of s.kalemler) {
    if (!k.ad.trim()) e.push('Adı yazılmamış kalem var.');
    else if (k.birimFiyat <= 0) e.push(`"${k.ad}" kaleminin birim fiyatı yazılmadı.`);
  }
  for (const b of s.bolumler) {
    if (b.takipYontemi !== 'asama') continue;
    const ad = bransKisaAdi(b.ustaTipiAdi);
    if (b.asamalar.length === 0) e.push(`${ad}: aşamalı hakediş için aşamaları yazın.`);
    else if (b.asamalar.some((a) => a.tutar <= 0)) e.push(`${ad}: tutarı yazılmamış aşama var.`);
  }
  for (const r of s.sorumluluklar) {
    if (r.cevap === null) e.push(`Cevaplanmadı: ${r.soru}`);
    else if (r.cevap === 'sozlesmede' && !r.aciklama.trim()) e.push(`Sözleşmeye yazılacak hüküm boş: ${r.soru}`);
  }
  for (const m of s.ortakMaddeler) if (!m.cevap.trim()) e.push(`Hüküm yazılmadı: ${m.baslik}`);
  return [...new Set(e)];
}

/** Zorunlu olmayan ama gözden kaçmaması gerekenler. */
export function sozlesmeUyarilari(s: Pick<SozlesmeIcerigi, 'baslamaTarihi' | 'bitisTarihi' | 'kalemler'> & Partial<Pick<SozlesmeIcerigi, 'bolumler'>>): string[] {
  const u: string[] = [];
  if (!s.baslamaTarihi) u.push('İşe başlama tarihi yazılmadı.');
  if (!s.bitisTarihi) u.push('İş bitiş (teslim) tarihi yazılmadı.');
  if (s.kalemler.some((k) => k.miktar === null)) u.push('Miktarı boş kalemler toplam tutara girmez; ödeme ölçülen miktara göre yapılır.');
  for (const b of s.bolumler ?? []) {
    if (b.takipYontemi !== 'asama' || b.asamalar.length === 0) continue;
    const { toplam, eksikMiktar } = sozlesmeToplami(s.kalemler.filter((k) => k.ustaTipiId === b.ustaTipiId));
    const asama = b.asamalar.reduce((t, a) => t + a.tutar, 0);
    if (!eksikMiktar && toplam > 0 && asama !== toplam) {
      u.push(`${bransKisaAdi(b.ustaTipiAdi)}: aşamaların toplamı (${tlYaz(asama)}) kalemlerin toplamından (${tlYaz(toplam)}) farklı.`);
    }
  }
  return u;
}

// ─── Sözleşme metni ────────────────────────────────────────────────

export interface MetinTablosu {
  basliklar: string[];
  satirlar: string[][];
  /**
   * Toplu sözleşmede satırın türü (satirlar ile aynı sırada): 'grup' işin başlığıdır (tek hücre, bütün sütunlara
   * yayılır), 'ara' işin ara toplamıdır (ilk ve son hücre). Verilmezse bütün satırlar kalemdir.
   */
  satirTurleri?: ('kalem' | 'grup' | 'ara')[];
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
  cari: Pick<Cari, 'ad' | 'telefon' | 'vergiNo' | 'adres' | 'roller' | 'yetkili'>;
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
function kalemSatiri(x: SozlesmeKalemi): string[] {
  const t = kalemTutari(x);
  return [x.ad, x.birim, x.miktar === null ? '—' : sayiYaz(x.miktar), x.birimFiyat > 0 ? tlYaz(x.birimFiyat) : '…', t === null ? '—' : tlYaz(t)];
}

/** Toplu sözleşmede kalemler işlere göre gruplanır: iş başlığı, kalemleri, ara toplamı. */
function kalemTablosuSatirlari(s: Pick<SozlesmeIcerigi, 'bolumler' | 'kalemler'>): Pick<MetinTablosu, 'satirlar' | 'satirTurleri'> {
  if (s.bolumler.length <= 1) return { satirlar: s.kalemler.map(kalemSatiri) };
  const satirlar: string[][] = [];
  const turler: ('kalem' | 'grup' | 'ara')[] = [];
  for (const b of s.bolumler) {
    const kalemler = s.kalemler.filter((x) => x.ustaTipiId === b.ustaTipiId);
    const ad = bransKisaAdi(b.ustaTipiAdi);
    satirlar.push([`${ad} işleri`]);
    turler.push('grup');
    for (const x of kalemler) {
      satirlar.push(kalemSatiri(x));
      turler.push('kalem');
    }
    const { toplam, eksikMiktar } = sozlesmeToplami(kalemler);
    satirlar.push([`${ad} ${eksikMiktar ? 'miktarı yazılı kalemleri' : 'toplamı'}`, '', '', '', tlYaz(toplam)]);
    turler.push('ara');
  }
  return { satirlar, satirTurleri: turler };
}

export function sozlesmeMetni(s: SozlesmeIcerigi & { ustaTipiAdi: string }, k: MetinKaynaklari): SozlesmeMetni {
  const b = k.firma.bilgiler;
  const parsel = k.proje.parseller
    .filter((p) => p.ada || p.parsel)
    .map((p) => `${p.ada || '…'} ada ${p.parsel || '…'} parsel`)
    .join(', ');
  const yer = dolu([k.projeAdresi, parsel]).join(', ');
  const { toplam, eksikMiktar } = sozlesmeToplami(s.kalemler);
  const tumuMiktarli = s.kalemler.length > 0 && !eksikMiktar;
  const toplu = s.bolumler.length > 1;
  // Eski çağrılar için: bölüm yoksa tip adı kullanılır.
  const isler = s.bolumler.length > 0 ? isAdlariMetni(s.bolumler) : s.ustaTipiAdi;
  const isAdi = (tipId: string) => bransKisaAdi(s.bolumler.find((b) => b.ustaTipiId === tipId)?.ustaTipiAdi ?? '');

  const maddeler: MetinMaddesi[] = [];
  maddeler.push({
    baslik: 'Sözleşmenin konusu',
    paragraflar: [
      `${ISVEREN}'in yaptırdığı "${k.proje.ad}" projesinde${yer ? ` (${yer})` : ''} ${isler} işlerinin, aşağıdaki kalem ve birim fiyatlarla ve bu sözleşmedeki şartlarla ${YUKLENICI} tarafından yapılmasıdır.`,
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
      ...kalemTablosuSatirlari(s),
      alt: s.kalemler.length === 0 ? null : [tumuMiktarli ? (toplu ? 'Genel toplam (tahmini)' : 'Tahmini toplam') : 'Miktarı yazılı kalemlerin toplamı', '', '', '', tlYaz(toplam)],
    },
  });

  const sure = dolu([
    `İşe başlama tarihi: ${tarihYaz(s.baslamaTarihi)}.`,
    `İşin bitiş (teslim) tarihi: ${tarihYaz(s.bitisTarihi)}.`,
  ]);
  maddeler.push({ baslik: 'Süre', paragraflar: sure });


  // Aşamalı işlerde aşamalar ve tutarları sözleşmeye yazılır; hakediş bu aşamalar tamamlandıkça yapılır.
  const asamaMetni = (b: SozlesmeBolumu) =>
    b.takipYontemi === 'asama' && b.asamalar.length > 0 ? b.asamalar.map((a) => `${a.ad} ${a.tutar > 0 ? tlYaz(a.tutar) : '…'}`).join('; ') : '';
  const tekAsama = !toplu && s.bolumler[0] ? asamaMetni(s.bolumler[0]) : '';
  const teminat = s.teminatOrani ?? 0;
  maddeler.push({
    baslik: 'Hakediş ve ödeme',
    paragraflar: dolu([
      !toplu && s.bolumler[0] && `Hakediş şekli: ${HAKEDIS_SEKLI_ADI[s.bolumler[0]!.hakedisSekli]}.`,
      tekAsama && `Hakediş aşağıdaki aşamalar tamamlandıkça, aşamanın tutarı üzerinden yapılır: ${tekAsama}.`,
      toplu && 'Hakediş her iş için ayrı yapılır:',
      teminat > 0 &&
        `Her hakedişten %${teminat.toLocaleString('tr-TR')} teminat kesilir; teminat, iş eksiksiz teslim edilip kabul edildikten sonra ${YUKLENICI}'ye ödenir.`,
      s.odemeKosulu.trim() && `Ödeme: ${s.odemeKosulu.trim()}`,
    ]),
    ...(toplu
      ? {
          liste: s.bolumler.map((b) => {
            const asama = asamaMetni(b);
            return `${bransKisaAdi(b.ustaTipiAdi)}: ${HAKEDIS_SEKLI_ADI[b.hakedisSekli]}${asama ? ` (${asama})` : ''}.`;
          }),
        }
      : {}),
  });

  if (s.sorumluluklar.length > 0) {
    maddeler.push({
      baslik: 'Malzeme ve sorumluluklar',
      paragraflar: [],
      // Toplu sözleşmede aynı soru farklı işlerde farklı cevaplanabilir; işin adı başa yazılır.
      liste: s.sorumluluklar.map((r) => (toplu ? `${isAdi(r.ustaTipiId)} · ${sorumlulukMetni(r)}` : sorumlulukMetni(r))),
    });
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

  // Yüklenicinin sıfatı sözleşmenin branşıdır (kartın ana branşı değil): "Ahmet Demir" · Sıfatı: Duvarcı.
  const brans = s.bolumler.length > 0 ? s.bolumler.map((b) => bransKisaAdi(b.ustaTipiAdi)).join(', ') : bransKisaAdi(s.ustaTipiAdi);
  const sifat = brans ? `Sıfatı: ${k.cari.roller.includes('taseron') ? `Taşeron (${brans})` : brans}` : null;
  return {
    baslik: 'USTA (TAŞERON) SÖZLEŞMESİ',
    altBaslik: s.bolumler.length > 0 ? s.bolumler.map((b) => b.ustaTipiAdi).join(' · ') : s.ustaTipiAdi,
    taraflar: [
      {
        rol: ISVEREN,
        ad: k.firma.ad,
        satirlar: dolu([b.yetkili && `Yetkili: ${b.yetkili}`, b.adres, (b.vergiDairesi || b.vergiNo) && `Vergi: ${dolu([b.vergiDairesi, b.vergiNo]).join(' / ')}`, b.telefon && `Tel: ${b.telefon}`]),
      },
      {
        rol: YUKLENICI,
        ad: k.cari.ad,
        satirlar: dolu([
          sifat,
          k.cari.yetkili && `Yetkili: ${k.cari.yetkili}`,
          k.cari.adres,
          k.cari.vergiNo && `TC / Vergi no: ${k.cari.vergiNo}`,
          k.cari.telefon && `Tel: ${k.cari.telefon}`,
        ]),
      },
    ],
    maddeler,
    imzaTarihi: tarihYaz(s.sozlesmeTarihi),
    imzalar: [
      { rol: ISVEREN, ad: dolu([k.firma.ad, b.yetkili]).join(' · ') },
      { rol: YUKLENICI, ad: dolu([k.cari.ad, k.cari.yetkili]).join(' · ') },
    ],
  };
}
