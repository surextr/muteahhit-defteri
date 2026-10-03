import type { HakedisSekli, OrtakMadde, SorumlulukCevabi } from '../tipler';

// Hazır usta tipleri (Proje Planı, usta tablosu) ve bütün sözleşmelerde ortak maddeler.
// Firma bunları Ayarlar'dan kendi yöresine göre değiştirir; buradaki hâl yalnızca ilk eklemede kullanılır.
// `kod` değişmez (ileride hazır şablon güncellemesi bununla eşleşir). Bütçe kalemi kalem sistem koduyla verilir.

export const HAKEDIS_SEKLI_ADI: Record<HakedisSekli, string> = {
  beton_dokumu: 'Beton döküldükçe',
  kat: 'Kat bazında',
  yuzde: 'Yüzde ilerleme',
  is_bitimi: 'İş bitimi',
  asamali: 'Aşamalı',
  haftalik_aylik: 'Haftalık / aylık',
};

export const SORUMLULUK_ADI: Record<SorumlulukCevabi, string> = {
  muteahhit: 'Müteahhit',
  usta: 'Usta',
  sozlesmede: 'Sözleşmede yazılacak',
};

/** Bütün usta sözleşmelerinde sorulan maddeler; her tipte hangilerinin geçerli olduğu işaretlenir. */
export const HAZIR_ORTAK_MADDELER: OrtakMadde[] = [
  { id: 'olcum', metin: 'Ölçüm yöntemi ve metrajı kimin onaylayacağı' },
  { id: 'bosluk', metin: 'Boşluk, açıklık ve tekrar işlerin nasıl ölçüleceği' },
  { id: 'malzeme', metin: 'Malzeme, taşıma, iskele ve ekipman sorumluluğu' },
  { id: 'baslama', metin: 'İşe başlama şartları ve teslim kriterleri' },
  { id: 'ilave', metin: 'İlave işin fiyatlandırılması ve onayı' },
  { id: 'ayip', metin: 'Ayıplı işin düzeltme sorumluluğu' },
  { id: 'kesinti', metin: 'Hakedişten kesintiler ve avans mahsupları' },
];

export interface HazirUstaTipi {
  kod: string;
  ad: string;
  fiyatlamaBirimi: string;
  butceKalemiKodu: string | null;
  hakedisSekli: HakedisSekli;
  /** Satır başına bütçe kalemi; yoksa tipin varsayılanı. */
  kalemler: { ad: string; birim: string; aciklama?: string; butceKalemiKodu?: string }[];
  sorular: { soru: string; varsayilan: SorumlulukCevabi | null }[];
  ozelSartlar: string[];
  /** Bu tipte geçerli olmayan ortak maddeler. */
  kapaliOrtakMaddeler?: string[];
}

const malzemeSorusu = { soru: 'Malzeme kimde (malzemeli / malzemesiz)?', varsayilan: null };
const iskeleSorusu = { soru: 'İskele kimde?', varsayilan: null };

export const HAZIR_USTA_TIPLERI: HazirUstaTipi[] = [
  // ─── Planın 11 tipi ───
  {
    kod: 'kalipci',
    ad: 'Kalıpçı (demir işçiliği dahil)',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'kalip_isciligi',
    hakedisSekli: 'beton_dokumu',
    kalemler: [
      { ad: 'Kalıp ve demir işçiliği (kat alanı)', birim: 'm²', aciklama: 'Ölçüm: kalıp açılımı ya da kat alanı' },
      { ad: 'Temel', birim: 'm²' },
      { ad: 'Bodrum perde', birim: 'm²' },
      { ad: 'Merdiven', birim: 'm²' },
      { ad: 'Asansör kuyusu', birim: 'm²' },
      { ad: 'Saçak / konsol', birim: 'metre' },
    ],
    sorular: [
      { soru: 'Çivi, tel ve kalıp malzemesi kimde?', varsayilan: 'muteahhit' },
      iskeleSorusu,
      { soru: 'Demir kesim ve bükme kimde?', varsayilan: 'usta' },
    ],
    ozelSartlar: ['Hakediş her beton dökümünden sonra ölçülen alana göre ödenir.', 'Kalıp sökümü ve malzemenin istiflenmesi ustaya aittir.'],
  },
  {
    kod: 'duvarci',
    ad: 'Duvarcı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'duvar',
    hakedisSekli: 'kat',
    kalemler: [
      { ad: 'Duvar örme', birim: 'm²', aciklama: 'Malzeme cinsi ve kalınlığa göre ayrı fiyat' },
      { ad: 'Lento', birim: 'metre' },
      { ad: 'Hatıl', birim: 'metre' },
      { ad: 'Baca', birim: 'metre' },
    ],
    sorular: [{ soru: 'Malzemenin kata taşınması kimde?', varsayilan: null }, iskeleSorusu],
    ozelSartlar: [],
  },
  {
    kod: 'sivaci',
    ad: 'Sıvacı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'siva',
    hakedisSekli: 'kat',
    kalemler: [
      { ad: 'İç sıva', birim: 'm²', aciklama: 'Makine ya da el sıvası' },
      { ad: 'Dış sıva', birim: 'm²' },
    ],
    sorular: [{ soru: 'Köşe profili ve file kimde?', varsayilan: null }, iskeleSorusu],
    ozelSartlar: [],
  },
  {
    kod: 'alcici',
    ad: 'Alçıcı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'alci',
    hakedisSekli: 'kat',
    kalemler: [
      { ad: 'Kara alçı', birim: 'm²' },
      { ad: 'Saten alçı', birim: 'm²' },
      { ad: 'Asma tavan', birim: 'm²' },
      { ad: 'Kartonpiyer', birim: 'metre' },
    ],
    sorular: [malzemeSorusu],
    ozelSartlar: [],
  },
  {
    kod: 'elektrikci',
    ad: 'Elektrikçi',
    fiyatlamaBirimi: 'daire',
    butceKalemiKodu: 'elektrik',
    hakedisSekli: 'asamali',
    kalemler: [
      { ad: 'Daire tesisatı (götürü)', birim: 'daire', aciklama: 'Ya da nokta başı fiyat' },
      { ad: 'Nokta', birim: 'adet' },
      { ad: 'Zayıf akım', birim: 'daire' },
      { ad: 'Pano', birim: 'adet' },
      { ad: 'Topraklama', birim: 'götürü' },
      { ad: 'Ortak alan aydınlatma', birim: 'götürü' },
      { ad: 'Sayaç işlemleri', birim: 'adet' },
    ],
    sorular: [{ soru: 'Malzemeli mi, malzemesiz mi?', varsayilan: null }],
    ozelSartlar: [],
  },
  {
    kod: 'sucu',
    ad: 'Sucu (sıhhi tesisat)',
    fiyatlamaBirimi: 'daire',
    butceKalemiKodu: 'sihhi_tesisat',
    hakedisSekli: 'asamali',
    kalemler: [
      { ad: 'Daire tesisatı (götürü)', birim: 'daire', aciklama: 'Ya da nokta başı fiyat' },
      { ad: 'Nokta', birim: 'adet' },
      { ad: 'Kalorifer / yerden ısıtma', birim: 'daire' },
      { ad: 'Vitrifiye montajı', birim: 'adet' },
      { ad: 'Yağmur iniş borusu', birim: 'metre' },
      { ad: 'Basınç testi', birim: 'daire' },
    ],
    sorular: [{ soru: 'Malzemeli mi, malzemesiz mi?', varsayilan: null }],
    ozelSartlar: [],
  },
  {
    kod: 'boyaci',
    ad: 'Boyacı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'boya',
    hakedisSekli: 'kat',
    kalemler: [
      { ad: 'İç boya (astar + 2 kat)', birim: 'm²' },
      { ad: 'Dış boya', birim: 'm²' },
      { ad: 'Ahşap / demir boyası', birim: 'm²' },
      { ad: 'Rötuş', birim: 'götürü' },
    ],
    sorular: [malzemeSorusu, iskeleSorusu],
    ozelSartlar: [],
  },
  {
    kod: 'mermerci',
    ad: 'Mermerci',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'mermer',
    hakedisSekli: 'kat',
    kalemler: [
      { ad: 'Döşeme', birim: 'm²' },
      { ad: 'Basamak', birim: 'metre' },
      { ad: 'Denizlik', birim: 'metre' },
      { ad: 'Süpürgelik', birim: 'metre' },
      { ad: 'Cila', birim: 'm²' },
    ],
    sorular: [malzemeSorusu],
    ozelSartlar: [],
  },
  {
    kod: 'asansorcu',
    ad: 'Asansörcü',
    fiyatlamaBirimi: 'götürü',
    butceKalemiKodu: 'asansor',
    hakedisSekli: 'asamali',
    kalemler: [{ ad: 'Asansör (götürü)', birim: 'adet', aciklama: 'Durak sayısı, kapasite, marka' }],
    sorular: [
      { soru: 'Ruhsat işlemleri kimde?', varsayilan: 'usta' },
      { soru: 'Garanti ve bakım süresi sözleşmede yazılacak mı?', varsayilan: 'sozlesmede' },
    ],
    ozelSartlar: ['Ödeme aşamaları: sipariş, montaj, ruhsat.'],
    kapaliOrtakMaddeler: ['bosluk'],
  },
  {
    kod: 'catici',
    ad: 'Çatıcı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'cati_isciligi_ve_malzemesi',
    hakedisSekli: 'asamali',
    kalemler: [
      { ad: 'Çatı (ahşap / çelik)', birim: 'm²' },
      { ad: 'Kiremit / panel', birim: 'm²' },
      { ad: 'Yalıtım', birim: 'm²' },
      { ad: 'Oluk ve dere', birim: 'metre' },
    ],
    sorular: [malzemeSorusu],
    ozelSartlar: [],
  },
  {
    kod: 'sapci',
    ad: 'Şapçı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'sap',
    hakedisSekli: 'kat',
    kalemler: [
      { ad: 'Şap (makine)', birim: 'm²', aciklama: 'Kalınlık (cm) sözleşmede yazılır' },
      { ad: 'Yerden ısıtma şapı', birim: 'm²' },
    ],
    sorular: [malzemeSorusu],
    ozelSartlar: [],
  },
  // ─── Ek 10 tip ───
  {
    kod: 'hafriyatci',
    ad: 'Hafriyatçı',
    fiyatlamaBirimi: 'm³',
    butceKalemiKodu: 'hafriyat',
    hakedisSekli: 'is_bitimi',
    kalemler: [
      { ad: 'Kazı', birim: 'm³' },
      { ad: 'Döküm sahasına nakliye', birim: 'sefer' },
      { ad: 'Kırıcı (kaya)', birim: 'saat' },
      { ad: 'Dolgu ve sıkıştırma', birim: 'm³' },
    ],
    sorular: [{ soru: 'Döküm sahası ücreti kimde?', varsayilan: null }],
    ozelSartlar: [],
    kapaliOrtakMaddeler: ['bosluk'],
  },
  {
    kod: 'iskeleci',
    ad: 'İskeleci',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'iskele',
    hakedisSekli: 'haftalik_aylik',
    kalemler: [
      { ad: 'İskele kurulum ve söküm', birim: 'm²' },
      { ad: 'Aylık kira', birim: 'm²·ay' },
    ],
    sorular: [{ soru: 'İskele güvenlik ağı ve file kimde?', varsayilan: null }],
    ozelSartlar: ['İskele iş güvenliği mevzuatına uygun kurulur ve belgelendirilir.'],
    kapaliOrtakMaddeler: ['bosluk'],
  },
  {
    kod: 'su_yalitimci',
    ad: 'Su yalıtımcı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'temel_yalitimi',
    hakedisSekli: 'is_bitimi',
    kalemler: [
      { ad: 'Temel / perde yalıtımı', birim: 'm²', butceKalemiKodu: 'temel_yalitimi' },
      { ad: 'Teras / balkon yalıtımı', birim: 'm²', butceKalemiKodu: 'cati_teras_yalitimi' },
      { ad: 'Islak hacim yalıtımı', birim: 'm²', butceKalemiKodu: 'islak_hacim_yalitimi' },
    ],
    sorular: [malzemeSorusu, { soru: 'Su testi ve garanti süresi sözleşmede yazılacak mı?', varsayilan: 'sozlesmede' }],
    ozelSartlar: [],
  },
  {
    kod: 'mantolamaci',
    ad: 'Mantolamacı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'mantolama',
    hakedisSekli: 'yuzde',
    kalemler: [
      { ad: 'Mantolama', birim: 'm²', aciklama: 'Levha cinsi ve kalınlığı sözleşmede yazılır' },
      { ad: 'Söve / denizlik çevresi', birim: 'metre' },
      { ad: 'Dekoratif kaplama', birim: 'm²' },
    ],
    sorular: [malzemeSorusu, iskeleSorusu],
    ozelSartlar: [],
  },
  {
    kod: 'seramikci',
    ad: 'Seramikçi / fayansçı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'seramik_ve_fayans',
    hakedisSekli: 'kat',
    kalemler: [
      { ad: 'Yer seramiği', birim: 'm²' },
      { ad: 'Duvar fayansı', birim: 'm²' },
      { ad: 'Süpürgelik', birim: 'metre' },
      { ad: 'Derz', birim: 'm²' },
    ],
    sorular: [{ soru: 'Yapıştırıcı ve derz malzemesi kimde?', varsayilan: null }],
    ozelSartlar: [],
  },
  {
    kod: 'dogramaci',
    ad: 'PVC / alüminyum doğramacı',
    fiyatlamaBirimi: 'm²',
    butceKalemiKodu: 'dograma_pvc_aluminyum',
    hakedisSekli: 'asamali',
    kalemler: [
      { ad: 'Pencere / kapı doğrama', birim: 'm²', aciklama: 'Profil serisi ve cam tipi sözleşmede yazılır' },
      { ad: 'Panjur', birim: 'm²' },
      { ad: 'Sineklik', birim: 'adet' },
    ],
    sorular: [{ soru: 'Montaj ve silikon kimde?', varsayilan: 'usta' }],
    ozelSartlar: ['Ölçü yerinde alınır; ödeme aşamaları: sipariş, montaj.'],
    kapaliOrtakMaddeler: ['bosluk'],
  },
  {
    kod: 'marangoz',
    ad: 'Marangoz (kapı)',
    fiyatlamaBirimi: 'adet',
    butceKalemiKodu: 'kapi',
    hakedisSekli: 'asamali',
    kalemler: [
      { ad: 'İç kapı', birim: 'adet' },
      { ad: 'Daire giriş (çelik) kapı', birim: 'adet' },
      { ad: 'Kasa ve pervaz', birim: 'adet' },
    ],
    sorular: [{ soru: 'Kilit ve kapı kolu kimde?', varsayilan: null }],
    ozelSartlar: [],
    kapaliOrtakMaddeler: ['bosluk'],
  },
  {
    kod: 'demir_dograma',
    ad: 'Demir doğrama (korkuluk)',
    fiyatlamaBirimi: 'metre',
    butceKalemiKodu: 'demir_dograma_ve_korkuluk',
    hakedisSekli: 'is_bitimi',
    kalemler: [
      { ad: 'Balkon / merdiven korkuluğu', birim: 'metre' },
      { ad: 'Demir kapı', birim: 'adet' },
    ],
    sorular: [{ soru: 'Boya (antipas + son kat) kimde?', varsayilan: null }],
    ozelSartlar: [],
    kapaliOrtakMaddeler: ['bosluk'],
  },
  {
    kod: 'dogalgazci',
    ad: 'Doğalgazcı',
    fiyatlamaBirimi: 'daire',
    butceKalemiKodu: 'isitma_ve_dogalgaz',
    hakedisSekli: 'asamali',
    kalemler: [
      { ad: 'Daire iç tesisatı', birim: 'daire' },
      { ad: 'Kombi montajı', birim: 'adet' },
      { ad: 'Kolon hattı', birim: 'götürü' },
    ],
    sorular: [
      { soru: 'Proje onayı ve gaz açma işlemleri kimde?', varsayilan: 'usta' },
      { soru: 'Malzemeli mi, malzemesiz mi?', varsayilan: null },
    ],
    ozelSartlar: [],
    kapaliOrtakMaddeler: ['bosluk'],
  },
  {
    kod: 'dolapci',
    ad: 'Mutfak / banyo dolapçısı',
    fiyatlamaBirimi: 'metre',
    butceKalemiKodu: 'mutfak_ve_banyo_dolaplari',
    hakedisSekli: 'asamali',
    kalemler: [
      { ad: 'Mutfak alt dolap', birim: 'metre' },
      { ad: 'Mutfak üst dolap', birim: 'metre' },
      { ad: 'Tezgâh', birim: 'metre' },
      { ad: 'Banyo dolabı', birim: 'adet' },
    ],
    sorular: [{ soru: 'Tezgâh ve aksesuar kimde?', varsayilan: null }],
    ozelSartlar: ['Ödeme aşamaları: sipariş, montaj.'],
    kapaliOrtakMaddeler: ['bosluk'],
  },
];
