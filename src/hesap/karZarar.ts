import type { BagimsizBolum, Kurus, Satis, Tarih } from '../veri/tipler';
import type { ButceOzeti } from './butce';
import { satisTutarlari, type SatisPlanSatiriDurumu } from './satis';

/**
 * Proje kâr/zarar ve nakit akışı (saf). Gelir KDV hariçtir: satışın KDV'si devlete ödenir. Maliyet firma ayarına göre
 * (KDV dahil/hariç) bütçe ağacından gelir. Hiçbir sonuç saklanmaz.
 */

export interface RaporSatisi {
  satis: Satis;
  bolum: BagimsizBolum;
  /** Plan satırlarının tahsil durumu (imzasızda hepsi "bekliyor"). */
  durumlar: SatisPlanSatiriDurumu[];
}

export interface RaporAlacagi {
  vadeTarihi: Tarih | null;
  tarih: Tarih;
  tutar: Kurus;
  kalan: Kurus;
}

export interface RaporBorcu {
  vadeTarihi: Tarih | null;
  tarih: Tarih;
  /** Cariye borç (tevkifat düşülmüş); ödenen = borç − kalan. */
  borc: Kurus;
  kalan: Kurus;
}

export interface KarZararGirdisi {
  butce: ButceOzeti;
  /** İptal edilmemiş satışlar (rezerve ve imzalı). */
  satislar: RaporSatisi[];
  /** Projenin iptal edilmemiş bağımsız bölümleri. */
  bolumler: BagimsizBolum[];
  /** İlave imalat alacakları (arsa sahibinden). */
  ilaveImalat: RaporAlacagi[];
  /** Projenin alış giderleri (iade hariç). */
  borclar: RaporBorcu[];
  bugun: Tarih;
  /** Kaç ay ileriye nakit akışı (bu ay dahil). */
  aySayisi?: number;
}

export interface SatisGrubu {
  adet: number;
  /** KDV dahil net bedel (fiyat − indirim). */
  net: Kurus;
  kdvHaric: Kurus;
  takas: Kurus;
}

export interface NakitAyi {
  /** 'YYYY-AA'; vadesi geçmişler için 'gecmis', sonrakiler için 'sonra'. */
  ay: string;
  giris: Kurus;
  cikis: Kurus;
  net: Kurus;
  /** Bu satıra kadar birikimli net. */
  birikimli: Kurus;
}

export interface KarZarar {
  gelir: {
    imzali: SatisGrubu;
    rezerve: SatisGrubu;
    /** Müteahhidin satılmamış bölümleri; tahmin imzalı satışların ortalamasından (brüt m² ya da adet). */
    satilmamis: { adet: number; tahmin: Kurus | null; yontem: 'm2' | 'adet' | null };
    ilaveImalat: Kurus;
    /** Arsa sahibine tahsisli bölüm sayısı (gelir doğurmaz). */
    arsaSahibiAdet: number;
    /** imzalı + rezerve + ilave imalat + satılmamış tahmini. */
    tahmini: Kurus;
  };
  maliyet: {
    gerceklesen: Kurus;
    butce: Kurus;
    /** Ana kalem başına bütçe ile gerçekleşenin büyüğü + kalemsiz; bütçe aşımı tahmine eklenir. */
    tahmini: Kurus;
    /** tahmini − gerçekleşen. */
    kalan: Kurus;
    /** Bütçesi olmayan kalem var mı (tahmin eksik olabilir). */
    butcesizKalemVar: boolean;
  };
  kar: {
    tahmini: Kurus;
    /** Kâr / tahmini gelir × 100; gelir yoksa null. */
    marj: number | null;
    /** Tahmini maliyeti karşılamak için satılmamış bölümlerden gereken toplam (kesin gelir sonrası); 0 = karşılandı. */
    basabasIcinGereken: Kurus;
    /** Satılmamış bölüm başına ortalama gereken; satılmamış yoksa null. */
    basabasBolumBasina: Kurus | null;
  };
  nakit: {
    tahsilEdilen: Kurus;
    odenen: Kurus;
    /** tahsil − ödenen. */
    fark: Kurus;
    bekleyenTahsilat: Kurus;
    odenecekBorc: Kurus;
    aylar: NakitAyi[];
  };
}

const ayAnahtari = (t: Tarih) => t.slice(0, 7);
const ayEkle = (ay: string, n: number) => {
  const [y, a] = ay.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, a - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

function grup(satislar: RaporSatisi[]): SatisGrubu {
  return satislar.reduce<SatisGrubu>(
    (g, x) => {
      const t = satisTutarlari(x.satis);
      return { adet: g.adet + 1, net: g.net + t.net, kdvHaric: g.kdvHaric + t.kdvHaric, takas: g.takas + t.takas };
    },
    { adet: 0, net: 0, kdvHaric: 0, takas: 0 },
  );
}

export function karZarar(g: KarZararGirdisi): KarZarar {
  // ─── Gelir ───
  const imzaliSatislar = g.satislar.filter((x) => x.satis.onay !== null);
  const imzali = grup(imzaliSatislar);
  const rezerve = grup(g.satislar.filter((x) => x.satis.onay === null));
  const satilan = new Set(g.satislar.map((x) => x.satis.bolumId));
  const arsaSahibiAdet = g.bolumler.filter((b) => b.sahiplik === 'arsa_sahibi').length;
  const satilmamislar = g.bolumler.filter((b) => b.sahiplik !== 'arsa_sahibi' && !satilan.has(b.id));

  // Tahmin: imzalı satışların brüt m² başına ortalaması (bütün satışlarda ve satılmamışlarda m² varsa), yoksa adet başına.
  let tahmin: Kurus | null = null;
  let yontem: 'm2' | 'adet' | null = null;
  if (satilmamislar.length > 0 && imzaliSatislar.length > 0) {
    const m2li = imzaliSatislar.every((x) => (x.bolum.brutM2 ?? 0) > 0) && satilmamislar.every((b) => (b.brutM2 ?? 0) > 0);
    if (m2li) {
      const m2 = imzaliSatislar.reduce((t, x) => t + x.bolum.brutM2!, 0);
      tahmin = Math.round((imzali.kdvHaric / m2) * satilmamislar.reduce((t, b) => t + b.brutM2!, 0));
      yontem = 'm2';
    } else {
      tahmin = Math.round((imzali.kdvHaric / imzali.adet) * satilmamislar.length);
      yontem = 'adet';
    }
  }
  const ilaveImalat = g.ilaveImalat.reduce((t, a) => t + a.tutar, 0);
  const kesinGelir = imzali.kdvHaric + rezerve.kdvHaric + ilaveImalat;
  const tahminiGelir = kesinGelir + (tahmin ?? 0);

  // ─── Maliyet ───
  const tahminiMaliyet = g.butce.dugumler.reduce((t, d) => t + Math.max(d.butce ?? 0, d.gerceklesen), 0) + g.butce.kalemsiz;
  const butcesizKalemVar = g.butce.dugumler.some((d) => d.butce === null || d.altlar.some((a) => a.butce === null));

  // ─── Kâr ───
  const kar = tahminiGelir - tahminiMaliyet;
  const gereken = Math.max(0, tahminiMaliyet - kesinGelir);

  // ─── Nakit ───
  const girisler: { tarih: Tarih; tutar: Kurus }[] = [];
  let tahsilEdilen = 0;
  for (const x of imzaliSatislar)
    for (const d of x.durumlar) {
      tahsilEdilen += d.tahsil;
      if (d.kalan > 0) girisler.push({ tarih: d.satir.vadeTarihi, tutar: d.kalan });
    }
  for (const a of g.ilaveImalat) {
    tahsilEdilen += a.tutar - a.kalan;
    if (a.kalan > 0) girisler.push({ tarih: a.vadeTarihi ?? a.tarih, tutar: a.kalan });
  }
  const cikislar = g.borclar.filter((b) => b.kalan > 0).map((b) => ({ tarih: b.vadeTarihi ?? b.tarih, tutar: b.kalan }));
  const odenen = g.borclar.reduce((t, b) => t + (b.borc - b.kalan), 0);

  const buAy = ayAnahtari(g.bugun);
  const aySayisi = g.aySayisi ?? 12;
  const sonAy = ayEkle(buAy, aySayisi - 1);
  const anahtar = (t: Tarih) => (t < g.bugun ? 'gecmis' : ayAnahtari(t) > sonAy ? 'sonra' : ayAnahtari(t));
  const sira = ['gecmis', ...Array.from({ length: aySayisi }, (_, i) => ayEkle(buAy, i)), 'sonra'];
  const toplam = new Map(sira.map((a) => [a, { giris: 0, cikis: 0 }]));
  for (const x of girisler) toplam.get(anahtar(x.tarih))!.giris += x.tutar;
  for (const x of cikislar) toplam.get(anahtar(x.tarih))!.cikis += x.tutar;
  let birikimli = 0;
  const aylar: NakitAyi[] = [];
  for (const ay of sira) {
    const t = toplam.get(ay)!;
    if ((ay === 'gecmis' || ay === 'sonra') && t.giris === 0 && t.cikis === 0) continue;
    birikimli += t.giris - t.cikis;
    aylar.push({ ay, giris: t.giris, cikis: t.cikis, net: t.giris - t.cikis, birikimli });
  }

  return {
    gelir: { imzali, rezerve, satilmamis: { adet: satilmamislar.length, tahmin, yontem }, ilaveImalat, arsaSahibiAdet, tahmini: tahminiGelir },
    maliyet: {
      gerceklesen: g.butce.gerceklesen,
      butce: g.butce.butce,
      tahmini: tahminiMaliyet,
      kalan: tahminiMaliyet - g.butce.gerceklesen,
      butcesizKalemVar,
    },
    kar: {
      tahmini: kar,
      marj: tahminiGelir > 0 ? (kar * 100) / tahminiGelir : null,
      basabasIcinGereken: gereken,
      basabasBolumBasina: satilmamislar.length > 0 ? Math.round(gereken / satilmamislar.length) : null,
    },
    nakit: {
      tahsilEdilen,
      odenen,
      fark: tahsilEdilen - odenen,
      bekleyenTahsilat: girisler.reduce((t, x) => t + x.tutar, 0),
      odenecekBorc: cikislar.reduce((t, x) => t + x.tutar, 0),
      aylar,
    },
  };
}

const AY_ADLARI = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

/** 'YYYY-AA' → "Kasım 2026"; 'gecmis' → "Vadesi geçmiş"; 'sonra' → "Sonrası". */
export function ayAdi(ay: string): string {
  if (ay === 'gecmis') return 'Vadesi geçmiş';
  if (ay === 'sonra') return 'Sonrası';
  const [y, a] = ay.split('-');
  return `${AY_ADLARI[Number(a) - 1]} ${y}`;
}

// ─── Firma geneli ─────────────────────────────────────────────────────

export interface ProjeRaporSatiri {
  projeId: string;
  ad: string;
  rapor: KarZarar;
}

export interface FirmaRaporu {
  projeler: ProjeRaporSatiri[];
  /** Projeye bağlı olmayan giderler (şirket genel gideri). */
  genel: { harcanan: Kurus; odenecek: Kurus };
  gelir: Kurus;
  /** Proje tahmini maliyetleri + genel giderler. */
  maliyet: Kurus;
  kar: Kurus;
  marj: number | null;
  tahsilEdilen: Kurus;
  odenen: Kurus;
  bekleyenTahsilat: Kurus;
  odenecekBorc: Kurus;
  /** Kasa ve bankalardaki TL (kredi kartı borcu düşülmüş); nakit akışının başlangıcı. */
  eldeki: Kurus;
  /** Projelerin ve genel giderlerin aylık akışı toplanmış; birikimli, eldeki paradan başlar. */
  aylar: NakitAyi[];
}

/**
 * Projelerin raporlarını toplar. `genelBorclar`: projesiz alış giderlerinin borçları (vadesine göre çıkış),
 * `genelHarcanan`: projesiz giderlerin maliyeti (KDV ayarına göre). Aylar projelerin aylarıyla aynı anahtarlardadır.
 */
export function firmaRaporu(g: {
  projeler: ProjeRaporSatiri[];
  genelHarcanan: Kurus;
  genelBorclar: RaporBorcu[];
  eldeki: Kurus;
  bugun: Tarih;
  aySayisi?: number;
}): FirmaRaporu {
  const t = (f: (r: KarZarar) => Kurus) => g.projeler.reduce((s, p) => s + f(p.rapor), 0);
  // Genel giderlerin akışı, projesiz bir "rapor" gibi hesaplanır (gelir yok).
  const genelAkis = karZarar({
    butce: { dugumler: [], butce: 0, gerceklesen: 0, kalemsiz: 0, butcesizHarcama: 0 },
    satislar: [],
    bolumler: [],
    ilaveImalat: [],
    borclar: g.genelBorclar,
    bugun: g.bugun,
    aySayisi: g.aySayisi,
  }).nakit;

  const toplam = new Map<string, { giris: Kurus; cikis: Kurus }>();
  const sira: string[] = [];
  for (const a of [...g.projeler.flatMap((p) => p.rapor.nakit.aylar), ...genelAkis.aylar]) {
    if (!toplam.has(a.ay)) {
      toplam.set(a.ay, { giris: 0, cikis: 0 });
      sira.push(a.ay);
    }
    const x = toplam.get(a.ay)!;
    x.giris += a.giris;
    x.cikis += a.cikis;
  }
  const deger = (ay: string) => (ay === 'gecmis' ? '0000' : ay === 'sonra' ? '9999' : ay);
  sira.sort((a, b) => deger(a).localeCompare(deger(b)));
  let birikimli = g.eldeki;
  const aylar = sira.map((ay) => {
    const x = toplam.get(ay)!;
    birikimli += x.giris - x.cikis;
    return { ay, giris: x.giris, cikis: x.cikis, net: x.giris - x.cikis, birikimli };
  });

  const gelir = t((r) => r.gelir.tahmini);
  const maliyet = t((r) => r.maliyet.tahmini) + g.genelHarcanan;
  const kar = gelir - maliyet;
  return {
    projeler: [...g.projeler].sort((a, b) => b.rapor.kar.tahmini - a.rapor.kar.tahmini),
    genel: { harcanan: g.genelHarcanan, odenecek: genelAkis.odenecekBorc },
    gelir,
    maliyet,
    kar,
    marj: gelir > 0 ? (kar * 100) / gelir : null,
    tahsilEdilen: t((r) => r.nakit.tahsilEdilen),
    odenen: t((r) => r.nakit.odenen) + genelAkis.odenen,
    bekleyenTahsilat: t((r) => r.nakit.bekleyenTahsilat),
    odenecekBorc: t((r) => r.nakit.odenecekBorc) + genelAkis.odenecekBorc,
    eldeki: g.eldeki,
    aylar,
  };
}
