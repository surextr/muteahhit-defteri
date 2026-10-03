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
  /** Oda tipi listesi: firmanın eklediği ve gizlediği tipler ("4+2"). Şema 7. */
  odaTipleri: OdaTipiAyari;
}

/** Firmanın oda tipi listesi; hazır tipler kodda (hesap/odaTipi.ts). Şema 7. */
export interface OdaTipiAyari {
  /** Firmanın eklediği tipler ("4+2"). */
  eklenen: string[];
  /** Listede gösterilmeyen tipler (hazır ya da eklenen). */
  gizli: string[];
}

/** PDF başlıklarında ve belgelerde kullanılır. Şema 5. */
export interface FirmaBilgileri {
  yetkili: string;
  telefon: string;
  eposta: string;
  web: string;
  adres: string;
  vergiDairesi: string;
  vergiNo: string;
}

export interface Firma extends TemelKayit {
  ad: string;
  abonelikDurumu: 'deneme' | 'aktif' | 'pasif';
  ayarlar: FirmaAyarlari;
  /** Şema 5. */
  bilgiler: FirmaBilgileri;
  /** Logo, data URL (cihazda küçültülmüş, en uzun kenar 600 px); yoksa null. Şema 5. */
  logo: string | null;
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

/** Tapudaki bir parsel. Toplam arsa alanı parsellerden hesaplanır, saklanmaz. Şema 6. */
export interface Parsel {
  ada: string;
  parsel: string;
  alanM2: number | null;
}

export interface ProjeAlanlari {
  net: number | null;
  brut: number | null;
  toplamInsaat: number | null;
  satilabilir: number | null;
}

export interface Proje extends FirmaKaydi {
  ad: string;
  /** İl, ilçe, mahalle listeden seçilir (veri/sabit/turkiyeAdres.json). Şema 5. */
  il: string | null;
  ilce: string | null;
  mahalle: string | null;
  /** Açık adres: cadde, sokak, no. */
  adres: string;
  /** Şema 6 (öncesinde tek ada/parsel ve alanlar.arsa). */
  parseller: Parsel[];
  arsaTipi: 'kat_karsiligi' | 'satin_alma';
  alanlar: ProjeAlanlari;
  baslangicTarihi: Tarih | null;
  /** Teslim için planlanan ve gerçekleşen bitiş. "Teslime X gün kaldı" bunlardan hesaplanır. Şema 6. */
  planlananBitis: Tarih | null;
  gerceklesenBitis: Tarih | null;
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
  /** Bina özellikleri, blok bazında. 0: asansör yok. Şema 6. */
  asansorSayisi: number;
  kapaliOtopark: boolean;
  siginak: boolean;
  jenerator: boolean;
}

export type KatTipi = 'bodrum' | 'zemin' | 'normal' | 'cati_dubleksi';

export interface Kat extends FirmaKaydi {
  projeId: string;
  blokId: string;
  ad: string;
  tip: KatTipi;
  sira: number;
}

/** Bahçe ya da çatı dubleksi. Şema 7. */
export type Dubleks = 'bahce' | 'cati';
export type Sahiplik = 'muteahhit' | 'arsa_sahibi' | 'ortak';
export type SatisDurumu = 'satisa_kapali' | 'satista' | 'rezerve' | 'sozlesmeli';
export type TeslimDurumu = 'teslim_edilmedi' | 'teslim_edildi';

export interface BagimsizBolum extends FirmaKaydi {
  projeId: string;
  blokId: string;
  katId: string;
  no: string;
  /**
   * Dikey hat: katta soldan kaçıncı bölüm (1, 2, 3…). Kat başına 3 dairede 1-4-7… aynı hattadır.
   * Krokide sütun; hat bazında toplu özellik verilir. Şema 6.
   */
  hat: number;
  tip: 'daire' | 'dukkan' | 'ofis' | 'diger';
  /** "3+1" → oda 3, salon 1. Şema 7 (önceden serbest yazı `odaTipi`). */
  odaSayisi: number | null;
  salonSayisi: number | null;
  /** Dubleks oda tipi değil, ayrı işarettir. Şema 7. */
  dubleks: Dubleks | null;
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

/** 'vergi_dairesi' sistem rolüdür: firmada tek kartta bulunur, kullanıcı seçmez. */
export type CariRol = 'usta' | 'tedarikci' | 'musteri' | 'arsa_sahibi' | 'ortak' | 'vergi_dairesi';

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
  /** Kredi kartı borç hesabıdır: kartla ödeme bakiyeyi eksiye düşürür, kart borcu bankadan transferle kapanır. */
  tur: 'kasa' | 'banka' | 'kredi_karti';
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

/**
 * Alış/gider: maliyet ve (carisi varsa) borç bu kayıttan doğar.
 * İade faturası da gider kaydıdır (tur 'iade'): tutarları eksi saklanır; maliyetten, kalem
 * gerçekleşeninden ve cari borcundan düşer. İadede tevkifat olmaz.
 */
export interface Gider extends FirmaKaydi {
  /** Şema 3. */
  tur: 'alis' | 'iade';
  /** İadede iade edilen asıl fatura (isteğe bağlı); bağlıysa iade önce onun kalan borcundan düşer. Şema 3. */
  iadeEdilenGiderId: string | null;
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
  /** KDV hariç + KDV (tevkifat düşülmeden); maliyet bu tutardır. */
  toplam: Kurus;
  /** Alıcı olarak bizim vergi dairesine ödeyeceğimiz KDV; cariye borç değildir. Şema 2. */
  tevkifatToplam: Kurus;
  /** Faturanın para birimi; dövizli gider ekranı gelene kadar 'TRY'. Tutarlar her zaman TL saklanır. Şema 2. */
  paraBirimi: ParaBirimi;
  /** Dövizli faturada işlem tarihindeki kur (1 birim = kaç TL); TL'de null. Şema 2. */
  kur: number | null;
}

/** İade faturasının satırlarında tutarlar eksidir. */
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
  /** KDV tevkifatı, örn. { pay: 4, payda: 10 }; yoksa null. Şema 2. */
  tevkifat: Tevkifat | null;
  /** KDV'nin tevkif edilen kısmı; satıcıya ödenmez, vergi dairesine biz öderiz. Şema 2. */
  tevkifatTutari: Kurus;
  /** KDV hariç + KDV (tevkifat düşülmeden). */
  toplam: Kurus;
}

/** KDV tevkifat oranı: KDV'nin pay/payda kadarı alıcı tarafından beyan edilir (örn. 4/10). */
export interface Tevkifat {
  pay: number;
  payda: number;
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

/**
 * - 'tevkifat': vergi dairesine ödemenin kapattığı, giderin (hedefId) tevkif edilen KDV'si
 * - 'iade': tahsilatın kapattığı iade alacağı (hedefId: iade gideri)
 */
export type EslestirmeHedefi = 'gider' | 'tevkifat' | 'iade' | 'hakedis' | 'taksit';

/** Hangi ödeme (ya da iade alacağı) hangi borç/alacağı ne kadar kapattı. */
export interface Eslestirme extends FirmaKaydi {
  /** Kapatan kayıt: 'odeme' tablosundan ödeme/tahsilat ya da iade faturası (mahsup). Şema 3. */
  kaynakTur: 'odeme' | 'iade';
  /** Kaynak kaydın kimliği (kaynakTur 'iade' ise gider tablosundaki iade). */
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

/** 'tahsilde': alınan çek bankaya tahsile verildi (şema 4). */
export type CekDurumu =
  | 'portfoyde'
  | 'tahsilde'
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
  /** Çekin bankası. */
  banka: string | null;
  /** Şema 4. */
  sube: string | null;
  /** Çek no / senet no. */
  seriNo: string | null;
  /** Çeki düzenleyen (keşideci) ya da senedin borçlusu; ciro ile alınan çekte çeki verenden farklıdır. Şema 4. */
  kesideci: string | null;
  /** Verilen çekin yazıldığı (vadesinde ödeneceği) banka hesabı; alınanda null. Şema 4. */
  hesapId: string | null;
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
  tur: 'fis' | 'fatura' | 'dekont' | 'sozlesme' | 'fotograf' | 'diger';
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

/** Arsa sahibinin hak ettiği pay neye göre hesaplanır. */
export type PayYontemi = 'brut' | 'net' | 'adet';

export interface KatKarsiligiSozlesme extends OnayliKayit {
  projeId: string;
  muteahhitOrani: number;
  arsaSahibiOrani: number;
  /** Arsa sahipleri ve arsadaki hisseleri (toplam %100). Şema 6. */
  arsaSahipleri: { cariId: string; hisse: number }[];
  /** Beklenen pay: brüt m² (varsayılan), net m² ya da daire sayısı. Şema 6. */
  payYontemi: PayYontemi;
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
