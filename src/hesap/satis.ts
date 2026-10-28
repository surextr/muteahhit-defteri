import type { BagimsizBolum, Cari, Firma, Kurus, Proje, Satis, SatisMaddesi, SatisPlanSatiri, Tarih } from '../veri/tipler';
import { bolumNo } from './bolum';
import { bolumOdaTipi, DUBLEKS_ADI } from './odaTipi';
import { tlYaz } from './para';
import { sayiYaz } from './sayi';
import type { MetinMaddesi, SozlesmeMetni } from './ustaSozlesmesi';

// Daire satışı: bedel, eksik bilgi, plan durumu ve ön satış protokolü metni. Saf fonksiyonlar.
// Bedel KDV dahildir. Nakit tahsil edilecek = fiyat − indirim − takas; ödeme planının toplamı buna eşit olmalı.
// Program boş bilgiyi uydurmaz: protokolde "…" kalır, eksik bilgi olarak sorulur.

/** Ekran formu ve servis girdisi (müşteri, bölüm ve onay ayrı yönetilir). */
export type SatisIcerigi = Pick<Satis, 'tarih' | 'fiyat' | 'indirim' | 'kdvOrani' | 'takas' | 'plan' | 'teslimTarihi' | 'tapuTarihi' | 'maddeler' | 'not'>;

export const PLAN_TURU_ADI: Record<SatisPlanSatiri['tur'], string> = {
  kapora: 'Kapora',
  pesinat: 'Peşinat',
  taksit: 'Taksit',
  teslimde: 'Teslimde',
};

/** Hazır protokol maddeleri; metinleri firma doldurur (Ayarlar ya da ilk satışta "sonrakilerde de kullan"). */
export const HAZIR_SATIS_MADDELERI: SatisMaddesi[] = [
  { id: 'tapu', baslik: 'Tapu devri ve masrafları', metin: '' },
  { id: 'teslim', baslik: 'Teslim ve teslimde gecikme', metin: '' },
  { id: 'gecikme', baslik: 'Taksit ödemesinde gecikme', metin: '' },
  { id: 'cayma', baslik: 'Cayma halinde ödenenlerin durumu', metin: '' },
  { id: 'aidat', baslik: 'Abonelik, iskân ve aidat giderleri', metin: '' },
  { id: 'degisiklik', baslik: 'Daire içi değişiklik talepleri', metin: '' },
];

export interface SatisTutarlari {
  /** Fiyat − indirim (KDV dahil). */
  net: Kurus;
  takas: Kurus;
  /** Para olarak tahsil edilecek: net − takas. */
  nakit: Kurus;
  kdvHaric: Kurus;
  kdv: Kurus;
  planToplami: Kurus;
  /** nakit − plan toplamı; 0 değilse plan eksik ya da fazla. */
  planFarki: Kurus;
}

export function satisTutarlari(s: Pick<SatisIcerigi, 'fiyat' | 'indirim' | 'kdvOrani' | 'takas' | 'plan'>): SatisTutarlari {
  const net = s.fiyat - s.indirim;
  const takas = s.takas.reduce((t, x) => t + x.deger, 0);
  const nakit = net - takas;
  const kdvHaric = Math.round(net / (1 + s.kdvOrani / 100));
  const planToplami = s.plan.reduce((t, x) => t + x.tutar, 0);
  return { net, takas, nakit, kdvHaric, kdv: net - kdvHaric, planToplami, planFarki: nakit - planToplami };
}

/** İmzadan önce doldurulması gerekenler; liste boş değilse protokol imzalandı olarak işaretlenmez. */
export function satisEksikleri(s: SatisIcerigi): string[] {
  const e: string[] = [];
  const t = satisTutarlari(s);
  if (!s.tarih) e.push('Satış tarihi seçilmedi.');
  if (s.fiyat <= 0) e.push('Satış fiyatı yazılmadı.');
  if (!s.teslimTarihi) e.push('Teslim tarihi yazılmadı.');
  if (s.plan.length === 0 && t.nakit > 0) e.push('Ödeme planı yok (peşinat, taksitler…).');
  else if (t.planFarki !== 0) e.push(`Ödeme planının toplamı tahsil edilecek tutardan ${t.planFarki > 0 ? `${tlYaz(t.planFarki)} eksik` : `${tlYaz(-t.planFarki)} fazla`}.`);
  for (const m of s.maddeler) if (!m.metin.trim()) e.push(`Hüküm yazılmadı: ${m.baslik}`);
  return [...new Set(e)];
}

/** Kaydı engelleyen hatalar (eksik bilgi değil). */
export function satisKayitHatalari(s: SatisIcerigi): string[] {
  const h: string[] = [];
  const tarih = /^\d{4}-\d{2}-\d{2}$/;
  if (!tarih.test(s.tarih)) h.push('Satış tarihini seçin.');
  for (const t of [s.teslimTarihi, s.tapuTarihi]) if (t && !tarih.test(t)) h.push('Tarihleri gün.ay.yıl olarak seçin.');
  if (!Number.isInteger(s.fiyat) || s.fiyat < 0) h.push('Fiyat geçersiz.');
  if (!Number.isInteger(s.indirim) || s.indirim < 0) h.push('İndirim geçersiz.');
  if (s.indirim > s.fiyat) h.push('İndirim fiyattan büyük olamaz.');
  if (![0, 1, 10, 20].includes(s.kdvOrani)) h.push('KDV oranını seçin.');
  for (const x of s.takas) {
    if (!x.aciklama.trim()) h.push('Takas edilen malın açıklamasını yazın (örn. 2018 model araç).');
    if (!Number.isInteger(x.deger) || x.deger <= 0) h.push('Takas değeri sıfırdan büyük olmalı.');
  }
  if (satisTutarlari(s).nakit < 0) h.push('Takas değeri satış bedelinden büyük olamaz.');
  for (const p of s.plan) {
    if (!tarih.test(p.vadeTarihi)) h.push('Ödeme planındaki her satırın vadesini seçin.');
    if (!Number.isInteger(p.tutar) || p.tutar <= 0) h.push('Ödeme planındaki her satırın tutarı sıfırdan büyük olmalı.');
  }
  if (new Set(s.plan.map((p) => p.id)).size !== s.plan.length) h.push('Ödeme planı satırları tekrarlanıyor.');
  return [...new Set(h)];
}

// ─── Plan durumu ───────────────────────────────────────────────────

export type SatisPlanDurumu = 'bekliyor' | 'tahsil_edildi' | 'kismen' | 'gecikti' | 'yaklasan' | 'ileride';

export interface SatisPlanSatiriDurumu {
  satir: SatisPlanSatiri;
  tahsil: Kurus;
  kalan: Kurus;
  durum: SatisPlanDurumu;
}

const gunEkle = (t: Tarih, gun: number): Tarih => {
  const d = new Date(`${t}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + gun);
  return d.toISOString().slice(0, 10);
};

/**
 * Her plan satırının durumu, alacağının kalanından (`alacakKalan`: alacak kimliği → kalan). Alacağı olmayan satır
 * (imzasız satış) "bekliyor"dur. Önümüzdeki 30 gün yaklaşan sayılır.
 */
export function satisPlanDurumu(plan: SatisPlanSatiri[], alacakKalan: ReadonlyMap<string, Kurus>, bugun: Tarih): SatisPlanSatiriDurumu[] {
  const sinir = gunEkle(bugun, 30);
  return [...plan]
    .sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi))
    .map((satir) => {
      if (!satir.alacakId) return { satir, tahsil: 0, kalan: satir.tutar, durum: 'bekliyor' as const };
      const kalan = Math.max(0, alacakKalan.get(satir.alacakId) ?? satir.tutar);
      const tahsil = satir.tutar - kalan;
      let durum: SatisPlanDurumu;
      if (kalan === 0) durum = 'tahsil_edildi';
      else if (satir.vadeTarihi < bugun) durum = 'gecikti';
      else if (tahsil > 0) durum = 'kismen';
      else if (satir.vadeTarihi <= sinir) durum = 'yaklasan';
      else durum = 'ileride';
      return { satir, tahsil, kalan, durum };
    });
}

export interface SatisOzeti {
  net: Kurus;
  tahsil: Kurus;
  kalan: Kurus;
  geciken: Kurus;
  /** Sıradaki tahsil edilmemiş vade. */
  sonraki: SatisPlanSatiriDurumu | null;
}

export function satisOzeti(s: Pick<SatisIcerigi, 'fiyat' | 'indirim' | 'kdvOrani' | 'takas' | 'plan'>, durumlar: SatisPlanSatiriDurumu[]): SatisOzeti {
  const t = satisTutarlari(s);
  const tahsil = durumlar.reduce((x, d) => x + d.tahsil, 0);
  return {
    net: t.net,
    tahsil,
    kalan: t.nakit - tahsil,
    geciken: durumlar.filter((d) => d.durum === 'gecikti').reduce((x, d) => x + d.kalan, 0),
    sonraki: durumlar.find((d) => d.kalan > 0) ?? null,
  };
}

// ─── Bölüm tanımı ──────────────────────────────────────────────────

export interface BolumKunyesi {
  bolum: Pick<BagimsizBolum, 'no' | 'tip' | 'odaSayisi' | 'salonSayisi' | 'dubleks' | 'brutM2' | 'netM2' | 'cephe'>;
  blokAdi: string | null;
  katAdi: string | null;
}

const TIP_ADI: Record<BagimsizBolum['tip'], string> = { daire: 'daire', dukkan: 'dükkân', ofis: 'ofis', diger: 'bağımsız bölüm' };

/** "A Blok, 3. Kat, A-7 numaralı daire (3+1, çatı dubleksi; brüt 136 m², net 110 m²)". */
export function bolumTanimi(k: BolumKunyesi): string {
  const b = k.bolum;
  const yer = [k.blokAdi && `${k.blokAdi} Blok`, k.katAdi].filter(Boolean).join(', ');
  const oda = bolumOdaTipi(b);
  const ozellik = [oda, b.dubleks && DUBLEKS_ADI[b.dubleks].toLocaleLowerCase('tr')].filter(Boolean).join(', ');
  const alan = [b.brutM2 !== null && `brüt ${sayiYaz(b.brutM2)} m²`, b.netM2 !== null && `net ${sayiYaz(b.netM2)} m²`].filter(Boolean).join(', ');
  const ayrinti = [ozellik, alan].filter(Boolean).join('; ');
  return `${yer ? `${yer}, ` : ''}${bolumNo(k.blokAdi, b.no)} numaralı ${TIP_ADI[b.tip]}${ayrinti ? ` (${ayrinti})` : ''}`;
}

// ─── Ön satış protokolü ────────────────────────────────────────────

export interface ProtokolKaynaklari extends BolumKunyesi {
  firma: Pick<Firma, 'ad' | 'bilgiler'>;
  cari: Pick<Cari, 'ad' | 'telefon' | 'vergiNo' | 'adres'>;
  proje: Pick<Proje, 'ad' | 'parseller'>;
  projeAdresi: string;
}

export const SATICI = 'Satıcı';
export const ALICI = 'Alıcı';

const tarihYaz = (t: Tarih | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '…/…/……');
const dolu = (x: (string | false | null | undefined)[]) => x.filter((y): y is string => !!y);

/** Ekranda ve yazdırılan protokolde aynı metin; boş bilgi "…" kalır. */
export function satisProtokolu(s: SatisIcerigi, k: ProtokolKaynaklari): SozlesmeMetni {
  const b = k.firma.bilgiler;
  const t = satisTutarlari(s);
  const parsel = k.proje.parseller
    .filter((p) => p.ada || p.parsel)
    .map((p) => `${p.ada || '…'} ada ${p.parsel || '…'} parsel`)
    .join(', ');
  const yer = dolu([k.projeAdresi, parsel]).join(', ');

  const maddeler: MetinMaddesi[] = [];
  maddeler.push({
    baslik: 'Konu',
    paragraflar: [
      `${SATICI}'nın${yer ? ` ${yer} adresindeki` : ''} "${k.proje.ad}" projesinde inşa ettiği/edeceği ${bolumTanimi(k)} ${ALICI}'ya bu protokoldeki bedel ve şartlarla satılmıştır. Tapu devri resmi olarak tapu müdürlüğünde yapılır.`,
    ],
  });

  const bedel = dolu([
    `Satış bedeli KDV dahil ${s.fiyat > 0 ? tlYaz(s.fiyat) : '…'}${s.indirim > 0 ? `, indirim ${tlYaz(s.indirim)}, indirimli bedel ${tlYaz(t.net)}` : ''}.`,
    s.fiyat > 0 && `Bedelin içinde %${s.kdvOrani} KDV (${tlYaz(t.kdv)}) vardır.`,
    t.takas > 0 && `Bedelin ${tlYaz(t.takas)} kısmı aşağıdaki mallarla takas edilerek ödenmiştir; kalan ${tlYaz(t.nakit)} nakit olarak ödenir.`,
  ]);
  maddeler.push({
    baslik: 'Bedel',
    paragraflar: bedel,
    ...(s.takas.length > 0 ? { liste: s.takas.map((x) => `${x.aciklama.trim() || '…'}: ${tlYaz(x.deger)}`) } : {}),
  });

  const plan = [...s.plan].sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi));
  maddeler.push({
    baslik: 'Ödeme planı',
    paragraflar: plan.length === 0 ? ['…'] : [`${ALICI} nakit bedeli aşağıdaki vadelerde öder.`],
    ...(plan.length > 0
      ? {
          tablo: {
            basliklar: ['Ödeme', 'Vade', 'Tutar'],
            satirlar: plan.map((p, i) => [p.aciklama.trim() || `${PLAN_TURU_ADI[p.tur]}${p.tur === 'taksit' ? ` ${plan.slice(0, i + 1).filter((x) => x.tur === 'taksit').length}` : ''}`, tarihYaz(p.vadeTarihi), tlYaz(p.tutar)]),
            alt: ['Toplam', '', tlYaz(t.planToplami)],
            sinif: 'sb-hesap',
          },
        }
      : {}),
  });

  maddeler.push({ baslik: 'Teslim', paragraflar: [`Bağımsız bölüm en geç ${tarihYaz(s.teslimTarihi)} tarihinde ${ALICI}'ya anahtar teslimi yapılır.`] });

  if (s.maddeler.length > 0) {
    maddeler.push({ baslik: 'Diğer hükümler', paragraflar: [], liste: s.maddeler.map((m) => `${m.baslik}: ${m.metin.trim() || '…'}`) });
  }

  maddeler.push({
    baslik: 'Yürürlük',
    paragraflar: [`Bu protokol ${tarihYaz(s.tarih)} tarihinde iki nüsha olarak düzenlenmiş, taraflarca okunarak imzalanmıştır.`],
  });

  return {
    baslik: 'ÖN SATIŞ PROTOKOLÜ',
    altBaslik: `${k.proje.ad} · ${bolumNo(k.blokAdi, k.bolum.no)}`,
    taraflar: [
      {
        rol: SATICI,
        ad: k.firma.ad,
        satirlar: dolu([b.yetkili && `Yetkili: ${b.yetkili}`, b.adres, (b.vergiDairesi || b.vergiNo) && `Vergi: ${dolu([b.vergiDairesi, b.vergiNo]).join(' / ')}`, b.telefon && `Tel: ${b.telefon}`]),
      },
      { rol: ALICI, ad: k.cari.ad, satirlar: dolu([k.cari.adres, k.cari.vergiNo && `TC / Vergi no: ${k.cari.vergiNo}`, k.cari.telefon && `Tel: ${k.cari.telefon}`]) },
    ],
    maddeler,
    imzaTarihi: tarihYaz(s.tarih),
    imzalar: [
      { rol: SATICI, ad: dolu([k.firma.ad, b.yetkili]).join(' · ') },
      { rol: ALICI, ad: k.cari.ad },
    ],
  };
}
