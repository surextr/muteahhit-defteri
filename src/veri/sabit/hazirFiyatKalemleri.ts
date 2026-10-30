import { HAZIR_USTA_TIPLERI } from './hazirUstaTipleri';

// Maliyet hesabı için hazır malzeme, işçilik ve makine listesi (konut inşaatı). Firma ilk açılışta bir kez ekler; sonra
// ad, birim, fiyat serbestçe değişir, istenmeyen iptal edilir. `kod` değişmez (kimlik bundan üretilir: iki cihazda ayrı
// eklense de tek kayıt olur). İşçilik usta tiplerinin kalemleridir (sözleşme fiyatıyla eşleşsin diye aynı ad ve birim).

export type FiyatKalemiTuru = 'malzeme' | 'iscilik' | 'makine';

export interface HazirFiyatKalemi {
  kod: string;
  tur: FiyatKalemiTuru;
  ad: string;
  birim: string;
  /** Bütçe kalemi sistem kodu (hazirKalemKodlari). */
  butceKalemiKodu: string;
  aciklama?: string;
  /** İşçilikte usta tipinin kodu (son sözleşme fiyatı için). */
  ustaTipiKodu?: string;
}

type Satir = [kod: string, ad: string, birim: string, aciklama?: string];
const grup = (tur: FiyatKalemiTuru, butceKalemiKodu: string, satirlar: Satir[]): HazirFiyatKalemi[] =>
  satirlar.map(([kod, ad, birim, aciklama]) => ({ kod, tur, ad, birim, butceKalemiKodu, ...(aciklama ? { aciklama } : {}) }));

const MALZEME: HazirFiyatKalemi[] = [
  ...grup('malzeme', 'hafriyat', [
    ['m_dolgu_malzemesi', 'Dolgu malzemesi (stabilize / mıcır)', 'm³'],
    ['m_grobeton', 'Grobeton (C16)', 'm³'],
  ]),
  ...grup('malzeme', 'beton', [
    ['m_beton_c25', 'Hazır beton C25/30', 'm³'],
    ['m_beton_c30', 'Hazır beton C30/37', 'm³'],
    ['m_beton_c35', 'Hazır beton C35/45', 'm³'],
    ['m_beton_pompa', 'Beton pompası', 'm³', 'Pompa ücreti beton m³ başına ya da sefer'],
    ['m_beton_katki', 'Beton katkısı / su yalıtım katkısı', 'm³'],
  ]),
  ...grup('malzeme', 'demir', [
    ['m_demir_8', 'Nervürlü demir Ø8', 'ton'],
    ['m_demir_10', 'Nervürlü demir Ø10', 'ton'],
    ['m_demir_12', 'Nervürlü demir Ø12', 'ton'],
    ['m_demir_14', 'Nervürlü demir Ø14', 'ton'],
    ['m_demir_16', 'Nervürlü demir Ø16', 'ton'],
    ['m_demir_18', 'Nervürlü demir Ø18', 'ton'],
    ['m_demir_20', 'Nervürlü demir Ø20', 'ton'],
    ['m_demir_22', 'Nervürlü demir Ø22 ve üstü', 'ton'],
    ['m_hasir_celik', 'Hasır çelik', 'ton'],
    ['m_bag_teli', 'Bağ teli', 'kg'],
    ['m_paspayi', 'Paspayı (beton / plastik)', 'adet'],
  ]),
  ...grup('malzeme', 'kalip_isciligi', [
    ['m_plywood', 'Plywood / film kaplı kontrplak', 'm²'],
    ['m_kereste', 'Kereste (kalas, lata)', 'm³'],
    ['m_civi', 'Çivi', 'kg'],
    ['m_kalip_yagi', 'Kalıp yağı', 'litre'],
    ['m_dikme', 'Çelik dikme (kira)', 'adet·ay'],
    ['m_asmolen', 'Asmolen bloğu (EPS / bims)', 'adet'],
  ]),
  ...grup('malzeme', 'duvar', [
    ['m_tugla_135', 'Yatay delikli tuğla 13,5 cm', 'adet'],
    ['m_tugla_85', 'Yatay delikli tuğla 8,5 cm', 'adet'],
    ['m_gazbeton_20', 'Gazbeton 20 cm', 'm³'],
    ['m_gazbeton_10', 'Gazbeton 10 cm', 'm³'],
    ['m_bims', 'Bims blok', 'adet'],
    ['m_gazbeton_harci', 'Gazbeton yapıştırma harcı', 'torba'],
    ['m_cimento', 'Çimento (CEM I 42,5)', 'ton'],
    ['m_kum', 'Kum', 'm³'],
    ['m_kirec', 'Kireç', 'torba'],
    ['m_lento', 'Hazır lento', 'metre'],
  ]),
  ...grup('malzeme', 'temel_yalitimi', [
    ['m_bitum_membran', 'Bitümlü su yalıtım membranı', 'm²'],
    ['m_bitum_astar', 'Bitüm astar', 'kg'],
    ['m_drenaj_levhasi', 'Drenaj levhası (koruma)', 'm²'],
    ['m_drenaj_borusu', 'Drenaj borusu', 'metre'],
    ['m_xps_temel', 'XPS ısı yalıtım levhası (temel / perde)', 'm²'],
  ]),
  ...grup('malzeme', 'cati_teras_yalitimi', [
    ['m_teras_membran', 'Teras su yalıtım membranı', 'm²'],
    ['m_likit_membran', 'Likit su yalıtımı (poliüretan)', 'kg'],
  ]),
  ...grup('malzeme', 'islak_hacim_yalitimi', [['m_cimento_esasli_yalitim', 'Çimento esaslı su yalıtımı (ıslak hacim)', 'kg']]),
  ...grup('malzeme', 'cati_isciligi_ve_malzemesi', [
    ['m_cati_kereste', 'Çatı kerestesi', 'm³'],
    ['m_osb', 'OSB levha', 'm²'],
    ['m_cati_membran', 'Çatı altı membranı', 'm²'],
    ['m_kiremit', 'Kiremit', 'm²'],
    ['m_sandvic_panel', 'Sandviç çatı paneli', 'm²'],
    ['m_tasyunu_cati', 'Taşyünü (çatı arası)', 'm²'],
    ['m_oluk', 'Yağmur oluğu ve iniş borusu', 'metre'],
  ]),
  ...grup('malzeme', 'siva', [
    ['m_makine_sivasi', 'Makine sıvası (alçı / çimento esaslı)', 'torba'],
    ['m_dis_siva', 'Dış cephe sıvası', 'torba'],
    ['m_siva_filesi', 'Sıva filesi', 'm²'],
    ['m_kose_profili', 'Köşe profili', 'metre'],
  ]),
  ...grup('malzeme', 'alci', [
    ['m_kara_alci', 'Kara alçı', 'torba'],
    ['m_saten_alci', 'Saten alçı', 'torba'],
    ['m_alcipan', 'Alçıpan levha', 'm²'],
    ['m_asma_tavan_profil', 'Asma tavan profili', 'metre'],
    ['m_kartonpiyer', 'Kartonpiyer', 'metre'],
  ]),
  ...grup('malzeme', 'sap', [
    ['m_sap_harci', 'Şap harcı (hazır / kum-çimento)', 'm³'],
    ['m_sap_eps', 'Şap altı yalıtım levhası', 'm²'],
    ['m_sap_lifi', 'Şap lifi', 'kg'],
  ]),
  ...grup('malzeme', 'seramik_ve_fayans', [
    ['m_yer_seramigi', 'Yer seramiği (granit seramik)', 'm²'],
    ['m_duvar_fayansi', 'Duvar fayansı', 'm²'],
    ['m_balkon_seramigi', 'Balkon / teras seramiği', 'm²'],
    ['m_seramik_yapistirici', 'Seramik yapıştırıcısı', 'torba'],
    ['m_derz_dolgu', 'Derz dolgu', 'kg'],
    ['m_seramik_supurgelik', 'Seramik süpürgelik', 'metre'],
  ]),
  ...grup('malzeme', 'mermer', [
    ['m_merdiven_basamak', 'Merdiven basamağı (mermer / granit)', 'metre'],
    ['m_denizlik', 'Pencere denizliği', 'metre'],
    ['m_mermer_doseme', 'Mermer döşeme (giriş, ortak alan)', 'm²'],
    ['m_mutfak_tezgahi', 'Mutfak tezgahı', 'metre'],
  ]),
  ...grup('malzeme', 'boya', [
    ['m_ic_astar', 'İç cephe astarı', 'litre'],
    ['m_ic_boya', 'İç cephe boyası (silikonlu / plastik)', 'litre'],
    ['m_dis_boya', 'Dış cephe boyası', 'litre'],
    ['m_tavan_boyasi', 'Tavan boyası', 'litre'],
    ['m_yagli_boya', 'Yağlı / sentetik boya (demir, ahşap)', 'litre'],
  ]),
  ...grup('malzeme', 'mantolama', [
    ['m_eps_mantolama', 'Mantolama levhası (EPS / karbonlu)', 'm²'],
    ['m_tasyunu_mantolama', 'Mantolama levhası (taşyünü)', 'm²'],
    ['m_mantolama_yapistirici', 'Mantolama yapıştırma / sıva harcı', 'torba'],
    ['m_dubel', 'Mantolama dübeli', 'adet'],
    ['m_mantolama_filesi', 'Mantolama filesi', 'm²'],
    ['m_dekoratif_siva', 'Dekoratif dış cephe sıvası', 'kg'],
  ]),
  ...grup('malzeme', 'dograma_pvc_aluminyum', [
    ['m_pvc_pencere', 'PVC pencere (ısıcamlı)', 'm²'],
    ['m_aluminyum_dograma', 'Alüminyum doğrama', 'm²'],
    ['m_balkon_kapisi', 'Balkon kapısı (PVC)', 'adet'],
    ['m_panjur', 'Panjur', 'm²'],
    ['m_sineklik', 'Sineklik', 'adet'],
  ]),
  ...grup('malzeme', 'kapi', [
    ['m_celik_kapi', 'Daire giriş çelik kapısı', 'adet'],
    ['m_ic_kapi', 'İç oda kapısı (kasa, pervaz dahil)', 'adet'],
    ['m_bina_giris_kapisi', 'Bina giriş kapısı', 'adet'],
    ['m_yangin_kapisi', 'Yangın kapısı', 'adet'],
  ]),
  ...grup('malzeme', 'demir_dograma_ve_korkuluk', [
    ['m_korkuluk', 'Balkon / merdiven korkuluğu', 'metre'],
    ['m_cam_korkuluk', 'Cam korkuluk', 'metre'],
  ]),
  ...grup('malzeme', 'mutfak_ve_banyo_dolaplari', [
    ['m_mutfak_dolabi', 'Mutfak dolabı', 'metre'],
    ['m_banyo_dolabi', 'Banyo dolabı', 'adet'],
    ['m_vestiyer', 'Vestiyer / gömme dolap', 'metre'],
    ['m_parke', 'Laminat parke', 'm²'],
    ['m_parke_supurgelik', 'Parke süpürgeliği', 'metre'],
  ]),
  ...grup('malzeme', 'elektrik', [
    ['m_kablo_nym', 'Enerji kablosu (NYM 3×2,5 vb.)', 'metre'],
    ['m_kablo_aydinlatma', 'Aydınlatma kablosu (3×1,5)', 'metre'],
    ['m_spiral_boru', 'Spiral boru / kanal', 'metre'],
    ['m_buat', 'Buat ve kasa', 'adet'],
    ['m_priz_anahtar', 'Priz / anahtar (takım)', 'adet'],
    ['m_daire_panosu', 'Daire sigorta panosu (sigortalar dahil)', 'adet'],
    ['m_ana_pano', 'Bina ana panosu', 'adet'],
    ['m_aydinlatma', 'Aydınlatma armatürü', 'adet'],
    ['m_zayif_akim', 'Zayıf akım (TV, data, diafon)', 'daire'],
    ['m_topraklama', 'Topraklama malzemesi', 'götürü'],
  ]),
  ...grup('malzeme', 'sihhi_tesisat', [
    ['m_pprc_boru', 'Temiz su borusu (PPRC / PEX)', 'metre'],
    ['m_pvc_atik', 'Atık su borusu (PVC)', 'metre'],
    ['m_fittings', 'Ek parça (fittings)', 'götürü'],
    ['m_klozet', 'Klozet (gömme rezervuar dahil)', 'adet'],
    ['m_lavabo', 'Lavabo', 'adet'],
    ['m_dus_teknesi', 'Duş teknesi / kabin', 'adet'],
    ['m_batarya', 'Batarya', 'adet'],
    ['m_eviye', 'Mutfak eviyesi', 'adet'],
    ['m_su_deposu', 'Su deposu', 'adet'],
    ['m_hidrofor', 'Hidrofor', 'adet'],
    ['m_su_sayaci', 'Su sayacı', 'adet'],
  ]),
  ...grup('malzeme', 'isitma_ve_dogalgaz', [
    ['m_kombi', 'Kombi', 'adet'],
    ['m_radyator', 'Panel radyatör', 'metre'],
    ['m_yerden_isitma', 'Yerden ısıtma (boru, kolektör)', 'm²'],
    ['m_dogalgaz_tesisati', 'Doğalgaz iç tesisat malzemesi', 'daire'],
    ['m_klima', 'Klima (split)', 'adet'],
  ]),
  ...grup('malzeme', 'asansor', [['m_asansor', 'Asansör (komple)', 'adet', 'Durak sayısı ve kapasiteye göre']]),
  ...grup('malzeme', 'iskele', [['m_iskele_kira', 'Cephe iskelesi kirası', 'm²·ay']]),
  ...grup('malzeme', 'cevre_duzenlemesi', [
    ['m_parke_tasi', 'Kilitli parke taşı', 'm²'],
    ['m_bordur', 'Bordür', 'metre'],
    ['m_bahce_duvari', 'Bahçe duvarı / çit', 'metre'],
    ['m_peyzaj', 'Peyzaj (toprak, bitki)', 'götürü'],
  ]),
  ...grup('malzeme', 'santiye_giderleri', [
    ['m_santiye_elektrik', 'Şantiye elektriği', 'ay'],
    ['m_santiye_suyu', 'Şantiye suyu', 'ay'],
    ['m_konteyner', 'Şantiye konteyneri / WC', 'ay'],
    ['m_santiye_cevre', 'Şantiye çevre perdesi ve tabela', 'götürü'],
    ['m_bekci', 'Bekçi', 'ay'],
  ]),
];

const MAKINE: HazirFiyatKalemi[] = [
  ...grup('makine', 'hafriyat', [
    ['k_ekskavator', 'Ekskavatör', 'saat'],
    ['k_kamyon', 'Hafriyat kamyonu', 'sefer'],
    ['k_kirici', 'Kırıcı', 'saat'],
    ['k_silindir', 'Silindir', 'saat'],
    ['k_dokum_sahasi', 'Hafriyat döküm sahası ücreti', 'sefer'],
  ]),
  ...grup('makine', 'santiye_giderleri', [
    ['k_kule_vinc', 'Kule vinç (kira)', 'ay'],
    ['k_mobil_vinc', 'Mobil vinç', 'saat'],
    ['k_yuk_asansoru', 'Yük asansörü', 'ay'],
    ['k_jenerator', 'Jeneratör', 'ay'],
  ]),
];

/** Usta tiplerinin kalemleri: "Sıvacı · İç sıva". */
const ISCILIK: HazirFiyatKalemi[] = HAZIR_USTA_TIPLERI.flatMap((t) =>
  t.kalemler.map((k, i) => ({
    kod: `i_${t.kod}_${i + 1}`,
    tur: 'iscilik' as const,
    ad: `${t.ad.replace(/\s*\(.*\)$/, '')} · ${k.ad}`,
    birim: k.birim,
    butceKalemiKodu: k.butceKalemiKodu ?? t.butceKalemiKodu ?? 'genel_giderler',
    ...(k.aciklama ? { aciklama: k.aciklama } : {}),
    ustaTipiKodu: t.kod,
  })),
);

export const HAZIR_FIYAT_KALEMLERI: HazirFiyatKalemi[] = [...MALZEME, ...ISCILIK, ...MAKINE];

export const FIYAT_KALEMI_TURU_ADI: Record<FiyatKalemiTuru, string> = { malzeme: 'Malzeme', iscilik: 'İşçilik', makine: 'Makine' };
