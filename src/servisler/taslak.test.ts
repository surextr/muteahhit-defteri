import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { taslakGetir, taslakSil, taslakYaz } from './taslak';

describe('taslak', () => {
  let depo: Depo;
  beforeEach(async () => {
    depo = await veriKatmaniniAc(`test-${yeniId()}`);
  });
  afterEach(() => depo.kapat());

  it('yazılır, geri okunur ve silinir; işlem geçmişine girmez', async () => {
    const saat = () => new Date('2026-10-02T09:30:00Z');
    await taslakYaz(depo, 'f1', 'projeSihirbazi', 1, { adim: 2, ad: 'Gül' }, saat);
    expect(await taslakGetir(depo, 'f1', 'projeSihirbazi', 1)).toEqual({
      bicim: 1,
      zaman: '2026-10-02T09:30:00.000Z',
      veri: { adim: 2, ad: 'Gül' },
    });
    expect(await depo.listele('islemGecmisi')).toEqual([]);

    await taslakSil(depo, 'f1', 'projeSihirbazi');
    expect(await taslakGetir(depo, 'f1', 'projeSihirbazi', 1)).toBeNull();
  });

  it('başka firmanın ve eski biçimin taslağı okunmaz', async () => {
    await taslakYaz(depo, 'f1', 'projeSihirbazi', 1, { a: 1 });
    expect(await taslakGetir(depo, 'f2', 'projeSihirbazi', 1)).toBeNull();
    expect(await taslakGetir(depo, 'f1', 'projeSihirbazi', 2)).toBeNull();
  });

  it('fotoğraf (Blob) taslakta saklanır ve geri okunur', async () => {
    const dosya = new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 3])], { type: 'image/jpeg' });
    await taslakYaz(depo, 'f1', 'giderFormuBelgeleri', 1, [{ ad: 'fis.jpg', dosya }]);
    const t = await taslakGetir<{ ad: string; dosya: Blob }[]>(depo, 'f1', 'giderFormuBelgeleri', 1);
    expect(t?.veri[0]?.ad).toBe('fis.jpg');
    expect(t?.veri[0]?.dosya.size).toBe(5);
    expect(t?.veri[0]?.dosya.type).toBe('image/jpeg');
  });
});
