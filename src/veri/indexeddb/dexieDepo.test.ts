import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import { yeniId } from '../kimlik';
import { DexieDepo } from './dexieDepo';
import { SEMA_SURUMU } from './sema';

describe('veritabanı yapısı güncellemesi', () => {
  it('cihazdaki eski sürüm, güncellenmeden önce olduğu gibi yedeğe verilir', async () => {
    const ad = `test-${yeniId()}`;
    // Bugünkü şemadan eski bir sürümü taklit et.
    const eski = new Dexie(ad);
    eski.version(SEMA_SURUMU / 2).stores({ cari: 'id', meta: 'anahtar' });
    await eski.open();
    await eski.table('cari').add({ id: 'c1', ad: 'Eski Cari' });
    await eski.table('meta').add({ anahtar: 'aktifFirmaId', deger: 'f1' });
    eski.close();

    const gecistenOnce = vi.fn(async () => {});
    const depo = new DexieDepo(ad, gecistenOnce);
    await depo.ac();

    expect(gecistenOnce).toHaveBeenCalledOnce();
    expect(gecistenOnce).toHaveBeenCalledWith({
      eskiSurum: SEMA_SURUMU / 2,
      yeniSurum: SEMA_SURUMU,
      icerik: { cari: [{ id: 'c1', ad: 'Eski Cari' }] },
      meta: { aktifFirmaId: 'f1' },
    });
    expect(await depo.getir('cari', 'c1')).toMatchObject({ ad: 'Eski Cari' });
    depo.kapat();
  });

  it('şema 1 → güncel: gider ve satırları dönüştürülür, eski hali önce yedeğe verilir', async () => {
    const ad = `test-${yeniId()}`;
    const eski = new Dexie(ad);
    eski.version(1).stores({
      gider: 'id, firmaId, projeId, cariId, tarih, faturaNo',
      giderSatiri: 'id, firmaId, giderId, kalemId',
      meta: 'anahtar',
    });
    await eski.open();
    await eski.table('gider').add({ id: 'g1', toplam: 12000, doviz: null });
    await eski.table('giderSatiri').add({ id: 's1', giderId: 'g1', kdvTutari: 2000 });
    eski.close();

    const gecistenOnce = vi.fn(async () => {});
    const depo = new DexieDepo(ad, gecistenOnce);
    await depo.ac();
    expect(gecistenOnce).toHaveBeenCalledWith(
      expect.objectContaining({ eskiSurum: 1, yeniSurum: SEMA_SURUMU, icerik: expect.objectContaining({ gider: [{ id: 'g1', toplam: 12000, doviz: null }] }) }),
    );
    expect(await depo.getir('gider', 'g1')).toEqual({ id: 'g1', toplam: 12000, tevkifatToplam: 0, paraBirimi: 'TRY', kur: null, tur: 'alis', iadeEdilenGiderId: null });
    expect(await depo.getir('giderSatiri', 's1')).toEqual({ id: 's1', giderId: 'g1', kdvTutari: 2000, tevkifat: null, tevkifatTutari: 0 });
    depo.kapat();
  });

  it('yedek alınamazsa güncelleme yapılmaz', async () => {
    const ad = `test-${yeniId()}`;
    const eski = new Dexie(ad);
    eski.version(SEMA_SURUMU / 2).stores({ cari: 'id' });
    await eski.open();
    eski.close();

    const depo = new DexieDepo(ad, async () => {
      throw new Error('disk dolu');
    });
    await expect(depo.ac()).rejects.toThrow('disk dolu');

    const kontrol = new Dexie(ad);
    await kontrol.open();
    expect(kontrol.verno).toBe(SEMA_SURUMU / 2);
    kontrol.close();
  });

  it('yeni kurulumda ve güncel sürümde yedek çağrılmaz', async () => {
    const ad = `test-${yeniId()}`;
    const gecistenOnce = vi.fn(async () => {});
    const ilk = new DexieDepo(ad, gecistenOnce);
    await ilk.ac();
    ilk.kapat();
    const ikinci = new DexieDepo(ad, gecistenOnce);
    await ikinci.ac();
    ikinci.kapat();
    expect(gecistenOnce).not.toHaveBeenCalled();
  });
});
