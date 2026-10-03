import type Dexie from 'dexie';
import { cekSenetSurum4, eslestirmeSurum3, giderSatiriSurum2, giderSurum2, giderSurum3, firmaSurum5, projeSurum5, projeSurum6, blokSurum6, bolumlerSurum6, katKarsiligiSurum6, bolumlerSurum7, firmaSurum7 } from '../gecisler';
import type { TabloAdi } from '../tipler';

/**
 * Veritabanı şeması, numaralı sürümlerle.
 *
 * Kural: yayınlanmış bir sürüm bir daha değiştirilmez. Her yapı değişikliği
 * yeni bir `db.version(n)` adımı olarak en alta eklenir; gerekiyorsa
 * `.upgrade(tx => …)` ile eski kayıtlar dönüştürülür. Tarayıcı açılışta
 * eksik adımları sırayla uygular. (Geçişten önce otomatik yedek: 3. adım.)
 *
 * Dizin sözdizimi: ilk alan birincil anahtar; '*alan' çok değerli dizin.
 * Yalnızca sorgulanacak alanlar dizine alınır, diğer alanlar yine saklanır.
 */
export const SEMA_SURUMU = 7;

const SURUM_1: Record<TabloAdi | 'meta', string> = {
  meta: 'anahtar',

  // Firma ve sistem
  firma: 'id',
  kullanici: 'id',
  uyelik: 'id, firmaId, kullaniciId',
  islemGecmisi: 'id, firmaId, kayitId, zaman',
  ayarDegeri: 'id, firmaId, anahtar',

  // Proje ve bina
  proje: 'id, firmaId',
  projeOrtagi: 'id, firmaId, projeId, cariId',
  blok: 'id, firmaId, projeId',
  kat: 'id, firmaId, projeId, blokId',
  bagimsizBolum: 'id, firmaId, projeId, katId',
  ortakAlan: 'id, firmaId, projeId',
  takipBasligi: 'id, firmaId, projeId',
  kalem: 'id, firmaId, projeId, ustKalemId',

  // Cari, kasa/banka, gider, ödeme
  cari: 'id, firmaId, *roller',
  acilisBakiyesi: 'id, firmaId, hedefId',
  hesap: 'id, firmaId',
  gider: 'id, firmaId, projeId, cariId, tarih, faturaNo',
  giderSatiri: 'id, firmaId, giderId, kalemId',
  odeme: 'id, firmaId, cariId, hesapId, cekSenetId, projeId, tarih',
  eslestirme: 'id, firmaId, odemeId, hedefId',
  transfer: 'id, firmaId, kaynakHesapId, hedefHesapId',
  cekSenet: 'id, firmaId, cariId, vadeTarihi, durum',
  cekHareketi: 'id, firmaId, cekSenetId, hesapId, cariId',
  belge: 'id, firmaId, bagliId',
  belgeDosyasi: 'id, belgeId',

  // Sonraki aşamalar
  ustaTipi: 'id, firmaId',
  ustaSozlesmesi: 'id, firmaId, projeId, cariId, ustaTipiId',
  sozlesmeDegisikligi: 'id, firmaId, sozlesmeId',
  hakedis: 'id, firmaId, sozlesmeId, projeId, cariId',
  odemePlani: 'id, firmaId, sozlesmeId',
  katKarsiligiSozlesme: 'id, firmaId, projeId',
  arsaSahibiTahsisi: 'id, firmaId, sozlesmeId, bolumId, cariId',
  sgkKaydi: 'id, firmaId, projeId, sozlesmeId, donem',
  satis: 'id, firmaId, projeId, bolumId, cariId',
  taksit: 'id, firmaId, satisId, cariId',
};

export function semaTanimla(db: Dexie): void {
  db.version(1).stores(SURUM_1);

  // Şema 2: KDV tevkifatı (gider satırı), gider para birimi ve kuru. Dizin değişmez; kayıtlar dönüştürülür.
  db.version(2)
    .stores({})
    .upgrade(async (tx) => {
      await tx.table('gider').toCollection().modify((g, ref) => {
        ref.value = giderSurum2(g);
      });
      await tx.table('giderSatiri').toCollection().modify((s, ref) => {
        ref.value = giderSatiriSurum2(s);
      });
    });

  // Şema 3: iade faturası (gider türü ve iade edilen fatura), eşleştirmenin kaynağı (ödeme ya da iade).
  db.version(3)
    .stores({ gider: 'id, firmaId, projeId, cariId, tarih, faturaNo, iadeEdilenGiderId' })
    .upgrade(async (tx) => {
      await tx.table('gider').toCollection().modify((g, ref) => {
        ref.value = giderSurum3(g);
      });
      await tx.table('eslestirme').toCollection().modify((e, ref) => {
        ref.value = eslestirmeSurum3(e);
      });
    });

  // Şema 4: çek/senet şube, keşideci ve verilen çekin banka hesabı (dizinli: vade uyarısı hesaba göre).
  db.version(4)
    .stores({ cekSenet: 'id, firmaId, cariId, vadeTarihi, durum, hesapId' })
    .upgrade(async (tx) => {
      await tx.table('cekSenet').toCollection().modify((c, ref) => {
        ref.value = cekSenetSurum4(c);
      });
    });

  // Şema 5: proje il/ilçe/mahalle ve arsa alanı; firma bilgileri ve logo. Dizin değişmez.
  db.version(5)
    .stores({})
    .upgrade(async (tx) => {
      await tx.table('proje').toCollection().modify((p, ref) => {
        ref.value = projeSurum5(p);
      });
      await tx.table('firma').toCollection().modify((f, ref) => {
        ref.value = firmaSurum5(f);
      });
    });

  // Şema 6: parseller ve bitiş tarihleri, blok özellikleri, bölümün dikey hattı, arsa sahipleri ve pay yöntemi.
  db.version(6)
    .stores({})
    .upgrade(async (tx) => {
      await tx.table('proje').toCollection().modify((p, ref) => {
        ref.value = projeSurum6(p);
      });
      await tx.table('blok').toCollection().modify((b, ref) => {
        ref.value = blokSurum6(b);
      });
      // Hat, aynı kattaki bölümlere bakılarak hesaplanır; tablo bir bütün olarak çevrilir.
      const bolumler = await tx.table('bagimsizBolum').toArray();
      await tx.table('bagimsizBolum').bulkPut(bolumlerSurum6(bolumler));
      await tx.table('katKarsiligiSozlesme').toCollection().modify((k, ref) => {
        ref.value = katKarsiligiSurum6(k);
      });
    });

  // Şema 7: oda tipi sayılara (oda, salon), dubleks ayrı işaret; firmaya oda tipi listesi. Dizin değişmez.
  db.version(7)
    .stores({})
    .upgrade(async (tx) => {
      const bolumler = bolumlerSurum7(await tx.table('bagimsizBolum').toArray(), await tx.table('kat').toArray());
      await tx.table('bagimsizBolum').bulkPut(bolumler);
      await tx.table('firma').toCollection().modify((f, ref) => {
        ref.value = firmaSurum7(f, bolumler);
      });
    });

  // Yeni adımlar buraya: db.version(8)…; dönüşüm fonksiyonu veri/gecisler.ts'e.
}
