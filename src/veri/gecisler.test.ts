import { describe, expect, it } from 'vitest';
import { TABLO_DONUSTURUCULERI } from './gecisler';

describe('şema 4 → 5', () => {
  it('proje adresi ve arsa alanı, firma bilgileri ve logo eklenir; var olan değerler korunur', () => {
    const sonuc = TABLO_DONUSTURUCULERI[4]!({
      proje: [{ id: 'p1', adres: 'Merkez', alanlar: { net: 100, brut: null, toplamInsaat: null, satilabilir: null } }],
      firma: [{ id: 'f1', ad: 'Firma' }],
      cari: [{ id: 'c1' }],
    });
    expect(sonuc.proje).toEqual([
      { id: 'p1', adres: 'Merkez', il: null, ilce: null, mahalle: null, alanlar: { arsa: null, net: 100, brut: null, toplamInsaat: null, satilabilir: null } },
    ]);
    expect(sonuc.firma).toEqual([
      {
        id: 'f1',
        ad: 'Firma',
        logo: null,
        bilgiler: { yetkili: '', telefon: '', eposta: '', web: '', adres: '', vergiDairesi: '', vergiNo: '' },
      },
    ]);
    expect(sonuc.cari).toEqual([{ id: 'c1' }]);
  });
});

describe('şema 5 → 6', () => {
  it('tek ada/parsel ve arsa alanı parsel listesine taşınır; boş proje boş liste olur', () => {
    const { proje } = TABLO_DONUSTURUCULERI[5]!({
      proje: [
        { id: 'p1', ada: '101', parsel: '5', alanlar: { arsa: 950, net: 100 } },
        { id: 'p2', ada: '', parsel: '', alanlar: { arsa: null, net: null } },
      ],
    });
    expect(proje).toEqual([
      { id: 'p1', alanlar: { net: 100 }, parseller: [{ ada: '101', parsel: '5', alanM2: 950 }], planlananBitis: null, gerceklesenBitis: null },
      { id: 'p2', alanlar: { net: null }, parseller: [], planlananBitis: null, gerceklesenBitis: null },
    ]);
  });

  it('bölümün hattı katın içindeki numara sırasıdır; blok ve sözleşmeye varsayılanlar gelir', () => {
    const t = TABLO_DONUSTURUCULERI[5]!({
      bagimsizBolum: [
        { id: 'b10', katId: 'k2', no: '10' },
        { id: 'b4', katId: 'k1', no: '4' },
        { id: 'b9', katId: 'k2', no: '9' },
        { id: 'b5', katId: 'k1', no: '5' },
      ],
      blok: [{ id: 'A' }],
      katKarsiligiSozlesme: [{ id: 's1' }],
    });
    expect((t.bagimsizBolum as { id: string; hat: number }[]).map((b) => [b.id, b.hat])).toEqual([
      ['b10', 2],
      ['b4', 1],
      ['b9', 1],
      ['b5', 2],
    ]);
    expect(t.blok).toEqual([{ id: 'A', asansorSayisi: 0, kapaliOtopark: false, siginak: false, jenerator: false }]);
    expect(t.katKarsiligiSozlesme).toEqual([{ id: 's1', arsaSahipleri: [], payYontemi: 'brut' }]);
  });
});
