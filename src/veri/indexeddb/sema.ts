import type Dexie from 'dexie';
import { cekSenetSurum4, eslestirmeSurum3, giderSatiriSurum2, giderSurum2, giderSurum3, firmaSurum5, projeSurum5, projeSurum6, blokSurum6, bolumlerSurum6, katKarsiligiSurum6, bolumlerSurum7, firmaSurum7, katKarsiligiSurum8, giderSatiriSurum8, kalemlerSurum8, firmaSurum9, ustaTipiSurum9, ustaTipiSurum10, ustaSozlesmesiSurum11, cariSurum12, ustaSozlesmesiSurum13, ustaSozlesmesiSurum14, giderSurum14, ustaTipiSurum14, odemePlaniSurum15, satisSurum16, satisSurum23, projeSurum20 } from '../gecisler';
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
export const SEMA_SURUMU = 28;

/** Şema 1'den sonra eklenen tablolar; kendi sürüm adımlarında tanımlanır. */
type SonradanEklenen = 'arsaSahibiOdemesi' | 'ilaveImalat' | 'alacak' | 'teminatIadesi' | 'kalemIlerlemesi' | 'belgeHavuzu' | 'projeFotografi' | 'fiyatKalemi' | 'maliyetHesabi' | 'kredi' | 'santiyeGunlugu' | 'malzemeTalebi' | 'malzemeHareketi' | 'odemeOnayi' | 'yapilacakAtama' | 'daireTeslimi' | 'eksikIs' | 'sabitGider' | 'mutabakat';

const SURUM_1: Record<Exclude<TabloAdi, SonradanEklenen> | 'meta', string> = {
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

  // Şema 8: kat karşılığı ayrıntıları (teslim, ceza, kira), arsa sahibine nakit ödeme planı, ilave imalat,
  // genel alacak kaydı; gider satırı ilave imalata bağlanabilir.
  const SURUM_8: Record<Exclude<SonradanEklenen, 'teminatIadesi' | 'kalemIlerlemesi' | 'belgeHavuzu' | 'projeFotografi' | 'fiyatKalemi' | 'maliyetHesabi' | 'kredi' | 'santiyeGunlugu' | 'malzemeTalebi' | 'malzemeHareketi' | 'odemeOnayi' | 'yapilacakAtama' | 'daireTeslimi' | 'eksikIs' | 'sabitGider' | 'mutabakat'>, string> & { giderSatiri: string } = {
    arsaSahibiOdemesi: 'id, firmaId, sozlesmeId, projeId, cariId',
    ilaveImalat: 'id, firmaId, sozlesmeId, projeId, cariId',
    alacak: 'id, firmaId, cariId, projeId, kaynakId',
    giderSatiri: 'id, firmaId, giderId, kalemId, ilaveImalatId',
  };
  db.version(8)
    .stores(SURUM_8)
    .upgrade(async (tx) => {
      await tx.table('katKarsiligiSozlesme').toCollection().modify((k, ref) => {
        ref.value = katKarsiligiSurum8(k);
      });
      await tx.table('giderSatiri').toCollection().modify((s, ref) => {
        ref.value = giderSatiriSurum8(s);
      });
      await tx.table('kalem').bulkPut(kalemlerSurum8(await tx.table('kalem').toArray()));
    });

  // Şema 9: usta tipleri (kalem şablonu, sorumluluk soruları, ortak maddeler) ve firmanın ortak sözleşme maddeleri.
  db.version(9)
    .stores({})
    .upgrade(async (tx) => {
      await tx.table('firma').toCollection().modify((f, ref) => {
        ref.value = firmaSurum9(f);
      });
      await tx.table('ustaTipi').toCollection().modify((u, ref) => {
        ref.value = ustaTipiSurum9(u);
      });
    });

  // Şema 10: usta tipleri yalnız gider yazılabilen kalemlere; kalem satırı başına bütçe kalemi. Dizin değişmez.
  db.version(10)
    .stores({})
    .upgrade(async (tx) => {
      await tx.table('ustaTipi').toCollection().modify((u, ref) => {
        ref.value = ustaTipiSurum10(u);
      });
    });

  // Şema 11: usta sözleşmesi ayrıntıları (tarihler, kalem satırı, sorumluluk ve ortak madde cevapları). Dizin değişmez.
  db.version(11)
    .stores({})
    .upgrade(async (tx) => {
      await tx.table('ustaSozlesmesi').toCollection().modify((s, ref) => {
        ref.value = ustaSozlesmesiSurum11(s);
      });
    });

  // Şema 12: cari kartında branşlar (usta tipleri), taşeron rolü ve firma yetkilisi. Dizin değişmez.
  db.version(12)
    .stores({})
    .upgrade(async (tx) => {
      await tx.table('cari').toCollection().modify((c, ref) => {
        ref.value = cariSurum12(c);
      });
    });

  // Şema 13: toplu sözleşme; usta sözleşmesi bölümlere (usta tipleri) ayrılır. Dizin değişmez.
  db.version(13)
    .stores({})
    .upgrade(async (tx) => {
      await tx.table('ustaSozlesmesi').toCollection().modify((s, ref) => {
        ref.value = ustaSozlesmesiSurum13(s);
      });
    });

  // Şema 14: hakediş; sözleşme kalemine kimlik, bölüme takip yöntemi ve aşamalar, teminat oranı; gidere hakediş bağı
  // (dizinli: hakediş iptalinde gideri bulmak için).
  db.version(14)
    .stores({ gider: 'id, firmaId, projeId, cariId, tarih, faturaNo, iadeEdilenGiderId, hakedisId' })
    .upgrade(async (tx) => {
      const ustaTipleri = await tx.table('ustaTipi').toArray();
      await tx.table('ustaSozlesmesi').toCollection().modify((s, ref) => {
        ref.value = ustaSozlesmesiSurum14(s, ustaTipleri);
      });
      await tx.table('gider').toCollection().modify((g, ref) => {
        ref.value = giderSurum14(g);
      });
      await tx.table('ustaTipi').toCollection().modify((u, ref) => {
        ref.value = ustaTipiSurum14(u);
      });
    });

  // Şema 15: teminat iadesi tablosu; ödeme planına açıklama. Ödeme planı ve SGK tabloları şema 1'den beri vardı
  // (boştu); ekranları bu sürümde geldi.
  db.version(15)
    .stores({ teminatIadesi: 'id, firmaId, sozlesmeId, cariId' })
    .upgrade(async (tx) => {
      await tx.table('odemePlani').toCollection().modify((o, ref) => {
        ref.value = odemePlaniSurum15(o);
      });
    });

  // Şema 16: daire satışı (fiyat, KDV, takas, ödeme planı, teslim, protokol maddeleri). Dizin değişmez.
  db.version(16)
    .stores({})
    .upgrade(async (tx) => {
      await tx.table('satis').toCollection().modify((s, ref) => {
        ref.value = satisSurum16(s);
      });
    });

  // Şema 17: ana kalem ilerleme yüzdeleri (yeni tablo; eski kayıtlara dokunulmaz).
  db.version(17).stores({ kalemIlerlemesi: 'id, firmaId, projeId, kalemId, tarih' });

  // Şema 18: buluta gönderilmeyi bekleyen kayıt işaretleri (cihaza özel, yedeğe girmez; bulut/esitleme.ts).
  db.version(18).stores({ bekleyen: 'anahtar, sayac' });

  // Şema 19: belge havuzu (onay bekleyen belgeler; yeni tablo).
  db.version(19).stores({ belgeHavuzu: 'id, firmaId, durum, ozet' });

  // Şema 20: şantiye fotoğrafları; projeye konum.
  db.version(20)
    .stores({ projeFotografi: 'id, firmaId, projeId' })
    .upgrade((tx) => tx.table('proje').toCollection().modify((p: Record<string, unknown>) => Object.assign(p, projeSurum20(p))));

  // Şema 21: malzeme / işçilik / makine fiyat kataloğu.
  db.version(21).stores({ fiyatKalemi: 'id, firmaId, tur' });

  // Şema 22: maliyet hesapları (projeli ya da projesiz).
  db.version(22).stores({ maliyetHesabi: 'id, firmaId, projeId' });

  // Şema 23: banka kredisi ve şantiye günlüğü (yeni tablolar); satışa daireye özel ek işler (`ekIstekler`, boş başlar).
  db.version(23)
    .stores({ kredi: 'id, firmaId, projeId, hesapId', santiyeGunlugu: 'id, firmaId, projeId, tarih' })
    .upgrade(async (tx) => {
      await tx.table('satis').toCollection().modify((s, ref) => {
        ref.value = satisSurum23(s);
      });
    });

  // Şema 24: malzeme talepleri ve şantiye stok hareketleri (yeni tablolar).
  db.version(24).stores({ malzemeTalebi: 'id, firmaId, projeId', malzemeHareketi: 'id, firmaId, projeId, talepId' });

  // Şema 25: ödeme onay talimatları ve Tamamlanacak işler atamaları (yeni tablolar).
  db.version(25).stores({ odemeOnayi: 'id, firmaId, cariId, projeId', yapilacakAtama: 'id, firmaId, anahtar, kullaniciId' });

  // Şema 26: daire teslim kontrolleri ve eksik işler (yeni tablolar).
  db.version(26).stores({ daireTeslimi: 'id, firmaId, projeId, bolumId', eksikIs: 'id, firmaId, projeId, bolumId, teslimId' });

  // Şema 27: sabit giderler (yeni tablo).
  db.version(27).stores({ sabitGider: 'id, firmaId, cariId, projeId' });

  // Şema 28: cari mutabakatları (yeni tablo).
  db.version(28).stores({ mutabakat: 'id, firmaId, cariId' });

  // Yeni adımlar buraya: db.version(29)…; dönüşüm fonksiyonu veri/gecisler.ts'e.
}
