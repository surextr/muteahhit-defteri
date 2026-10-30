import { HAZIR_FIYAT_KALEMLERI } from './hazirFiyatKalemleri';

// Maliyet hesabında bina bilgilerinden miktar çıkaran hazır formüller. Katsayılar Türkiye'de betonarme konut için yaklaşık
// ortalamalardır; her hesapta değiştirilebilir, satır çıkarılabilir. Miktar = taban × katsayı; taban bir bina değeri
// (hesap/maliyet.ts `TABANLAR`) ya da önceki bir formülün sonucu ("f:kod"); birden çok taban toplanır.
// `kod` değişmez (kayıtlı hesaplar koda bakar); sıra önemlidir: bir formül yalnız kendinden önceki formüle dayanabilir.

export interface MaliyetFormulu {
  kod: string;
  /** Fiyat listesindeki kalemin sistem kodu (veri/sabit/hazirFiyatKalemleri.ts). */
  fiyatKalemiKodu: string;
  /** Satır adı listedekinden farklı olacaksa. */
  ad?: string;
  katsayi: number;
  /** "m³/m²", "adet/daire"… (dayanak metninde). */
  katsayiBirimi: string;
  taban: string[];
  /** Katsayının ne anlattığı (ekranda yardım). */
  not?: string;
}

const f = (kod: string, fiyatKalemiKodu: string, taban: string | string[], katsayi: number, katsayiBirimi: string, ek: Partial<MaliyetFormulu> = {}): MaliyetFormulu => ({
  kod,
  fiyatKalemiKodu,
  taban: Array.isArray(taban) ? taban : [taban],
  katsayi,
  katsayiBirimi,
  ...ek,
});

export const MALIYET_FORMULLERI: MaliyetFormulu[] = [
  // Hafriyat
  f('kazi', 'i_hafriyatci_1', 'hafriyat', 1, 'm³/m³', { not: 'Kazı hacmi = taban alanı × (bodrum katlar × kat yüksekliği + 1 m temel)' }),
  f('hafriyat_kamyon', 'k_kamyon', 'f:kazi', 0.085, 'sefer/m³', { not: 'Kabarma ile ~%25 artar, kamyon başına ~15 m³' }),
  f('dokum_sahasi', 'k_dokum_sahasi', 'f:kazi', 0.085, 'sefer/m³'),
  f('ekskavator', 'k_ekskavator', 'f:kazi', 0.02, 'saat/m³', { not: 'Saatte ~50 m³ kazı' }),
  // Kaba yapı
  f('grobeton', 'm_grobeton', 'taban', 0.1, 'm³/m²', { not: '10 cm grobeton' }),
  f('beton', 'm_beton_c30', 'insaat', 0.4, 'm³/m²', { ad: 'Hazır beton (betonarme)', not: 'İnşaat alanı başına betonarme betonu' }),
  f('beton_pompa', 'm_beton_pompa', 'f:beton', 1, 'm³/m³'),
  f('demir', 'm_demir_12', 'f:beton', 0.11, 'ton/m³', { ad: 'Nervürlü demir (bütün çaplar)', not: 'Beton m³ başına donatı; fiyat Ø12 kaleminden' }),
  f('bag_teli', 'm_bag_teli', 'f:demir', 8, 'kg/ton'),
  f('kalip_iscilik', 'i_kalipci_1', 'insaat', 1, 'm²/m²', { not: 'Kalıp ve demir işçiliği kat alanı üzerinden' }),
  f('temel_kalip', 'i_kalipci_2', 'taban', 1, 'm²/m²'),
  f('plywood', 'm_plywood', 'insaat', 0.35, 'm²/m²', { not: 'Kalıp malzemesi birkaç kez kullanılır' }),
  f('kereste', 'm_kereste', 'insaat', 0.012, 'm³/m²'),
  // Yalıtım
  f('temel_yalitim', 'i_su_yalitimci_1', 'temelYalitim', 1, 'm²/m²', { not: 'Taban + bodrum perde alanı' }),
  f('bitum_membran', 'm_bitum_membran', 'f:temel_yalitim', 2.2, 'm²/m²', { not: 'Çift kat + bindirme' }),
  f('islak_yalitim', 'i_su_yalitimci_3', 'islakHacim', 10, 'm²/ıslak hacim'),
  f('islak_yalitim_malz', 'm_cimento_esasli_yalitim', 'f:islak_yalitim', 3, 'kg/m²'),
  // Duvar
  f('duvar', 'i_duvarci_1', 'insaat', 0.9, 'm²/m²', { not: 'İnşaat alanı başına duvar alanı' }),
  f('tugla', 'm_tugla_135', 'f:duvar', 25, 'adet/m²'),
  f('lento', 'i_duvarci_2', 'daire', 12, 'metre/daire'),
  // Sıva, alçı, boya
  f('ic_siva', 'i_sivaci_1', 'insaat', 2.5, 'm²/m²', { not: 'Duvar iki yüzü ve tavan' }),
  f('makine_sivasi', 'm_makine_sivasi', 'f:ic_siva', 0.7, 'torba/m²', { not: '~1,5 cm, 25 kg torba' }),
  f('saten_alci', 'i_alcici_2', 'f:ic_siva', 1, 'm²/m²'),
  f('saten_alci_malz', 'm_saten_alci', 'f:saten_alci', 0.06, 'torba/m²'),
  f('ic_boya', 'i_boyaci_1', 'f:ic_siva', 1, 'm²/m²'),
  f('ic_boya_malz', 'm_ic_boya', 'f:ic_boya', 0.25, 'litre/m²', { not: 'Astar hariç 2 kat' }),
  f('mantolama', 'i_mantolamaci_1', 'cephe', 0.85, 'm²/m²', { not: 'Cephe alanından boşluklar düşülmüş' }),
  f('mantolama_levha', 'm_eps_mantolama', 'f:mantolama', 1.05, 'm²/m²'),
  f('mantolama_harci', 'm_mantolama_yapistirici', 'f:mantolama', 0.4, 'torba/m²'),
  f('dis_boya', 'i_boyaci_2', 'f:mantolama', 1, 'm²/m²'),
  f('dis_boya_malz', 'm_dis_boya', 'f:dis_boya', 0.3, 'litre/m²'),
  f('iskele', 'i_iskeleci_1', 'cephe', 1, 'm²/m²'),
  // Şap ve kaplama
  f('sap', 'i_sapci_1', 'insaat', 0.85, 'm²/m²', { not: 'Net döşeme alanı' }),
  f('sap_harci', 'm_sap_harci', 'f:sap', 0.05, 'm³/m²', { not: '5 cm şap' }),
  f('yer_seramigi', 'm_yer_seramigi', 'f:sap', 1, 'm²/m²', { not: 'Bütün döşeme seramik; parke varsa azaltın' }),
  f('yer_seramigi_isc', 'i_seramikci_1', 'f:yer_seramigi', 1, 'm²/m²'),
  f('fayans', 'm_duvar_fayansi', 'islakHacim', 18, 'm²/ıslak hacim'),
  f('fayans_isc', 'i_seramikci_2', 'f:fayans', 1, 'm²/m²'),
  f('seramik_yapistirici', 'm_seramik_yapistirici', ['f:yer_seramigi', 'f:fayans'], 0.2, 'torba/m²'),
  // Çatı
  f('cati', 'i_catici_1', 'taban', 1.15, 'm²/m²', { not: 'Eğim ve saçak payı' }),
  f('kiremit', 'm_kiremit', 'f:cati', 1, 'm²/m²'),
  f('cati_membran', 'm_cati_membran', 'f:cati', 1.1, 'm²/m²'),
  // Doğrama ve kapı
  f('pencere', 'm_pvc_pencere', 'cephe', 0.15, 'm²/m²', { not: 'Cephenin pencere oranı' }),
  f('pencere_isc', 'i_dogramaci_1', 'f:pencere', 1, 'm²/m²'),
  f('celik_kapi', 'm_celik_kapi', 'daire', 1, 'adet/daire'),
  f('ic_kapi', 'm_ic_kapi', 'daire', 4, 'adet/daire'),
  f('ic_kapi_isc', 'i_marangoz_1', 'f:ic_kapi', 1, 'adet/adet'),
  f('mutfak_dolabi', 'm_mutfak_dolabi', 'daire', 6, 'metre/daire', { not: 'Alt + üst dolap' }),
  // Tesisat
  f('elektrik_isc', 'i_elektrikci_1', 'daire', 1, 'daire/daire'),
  f('daire_panosu', 'm_daire_panosu', 'daire', 1, 'adet/daire'),
  f('su_isc', 'i_sucu_1', 'daire', 1, 'daire/daire'),
  f('klozet', 'm_klozet', 'islakHacim', 1, 'adet/ıslak hacim'),
  f('lavabo', 'm_lavabo', 'islakHacim', 1, 'adet/ıslak hacim'),
  f('batarya', 'm_batarya', 'islakHacim', 2, 'adet/ıslak hacim'),
  f('vitrifiye_isc', 'i_sucu_4', 'islakHacim', 3, 'adet/ıslak hacim'),
  f('kombi', 'm_kombi', 'daire', 1, 'adet/daire'),
  f('radyator', 'm_radyator', 'insaat', 0.04, 'metre/m²', { not: '~25 m² başına 1 m panel radyatör' }),
  f('dogalgaz_isc', 'i_dogalgazci_1', 'daire', 1, 'daire/daire'),
  f('asansor', 'm_asansor', 'asansor', 1, 'adet', { not: '4 ve üstü katlı binada 1 asansör' }),
  // Şantiye
  f('kule_vinc', 'k_kule_vinc', 'sure', 0.5, 'ay/ay', { not: 'Kaba inşaat süresince' }),
  f('santiye_elektrik', 'm_santiye_elektrik', 'sure', 1, 'ay/ay'),
  f('santiye_su', 'm_santiye_suyu', 'sure', 1, 'ay/ay'),
  f('konteyner', 'm_konteyner', 'sure', 1, 'ay/ay'),
  f('bekci', 'm_bekci', 'sure', 1, 'ay/ay'),
];

const KALEM_ADI = new Map(HAZIR_FIYAT_KALEMLERI.map((k) => [k.kod, k.ad]));
/** Formülün ekranda adı: kendi adı ya da fiyat listesindeki kalemin adı. */
export const formulAdi = (f: MaliyetFormulu) => f.ad ?? KALEM_ADI.get(f.fiyatKalemiKodu) ?? f.kod;
