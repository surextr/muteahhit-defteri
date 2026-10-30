import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { esitTaksitPlani } from '../hesap/kredi';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Hesap } from '../veri/tipler';
import { cariOlustur } from './cari';
import { hesapOlustur } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { krediIptal, krediKaydet, krediOlustur, krediOzetiGetir, krediTaksitiOde, krediTaksitOdemesiniGeriAl } from './kredi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';
import { cariBakiyesiGetir, hesapBakiyesiGetir } from './sorgular';

const TL = (n: number) => Math.round(n * 100);
let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let banka: Hesap;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  banka = await hesapOlustur(depo, servis, { ad: 'Ziraat', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(10_000), tarih: '2026-01-01' });
});
afterEach(() => depo.kapat());

describe('kredi planı (saf)', () => {
  it('eşit taksit: anapara toplamı tutar, faiz azalan; faizsizde eşit anapara', () => {
    const p = esitTaksitPlani(TL(120_000), 2, 12, '2026-02-15', yeniId);
    expect(p).toHaveLength(12);
    expect(p.reduce((t, x) => t + x.anapara, 0)).toBe(TL(120_000));
    expect(p[0]!.faiz).toBe(TL(2_400));
    expect(p[11]!.faiz).toBeLessThan(p[0]!.faiz);
    // Toplam taksit (anapara + faiz) neredeyse sabit.
    expect(Math.abs(p[0]!.anapara + p[0]!.faiz - (p[5]!.anapara + p[5]!.faiz))).toBeLessThanOrEqual(1);
    expect(esitTaksitPlani(TL(1000), null, 3, '2026-01-31', yeniId).map((x) => [x.vadeTarihi, x.anapara, x.faiz])).toEqual([
      ['2026-01-31', 33333, 0],
      ['2026-02-28', 33333, 0],
      ['2026-03-31', 33334, 0],
    ]);
  });
});

describe('kredi', () => {
  it('kullanım hesaba girer, banka carisine borç; taksit ödemesi anapara + faiz gideri; geri alma; iptal kuralı', async () => {
    const bankaCari = await cariOlustur(depo, servis, { ad: 'Ziraat Bankası', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    const p = await projeOlustur(
      depo,
      servis,
      { ad: 'Güneş', il: null, ilce: null, mahalle: null, adres: '', parseller: [], arsaTipi: 'satin_alma', baslangicTarihi: null, planlananBitis: null, gerceklesenBitis: null, alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null } },
      [{ ...BOS_BLOK }],
    );
    const taksitler = esitTaksitPlani(TL(100_000), 3, 2, '2026-03-01', yeniId);
    const g = { ad: 'Proje kredisi', bankaCariId: bankaCari.id, hesapId: banka.id, projeId: p.id, kullanimTarihi: '2026-02-01', anapara: TL(100_000), faizOrani: 3, taksitler, aciklama: '' };
    await expect(krediOlustur(depo, servis, { ...g, taksitler: taksitler.slice(0, 1) })).rejects.toThrow('anapara toplamı');
    const k = await krediOlustur(depo, servis, g);
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, banka.id)).toBe(TL(110_000));
    expect(await cariBakiyesiGetir(depo, oturum.firmaId, bankaCari.id)).toBe(TL(100_000));

    const t1 = taksitler[0]!;
    await krediTaksitiOde(depo, servis, k.id, t1.id, { tarih: '2026-03-01', hesapId: banka.id });
    const o = (await krediOzetiGetir(depo, oturum.firmaId, k.id, '2026-03-02'))!;
    expect(o.taksitler[0]).toMatchObject({ durum: 'odendi', odenenAnapara: t1.anapara, odenenFaiz: TL(3_000) });
    expect(o.kalanAnapara).toBe(TL(100_000) - t1.anapara);
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, banka.id)).toBe(TL(110_000) - t1.anapara - TL(3_000));
    expect(await cariBakiyesiGetir(depo, oturum.firmaId, bankaCari.id)).toBe(TL(100_000) - t1.anapara);
    const faizGideri = (await depo.listele('gider', { firmaId: oturum.firmaId })).find((x) => x.krediTaksitId === t1.id)!;
    expect(faizGideri).toMatchObject({ projeId: p.id, cariId: null, toplam: TL(3_000) });
    await expect(krediTaksitiOde(depo, servis, k.id, t1.id, { tarih: '2026-03-01', hesapId: banka.id })).rejects.toThrow('zaten ödenmiş');

    await expect(krediKaydet(depo, servis, k.id, { ...g, taksitler: [{ ...t1, anapara: 0, faiz: 0 }, taksitler[1]!] }, 'x')).rejects.toThrow();
    await expect(krediIptal(depo, servis, k.id, 'x')).rejects.toThrow('Taksit ödenmiş');

    await krediTaksitOdemesiniGeriAl(depo, servis, k.id, t1.id, 'yanlış');
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, banka.id)).toBe(TL(110_000));
    expect((await krediOzetiGetir(depo, oturum.firmaId, k.id, '2026-03-02'))!.taksitler[0]!.durum).toBe('gecikti');

    await krediKaydet(depo, servis, k.id, { ...g, anapara: TL(80_000), taksitler: esitTaksitPlani(TL(80_000), 3, 2, '2026-03-01', yeniId) }, 'düzeltme');
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, banka.id)).toBe(TL(90_000));
    await krediIptal(depo, servis, k.id, 'vazgeçildi');
    expect(await hesapBakiyesiGetir(depo, oturum.firmaId, banka.id)).toBe(TL(10_000));
  });
});
