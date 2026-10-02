import { describe, expect, it } from 'vitest';
import { gunFarki, teslimDurumu } from './tarih';

describe('teslim durumu', () => {
  it('gün farkı yaz saatinden etkilenmez', () => {
    expect(gunFarki('2026-03-28', '2026-03-30')).toBe(2);
    expect(gunFarki('2026-12-31', '2027-01-01')).toBe(1);
  });

  it.each([
    [null, null, null],
    ['2027-02-03', null, { metin: 'Teslime 124 gün kaldı', durum: 'normal' }],
    ['2026-10-20', null, { metin: 'Teslime 18 gün kaldı', durum: 'yakin' }],
    ['2026-10-02', null, { metin: 'Teslim bugün', durum: 'yakin' }],
    ['2026-09-20', null, { metin: 'Teslim 12 gün gecikti', durum: 'gecikti' }],
    ['2026-09-20', '2026-09-15', { metin: '5 gün erken teslim edildi', durum: 'tamam' }],
    ['2026-09-20', '2026-09-25', { metin: '5 gün geç teslim edildi', durum: 'gecikti' }],
    [null, '2026-09-25', { metin: 'Teslim edildi', durum: 'tamam' }],
  ])('planlanan %s, gerçekleşen %s', (p, g, beklenen) => {
    expect(teslimDurumu(p, g, '2026-10-02')).toEqual(beklenen);
  });
});
