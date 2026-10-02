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
