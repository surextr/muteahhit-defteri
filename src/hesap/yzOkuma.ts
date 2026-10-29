import type { HavuzTanima, Kurus, Tarih, YzBelgeTuru, YzCek, YzDekont, YzOkuma, YzSozlesme, YzTaraf } from '../veri/tipler';
import { tarihOku, tutarOku } from './eFatura';

// Yapay zekânın döndürdüğü JSON'u güvenli tiplere çevirir (saf). Yanıt güvenilmez veridir: her alan denetlenir,
// tanınmayan alan atılır, eksik alan null olur. Program bilgiyi uydurmaz; boş kalan alanı kullanıcı doldurur.

type Ham = Record<string, unknown>;
const nesne = (d: unknown): Ham | null => (d && typeof d === 'object' && !Array.isArray(d) ? (d as Ham) : null);
const liste = (d: unknown): unknown[] => (Array.isArray(d) ? d : []);
const metin = (d: unknown, enUzun = 300): string | null => {
  if (typeof d === 'number' && Number.isFinite(d)) return String(d);
  if (typeof d !== 'string') return null;
  const s = d.trim().replace(/\s+/g, ' ');
  return s && s.toLowerCase() !== 'null' ? s.slice(0, enUzun) : null;
};
const sayi = (d: unknown): number | null => {
  if (typeof d === 'number') return Number.isFinite(d) ? d : null;
  const k = tutarOku(d);
  return k === null ? null : k / 100;
};
const tutar = (d: unknown): Kurus | null => tutarOku(d);
const tarih = (d: unknown): Tarih | null => tarihOku(d);
const rakam = (d: unknown, uzunluklar: number[]) => {
  const r = (metin(d) ?? '').replace(/\D/g, '');
  return uzunluklar.includes(r.length) ? r : null;
};
const iban = (d: unknown) => {
  const s = (metin(d) ?? '').replace(/\s/g, '').toUpperCase();
  return /^TR\d{24}$/.test(s) ? s : null;
};
const secim = <T extends string>(d: unknown, secenekler: readonly T[], varsayilan: T): T => (secenekler.includes(d as T) ? (d as T) : varsayilan);

export const YZ_BELGE_TURLERI: readonly YzBelgeTuru[] = [
  'fatura',
  'fis',
  'dekont',
  'cek',
  'senet',
  'sozlesme_usta',
  'sozlesme_kat_karsiligi',
  'sozlesme_satis',
  'ruhsat',
  'iskan',
  'tapu',
  'proje_cizimi',
  'santiye_fotografi',
  'kimlik',
  'vergi_levhasi',
  'irsaliye',
  'diger',
];

export const YZ_TUR_ADI: Record<YzBelgeTuru, string> = {
  fatura: 'Fatura',
  fis: 'Fiş',
  dekont: 'Banka dekontu',
  cek: 'Çek',
  senet: 'Senet',
  sozlesme_usta: 'Usta / taşeron sözleşmesi',
  sozlesme_kat_karsiligi: 'Kat karşılığı sözleşmesi',
  sozlesme_satis: 'Satış sözleşmesi / protokol',
  ruhsat: 'Yapı ruhsatı',
  iskan: 'İskân',
  tapu: 'Tapu',
  proje_cizimi: 'Proje çizimi',
  santiye_fotografi: 'Şantiye fotoğrafı',
  kimlik: 'Kimlik',
  vergi_levhasi: 'Vergi levhası',
  irsaliye: 'İrsaliye',
  diger: 'Diğer',
};

/** Fatura/fiş kısmı → HavuzTanima (kaynak 'yz'). Tutar yoksa null. */
export function yzFaturasi(d: unknown): HavuzTanima | null {
  const f = nesne(d);
  if (!f) return null;
  const kdvler = liste(f.kdvler)
    .map(nesne)
    .flatMap((k) => {
      if (!k) return [];
      const oran = sayi(k.oran) ?? 0;
      const kdv = tutar(k.kdv);
      const matrah = tutar(k.matrah) ?? (kdv !== null && oran > 0 ? Math.round((kdv * 100) / oran) : null);
      return matrah === null ? [] : [{ oran, matrah, kdv: kdv ?? Math.round((matrah * oran) / 100) }];
    });
  const satirlar = liste(f.satirlar)
    .map(nesne)
    .flatMap((x) => {
      if (!x) return [];
      const t = tutar(x.tutar);
      if (t === null) return [];
      return [{ ad: metin(x.ad, 200) ?? '', miktar: sayi(x.miktar), birim: metin(x.birim, 20), tutar: t, kdvOrani: sayi(x.kdv_orani) ?? 0, tevkifat: null }];
    });
  const odenecek = tutar(f.odenecek);
  // KDV dökümü yoksa yalnız ödenecek tutar (fişlerde çoğu zaman): KDV dahil tek satır olarak alınır.
  if (kdvler.length === 0 && satirlar.length === 0 && odenecek === null) return null;
  return {
    kaynak: 'yz',
    satici: {
      vergiNo: rakam(f.satici_vkn, [10, 11]),
      ad: metin(f.satici_unvan, 200),
      adres: metin(f.satici_adres, 300),
      telefon: metin(f.satici_telefon, 30),
      vergiDairesi: metin(f.satici_vergi_dairesi, 80),
    },
    aliciVergiNo: rakam(f.alici_vkn, [10, 11]),
    faturaNo: metin(f.fatura_no, 40),
    tarih: tarih(f.tarih),
    ettn: null,
    iade: f.iade === true,
    paraBirimi: (metin(f.para_birimi, 5) ?? 'TRY').toUpperCase().replace('TL', 'TRY'),
    kdvler,
    tevkifat: Math.abs(tutar(f.tevkifat) ?? 0),
    odenecek,
    satirlar,
  };
}

function yzDekont(d: unknown): YzDekont | null {
  const x = nesne(d);
  if (!x) return null;
  return {
    tarih: tarih(x.tarih),
    tutar: tutar(x.tutar) === null ? null : Math.abs(tutar(x.tutar)!),
    paraBirimi: (metin(x.para_birimi, 5) ?? 'TRY').toUpperCase().replace('TL', 'TRY'),
    gonderenAd: metin(x.gonderen_ad, 200),
    gonderenIban: iban(x.gonderen_iban),
    aliciAd: metin(x.alici_ad, 200),
    aliciIban: iban(x.alici_iban),
    banka: metin(x.banka, 80),
    aciklama: metin(x.aciklama, 300),
  };
}

function yzCek(d: unknown): YzCek | null {
  const x = nesne(d);
  if (!x) return null;
  return {
    tur: secim(x.tur, ['cek', 'senet'] as const, 'cek'),
    banka: metin(x.banka, 80),
    sube: metin(x.sube, 80),
    seriNo: metin(x.seri_no, 40),
    vade: tarih(x.vade),
    tutar: tutar(x.tutar) === null ? null : Math.abs(tutar(x.tutar)!),
    kesideci: metin(x.kesideci, 200),
    lehtar: metin(x.lehtar, 200),
  };
}

/** amac 'tani' yanıtı → okuma (+ varsa fatura/fiş tanıması). */
export function yzTaniCevir(d: unknown, zaman: string): { okuma: YzOkuma; fatura: HavuzTanima | null } {
  const x = nesne(d) ?? {};
  const tur = secim(x.tur, YZ_BELGE_TURLERI, 'diger');
  const b = nesne(x.belge);
  return {
    okuma: {
      zaman,
      tur,
      guven: secim(x.guven, ['yuksek', 'orta', 'dusuk'] as const, 'dusuk'),
      ozet: metin(x.ozet, 200) ?? YZ_TUR_ADI[tur],
      dekont: yzDekont(x.dekont),
      cek: yzCek(x.cek),
      belge: b
        ? {
            tarih: tarih(b.tarih),
            ada: metin(b.ada, 20),
            parsel: metin(b.parsel, 20),
            adres: metin([b.mahalle, b.adres, b.ilce, b.il].map((v) => metin(v)).filter(Boolean).join(' '), 300),
            kisiAdi: metin(b.kisi_adi, 200),
            kisiNo: rakam(b.kisi_tc, [11]) ?? rakam(b.kisi_vkn, [10]),
          }
        : null,
      sozlesme: null,
    },
    fatura: tur === 'fatura' || tur === 'fis' || tur === 'irsaliye' ? yzFaturasi(x.fatura) : null,
  };
}

const taraf = (d: unknown): YzTaraf => {
  const x = nesne(d) ?? {};
  return { ad: metin(x.ad, 200), no: rakam(x.tc_vkn, [10, 11]), telefon: metin(x.telefon, 30), adres: metin(x.adres, 300), yetkili: metin(x.yetkili, 120) };
};
const odemeler = (d: unknown) =>
  liste(d)
    .map(nesne)
    .flatMap((o) => (o ? [{ vade: tarih(o.vade), tutar: tutar(o.tutar), aciklama: metin(o.aciklama, 200) ?? '' }] : []))
    .filter((o) => o.vade || o.tutar !== null);

/** amac 'sozlesme' yanıtı. */
export function yzSozlesmeCevir(d: unknown): YzSozlesme {
  const x = nesne(d) ?? {};
  const u = nesne(x.usta);
  const k = nesne(x.kat_karsiligi);
  const s = nesne(x.satis);
  const ceza = nesne(k?.gecikme_cezasi);
  const cezaTutari = tutar(ceza?.tutar);
  return {
    tur: secim(x.tur, ['usta', 'kat_karsiligi', 'satis', 'diger'] as const, 'diger'),
    tarih: tarih(x.tarih),
    karsiTaraf: taraf(x.karsi_taraf),
    usta: u
      ? {
          isler: liste(u.isler).flatMap((i) => (metin(i, 80) ? [metin(i, 80)!] : [])),
          kalemler: liste(u.kalemler)
            .map(nesne)
            .flatMap((y) => {
              const ad = y && metin(y.ad, 200);
              return y && ad ? [{ is: metin(y.is, 80), ad, birim: metin(y.birim, 20), miktar: sayi(y.miktar), birimFiyat: tutar(y.birim_fiyat) }] : [];
            }),
          toplamTutar: tutar(u.toplam_tutar),
          baslama: tarih(u.baslama),
          bitis: tarih(u.bitis),
          hakedisSekli: metin(u.hakedis_sekli, 300),
          teminatOrani: sayi(u.teminat_orani),
          ozelSartlar: liste(u.ozel_sartlar).flatMap((m) => (metin(m, 2000) ? [metin(m, 2000)!] : [])),
          odemePlani: odemeler(u.odeme_plani),
        }
      : null,
    katKarsiligi: k
      ? {
          arsaSahipleri: liste(k.arsa_sahipleri)
            .map(nesne)
            .flatMap((a) => (a && metin(a.ad, 200) ? [{ ad: metin(a.ad, 200)!, no: rakam(a.tc, [10, 11]), hisse: sayi(a.hisse) }] : [])),
          arsaSahibiOrani: sayi(k.arsa_sahibi_orani),
          ada: metin(k.ada, 20),
          parsel: metin(k.parsel, 20),
          teslimTarihi: tarih(k.teslim_tarihi),
          teslimSuresiAy: sayi(k.teslim_suresi_ay),
          gecikmeCezasi: cezaTutari ? { tutar: cezaTutari, birim: secim(ceza?.birim, ['daire_aylik', 'toplam_aylik', 'gunluk'] as const, 'daire_aylik') } : null,
          kiraYardimiAylik: tutar(k.kira_yardimi_aylik),
          nakitOdemeler: odemeler(k.nakit_odemeler),
        }
      : null,
    satis: s
      ? {
          blok: metin(s.blok, 20),
          daireNo: metin(s.daire_no, 20),
          fiyat: tutar(s.fiyat),
          paraBirimi: (metin(s.para_birimi, 5) ?? 'TRY').toUpperCase().replace('TL', 'TRY'),
          kdvOrani: sayi(s.kdv_orani),
          kapora: tutar(s.kapora),
          plan: liste(s.plan)
            .map(nesne)
            .flatMap((p) => (p ? [{ tur: secim(p.tur, ['kapora', 'pesinat', 'taksit', 'teslimde'] as const, 'taksit'), vade: tarih(p.vade), tutar: tutar(p.tutar) }] : []))
            .filter((p) => p.tutar !== null),
          teslimTarihi: tarih(s.teslim_tarihi),
        }
      : null,
    eksikler: liste(x.eksikler).flatMap((e) => (metin(e, 300) ? [metin(e, 300)!] : [])),
  };
}

/** Yapay zekâ tahminine göre havuzda önerilecek iş. */
export type YzOnerisi = 'gider' | 'odeme' | 'tahsilat' | 'cek' | 'sozlesme' | 'proje' | 'cari' | null;

/** Dekont yönü: alıcı biz isek tahsilat, gönderen biz isek ödeme. Bizim IBAN'larımız ve firma adıyla karşılaştırılır. */
export function dekontYonu(d: YzDekont, firmaAdi: string, ibanlarimiz: string[]): 'odeme' | 'tahsilat' | null {
  const bizim = new Set(ibanlarimiz.map((i) => i.replace(/\s/g, '').toUpperCase()));
  if (d.aliciIban && bizim.has(d.aliciIban)) return 'tahsilat';
  if (d.gonderenIban && bizim.has(d.gonderenIban)) return 'odeme';
  const sade = (s: string | null) => (s ?? '').toLocaleLowerCase('tr-TR').replace(/[^a-zçğıöşü0-9]/g, '');
  const ilk = sade(firmaAdi).slice(0, 8);
  if (ilk.length >= 4 && sade(d.aliciAd).includes(ilk)) return 'tahsilat';
  if (ilk.length >= 4 && sade(d.gonderenAd).includes(ilk)) return 'odeme';
  return null;
}

export function yzOnerisi(o: YzOkuma): YzOnerisi {
  switch (o.tur) {
    case 'fatura':
    case 'fis':
      return 'gider';
    case 'dekont':
      return 'odeme';
    case 'cek':
    case 'senet':
      return 'cek';
    case 'sozlesme_usta':
    case 'sozlesme_kat_karsiligi':
    case 'sozlesme_satis':
      return 'sozlesme';
    case 'ruhsat':
    case 'iskan':
    case 'tapu':
    case 'proje_cizimi':
    case 'santiye_fotografi':
      return 'proje';
    case 'kimlik':
    case 'vergi_levhasi':
      return 'cari';
    default:
      return null;
  }
}
