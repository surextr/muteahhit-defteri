import type { Yetki } from './yetki';
import type { Kurus, Tarih } from '../veri/tipler';
import { aramaAnahtari } from './metin';

// "Tamamlanacak işler" (saf): kayıtlardaki eksikleri, gecikmeleri ve riskleri tek listede toplar. Her kural bir grup
// verir; grup içindeki her madde ilgili kayda götürür. Hiçbir şey saklanmaz, her açılışta kayıtlardan hesaplanır.
// Ertelenen / gizlenen maddeler cihazda tutulur (anahtar → tarih), burada süzülür.

export type Onem = 'acil' | 'uyari' | 'bilgi';

export const ONEM_ADI: Record<Onem, string> = { acil: 'Acil', uyari: 'Dikkat', bilgi: 'Eksik bilgi' };

export type YapilacakKodu =
  | 'onay_bekleyen'
  | 'kontrol_bekleyen'
  | 'talimat_reddedildi'
  | 'nakit_acigi'
  | 'nakit_tahmini'
  | 'geciken_odeme'
  | 'geciken_tahsilat'
  | 'mukerrer_fatura'
  | 'ilerleme_sapmasi'
  | 'hakedis_onayi'
  | 'imzasiz_sozlesme'
  | 'imzasiz_satis'
  | 'bekleyen_belge'
  | 'puantaj_yazilmamis'
  | 'geciken_teslim'
  | 'eksik_is_gecikti'
  | 'daire_teslimi'
  | 'sabit_gider_girilmedi'
  | 'mutabakat_farkli'
  | 'mutabakat_yanitsiz'
  | 'pahali_alim'
  | 'siparis_onayi'
  | 'satinalma_uyumsuz'
  | 'fatura_bekleyen'
  | 'kalemsiz_gider'
  | 'vadesiz_borc'
  | 'taramasiz_fatura'
  | 'dekontsuz_odeme'
  | 'eksik_maliyet';

export interface YapilacakOge {
  /** Erteleme/gizleme anahtarı: kural + kayıt (aynı sorun her açılışta aynı anahtarı verir). */
  anahtar: string;
  baslik: string;
  ayrinti: string;
  tutar?: Kurus;
  /** Ekran yolu (#/ olmadan). */
  yol: string;
}

export interface YapilacakGrubu {
  kod: YapilacakKodu;
  onem: Onem;
  /** "3 giderin maliyet kalemi seçilmemiş" */
  baslik: string;
  /** Neden önemli, ne yapılmalı. */
  aciklama: string;
  /** Maddedeki düğme: "Düzelt", "İncele"… */
  eylem: string;
  ogeler: YapilacakOge[];
}

interface KuralTanimi {
  onem: Onem;
  eylem: string;
  /** Biri yeterli. */
  yetkiler: Yetki[];
  baslik: (n: number) => string;
  aciklama: string;
}

export const KURALLAR: Record<YapilacakKodu, KuralTanimi> = {
  onay_bekleyen: {
    onem: 'acil',
    eylem: 'Onayla',
    yetkiler: [],
    baslik: (n) => `${n} ödeme ya da hakediş onayınızı bekliyor`,
    aciklama: 'Onay akışında eşik üstü ödeme talimatları ve hakedişler. Onaylanan ödeme o anda yapılır.',
  },
  kontrol_bekleyen: {
    onem: 'uyari',
    eylem: 'Kontrol et',
    yetkiler: [],
    baslik: (n) => `${n} ödeme ya da hakediş kontrolünüzü bekliyor`,
    aciklama: 'Yönetici onayından önce muhasebe kontrolü gerekiyor.',
  },
  talimat_reddedildi: {
    onem: 'uyari',
    eylem: 'İncele',
    yetkiler: [],
    baslik: (n) => `${n} ödeme talimatınız reddedildi`,
    aciklama: 'Yönetici gerekçesini yazdı; gerekirse düzeltip yeniden gönderin.',
  },
  nakit_acigi: {
    onem: 'acil',
    eylem: 'İncele',
    yetkiler: ['kasa', 'odeme', 'rapor'],
    baslik: () => 'Bu hafta ödemeler kasa ve bankayı aşıyor',
    aciklama: 'Vadesi geçmiş ve 7 gün içinde dolacak ödemeler, kasa ve bankadaki TL toplamından fazla. Tahsilatları hızlandırın ya da ödemeleri öteleyin.',
  },
  nakit_tahmini: {
    onem: 'uyari',
    eylem: 'İncele',
    yetkiler: ['kasa', 'odeme', 'rapor'],
    baslik: () => 'Önümüzdeki haftalarda nakit açığı görünüyor',
    aciklama: 'Kayıtlı ödemeler ve planlı ödemeler (sözleşme planı, arsa sahibi) tahsilatlardan önce kasayı eksiye düşürüyor.',
  },
  geciken_odeme: {
    onem: 'acil',
    eylem: 'Öde',
    yetkiler: ['odeme', 'gider'],
    baslik: (n) => `${n} ödemenin vadesi geçti`,
    aciklama: 'Fatura, verilen çek ya da kredi taksiti. Ödendiyse ödemeyi girip faturayla eşleştirin.',
  },
  geciken_tahsilat: {
    onem: 'acil',
    eylem: 'Tahsil et',
    yetkiler: ['odeme', 'satis'],
    baslik: (n) => `${n} tahsilatın vadesi geçti`,
    aciklama: 'Satış taksiti, ilave imalat alacağı ya da alınan çek. Tahsil edildiyse tahsilatı girin.',
  },
  mukerrer_fatura: {
    onem: 'acil',
    eylem: 'İncele',
    yetkiler: ['gider'],
    baslik: (n) => `${n} fatura iki kez girilmiş olabilir`,
    aciklama: 'Aynı cariden aynı fatura numarasıyla (ya da numarasız, aynı gün aynı tutarla) birden çok gider var. Fazlaysa iptal edin.',
  },
  ilerleme_sapmasi: {
    onem: 'uyari',
    eylem: 'İncele',
    yetkiler: ['ilerleme', 'rapor'],
    baslik: (n) => `${n} işte harcama, ilerlemenin önünde`,
    aciklama: 'Bütçenin harcanan oranı, girilen fiziksel ilerlemeden eşik kadar fazla. İlerleme güncel değilse güncelleyin; güncelse bütçe aşımı yaklaşıyor.',
  },
  hakedis_onayi: {
    onem: 'uyari',
    eylem: 'Onayla',
    yetkiler: ['sozlesme'],
    baslik: (n) => `${n} hakediş onay bekliyor`,
    aciklama: 'Taslak hakediş borç ve maliyet doğurmaz; onaylanınca ustanın carisine yazılır.',
  },
  imzasiz_sozlesme: {
    onem: 'uyari',
    eylem: 'Tamamla',
    yetkiler: ['sozlesme'],
    baslik: (n) => `${n} usta sözleşmesi imza bekliyor`,
    aciklama: 'Taslak sözleşmeye hakediş yapılamaz. Eksik bilgileri tamamlayıp imzalandı olarak işaretleyin.',
  },
  imzasiz_satis: {
    onem: 'uyari',
    eylem: 'Tamamla',
    yetkiler: ['satis'],
    baslik: (n) => `${n} satış rezerve, protokol imzalanmadı`,
    aciklama: 'İmzalanana kadar ödeme planı alacağa dönüşmez, taksitler takip edilmez.',
  },
  bekleyen_belge: {
    onem: 'uyari',
    eylem: 'Bağla',
    yetkiler: [],
    baslik: (n) => `${n} belge onay bekliyor`,
    aciklama: 'Yüklenen fatura, fiş ve belgeler ilgili kayda bağlanmadı.',
  },
  puantaj_yazilmamis: {
    onem: 'uyari',
    eylem: 'Gidere yaz',
    yetkiler: ['gider'],
    baslik: (n) => `${n} işçinin geçmiş ay yevmiyesi gidere yazılmadı`,
    aciklama: 'Puantajdaki yevmiyeler carisine borç yazılmadıkça maliyete ve borca girmez.',
  },
  geciken_teslim: {
    onem: 'uyari',
    eylem: 'Teslim al',
    yetkiler: ['gider', 'ilerleme', 'proje'],
    baslik: (n) => `${n} malzeme siparişinin teslimi gecikti`,
    aciklama: 'Gereken tarih geçti, siparişin tamamı teslim alınmadı. Geldiyse teslim alın, gelmeyecekse eksikle kapatın.',
  },
  eksik_is_gecikti: {
    onem: 'uyari',
    eylem: 'Takip et',
    yetkiler: ['satis', 'proje', 'ilerleme', 'sozlesme'],
    baslik: (n) => `${n} eksik işin son günü geçti`,
    aciklama: 'Teslimde ya da kontrolde bulunan eksik giderilmedi. Sorumluya hatırlatın; yapıldıysa işaretleyin.',
  },
  daire_teslimi: {
    onem: 'uyari',
    eylem: 'Teslime hazırla',
    yetkiler: ['satis', 'proje'],
    baslik: (n) => `${n} dairenin teslim günü yaklaştı ya da geçti`,
    aciklama: 'Satışta taahhüt edilen teslim günü 30 gün içinde ya da geçmiş, bölüm henüz teslim edilmedi. Teslim kontrolünü önceden yapın.',
  },
  sabit_gider_girilmedi: {
    onem: 'bilgi',
    eylem: 'Gider gir',
    yetkiler: ['gider'],
    baslik: (n) => `${n} sabit giderin bu ayki gideri girilmedi`,
    aciklama: 'Kira, maaş gibi düzenli giderin günü geçti, bu ay aynı cariye (ya da kaleme) gider girilmedi. Ödendiyse girin; maliyet ve kasa doğru görünsün.',
  },
  mutabakat_farkli: {
    onem: 'uyari',
    eylem: 'Farkı bul',
    yetkiler: ['cari', 'odeme', 'gider'],
    baslik: (n) => `${n} carinin mutabakatında fark var`,
    aciklama: 'Karşı tarafın bakiyesi kayıtlarımızdan farklı. Eksik fatura ya da ödemeyi bulun, düzeltin ve "Fark çözüldü" deyin.',
  },
  mutabakat_yanitsiz: {
    onem: 'bilgi',
    eylem: 'Hatırlat',
    yetkiler: ['cari', 'odeme', 'gider'],
    baslik: (n) => `${n} mutabakat mektubu iki haftadır yanıtsız`,
    aciklama: 'Gönderilen mutabakata yanıt girilmedi. Cariye hatırlatın; yanıt geldiyse girin.',
  },
  pahali_alim: {
    onem: 'bilgi',
    eylem: 'İncele',
    yetkiler: ['gider', 'rapor'],
    baslik: (n) => `${n} alım yakın dönemdeki fiyatlardan pahalı`,
    aciklama: 'Son 30 günde, aynı kalemin ±90 gündeki diğer alımlarının ortancasından %15 daha pahalı alınmış. Fatura yanlış girilmemişse tedarikçiyle konuşun.',
  },
  siparis_onayi: {
    onem: 'uyari',
    eylem: 'Onayla',
    yetkiler: ['gider', 'ilerleme', 'proje'],
    baslik: (n) => `${n} malzeme siparişi onay bekliyor`,
    aciklama: 'Teklif seçildi ama sipariş onaylanmadı; teslim ve fatura onaydan sonra girilir.',
  },
  satinalma_uyumsuz: {
    onem: 'uyari',
    eylem: 'İncele',
    yetkiler: ['gider', 'odeme'],
    baslik: (n) => `${n} siparişte teslim, fatura ve ödeme uyuşmuyor`,
    aciklama: 'Parası ödenen malzemenin bir kısmı gelmemiş, teslimden fazla faturalanmış ya da fatura sipariş fiyatından farklı.',
  },
  fatura_bekleyen: {
    onem: 'bilgi',
    eylem: 'Fatura gir',
    yetkiler: ['gider'],
    baslik: (n) => `${n} teslim alınan siparişin faturası girilmedi`,
    aciklama: 'Malzeme bir haftadan uzun süre önce teslim alındı, faturası talebe bağlanmadı; maliyette ve borçta görünmüyor.',
  },
  kalemsiz_gider: {
    onem: 'bilgi',
    eylem: 'Düzelt',
    yetkiler: ['gider'],
    baslik: (n) => `${n} giderin maliyet kalemi seçilmemiş`,
    aciklama: 'Kalemsiz gider bütçede ve ilerleme karşılaştırmasında görünmez.',
  },
  vadesiz_borc: {
    onem: 'bilgi',
    eylem: 'Vade yaz',
    yetkiler: ['gider', 'odeme'],
    baslik: (n) => `${n} ödenmemiş faturanın vadesi yazılmamış`,
    aciklama: 'Vadesiz fatura vade listesinde ve nakit akışında doğru yerde görünmez.',
  },
  taramasiz_fatura: {
    onem: 'bilgi',
    eylem: 'Belge ekle',
    yetkiler: ['gider', 'belge'],
    baslik: (n) => `${n} faturanın taraması yok`,
    aciklama: 'Fatura numarası girilmiş ama fatura fotoğrafı ya da PDF\'i eklenmemiş (son 90 gün).',
  },
  dekontsuz_odeme: {
    onem: 'bilgi',
    eylem: 'Dekont ekle',
    yetkiler: ['odeme', 'belge'],
    baslik: (n) => `${n} havale ödemesinin dekontu yok`,
    aciklama: 'Son 90 günde havale/EFT ile yapılan ödemelere dekont eklenmemiş.',
  },
  eksik_maliyet: {
    onem: 'bilgi',
    eylem: 'Tamamla',
    yetkiler: ['proje', 'sozlesme', 'ayar'],
    baslik: (n) => `${n} maliyet hesabında fiyatı ya da miktarı eksik satır var`,
    aciklama: 'Eksik satırlar toplamda yok sayılır; hesap onaylanamaz.',
  },
};

const ONEM_SIRASI: Record<Onem, number> = { acil: 0, uyari: 1, bilgi: 2 };
const KOD_SIRASI = Object.keys(KURALLAR) as YapilacakKodu[];

/**
 * Gizleme listesi: anahtar → 'hep' (bir daha gösterme) ya da tarih (o güne kadar ertele, o gün yeniden görünür).
 */
export type GizlemeListesi = Record<string, 'hep' | Tarih>;

export const gizliMi = (g: GizlemeListesi, anahtar: string, bugun: Tarih) => {
  const d = g[anahtar];
  return d === 'hep' || (d !== undefined && d > bugun);
};

/** Süresi geçen ertelemeleri atar (liste büyümesin). */
export function gizlemeyiTemizle(g: GizlemeListesi, bugun: Tarih): GizlemeListesi {
  return Object.fromEntries(Object.entries(g).filter(([, d]) => d === 'hep' || d > bugun));
}

/**
 * Kural sonuçlarını gruplar: yetkisi olmayanın kuralı ve gizlenmiş maddeler çıkar, boş grup çıkmaz; önem ve kural
 * sırasıyla dizilir.
 */
export function gruplariOlustur(
  sonuclar: Partial<Record<YapilacakKodu, YapilacakOge[]>>,
  yetkiVar: (y: Yetki) => boolean,
  gizleme: GizlemeListesi,
  bugun: Tarih,
): YapilacakGrubu[] {
  const gruplar: YapilacakGrubu[] = [];
  for (const kod of KOD_SIRASI) {
    const t = KURALLAR[kod];
    if (t.yetkiler.length && !t.yetkiler.some(yetkiVar)) continue;
    const ogeler = (sonuclar[kod] ?? []).filter((o) => !gizliMi(gizleme, o.anahtar, bugun));
    if (!ogeler.length) continue;
    gruplar.push({ kod, onem: t.onem, baslik: t.baslik(ogeler.length), aciklama: t.aciklama, eylem: t.eylem, ogeler });
  }
  return gruplar.sort((a, b) => ONEM_SIRASI[a.onem] - ONEM_SIRASI[b.onem] || KOD_SIRASI.indexOf(a.kod) - KOD_SIRASI.indexOf(b.kod));
}

/** Rozet: acil + dikkat maddeleri (eksik bilgi sayılmaz). */
export const rozetSayisi = (gruplar: YapilacakGrubu[]) => gruplar.filter((g) => g.onem !== 'bilgi').reduce((s, g) => s + g.ogeler.length, 0);

// ─── Kurallar ─────────────────────────────────────────────────────

const tl = (k: Kurus) => `${(k / 100).toLocaleString('tr-TR', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} TL`;

/** Nakit açığı: (gecikmiş + 7 gün içinde) ödenecek − (gecikmiş + 7 gün içinde) tahsil edilecek > kasa ve banka TL. */
export function nakitAcigi(g: { odenecek: Kurus; tahsilEdilecek: Kurus; kasaBanka: Kurus; bugun: Tarih; yol: string }): YapilacakOge[] {
  const ihtiyac = g.odenecek - g.tahsilEdilecek;
  if (g.odenecek <= 0 || ihtiyac <= g.kasaBanka) return [];
  // Haftalık anahtar: ertelenirse bir sonraki hafta yeniden sorar.
  const hafta = haftaBasi(g.bugun);
  return [
    {
      anahtar: `nakit_acigi:${hafta}`,
      baslik: `${tl(ihtiyac - g.kasaBanka)} eksik`,
      ayrinti: `Ödenecek ${tl(g.odenecek)}${g.tahsilEdilecek ? ` − beklenen tahsilat ${tl(g.tahsilEdilecek)}` : ''}; kasa ve banka ${tl(g.kasaBanka)}`,
      tutar: ihtiyac - g.kasaBanka,
      yol: g.yol,
    },
  ];
}

export function haftaBasi(t: Tarih): Tarih {
  const d = new Date(`${t}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export interface MukerrerGider {
  id: string;
  cariId: string | null;
  cariAdi: string;
  faturaNo: string | null;
  tarih: Tarih;
  toplam: Kurus;
}

/** "ABC-2026/0012" ile "abc 2026 12" aynı sayılır: harf ve rakamlar, baştaki sıfırlar atılarak. */
export const faturaNoAnahtari = (no: string) =>
  aramaAnahtari(no)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .map((p) => (/^\d+$/.test(p) ? String(Number(p)) : p))
    .join('');

/**
 * Aynı cariden aynı fatura numarası ya da (ikisinde de numara yoksa) aynı gün aynı tutar. Her gruptan en yeni
 * kayıtlar (ilki hariç) madde olur; anahtar gruptaki bütün kimliklerden (yeni bir kopya eklenirse yeniden sorar).
 */
export function mukerrerFaturalar(giderler: MukerrerGider[]): YapilacakOge[] {
  const gruplar = new Map<string, MukerrerGider[]>();
  for (const g of giderler) {
    if (!g.cariId || g.toplam === 0) continue;
    const no = g.faturaNo ? faturaNoAnahtari(g.faturaNo) : '';
    const k = no ? `${g.cariId}|no:${no}` : `${g.cariId}|${g.tarih}|${g.toplam}`;
    gruplar.set(k, [...(gruplar.get(k) ?? []), g]);
  }
  const sonuc: YapilacakOge[] = [];
  for (const l of gruplar.values()) {
    if (l.length < 2) continue;
    const sirali = [...l].sort((a, b) => a.tarih.localeCompare(b.tarih) || a.id.localeCompare(b.id));
    const ilk = sirali[0]!;
    const anahtar = `mukerrer_fatura:${sirali.map((x) => x.id).join(',')}`;
    sonuc.push({
      anahtar,
      baslik: ilk.cariAdi,
      ayrinti: `${ilk.faturaNo ? `Fatura ${ilk.faturaNo}` : 'Numarasız'} · ${l.length} kez girilmiş (${sirali.map((x) => tarihKisa(x.tarih)).join(', ')})`,
      tutar: ilk.toplam,
      yol: `giderler/${sirali.at(-1)!.id}`,
    });
  }
  return sonuc;
}

const tarihKisa = (t: Tarih) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
