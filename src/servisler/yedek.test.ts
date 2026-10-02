import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc, yedekArsiviniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { ARSIV_SINIRI, type YedekArsivi } from '../veri/yedekArsivi';
import { KayitServisi, type Oturum } from './kayitServisi';
import { cihazKimligi, ilkKurulum, oturumuYukle } from './kurulum';
import {
  META_SON_YEDEK,
  arsiveKaydet,
  elleYedekAl,
  geriYukle,
  yedegiCoz,
  yedekMetni,
  yedekOlustur,
  yedekOzeti,
} from './yedek';

const acik: { kapat(): void }[] = [];
async function ortam() {
  const ad = `test-${yeniId()}`;
  const depo = await veriKatmaniniAc(ad);
  const arsiv = await yedekArsiviniAc(ad);
  acik.push(depo, arsiv);
  return { depo, arsiv };
}
afterEach(() => acik.splice(0).forEach((x) => x.kapat()));

let saatDegeri: Date;
const saat = () => saatDegeri;
beforeEach(() => {
  saatDegeri = new Date('2026-10-01T09:00:00');
});

async function ornekVeri(depo: Depo, firmaAdi = 'Yılmaz İnşaat'): Promise<Oturum> {
  const oturum = await ilkKurulum(depo, { firmaAdi, kullaniciAdi: 'Süleyman' }, saat);
  const s = new KayitServisi(depo, oturum, saat);
  const cari = await s.ekle('cari', { ad: 'Beton A.Ş.', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
  const belge = await s.ekle('belge', {
    tur: 'fis',
    tarih: '2026-10-01',
    ad: 'fis.jpg',
    bagliTur: 'cari',
    bagliId: cari.id,
    mime: 'image/jpeg',
    boyut: 4,
  });
  await depo.ekle('belgeDosyasi', {
    id: yeniId(),
    firmaId: oturum.firmaId,
    belgeId: belge.id,
    dosya: new Blob([new Uint8Array([0xff, 0xd8, 0x00, 0x7f])], { type: 'image/jpeg' }),
  });
  return oturum;
}

describe('yedek alma', () => {
  it('şema sürümünü taşır, cihaz kimliğini almaz, son yedek zamanını hatırlar', async () => {
    const { depo } = await ortam();
    await ornekVeri(depo);
    const { yedek, dosyaAdi, metin } = await elleYedekAl(depo, saat);

    expect(yedek).toMatchObject({ uygulama: 'muteahhit-hesap-defteri', semaSurumu: depo.semaSurumu, tur: 'elle' });
    expect(yedek.meta).not.toHaveProperty('cihazId');
    expect(yedek.meta).toHaveProperty('aktifFirmaId');
    expect(dosyaAdi).toBe('hesap-defteri-yedek-2026-10-01-0900.json');
    expect(JSON.parse(metin).semaSurumu).toBe(depo.semaSurumu);
    expect(await depo.metaGetir(META_SON_YEDEK)).toBe(yedek.olusturmaZamani);
    expect(yedekOzeti(yedek)).toMatchObject({ firmaAdi: 'Yılmaz İnşaat', kayitSayisi: 6 });
  });
});

describe('geri yükleme', () => {
  it('başka cihaza bütün veriyi ve dosyaları taşır; o cihazın kimliği korunur', async () => {
    const kaynak = await ortam();
    const oturum = await ornekVeri(kaynak.depo);
    const { metin } = await elleYedekAl(kaynak.depo, saat);

    const hedef = await ortam();
    const hedefCihaz = await cihazKimligi(hedef.depo);
    await geriYukle(hedef.depo, hedef.arsiv, yedegiCoz(metin, hedef.depo.semaSurumu), saat);

    expect(await oturumuYukle(hedef.depo)).toEqual({ ...oturum, cihazId: hedefCihaz });
    expect(await hedef.depo.listele('cari', { firmaId: oturum.firmaId })).toEqual(
      await kaynak.depo.listele('cari', { firmaId: oturum.firmaId }),
    );
    const [dosya] = await hedef.depo.listele('belgeDosyasi');
    expect(dosya?.dosya.type).toBe('image/jpeg');
    expect([...new Uint8Array(await dosya!.dosya.arrayBuffer())]).toEqual([0xff, 0xd8, 0x00, 0x7f]);
  });

  it('önce mevcut verinin otomatik yedeğini alır; o yedekle geri dönülebilir', async () => {
    const { depo, arsiv } = await ortam();
    await ornekVeri(depo, 'Eski Firma');
    const eskiCariler = await depo.listele('cari');

    const baska = await ortam();
    await ornekVeri(baska.depo, 'Yeni Firma');
    const yedek = await yedekOlustur(baska.depo, { tur: 'elle', neden: '' }, saat);

    saatDegeri = new Date('2026-10-01T10:00:00');
    const { oncekiYedekId } = await geriYukle(depo, arsiv, yedek, saat);
    expect((await depo.listele('firma'))[0]?.ad).toBe('Yeni Firma');

    const [otomatik] = await arsiv.listele();
    expect(otomatik).toMatchObject({ id: oncekiYedekId, tur: 'otomatik', neden: 'Geri yükleme öncesi' });

    // Geri al: otomatik yedeği geri yükle.
    const kayit = await arsiv.getir(oncekiYedekId);
    await geriYukle(depo, arsiv, yedegiCoz(kayit!.icerik, depo.semaSurumu), saat);
    expect((await depo.listele('firma'))[0]?.ad).toBe('Eski Firma');
    expect((await depo.listele('cari')).map((c) => c.id)).toEqual(eskiCariler.map((c) => c.id));
  });

  it('işlem geçmişine geri yükleme notu düşer', async () => {
    const { depo, arsiv } = await ortam();
    const oturum = await ornekVeri(depo);
    const yedek = await yedekOlustur(depo, { tur: 'elle', neden: '' }, saat);
    await geriYukle(depo, arsiv, yedek, saat);

    const notlar = (await depo.listele('islemGecmisi', { firmaId: oturum.firmaId })).filter((g) => g.islem === 'geriYukle');
    expect(notlar).toHaveLength(1);
    expect(notlar[0]?.yeni).toMatchObject({ yedekTarihi: yedek.olusturmaZamani });
  });

  it('yarıda kalırsa mevcut veri olduğu gibi kalır', async () => {
    const { depo, arsiv } = await ortam();
    await ornekVeri(depo);
    const once = await depo.hepsiniOku();

    const yedek = await yedekOlustur(depo, { tur: 'elle', neden: '' }, saat);
    const cari = yedek.tablolar.cari![0];
    yedek.tablolar.cari = [cari, cari]; // aynı kimlik iki kez: yazma başarısız olur

    await expect(geriYukle(depo, arsiv, yedek, saat)).rejects.toThrow();
    expect(await depo.hepsiniOku()).toEqual(once);
  });
});

describe('yedek dosyası doğrulama', () => {
  const gecerli = (ek: object = {}) =>
    JSON.stringify({ uygulama: 'muteahhit-hesap-defteri', bicimSurumu: 1, semaSurumu: 1, tablolar: {}, meta: {}, ...ek });

  it.each([
    ['JSON değil', 'merhaba', 'Dosya okunamadı'],
    ['başka uygulama', JSON.stringify({ uygulama: 'baska' }), 'Hesap Defteri yedeği değil'],
    ['sürüm yok', JSON.stringify({ uygulama: 'muteahhit-hesap-defteri' }), 'sürüm bilgisi eksik'],
    ['daha yeni şema', gecerli({ semaSurumu: 99 }), 'Önce uygulamayı güncelleyin'],
    ['daha yeni biçim', gecerli({ bicimSurumu: 99 }), 'Önce uygulamayı güncelleyin'],
    ['tablolar yok', gecerli({ tablolar: null }), 'tablolar eksik'],
    ['tablo liste değil', gecerli({ tablolar: { cari: {} } }), 'liste değil'],
  ])('%s → açık hata', (_ad, metin, mesaj) => {
    expect(() => yedegiCoz(metin, 1)).toThrow(mesaj);
  });

  it('eski şema için dönüştürücü yoksa açıkça söyler', () => {
    expect(() => yedegiCoz(gecerli({ semaSurumu: 0 }), 2)).toThrow('Şema 0 sürümündeki yedek');
  });

  it('şema 1 yedeği şema 2 biçimine çevrilir: gider para birimi/kur, tevkifat alanları', () => {
    const v1 = gecerli({
      semaSurumu: 1,
      tablolar: {
        gider: [
          { id: 'g1', toplam: 100, doviz: null },
          { id: 'g2', toplam: 4100, doviz: { paraBirimi: 'USD', tutar: 100, kur: 41 } },
        ],
        giderSatiri: [{ id: 's1', kdvTutari: 20 }],
        cari: [{ id: 'c1' }],
      },
    });
    const yedek = yedegiCoz(v1, 2);
    expect(yedek.semaSurumu).toBe(2);
    expect(yedek.tablolar.gider).toEqual([
      { id: 'g1', toplam: 100, tevkifatToplam: 0, paraBirimi: 'TRY', kur: null },
      { id: 'g2', toplam: 4100, tevkifatToplam: 0, paraBirimi: 'USD', kur: 41 },
    ]);
    expect(yedek.tablolar.giderSatiri).toEqual([{ id: 's1', kdvTutari: 20, tevkifat: null, tevkifatTutari: 0 }]);
    expect(yedek.tablolar.cari).toEqual([{ id: 'c1' }]);
  });

  it('bu sürümde olmayan tablo varsa geri yüklemez', async () => {
    const { depo, arsiv } = await ortam();
    const yedek = yedegiCoz(gecerli({ tablolar: { gelecekTablosu: [] } }), 1);
    await expect(geriYukle(depo, arsiv, yedek, saat)).rejects.toThrow('gelecekTablosu');
  });
});

it(`arşivde en yeni ${ARSIV_SINIRI} yedek tutulur`, async () => {
  const { depo, arsiv } = await ortam();
  const idler: string[] = [];
  for (let i = 0; i < ARSIV_SINIRI + 2; i++) {
    saatDegeri = new Date(2026, 9, 1, 9, i);
    idler.push(await arsiveKaydet(arsiv as YedekArsivi, await yedekOlustur(depo, { tur: 'otomatik', neden: `${i}` }, saat)));
  }
  const liste = await arsiv.listele();
  expect(liste.map((k) => k.id)).toEqual(idler.slice(-ARSIV_SINIRI).reverse());
  expect(liste[0]).not.toHaveProperty('icerik');
  expect(yedekMetni(yedegiCoz((await arsiv.getir(idler.at(-1)!))!.icerik, depo.semaSurumu))).toContain('"neden":"6"');
});
