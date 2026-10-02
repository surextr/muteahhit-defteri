import { giderBorcu, giderKalanBorc, tevkifatKalan } from '../hesap/bakiye';
import { giderToplamlari, satirHesapla, tevkifatGecerli, type SatirTutarlari } from '../hesap/gider';
import type { Depo } from '../veri/depo';
import type { Eslestirme, Gider, GiderSatiri, Hesap, Kalem, Kurus, Odeme, OdemeYontemi, Tarih, Tevkifat } from '../veri/tipler';
import { vergiDairesiHazirla } from './cari';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Alış/gider: maliyet ve (carisi varsa) borç bu kayıttan doğar. Ödeme ayrı kayıttır;
// hangi ödemenin hangi gideri kapattığı eşleştirmede durur. Kalan borç saklanmaz.

export interface SatirFormGirdisi {
  /** Düzenlemede var olan satırın kimliği; yeni satırda yok. */
  id?: string;
  kalemId: string | null;
  aciklama: string;
  miktar: number | null;
  birim: string | null;
  /** Kullanıcının yazdığı tutar; kdvDahil ise satır toplamı (KDV dahil). */
  tutar: Kurus;
  kdvDahil: boolean;
  kdvOrani: number;
  tevkifat: Tevkifat | null;
}

/** Gider girilirken hemen yapılan ödeme (peşin ya da kısmi). */
export interface PesinOdeme {
  hesapId: string;
  tutar: Kurus;
}

export interface GiderGirdisi {
  tarih: Tarih;
  projeId: string | null;
  cariId: string | null;
  faturaNo: string | null;
  vadeTarihi: Tarih | null;
  aciklama: string;
  satirlar: SatirFormGirdisi[];
}

export interface GiderKayitSecenegi {
  /** Aynı carinin aynı fatura numaralı başka gideri var; kullanıcı gördü ve onayladı. */
  mukerrerOnayli?: boolean;
}

/** Aynı cari + fatura no ile kayıtlı gider: engel değil, uyarı. */
export class MukerrerFaturaUyarisi extends IsKuraliHatasi {
  constructor(readonly mevcut: Pick<Gider, 'id' | 'tarih' | 'toplam' | 'faturaNo'>) {
    super(`${mevcut.faturaNo} numaralı fatura bu cariden zaten girilmiş. Aynı fatura iki kez maliyete yazılmasın.`);
    this.name = 'MukerrerFaturaUyarisi';
  }
}

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** Ödeme yöntemi hesabın türünden: kasa nakit, banka havale, kredi kartı kart. */
export const hesapYontemi = (h: Pick<Hesap, 'tur'>): OdemeYontemi =>
  h.tur === 'kasa' ? 'nakit' : h.tur === 'kredi_karti' ? 'kart' : 'havale';

interface HesaplanmisSatir extends SatirTutarlari {
  girdi: SatirFormGirdisi;
}

function satirlariHesapla(satirlar: SatirFormGirdisi[]): HesaplanmisSatir[] {
  return satirlar.map((girdi) => ({ girdi, ...satirHesapla(girdi) }));
}

/** Girdiyi denetler; sorun varsa hepsini birlikte bildirir. */
async function denetle(depo: Depo, firmaId: string, g: GiderGirdisi): Promise<{ satirlar: HesaplanmisSatir[]; kalemler: Kalem[] }> {
  const hatalar: string[] = [];
  if (!TARIH.test(g.tarih)) hatalar.push('Gider tarihini girin.');
  if (g.vadeTarihi && (!TARIH.test(g.vadeTarihi) || g.vadeTarihi < g.tarih)) hatalar.push('Vade tarihi gider tarihinden önce olamaz.');
  if (g.satirlar.length === 0) hatalar.push('En az bir satır girin.');

  let kalemler: Kalem[] = [];
  if (g.projeId) {
    const proje = await depo.getir('proje', g.projeId);
    if (!proje || proje.firmaId !== firmaId || proje.iptal) hatalar.push('Proje bulunamadı.');
    kalemler = aktif(await depo.listele('kalem', { projeId: g.projeId, firmaId }));
  }
  if (g.cariId) {
    const cari = await depo.getir('cari', g.cariId);
    if (!cari || cari.firmaId !== firmaId || cari.iptal) hatalar.push('Cari bulunamadı.');
  }

  g.satirlar.forEach((s, i) => {
    const no = g.satirlar.length > 1 ? `${i + 1}. satır: ` : '';
    if (!Number.isInteger(s.tutar) || s.tutar <= 0) hatalar.push(`${no}tutar sıfırdan büyük olmalı.`);
    if (!Number.isFinite(s.kdvOrani) || s.kdvOrani < 0 || s.kdvOrani > 100) hatalar.push(`${no}KDV oranı geçersiz.`);
    if (!tevkifatGecerli(s.tevkifat)) hatalar.push(`${no}tevkifat oranı geçersiz.`);
    if (s.tevkifat && s.kdvOrani === 0) hatalar.push(`${no}KDV'siz satırda tevkifat olmaz.`);
    if (s.miktar !== null && (!Number.isFinite(s.miktar) || s.miktar <= 0)) hatalar.push(`${no}miktar sıfırdan büyük olmalı.`);
    if (s.kalemId) {
      const kalem = kalemler.find((k) => k.id === s.kalemId);
      if (!g.projeId) hatalar.push(`${no}kalem seçmek için önce proje seçin.`);
      else if (!kalem) hatalar.push(`${no}kalem bu projede yok.`);
      else if (kalemler.some((k) => k.ustKalemId === kalem.id)) {
        hatalar.push(`${no}"${kalem.ad}" ana kalem; altındaki kalemlerden birini seçin.`);
      }
    }
  });
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  return { satirlar: satirlariHesapla(g.satirlar), kalemler };
}

async function mukerrerKontrol(depo: Depo, firmaId: string, g: GiderGirdisi, secenek: GiderKayitSecenegi, haricId?: string) {
  const faturaNo = g.faturaNo?.trim();
  if (secenek.mukerrerOnayli || !g.cariId || !faturaNo) return;
  const ayni = aktif(await depo.listele('gider', { cariId: g.cariId, firmaId })).find(
    (x) => x.id !== haricId && x.faturaNo?.trim().toLocaleUpperCase('tr-TR') === faturaNo.toLocaleUpperCase('tr-TR'),
  );
  if (ayni) throw new MukerrerFaturaUyarisi({ id: ayni.id, tarih: ayni.tarih, toplam: ayni.toplam, faturaNo: ayni.faturaNo });
}

const basliktan = (g: GiderGirdisi) => ({
  tarih: g.tarih,
  projeId: g.projeId,
  cariId: g.cariId,
  faturaNo: g.faturaNo?.trim() || null,
  vadeTarihi: g.vadeTarihi || null,
  aciklama: g.aciklama.trim(),
});

const satirKaydi = (giderId: string, s: HesaplanmisSatir) => ({
  giderId,
  kalemId: s.girdi.kalemId,
  aciklama: s.girdi.aciklama.trim(),
  miktar: s.girdi.miktar,
  birim: s.girdi.birim?.trim() || null,
  birimFiyat: s.girdi.miktar ? Math.round(s.kdvHaricTutar / s.girdi.miktar) : null,
  kdvHaricTutar: s.kdvHaricTutar,
  kdvOrani: s.girdi.kdvOrani,
  kdvTutari: s.kdvTutari,
  tevkifat: s.girdi.tevkifat,
  tevkifatTutari: s.tevkifatTutari,
  toplam: s.toplam,
});

/** Ödeme kaydı ve eşleştirmesi; hesap kontrolüyle. Çağıran işlem içinde olmalı. */
async function pesinOde(depo: Depo, servis: KayitServisi, gider: Gider, odeme: PesinOdeme): Promise<Odeme> {
  const hesap = await depo.getir('hesap', odeme.hesapId);
  if (!hesap || hesap.firmaId !== servis.oturum.firmaId || hesap.iptal) throw new IsKuraliHatasi('Ödemenin yapıldığı hesabı seçin.');
  if (hesap.paraBirimi !== 'TRY') throw new IsKuraliHatasi('Dövizli hesaptan ödeme henüz desteklenmiyor; TL hesabı seçin.');
  const o = await servis.ekle('odeme', {
    tarih: gider.tarih,
    yon: 'odeme',
    amac: 'cari',
    yontem: hesapYontemi(hesap),
    cariId: gider.cariId,
    hesapId: hesap.id,
    cekSenetId: null,
    projeId: gider.projeId,
    tutar: odeme.tutar,
    doviz: null,
    aciklama: gider.aciklama || (gider.faturaNo ? `Fatura ${gider.faturaNo}` : ''),
  });
  await servis.ekle('eslestirme', { odemeId: o.id, hedefTur: 'gider', hedefId: gider.id, tutar: odeme.tutar });
  return o;
}

/**
 * Gider, satırları ve (varsa) peşin ödemesi tek işlemde.
 * Carisiz gider peşin ödenmiş olmalıdır: kime borçlu olunduğu bilinmez.
 */
export async function giderOlustur(
  depo: Depo,
  servis: KayitServisi,
  girdi: GiderGirdisi,
  odeme: PesinOdeme | null = null,
  secenek: GiderKayitSecenegi = {},
): Promise<Gider> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const { satirlar } = await denetle(depo, firmaId, girdi);
    const t = giderToplamlari(satirlar);
    const hatalar: string[] = [];
    if (odeme && (!Number.isInteger(odeme.tutar) || odeme.tutar <= 0)) hatalar.push('Ödenen tutar sıfırdan büyük olmalı.');
    if (odeme && odeme.tutar > t.odenecek) hatalar.push('Ödenen tutar fatura tutarından büyük olamaz.');
    if (!girdi.cariId && (!odeme || odeme.tutar !== t.odenecek)) {
      hatalar.push('Carisi seçilmeyen gider tamamen peşin ödenmiş olmalı; veresiye alışta cariyi seçin.');
    }
    if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
    await mukerrerKontrol(depo, firmaId, girdi, secenek);

    const gider = await servis.ekle('gider', {
      ...basliktan(girdi),
      kdvHaricToplam: t.kdvHaricToplam,
      kdvToplam: t.kdvToplam,
      toplam: t.toplam,
      tevkifatToplam: t.tevkifatToplam,
      paraBirimi: 'TRY',
      kur: null,
    });
    for (const s of satirlar) await servis.ekle('giderSatiri', satirKaydi(gider.id, s));
    if (odeme) await pesinOde(depo, servis, gider, odeme);
    // Tevkif edilen KDV vergi dairesi kartının ekstresinde borç olarak görünür.
    if (t.tevkifatToplam > 0) await vergiDairesiHazirla(depo, servis);
    return gider;
  });
}

/**
 * Başlığı ve satırları değiştirir: var olan satır güncellenir, yenisi eklenir, çıkarılan iptal edilir.
 * Ödenmiş tutarın altına inilemez; cari değişecekse önce ödemeler kaldırılmalı.
 */
export async function giderGuncelle(
  depo: Depo,
  servis: KayitServisi,
  giderId: string,
  girdi: GiderGirdisi,
  gerekce?: string,
  secenek: GiderKayitSecenegi = {},
): Promise<Gider> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const eski = await depo.getir('gider', giderId);
    if (!eski || eski.firmaId !== firmaId || eski.iptal) throw new IsKuraliHatasi('Gider bulunamadı.');
    const { satirlar } = await denetle(depo, firmaId, girdi);
    const t = giderToplamlari(satirlar);
    const eslestirmeler = aktif(await depo.listele('eslestirme', { hedefId: giderId, firmaId }));
    const toplamla = (tur: string) => eslestirmeler.filter((e) => e.hedefTur === tur).reduce((s, e) => s + e.tutar, 0);
    const eslesen = toplamla('gider');
    if (t.odenecek < eslesen) {
      throw new IsKuraliHatasi('Bu gidere yapılan ödeme yeni tutardan fazla. Önce ödeme eşleştirmesini azaltın.');
    }
    if (t.tevkifatToplam < toplamla('tevkifat')) {
      throw new IsKuraliHatasi('Bu giderin tevkifatı için vergi dairesine yapılan ödeme yeni tevkifattan fazla. Önce o eşleştirmeyi azaltın.');
    }
    if (eslesen > 0 && eski.cariId !== girdi.cariId) {
      throw new IsKuraliHatasi('Ödemesi olan giderin carisi değiştirilemez. Önce ödeme eşleştirmesini kaldırın.');
    }
    if (!girdi.cariId && t.odenecek !== eslesen) {
      throw new IsKuraliHatasi('Carisi seçilmeyen gider tamamen ödenmiş olmalı.');
    }
    await mukerrerKontrol(depo, firmaId, girdi, secenek, giderId);

    const guncel = await servis.guncelle(
      'gider',
      giderId,
      {
        ...basliktan(girdi),
        kdvHaricToplam: t.kdvHaricToplam,
        kdvToplam: t.kdvToplam,
        toplam: t.toplam,
        tevkifatToplam: t.tevkifatToplam,
      },
      gerekce,
    );

    const mevcutlar = aktif(await depo.listele('giderSatiri', { giderId, firmaId }));
    const kalanIdler = new Set(satirlar.map((s) => s.girdi.id).filter(Boolean));
    for (const m of mevcutlar) if (!kalanIdler.has(m.id)) await servis.iptal('giderSatiri', m.id, gerekce);
    for (const s of satirlar) {
      const m = mevcutlar.find((x) => x.id === s.girdi.id);
      if (m) await servis.guncelle('giderSatiri', m.id, satirKaydi(giderId, s), gerekce);
      else await servis.ekle('giderSatiri', satirKaydi(giderId, s));
    }
    if (t.tevkifatToplam > 0) await vergiDairesiHazirla(depo, servis);
    return guncel;
  });
}

/**
 * Gider iptal edilir; satırları ve eşleştirmeleri de iptal olur (KayitServisi.BAGLI_KAYITLAR).
 * `odemeleriDeIptal`: yalnızca bu gidere bağlı ödemeler de iptal edilir (para hesaba döner);
 * aksi halde avans olarak açık kalırlar. Carisiz giderin ödemesi her zaman iptal edilir.
 * Vergi dairesine yapılan tevkifat ödemesi iptal edilmez; vergi dairesinde avans olarak kalır.
 */
export async function giderIptal(
  depo: Depo,
  servis: KayitServisi,
  giderId: string,
  gerekce?: string,
  odemeleriDeIptal = false,
): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const gider = await depo.getir('gider', giderId);
    if (!gider || gider.firmaId !== firmaId || gider.iptal) throw new IsKuraliHatasi('Gider bulunamadı.');
    const odemeIdler = aktif(await depo.listele('eslestirme', { hedefId: giderId, firmaId }))
      .filter((e) => e.hedefTur === 'gider')
      .map((e) => e.odemeId);
    await servis.iptal('gider', giderId, gerekce);
    if (!odemeleriDeIptal && gider.cariId) return;
    for (const id of new Set(odemeIdler)) {
      // Başka gidere de bağlı ödeme iptal edilmez; yalnızca bu giderin payı serbest kalır.
      const digerleri = aktif(await depo.listele('eslestirme', { odemeId: id, firmaId }));
      const odeme = await depo.getir('odeme', id);
      if (digerleri.length === 0 && odeme && !odeme.iptal) {
        await servis.iptal('odeme', id, `Gider iptaliyle. ${gerekce ?? ''}`.trim());
      }
    }
  });
}

// ─── Okuma ─────────────────────────────────────────────────────────

export interface GiderOzeti {
  gider: Gider;
  cariAdi: string | null;
  projeAdi: string | null;
  /** Cariye borç (tevkifat düşülmüş). */
  borc: Kurus;
  kalan: Kurus;
  /** Vadesi bugünden önce ve kalanı var. */
  vadesiGecti: boolean;
}

export interface GiderSuzgeci {
  projeId?: string;
  cariId?: string;
  yalnizcaOdenmemis?: boolean;
}

/** En yeni gider önce. */
export async function giderleriListele(depo: Depo, firmaId: string, suzgec: GiderSuzgeci = {}, bugun: Tarih): Promise<GiderOzeti[]> {
  const kosul = { firmaId, ...(suzgec.projeId ? { projeId: suzgec.projeId } : {}), ...(suzgec.cariId ? { cariId: suzgec.cariId } : {}) };
  const [giderler, eslestirmeler, cariler, projeler] = await Promise.all([
    depo.listele('gider', kosul),
    depo.listele('eslestirme', { firmaId }),
    depo.listele('cari', { firmaId }),
    depo.listele('proje', { firmaId }),
  ]);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const projeAdi = new Map(projeler.map((p) => [p.id, p.ad]));
  return aktif(giderler)
    .sort((a, b) => b.tarih.localeCompare(a.tarih) || b.olusturmaZamani.localeCompare(a.olusturmaZamani))
    .map((gider) => {
      const kalan = giderKalanBorc(gider, eslestirmeler);
      return {
        gider,
        cariAdi: gider.cariId ? (cariAdi.get(gider.cariId) ?? '?') : null,
        projeAdi: gider.projeId ? (projeAdi.get(gider.projeId) ?? '?') : null,
        borc: giderBorcu(gider),
        kalan,
        vadesiGecti: kalan > 0 && !!gider.vadeTarihi && gider.vadeTarihi < bugun,
      };
    })
    .filter((o) => !suzgec.yalnizcaOdenmemis || o.kalan > 0);
}

export interface GiderDetayi extends GiderOzeti {
  satirlar: (GiderSatiri & { kalemAdi: string | null })[];
  /** Cariye yapılan ödemeler. */
  odemeler: { eslestirme: Eslestirme; odeme: Odeme; hesapAdi: string | null }[];
  /** Tevkif edilen KDV'nin vergi dairesine ödenmemiş kısmı. */
  tevkifatKalan: Kurus;
}

export async function giderDetayiGetir(depo: Depo, firmaId: string, giderId: string, bugun: Tarih): Promise<GiderDetayi | null> {
  const gider = await depo.getir('gider', giderId);
  if (!gider || gider.firmaId !== firmaId || gider.iptal) return null;
  const [satirlar, eslestirmeler, kalemler, cari, proje] = await Promise.all([
    depo.listele('giderSatiri', { giderId, firmaId }),
    depo.listele('eslestirme', { hedefId: giderId, firmaId }),
    gider.projeId ? depo.listele('kalem', { projeId: gider.projeId, firmaId }) : Promise.resolve([]),
    gider.cariId ? depo.getir('cari', gider.cariId) : Promise.resolve(undefined),
    gider.projeId ? depo.getir('proje', gider.projeId) : Promise.resolve(undefined),
  ]);
  const kalemAdi = (id: string | null) => {
    const k = kalemler.find((x) => x.id === id);
    if (!k) return null;
    const ust = kalemler.find((x) => x.id === k.ustKalemId);
    return ust ? `${ust.ad} › ${k.ad}` : k.ad;
  };
  const odemeler = [];
  for (const e of aktif(eslestirmeler)) {
    if (e.hedefTur !== 'gider') continue;
    const odeme = await depo.getir('odeme', e.odemeId);
    if (!odeme || odeme.iptal) continue;
    const hesap = odeme.hesapId ? await depo.getir('hesap', odeme.hesapId) : undefined;
    odemeler.push({ eslestirme: e, odeme, hesapAdi: hesap?.ad ?? null });
  }
  const kalan = giderKalanBorc(gider, eslestirmeler);
  return {
    gider,
    cariAdi: cari?.ad ?? null,
    projeAdi: proje?.ad ?? null,
    borc: giderBorcu(gider),
    kalan,
    vadesiGecti: kalan > 0 && !!gider.vadeTarihi && gider.vadeTarihi < bugun,
    satirlar: aktif(satirlar).map((s) => ({ ...s, kalemAdi: kalemAdi(s.kalemId) })),
    odemeler: odemeler.sort((a, b) => a.odeme.tarih.localeCompare(b.odeme.tarih)),
    tevkifatKalan: tevkifatKalan(gider, eslestirmeler),
  };
}
