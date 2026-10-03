import { cariEkstresi, giderKalanBorc, iadeAcikTutar, kalanTutar, odemeAcikTutar, tevkifatKalan, type CariHareketi } from '../hesap/bakiye';
import { tlYaz } from '../hesap/para';
import { beyanSonGunu, tevkifatDonemi } from '../hesap/tevkifat';
import type { Depo } from '../veri/depo';
import type { Alacak, Cari, Eslestirme, Gider, Kurus, Odeme, OdemeAmaci, Tarih } from '../veri/tipler';
import { hesapYontemi } from './gider';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Ödeme ve tahsilat yalnızca nakit hareketidir; maliyet oluşturmaz.
// Hangi ödemenin hangi gideri ne kadar kapattığı eşleştirmede durur; eşleşmeyen kısım avanstır.
// Vergi dairesine ödeme, giderlerin tevkif edilen KDV'sini kapatır (hedefTur 'tevkifat').
// İade faturasının alacağı da ödeme gibi faturalara mahsup edilir (kaynakTur 'iade').

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** Ödenen borcun türü: carinin gideri ya da (vergi dairesine) giderin tevkifatı. */
export type BorcTuru = 'gider' | 'tevkifat';

export interface Dagitim {
  /** Yoksa 'gider'. */
  hedefTur?: BorcTuru;
  giderId: string;
  tutar: Kurus;
}

const vergiDairesiMi = (cari: Pick<Cari, 'roller'> | null | undefined) => !!cari?.roller.includes('vergi_dairesi');

/** Çekle/senetle yapılmış ödemenin çeki karşılıksız çıktı ya da iade edildi: ödeme avans sayılmaz, faturaya bağlanmaz. */
async function cekiGeriDondu(depo: Depo, odeme: Pick<Odeme, 'cekSenetId'>): Promise<boolean> {
  if (!odeme.cekSenetId) return false;
  const cek = await depo.getir('cekSenet', odeme.cekSenetId);
  return !!cek && (cek.durum === 'karsiliksiz' || cek.durum === 'iade_edildi');
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
  /** Tedarikçinin iade karşılığı geri verdiği para: bu iadenin alacağını kapatır. */
  iadeId?: string | null;
  /**
   * Cariden tahsilatın hangi alacakları ne kadar kapattığı (ekranda elle değiştirilebilir).
   * Verilmezse açık alacaklar en eski vadeden başlayarak kapatılır.
   */
  alacakDagitimi?: { alacakId: string; tutar: Kurus }[];
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

/** Borç kapatan kayıt: ödeme ya da iade faturası. */
interface Kaynak {
  tur: 'odeme' | 'iade';
  id: string;
  cariId: string | null;
}

/**
 * Dağıtımı denetler ve eşleştirmeleri yazar. Çağıran işlem içinde olmalı.
 * Her gider bu carinin olmalı; gidere yazılan, giderin kalanını; toplam, kaynağın açık kısmını aşamaz.
 */
async function eslestir(depo: Depo, servis: KayitServisi, odeme: Kaynak, acikTutar: Kurus, dagitim: Dagitim[]): Promise<Eslestirme[]> {
  const firmaId = servis.oturum.firmaId;
  const hatalar: string[] = [];
  const kullanilan = dagitim.filter((d) => d.tutar !== 0);
  if (new Set(kullanilan.map((d) => `${d.hedefTur ?? 'gider'}:${d.giderId}`)).size !== kullanilan.length) hatalar.push('Aynı gider iki kez seçilmiş.');
  const odemeCarisi = odeme.cariId ? await depo.getir('cari', odeme.cariId) : undefined;
  const toplam = kullanilan.reduce((t, d) => t + d.tutar, 0);
  if (toplam > acikTutar) hatalar.push('Giderlere dağıtılan toplam, ödeme tutarından büyük olamaz.');

  const giderler: [Gider, Kurus, BorcTuru][] = [];
  for (const d of kullanilan) {
    const tur = d.hedefTur ?? 'gider';
    if (!Number.isInteger(d.tutar) || d.tutar < 0) {
      hatalar.push('Gidere yazılan tutar sıfırdan büyük olmalı.');
      continue;
    }
    const gider = await depo.getir('gider', d.giderId);
    if (!gider || gider.firmaId !== firmaId || gider.iptal) {
      hatalar.push('Seçilen gider bulunamadı.');
      continue;
    }
    const eslestirmeler = await depo.listele('eslestirme', { hedefId: gider.id, firmaId });
    let kalan: Kurus;
    if (tur === 'tevkifat') {
      if (odeme.tur === 'iade') hatalar.push('İade yalnızca faturalara mahsup edilir.');
      else if (!vergiDairesiMi(odemeCarisi)) hatalar.push('Tevkifat yalnızca vergi dairesine yapılan ödemeyle kapanır.');
      kalan = tevkifatKalan(gider, eslestirmeler);
    } else {
      if (gider.cariId !== odeme.cariId) hatalar.push('Seçilen gider bu cariye ait değil.');
      kalan = giderKalanBorc(gider, eslestirmeler);
    }
    const ad = `${gider.faturaNo ?? 'Seçilen gider'}${tur === 'tevkifat' ? ' tevkifatı' : ''}`;
    if (d.tutar > kalan) hatalar.push(`${ad} için kalan borç ${(kalan / 100).toLocaleString('tr-TR')} TL; fazlası yazılamaz.`);
    giderler.push([gider, d.tutar, tur]);
  }
  if (hatalar.length > 0) throw new IsKuraliHatasi([...new Set(hatalar)].join(' '));

  const sonuc: Eslestirme[] = [];
  for (const [gider, tutar, hedefTur] of giderler) {
    sonuc.push(await servis.ekle('eslestirme', { kaynakTur: odeme.tur, odemeId: odeme.id, hedefTur, hedefId: gider.id, tutar }));
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
    await eslestir(depo, servis, { tur: 'odeme', id: odeme.id, cariId: odeme.cariId }, g.tutar, g.dagitim);
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
    let iade: Gider | undefined;
    if (g.iadeId) {
      iade = await depo.getir('gider', g.iadeId);
      if (!iade || iade.firmaId !== firmaId || iade.iptal || iade.tur !== 'iade') throw new IsKuraliHatasi('İade faturası bulunamadı.');
      if (g.amac !== 'cari' || iade.cariId !== g.cariId) throw new IsKuraliHatasi('İade karşılığı tahsilat iadenin carisinden olmalı.');
    }
    const tahsilat = await servis.ekle('odeme', {
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
    // İade alacağından fazlası cari bakiyesine yazılır (bizim borcumuz olur).
    const bagli = iade ? Math.min(g.tutar, iadeAcikTutar(iade, await depo.listele('eslestirme', { firmaId }))) : 0;
    if (iade && bagli > 0) {
      await servis.ekle('eslestirme', { kaynakTur: 'odeme', odemeId: tahsilat.id, hedefTur: 'iade', hedefId: iade.id, tutar: bagli });
    }
    // Cariden tahsilat açık alacakları (ilave imalat; Aşama 3'te satış) kapatır: ekrandaki dağıtımla ya da
    // dağıtım verilmemişse en eski vadeden başlayarak. Bağlanmayan kısım cariye borcumuz (avans) olarak kalır.
    if (!iade && g.amac === 'cari' && cari) {
      const acik = await acikAlacaklar(depo, firmaId, cari.id);
      let dagitim = g.alacakDagitimi;
      if (!dagitim) {
        let kalan = g.tutar;
        dagitim = [];
        for (const a of acik) {
          if (kalan <= 0) break;
          const tutar = Math.min(kalan, a.kalan);
          dagitim.push({ alacakId: a.alacak.id, tutar });
          kalan -= tutar;
        }
      }
      const kullanilan = dagitim.filter((d) => d.tutar !== 0);
      if (kullanilan.reduce((t, d) => t + d.tutar, 0) > g.tutar) throw new IsKuraliHatasi('Alacaklara yazılan tutar tahsilattan fazla.');
      for (const d of kullanilan) {
        const a = acik.find((x) => x.alacak.id === d.alacakId);
        if (!a) throw new IsKuraliHatasi('Seçilen alacak bu carinin açık alacağı değil.');
        if (!Number.isInteger(d.tutar) || d.tutar < 0) throw new IsKuraliHatasi('Alacaklara yazılan tutarlar sıfırdan büyük olmalı.');
        if (d.tutar > a.kalan) throw new IsKuraliHatasi(`${a.alacak.aciklama}: en çok ${tlYaz(a.kalan)} yazılabilir.`);
        await servis.ekle('eslestirme', { kaynakTur: 'odeme', odemeId: tahsilat.id, hedefTur: 'alacak', hedefId: d.alacakId, tutar: d.tutar });
      }
    }
    return tahsilat;
  });
}

export interface AcikAlacak {
  alacak: Alacak;
  kalan: Kurus;
}

/** Carinin tahsil edilmemiş alacakları, vadesi (yoksa tarihi) en eski önce. */
export async function acikAlacaklar(depo: Depo, firmaId: string, cariId: string): Promise<AcikAlacak[]> {
  const eslestirmeler = await depo.listele('eslestirme', { firmaId });
  return (await depo.listele('alacak', { cariId, firmaId }))
    .map((alacak) => ({ alacak, kalan: kalanTutar('alacak', alacak, alacak.tutar, eslestirmeler) }))
    .filter((a) => a.kalan > 0)
    .sort((a, b) => (a.alacak.vadeTarihi ?? a.alacak.tarih).localeCompare(b.alacak.vadeTarihi ?? b.alacak.tarih));
}

/** Yeni ödemenin (çekle ödeme, ciro) tutarını faturalara dağıtır. Çağıran işlem içinde olmalı. */
export async function borcaDagit(depo: Depo, servis: KayitServisi, odeme: Odeme, dagitim: Dagitim[]): Promise<Eslestirme[]> {
  return eslestir(depo, servis, { tur: 'odeme', id: odeme.id, cariId: odeme.cariId }, odeme.tutar, dagitim);
}

/** Ödemenin açıkta kalan (avans) kısmını giderlere bağlar. */
export async function avansEslestir(depo: Depo, servis: KayitServisi, odemeId: string, dagitim: Dagitim[]): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const odeme = await depo.getir('odeme', odemeId);
    if (!odeme || odeme.firmaId !== firmaId || odeme.iptal) throw new IsKuraliHatasi('Ödeme bulunamadı.');
    if (odeme.yon !== 'odeme' || odeme.amac !== 'cari') throw new IsKuraliHatasi('Yalnızca cariye yapılan ödeme gidere bağlanır.');
    if (await cekiGeriDondu(depo, odeme)) throw new IsKuraliHatasi('Bu ödemenin çeki geri döndü; gidere bağlanamaz.');
    const acik = odemeAcikTutar(odeme, await depo.listele('eslestirme', { odemeId, firmaId }));
    if (acik <= 0) throw new IsKuraliHatasi('Bu ödemenin açıkta kalan kısmı yok.');
    await eslestir(depo, servis, { tur: 'odeme', id: odeme.id, cariId: odeme.cariId }, acik, dagitim);
  });
}

/** İade alacağının açık kısmını carinin faturalarına mahsup eder. */
export async function iadeMahsup(depo: Depo, servis: KayitServisi, iadeId: string, dagitim: Dagitim[]): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const iade = await depo.getir('gider', iadeId);
    if (!iade || iade.firmaId !== firmaId || iade.iptal || iade.tur !== 'iade') throw new IsKuraliHatasi('İade faturası bulunamadı.');
    if (!iade.cariId) throw new IsKuraliHatasi('Carisiz iade mahsup edilmez.');
    const acik = iadeAcikTutar(iade, await depo.listele('eslestirme', { firmaId }));
    if (acik <= 0) throw new IsKuraliHatasi('Bu iadenin açık alacağı yok.');
    await eslestir(depo, servis, { tur: 'iade', id: iade.id, cariId: iade.cariId }, acik, dagitim);
  });
}

export interface AcikIade {
  iade: Gider;
  acik: Kurus;
}

/** Carinin alacağı kapanmamış iadeleri, en eski önce. */
export async function acikIadeler(depo: Depo, firmaId: string, cariId: string): Promise<AcikIade[]> {
  const [giderler, eslestirmeler] = await Promise.all([depo.listele('gider', { cariId, firmaId }), depo.listele('eslestirme', { firmaId })]);
  return aktif(giderler)
    .filter((g) => g.tur === 'iade')
    .map((iade) => ({ iade, acik: iadeAcikTutar(iade, eslestirmeler) }))
    .filter((x) => x.acik > 0)
    .sort((a, b) => a.iade.tarih.localeCompare(b.iade.tarih));
}

// ─── Okuma ─────────────────────────────────────────────────────────

export interface AcikGider {
  hedefTur: BorcTuru;
  gider: Gider;
  kalan: Kurus;
  /** Ödeme sırası: vade (yoksa tarih); tevkifatta beyan son günü. */
  vade: Tarih;
  projeAdi: string | null;
  /** Tevkifatta faturayı kesen cari (carisiz alışta null). */
  saticiAdi: string | null;
  vadesiGecti: boolean;
}

/**
 * Carinin kalanı olan giderleri, en eski vade önce.
 * Vergi dairesi kartında bütün giderlerin ödenmemiş tevkifatı da gelir (beyan son gününe göre).
 */
export async function acikGiderler(depo: Depo, firmaId: string, cariId: string, bugun: Tarih): Promise<AcikGider[]> {
  const cari = await depo.getir('cari', cariId);
  const vd = vergiDairesiMi(cari);
  const [giderler, eslestirmeler, projeler, cariler] = await Promise.all([
    depo.listele('gider', vd ? { firmaId } : { cariId, firmaId }),
    depo.listele('eslestirme', { firmaId }),
    depo.listele('proje', { firmaId }),
    vd ? depo.listele('cari', { firmaId }) : Promise.resolve([]),
  ]);
  const projeAdi = new Map(projeler.map((p) => [p.id, p.ad]));
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const sonuc: AcikGider[] = [];
  for (const gider of aktif(giderler)) {
    const ortak = { gider, projeAdi: gider.projeId ? (projeAdi.get(gider.projeId) ?? null) : null };
    if (gider.cariId === cariId) {
      const kalan = giderKalanBorc(gider, eslestirmeler);
      const vade = gider.vadeTarihi ?? gider.tarih;
      if (kalan > 0) sonuc.push({ ...ortak, hedefTur: 'gider', kalan, vade, saticiAdi: null, vadesiGecti: !!gider.vadeTarihi && vade < bugun });
    }
    if (vd && gider.tevkifatToplam > 0) {
      const kalan = tevkifatKalan(gider, eslestirmeler);
      const vade = beyanSonGunu(tevkifatDonemi(gider.tarih));
      const saticiAdi = gider.cariId ? (cariAdi.get(gider.cariId) ?? null) : null;
      if (kalan > 0) sonuc.push({ ...ortak, hedefTur: 'tevkifat', kalan, vade, saticiAdi, vadesiGecti: vade < bugun });
    }
  }
  return sonuc.sort((a, b) => a.vade.localeCompare(b.vade) || a.gider.tarih.localeCompare(b.gider.tarih));
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
  const sonuc: AcikOdeme[] = [];
  for (const odeme of aktif(odemeler)) {
    if (odeme.yon !== 'odeme' || odeme.amac !== 'cari') continue;
    const acik = odemeAcikTutar(odeme, eslestirmeler);
    if (acik > 0 && !(await cekiGeriDondu(depo, odeme))) sonuc.push({ odeme, acik });
  }
  return sonuc.sort((a, b) => a.odeme.tarih.localeCompare(b.odeme.tarih));
}

export async function cariEkstresiGetir(depo: Depo, firmaId: string, cariId: string): Promise<CariHareketi[]> {
  const k = { cariId, firmaId };
  const [acilislar, giderler, hakedisler, odemeler, kendiCekleri, ciroHareketleri, alacaklar] = await Promise.all([
    depo.listele('acilisBakiyesi', { hedefId: cariId, firmaId }),
    depo.listele('gider', k),
    depo.listele('hakedis', k),
    depo.listele('odeme', k),
    depo.listele('cekSenet', k),
    depo.listele('cekHareketi', k),
    depo.listele('alacak', k),
  ]);
  // Vergi dairesinin ekstresine bütün giderlerin tevkifatı girer.
  const vergiDairesiId = vergiDairesiMi(await depo.getir('cari', cariId)) ? cariId : null;
  const tumGiderler = vergiDairesiId ? await depo.listele('gider', { firmaId }) : giderler;
  const cekIdler = new Set([...kendiCekleri.map((c) => c.id), ...ciroHareketleri.map((x) => x.cekSenetId)]);
  const cekler = [];
  const cekHareketleri = [];
  for (const id of cekIdler) {
    const cek = await depo.getir('cekSenet', id);
    if (cek) cekler.push(cek);
    cekHareketleri.push(...(await depo.listele('cekHareketi', { cekSenetId: id, firmaId })));
  }
  return cariEkstresi(cariId, { acilislar, giderler: tumGiderler, hakedisler, odemeler, cekler, cekHareketleri, alacaklar, vergiDairesiId });
}

export interface OdemeDetayi {
  odeme: Odeme;
  cariAdi: string | null;
  hesapAdi: string | null;
  /** Tevkifat eşleşmesinde saticiAdi faturayı kesen caridir. */
  eslesmeler: { eslestirme: Eslestirme; gider: Gider; saticiAdi: string | null }[];
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
    if (!gider) continue;
    const satici = e.hedefTur === 'tevkifat' && gider.cariId ? await depo.getir('cari', gider.cariId) : undefined;
    eslesmeler.push({ eslestirme: e, gider, saticiAdi: satici?.ad ?? null });
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
    acik: odeme.yon === 'odeme' && odeme.amac === 'cari' && !(await cekiGeriDondu(depo, odeme)) ? odemeAcikTutar(odeme, eslestirmeler) : 0,
  };
}
