import { describe, expect, it } from 'vitest';
import { maskele } from './maskele';

describe('maskele', () => {
  it('telefon, TC, VKN, IBAN ve e-posta yer tutucuyla değişir; tutar ve tarih kalır', () => {
    const m = maskele(
      'Usta Ali (0532 111 22 33, ali@ornek.com, TC 12345678901) ödemeyi TR12 0006 1005 1978 6457 8413 26 hesabına alır. Vergi no 1234567890. 15.000 TL, 12.03.2026.',
    );
    expect(m.metin).toBe(
      'Usta Ali ([TELEFON], [E-POSTA], TC [TC]) ödemeyi [IBAN] hesabına alır. Vergi no [VKN]. 15.000 TL, 12.03.2026.',
    );
    expect(m.maskelenen.map((x) => x.tur).sort()).toEqual(['E-POSTA', 'IBAN', 'TC', 'TELEFON', 'VKN']);
  });

  it('+90 ve parantezli telefon', () => {
    expect(maskele('Tel: +90 (532) 111 22 33').metin).toBe('Tel: [TELEFON]');
    expect(maskele('Kişi yoksa metin aynı kalır.').maskelenen).toHaveLength(0);
  });
});
