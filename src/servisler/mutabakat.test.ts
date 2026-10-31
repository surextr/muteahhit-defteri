import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { farkAdaylari, mutabakatMesaji } from '../hesap/mutabakat';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Firma } from '../veri/tipler';
import { cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { hesapOlustur } from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import {
  acikMutabakatlar,
  mutabakatAyrintisi,
  mutabakatCozuldu,
  mutabakatGonderildi,
  mutabakatHazirla,
  mutabakatListesi,
  mutabakatYaniti,
} from './mutabakat';
import { odemeYap } from './odeme';
import { yapilacaklariGetir } from './yapilacaklar';

const TL = (n: number) => Math.round(n * 100);

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let firma: Firma;
beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Y' });
  servis = new KayitServisi(depo, oturum);
  firma = (await depo.getir('firma', oturum.firmaId))!;
});
afterEach(() => depo.kapat());

describe('cari mutabakatı', () => {
  it('bakiye tarihte, yanıt, fark adayı, çözüm; sonraki mutabakat dökümü önceki mutabıktan başlar', async () => {
    const c = await cariOlustur(depo, servis, { ad: 'Yıldız Hırdavat', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    const kasa = await hesapOlustur(depo, servis, { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null }, { tutar: TL(100_000), tarih: '2026-01-01' });
    const satir = (tutar: number) => [{ kalemId: null, aciklama: 'malzeme', miktar: null, birim: null, tutar: TL(tutar), kdvDahil: true, kdvOrani: 0, tevkifat: null }];
    await giderOlustur(depo, servis, { tarih: '2026-09-05', projeId: null, cariId: c.id, faturaNo: 'F1', vadeTarihi: null, aciklama: '', satirlar: satir(30_000) });
    await odemeYap(depo, servis, { tarih: '2026-09-20', cariId: c.id, hesapId: kasa.id, tutar: TL(12_000), aciklama: 'havale', dagitim: [] });
    await giderOlustur(depo, servis, { tarih: '2026-10-10', projeId: null, cariId: c.id, faturaNo: 'F2', vadeTarihi: null, aciklama: '', satirlar: satir(5_000) });

    const m = await mutabakatHazirla(depo, servis, c.id, '2026-09-30');
    expect(m).toMatchObject({ bakiye: TL(18_000), donemBaslangic: null });
    await expect(mutabakatHazirla(depo, servis, c.id, '2026-09-30')).rejects.toThrow('zaten');
    await mutabakatGonderildi(depo, servis, m.id, '2026-10-01');
    // Ödememizi işlememişler: onlara göre borcumuz 30.000.
    await expect(mutabakatYaniti(depo, servis, m.id, { tarih: '2026-10-05', mutabik: false, karsiBakiye: null, not: '' })).rejects.toThrow('bakiyeyi');
    await mutabakatYaniti(depo, servis, m.id, { tarih: '2026-10-05', mutabik: false, karsiBakiye: TL(30_000), not: 'Ekstreleri ekte' });
    let a = (await mutabakatAyrintisi(depo, firma, m.id))!;
    expect(a).toMatchObject({ durum: 'farkli', fark: TL(12_000), guncelBakiye: TL(18_000) });
    expect(a.adaylar.map((x) => [x.hareket.tur, x.neden.startsWith('Bu kayıt karşı tarafta olmayabilir')])).toEqual([['odeme', true]]);
    expect(a.mektup.maddeler[0]!.paragraflar[0]).toContain('18.000,00 alacak');
    expect(a.mektup.maddeler[1]!.tablo!.satirlar).toHaveLength(2);

    // Yapılacaklar: fark var.
    const kodlar = async (gun: string) => (await yapilacaklariGetir(depo, firma, gun, null, () => true, {})).map((x) => x.kod);
    expect(await kodlar('2026-10-06')).toContain('mutabakat_farkli');
    await expect(mutabakatCozuldu(depo, servis, m.id, '2026-10-07', ' ')).rejects.toThrow('neden');
    await mutabakatCozuldu(depo, servis, m.id, '2026-10-07', 'Dekont gönderildi, işlediler.');
    expect((await acikMutabakatlar(depo, oturum.firmaId, '2026-10-07')).farkli).toHaveLength(0);

    // Sonraki mutabakat: döküm 1 Ekim'den, devir 18.000.
    const m2 = await mutabakatHazirla(depo, servis, c.id, '2026-10-31');
    expect(m2).toMatchObject({ bakiye: TL(23_000), donemBaslangic: '2026-10-01' });
    a = (await mutabakatAyrintisi(depo, firma, m2.id))!;
    expect([a.devir, a.hareketler.length]).toEqual([TL(18_000), 1]);
    await mutabakatGonderildi(depo, servis, m2.id, '2026-11-01');
    expect((await acikMutabakatlar(depo, oturum.firmaId, '2026-11-20')).yanitsiz.map((x) => x.id)).toEqual([m2.id]);
    // Aynı bakiye yazılırsa mutabık sayılır.
    expect((await mutabakatYaniti(depo, servis, m2.id, { tarih: '2026-11-21', mutabik: false, karsiBakiye: TL(23_000), not: '' })).yanit!.mutabik).toBe(true);

    const l = await mutabakatListesi(depo, oturum.firmaId, '2026-10-31');
    expect(l.map((x) => [x.cari.ad, x.bakiye, x.sonDurum])).toEqual([['Yıldız Hırdavat', TL(23_000), 'mutabik']]);
    expect(mutabakatMesaji({ cariAdi: 'Yıldız', firmaAdi: 'Sürex', tarih: '2026-10-31', bakiye: TL(23_000) })).toContain('firmamızın size borcu ₺23.000,00');
  });

  it('fark adayı: fatura onlarda yoksa', () => {
    const h = { tur: 'gider' as const, tarih: '2026-10-01', kayitTur: 'gider' as const, kayitId: 'g', olusturmaZamani: '', tutar: TL(5_000), aciklama: '', bakiye: TL(5_000) };
    // Onlara göre borcumuz 5.000 eksik → fark −5.000; faturamız onlarda yok.
    expect(farkAdaylari([h], TL(-5_000))[0]!.neden).toContain('faturasını kaydetmemiş');
    expect(farkAdaylari([h], TL(-7_000))).toEqual([]);
  });
});
