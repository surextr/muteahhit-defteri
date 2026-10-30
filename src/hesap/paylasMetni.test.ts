import { describe, expect, it } from 'vitest';
import { whatsappBaglantisi, whatsappNumarasi } from '../cihaz/paylas';
import { ekstreMesaji, taksitHatirlatmasi } from './paylasMetni';

describe('WhatsApp mesajları', () => {
  it('numara biçimleri ve bağlantı', () => {
    expect(['0532 123 45 67', '+90 (532) 123-4567', '5321234567', '242 000', null].map(whatsappNumarasi)).toEqual(['905321234567', '905321234567', '905321234567', null, null]);
    expect(whatsappBaglantisi('05321234567', 'a b')).toBe('https://wa.me/905321234567?text=a%20b');
    expect(whatsappBaglantisi(null, 'x')).toBe('https://wa.me/?text=x');
  });
  it('ekstre özeti ve taksit hatırlatması', () => {
    expect(ekstreMesaji({ cariAdi: 'Ali', firmaAdi: 'Sürex', bugun: '2026-10-31', bakiye: -150000, sonHareketler: [{ tarih: '2026-10-01', ad: 'Fatura', tutar: 150000 }] })).toBe(
      'Sayın Ali,\n31.10.2026 itibarıyla cari hesabınızda bize borcunuz ₺1.500,00.\n\nSon hareketler:\n• 01.10.2026 Fatura: ₺1.500,00\n\nSürex',
    );
    const m = taksitHatirlatmasi({
      musteriAdi: 'Ayşe',
      firmaAdi: 'Sürex',
      bolum: 'A-5',
      bugun: '2026-10-31',
      acik: [
        { vade: '2026-10-01', ad: 'Taksit 1', kalan: 10000000 },
        { vade: '2026-11-01', ad: 'Taksit 2', kalan: 10000000 },
      ],
    });
    expect(m).toContain('vadesi geçmiş ödeme:\n• Taksit 1 (01.10.2026): ₺100.000,00');
    expect(m).toContain('Sıradaki ödeme: Taksit 2, 01.11.2026 vadeli ₺100.000,00.');
  });
});
