import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { excelGunu, excelOlustur } from './excel';

describe('excelOlustur', () => {
  const dosya = excelOlustur([
    {
      ad: 'Ekstre: Ahmet/Usta',
      ust: ['Ahmet Usta — hesap ekstresi'],
      basliklar: ['Tarih', 'Hareket', 'Tutar'],
      satirlar: [
        [{ tarih: '2026-10-30' }, 'Alış <fatura> & "not"', { tl: 123456 }],
        [{ kalin: 'Toplam' }, null, { tl: -5000 }],
      ],
    },
  ]);
  const icerik = unzipSync(dosya);

  it('gerekli parçaları içerir', () => {
    expect(Object.keys(icerik).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort(),
    );
  });

  it('sayfa adını temizler, metni kaçırır, tutarı TL sayısı yazar', () => {
    expect(strFromU8(icerik['xl/workbook.xml']!)).toContain('name="Ekstre  Ahmet Usta"');
    const sayfa = strFromU8(icerik['xl/worksheets/sheet1.xml']!);
    expect(sayfa).toContain('Alış &lt;fatura&gt; &amp; &quot;not&quot;');
    expect(sayfa).toContain('<v>1234.56</v>');
    expect(sayfa).toContain(`<v>${excelGunu('2026-10-30')}</v>`);
    expect(sayfa).toContain('s="4"><v>-50</v>');
  });

  it('Excel gün sayısı', () => {
    expect(excelGunu('1900-03-01')).toBe(61);
    expect(excelGunu('2026-01-01')).toBe(46023);
  });
});
