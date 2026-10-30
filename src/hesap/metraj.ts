import type { FiyatKalemi, Kurus, MaliyetSatiri } from '../veri/tipler';
import { adBenzer, adParcalari, birimCarpani } from './fiyat';
import { aramaAnahtari } from './metin';
import { sayiOku, sayiYaz } from './sayi';
import type { HucreDegeri } from './tabloOku';

// Mühendis metraj tablosu (saf): başlık satırı ve sütunlar bulunur (tanım, birim, miktar, birim fiyat, tutar, poz),
// satırlar okunur, fiyat listesindeki kalemlerle eşleştirme önerilir; seçilenler maliyet hesabına "📐 projeden" gider.

export type MetrajSutunu = 'poz' | 'tanim' | 'birim' | 'miktar' | 'birimFiyat' | 'tutar';

export const METRAJ_SUTUN_ADI: Record<MetrajSutunu, string> = {
  poz: 'Poz no',
  tanim: 'Tanım / iş kalemi',
  birim: 'Birim',
  miktar: 'Miktar',
  birimFiyat: 'Birim fiyat',
  tutar: 'Tutar',
};

const BASLIK: Record<MetrajSutunu, RegExp> = {
  poz: /^poz|poz no|poz numarasi/,
  tanim: /tanim|aciklama|imalat|is kalemi|isin cinsi|cinsi|malzeme adi|kalem/,
  birim: /^birim$|^birimi$|^olcu birimi|^br\.?$/,
  miktar: /miktar|metraj|^adet$|^toplam$/,
  birimFiyat: /birim fiyat|b\.? ?fiyat|^fiyat$|^fiyati$/,
  tutar: /tutar|toplam tutar|^bedel/,
};

export type SutunEslemesi = Partial<Record<MetrajSutunu, number>>;

const metinOf = (h: HucreDegeri | undefined) => (h === null || h === undefined ? '' : String(h).trim());

/** Hücreden sayı: Excel sayısı ya da "1.234,56" / "1234.56" yazısı. */
export function hucreSayi(h: HucreDegeri | undefined): number | null {
  if (typeof h === 'number') return Number.isFinite(h) ? h : null;
  const m = metinOf(h).replace(/\s|₺|TL/gi, '');
  if (!m) return null;
  const tr = sayiOku(m);
  if (tr !== null) return tr;
  return /^-?\d+(\.\d+)?$/.test(m) ? Number(m) : null;
}

/** İlk 40 satırda tanım ve miktar sütunu olan satır başlıktır. */
export function basligiBul(satirlar: HucreDegeri[][]): { satir: number; sutunlar: SutunEslemesi } | null {
  for (let i = 0; i < Math.min(40, satirlar.length); i++) {
    const s: SutunEslemesi = {};
    (satirlar[i] ?? []).forEach((h, j) => {
      const a = aramaAnahtari(metinOf(h)).replace(/[:*]/g, '').trim();
      if (!a || a.length > 40) return;
      // Birim fiyat önce (yoksa "birim" de "birim fiyat"a uyardı).
      for (const k of ['birimFiyat', 'tutar', 'poz', 'birim', 'miktar', 'tanim'] as MetrajSutunu[])
        if (s[k] === undefined && BASLIK[k].test(a)) {
          s[k] = j;
          break;
        }
    });
    if (s.tanim !== undefined && s.miktar !== undefined) return { satir: i, sutunlar: s };
  }
  return null;
}

export interface MetrajSatiri {
  /** Excel satır numarası (1'den). */
  satirNo: number;
  poz: string;
  tanim: string;
  birim: string;
  miktar: number;
  birimFiyat: Kurus | null;
  tutar: Kurus | null;
  /** Üstteki miktarsız başlık satırı ("KABA İNŞAAT"). */
  grup: string;
}

const TOPLAM = /^(ara ?)?toplam|^genel toplam|^yekun|^kdv|^nakli yekun/;

export function metrajSatirlari(satirlar: HucreDegeri[][], baslik: number, s: SutunEslemesi): MetrajSatiri[] {
  if (s.tanim === undefined || s.miktar === undefined) return [];
  const sonuc: MetrajSatiri[] = [];
  let grup = '';
  for (let i = baslik + 1; i < satirlar.length; i++) {
    const r = satirlar[i] ?? [];
    const tanim = metinOf(r[s.tanim]).replace(/\s+/g, ' ');
    if (!tanim) continue;
    if (TOPLAM.test(aramaAnahtari(tanim))) continue;
    const miktar = hucreSayi(r[s.miktar]);
    if (miktar === null || miktar <= 0) {
      if (tanim.length <= 80) grup = tanim;
      continue;
    }
    const kurus = (k: MetrajSutunu) => {
      const n = s[k] !== undefined ? hucreSayi(r[s[k]!]) : null;
      return n === null || n < 0 ? null : Math.round(n * 100);
    };
    sonuc.push({
      satirNo: i + 1,
      poz: s.poz !== undefined ? metinOf(r[s.poz]) : '',
      tanim,
      birim: s.birim !== undefined ? metinOf(r[s.birim]) : '',
      miktar,
      birimFiyat: kurus('birimFiyat'),
      tutar: kurus('tutar'),
      grup,
    });
  }
  return sonuc;
}

/**
 * Satıra uyan fiyat listesi kalemleri: adı benzeyen ve birimi çevrilebilen; hesapta formül satırı olan kalem başa, sonra
 * malzeme. En çok 6.
 */
export function kalemOnerileri(m: Pick<MetrajSatiri, 'tanim' | 'birim'>, kalemler: FiyatKalemi[], hesaptakiler: Set<string>): FiyatKalemi[] {
  const uyan = kalemler.filter((k) => (!m.birim || birimCarpani(m.birim, k.birim) !== null) && (adBenzer(k.ad.split(' · ').at(-1)!, m.tanim) || adBenzer(m.tanim, k.ad)));
  // Önce benzerlik (kalem adının sözcük ve sayılarından kaçı tanımda geçiyor, oran), sonra hesapta olan, sonra malzeme.
  const t = adParcalari(m.tanim);
  const tanimda = [...t.sozcuk, ...t.sayili];
  const benzerlik = (k: FiyatKalemi) => {
    const p = adParcalari(k.ad.split(' · ').at(-1)!);
    const l = [...p.sozcuk, ...p.sayili];
    return l.length ? l.filter((x) => tanimda.some((y) => y.startsWith(x) || x.startsWith(y))).length / l.length : 0;
  };
  const puan = (k: FiyatKalemi) => -benzerlik(k) * 10 + (hesaptakiler.has(k.id) ? 0 : 2) + (k.tur === 'malzeme' ? 0 : 1);
  return uyan.sort((a, b) => puan(a) - puan(b)).slice(0, 6);
}

export type MetrajSecimi = { tur: 'kalem'; kalemId: string } | { tur: 'serbest'; satirTuru: MaliyetSatiri['tur'] } | { tur: 'alma' };

export interface MetrajAktarimi {
  /** Hesapta satırı olan kalemler: satır kimliği → yeni miktar, dayanak ve (Excel fiyatı istenirse) hesaba özel fiyat. */
  guncellenecek: Map<string, { miktar: number; dayanak: string; ozelFiyat?: Kurus | null }>;
  /** Hesaba eklenecek yeni satırlar. */
  eklenecek: Omit<MaliyetSatiri, 'id'>[];
  uyarilar: string[];
}

/**
 * Seçimlerden hesap değişiklikleri. Aynı kaleme giden satırların miktarı (kalem birimine çevrilip) toplanır; Excel'deki
 * birim fiyat isteğe bağlı hesaba özel fiyat olur.
 */
export function metrajAktarimi(
  dosyaAdi: string,
  satirlar: MetrajSatiri[],
  secimler: Map<number, MetrajSecimi>,
  kalemler: Map<string, FiyatKalemi>,
  hesapSatirlari: MaliyetSatiri[],
  excelFiyatlari: boolean,
): MetrajAktarimi {
  const uyarilar: string[] = [];
  const kaleme = new Map<string, { miktar: number; satirNolari: number[]; fiyat: Kurus | null }>();
  const eklenecek: Omit<MaliyetSatiri, 'id'>[] = [];
  const ref = (l: number[]) => (l.length > 3 ? `${l.slice(0, 3).join(', ')}… (${l.length} satır)` : l.join(', '));
  for (const m of satirlar) {
    const s = secimler.get(m.satirNo);
    if (!s || s.tur === 'alma') continue;
    if (s.tur === 'serbest') {
      eklenecek.push({
        fiyatKalemiId: null,
        tur: s.satirTuru,
        ad: m.tanim.slice(0, 120),
        birim: m.birim || 'adet',
        butceKalemiKodu: null,
        miktarKaynagi: 'proje',
        formulKodu: null,
        katsayi: null,
        miktar: Math.round(m.miktar * 100) / 100,
        dayanak: `${dosyaAdi}: satır ${m.satirNo}${m.poz ? `, poz ${m.poz}` : ''}`,
        ozelFiyat: excelFiyatlari ? m.birimFiyat : null,
        dondurulan: null,
      });
      continue;
    }
    const k = kalemler.get(s.kalemId);
    if (!k) continue;
    const c = m.birim ? birimCarpani(m.birim, k.birim) : 1;
    if (c === null) {
      uyarilar.push(`Satır ${m.satirNo}: "${m.birim}" birimi "${k.ad}" kaleminin birimine (${k.birim}) çevrilemedi, alınmadı.`);
      continue;
    }
    const t = kaleme.get(k.id) ?? { miktar: 0, satirNolari: [], fiyat: null };
    t.miktar += m.miktar / c;
    t.satirNolari.push(m.satirNo);
    if (m.birimFiyat !== null && t.fiyat === null) t.fiyat = Math.round(m.birimFiyat * c);
    kaleme.set(k.id, t);
  }
  const guncellenecek = new Map<string, { miktar: number; dayanak: string; ozelFiyat?: Kurus | null }>();
  for (const [kalemId, t] of kaleme) {
    const k = kalemler.get(kalemId)!;
    const miktar = Math.round(t.miktar * 100) / 100;
    const dayanak = `${dosyaAdi}: satır ${ref(t.satirNolari)} · ${sayiYaz(miktar)} ${k.birim}`;
    const mevcut = hesapSatirlari.find((x) => x.fiyatKalemiId === kalemId);
    if (mevcut) guncellenecek.set(mevcut.id, { miktar, dayanak, ...(excelFiyatlari && t.fiyat !== null ? { ozelFiyat: t.fiyat } : {}) });
    else
      eklenecek.push({
        fiyatKalemiId: k.id,
        tur: k.tur,
        ad: k.ad,
        birim: k.birim,
        butceKalemiKodu: k.butceKalemiKodu,
        miktarKaynagi: 'proje',
        formulKodu: null,
        katsayi: null,
        miktar,
        dayanak,
        ozelFiyat: excelFiyatlari ? t.fiyat : null,
        dondurulan: null,
      });
  }
  return { guncellenecek, eklenecek, uyarilar };
}
