import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  faturaNoAnahtari,
  gizlemeyiTemizle,
  gruplariOlustur,
  haftaBasi,
  mukerrerFaturalar,
  nakitAcigi,
  rozetSayisi,
  type YapilacakOge,
} from '../hesap/yapilacaklar';
import type { Yetki } from '../hesap/yetki';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { hesapOlustur } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { odemeYap } from './odeme';
import { yapilacaklariGetir } from './yapilacaklar';

const TL = (n: number) => Math.round(n * 100);
const oge = (anahtar: string): YapilacakOge => ({ anahtar, baslik: anahtar, ayrinti: '', yol: '' });
const hepsi = () => true;

describe('tamamlanacak işler (saf)', () => {
  it('nakit açığı: ödenecek − beklenen tahsilat kasayı aşınca; haftalık anahtar', () => {
    const g = { odenecek: TL(450_000), tahsilEdilecek: 0, kasaBanka: TL(320_000), bugun: '2026-10-29', yol: 'rapor' };
    const [o] = nakitAcigi(g);
    expect(o!.tutar).toBe(TL(130_000));
    expect(o!.anahtar).toBe('nakit_acigi:2026-10-26');
    expect(nakitAcigi({ ...g, tahsilEdilecek: TL(200_000) })).toEqual([]);
    expect(nakitAcigi({ ...g, odenecek: 0, kasaBanka: -5 })).toEqual([]);
    expect([haftaBasi('2026-11-01'), haftaBasi('2026-10-26')]).toEqual(['2026-10-26', '2026-10-26']);
  });

  it('mükerrer fatura: biçimi farklı aynı numara, numarasızda aynı gün aynı tutar', () => {
    expect(faturaNoAnahtari('ABC-2026/0012')).toBe(faturaNoAnahtari('abc 2026 12'));
    const g = (id: string, cariId: string, faturaNo: string | null, tarih: string, toplam: number) => ({ id, cariId, cariAdi: 'Şahin', faturaNo, tarih, toplam });
    const l = mukerrerFaturalar([
      g('1', 'c1', 'ABC-0012', '2026-10-01', 100),
      g('2', 'c1', 'abc 12', '2026-10-05', 100),
      g('3', 'c2', 'ABC-0012', '2026-10-01', 100), // başka cari
      g('4', 'c1', null, '2026-10-07', 500),
      g('5', 'c1', null, '2026-10-07', 500),
      g('6', 'c1', null, '2026-10-08', 500), // başka gün
    ]);
    expect(l.map((x) => [x.anahtar, x.yol])).toEqual([
      ['mukerrer_fatura:1,2', 'giderler/2'],
      ['mukerrer_fatura:4,5', 'giderler/5'],
    ]);
  });

  it('gruplar: yetki, gizleme/erteleme, önem sırası, rozet', () => {
    const yetkiler = new Set<Yetki>(['gider']);
    const g = gruplariOlustur(
      { kalemsiz_gider: [oge('a'), oge('b')], geciken_odeme: [oge('c')], hakedis_onayi: [oge('d')], bekleyen_belge: [oge('e')] },
      (y) => yetkiler.has(y),
      { a: 'hep', c: '2026-11-05' },
      '2026-10-29',
    );
    // hakediş onayı 'sozlesme' ister; belge herkese açık; c ertelendi, a gizlendi.
    expect(g.map((x) => [x.kod, x.onem, x.baslik, x.ogeler.length])).toEqual([
      ['bekleyen_belge', 'uyari', '1 belge onay bekliyor', 1],
      ['kalemsiz_gider', 'bilgi', '1 giderin maliyet kalemi seçilmemiş', 1],
    ]);
    expect(rozetSayisi(g)).toBe(1);
    // Ertelemenin günü gelince yeniden görünür.
    expect(gruplariOlustur({ geciken_odeme: [oge('c')] }, hepsi, { c: '2026-11-05' }, '2026-11-05').length).toBe(1);
    expect(gizlemeyiTemizle({ a: 'hep', b: '2026-10-01', c: '2026-12-01' }, '2026-10-29')).toEqual({ a: 'hep', c: '2026-12-01' });
  });
});

describe('tamamlanacak işler (kayıtlardan)', () => {
  let depo: Depo;
  let oturum: Oturum;
  let servis: KayitServisi;
  beforeEach(async () => {
    depo = await veriKatmaniniAc(`test-${yeniId()}`);
    oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Y' });
    servis = new KayitServisi(depo, oturum);
  });
  afterEach(() => depo.kapat());

  it('gecikmiş ödeme, nakit açığı, kalemsiz/vadesiz/taramasız gider, mükerrer, dekontsuz ödeme', async () => {
    const demirci = await cariOlustur(depo, servis, { ad: 'Şahin Demir', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    const banka = await hesapOlustur(depo, servis, { ad: 'Ziraat', tur: 'banka', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(1_000), tarih: '2026-09-01' });
    const satir = (tutar: number) => [{ kalemId: null, aciklama: 'Ø12 demir', miktar: null, birim: null, tutar, kdvDahil: false, kdvOrani: 0, tevkifat: null }];
    const g = (vade: string | null, tutar: number, no: string | null, tarih = '2026-10-01') =>
      giderOlustur(depo, servis, { tarih, projeId: null, cariId: demirci.id, faturaNo: no, vadeTarihi: vade, aciklama: '', satirlar: satir(tutar) });
    const gecikmis = await g('2026-10-20', TL(5_000), 'F1');
    await g(null, TL(2_000), null, '2026-10-10');
    await g(null, TL(2_000), null, '2026-10-10');
    await odemeYap(depo, servis, { tarih: '2026-10-25', cariId: demirci.id, hesapId: banka.id, tutar: TL(500), aciklama: '', dagitim: [] });

    const firma = (await depo.getir('firma', oturum.firmaId))!;
    const gruplar = await yapilacaklariGetir(depo, firma, '2026-10-29', null, hepsi, {});
    const ozet = Object.fromEntries(gruplar.map((x) => [x.kod, x.ogeler.length]));
    expect(ozet).toMatchObject({ nakit_acigi: 1, geciken_odeme: 1, mukerrer_fatura: 1, kalemsiz_gider: 3, vadesiz_borc: 2, taramasiz_fatura: 1, dekontsuz_odeme: 1 });
    expect(gruplar[0]!.kod).toBe('nakit_acigi');
    expect(gruplar.find((x) => x.kod === 'geciken_odeme')!.ogeler[0]!.yol).toBe(`giderler/${gecikmis.id}`);

    // Yalnız gider yetkisi: ödeme/kasa kuralları görünmez.
    const sinirli = await yapilacaklariGetir(depo, firma, '2026-10-29', null, (y) => y === 'gider', {});
    expect(sinirli.map((x) => x.kod)).not.toContain('dekontsuz_odeme');
    expect(sinirli.map((x) => x.kod)).not.toContain('nakit_acigi');
  });
});
