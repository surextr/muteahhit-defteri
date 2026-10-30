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
  /** Bütün usta sözleşmelerinde ortak maddeler; her usta tipinde hangilerinin geçerli olduğu işaretlenir. Şema 9. */
  ortakMaddeler: OrtakMadde[];
  /** Ön satış protokolünün varsayılan maddeleri ve metinleri; yoksa hazır başlıklar boş metinle gelir. Şema 16. */
  satisMaddeleri?: SatisMaddesi[];
  /** Harcama ilerlemeyi bu kadar puandan fazla geçince uyarı; yoksa 10. */
  ilerlemeUyariEsigi?: number;
  /** Maliyet formüllerinin firmaya özel katsayıları (formül kodu → katsayı); yeni hesaplarda kullanılır. */
  maliyetKatsayilari?: Record<string, number>;
  /** Muhasebe ve şantiye rollerinin yetkileri (hesap/yetki.ts); yoksa varsayılan. Yönetici her şeyi yapar. */
  rolYetkileri?: Partial<Record<'muhasebe' | 'santiye', string[]>>;
  /** İsteğe bağlı ek kısıtlar (yönetici açar; yöneticiye uygulanmaz). */
  kisitlar?: EkKisitlar;
}

export interface EkKisitlar {
  /** Bulutta yetkisi olmayan kayıtlar (ve kısıtlı kişide başka projelerin kayıtları) o kişinin cihazına hiç inmez. */
  gorme?: boolean;
  /** Sunucu iş kurallarını da denetler: onay, hakedişten oluşan gider, kaydı oluşturan/değiştiren alanları. */
  sunucuKurallari?: boolean;
}

/** Usta sözleşmesi ortak maddesi; `id` değişmez (tipteki kapalı maddeler bununla tutulur). */
export interface OrtakMadde {
  id: string;
  metin: string;
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
  /** Şantiyenin yeri (fotoğrafları konumdan projeye bağlamak için). Şema 20. */
  konum: { enlem: number; boylam: number } | null;
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

/**
 * Ana kalemin tamamlanma yüzdesi (şema 17). Güncelleme eski kaydı değiştirmez, yeni tarihli satır eklenir;
 * geçerli yüzde kalemin en yeni tarihli (eşitse en son girilen) iptal edilmemiş kaydıdır. Yanlış giriş iptal edilir.
 */
export interface KalemIlerlemesi extends FirmaKaydi {
  projeId: string;
  /** Ana kalem (ustKalemId null). */
  kalemId: string;
  tarih: Tarih;
  /** 0–100. */
  yuzde: number;
  /** Elle mi girildi, hakedişten önerilip onaylandı mı. */
  kaynak: 'elle' | 'hakedis';
  hakedisId: string | null;
  not: string;
}

/**
 * Şantiye fotoğrafı (şema 20): inşaatın aşama aşama fotoğrafları. Dosya bağlı `belge`dedir (bagliTur 'projeFotografi',
 * tur 'fotograf'); listeler hızlı açılsın diye küçük resim kayıtta. Silinmez, iptal edilir (belgesi de).
 */
export interface ProjeFotografi extends FirmaKaydi {
  projeId: string;
  cekimTarihi: Tarih;
  /** 'SS:DD'; aynı gündeki sıra için. */
  cekimZamani: string | null;
  /** Tarih nereden geldi: fotoğraftaki EXIF bilgisi, dosya adı ya da elle. */
  tarihKaynagi: 'exif' | 'dosyaAdi' | 'elle';
  /** Aşama (takip başlığı); varsayılan seçim. */
  takipBasligiId: string | null;
  /** Bütçe ana kalemi (isteğe bağlı). */
  kalemId: string | null;
  blokId: string | null;
  katId: string | null;
  aciklama: string;
  /** ~360 px JPEG data URL. */
  kucukResim: string;
  /** Fotoğraf proje konumundan uzakta çekildiyse km (uyarı için); konum yoksa null. Konumun kendisi saklanmaz. */
  uzaklikKm: number | null;
}

/**
 * Malzeme / işçilik / makine kataloğu (şema 21): maliyet hesabının birim fiyatları. Fiyat KDV hariç, birim başına; her
 * fiyatın kaynağı ve tarihi tutulur. Hazır listeden gelenlerde `sistemKodu` (veri/sabit/hazirFiyatKalemleri.ts).
 */
export interface FiyatKalemi extends FirmaKaydi {
  tur: 'malzeme' | 'iscilik' | 'makine';
  ad: string;
  birim: string;
  /** Bütçe kalemi sistem kodu (gruplama ve bütçeye aktarma için). */
  butceKalemiKodu: string | null;
  aciklama: string;
  sistemKodu: string | null;
  /** İşçilikte usta tipinin sistem kodu (son sözleşme fiyatı önerisi için). */
  ustaTipiKodu: string | null;
  fiyat: Kurus | null;
  kdvOrani: number;
  fiyatTarihi: Tarih | null;
  fiyatKaynagi: FiyatKaynagi | null;
  /** Firma adı, bağlantı, teklif no; yapay zekâda kaynak listesi. */
  kaynakNotu: string;
  /** Yapay zekâ araştırmasının aralığı ve kaynakları (son araştırma). */
  arastirma: FiyatArastirmasi | null;
  /** "Araştırılacak" işareti. */
  arastirilacak: boolean;
}

export type FiyatKaynagi = 'elle' | 'arastirma' | 'yz' | 'sonAlis' | 'sonSozlesme';

export interface FiyatArastirmasi {
  tarih: Tarih;
  enDusuk: Kurus | null;
  enYuksek: Kurus | null;
  onerilen: Kurus | null;
  /** Bulunan fiyatın birimi (katalogdakinden farklıysa açıklamada). */
  not: string;
  kaynaklar: { baslik: string; url: string; fiyat: Kurus | null }[];
}

/**
 * Maliyet hesabı (şema 22): projeye bağlı ya da projesiz. Satırların miktarı formülle (bina girdilerinden), elle (dayanağıyla)
 * ya da projeden (DWG/PDF, sonraki adım) gelir; fiyat listeden canlı okunur, hesaba özel fiyat verilebilir. Onay = başlangıç
 * maliyeti: fiyatlar satırlara dondurulur, hesap değişmez; değişiklik için revizyon açılır (eskisi olduğu gibi kalır).
 */
export interface MaliyetHesabi extends OnayliKayit {
  ad: string;
  projeId: string | null;
  /** 1, 2, 3…; revizyon açılınca +1 (yeni kayıt). */
  revizyon: number;
  /** Revizyonun açıldığı önceki hesap. */
  oncekiHesapId: string | null;
  girdiler: BinaGirdileri;
  satirlar: MaliyetSatiri[];
  aciklama: string;
}

/** Formüllerin kullandığı bina bilgileri; boş olan formül miktar vermez ("Girdi eksik"). */
export interface BinaGirdileri {
  /** Toplam inşaat alanı, bodrum dahil (m²). */
  insaatAlani: number | null;
  /** Taban (oturum / temel) alanı (m²). */
  tabanAlani: number | null;
  /** Zemin ve üstündeki katlar (bodrum hariç). */
  normalKatSayisi: number | null;
  bodrumKatSayisi: number | null;
  /** Ortalama kat yüksekliği (m). */
  katYuksekligi: number | null;
  /** Dış çevre (m); boşsa taban alanından yaklaşık (4 × √alan). */
  disCevre: number | null;
  /** Bağımsız bölüm (daire, dükkân, ofis). */
  daireSayisi: number | null;
  /** Banyo + WC sayısı. */
  islakHacimSayisi: number | null;
  /** İnşaat süresi (ay); şantiye giderleri için. */
  sureAy: number | null;
}

export type MiktarKaynagi = 'formul' | 'elle' | 'proje';

export interface MaliyetSatiri {
  /** Kalıcı kimlik (satır sırası değişse de). */
  id: string;
  /** Fiyatın okunduğu katalog kalemi; serbest satırda null (fiyat yalnız hesaba özel). */
  fiyatKalemiId: string | null;
  tur: 'malzeme' | 'iscilik' | 'makine';
  ad: string;
  birim: string;
  butceKalemiKodu: string | null;
  miktarKaynagi: MiktarKaynagi;
  /** Formül satırında formülün kodu (veri/sabit/maliyetFormulleri.ts). */
  formulKodu: string | null;
  /** Formül katsayısı (hesaba özel; boşsa formülün varsayılanı). */
  katsayi: number | null;
  /** Formülde kayıtta hesaplanır; elle/projede yazılan. */
  miktar: number | null;
  /** Miktarın dayanağı: formülde kendiliğinden ("İnşaat alanı 1.850 m² × 0,40 m³/m²"), elle zorunlu. */
  dayanak: string;
  /** Bu hesaba özel birim fiyat (KDV hariç); null = listeden. */
  ozelFiyat: Kurus | null;
  /** Onayda dondurulan fiyat (liste ya da özel). */
  dondurulan: { fiyat: Kurus | null; kaynak: FiyatKaynagi | 'ozel' | null; tarih: Tarih | null; kdvOrani: number } | null;
  /** Daire bazında ek istek (projeli hesapta): miktar = bölüm başı miktar × bölüm sayısı. Yoksa genel satır. */
  ekIstek?: EkIstek | null;
}

export interface EkIstek {
  bolumIdleri: string[];
  /** Bir bölüm için miktar (satır biriminde). */
  birimMiktar: number;
  /** İsteğin açıklaması ("müşteri isteği: parke"). */
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
  /** Hazır kalemin değişmeyen kodu (veri/sabit/hazirKalemKodlari.ts); kullanıcının açtığı kalemde null. Şema 8. */
  sistemKodu: string | null;
}

// ─── Cari, kasa/banka, gider, ödeme ─────────────────────────────────

/** 'vergi_dairesi' sistem rolüdür: firmada tek kartta bulunur, kullanıcı seçmez. */
export type CariRol = 'usta' | 'taseron' | 'tedarikci' | 'musteri' | 'arsa_sahibi' | 'ortak' | 'vergi_dairesi';

/** Bakiye alanı yoktur; hareketlerden hesaplanır. */
export interface Cari extends FirmaKaydi {
  /** Kişi adı ya da firma unvanı; meslek buraya yazılmaz, `ustaTipiIdleri`nde tutulur. */
  ad: string;
  roller: CariRol[];
  /** Usta/taşeronun branşları (usta tipi kimlikleri), ilki ana branş. Usta ya da taşeron rolü yoksa boş. Şema 12. */
  ustaTipiIdleri: string[];
  /** Firma (çoğunlukla taşeron) adına sözleşmeyi imzalayan kişi. Şema 12. */
  yetkili: string | null;
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
  /** Onaylı hakedişin oluşturduğu gider; elle değiştirilmez, hakedişle iptal olur. Şema 14. */
  hakedisId: string | null;
  /** Kredi taksitinin faizi (finansman gideri); kredi ekranından ödenir ve geri alınır. Şema 23. */
  krediId?: string | null;
  krediTaksitId?: string | null;
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
  /** Bu satır bir ilave imalatın maliyetiyse (maliyet / alınan karşılaştırması). Şema 8. */
  ilaveImalatId: string | null;
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
  /** Kredi kullanımı (tahsilat) ya da taksit anapara ödemesi bu krediye ait. Şema 23. */
  krediId?: string | null;
  /** Taksit ödemesinde ödenen taksit (kredi.taksitler[].id). Şema 23. */
  krediTaksitId?: string | null;
}

/**
 * - 'tevkifat': vergi dairesine ödemenin kapattığı, giderin (hedefId) tevkif edilen KDV'si
 * - 'iade': tahsilatın kapattığı iade alacağı (hedefId: iade gideri)
 */
export type EslestirmeHedefi = 'gider' | 'tevkifat' | 'iade' | 'hakedis' | 'taksit' | 'alacak';

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

// ─── Belge havuzu (şema 19) ───────────────────────────────────────

/**
 * Belgeden okunan fatura bilgisi (e-Fatura/e-Arşiv karekodu ya da UBL XML dosyası). Tutarlar kuruş.
 * Karekodda satır yoktur; KDV oranlarına göre matrahlar gelir.
 */
export interface HavuzTanima {
  /** 'yz': yapay zekâ ile okundu (fotoğraf/PDF; kullanıcı rızasıyla). */
  kaynak: 'karekod' | 'xml' | 'yz';
  satici: { vergiNo: string | null; ad: string | null; adres: string | null; telefon: string | null; vergiDairesi: string | null };
  /** Faturanın kesildiği (alıcı) VKN/TCKN; firmanınkiyle karşılaştırılır. */
  aliciVergiNo: string | null;
  faturaNo: string | null;
  tarih: Tarih | null;
  ettn: string | null;
  iade: boolean;
  paraBirimi: string;
  /** KDV oranına göre KDV hariç tutar ve KDV. */
  kdvler: { oran: number; matrah: Kurus; kdv: Kurus }[];
  tevkifat: Kurus;
  /** Ödenecek (tevkifat düşülmüş, KDV dahil). */
  odenecek: Kurus | null;
  /** XML'de satırlar (KDV hariç tutar); karekodda boş. */
  satirlar: { ad: string; miktar: number | null; birim: string | null; tutar: Kurus; kdvOrani: number; tevkifat: { pay: number; payda: number } | null }[];
}

/**
 * Onay bekleyen belge. Dosya, bağı `bagliTur: 'belgeHavuzu'` olan bir `belge` kaydıdır; onaylanınca belgenin bağı
 * asıl kayda çevrilir (dosya taşınmaz) ve burada `durum: 'baglandi'` olur. Gereksiz belge iptal edilir.
 */
export interface HavuzBelgesi extends FirmaKaydi {
  belgeId: string;
  durum: 'bekliyor' | 'baglandi';
  /** Dosyanın SHA-256 özeti; aynı dosya ikinci kez yüklenince uyarılır. */
  ozet: string;
  tanima: HavuzTanima | null;
  not: string;
  /** Bağlandığı kayıt. */
  sonuc: { tablo: string; id: string } | null;
  /** Yapay zekâ ile okuma sonucu (tür, dekont/çek/belge bilgisi, ayrıntılı sözleşme). Aşama 4; eski kayıtta yok. */
  okuma?: YzOkuma | null;
  /**
   * Fotoğrafsa yüklerken (küçültmeden önce) okunan çekim tarihi ve konumu şantiyesi girilmiş projelere uzaklık (km).
   * Konumun kendisi saklanmaz. Şema 20 ile geldi; eski kayıtta yok.
   */
  cekim?: HavuzCekim | null;
}

export interface HavuzCekim {
  tarih: Tarih | null;
  zaman: string | null;
  kaynak: 'exif' | 'dosyaAdi' | 'elle';
  /** projeId → km (fotoğrafta konum yoksa boş). */
  projeUzakliklari: Record<string, number>;
}

export type YzBelgeTuru =
  | 'fatura'
  | 'fis'
  | 'dekont'
  | 'cek'
  | 'senet'
  | 'sozlesme_usta'
  | 'sozlesme_kat_karsiligi'
  | 'sozlesme_satis'
  | 'ruhsat'
  | 'iskan'
  | 'tapu'
  | 'proje_cizimi'
  | 'santiye_fotografi'
  | 'kimlik'
  | 'vergi_levhasi'
  | 'irsaliye'
  | 'diger';

export interface YzDekont {
  tarih: Tarih | null;
  tutar: Kurus | null;
  paraBirimi: string;
  gonderenAd: string | null;
  gonderenIban: string | null;
  aliciAd: string | null;
  aliciIban: string | null;
  banka: string | null;
  aciklama: string | null;
}

export interface YzCek {
  tur: 'cek' | 'senet';
  banka: string | null;
  sube: string | null;
  seriNo: string | null;
  vade: Tarih | null;
  tutar: Kurus | null;
  kesideci: string | null;
  lehtar: string | null;
}

export interface YzBelgeBilgisi {
  tarih: Tarih | null;
  ada: string | null;
  parsel: string | null;
  adres: string | null;
  kisiAdi: string | null;
  kisiNo: string | null;
}

export interface YzTaraf {
  ad: string | null;
  no: string | null;
  telefon: string | null;
  adres: string | null;
  yetkili: string | null;
}

/** Program dışında imzalanmış eski sözleşmeden okunanlar (amac 'sozlesme'). Tutarlar kuruş. */
export interface YzSozlesme {
  tur: 'usta' | 'kat_karsiligi' | 'satis' | 'diger';
  tarih: Tarih | null;
  karsiTaraf: YzTaraf;
  usta: {
    isler: string[];
    kalemler: { is: string | null; ad: string; birim: string | null; miktar: number | null; birimFiyat: Kurus | null }[];
    toplamTutar: Kurus | null;
    baslama: Tarih | null;
    bitis: Tarih | null;
    hakedisSekli: string | null;
    teminatOrani: number | null;
    ozelSartlar: string[];
    odemePlani: { vade: Tarih | null; tutar: Kurus | null; aciklama: string }[];
  } | null;
  katKarsiligi: {
    arsaSahipleri: { ad: string; no: string | null; hisse: number | null }[];
    arsaSahibiOrani: number | null;
    ada: string | null;
    parsel: string | null;
    teslimTarihi: Tarih | null;
    teslimSuresiAy: number | null;
    gecikmeCezasi: { tutar: Kurus; birim: 'daire_aylik' | 'toplam_aylik' | 'gunluk' } | null;
    kiraYardimiAylik: Kurus | null;
    nakitOdemeler: { vade: Tarih | null; tutar: Kurus | null; aciklama: string }[];
  } | null;
  satis: {
    blok: string | null;
    daireNo: string | null;
    fiyat: Kurus | null;
    paraBirimi: string;
    kdvOrani: number | null;
    kapora: Kurus | null;
    plan: { tur: 'kapora' | 'pesinat' | 'taksit' | 'teslimde'; vade: Tarih | null; tutar: Kurus | null }[];
    teslimTarihi: Tarih | null;
  } | null;
  eksikler: string[];
}

export interface YzOkuma {
  zaman: Zaman;
  tur: YzBelgeTuru;
  guven: 'yuksek' | 'orta' | 'dusuk';
  ozet: string;
  dekont: YzDekont | null;
  cek: YzCek | null;
  belge: YzBelgeBilgisi | null;
  /** Ayrıntılı sözleşme okuması (ayrı istekle). */
  sozlesme: YzSozlesme | null;
}

// ─── Usta tipleri ve sözleşmeler; sonraki aşamalar (temel alanlarla) ───

export type HakedisSekli = 'beton_dokumu' | 'kat' | 'yuzde' | 'is_bitimi' | 'asamali' | 'haftalik_aylik';
export type SorumlulukCevabi = 'muteahhit' | 'usta' | 'sozlesmede';

/**
 * Usta tipi ve kalem şablonu (şema 9). Sözleşme kurulurken kalemler ve şartlar sözleşmeye kopyalanır,
 * `sablonSurumu` da yazılır; şablon sonra değişse de sözleşme değişmez.
 */
export interface UstaTipi extends FirmaKaydi {
  ad: string;
  /** Hazır tipin değişmeyen kodu (veri/sabit/hazirUstaTipleri.ts); firmanın açtığı tipte null. */
  sistemKodu: string | null;
  fiyatlamaBirimi: string;
  /** Varsayılan bütçe kalemi (kalem sistem kodu); sözleşmede değiştirilebilir. */
  butceKalemiKodu: string | null;
  hakedisSekli: HakedisSekli;
  /** Sözleşmeye gelen varsayılan hakediş hesaplanışı; sözleşmede değiştirilebilir. Şema 14. */
  takipYontemi: TakipYontemi;
  /** Satır bütçe kalemi boşsa tipin varsayılanı geçer (şema 10). */
  kalemler: { ad: string; birim: string; aciklama: string; butceKalemiKodu: string | null }[];
  /** Sözleşmede sorulacak sorumluluklar; varsayılan cevap boşsa her sözleşmede sorulur. */
  sorular: { soru: string; varsayilan: SorumlulukCevabi | null }[];
  ozelSartlar: string[];
  /** Bu tipte geçerli olmayan ortak maddelerin kimlikleri. */
  kapaliOrtakMaddeler: string[];
  /** Her değişiklikte bir artar. */
  sablonSurumu: number;
  /** Seçim listelerinde gösterilmez. */
  gizli: boolean;
}

/**
 * Sözleşmedeki bir iş (usta tipi). Toplu sözleşmede birden çok olur (örn. sıva + boya); her birinin kalemleri,
 * sorumlulukları ve hakediş şekli ayrıdır. Bölüm anahtarı usta tipi kimliğidir (bir sözleşmede bir tip bir kez). Şema 13.
 */
export interface SozlesmeBolumu {
  ustaTipiId: string;
  /** Kurulduğu andaki tip adı ve şablon sürümü. */
  ustaTipiAdi: string;
  sablonSurumu: number;
  hakedisSekli: HakedisSekli;
  /** Hakedişin nasıl hesaplanacağı: yapılan miktar, tamamlanan aşama ya da doğrudan tutar. Şema 14. */
  takipYontemi: TakipYontemi;
  /** Aşamalı takipte aşamalar ve tutarları (örn. "1. kat betonu"); diğer yöntemlerde boş. Şema 14. */
  asamalar: SozlesmeAsamasi[];
}

/** Hakediş hesaplama yöntemi. Şema 14. */
export type TakipYontemi = 'metraj' | 'asama' | 'tutar';

/** Aşamalı hakedişte bir aşama; tamamlanınca tutarı hakedişe girer. Şema 14. */
export interface SozlesmeAsamasi {
  id: string;
  ad: string;
  tutar: Kurus;
}

/** Sözleşme kalemi: şablondan kopyalanır, miktar ve birim fiyat sözleşmede yazılır. Şema 11. */
export interface SozlesmeKalemi {
  /** Kalıcı kimlik: hakedişlerdeki metraj bu kaleme yazılır. Şema 14. */
  id: string;
  /** Kalemin ait olduğu bölüm (usta tipi). Şema 13. */
  ustaTipiId: string;
  ad: string;
  birim: string;
  aciklama: string;
  /** Tahmini miktar; boşsa yalnız birim fiyat anlaşılmıştır (ödeme ölçülen miktara göre). */
  miktar: number | null;
  birimFiyat: Kurus;
  /** Bütçe kalemi (kalem sistem kodu); şablon satırından ya da tipin varsayılanından gelir. */
  butceKalemiKodu: string | null;
}

/** Sorumluluk sorusunun sözleşmedeki cevabı; `cevap` null ise henüz cevaplanmadı. Şema 11. */
export interface SozlesmeSorumlulugu {
  /** Sorunun geldiği bölüm (usta tipi). Şema 13. */
  ustaTipiId: string;
  soru: string;
  cevap: SorumlulukCevabi | null;
  /** Cevap 'sozlesmede' ise sözleşmeye yazılacak hüküm. */
  aciklama: string;
}

/** Ortak madde (firma ayarından kopyalanır) ve bu sözleşmedeki hükmü. Şema 11. */
export interface SozlesmeOrtakMaddesi {
  id: string;
  baslik: string;
  cevap: string;
}

/**
 * Usta sözleşmesi (şema 11). Usta tipinden kopyalanarak kurulur; şablon sonra değişse de sözleşme değişmez.
 * Taahhüttür, borç doğurmaz (borç onaylı hakedişle doğar). Onay = imzalandı; sonraki her değişiklik gerekçe
 * ister ve `sozlesmeSurumu` bir artar.
 */
export interface UstaSozlesmesi extends OnayliKayit {
  projeId: string;
  cariId: string;
  /** İşler; en az bir tane, ilki ana iş. Şema 13. */
  bolumler: SozlesmeBolumu[];
  /** Ana işin (ilk bölüm) tipi; kayıtta bölümlerden yazılır, listeler ve dizin için. */
  ustaTipiId: string;
  /** Bölüm adları " + " ile ("Sıvacı + Boyacı"); kayıtta bölümlerden yazılır. */
  ustaTipiAdi: string;
  /** Ana işin şablon sürümü; kayıtta bölümlerden yazılır. */
  sablonSurumu: number;
  sozlesmeTarihi: Tarih | null;
  baslamaTarihi: Tarih | null;
  bitisTarihi: Tarih | null;
  fiyatlamaBirimi: string;
  kalemler: SozlesmeKalemi[];
  sorumluluklar: SozlesmeSorumlulugu[];
  ortakMaddeler: SozlesmeOrtakMaddesi[];
  ozelSartlar: string;
  /** Ana işin hakediş şekli; kayıtta bölümlerden yazılır (her işin kendi şekli bölümdedir). */
  hakedisSekli: HakedisSekli;
  /** Örn. "Hakediş onayından sonra 7 gün içinde"; boş olabilir. */
  odemeKosulu: string;
  /** Her hakedişten tutulan teminat yüzdesi (örn. 5); 0 ise teminat yok. Şema 14. */
  teminatOrani: number;
  sgkTaahhudu: string | null;
  sozlesmeSurumu: number;
  /** Tahmini tutar: aşamalı işte aşamaların, diğerlerinde miktarı yazılı kalemlerin toplamı (kayıtta hesaplanır). */
  toplamTutar: Kurus;
  not: string;
}

export interface SozlesmeDegisikligi extends OnayliKayit {
  sozlesmeId: string;
  aciklama: string;
  tutar: Kurus;
}

/** Hakedişin bir satırı: metrajda kalem miktarı, aşamada tamamlanan aşama, tutarda işe yazılan tutar. Şema 14. */
export interface HakedisSatiri {
  ustaTipiId: string;
  /** Takip yöntemi ya da 'ilave': sözleşmede olmayan, sonradan anlaşılan iş (şema 15). */
  tur: TakipYontemi | 'ilave';
  /** Sözleşme kaleminin (metraj) ya da aşamanın kimliği; tutarda null. */
  kaynakId: string | null;
  aciklama: string;
  /** Metrajda bu hakedişte yapılan miktar; diğerlerinde null. */
  miktar: number | null;
  birim: string;
  birimFiyat: Kurus | null;
  /** KDV hariç. */
  tutar: Kurus;
  butceKalemiKodu: string | null;
}

/** Kalıcı kesinti (ceza, usta adına alınan malzeme…); hakedişin tutarını ve maliyeti düşürür. */
export interface HakedisKesintisi {
  aciklama: string;
  tutar: Kurus;
}

/**
 * Hakediş (şema 14). Taslak serbestçe düzenlenir; onaylanınca bir gider kaydı (`giderId`) oluşturulur: borç ve
 * maliyet o giderden doğar, avans mahsubu o gidere eşleştirilir. Onaylı hakediş değiştirilmez, iptal edilir
 * (gider ve eşleştirmeleri de iptal olur).
 */
export interface Hakedis extends OnayliKayit {
  sozlesmeId: string;
  projeId: string;
  cariId: string;
  /** Sözleşmedeki sıra numarası (1, 2, 3…). */
  no: number;
  tarih: Tarih;
  /** Dönem ya da açıklama, örn. "Kasım 2026" ya da "3. kat". */
  donemAsama: string;
  satirlar: HakedisSatiri[];
  kesintiler: HakedisKesintisi[];
  kdvOrani: number;
  tevkifat: Tevkifat | null;
  /** Sözleşmeden gelir, hakedişte değiştirilebilir; 0: teminat yok. */
  teminatOrani: number;
  /** Bu hakedişte açık ödemelerden (avans) mahsup edilecek tutar. */
  avansMahsubu: Kurus;
  /** Aşağıdakiler kayıtta hesaplanır (hesap/hakedis.ts). */
  brutTutar: Kurus;
  kesintiToplam: Kurus;
  kdvTutari: Kurus;
  tevkifatTutari: Kurus;
  /** Cariye doğan borç: brüt − kesinti + KDV − tevkifat. */
  borcTutari: Kurus;
  /** Borcun içinde olup iş bitimine kadar ödenmeyen kısım. */
  teminatTutari: Kurus;
  /** Şimdi ödenecek: borç − teminat − avans mahsubu. */
  netTutar: Kurus;
  /** Onayla oluşan gider; taslakta null. */
  giderId: string | null;
  /** SGK primi hakedişte yer aldıysa ayrıca maliyete yazılmaz. */
  sgkPrimiDahil: boolean;
  not: string;
}

/** Tahmini ödeme planı: taahhüttür, borç değildir. */
export interface OdemePlani extends FirmaKaydi {
  sozlesmeId: string;
  vadeTarihi: Tarih;
  tutar: Kurus;
  /** Örn. "1. kat betonu sonrası" ya da "Kasım hakedişi". Şema 15. */
  aciklama: string;
}

/**
 * Teminatın serbest bırakılması (şema 15): hakedişlerden tutulan teminatın bu kadarı artık ödenebilir.
 * Borç değişmez (teminat zaten borcun içindedir); yalnız "bekleyen teminat" azalır. Ödeme ayrıca yapılır.
 */
export interface TeminatIadesi extends FirmaKaydi {
  sozlesmeId: string;
  cariId: string;
  tarih: Tarih;
  tutar: Kurus;
  aciklama: string;
}

/** Arsa sahibinin hak ettiği pay neye göre hesaplanır. */
export type PayYontemi = 'brut' | 'net' | 'adet';

/** Arsa sahibi, hissesi ve kira yardımı (şema 8: kira alanları). */
export interface SozlesmedekiArsaSahibi {
  cariId: string;
  hisse: number;
  /** Aylık kira yardımı; yoksa null. Teslime kadar her ay doğar (saklanmaz, hesaplanır). */
  kiraAylik: Kurus | null;
  /** İlk kira ayı (tahliye). */
  kiraBaslangic: Tarih | null;
  /** Dairelerini teslim aldığı gün: kira yardımı ve gecikme cezası burada durur. */
  teslimAlindi: Tarih | null;
}

/** Gecikme cezası: geciken her ay daire başına, her ay toplam ya da her gün toplam. Otomatik borç olmaz. Şema 8. */
export interface GecikmeCezasi {
  tutar: Kurus;
  birim: 'daire_ay' | 'ay' | 'gun';
}

export interface KatKarsiligiSozlesme extends OnayliKayit {
  projeId: string;
  muteahhitOrani: number;
  arsaSahibiOrani: number;
  /** Arsa sahipleri ve arsadaki hisseleri (toplam %100). Şema 6. */
  arsaSahipleri: SozlesmedekiArsaSahibi[];
  /** Beklenen pay: brüt m² (varsayılan), net m² ya da daire sayısı. Şema 6. */
  payYontemi: PayYontemi;
  /** Şema 8. */
  sozlesmeTarihi: Tarih | null;
  /** Kesin teslim tarihi; `teslimSuresiAy` doluysa kullanılmaz. */
  teslimTarihi: Tarih | null;
  /** "Ruhsattan itibaren X ay": tarih, Ruhsat takip başlığının bitişinden hesaplanır. Şema 8. */
  teslimSuresiAy: number | null;
  gecikmeCezasi: GecikmeCezasi | null;
  /** Serbest not (şema 8 öncesinin ceza/kira yazıları buraya taşındı). */
  not: string;
}

/** Arsa sahibine nakit ödeme planı satırı: taahhüttür, cari borcu değildir. Şema 8. */
export interface ArsaSahibiOdemesi extends FirmaKaydi {
  sozlesmeId: string;
  projeId: string;
  cariId: string;
  /** Kesin vade; koşula bağlıysa null ("Ruhsat alınınca"). */
  vadeTarihi: Tarih | null;
  kosul: string;
  tutar: Kurus;
  aciklama: string;
}

export type IlaveImalatDurumu = 'talep' | 'onaylandi' | 'reddedildi' | 'yapildi';

/** Arsa sahibinin ek iş talebi. Arsa sahibi öder ve onaylanırsa alacak doğar. Şema 8. */
export interface IlaveImalat extends FirmaKaydi {
  sozlesmeId: string;
  projeId: string;
  cariId: string;
  bolumId: string | null;
  tarih: Tarih;
  aciklama: string;
  tutar: Kurus;
  oder: 'arsa_sahibi' | 'muteahhit';
  durum: IlaveImalatDurumu;
}

/**
 * Cariden alacağımız (bize borç): ilave imalat, Aşama 3'te daire satış taksitleri.
 * Cari bakiyesinde "alacak" hareketi; tahsilat eşleştirmesiyle (hedefTur 'alacak') kapanır. Şema 8.
 */
export interface Alacak extends FirmaKaydi {
  projeId: string | null;
  cariId: string;
  tarih: Tarih;
  vadeTarihi: Tarih | null;
  tutar: Kurus;
  aciklama: string;
  kaynakTur: 'ilaveImalat' | 'satis' | null;
  kaynakId: string | null;
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

/** Satış ödeme planı satırı. Sözleşme imzalanınca her satır bir alacak kaydı olur (`alacakId`). Şema 16. */
export interface SatisPlanSatiri {
  id: string;
  tur: 'kapora' | 'pesinat' | 'taksit' | 'teslimde';
  vadeTarihi: Tarih;
  tutar: Kurus;
  aciklama: string;
  /** İmzadan sonra bu satırın alacağı; taslakta null. */
  alacakId: string | null;
}

/** Bedelin bir kısmı karşılığında alınan mal (araba, arsa, başka daire). Şema 16. */
export interface SatisTakasi {
  aciklama: string;
  deger: Kurus;
}

/** Satışta daireye özel ek iş: satış tutarı KDV dahil, bedele eklenir; maliyet hesabından geldiyse maliyeti bilgi için. Şema 23. */
export interface SatisEkIstegi {
  id: string;
  ad: string;
  /** Alıcıya satış tutarı, KDV dahil. */
  tutar: Kurus;
  /** Maliyet hesabındaki bölüm başı maliyet (KDV hariç); elle eklenende null. */
  maliyet: Kurus | null;
  /** Maliyet hesabının ek istek satırı. */
  maliyetSatiriId: string | null;
}

/** Ön satış protokolünün maddesi (tapu, teslim, cayma…). Firma ayarından kopyalanır. Şema 16. */
export interface SatisMaddesi {
  id: string;
  baslik: string;
  metin: string;
}

/**
 * Daire satışı (şema 16). Taslak = rezerve (bölüm satışa kapanır); onay = ön satış protokolü imzalandı: ödeme planının
 * her satırı müşteriye alacak olur, bölüm "sözleşmeli" olur. Bedel KDV dahildir; KDV raporda ayrılır.
 */
export interface Satis extends OnayliKayit {
  projeId: string;
  bolumId: string;
  /** Müşteri (alıcı). */
  cariId: string;
  /** Satış (protokol) tarihi. */
  tarih: Tarih;
  /** Anlaşılan fiyat, KDV dahil. */
  fiyat: Kurus;
  indirim: Kurus;
  /** Bedelin içindeki KDV oranı (konutta net alana ve yere göre %1/%10/%20). */
  kdvOrani: number;
  takas: SatisTakasi[];
  /** Daireye özel ek işler (parke, ankastre…): bedele eklenir. Şema 23. */
  ekIstekler: SatisEkIstegi[];
  plan: SatisPlanSatiri[];
  teslimTarihi: Tarih | null;
  /** Anahtar teslim edildiği gün. */
  teslimEdildi: Tarih | null;
  tapuTarihi: Tarih | null;
  maddeler: SatisMaddesi[];
  durum: 'rezerve' | 'sozlesmeli' | 'iade_edildi';
  /** İmzalıda her değişiklikte bir artar. */
  sozlesmeSurumu: number;
  not: string;
  /** Dövizli satış: kararlaştırılan dövizli fiyat (KDV dahil) ve protokol kuru; TL fiyat = döviz × kur. TL satışta null. */
  doviz: DovizBilgisi | null;
}

/**
 * Banka kredisi (şema 23): kullanım tahsilatı (amac 'krediKullanim') hesaba girer; taksitler plandır, ödenince anapara
 * ödemesi (amac 'krediAnapara', bankaya borcu düşer) ve faizi finansman gideri olarak yazılır.
 */
export interface Kredi extends FirmaKaydi {
  ad: string;
  /** Krediyi veren banka (cari); seçilirse kredi borcu onun ekstresinde görünür. */
  bankaCariId: string | null;
  /** Paranın girdiği ve taksitlerin ödendiği hesap. */
  hesapId: string;
  /** Proje kredisi; faiz gideri bu projeye yazılır. Null = firma geneli. */
  projeId: string | null;
  kullanimTarihi: Tarih;
  anapara: Kurus;
  /** Bilgi için (aylık %, sözleşmedeki). */
  faizOrani: number | null;
  taksitler: KrediTaksiti[];
  aciklama: string;
}

export interface KrediTaksiti {
  id: string;
  vadeTarihi: Tarih;
  anapara: Kurus;
  /** Faiz + BSMV/KKDF gibi masraflar (gider olur). */
  faiz: Kurus;
}

export type Hava = 'gunesli' | 'parcali' | 'bulutlu' | 'yagmurlu' | 'karli' | 'ruzgarli' | 'sisli';

/**
 * Şantiye günlüğü (şema 23): proje başına günde bir kayıt. Hava, yapılan işler, ekipler (taşeron/usta kişi sayısı),
 * yevmiyeli işçi puantajı, sorunlar. Mali kayıt değildir; puantaj yevmiyeleri ayrıca gider olarak yazılır.
 */
export interface SantiyeGunlugu extends FirmaKaydi {
  projeId: string;
  tarih: Tarih;
  hava: Hava | null;
  /** °C */
  sicaklik: number | null;
  /** Hava yüzünden çalışılmadı. */
  calisilmadi: boolean;
  yapilanIsler: string;
  ekipler: GunlukEkibi[];
  puantaj: PuantajSatiri[];
  sorunlar: string;
  /** Ziyaretçi, denetim, teslimat notları. */
  not: string;
}

export interface GunlukEkibi {
  id: string;
  /** Taşeron/usta carisi; yoksa yalnız ad. */
  cariId: string | null;
  ad: string;
  kisi: number;
  is: string;
}

export type PuantajDurumu = 'tam' | 'yarim' | 'yok';

/** Yevmiyeli işçinin o günkü çalışması. Tutar = yevmiye × (tam 1, yarım 0,5) + mesai saati × saat ücreti. */
export interface PuantajSatiri {
  id: string;
  cariId: string;
  durum: PuantajDurumu;
  yevmiye: Kurus;
  mesaiSaat: number;
  /** Saatlik mesai ücreti; yoksa yevmiye / 8 × 1,5. */
  mesaiUcreti: Kurus | null;
  /** Yevmiyesi yazıldığı gider (iptal edilmişse yazılmamış sayılır). */
  giderId: string | null;
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
  kalemIlerlemesi: KalemIlerlemesi;
  projeFotografi: ProjeFotografi;
  fiyatKalemi: FiyatKalemi;
  maliyetHesabi: MaliyetHesabi;
  kredi: Kredi;
  santiyeGunlugu: SantiyeGunlugu;

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
  belgeHavuzu: HavuzBelgesi;

  ustaTipi: UstaTipi;
  ustaSozlesmesi: UstaSozlesmesi;
  sozlesmeDegisikligi: SozlesmeDegisikligi;
  hakedis: Hakedis;
  odemePlani: OdemePlani;
  katKarsiligiSozlesme: KatKarsiligiSozlesme;
  arsaSahibiTahsisi: ArsaSahibiTahsisi;
  sgkKaydi: SgkKaydi;
  teminatIadesi: TeminatIadesi;
  satis: Satis;
  taksit: Taksit;
  arsaSahibiOdemesi: ArsaSahibiOdemesi;
  ilaveImalat: IlaveImalat;
  alacak: Alacak;
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
