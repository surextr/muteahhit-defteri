import type Dexie from 'dexie';
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
export const SEMA_SURUMU = 1;

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
  // Yeni adımlar buraya, örn.:
  // db.version(2).stores({ ... }).upgrade(async (tx) => { ... });
}
