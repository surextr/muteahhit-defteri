import { yerelGun } from '../hesap/tarih';
import type { Depo, Kosul } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type {
  FirmaKaydi,
  IptalBilgisi,
  IslemTuru,
  KayitTabloAdi,
  OnayliKayit,
  OnayliTabloAdi,
  Tablolar,
  TemelKayit,
  Zaman,
} from '../veri/tipler';

export interface Oturum {
  firmaId: string;
  kullaniciId: string;
  cihazId: string;
}

/** Kullanıcıya olduğu gibi gösterilebilecek kural ihlali. */
export class IsKuraliHatasi extends Error {
  constructor(mesaj: string) {
    super(mesaj);
    this.name = 'IsKuraliHatasi';
  }
}

/** Servisin doldurduğu, dışarıdan yazılamayan alanlar. */
const ORTAK_ALANLAR = [
  'id',
  'firmaId',
  'olusturan',
  'olusturmaZamani',
  'guncelleyen',
  'guncellemeZamani',
  'surum',
  'iptal',
  'onay',
] as const;
type OrtakAlan = (typeof ORTAK_ALANLAR)[number];

export type YeniKayit<T extends KayitTabloAdi> = Omit<Tablolar[T], OrtakAlan>;
export type KayitDegisikligi<T extends KayitTabloAdi> = Partial<YeniKayit<T>>;

type FirmasizTabloAdi = {
  [K in KayitTabloAdi]: Tablolar[K] extends FirmaKaydi ? never : K;
}[KayitTabloAdi];

// Record tipleri sayesinde yeni bir tablo eklenip burası unutulursa derleme hata verir.
const FIRMASIZ_TABLOLAR: Record<FirmasizTabloAdi, true> = { firma: true, kullanici: true };
const ONAYLI_TABLOLAR: Record<OnayliTabloAdi, true> = {
  ustaSozlesmesi: true,
  sozlesmeDegisikligi: true,
  hakedis: true,
  katKarsiligiSozlesme: true,
  satis: true,
};

/** Bir kayıt iptal edilince onunla birlikte iptal edilen bağlı kayıtlar. */
const BAGLI_KAYITLAR: Partial<Record<KayitTabloAdi, { tablo: KayitTabloAdi; alan: string }[]>> = {
  cari: [{ tablo: 'acilisBakiyesi', alan: 'hedefId' }],
  hesap: [{ tablo: 'acilisBakiyesi', alan: 'hedefId' }],
  gider: [
    { tablo: 'giderSatiri', alan: 'giderId' },
    { tablo: 'eslestirme', alan: 'hedefId' },
  ],
  odeme: [{ tablo: 'eslestirme', alan: 'odemeId' }],
  hakedis: [{ tablo: 'eslestirme', alan: 'hedefId' }],
  taksit: [{ tablo: 'eslestirme', alan: 'hedefId' }],
  satis: [{ tablo: 'taksit', alan: 'satisId' }],
  cekSenet: [{ tablo: 'cekHareketi', alan: 'cekSenetId' }],
};

/**
 * Değişiklikte gerekçe gerekir mi?
 * Kaydı giren kişi aynı gün içinde gerekçesiz düzeltebilir; sonrasında,
 * başkasının kaydında ve onaylı kayıtlarda gerekçe zorunludur.
 */
export function gerekceGerekli(kayit: TemelKayit, kullaniciId: string, simdi: Date): boolean {
  if ((kayit as Partial<OnayliKayit>).onay) return true;
  if (kayit.olusturan !== kullaniciId) return true;
  return yerelGun(new Date(kayit.olusturmaZamani)) !== yerelGun(simdi);
}

const esit = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Bütün kayıt yazma işlemleri buradan geçer:
 * ortak alanları doldurur, silme yerine iptal eder, her değişikliği
 * işlem geçmişine eski/yeni değer, kullanıcı, zaman ve gerekçeyle yazar.
 */
export class KayitServisi {
  constructor(
    private readonly depo: Depo,
    readonly oturum: Oturum,
    private readonly saat: () => Date = () => new Date(),
  ) {}

  async ekle<T extends KayitTabloAdi>(tablo: T, veri: YeniKayit<T>, id: string = yeniId()): Promise<Tablolar[T]> {
    this.ortakAlanYok(veri);
    const zaman = this.zaman();
    const k = this.oturum.kullaniciId;
    const kayit = {
      ...veri,
      id,
      ...(tablo in FIRMASIZ_TABLOLAR ? {} : { firmaId: this.oturum.firmaId }),
      ...(tablo in ONAYLI_TABLOLAR ? { onay: null } : {}),
      olusturan: k,
      olusturmaZamani: zaman,
      guncelleyen: k,
      guncellemeZamani: zaman,
      surum: 1,
      iptal: null,
    } as unknown as Tablolar[T];

    await this.depo.islem(async () => {
      await this.depo.ekle(tablo, kayit);
      await this.gecmiseYaz(tablo, id, 'olustur', null, { ...veri }, null, zaman);
    });
    return kayit;
  }

  async guncelle<T extends KayitTabloAdi>(
    tablo: T,
    id: string,
    degisiklik: KayitDegisikligi<T>,
    gerekce?: string,
  ): Promise<Tablolar[T]> {
    this.ortakAlanYok(degisiklik);
    return this.depo.islem(async () => {
      const kayit = await this.mevcutKayit(tablo, id);
      if (kayit.iptal) throw new IsKuraliHatasi('İptal edilmiş kayıt değiştirilemez.');

      const eski: Record<string, unknown> = {};
      const yeni: Record<string, unknown> = {};
      for (const [alan, deger] of Object.entries(degisiklik)) {
        const onceki = (kayit as unknown as Record<string, unknown>)[alan];
        if (deger !== undefined && !esit(onceki, deger)) {
          eski[alan] = onceki ?? null;
          yeni[alan] = deger;
        }
      }
      if (Object.keys(yeni).length === 0) return kayit;

      const g = this.gerekceKontrol(kayit, gerekce);
      const zaman = this.zaman();
      const guncel = {
        ...kayit,
        ...yeni,
        guncelleyen: this.oturum.kullaniciId,
        guncellemeZamani: zaman,
        surum: kayit.surum + 1,
      } as Tablolar[T];
      await this.depo.yaz(tablo, guncel);
      await this.gecmiseYaz(tablo, id, 'guncelle', eski, yeni, g, zaman);
      return guncel;
    });
  }

  /** Kayıt silinmez; iptal edilir. Bağlı kayıtlar (örn. ödemenin eşleştirmeleri) de iptal edilir. */
  async iptal(tablo: KayitTabloAdi, id: string, gerekce?: string): Promise<void> {
    await this.depo.islem(async () => {
      const kayit = await this.mevcutKayit(tablo, id);
      if (kayit.iptal) throw new IsKuraliHatasi('Kayıt zaten iptal edilmiş.');
      const g = this.gerekceKontrol(kayit, gerekce);
      await this.iptalEt(tablo, kayit, {
        zaman: this.zaman(),
        kullaniciId: this.oturum.kullaniciId,
        gerekce: g ?? '',
      });
    });
  }

  async onayla(tablo: OnayliTabloAdi, id: string): Promise<void> {
    await this.depo.islem(async () => {
      const kayit = (await this.mevcutKayit(tablo, id)) as OnayliKayit;
      if (kayit.iptal) throw new IsKuraliHatasi('İptal edilmiş kayıt onaylanamaz.');
      if (kayit.onay) throw new IsKuraliHatasi('Kayıt zaten onaylı.');
      const zaman = this.zaman();
      const onay = { zaman, kullaniciId: this.oturum.kullaniciId };
      await this.depo.yaz(tablo, {
        ...kayit,
        onay,
        guncelleyen: this.oturum.kullaniciId,
        guncellemeZamani: zaman,
        surum: kayit.surum + 1,
      } as Tablolar[typeof tablo]);
      await this.gecmiseYaz(tablo, id, 'onayla', { onay: null }, { onay }, null, zaman);
    });
  }

  private async iptalEt(tablo: KayitTabloAdi, kayit: TemelKayit, bilgi: IptalBilgisi): Promise<void> {
    await this.depo.yaz(tablo, {
      ...kayit,
      iptal: bilgi,
      guncelleyen: bilgi.kullaniciId,
      guncellemeZamani: bilgi.zaman,
      surum: kayit.surum + 1,
    } as Tablolar[typeof tablo]);
    await this.gecmiseYaz(tablo, kayit.id, 'iptal', { iptal: null }, { iptal: bilgi }, bilgi.gerekce || null, bilgi.zaman);

    for (const bag of BAGLI_KAYITLAR[tablo] ?? []) {
      const kosul = { [bag.alan]: kayit.id, firmaId: this.oturum.firmaId } as Kosul<Tablolar[typeof bag.tablo]>;
      for (const bagli of await this.depo.listele(bag.tablo, kosul)) {
        if (bagli.iptal === null) {
          await this.iptalEt(bag.tablo, bagli, { ...bilgi, gerekce: `${tablo} iptaliyle. ${bilgi.gerekce}`.trim() });
        }
      }
    }
  }

  private async mevcutKayit<T extends KayitTabloAdi>(tablo: T, id: string): Promise<Tablolar[T]> {
    const kayit = await this.depo.getir(tablo, id);
    const baskaFirma = kayit && 'firmaId' in kayit && kayit.firmaId !== this.oturum.firmaId;
    if (!kayit || baskaFirma) throw new IsKuraliHatasi('Kayıt bulunamadı.');
    return kayit;
  }

  private gerekceKontrol(kayit: TemelKayit, gerekce: string | undefined): string | null {
    const g = gerekce?.trim() || null;
    if (!g && gerekceGerekli(kayit, this.oturum.kullaniciId, this.saat())) {
      throw new IsKuraliHatasi('Bu kayıtta değişiklik için gerekçe yazılmalı.');
    }
    return g;
  }

  private ortakAlanYok(veri: object): void {
    const yasak = ORTAK_ALANLAR.filter((a) => a in veri);
    if (yasak.length > 0) throw new Error(`Ortak alanlar servis tarafından doldurulur: ${yasak.join(', ')}`);
  }

  private zaman(): Zaman {
    return this.saat().toISOString();
  }

  private gecmiseYaz(
    kayitTur: KayitTabloAdi,
    kayitId: string,
    islem: IslemTuru,
    eski: Record<string, unknown> | null,
    yeni: Record<string, unknown> | null,
    gerekce: string | null,
    zaman: Zaman,
  ): Promise<void> {
    return this.depo.ekle('islemGecmisi', {
      id: yeniId(),
      firmaId: this.oturum.firmaId,
      kayitTur,
      kayitId,
      islem,
      eski,
      yeni,
      kullaniciId: this.oturum.kullaniciId,
      cihazId: this.oturum.cihazId,
      zaman,
      gerekce,
    });
  }
}
