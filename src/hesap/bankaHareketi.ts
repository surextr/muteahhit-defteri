import type { Kurus, Tarih } from '../veri/tipler';
import { hucreSayi } from './metraj';
import { aramaAnahtari } from './metin';
import type { HucreDegeri } from './tabloOku';

// Banka hesap hareketleri dosyası (saf): sütunları bulur, hareketleri okur (giriş artı, çıkış eksi), programdaki
// hareketlerle eşler (aynı yön ve tutar, ±3 gün) ve kayıtlı olmayanlara tür/cari önerir. Dosya cihazda okunur.

export type BankaSutunu = 'tarih' | 'aciklama' | 'tutar' | 'borc' | 'alacak' | 'bakiye';

export const BANKA_SUTUN_ADI: Record<BankaSutunu, string> = {
  tarih: 'Tarih',
  aciklama: 'Açıklama',
  tutar: 'Tutar (+ giriş / − çıkış)',
  borc: 'Borç (çıkan)',
  alacak: 'Alacak (giren)',
  bakiye: 'Bakiye',
};

const BASLIK: Record<BankaSutunu, RegExp> = {
  tarih: /^tarih|islem tarihi|^valor|^tarih\/saat/,
  aciklama: /aciklama|^detay|islem detayi|^aciklamalar|^islem$|^islem adi/,
  tutar: /^tutar|islem tutari|^miktar|^tutar \(tl\)/,
  borc: /^borc|^cikan|^cikis|^giden|^harcama/,
  alacak: /^alacak|^giren|^giris|^gelen|^yatan/,
  bakiye: /bakiye/,
};

export type BankaSutunlari = Partial<Record<BankaSutunu, number>>;

const metinOf = (h: HucreDegeri | undefined) => (h === null || h === undefined ? '' : String(h).trim());

/** İlk 40 satırda tarih ile (tutar ya da borç/alacak) sütunu olan satır başlıktır. */
export function bankaBasligiBul(satirlar: HucreDegeri[][]): { satir: number; sutunlar: BankaSutunlari } | null {
  for (let i = 0; i < Math.min(40, satirlar.length); i++) {
    const s: BankaSutunlari = {};
    (satirlar[i] ?? []).forEach((h, j) => {
      const a = aramaAnahtari(metinOf(h)).replace(/[:*]/g, '').trim();
      if (!a || a.length > 40) return;
      // Bakiye önce ("bakiye tutarı" tutar sayılmasın), sonra borç/alacak, tutar, tarih, açıklama.
      for (const k of ['bakiye', 'borc', 'alacak', 'tutar', 'tarih', 'aciklama'] as BankaSutunu[])
        if (s[k] === undefined && BASLIK[k].test(a)) {
          s[k] = j;
          break;
        }
    });
    if (s.tarih !== undefined && (s.tutar !== undefined || (s.borc !== undefined && s.alacak !== undefined))) return { satir: i, sutunlar: s };
  }
  return null;
}

/** Excel seri günü (1900 sistemi) ya da "31.10.2026", "31/10/2026 14:05", "2026-10-31". */
export function tarihOku(h: HucreDegeri | undefined): Tarih | null {
  if (typeof h === 'number') {
    if (h < 20000 || h > 80000) return null;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(h) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const m = metinOf(h);
  let x = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/.exec(m);
  if (x) return gecerli(`${x[3]}-${x[2]!.padStart(2, '0')}-${x[1]!.padStart(2, '0')}`);
  x = /^(\d{4})-(\d{2})-(\d{2})/.exec(m);
  return x ? gecerli(`${x[1]}-${x[2]}-${x[3]}`) : null;
}

const gecerli = (t: string) => {
  const d = new Date(`${t}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === t ? t : null;
};

export interface BankaHareketi {
  satirNo: number;
  tarih: Tarih;
  aciklama: string;
  /** Giriş artı, çıkış eksi. */
  tutar: Kurus;
  bakiye: Kurus | null;
}

export function bankaHareketleri(satirlar: HucreDegeri[][], baslik: number, s: BankaSutunlari): BankaHareketi[] {
  const sonuc: BankaHareketi[] = [];
  const kurus = (h: HucreDegeri | undefined) => {
    const n = hucreSayi(h);
    return n === null ? null : Math.round(n * 100);
  };
  for (let i = baslik + 1; i < satirlar.length; i++) {
    const r = satirlar[i] ?? [];
    const tarih = s.tarih !== undefined ? tarihOku(r[s.tarih]) : null;
    if (!tarih) continue;
    let tutar: Kurus | null = null;
    if (s.borc !== undefined || s.alacak !== undefined) {
      const borc = s.borc !== undefined ? kurus(r[s.borc]) : null;
      const alacak = s.alacak !== undefined ? kurus(r[s.alacak]) : null;
      // Bazı bankalar borcu eksi yazar; işaret yönden gelir.
      if (alacak) tutar = Math.abs(alacak);
      else if (borc) tutar = -Math.abs(borc);
    }
    if (tutar === null && s.tutar !== undefined) tutar = kurus(r[s.tutar]);
    if (!tutar) continue;
    sonuc.push({
      satirNo: i + 1,
      tarih,
      aciklama: s.aciklama !== undefined ? metinOf(r[s.aciklama]).replace(/\s+/g, ' ') : '',
      tutar,
      bakiye: s.bakiye !== undefined ? kurus(r[s.bakiye]) : null,
    });
  }
  return sonuc;
}

export interface MevcutHareket {
  id: string;
  tarih: Tarih;
  /** Hesaba giriş artı, çıkış eksi. */
  tutar: Kurus;
}

const gunFarki = (a: Tarih, b: Tarih) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * Dosyadaki hareketi programdaki hareketle eşler: aynı tutar ve yön, tarih farkı en çok `tolerans` gün; her mevcut
 * hareket bir kez kullanılır, tarihi en yakın olan seçilir. Dönüş: satır no → mevcut hareket kimliği.
 */
export function kayitliOlanlar(hareketler: BankaHareketi[], mevcut: MevcutHareket[], tolerans = 3): Map<number, string> {
  const kullanildi = new Set<string>();
  const sonuc = new Map<number, string>();
  // Önce aynı gün eşleşenler (yanlış eşleşmeyi azaltır), sonra toleranslılar.
  for (const tur of [0, tolerans]) {
    for (const h of hareketler) {
      if (sonuc.has(h.satirNo)) continue;
      let en: MevcutHareket | null = null;
      for (const m of mevcut) {
        if (kullanildi.has(m.id) || m.tutar !== h.tutar) continue;
        const f = gunFarki(m.tarih, h.tarih);
        if (f <= tur && (!en || f < gunFarki(en.tarih, h.tarih))) en = m;
      }
      if (en) {
        kullanildi.add(en.id);
        sonuc.set(h.satirNo, en.id);
      }
    }
  }
  return sonuc;
}

export type HareketTuru = 'odeme' | 'tahsilat' | 'masraf' | 'transfer' | 'kredi' | 'atla';

export const HAREKET_TURU_ADI: Record<HareketTuru, string> = {
  odeme: 'Cariye ödeme',
  tahsilat: 'Cariden tahsilat',
  masraf: 'Banka masrafı (gider)',
  transfer: 'Hesaplar arası transfer',
  kredi: 'Kredi taksiti',
  atla: 'Kaydetme',
};

/** Ad karşılaştırmasında anlamsız sözcükler (şirket türü, sektör). */
const GENEL = new Set(['ltd', 'sti', 'san', 'tic', 'ticaret', 'sanayi', 'insaat', 'limited', 'sirketi', 'anonim', 'as', 'a.s', 've', 'yapi', 'malzemeleri', 'grup']);
const sozcukler = (m: string) =>
  aramaAnahtari(m)
    .split(/[^a-z0-9]+/)
    .filter((x) => x.length >= 3 && !GENEL.has(x));

/** Açıklamada adı en iyi geçen cari: adının anlamlı sözcüklerinin en az yarısı (en az biri 4+ harf) açıklamada olmalı. */
export function cariOner(aciklama: string, cariler: { id: string; ad: string }[]): string | null {
  const metin = new Set(sozcukler(aciklama));
  let en: { id: string; puan: number } | null = null;
  for (const c of cariler) {
    const s = sozcukler(c.ad);
    if (!s.length) continue;
    const bulunan = s.filter((x) => metin.has(x));
    if (!bulunan.some((x) => x.length >= 4)) continue;
    const puan = bulunan.length / s.length + bulunan.length * 0.01;
    if (puan >= 0.5 && (!en || puan > en.puan)) en = { id: c.id, puan };
  }
  return en?.id ?? null;
}

/** Tür önerisi: açıklamadaki sözcüklerden ve carinin bulunup bulunmadığından. */
export function turOner(h: Pick<BankaHareketi, 'aciklama' | 'tutar'>, cariVar: boolean, krediTaksitiVar: boolean): HareketTuru {
  const a = aramaAnahtari(h.aciklama);
  if (/virman|hesaplar arasi|kendi hesab/.test(a)) return 'transfer';
  if (h.tutar < 0 && krediTaksitiVar && /kredi|taksit/.test(a)) return 'kredi';
  if (h.tutar < 0 && !cariVar && /masraf|komisyon|ucret|bsmv|kesinti|aidat|hesap isletim|kart yillik/.test(a)) return 'masraf';
  if (cariVar) return h.tutar < 0 ? 'odeme' : 'tahsilat';
  return 'atla';
}
