import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { haftaMetni, nakitTahmini, plandanBorcuDus, type NakitKalemi } from '../hesap/nakitTahmini';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { cariOlustur } from './cari';
import { cekAl } from './cek';
import { giderOlustur } from './gider';
import { hesapOlustur } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { nakitKalemleri } from './nakitTahmini';

const TL = (n: number) => Math.round(n * 100);
const k = (yon: 'giris' | 'cikis', tarih: string | null, tutar: number, kaynak: NakitKalemi['kaynak'] = yon === 'giris' ? 'alacak' : 'fatura'): NakitKalemi => ({
  yon,
  kaynak,
  tarih,
  tutar: TL(tutar),
  baslik: '',
  ayrinti: '',
  yol: '',
});

describe('nakit tahmini (saf)', () => {
  const bugun = '2026-10-29';
  it('haftalara dağıtır; gecikmiş ve vadesiz çıkış başlangıçtan düşer; ilk açık hafta', () => {
    const t = nakitTahmini(
      [
        k('cikis', '2026-10-01', 100), // gecikmiş
        k('cikis', null, 50), // vadesiz
        k('giris', '2026-10-15', 400), // gecikmiş tahsilat: varsayılan sayılmaz
        k('cikis', '2026-10-29', 200), // 1. hafta
        k('giris', '2026-11-05', 300), // 2. hafta (8. gün)
        k('cikis', '2026-11-20', 900, 'sozlesme_plani'), // 4. hafta, planlı
        k('cikis', '2027-06-01', 1000), // ufuk dışı
      ],
      TL(500),
      bugun,
    );
    expect(t.baslangic).toBe(TL(350));
    expect(t.haftalar.slice(0, 4).map((h) => [h.baslangic, h.giris / 100, h.cikis / 100, h.birikimli / 100])).toEqual([
      ['2026-10-29', 0, 200, 150],
      ['2026-11-05', 300, 0, 450],
      ['2026-11-12', 0, 0, 450],
      ['2026-11-19', 0, 900, -450],
    ]);
    expect(t.ilkAcik?.no).toBe(4);
    expect(t.enDusuk.tutar).toBe(TL(-450));
    expect(t.planliCikis).toBe(TL(900));
    expect(t.sonrasi.cikis).toBe(TL(1000));

    // Planlılar sayılmazsa açık yok; gecikmiş tahsilat sayılırsa başlangıç artar.
    expect(nakitTahmini([k('cikis', '2026-11-20', 900, 'sozlesme_plani')], TL(500), bugun, { planli: false }).ilkAcik).toBeNull();
    expect(nakitTahmini([k('giris', '2026-10-15', 400)], TL(500), bugun, { gecikmisTahsilat: true }).baslangic).toBe(TL(900));
    expect([haftaMetni({ no: 1, baslangic: bugun }), haftaMetni({ no: 2, baslangic: '2026-11-05' }), haftaMetni({ no: 4, baslangic: '2026-11-19' })]).toEqual([
      'bu hafta (7 gün)',
      'gelecek hafta',
      '19 Kasım haftası',
    ]);
  });

  it('plan satırlarından kayıtlı borç en eski vadeden düşülür', () => {
    const p = plandanBorcuDus(
      [
        { tarih: '2026-12-01', tutar: 300 },
        { tarih: '2026-11-01', tutar: 200 },
        { tarih: '2027-01-01', tutar: 300 },
      ],
      350,
    );
    expect(p).toEqual([
      { tarih: '2026-12-01', tutar: 150 },
      { tarih: '2027-01-01', tutar: 300 },
    ]);
  });
});

describe('nakit tahmini (kayıtlardan)', () => {
  let depo: Depo;
  let oturum: Oturum;
  let servis: KayitServisi;
  beforeEach(async () => {
    depo = await veriKatmaniniAc(`test-${yeniId()}`);
    oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Y' });
    servis = new KayitServisi(depo, oturum);
  });
  afterEach(() => depo.kapat());

  it('kasa + banka, vadeli/vadesiz fatura, alınan çek', async () => {
    const c = await cariOlustur(depo, servis, { ad: 'Şahin Demir', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await hesapOlustur(depo, servis, { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(1_000), tarih: '2026-09-01' });
    const satir = (tutar: number) => [{ kalemId: null, aciklama: 'demir', miktar: null, birim: null, tutar, kdvDahil: false, kdvOrani: 0, tevkifat: null }];
    await giderOlustur(depo, servis, { tarih: '2026-10-01', projeId: null, cariId: c.id, faturaNo: 'F1', vadeTarihi: '2026-11-20', aciklama: '', satirlar: satir(TL(3_000)) });
    await giderOlustur(depo, servis, { tarih: '2026-10-01', projeId: null, cariId: c.id, faturaNo: 'F2', vadeTarihi: null, aciklama: '', satirlar: satir(TL(200)) });
    await cekAl(depo, servis, { tur: 'cek', cariId: c.id, tarih: '2026-10-01', vadeTarihi: '2026-11-10', tutar: TL(1_500), banka: 'Akbank', sube: null, seriNo: 'X1', kesideci: null, projeId: null, aciklama: '' });

    const n = await nakitKalemleri(depo, oturum.firmaId, '2026-10-29', null);
    expect(n.kasaBanka).toBe(TL(1_000));
    expect(n.kalemler.map((x) => [x.kaynak, x.yon, x.tarih, x.tutar / 100]).sort()).toEqual([
      ['alinan_cek', 'giris', '2026-11-10', 1500],
      ['fatura', 'cikis', null, 200],
      ['fatura', 'cikis', '2026-11-20', 3000],
    ]);
    const t = nakitTahmini(n.kalemler, n.kasaBanka, '2026-10-29');
    expect(t.baslangic).toBe(TL(800));
    expect(t.ilkAcik?.baslangic).toBe('2026-11-19');
    expect(t.enDusuk.tutar).toBe(TL(-700));
  });
});
