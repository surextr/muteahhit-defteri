import { cariEkstresi, giderKalanBorc, odemeAcikTutar, type CariHareketi } from '../hesap/bakiye';
import type { Depo } from '../veri/depo';
import type { Eslestirme, Gider, Kurus, Odeme, OdemeAmaci, Tarih } from '../veri/tipler';
import { hesapYontemi } from './gider';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Ödeme ve tahsilat yalnızca nakit hareketidir; maliyet oluşturmaz.
// Hangi ödemenin hangi gideri ne kadar kapattığı eşleştirmede durur; eşleşmeyen kısım avanstır.

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export interface Dagitim {
  giderId: string;
  tutar: Kurus;
}

export interface OdemeGirdisi {
  tarih: Tarih;
  cariId: string;
  hesapId: string;
  tutar: Kurus;
  aciklama: string;
  /** Hangi gidere ne kadar; toplamı ödemeyi aşamaz, artanı avans kalır. */
  dagitim: Dagitim[];
}

/** Bu adımdaki tahsilat amaçları. Satış/taksit tahsilatı 3. aşamada. */
export type TahsilatAmaci = Extract<OdemeAmaci, 'cari' | 'ortakSermaye' | 'krediKullanim'>;

export const TAHSILAT_AMACI_ADI: Record<TahsilatAmaci, string> = {
  cari: 'Cariden tahsilat',
  ortakSermaye: 'Ortağın yatırdığı para',
  krediKullanim: 'Kredi kullanımı',
};

export interface TahsilatGirdisi {
  tarih: Tarih;
  amac: TahsilatAmaci;
  cariId: string | null;
  hesapId: string;
  tutar: Kurus;
  projeId: string | null;
  aciklama: string;
}

async function hesapDenetle(depo: Depo, firmaId: string, hesapId: string) {
  const hesap = await depo.getir('hesap', hesapId);
  if (!hesap || hesap.firmaId !== firmaId || hesap.iptal) throw new IsKuraliHatasi('Kasa/banka hesabını seçin.');
  if (hesap.paraBirimi !== 'TRY') throw new IsKuraliHatasi('Dövizli hesapla ödeme/tahsilat henüz desteklenmiyor; TL hesabı seçin.');
  return hesap;
}

async function cariDenetle(depo: Depo, firmaId: string, cariId: string | null) {
  if (!cariId) return null;
  const cari = await depo.getir('cari', cariId);
  if (!cari || cari.firmaId !== firmaId || cari.iptal) throw new IsKuraliHatasi('Cari bulunamadı.');
  return cari;
}

/**
 * Dağıtımı denetler ve eşleştirmeleri yazar. Çağıran işlem içinde olmalı.
 * Her gider bu carinin olmalı; gidere yazılan, giderin kalanını; toplam, ödemenin açık kısmını aşamaz.
 */
async function eslestir(depo: Depo, servis: KayitServisi, odeme: Odeme, acikTutar: Kurus, dagitim: Dagitim[]): Promise<Eslestirme[]> {
  const firmaId = servis.oturum.firmaId;
  const hatalar: string[] = [];
  const kullanilan = dagitim.filter((d) => d.tutar !== 0);
  if (new Set(kullanilan.map((d) => d.giderId)).size !== kullanilan.length) hatalar.push('Aynı gider iki kez seçilmiş.');
  const toplam = kullanilan.reduce((t, d) => t + d.tutar, 0);
  if (toplam > acikTutar) hatalar.push('Giderlere dağıtılan toplam, ödeme tutarından büyük olamaz.');

  const giderler: [Gider, Kurus][] = [];
  for (const d of kullanilan) {
    if (!Number.isInteger(d.tutar) || d.tutar < 0) {
      hatalar.push('Gidere yazılan tutar sıfırdan büyük olmalı.');
      continue;
    }
    const gider = await depo.getir('gider', d.giderId);
    if (!gider || gider.firmaId !== firmaId || gider.iptal) {
      hatalar.push('Seçilen gider bulunamadı.');
      continue;
    }
    if (gider.cariId !== odeme.cariId) hatalar.push('Seçilen gider bu cariye ait değil.');
    const kalan = giderKalanBorc(gider, await depo.listele('eslestirme', { hedefId: gider.id, firmaId }));
    if (d.tutar > kalan) hatalar.push(`${gider.faturaNo ?? 'Seçilen gider'} için kalan borç ${(kalan / 100).toLocaleString('tr-TR')} TL; fazlası yazılamaz.`);
    giderler.push([gider, d.tutar]);
  }
  if (hatalar.length > 0) throw new IsKuraliHatasi([...new Set(hatalar)].join(' '));

  const sonuc: Eslestirme[] = [];
  for (const [gider, tutar] of giderler) {
    sonuc.push(await servis.ekle('eslestirme', { odemeId: odeme.id, hedefTur: 'gider', hedefId: gider.id, tutar }));
  }
  return sonuc;
}

/** Cariye ödeme ve dağıtımı tek işlemde. */
export async function odemeYap(depo: Depo, servis: KayitServisi, g: OdemeGirdisi): Promise<Odeme> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const hatalar: string[] = [];
    if (!TARIH.test(g.tarih)) hatalar.push('Ödeme tarihini girin.');
    if (!Number.isInteger(g.tutar) || g.tutar <= 0) hatalar.push('Ödeme tutarı sıfırdan büyük olmalı.');
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    const cari = await cariDenetle(depo, firmaId, g.cariId);
    if (!cari) throw new IsKuraliHatasi('Ödeme yapılan cariyi seçin.');
    const hesap = await hesapDenetle(depo, firmaId, g.hesapId);

    // Tek projenin giderleri kapanıyorsa ödeme o projeye yazılır (nakit akışı raporu için).
    const projeler = new Set<string | null>();
    for (const d of g.dagitim) if (d.tutar) projeler.add((await depo.getir('gider', d.giderId))?.projeId ?? null);
    const projeId = projeler.size === 1 ? [...projeler][0]! : null;

    const odeme = await servis.ekle('odeme', {
      tarih: g.tarih,
      yon: 'odeme',
      amac: 'cari',
      yontem: hesapYontemi(hesap),
      cariId: cari.id,
      hesapId: hesap.id,
      cekSenetId: null,
      projeId,
      tutar: g.tutar,
      doviz: null,
      aciklama: g.aciklama.trim(),
    });
    await eslestir(depo, servis, odeme, g.tutar, g.dagitim);
    return odeme;
  });
}

/**
 * Bize gelen para. Cariden tahsilat ve ortak sermayesinde cari zorunlu
 * (ortağın yatırdığı para ortağa borç olarak görünür); kredi kullanımında isteğe bağlı.
 * Gelir sayılmaz.
 */
export async function tahsilatKaydet(depo: Depo, servis: KayitServisi, g: TahsilatGirdisi): Promise<Odeme> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const hatalar: string[] = [];
    if (!TARIH.test(g.tarih)) hatalar.push('Tahsilat tarihini girin.');
    if (!Number.isInteger(g.tutar) || g.tutar <= 0) hatalar.push('Tutar sıfırdan büyük olmalı.');
    if (!(g.amac in TAHSILAT_AMACI_ADI)) hatalar.push('Tahsilatın amacını seçin.');
    if (g.amac !== 'krediKullanim' && !g.cariId) hatalar.push('Paranın kimden geldiğini (cari) seçin.');
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    const cari = await cariDenetle(depo, firmaId, g.cariId);
    if (g.amac === 'ortakSermaye' && !cari!.roller.includes('ortak')) {
      throw new IsKuraliHatasi(`${cari!.ad} kartında "ortak" rolü yok.`);
    }
    if (g.projeId) {
      const proje = await depo.getir('proje', g.projeId);
      if (!proje || proje.firmaId !== firmaId || proje.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
    }
    const hesap = await hesapDenetle(depo, firmaId, g.hesapId);
    return servis.ekle('odeme', {
      tarih: g.tarih,
      yon: 'tahsilat',
      amac: g.amac,
      yontem: hesapYontemi(hesap) === 'kart' ? 'havale' : hesapYontemi(hesap),
      cariId: cari?.id ?? null,
      hesapId: hesap.id,
      cekSenetId: null,
      projeId: g.projeId,
      tutar: g.tutar,
      doviz: null,
      aciklama: g.aciklama.trim(),
    });
  });
}

/** Ödemenin açıkta kalan (avans) kısmını giderlere bağlar. */
export async function avansEslestir(depo: Depo, servis: KayitServisi, odemeId: string, dagitim: Dagitim[]): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const odeme = await depo.getir('odeme', odemeId);
    if (!odeme || odeme.firmaId !== firmaId || odeme.iptal) throw new IsKuraliHatasi('Ödeme bulunamadı.');
    if (odeme.yon !== 'odeme' || odeme.amac !== 'cari') throw new IsKuraliHatasi('Yalnızca cariye yapılan ödeme gidere bağlanır.');
    const acik = odemeAcikTutar(odeme, await depo.listele('eslestirme', { odemeId, firmaId }));
    if (acik <= 0) throw new IsKuraliHatasi('Bu ödemenin açıkta kalan kısmı yok.');
    await eslestir(depo, servis, odeme, acik, dagitim);
  });
}

// ─── Okuma ─────────────────────────────────────────────────────────

export interface AcikGider {
  gider: Gider;
  kalan: Kurus;
  projeAdi: string | null;
  vadesiGecti: boolean;
}

/** Carinin kalanı olan giderleri, en eski vade (yoksa tarih) önce. */
export async function acikGiderler(depo: Depo, firmaId: string, cariId: string, bugun: Tarih): Promise<AcikGider[]> {
  const [giderler, eslestirmeler, projeler] = await Promise.all([
    depo.listele('gider', { cariId, firmaId }),
    depo.listele('eslestirme', { firmaId }),
    depo.listele('proje', { firmaId }),
  ]);
  const projeAdi = new Map(projeler.map((p) => [p.id, p.ad]));
  return aktif(giderler)
    .map((gider) => ({ gider, kalan: giderKalanBorc(gider, eslestirmeler) }))
    .filter((x) => x.kalan > 0)
    .sort((a, b) => (a.gider.vadeTarihi ?? a.gider.tarih).localeCompare(b.gider.vadeTarihi ?? b.gider.tarih))
    .map(({ gider, kalan }) => ({
      gider,
      kalan,
      projeAdi: gider.projeId ? (projeAdi.get(gider.projeId) ?? null) : null,
      vadesiGecti: !!gider.vadeTarihi && gider.vadeTarihi < bugun,
    }));
}

export interface AcikOdeme {
  odeme: Odeme;
  acik: Kurus;
}

/** Cariye yapılmış, giderle tam eşleşmemiş ödemeler (avans). */
export async function acikOdemeler(depo: Depo, firmaId: string, cariId: string): Promise<AcikOdeme[]> {
  const [odemeler, eslestirmeler] = await Promise.all([
    depo.listele('odeme', { cariId, firmaId }),
    depo.listele('eslestirme', { firmaId }),
  ]);
  return aktif(odemeler)
    .filter((o) => o.yon === 'odeme' && o.amac === 'cari')
    .map((odeme) => ({ odeme, acik: odemeAcikTutar(odeme, eslestirmeler) }))
    .filter((x) => x.acik > 0)
    .sort((a, b) => a.odeme.tarih.localeCompare(b.odeme.tarih));
}

export async function cariEkstresiGetir(depo: Depo, firmaId: string, cariId: string): Promise<CariHareketi[]> {
  const k = { cariId, firmaId };
  const [acilislar, giderler, hakedisler, odemeler, kendiCekleri, ciroHareketleri] = await Promise.all([
    depo.listele('acilisBakiyesi', { hedefId: cariId, firmaId }),
    depo.listele('gider', k),
    depo.listele('hakedis', k),
    depo.listele('odeme', k),
    depo.listele('cekSenet', k),
    depo.listele('cekHareketi', k),
  ]);
  const cekIdler = new Set([...kendiCekleri.map((c) => c.id), ...ciroHareketleri.map((x) => x.cekSenetId)]);
  const cekler = [];
  const cekHareketleri = [];
  for (const id of cekIdler) {
    const cek = await depo.getir('cekSenet', id);
    if (cek) cekler.push(cek);
    cekHareketleri.push(...(await depo.listele('cekHareketi', { cekSenetId: id, firmaId })));
  }
  return cariEkstresi(cariId, { acilislar, giderler, hakedisler, odemeler, cekler, cekHareketleri });
}

export interface OdemeDetayi {
  odeme: Odeme;
  cariAdi: string | null;
  hesapAdi: string | null;
  eslesmeler: { eslestirme: Eslestirme; gider: Gider }[];
  /** Cariye ödemede eşleşmemiş kısım. */
  acik: Kurus;
}

export async function odemeDetayiGetir(depo: Depo, firmaId: string, odemeId: string): Promise<OdemeDetayi | null> {
  const odeme = await depo.getir('odeme', odemeId);
  if (!odeme || odeme.firmaId !== firmaId || odeme.iptal) return null;
  const eslestirmeler = aktif(await depo.listele('eslestirme', { odemeId, firmaId }));
  const eslesmeler = [];
  for (const e of eslestirmeler) {
    const gider = await depo.getir('gider', e.hedefId);
    if (gider) eslesmeler.push({ eslestirme: e, gider });
  }
  const [cari, hesap] = await Promise.all([
    odeme.cariId ? depo.getir('cari', odeme.cariId) : Promise.resolve(undefined),
    odeme.hesapId ? depo.getir('hesap', odeme.hesapId) : Promise.resolve(undefined),
  ]);
  return {
    odeme,
    cariAdi: cari?.ad ?? null,
    hesapAdi: hesap?.ad ?? null,
    eslesmeler,
    acik: odeme.yon === 'odeme' && odeme.amac === 'cari' ? odemeAcikTutar(odeme, eslestirmeler) : 0,
  };
}
