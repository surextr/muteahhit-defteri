import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vadeleriGrupla, vadeMetni } from '../hesap/bugun';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { genelArama } from './arama';
import { bugunOzeti } from './bugun';
import { cariOlustur } from './cari';
import { cekAl } from './cek';
import { giderOlustur } from './gider';
import { hesapOlustur } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Y' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

const satir = (tutar: number) => [{ kalemId: null, aciklama: 'Ø12 demir', miktar: null, birim: null, tutar, kdvDahil: false, kdvOrani: 0, tevkifat: null }];

describe('bugün', () => {
  it('vade grupları ve metinleri', () => {
    const k = (id: string, vade: string, tutar = 100) => ({ tur: 'odenecek_fatura' as const, id, vade, tutar, baslik: '', ayrinti: '', yol: '' });
    const g = vadeleriGrupla([k('a', '2026-10-01'), k('b', '2026-10-29'), k('c', '2026-11-05'), k('d', '2026-11-06'), k('e', '2026-10-02', 0)], '2026-10-29');
    expect(g.gecikmis.map((x) => x.id)).toEqual(['a']);
    expect(g.yaklasan.map((x) => x.id)).toEqual(['b', 'c']);
    expect([vadeMetni('2026-10-29', '2026-10-29'), vadeMetni('2026-10-30', '2026-10-29'), vadeMetni('2026-10-26', '2026-10-29'), vadeMetni('2026-11-02', '2026-10-29')]).toEqual([
      'bugün',
      'yarın',
      '3 gün geçti',
      '4 gün sonra',
    ]);
  });

  it('ödenmemiş faturalar, açık çekler ve kasa; vadesiz ayrı; arama', async () => {
    const demirci = await cariOlustur(depo, servis, { ad: 'Şahin Demir', roller: ['tedarikci'], telefon: '05321234567', vergiNo: null, adres: null, not: '' });
    await hesapOlustur(depo, servis, { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null });
    const g = (vade: string | null, tutar: number, no: string) =>
      giderOlustur(depo, servis, { tarih: '2026-10-01', projeId: null, cariId: demirci.id, faturaNo: no, vadeTarihi: vade, aciklama: '', satirlar: satir(tutar) });
    await g('2026-10-20', 100_000, 'F1');
    await g('2026-11-01', 250_000, 'F2');
    await g(null, 50_000, 'F3');
    await cekAl(depo, servis, { tur: 'cek', cariId: demirci.id, tarih: '2026-10-01', vadeTarihi: '2026-10-31', tutar: 300_000, banka: 'Akbank', sube: null, seriNo: 'X9', kesideci: null, projeId: null, aciklama: '' });
    const o = await bugunOzeti(depo, oturum.firmaId, '2026-10-29', null);
    expect(o.vadeler.gecikmis.map((k) => [k.tur, k.tutar, k.ayrinti])).toEqual([['odenecek_fatura', 100_000, 'F1']]);
    expect(o.vadeler.yaklasan.map((k) => [k.tur, k.tutar])).toEqual([
      ['alinan_cek', 300_000],
      ['odenecek_fatura', 250_000],
    ]);
    expect(o.vadesizBorc).toEqual({ adet: 1, tutar: 50_000 });
    expect(o.hesaplar.map((h) => h.hesap.ad)).toEqual(['Kasa']);

    const ara = async (q: string) => (await genelArama(depo, oturum.firmaId, q, null)).map((s) => `${s.grup}: ${s.baslik}`);
    expect(await ara('sahin')).toEqual(expect.arrayContaining(['Cariler: Şahin Demir']));
    expect(await ara('F2')).toEqual(['Giderler: Şahin Demir · ₺2.500,00']);
    expect(await ara('2500')).toEqual(['Giderler: Şahin Demir · ₺2.500,00']);
    expect(await ara('1234567')).toEqual(['Cariler: Şahin Demir']);
    expect(await ara('x9')).toEqual(['Çek ve senetler: Şahin Demir · ₺3.000,00']);
    expect(await ara('a')).toEqual([]);
  });
});
