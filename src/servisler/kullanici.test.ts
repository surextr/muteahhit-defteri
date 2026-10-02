import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { cariOlustur } from './cari';
import { firmaGecmisiGetir, kayitEtiketi } from './gecmis';
import { KayitServisi, type Oturum } from './kayitServisi';
import { kullaniciEkle, kullaniciGuncelle, kullanicilariListele, rolDegistir, uyelikIptal } from './kullanici';
import { cihazKullanicisiniDegistir, ilkKurulum, oturumuYukle } from './kurulum';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Ali Yılmaz' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

const liste = async () => (await kullanicilariListele(depo, oturum.firmaId)).map((k) => [k.kullanici.ad, k.uyelik.rol]);

describe('kullanıcılar ve roller', () => {
  it('kullanıcı eklenir; yöneticiler önce listelenir', async () => {
    await kullaniciEkle(depo, servis, { ad: ' Ayşe  Kaya ', eposta: ' AYSE@ornek.com ' }, 'muhasebe');
    await kullaniciEkle(depo, servis, { ad: 'Mehmet Usta', eposta: null }, 'santiye');
    expect(await liste()).toEqual([
      ['Ali Yılmaz', 'yonetici'],
      ['Ayşe Kaya', 'muhasebe'],
      ['Mehmet Usta', 'santiye'],
    ]);
    const ayse = (await kullanicilariListele(depo, oturum.firmaId)).find((k) => k.kullanici.ad === 'Ayşe Kaya')!;
    expect(ayse.kullanici.eposta).toBe('ayse@ornek.com');
  });

  it.each([
    [{ ad: '', eposta: null }, 'adını yazın'],
    [{ ad: 'X', eposta: 'yanlis' }, 'E-posta'],
    [{ ad: 'ali  YILMAZ', eposta: null }, 'zaten var'],
  ])('hatalı girdi reddedilir: %#', async (g, mesaj) => {
    await expect(kullaniciEkle(depo, servis, g, 'santiye')).rejects.toThrow(mesaj);
  });

  it('ad değişir; geçmişe yazılır', async () => {
    const { kullanici } = await kullaniciEkle(depo, servis, { ad: 'Ayşe', eposta: null }, 'muhasebe');
    await kullaniciGuncelle(depo, servis, kullanici.id, { ad: 'Ayşe Kaya', eposta: null });
    const g = await depo.listele('islemGecmisi', { kayitId: kullanici.id });
    expect(g.find((x) => x.islem === 'guncelle')).toMatchObject({ eski: { ad: 'Ayşe' }, yeni: { ad: 'Ayşe Kaya' } });
  });

  it('son yönetici rolünü bırakamaz ve çıkarılamaz', async () => {
    const [ben] = await kullanicilariListele(depo, oturum.firmaId);
    await expect(rolDegistir(depo, servis, ben!.uyelik.id, 'muhasebe')).rejects.toThrow('en az bir yönetici');
    const ayse = await kullaniciEkle(depo, servis, { ad: 'Ayşe', eposta: null }, 'yonetici');
    await rolDegistir(depo, servis, ben!.uyelik.id, 'muhasebe');
    expect(await liste()).toEqual([
      ['Ayşe', 'yonetici'],
      ['Ali Yılmaz', 'muhasebe'],
    ]);
    // Ayşe'yi çıkarırsak yönetici kalmaz.
    await expect(uyelikIptal(depo, servis, ayse.uyelik.id)).rejects.toThrow('en az bir yönetici');
  });

  it('kendini çıkaramaz; başkası çıkarılınca listeden kalkar, geçmişteki adı korunur', async () => {
    const [ben] = await kullanicilariListele(depo, oturum.firmaId);
    await expect(uyelikIptal(depo, servis, ben!.uyelik.id)).rejects.toThrow('kendinizi');

    const mehmet = await kullaniciEkle(depo, servis, { ad: 'Mehmet', eposta: null }, 'santiye');
    const mehmetServis = new KayitServisi(depo, { ...oturum, kullaniciId: mehmet.kullanici.id });
    const cari = await cariOlustur(depo, mehmetServis, { ad: 'Kum Ocağı', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await uyelikIptal(depo, servis, mehmet.uyelik.id, 'İşten ayrıldı');
    expect(await liste()).toEqual([['Ali Yılmaz', 'yonetici']]);
    const { satirlar } = await firmaGecmisiGetir(depo, oturum.firmaId, { kullaniciId: mehmet.kullanici.id });
    expect(satirlar.find((s) => s.islem.kayitId === cari.id)?.kullaniciAdi).toBe('Mehmet');
  });

  it('cihazı kullanan kişi değişir; üye olmayana geçilemez', async () => {
    const ayse = await kullaniciEkle(depo, servis, { ad: 'Ayşe', eposta: null }, 'muhasebe');
    await cihazKullanicisiniDegistir(depo, oturum.firmaId, ayse.kullanici.id);
    expect((await oturumuYukle(depo))?.kullaniciId).toBe(ayse.kullanici.id);
    await expect(cihazKullanicisiniDegistir(depo, oturum.firmaId, 'yok')).rejects.toThrow('kullanıcısı değil');

    const mehmet = await kullaniciEkle(depo, servis, { ad: 'Mehmet', eposta: null }, 'santiye');
    await uyelikIptal(depo, servis, mehmet.uyelik.id);
    await expect(cihazKullanicisiniDegistir(depo, oturum.firmaId, mehmet.kullanici.id)).rejects.toThrow('kullanıcısı değil');
  });
});

describe('firma geçmişi', () => {
  it('en yeni önce; iptal, gerekçe, ana kayıt ve kullanıcı süzgeçleri', async () => {
    let saat = new Date('2030-01-01T09:00:00');
    const s = new KayitServisi(depo, oturum, () => saat);
    const cari = await cariOlustur(depo, s, { ad: 'Beton AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    saat = new Date('2030-01-03T09:00:00');
    await s.iptal('cari', cari.id, 'Yanlış açıldı');

    const hepsi = await firmaGecmisiGetir(depo, oturum.firmaId);
    expect(hepsi.satirlar[0]).toMatchObject({
      islem: { islem: 'iptal', kayitTur: 'cari', gerekce: 'Yanlış açıldı' },
      kullaniciAdi: 'Ali Yılmaz',
      etiket: { turAdi: 'Cari', ozet: 'Beton AŞ', yol: null, iptalEdildi: true },
    });

    const iptaller = await firmaGecmisiGetir(depo, oturum.firmaId, { islemler: ['iptal'] });
    expect(iptaller.satirlar.map((x) => x.islem.kayitId)).toEqual([cari.id]);
    expect((await firmaGecmisiGetir(depo, oturum.firmaId, { yalnizcaGerekceli: true })).toplam).toBe(1);
    expect((await firmaGecmisiGetir(depo, oturum.firmaId, { baslangic: '2030-01-02', bitis: '2030-01-03' })).toplam).toBe(1);
    expect((await firmaGecmisiGetir(depo, oturum.firmaId, { kullaniciId: 'baska' })).toplam).toBe(0);

    // Sayfa sınırı: toplam ayrıca verilir.
    const sayfa = await firmaGecmisiGetir(depo, oturum.firmaId, {}, 2);
    expect(sayfa.satirlar).toHaveLength(2);
    expect(sayfa.toplam).toBeGreaterThan(2);
  });

  it('bilinmeyen ya da okunamayan kayıt da gösterilir', async () => {
    expect(await kayitEtiketi(depo, 'cari', 'yok')).toEqual({ turAdi: 'Cari', ozet: null, yol: null });
    expect(await kayitEtiketi(depo, 'yedek', 'x')).toEqual({ turAdi: 'Yedekten geri yükleme', ozet: null, yol: null });
    expect((await kayitEtiketi(depo, 'gelecek', 'x')).turAdi).toBe('gelecek');
  });
});
