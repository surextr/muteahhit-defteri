import { describe, expect, it } from 'vitest';
import { dekontYonu, yzFaturasi, yzOnerisi, yzSozlesmeCevir, yzTaniCevir } from './yzOkuma';

describe('yapay zekâ yanıtı', () => {
  it('fiş: tür, satıcı, KDV dökümü; bozuk alanlar atılır', () => {
    const { okuma, fatura } = yzTaniCevir(
      {
        tur: 'fis',
        guven: 'yuksek',
        ozet: 'Hırdavat fişi',
        fatura: {
          satici_unvan: '  Yıldız Hırdavat ',
          satici_vkn: '123 456 7890',
          tarih: '29.10.2026',
          para_birimi: 'TL',
          kdvler: [{ oran: 20, matrah: '375,00', kdv: 75 }, { oran: 'x' }],
          odenecek: 450,
          satirlar: [{ ad: 'Vida', tutar: 'yok' }],
        },
        dekont: 'saçma',
        bilinmeyen: 1,
      },
      '2026-10-29T10:00:00Z',
    );
    expect(okuma).toMatchObject({ tur: 'fis', guven: 'yuksek', ozet: 'Hırdavat fişi', dekont: null, cek: null, sozlesme: null });
    expect(fatura).toMatchObject({
      kaynak: 'yz',
      satici: { ad: 'Yıldız Hırdavat', vergiNo: '1234567890' },
      tarih: '2026-10-29',
      paraBirimi: 'TRY',
      kdvler: [{ oran: 20, matrah: 37500, kdv: 7500 }],
      odenecek: 45000,
      satirlar: [],
    });
  });

  it('bilinmeyen tür "diger", tutar okunamayan fatura null; öneriler', () => {
    const { okuma, fatura } = yzTaniCevir({ tur: 'uzay', fatura: { satici_unvan: 'X' } }, 'z');
    expect(okuma.tur).toBe('diger');
    expect(okuma.guven).toBe('dusuk');
    expect(fatura).toBeNull();
    expect(yzFaturasi(null)).toBeNull();
    expect(yzOnerisi({ ...okuma, tur: 'tapu' })).toBe('proje');
    expect(yzOnerisi({ ...okuma, tur: 'senet' })).toBe('cek');
  });

  it('dekont yönü IBAN ya da firma adından', () => {
    const { okuma } = yzTaniCevir(
      { tur: 'dekont', dekont: { tarih: '2026-10-28', tutar: '-15.000,00', gonderen_ad: 'SÜREX İNŞAAT', alici_ad: 'Ali Demir', alici_iban: 'TR33 0006 1005 1978 6457 8413 26' } },
      'z',
    );
    expect(okuma.dekont).toMatchObject({ tutar: 1500000, aliciIban: 'TR330006100519786457841326', gonderenIban: null });
    expect(dekontYonu(okuma.dekont!, 'Sürex İnşaat Ltd.', [])).toBe('odeme');
    expect(dekontYonu(okuma.dekont!, 'Başka', ['TR33 0006 1005 1978 6457 8413 26'])).toBe('tahsilat');
    expect(dekontYonu(okuma.dekont!, 'Başka', [])).toBeNull();
  });

  it('usta sözleşmesi: kalemler, şartlar, ödeme planı, eksikler', () => {
    const s = yzSozlesmeCevir({
      tur: 'usta',
      tarih: '2025-03-01',
      karsi_taraf: { ad: 'Mehmet Kaya', tc_vkn: '12345678901', telefon: '0532 111 22 33' },
      usta: {
        isler: ['Sıva', '', null],
        kalemler: [{ is: 'Sıva', ad: 'İç sıva', birim: 'm²', miktar: '1.200', birim_fiyat: '85,50' }, { ad: '' }],
        teminat_orani: 5,
        ozel_sartlar: ['İskele müteahhide aittir.'],
        odeme_plani: [{ vade: '2025-04-01', tutar: 50000 }, {}],
      },
      eksikler: ['Bitiş tarihi yazılmamış.'],
    });
    expect(s).toMatchObject({
      tur: 'usta',
      tarih: '2025-03-01',
      karsiTaraf: { ad: 'Mehmet Kaya', no: '12345678901' },
      usta: {
        isler: ['Sıva'],
        kalemler: [{ is: 'Sıva', ad: 'İç sıva', birim: 'm²', miktar: 1200, birimFiyat: 8550 }],
        teminatOrani: 5,
        ozelSartlar: ['İskele müteahhide aittir.'],
        odemePlani: [{ vade: '2025-04-01', tutar: 5000000, aciklama: '' }],
      },
      katKarsiligi: null,
      satis: null,
      eksikler: ['Bitiş tarihi yazılmamış.'],
    });
  });

  it('kat karşılığı ve satış', () => {
    const k = yzSozlesmeCevir({
      tur: 'kat_karsiligi',
      kat_karsiligi: { arsa_sahipleri: [{ ad: 'Ayşe', tc: '11111111111', hisse: 50 }, { ad: 'Fatma', hisse: '50' }], arsa_sahibi_orani: 45, gecikme_cezasi: { tutar: 10000, birim: 'gunluk' } },
    });
    expect(k.katKarsiligi).toMatchObject({ arsaSahibiOrani: 45, arsaSahipleri: [{ ad: 'Ayşe', no: '11111111111', hisse: 50 }, { ad: 'Fatma', no: null, hisse: 50 }], gecikmeCezasi: { tutar: 1000000, birim: 'gunluk' } });
    const s = yzSozlesmeCevir({ tur: 'satis', satis: { blok: 'A', daire_no: '7', fiyat: '3.500.000', plan: [{ tur: 'pesinat', vade: '2026-01-01', tutar: 1000000 }, { tur: 'x', tutar: 500000 }, { tutar: null }] } });
    expect(s.satis).toMatchObject({ blok: 'A', daireNo: '7', fiyat: 350000000, plan: [{ tur: 'pesinat', tutar: 100000000 }, { tur: 'taksit', vade: null, tutar: 50000000 }] });
  });
});
