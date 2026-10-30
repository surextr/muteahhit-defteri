import { describe, expect, it } from 'vitest';
import { DxfOkuyucu, dxfKodlamasi, dxfMetniTemizle } from './dxf';

const dxf = (ciftler: [number, string | number][]) => ciftler.map(([k, v]) => `  ${k}\r\n${v}\r\n`).join('');

const ORNEK = dxf([
  [0, 'SECTION'], [2, 'HEADER'], [9, '$ACADVER'], [1, 'AC1021'], [9, '$INSUNITS'], [70, 5], [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'BLOCKS'], [0, 'BLOCK'], [2, 'KAPI'], [0, 'LINE'], [8, 'blok'], [10, 0], [20, 0], [11, 999], [21, 0], [0, 'ENDBLK'], [0, 'ENDSEC'],
  [0, 'SECTION'], [2, 'ENTITIES'],
  [0, 'LINE'], [8, 'as_duvar'], [10, 0], [20, 0], [30, 0], [11, 300], [21, 0], [31, 0],
  [0, 'LWPOLYLINE'], [8, 'as_duvar'], [90, 3], [70, 1], [10, 0], [20, 0], [10, 100], [20, 0], [10, 100], [20, 100],
  [0, 'TEXT'], [8, 'as_yazı'], [10, 50], [20, 60], [40, 12], [1, 'OFİS 12,10 m%%c'],
  [0, 'MTEXT'], [8, 'as_yazı'], [10, 5], [20, 6], [40, 10], [3, '{\\fArial|b0;ENGELLİ'], [1, ' WC\\P4,00 m\\U+00B2}'],
  [0, 'INSERT'], [8, 'as_kapı-pen'], [2, 'KAPI'], [10, 7], [20, 8],
  [0, 'LINE'], [8, 'kağıt'], [67, 1], [10, 0], [20, 0], [11, 5], [21, 0],
  [0, 'POLYLINE'], [8, 'eski'], [70, 0], [10, 0], [20, 0],
  [0, 'VERTEX'], [10, 0], [20, 0], [0, 'VERTEX'], [10, 0], [20, 40], [0, 'SEQEND'],
  [0, 'ENDSEC'], [0, 'EOF'],
]);

describe('DXF okuyucu', () => {
  it('parça parça beslenince de aynı sonuç: çizgi, kapalı çoklu çizgi, yazılar, blok; kağıt uzayı ve blok tanımı atlanır', () => {
    for (const boy of [7, 64, 100000]) {
      const o = new DxfOkuyucu();
      for (let i = 0; i < ORNEK.length; i += boy) o.besle(ORNEK.slice(i, i + boy));
      const c = o.bitir();
      expect(c.birimKodu).toBe(5);
      expect(c.surum).toBe('AC1021');
      expect(c.parcalar.get('as_duvar')).toEqual([150, 0, 300, 50, 0, 100, 100, 50, 100, 50, 50, Math.hypot(100, 100)]);
      expect(c.parcalar.get('eski')).toEqual([0, 20, 40]);
      expect(c.parcalar.has('kağıt')).toBe(false);
      expect(c.parcalar.has('blok')).toBe(false);
      expect(c.yazilar.map((y) => y.metin)).toEqual(['OFİS 12,10 mØ', 'ENGELLİ WC 4,00 m²']);
      expect(c.yazilar[0]).toMatchObject({ x: 50, y: 60, h: 12, katman: 'as_yazı' });
      expect(c.bloklar).toEqual([{ ad: 'KAPI', katman: 'as_kapı-pen', x: 7, y: 8 }]);
    }
  });

  it('metin temizleme ve kodlama', () => {
    expect(dxfMetniTemizle('{\\H1.2x;\\C1;SALON}\\P%%c12 \\S1^2;')).toBe('SALON Ø12 1/2');
    expect(dxfKodlamasi('  9\n$ACADVER\n  1\nAC1018\n  9\n$DWGCODEPAGE\n  3\nANSI_1254\n')).toBe('windows-1254');
    expect(dxfKodlamasi('  9\n$ACADVER\n  1\nAC1027\n')).toBe('utf-8');
  });
});
