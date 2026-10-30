import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gunlukOzeti, puantajTutari } from '../hesap/gunluk';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, PuantajSatiri, Proje } from '../veri/tipler';
import { cariOlustur } from './cari';
import { giderIptal } from './gider';
import { gunlukGetir, gunlukKaydet, oncekiGunluk, projePuantaji, puantajGideriYaz } from './gunluk';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';
import { cariBakiyesiGetir } from './sorgular';

const TL = (n: number) => Math.round(n * 100);
let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let proje: Proje;
let ali: Cari;
let veli: Cari;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  proje = await projeOlustur(
    depo,
    servis,
    { ad: 'Güneş', il: null, ilce: null, mahalle: null, adres: '', parseller: [], arsaTipi: 'satin_alma', baslangicTarihi: null, planlananBitis: null, gerceklesenBitis: null, alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null } },
    [{ ...BOS_BLOK }],
  );
  ali = await cariOlustur(depo, servis, { ad: 'Ali', roller: ['usta'], telefon: null, vergiNo: null, adres: null, not: '' });
  veli = await cariOlustur(depo, servis, { ad: 'Veli', roller: ['usta'], telefon: null, vergiNo: null, adres: null, not: '' });
});
afterEach(() => depo.kapat());

const satir = (cariId: string, durum: PuantajSatiri['durum'], mesaiSaat = 0): PuantajSatiri => ({ id: yeniId(), cariId, durum, yevmiye: TL(1600), mesaiSaat, mesaiUcreti: null, giderId: null });
const gun = (puantaj: PuantajSatiri[]) => ({ hava: 'gunesli' as const, sicaklik: 18, calisilmadi: false, yapilanIsler: ' 3. kat kolon kalıbı ', ekipler: [{ id: 'e', cariId: null, ad: 'Kalıpçı ekibi', kisi: 6, is: 'kalıp' }], puantaj, sorunlar: '', not: '' });

describe('şantiye günlüğü ve puantaj', () => {
  it('yevmiye tutarı: tam, yarım, mesai (yevmiye/8 × 1,5)', () => {
    expect(puantajTutari(satir('a', 'tam'))).toBe(TL(1600));
    expect(puantajTutari(satir('a', 'yarim', 2))).toBe(TL(800) + 2 * TL(300));
    expect(puantajTutari(satir('a', 'yok'))).toBe(0);
    expect(gunlukOzeti(gun([satir('a', 'tam'), satir('b', 'yok')]))).toBe('☀️ 18° · 1 işçi · 1 ekip 6 kişi');
  });

  it('günde bir kayıt (güncellenir); ay özeti; gidere yazma; yazılan değiştirilemez; gider iptaliyle yeniden yazılır', async () => {
    const a1 = satir(ali.id, 'tam', 2);
    await gunlukKaydet(depo, servis, proje.id, '2026-11-02', gun([a1, satir(veli.id, 'yarim')]));
    const g2 = await gunlukKaydet(depo, servis, proje.id, '2026-11-03', gun([satir(ali.id, 'tam')]));
    await gunlukKaydet(depo, servis, proje.id, '2026-11-03', { ...gun([satir(ali.id, 'tam'), satir(veli.id, 'tam')]), sorunlar: 'Beton gecikti' });
    expect((await gunlukGetir(depo, oturum.firmaId, proje.id, '2026-11-03'))!).toMatchObject({ id: g2.id, sorunlar: 'Beton gecikti', yapilanIsler: '3. kat kolon kalıbı' });
    expect((await oncekiGunluk(depo, oturum.firmaId, proje.id, '2026-11-03'))!.tarih).toBe('2026-11-02');
    await expect(gunlukKaydet(depo, servis, proje.id, '2026-11-04', gun([satir(ali.id, 'tam'), satir(ali.id, 'tam')]))).rejects.toThrow('iki kez');

    const ozet = await projePuantaji(depo, oturum.firmaId, proje.id, '2026-11');
    const aliOzet = ozet.find((k) => k.cariId === ali.id)!;
    expect(aliOzet).toMatchObject({ gun: 2, mesaiSaat: 2, tutar: TL(3200 + 600), yazilmamisTutar: TL(3800) });

    const gider = await puantajGideriYaz(depo, servis, { projeId: proje.id, cariId: ali.id, ay: '2026-11', kalemId: null, tarih: '2026-11-15' });
    expect(gider).toMatchObject({ cariId: ali.id, toplam: TL(3800), aciklama: 'Yevmiye 02.11–03.11: 2 gün + 2 saat mesai' });
    expect(await cariBakiyesiGetir(depo, oturum.firmaId, ali.id)).toBe(TL(3800));
    expect((await projePuantaji(depo, oturum.firmaId, proje.id, '2026-11')).find((k) => k.cariId === ali.id)!.yazilmamisTutar).toBe(0);
    await expect(puantajGideriYaz(depo, servis, { projeId: proje.id, cariId: ali.id, ay: '2026-11', kalemId: null, tarih: '2026-11-15' })).rejects.toThrow('yevmiye yok');
    await expect(gunlukKaydet(depo, servis, proje.id, '2026-11-02', gun([{ ...a1, durum: 'yarim' }]))).rejects.toThrow('Gidere yazılmış');

    await giderIptal(depo, servis, gider.id, 'yanlış');
    expect((await projePuantaji(depo, oturum.firmaId, proje.id, '2026-11')).find((k) => k.cariId === ali.id)!.yazilmamisTutar).toBe(TL(3800));
    await gunlukKaydet(depo, servis, proje.id, '2026-11-02', gun([{ ...a1, durum: 'yarim' }]));
  });
});
