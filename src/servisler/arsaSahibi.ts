import { bolumNo } from '../hesap/bolum';
import type { Depo } from '../veri/depo';
import type { Cari, KatKarsiligiSozlesme, PayYontemi } from '../veri/tipler';
import { cariGetir } from './cari';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import { projeGetir } from './proje';

// Kat karşılığı sözleşmesi (paylaşım oranı, arsa sahipleri ve hisseleri, pay yöntemi) ve
// bölümlerin arsa sahiplerine tahsisi. Tahsis edilen bölümün sahipliği aynı işlemde
// "arsa sahibi" olur, tahsis kaldırılınca "müteahhit"e döner. Proje başına bir sözleşme.

export interface KatKarsiligiGirdisi {
  /** Arsa sahiplerinin toplam payı (%); müteahhidinki 100'den kalandır. */
  arsaSahibiOrani: number;
  arsaSahipleri: { cariId: string; hisse: number }[];
  payYontemi: PayYontemi;
}

export interface ArsaSahibiDurumu {
  sozlesme: KatKarsiligiSozlesme;
  /** Sözleşmedeki sırayla. */
  sahipler: { cari: Cari; hisse: number }[];
  /** bolumId → arsa sahibinin cariId'si */
  tahsis: Map<string, string>;
}

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
/** Ondalıklı hisselerde kayan nokta hatasına pay bırakılır. */
const YUZ = (t: number) => Math.abs(t - 100) < 1e-6;

export async function katKarsiligiGetir(depo: Depo, firmaId: string, projeId: string): Promise<KatKarsiligiSozlesme | null> {
  return aktif(await depo.listele('katKarsiligiSozlesme', { projeId, firmaId }))[0] ?? null;
}

async function aktifTahsisler(depo: Depo, firmaId: string, sozlesmeId: string) {
  return aktif(await depo.listele('arsaSahibiTahsisi', { sozlesmeId, firmaId }));
}

/** Kat karşılığı projede sözleşme, arsa sahipleri ve tahsisler; sözleşme yoksa null. */
export async function arsaSahibiDurumu(depo: Depo, firmaId: string, projeId: string): Promise<ArsaSahibiDurumu | null> {
  const sozlesme = await katKarsiligiGetir(depo, firmaId, projeId);
  if (!sozlesme) return null;
  const sahipler: ArsaSahibiDurumu['sahipler'] = [];
  for (const s of sozlesme.arsaSahipleri) {
    const cari = await depo.getir('cari', s.cariId);
    if (cari) sahipler.push({ cari, hisse: s.hisse });
  }
  const tahsis = new Map((await aktifTahsisler(depo, firmaId, sozlesme.id)).map((t) => [t.bolumId, t.cariId]));
  return { sozlesme, sahipler, tahsis };
}

function girdiHatalari(g: KatKarsiligiGirdisi): string[] {
  const hatalar: string[] = [];
  if (!Number.isFinite(g.arsaSahibiOrani) || g.arsaSahibiOrani <= 0 || g.arsaSahibiOrani >= 100) {
    hatalar.push("Arsa sahiplerinin payı 0 ile 100 arasında olmalı.");
  }
  if (!['brut', 'net', 'adet'].includes(g.payYontemi)) hatalar.push('Pay yöntemi seçin.');
  const idler = g.arsaSahipleri.map((s) => s.cariId);
  if (idler.some((id) => !id)) hatalar.push('Her satırda arsa sahibini seçin.');
  if (new Set(idler).size !== idler.length) hatalar.push('Aynı arsa sahibi iki kez yazılmış.');
  if (g.arsaSahipleri.some((s) => !Number.isFinite(s.hisse) || s.hisse <= 0)) hatalar.push("Hisse 0'dan büyük olmalı.");
  const toplam = g.arsaSahipleri.reduce((t, s) => t + s.hisse, 0);
  if (g.arsaSahipleri.length > 0 && !YUZ(toplam)) {
    hatalar.push(`Hisseler toplamı %${toplam.toLocaleString('tr-TR')}; %100 olmalı.`);
  }
  return hatalar;
}

/** Sözleşme yoksa açar, varsa günceller. Tahsisi olan arsa sahibi listeden çıkarılamaz. */
export async function katKarsiligiKaydet(
  depo: Depo,
  servis: KayitServisi,
  projeId: string,
  girdi: KatKarsiligiGirdisi,
  gerekce?: string,
): Promise<KatKarsiligiSozlesme> {
  const hatalar = girdiHatalari(girdi);
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  const firmaId = servis.oturum.firmaId;

  return depo.islem(async () => {
    const proje = await projeGetir(depo, firmaId, projeId);
    if (!proje) throw new IsKuraliHatasi('Proje bulunamadı.');
    if (proje.arsaTipi !== 'kat_karsiligi') throw new IsKuraliHatasi('Arsa sahipleri yalnızca kat karşılığı projelerde girilir.');
    for (const s of girdi.arsaSahipleri) {
      const cari = await cariGetir(depo, firmaId, s.cariId);
      if (!cari) throw new IsKuraliHatasi('Arsa sahibi bulunamadı.');
      if (!cari.roller.includes('arsa_sahibi')) throw new IsKuraliHatasi(`${cari.ad} kartında "arsa sahibi" rolü yok.`);
    }
    const mevcut = await katKarsiligiGetir(depo, firmaId, projeId);
    // Kira yardımı ve teslim bilgisi "ayrıntılar"da girilir; paylaşım değişince korunur.
    const onceki = new Map(mevcut?.arsaSahipleri.map((s) => [s.cariId, s]) ?? []);
    const veri = {
      arsaSahibiOrani: girdi.arsaSahibiOrani,
      muteahhitOrani: 100 - girdi.arsaSahibiOrani,
      arsaSahipleri: girdi.arsaSahipleri.map((s) => ({
        kiraAylik: null,
        kiraBaslangic: null,
        teslimAlindi: null,
        ...onceki.get(s.cariId),
        cariId: s.cariId,
        hisse: s.hisse,
      })),
      payYontemi: girdi.payYontemi,
    };

    if (!mevcut) {
      return servis.ekle('katKarsiligiSozlesme', {
        projeId,
        ...veri,
        sozlesmeTarihi: null,
        teslimTarihi: null,
        teslimSuresiAy: null,
        gecikmeCezasi: null,
        not: '',
      });
    }

    const kalanlar = new Set(veri.arsaSahipleri.map((s) => s.cariId));
    const tahsisliCikan = (await aktifTahsisler(depo, firmaId, mevcut.id)).find((t) => !kalanlar.has(t.cariId));
    if (tahsisliCikan) {
      const cari = await depo.getir('cari', tahsisliCikan.cariId);
      throw new IsKuraliHatasi(`${cari?.ad ?? 'Arsa sahibi'} adına tahsisli bölüm var; önce krokide tahsisi kaldırın.`);
    }
    return servis.guncelle('katKarsiligiSozlesme', mevcut.id, veri, gerekce);
  });
}

/** Bölümleri bir arsa sahibine tahsis eder; başka sahibe tahsisliyse o tahsis iptal edilip yenisi yazılır. */
export async function tahsisEt(
  depo: Depo,
  servis: KayitServisi,
  projeId: string,
  bolumIdler: string[],
  cariId: string,
  gerekce?: string,
): Promise<number> {
  if (bolumIdler.length === 0) throw new IsKuraliHatasi('Önce bölüm seçin.');
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const sozlesme = await katKarsiligiGetir(depo, firmaId, projeId);
    if (!sozlesme) throw new IsKuraliHatasi('Önce kat karşılığı paylaşımını ve arsa sahiplerini girin.');
    if (!sozlesme.arsaSahipleri.some((s) => s.cariId === cariId)) throw new IsKuraliHatasi('Bu kişi sözleşmede arsa sahibi değil.');
    const tahsisler = new Map((await aktifTahsisler(depo, firmaId, sozlesme.id)).map((t) => [t.bolumId, t]));

    let degisen = 0;
    for (const id of new Set(bolumIdler)) {
      const bolum = await depo.getir('bagimsizBolum', id);
      if (!bolum || bolum.firmaId !== firmaId || bolum.iptal || bolum.projeId !== projeId) {
        throw new IsKuraliHatasi('Seçilen bölümlerden biri bulunamadı.');
      }
      if (bolum.satisDurumu === 'rezerve' || bolum.satisDurumu === 'sozlesmeli') {
        const blok = await depo.getir('blok', bolum.blokId);
        throw new IsKuraliHatasi(`${bolumNo(blok?.ad, bolum.no)} rezerve ya da satılmış; arsa sahibine verilemez.`);
      }
      const eski = tahsisler.get(id);
      if (eski?.cariId === cariId) continue;
      if (eski) await servis.iptal('arsaSahibiTahsisi', eski.id, gerekce);
      await servis.ekle('arsaSahibiTahsisi', { sozlesmeId: sozlesme.id, cariId, bolumId: id });
      // Arsa sahibinin dairesi satışa çıkmaz.
      await servis.guncelle('bagimsizBolum', id, { sahiplik: 'arsa_sahibi', satisDurumu: 'satisa_kapali' });
      degisen++;
    }
    return degisen;
  });
}

/** Seçilen bölümlerin tahsisini iptal eder; sahiplik müteahhide döner. */
export async function tahsisKaldir(
  depo: Depo,
  servis: KayitServisi,
  projeId: string,
  bolumIdler: string[],
  gerekce?: string,
): Promise<number> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const sozlesme = await katKarsiligiGetir(depo, firmaId, projeId);
    if (!sozlesme) return 0;
    const secili = new Set(bolumIdler);
    let degisen = 0;
    for (const t of await aktifTahsisler(depo, firmaId, sozlesme.id)) {
      if (!secili.has(t.bolumId)) continue;
      await servis.iptal('arsaSahibiTahsisi', t.id, gerekce);
      await servis.guncelle('bagimsizBolum', t.bolumId, { sahiplik: 'muteahhit' });
      degisen++;
    }
    return degisen;
  });
}
