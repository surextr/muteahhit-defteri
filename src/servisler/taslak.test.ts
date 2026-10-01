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
});
