import { describe, expect, it } from 'vitest';
import { arsaSahibiYukumlulukleri, ayEkle, teslimTarihiHesapla, vadeDurumu, type YukumlulukGirdisi } from './katKarsiligi';

const TL = (n: number) => n * 100;

describe('tarih', () => {
  it('ay ekleme ayın son gününe sığar', () => {
    expect(ayEkle('2026-01-31', 1)).toBe('2026-02-28');
    expect(ayEkle('2026-03-15', 24)).toBe('2028-03-15');
    expect(ayEkle('2026-11-10', 3)).toBe('2027-02-10');
  });

  it('teslim: kesin tarih ya da ruhsattan X ay', () => {
    expect(teslimTarihiHesapla({ teslimTarihi: '2027-09-30', teslimSuresiAy: null }, null)).toBe('2027-09-30');
    expect(teslimTarihiHesapla({ teslimTarihi: '2027-09-30', teslimSuresiAy: 24 }, '2026-04-10')).toBe('2028-04-10');
    expect(teslimTarihiHesapla({ teslimTarihi: null, teslimSuresiAy: 24 }, null)).toBeNull();
  });

  it('vade durumu', () => {
    expect(vadeDurumu('2026-09-30', '2026-10-03')).toBe('gecti');
    expect(vadeDurumu('2026-10-20', '2026-10-03')).toBe('yaklasiyor');
    expect(vadeDurumu('2026-12-20', '2026-10-03')).toBe('ileride');
    expect(vadeDurumu(null, '2026-10-03')).toBe('kosullu');
  });
});

describe('arsa sahibi yükümlülükleri', () => {
  const sahip = (ek = {}) => ({ cariId: 'ahmet', hisse: 100, kiraAylik: TL(15_000), kiraBaslangic: '2026-03-01', teslimAlindi: null, ...ek });
  const girdi = (ek: Partial<YukumlulukGirdisi> = {}): YukumlulukGirdisi => ({
    sozlesme: { arsaSahipleri: [sahip()], gecikmeCezasi: null },
    plan: [
      { cariId: 'ahmet', vadeTarihi: '2026-04-15', kosul: '', tutar: TL(500_000), aciklama: 'Peşinat', iptal: null },
      { cariId: 'ahmet', vadeTarihi: null, kosul: 'Ruhsat alınınca', tutar: TL(500_000), aciklama: '', iptal: null },
    ],
    odenen: new Map([['ahmet', TL(605_000)]]),
    daireSayisi: new Map([['ahmet', 6]]),
    teslim: '2027-09-30',
    bugun: '2026-10-03',
    ...ek,
  });

  it('kira bugüne kadar başlamış aylar; ödenen vadelere tarih sırasıyla dağıtılır', () => {
    const [y] = arsaSahibiYukumlulukleri(girdi());
    expect(y!.kiraAy).toBe(8); // Mart–Ekim
    expect(y!.kiraDogan).toBe(TL(120_000));
    expect(y!.nakitToplam).toBe(TL(1_000_000));
    expect(y!.kalan).toBe(TL(1_120_000 - 605_000));
    // Mart+Nisan kirası, peşinat, Mayıs–Ekim kirası = 15+15+500+90 = 620 bin vadesi gelmiş; 605 ödendi.
    expect(y!.vadesiGecen).toBe(TL(15_000));
    // Teslime kadar (Eylül 2027) tahmini kira: Mart 2026 – Eylül 2027 = 19 ay.
    expect(y!.kiraTahmini).toBe(TL(19 * 15_000));
    expect(y!.vadeler.find((v) => v.vade === null)).toMatchObject({ kalan: TL(500_000), aciklama: 'Ruhsat alınınca' });
  });

  it('teslim alınınca kira durur; iptal plan satırı sayılmaz', () => {
    const g = girdi({ sozlesme: { arsaSahipleri: [sahip({ teslimAlindi: '2026-06-01' })], gecikmeCezasi: null } });
    g.plan[1] = { ...g.plan[1]!, iptal: { zaman: '', kullaniciId: '', gerekce: '' } };
    const [y] = arsaSahibiYukumlulukleri(g);
    expect(y!.kiraAy).toBe(3); // Mart, Nisan, Mayıs
    expect(y!.kiraTahmini).toBe(TL(45_000));
    expect(y!.nakitToplam).toBe(TL(500_000));
  });

  it('gecikme cezası teslimden sonraki tam aylar, daire başı; kalana girmez', () => {
    const g = girdi({
      teslim: '2026-06-30',
      sozlesme: { arsaSahipleri: [sahip()], gecikmeCezasi: { tutar: TL(25_000), birim: 'daire_ay' } },
    });
    const [y] = arsaSahibiYukumlulukleri(g);
    expect(y!.cezaAy).toBe(3); // 30.07, 30.08, 30.09
    expect(y!.cezaDogan).toBe(TL(3 * 25_000 * 6));
    expect(y!.kalan).toBe(TL(1_000_000 + 120_000 - 605_000));
    const toplam = arsaSahibiYukumlulukleri({ ...g, sozlesme: { ...g.sozlesme, gecikmeCezasi: { tutar: TL(50_000), birim: 'ay' } } });
    expect(toplam[0]!.cezaDogan).toBe(TL(150_000));
  });
});
