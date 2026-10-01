// Veri yapısı: bütün tabloların kayıt tipleri.
//
// Temel kurallar (Proje Planı → Hesap ilkeleri):
// - Tutarlar kuruş cinsinden tam sayıdır (Kurus). 100.000 TL = 10_000_000.
// - Bakiye hiçbir tabloda saklanmaz; hareketlerden hesaplanır (bkz. src/hesap).
// - Kayıt silinmez; `iptal` alanı doldurulur. İptal kayıtlar hesaba girmez.
// - Her değişiklik islemGecmisi tablosuna yazılır (bkz. servisler/kayitServisi).

/** Kuruş cinsinden tam sayı tutar. */
export type Kurus = number;
/** Takvim günü, 'YYYY-AA-GG'. */
export type Tarih = string;
/** Zaman damgası, ISO 8601. */
export type Zaman = string;
export type ParaBirimi = 'TRY' | 'USD' | 'EUR' | 'GBP';

export interface IptalBilgisi {
  zaman: Zaman;
  kullaniciId: string;
  gerekce: string;
}

export interface OnayBilgisi {
  zaman: Zaman;
  kullaniciId: string;
}

/** Dövizli işlemde: döviz tutarı ve kullanılan kur kayıtta saklanır; ana tutar TL'dir. */
export interface DovizBilgisi {
  paraBirimi: Exclude<ParaBirimi, 'TRY'>;
  /** Döviz cinsinden, kuruş/sent olarak. */
  tutar: Kurus;
  /** 1 birim dövizin TL karşılığı (işlem tarihindeki kur). */
  kur: number;
}

/** Her kayıtta bulunan alanlar. */
export interface TemelKayit {
  /** UUID v7: cihazda üretilir, eşitlemede çakışmaz. */
  id: string;
  olusturan: string;
  olusturmaZamani: Zaman;
  guncelleyen: string;
  guncellemeZamani: Zaman;
  /** Her değişiklikte 1 artar; eşitlemede kullanılacak. */
  surum: number;
  iptal: IptalBilgisi | null;
}

export interface FirmaKaydi extends TemelKayit {
  firmaId: string;
}

/** Onay gerektiren kayıtlar (sözleşme, hakediş, satış). */
export interface OnayliKayit extends FirmaKaydi {
  onay: OnayBilgisi | null;
}

// ─── Firma ve sistem ────────────────────────────────────────────────

export interface FirmaAyarlari {
  /** Raporlarda maliyet KDV dahil mi gösterilsin. Veri her zaman ayrı saklanır. */
  kdvMaliyeteDahil: boolean;
  anaParaBirimi: 'TRY';
}

export interface Firma extends TemelKayit {
  ad: string;
  abonelikDurumu: 'deneme' | 'aktif' | 'pasif';
  ayarlar: FirmaAyarlari;
}

export interface Kullanici extends TemelKayit {
  ad: string;
  eposta: string | null;
}

export type Rol = 'yonetici' | 'muhasebe' | 'santiye';

export interface Uyelik extends FirmaKaydi {
  kullaniciId: string;
  rol: Rol;
  /** null: bütün projeler. */
  projeIdleri: string[] | null;
}

export type IslemTuru = 'olustur' | 'guncelle' | 'iptal' | 'onayla' | 'geriYukle';

/** Yalnızca eklenir; hiçbir zaman değiştirilmez. */
export interface IslemGecmisi {
  id: string;
  firmaId: string;
  kayitTur: string;
  kayitId: string;
  islem: IslemTuru;
  /** Değişen alanların eski değerleri (olustur'da null). */
  eski: Record<string, unknown> | null;
  /** Değişen alanların yeni değerleri. */
  yeni: Record<string, unknown> | null;
  kullaniciId: string;
  cihazId: string;
  zaman: Zaman;
  gerekce: string | null;
}

/** Tarihli ayar: yeni değer eski kayıtların hesabını değiştirmez. */
export interface AyarDegeri extends FirmaKaydi {
  /** örn. 'asgariUcret', 'sgkIsverenPrimOrani', 'asgariIscilikOrani' */
  anahtar: string;
  deger: number;
  gecerlilikBaslangici: Tarih;
  kaynak: string;
}

// ─── Proje ve bina ──────────────────────────────────────────────────

export interface ProjeAlanlari {
  net: number | null;
  brut: number | null;
  toplamInsaat: number | null;
  satilabilir: number | null;
}

export interface Proje extends FirmaKaydi {
  ad: string;
  adres: string;
  ada: string;
  parsel: string;
  arsaTipi: 'kat_karsiligi' | 'satin_alma';
  alanlar: ProjeAlanlari;
  baslangicTarihi: Tarih | null;
  durum: 'aktif' | 'tamamlandi';
}

export interface ProjeOrtagi extends FirmaKaydi {
  projeId: string;
  cariId: string;
  /** Yüzde, örn. 50 */
  oran: number;
}

export interface Blok extends FirmaKaydi {
  projeId: string;
  ad: string;
  sira: number;
}

export type KatTipi = 'bodrum' | 'zemin' | 'normal' | 'cati_dubleksi';

export interface Kat extends FirmaKaydi {
  projeId: string;
  blokId: string;
  ad: string;
  tip: KatTipi;
  sira: number;
}

export type Sahiplik = 'muteahhit' | 'arsa_sahibi' | 'ortak';
export type SatisDurumu = 'satisa_kapali' | 'satista' | 'rezerve' | 'sozlesmeli';
export type TeslimDurumu = 'teslim_edilmedi' | 'teslim_edildi';

export interface BagimsizBolum extends FirmaKaydi {
  projeId: string;
  blokId: string;
  katId: string;
  no: string;
  tip: 'daire' | 'dukkan' | 'ofis' | 'diger';
  odaTipi: string | null;
  brutM2: number | null;
  netM2: number | null;
  cephe: string | null;
  balkon: boolean;
  otopark: boolean;
  depo: boolean;
  ozellikler: string[];
  sahiplik: Sahiplik;
  satisDurumu: SatisDurumu;
  teslimDurumu: TeslimDurumu;
}

/** Merdiven, koridor, teknik oda… Satış envanterine girmez. */
export interface OrtakAlan extends FirmaKaydi {
  projeId: string;
  blokId: string | null;
  katId: string | null;
  ad: string;
  tur: string;
  alanM2: number | null;
}

/** İşin ilerleme durumu (anlaşma, ruhsat, kaba…). Başlıklar paralel yürür. */
export interface TakipBasligi extends FirmaKaydi {
  projeId: string;
  ad: string;
  sira: number;
  durum: 'baslamadi' | 'devam' | 'tamamlandi';
  baslangicTarihi: Tarih | null;
  bitisTarihi: Tarih | null;
  not: string;
}

/** Maliyet kalemi ve bütçesi. */
export interface Kalem extends FirmaKaydi {
  projeId: string;
  ustKalemId: string | null;
  ad: string;
  birim: string | null;
  butceMiktari: number | null;
  butceTutari: Kurus | null;
  sira: number;
}

// ─── Cari, kasa/banka, gider, ödeme ─────────────────────────────────

export type CariRol = 'usta' | 'tedarikci' | 'musteri' | 'arsa_sahibi' | 'ortak';

/** Bakiye alanı yoktur; hareketlerden hesaplanır. */
export interface Cari extends FirmaKaydi {
  ad: string;
  roller: CariRol[];
  telefon: string | null;
  vergiNo: string | null;
  adres: string | null;
  not: string;
}

export interface Hesap extends FirmaKaydi {
  ad: string;
  tur: 'kasa' | 'banka';
  paraBirimi: ParaBirimi;
  banka: string | null;
  iban: string | null;
}

/**
 * Açılış bakiyesi, cari veya kasa/banka için ayrı kayıt.
 * İşaret, bakiye hesabıyla aynıdır:
 * - cari:  artı = borcumuz,  eksi = alacağımız (TL)
 * - hesap: artı = hesapta para var (hesabın para biriminde)
 */
export interface AcilisBakiyesi extends FirmaKaydi {
  hedefTur: 'cari' | 'hesap';
  hedefId: string;
  tarih: Tarih;
  tutar: Kurus;
}

/** Alış/gider: maliyet ve (carisi varsa) borç bu kayıttan doğar. */
export interface Gider extends FirmaKaydi {
  tarih: Tarih;
  /** null: şirket genel gideri. */
  projeId: string | null;
  /** null: carisiz peşin gider. */
  cariId: string | null;
  faturaNo: string | null;
  vadeTarihi: Tarih | null;
  aciklama: string;
  /** Satırlardan hesaplanır; elle girilmez. */
  kdvHaricToplam: Kurus;
  kdvToplam: Kurus;
  toplam: Kurus;
  doviz: DovizBilgisi | null;
}

export interface GiderSatiri extends FirmaKaydi {
  giderId: string;
  kalemId: string | null;
  aciklama: string;
  miktar: number | null;
  birim: string | null;
  birimFiyat: Kurus | null;
  kdvHaricTutar: Kurus;
  /** Yüzde, örn. 20 */
  kdvOrani: number;
  kdvTutari: Kurus;
  toplam: Kurus;
}

/**
 * Para hareketinin amacı. 'cari' dışındakiler gelir/gider sayılmaz.
 * Faiz ödemesi ayrıca gider olarak kaydedilir.
 */
export type OdemeAmaci = 'cari' | 'ortakSermaye' | 'krediKullanim' | 'krediAnapara' | 'karDagitim';
export type OdemeYontemi = 'nakit' | 'havale' | 'kart' | 'cek' | 'senet' | 'ciro';

/** Ödeme/tahsilat: yalnızca nakit hareketi; maliyet oluşturmaz. */
export interface Odeme extends FirmaKaydi {
  tarih: Tarih;
  /** odeme: bizden çıkan; tahsilat: bize gelen */
  yon: 'odeme' | 'tahsilat';
  amac: OdemeAmaci;
  yontem: OdemeYontemi;
  cariId: string | null;
  /** Çek/senetle ödemede null; para hesaptan çek tahsil edilince çıkar. */
  hesapId: string | null;
  cekSenetId: string | null;
  projeId: string | null;
  /** TL karşılığı. */
  tutar: Kurus;
  doviz: DovizBilgisi | null;
  aciklama: string;
}

export type EslestirmeHedefi = 'gider' | 'hakedis' | 'taksit';

/** Hangi ödeme hangi borç/alacağı ne kadar kapattı. */
export interface Eslestirme extends FirmaKaydi {
  odemeId: string;
  hedefTur: EslestirmeHedefi;
  hedefId: string;
  tutar: Kurus;
}

export interface Transfer extends FirmaKaydi {
  tarih: Tarih;
  kaynakHesapId: string;
  hedefHesapId: string;
  /** Kaynak hesabın para biriminde. */
  tutar: Kurus;
  /** Para birimleri farklıysa hedef hesaba giren tutar; aynıysa null. */
  hedefTutar: Kurus | null;
  aciklama: string;
}

export type CekDurumu =
  | 'portfoyde'
  | 'ciro_edildi'
  | 'tahsil_edildi'
  | 'verildi'
  | 'odendi'
  | 'karsiliksiz'
  | 'iade_edildi';

export interface CekSenet extends FirmaKaydi {
  tur: 'cek' | 'senet';
  yon: 'alinan' | 'verilen';
  /** Alınanda çeki veren, verilende çeki alan cari. */
  cariId: string;
  vadeTarihi: Tarih;
  tutar: Kurus;
  doviz: DovizBilgisi | null;
  banka: string | null;
  seriNo: string | null;
  /** Son durum; geçmişi cekHareketi tablosunda. */
  durum: CekDurumu;
}

export interface CekHareketi extends FirmaKaydi {
  cekSenetId: string;
  tarih: Tarih;
  durum: CekDurumu;
  /** Ciro edilen cari. */
  cariId: string | null;
  /** Tahsil edilen / ödenen hesap. */
  hesapId: string | null;
  aciklama: string;
}

export interface Belge extends FirmaKaydi {
  tur: 'fis' | 'fatura' | 'sozlesme' | 'fotograf' | 'diger';
  tarih: Tarih;
  ad: string;
  bagliTur: string;
  bagliId: string;
  mime: string;
  boyut: number;
}

/** Dosyanın kendisi; listeler hızlı açılsın diye ayrı tabloda. İşlem geçmişine yazılmaz. */
export interface BelgeDosyasi {
  id: string;
  firmaId: string;
  belgeId: string;
  dosya: Blob;
}

// ─── Sonraki aşamalar (temel alanlarla; ayrıntılar kendi aşamasında) ───

export interface UstaTipi extends FirmaKaydi {
  ad: string;
  fiyatlamaBirimi: string;
  hazirKalemler: { ad: string; birim: string }[];
  varsayilanSartlar: string[];
  sablonSurumu: number;
}

export interface UstaSozlesmesi extends OnayliKayit {
  projeId: string;
  cariId: string;
  ustaTipiId: string;
  kalemler: { ad: string; birim: string; miktar: number | null; birimFiyat: Kurus }[];
  ozelSartlar: string;
  hakedisSekli: string;
  sgkTaahhudu: string | null;
  sozlesmeSurumu: number;
  toplamTutar: Kurus;
}

export interface SozlesmeDegisikligi extends OnayliKayit {
  sozlesmeId: string;
  aciklama: string;
  tutar: Kurus;
}

/** Onaylı hakediş borç doğurur. */
export interface Hakedis extends OnayliKayit {
  sozlesmeId: string;
  projeId: string;
  cariId: string;
  tarih: Tarih;
  donemAsama: string;
  miktar: number | null;
  brutTutar: Kurus;
  avansMahsubu: Kurus;
  kesintiler: Kurus;
  /** brüt − avans mahsubu − kesintiler */
  netTutar: Kurus;
  /** SGK primi hakedişte yer aldıysa ayrıca maliyete yazılmaz. */
  sgkPrimiDahil: boolean;
}

/** Tahmini ödeme planı: taahhüttür, borç değildir. */
export interface OdemePlani extends FirmaKaydi {
  sozlesmeId: string;
  vadeTarihi: Tarih;
  tutar: Kurus;
}

export interface KatKarsiligiSozlesme extends OnayliKayit {
  projeId: string;
  muteahhitOrani: number;
  arsaSahibiOrani: number;
  teslimTarihi: Tarih | null;
  gecikmeCezasi: string;
  kiraYardimi: string;
}

export interface ArsaSahibiTahsisi extends FirmaKaydi {
  sozlesmeId: string;
  cariId: string;
  bolumId: string;
}

export interface SgkKaydi extends FirmaKaydi {
  projeId: string;
  sozlesmeId: string | null;
  /** 'YYYY-AA' */
  donem: string;
  isciAdi: string;
  girisTarihi: Tarih | null;
  cikisTarihi: Tarih | null;
  gun: number;
  prim: Kurus;
  odeyen: 'muteahhit' | 'taseron';
  hakediseDahil: boolean;
}

export interface Satis extends OnayliKayit {
  projeId: string;
  bolumId: string;
  cariId: string;
  tarih: Tarih;
  fiyat: Kurus;
  kapora: Kurus;
  indirim: Kurus;
  takas: { aciklama: string; deger: Kurus }[];
  durum: 'rezerve' | 'sozlesmeli' | 'iade_edildi';
  doviz: DovizBilgisi | null;
}

export interface Taksit extends FirmaKaydi {
  satisId: string;
  cariId: string;
  vadeTarihi: Tarih;
  tutar: Kurus;
}

// ─── Tablo listesi ──────────────────────────────────────────────────

export interface Tablolar {
  firma: Firma;
  kullanici: Kullanici;
  uyelik: Uyelik;
  islemGecmisi: IslemGecmisi;
  ayarDegeri: AyarDegeri;

  proje: Proje;
  projeOrtagi: ProjeOrtagi;
  blok: Blok;
  kat: Kat;
  bagimsizBolum: BagimsizBolum;
  ortakAlan: OrtakAlan;
  takipBasligi: TakipBasligi;
  kalem: Kalem;

  cari: Cari;
  acilisBakiyesi: AcilisBakiyesi;
  hesap: Hesap;
  gider: Gider;
  giderSatiri: GiderSatiri;
  odeme: Odeme;
  eslestirme: Eslestirme;
  transfer: Transfer;
  cekSenet: CekSenet;
  cekHareketi: CekHareketi;
  belge: Belge;
  belgeDosyasi: BelgeDosyasi;

  ustaTipi: UstaTipi;
  ustaSozlesmesi: UstaSozlesmesi;
  sozlesmeDegisikligi: SozlesmeDegisikligi;
  hakedis: Hakedis;
  odemePlani: OdemePlani;
  katKarsiligiSozlesme: KatKarsiligiSozlesme;
  arsaSahibiTahsisi: ArsaSahibiTahsisi;
  sgkKaydi: SgkKaydi;
  satis: Satis;
  taksit: Taksit;
}

export type TabloAdi = keyof Tablolar;

/** Ortak alanları (TemelKayit) taşıyan, servis üzerinden yazılan tablolar. */
export type KayitTabloAdi = {
  [K in TabloAdi]: Tablolar[K] extends TemelKayit ? K : never;
}[TabloAdi];

/** Onay alanı olan tablolar. */
export type OnayliTabloAdi = {
  [K in TabloAdi]: Tablolar[K] extends OnayliKayit ? K : never;
}[TabloAdi];
