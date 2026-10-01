import type { Depo } from '../veri/depo';
import type {
  BagimsizBolum,
  Blok,
  Kat,
  KatTipi,
  OrtakAlan,
  Proje,
  ProjeAlanlari,
  TakipBasligi,
  Tarih,
} from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// ─── Bina sihirbazı: girdiden kat ve bölüm planı ───────────────────

export interface BlokGirdisi {
  ad: string;
  bodrumKatSayisi: number;
  /** Her bodrum kattaki bağımsız bölüm (dükkan/depo) sayısı; genelde 0. */
  bodrumKatBolumSayisi: number;
  zeminBolumSayisi: number;
  zeminBolumTipi: 'daire' | 'dukkan';
  normalKatSayisi: number;
  katBasinaDaire: number;
  /** Çatı dubleksi daire sayısı; 0 ise çatı katı yok. */
  catiDubleksSayisi: number;
}

export const BOS_BLOK: BlokGirdisi = {
  ad: 'A',
  bodrumKatSayisi: 0,
  bodrumKatBolumSayisi: 0,
  zeminBolumSayisi: 2,
  zeminBolumTipi: 'daire',
  normalKatSayisi: 5,
  katBasinaDaire: 4,
  catiDubleksSayisi: 0,
};

export const SINIRLAR = { blok: 10, bodrumKat: 5, normalKat: 40, katBasina: 20 } as const;

export interface PlanBolumu {
  no: string;
  tip: BagimsizBolum['tip'];
}

export interface PlanKati {
  ad: string;
  tip: KatTipi;
  sira: number;
  bolumler: PlanBolumu[];
}

export interface PlanBlogu {
  ad: string;
  katlar: PlanKati[];
}

export interface BinaPlani {
  bloklar: PlanBlogu[];
  daireSayisi: number;
  dukkanSayisi: number;
}

function blokHatalari(b: BlokGirdisi, etiket: string): string[] {
  const hatalar: string[] = [];
  const aralik = (deger: number, en: number, enCok: number, ad: string) => {
    if (!Number.isInteger(deger) || deger < en || deger > enCok) {
      hatalar.push(`${etiket}: ${ad} ${en} ile ${enCok} arasında bir tam sayı olmalı.`);
    }
  };
  if (!b.ad.trim()) hatalar.push(`${etiket}: blok adı boş olamaz.`);
  aralik(b.bodrumKatSayisi, 0, SINIRLAR.bodrumKat, 'bodrum kat sayısı');
  aralik(b.bodrumKatBolumSayisi, 0, SINIRLAR.katBasina, 'bodrum kattaki bölüm sayısı');
  aralik(b.zeminBolumSayisi, 0, SINIRLAR.katBasina, 'zemin kattaki bölüm sayısı');
  aralik(b.normalKatSayisi, 0, SINIRLAR.normalKat, 'normal kat sayısı');
  aralik(b.katBasinaDaire, 0, SINIRLAR.katBasina, 'kat başına daire');
  aralik(b.catiDubleksSayisi, 0, SINIRLAR.katBasina, 'çatı dubleksi sayısı');
  if (b.normalKatSayisi > 0 && b.katBasinaDaire === 0) {
    hatalar.push(`${etiket}: normal katlar için kat başına daire sayısı girin.`);
  }
  return hatalar;
}

/**
 * "5 kat, her katta 4 daire" gibi girdiden katları ve numaralı bölümleri üretir.
 * Numaralar blok içinde, en alt kattan yukarı: daireler 1, 2, 3…; dükkanlar D1, D2…
 * Kat sırası: bodrumlar eksi, zemin 0, normal katlar 1…n, çatı n+1.
 */
export function binaPlaniHazirla(girdiler: BlokGirdisi[]): { plan: BinaPlani | null; hatalar: string[] } {
  const hatalar: string[] = [];
  if (girdiler.length === 0) hatalar.push('En az bir blok olmalı.');
  if (girdiler.length > SINIRLAR.blok) hatalar.push(`En fazla ${SINIRLAR.blok} blok eklenebilir.`);

  const adlar = girdiler.map((b) => b.ad.trim().toLocaleUpperCase('tr-TR'));
  if (new Set(adlar).size !== adlar.length) hatalar.push('Blok adları birbirinden farklı olmalı.');
  girdiler.forEach((b, i) => hatalar.push(...blokHatalari(b, `${i + 1}. blok`)));
  if (hatalar.length > 0) return { plan: null, hatalar };

  let daireSayisi = 0;
  let dukkanSayisi = 0;
  const bloklar = girdiler.map((b): PlanBlogu => {
    let daireNo = 0;
    let dukkanNo = 0;
    const bolumler = (adet: number, tip: 'daire' | 'dukkan'): PlanBolumu[] =>
      Array.from({ length: adet }, () =>
        tip === 'daire' ? { no: String(++daireNo), tip } : { no: `D${++dukkanNo}`, tip },
      );

    const katlar: PlanKati[] = [];
    for (let i = b.bodrumKatSayisi; i >= 1; i--) {
      katlar.push({ ad: `${i}. Bodrum`, tip: 'bodrum', sira: -i, bolumler: bolumler(b.bodrumKatBolumSayisi, 'dukkan') });
    }
    katlar.push({ ad: 'Zemin', tip: 'zemin', sira: 0, bolumler: bolumler(b.zeminBolumSayisi, b.zeminBolumTipi) });
    for (let i = 1; i <= b.normalKatSayisi; i++) {
      katlar.push({ ad: `${i}. Kat`, tip: 'normal', sira: i, bolumler: bolumler(b.katBasinaDaire, 'daire') });
    }
    if (b.catiDubleksSayisi > 0) {
      katlar.push({
        ad: 'Çatı Katı',
        tip: 'cati_dubleksi',
        sira: b.normalKatSayisi + 1,
        bolumler: bolumler(b.catiDubleksSayisi, 'daire'),
      });
    }
    daireSayisi += daireNo;
    dukkanSayisi += dukkanNo;
    return { ad: b.ad.trim(), katlar };
  });

  if (daireSayisi + dukkanSayisi === 0) {
    return { plan: null, hatalar: ['Binada en az bir bağımsız bölüm (daire veya dükkan) olmalı.'] };
  }
  return { plan: { bloklar, daireSayisi, dukkanSayisi }, hatalar: [] };
}

// ─── Proje oluşturma ───────────────────────────────────────────────

export interface ProjeGirdisi {
  ad: string;
  adres: string;
  ada: string;
  parsel: string;
  arsaTipi: Proje['arsaTipi'];
  baslangicTarihi: Tarih | null;
  alanlar: ProjeAlanlari;
}

/** Planda sıralı değil, paralel yürüyen takip başlıkları. */
export const VARSAYILAN_TAKIP_BASLIKLARI = ['Anlaşma', 'Ruhsat', 'Kaba inşaat', 'İnce inşaat', 'İskan', 'Satış'];

/** Alanlar açık tanımlıdır; ekranda bu açıklamalarla gösterilir. */
export const ALAN_TANIMLARI: Record<keyof ProjeAlanlari, { etiket: string; aciklama: string }> = {
  net: { etiket: 'Net alan (m²)', aciklama: 'Bağımsız bölümlerin duvar içi kullanım alanları toplamı.' },
  brut: { etiket: 'Brüt alan (m²)', aciklama: 'Bağımsız bölümlerin duvarlar dahil alanları toplamı.' },
  toplamInsaat: {
    etiket: 'Toplam inşaat alanı (m²)',
    aciklama: 'Ruhsattaki toplam inşaat alanı; bodrum ve ortak alanlar dahil.',
  },
  satilabilir: {
    etiket: 'Satılabilir alan (m²)',
    aciklama: 'Satışa konu bağımsız bölümlerin toplamı; ortak alanlar girmez.',
  },
};

export function projeHatalari(p: ProjeGirdisi): string[] {
  const hatalar: string[] = [];
  if (!p.ad.trim()) hatalar.push('Proje adı boş olamaz.');
  for (const [ad, deger] of Object.entries(p.alanlar) as [keyof ProjeAlanlari, number | null][]) {
    if (deger !== null && (!Number.isFinite(deger) || deger < 0)) {
      hatalar.push(`${ALAN_TANIMLARI[ad].etiket} geçerli bir sayı olmalı.`);
    }
  }
  return hatalar;
}

/** Proje, takip başlıkları, bloklar, katlar ve bölümler tek işlemde oluşturulur. */
export async function projeOlustur(
  depo: Depo,
  servis: KayitServisi,
  proje: ProjeGirdisi,
  bloklar: BlokGirdisi[],
): Promise<Proje> {
  const { plan, hatalar } = binaPlaniHazirla(bloklar);
  const tumHatalar = [...projeHatalari(proje), ...hatalar];
  if (!plan || tumHatalar.length > 0) throw new IsKuraliHatasi(tumHatalar.join(' '));

  return depo.islem(async () => {
    const p = await servis.ekle('proje', { ...proje, ad: proje.ad.trim(), durum: 'aktif' });
    for (const [i, ad] of VARSAYILAN_TAKIP_BASLIKLARI.entries()) {
      await servis.ekle('takipBasligi', {
        projeId: p.id,
        ad,
        sira: i + 1,
        durum: 'baslamadi',
        baslangicTarihi: null,
        bitisTarihi: null,
        not: '',
      });
    }
    for (const [bi, pb] of plan.bloklar.entries()) {
      const blok = await servis.ekle('blok', { projeId: p.id, ad: pb.ad, sira: bi + 1 });
      for (const pk of pb.katlar) {
        const kat = await servis.ekle('kat', { projeId: p.id, blokId: blok.id, ad: pk.ad, tip: pk.tip, sira: pk.sira });
        for (const bolum of pk.bolumler) {
          await servis.ekle('bagimsizBolum', {
            projeId: p.id,
            blokId: blok.id,
            katId: kat.id,
            no: bolum.no,
            tip: bolum.tip,
            odaTipi: null,
            brutM2: null,
            netM2: null,
            cephe: null,
            balkon: false,
            otopark: false,
            depo: false,
            ozellikler: [],
            sahiplik: 'muteahhit',
            satisDurumu: 'satisa_kapali',
            teslimDurumu: 'teslim_edilmedi',
          });
        }
      }
    }
    return p;
  });
}

/** Proje bilgilerini değiştirir; eski/yeni değerler işlem geçmişine yazılır (KayitServisi). */
export async function projeGuncelle(
  servis: KayitServisi,
  projeId: string,
  girdi: ProjeGirdisi & { durum: Proje['durum'] },
  gerekce?: string,
): Promise<Proje> {
  const hatalar = projeHatalari(girdi);
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  return servis.guncelle('proje', projeId, { ...girdi, ad: girdi.ad.trim() }, gerekce);
}

// ─── Proje yapısını okuma ──────────────────────────────────────────

export interface KatYapisi {
  kat: Kat;
  bolumler: BagimsizBolum[];
}

export interface BlokYapisi {
  blok: Blok;
  katlar: KatYapisi[];
}

export interface ProjeYapisi {
  proje: Proje;
  takipBasliklari: TakipBasligi[];
  bloklar: BlokYapisi[];
  ortakAlanlar: OrtakAlan[];
}

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const noSirasi = (a: BagimsizBolum, b: BagimsizBolum) => a.no.localeCompare(b.no, 'tr', { numeric: true });

/** Firmaya ait, iptal edilmemiş proje; yoksa null. */
export async function projeGetir(depo: Depo, firmaId: string, projeId: string): Promise<Proje | null> {
  const proje = await depo.getir('proje', projeId);
  return proje && proje.firmaId === firmaId && !proje.iptal ? proje : null;
}

export async function projeYapisiGetir(depo: Depo, firmaId: string, projeId: string): Promise<ProjeYapisi | null> {
  const proje = await projeGetir(depo, firmaId, projeId);
  if (!proje) return null;

  const [takip, bloklar, katlar, bolumler, ortakAlanlar] = await Promise.all([
    depo.listele('takipBasligi', { projeId, firmaId }),
    depo.listele('blok', { projeId, firmaId }),
    depo.listele('kat', { projeId, firmaId }),
    depo.listele('bagimsizBolum', { projeId, firmaId }),
    depo.listele('ortakAlan', { projeId, firmaId }),
  ]);
  const aktifBolumler = aktif(bolumler);

  return {
    proje,
    takipBasliklari: aktif(takip).sort((a, b) => a.sira - b.sira),
    ortakAlanlar: aktif(ortakAlanlar),
    bloklar: aktif(bloklar)
      .sort((a, b) => a.sira - b.sira)
      .map((blok) => ({
        blok,
        katlar: aktif(katlar)
          .filter((k) => k.blokId === blok.id)
          .sort((a, b) => b.sira - a.sira) // en üst kat önce, binadaki gibi
          .map((kat) => ({ kat, bolumler: aktifBolumler.filter((b) => b.katId === kat.id).sort(noSirasi) })),
      })),
  };
}

export interface ProjeOzeti {
  proje: Proje;
  daireSayisi: number;
  dukkanSayisi: number;
}

export async function projeleriListele(depo: Depo, firmaId: string): Promise<ProjeOzeti[]> {
  const [projeler, bolumler] = await Promise.all([
    depo.listele('proje', { firmaId }),
    depo.listele('bagimsizBolum', { firmaId }),
  ]);
  const aktifBolumler = aktif(bolumler);
  return aktif(projeler)
    .sort((a, b) => b.olusturmaZamani.localeCompare(a.olusturmaZamani))
    .map((proje) => {
      const ait = aktifBolumler.filter((b) => b.projeId === proje.id);
      return {
        proje,
        daireSayisi: ait.filter((b) => b.tip === 'daire').length,
        dukkanSayisi: ait.filter((b) => b.tip === 'dukkan').length,
      };
    });
}
