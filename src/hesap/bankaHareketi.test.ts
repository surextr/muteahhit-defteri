import { describe, expect, it } from 'vitest';
import { bankaBasligiBul, bankaHareketleri, cariOner, kayitliOlanlar, tarihOku, turOner } from './bankaHareketi';
import { csvOku } from './tabloOku';

describe('banka hareketleri dosyası', () => {
  it('borç/alacak sütunlu ekstre: başlık, tarih biçimleri, yön, bakiye', () => {
    const t = csvOku(
      [
        'ZİRAAT BANKASI HESAP HAREKETLERİ',
        'Hesap: TR00 0000;;;;',
        'İşlem Tarihi;Açıklama;Borç;Alacak;Bakiye',
        '01.10.2026 09:12;EFT AKDENİZ HAZIR BETON A.Ş. FATURA;25.000,00;;75.000,00',
        '02/10/2026;GELEN HAVALE AYŞE KAYA KAPORA;;50.000,00;125.000,00',
        '03.10.2026;HESAP İŞLETİM ÜCRETİ;-35,50;;124.964,50',
        'Toplam;;25.035,50;50.000,00;',
      ].join('\n'),
    );
    const b = bankaBasligiBul(t.satirlar)!;
    expect(b).toEqual({ satir: 2, sutunlar: { tarih: 0, aciklama: 1, borc: 2, alacak: 3, bakiye: 4 } });
    const h = bankaHareketleri(t.satirlar, b.satir, b.sutunlar);
    expect(h.map((x) => [x.tarih, x.tutar, x.bakiye])).toEqual([
      ['2026-10-01', -2500000, 7500000],
      ['2026-10-02', 5000000, 12500000],
      ['2026-10-03', -3550, 12496450],
    ]);
    expect(tarihOku(46296)).toBe('2026-10-01');
    expect(tarihOku('31.02.2026')).toBeNull();
  });

  it('tek tutar sütunu (işaretli); kayıtlı eşleşme ±3 gün, bir kez; cari ve tür önerisi', () => {
    const t = csvOku('Tarih,Açıklama,Tutar,Bakiye\n2026-10-05,Kart ödemesi,-120.00,1000\n2026-10-06,Virman,500,1500');
    const b = bankaBasligiBul(t.satirlar)!;
    const h = bankaHareketleri(t.satirlar, b.satir, b.sutunlar);
    expect(h.map((x) => x.tutar)).toEqual([-12000, 50000]);
    const k = kayitliOlanlar(h, [
      { id: 'a', tarih: '2026-10-08', tutar: -12000 },
      { id: 'b', tarih: '2026-10-20', tutar: 50000 },
    ]);
    expect([...k]).toEqual([[h[0]!.satirNo, 'a']]);
    const cariler = [
      { id: 'beton', ad: 'Akdeniz Hazır Beton A.Ş.' },
      { id: 'ayse', ad: 'Ayşe Kaya' },
      { id: 'insaat', ad: 'Yıldız İnşaat Ltd. Şti.' },
    ];
    expect(cariOner('EFT AKDENIZ HAZIR BETON AS FATURA 123', cariler)).toBe('beton');
    expect(cariOner('GELEN HAVALE AYSE KAYA', cariler)).toBe('ayse');
    expect(cariOner('İNŞAAT MALZEMESİ', cariler)).toBeNull();
    expect(turOner({ aciklama: 'HESAP İŞLETİM ÜCRETİ', tutar: -3550 }, false, false)).toBe('masraf');
    expect(turOner({ aciklama: 'KREDİ TAKSİT TAHSİLATI', tutar: -100 }, false, true)).toBe('kredi');
    expect(turOner({ aciklama: 'x', tutar: 100 }, true, false)).toBe('tahsilat');
    expect(turOner({ aciklama: 'Virman', tutar: 100 }, false, false)).toBe('transfer');
  });
});
