import { afterEach, describe, expect, it } from 'vitest';
import { belgeDosyasiGetir, belgeEkle } from '../servisler/belge';
import { cariOlustur } from '../servisler/cari';
import { KayitServisi, type Oturum } from '../servisler/kayitServisi';
import { kullaniciEkle } from '../servisler/kullanici';
import { ilkKurulum, oturumuYukle } from '../servisler/kurulum';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { bulutaAc, bulutBaglantisi, bulutFirmasinaKatil, esitle, type BulutApi, type SunucuKaydi } from './esitleme';

/** Sunucunun sürüm ve sıra kuralının aynısı (yetki: `yasak` tabloları reddedilir). PHP tarafı ayrıca denenir. */
class SahteSunucu implements BulutApi {
  kayitlar = new Map<string, { tablo: string; veri: SunucuKaydi['veri']; sira: number }>();
  sira = 0;
  yasak = new Set<string>();
  gonderimler = 0;
  async firmalarim() {
    return { firmalar: [] };
  }
  async firmaOlustur(g: { firmaId: string }) {
    return { firmaId: g.firmaId, yeni: true };
  }
  async davetOlustur() {
    return { kod: 'ABCD-EFGH', gun: 7 };
  }
  async davetKabul(): Promise<never> {
    throw new Error('yok');
  }
  async uyeler() {
    return { uyeler: [] };
  }
  async baglantiKaldir() {
    return {};
  }
  async gonder(g: { firmaId: string; kayitlar: SunucuKaydi[] }) {
    this.gonderimler++;
    const kabul: { tablo: string; id: string }[] = [];
    const red: { tablo: string; id: string; sebep: string; sunucu: SunucuKaydi['veri'] | null }[] = [];
    for (const k of JSON.parse(JSON.stringify(g.kayitlar)) as SunucuKaydi[]) {
      const a = `${k.tablo}:${k.veri.id}`;
      const eski = this.kayitlar.get(a);
      if (this.yasak.has(k.tablo)) {
        red.push({ tablo: k.tablo, id: k.veri.id, sebep: 'yetki', sunucu: eski?.veri ?? null });
        continue;
      }
      if (eski && typeof k.veri.surum === 'number') {
        if (JSON.stringify(eski.veri) === JSON.stringify(k.veri)) {
          kabul.push({ tablo: k.tablo, id: k.veri.id });
          continue;
        }
        if ((k.tabanSurum ?? 0) !== eski.veri.surum || k.veri.surum <= (eski.veri.surum as number)) {
          red.push({ tablo: k.tablo, id: k.veri.id, sebep: 'eski', sunucu: eski.veri });
          continue;
        }
      } else if (eski) {
        kabul.push({ tablo: k.tablo, id: k.veri.id });
        continue;
      }
      this.kayitlar.set(a, { tablo: k.tablo, veri: k.veri, sira: ++this.sira });
      kabul.push({ tablo: k.tablo, id: k.veri.id });
    }
    return { kabul, red, sonSira: this.sira };
  }
  async cek(_firmaId: string, sonra: number) {
    const hepsi = [...this.kayitlar.values()].filter((k) => k.sira > sonra).sort((a, b) => a.sira - b.sira);
    const sayfa = hepsi.slice(0, 50);
    return { kayitlar: JSON.parse(JSON.stringify(sayfa)), sonSira: sayfa.at(-1)?.sira ?? sonra, devam: hepsi.length > 50 };
  }
}

const acik: Depo[] = [];
const yeniDepo = async () => {
  const d = await veriKatmaniniAc(`test-${yeniId()}`);
  acik.push(d);
  return d;
};
afterEach(() => acik.splice(0).forEach((d) => d.kapat()));

/** Saati elle ilerleyen servis (çakışma sırasını belirlemek için). */
const saatli = (depo: Depo, oturum: Oturum, iso: string) => new KayitServisi(depo, oturum, () => new Date(iso));

describe('bulut eşitleme', () => {
  it('yönetici firmayı açar, ikinci cihaz katılır; iki yönlü eşitlenir, belge dosyası taşınır', async () => {
    const sunucu = new SahteSunucu();
    const a = await yeniDepo();
    const oa = await ilkKurulum(a, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Süleyman' });
    const sa = new KayitServisi(a, oa);
    const mehmet = await kullaniciEkle(a, sa, { ad: 'Mehmet', eposta: null }, 'muhasebe');
    const cari = await cariOlustur(a, sa, { ad: 'Beton AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await belgeEkle(a, sa, {
      bagliTur: 'cari',
      bagliId: cari.id,
      tur: 'diger',
      tarih: '2026-10-28',
      ad: 'kart.pdf',
      dosya: new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'application/pdf' }),
    });

    const ilk = await bulutaAc(a, oa, 'Sürex İnşaat', sunucu);
    expect(ilk.reddedilen).toEqual([]);
    expect(ilk.gonderilen).toBe(sunucu.kayitlar.size);
    expect(await a.bekleyenSayisi()).toBe(0);

    const b = await yeniDepo();
    await bulutFirmasinaKatil(b, { firmaId: oa.firmaId, kullaniciId: mehmet.kullanici.id }, sunucu);
    const ob = (await oturumuYukle(b))!;
    expect(ob).toMatchObject({ firmaId: oa.firmaId, kullaniciId: mehmet.kullanici.id });
    expect((await b.listele('cari', { firmaId: oa.firmaId })).map((c) => c.ad).sort()).toEqual(['Beton AŞ', 'Vergi dairesi']);
    const belge = (await b.listele('belge', { firmaId: oa.firmaId }))[0]!;
    const dosya = await belgeDosyasiGetir(b, oa.firmaId, belge.id);
    expect(new Uint8Array(await dosya!.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 250]));
    expect(await b.bekleyenSayisi()).toBe(0);
    expect((await bulutBaglantisi(b))!.sonSira).toBe(sunucu.sira);

    // B'de yazılan A'ya, A'da yazılan B'ye gider.
    const sb = new KayitServisi(b, ob);
    await cariOlustur(b, sb, { ad: 'Demir Ltd', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await cariOlustur(a, sa, { ad: 'Kum Ocağı', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await esitle(b, sunucu);
    await esitle(a, sunucu);
    await esitle(b, sunucu);
    const adlar = async (d: Depo) => (await d.listele('cari', { firmaId: oa.firmaId })).map((c) => c.ad).sort();
    expect(await adlar(a)).toEqual(['Beton AŞ', 'Demir Ltd', 'Kum Ocağı', 'Vergi dairesi']);
    expect(await adlar(b)).toEqual(await adlar(a));
    // İşlem geçmişi de eşitlenir.
    expect((await a.listele('islemGecmisi', { firmaId: oa.firmaId })).length).toBe((await b.listele('islemGecmisi', { firmaId: oa.firmaId })).length);
  });

  it('aynı kayıt iki cihazda değişirse alanlar birleştirilir; yetkisiz değişiklik sunucudaki hâline döner', async () => {
    const sunucu = new SahteSunucu();
    const a = await yeniDepo();
    const oa = await ilkKurulum(a, { firmaAdi: 'Firma', kullaniciAdi: 'Ali' });
    const sa = new KayitServisi(a, oa);
    const veli = await kullaniciEkle(a, sa, { ad: 'Veli', eposta: null }, 'muhasebe');
    const cari = await cariOlustur(a, sa, { ad: 'Beton AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await bulutaAc(a, oa, 'Firma', sunucu);
    const b = await yeniDepo();
    await bulutFirmasinaKatil(b, { firmaId: oa.firmaId, kullaniciId: veli.kullanici.id }, sunucu);
    const ob = (await oturumuYukle(b))!;

    // İkisi de internetsizken değiştirir: A notu, B telefonu ve notu değiştirir. A önce gönderir; B'ninki reddedilir,
    // B kendi alanlarını A'nınkinin üstüne koyar: telefon ve not B'nin, A'nın değiştirdiği yetkili korunur.
    await saatli(a, oa, '2026-10-28T10:00:00Z').guncelle('cari', cari.id, { not: 'A notu', yetkili: 'Hasan' });
    await saatli(b, ob, '2026-10-28T11:00:00Z').guncelle('cari', cari.id, { not: 'B notu', telefon: '05320000000' });
    await esitle(a, sunucu);
    const s = await esitle(b, sunucu);
    expect(s.birlestirilen).toBe(1);
    await esitle(a, sunucu);
    for (const d of [a, b]) expect((await d.getir('cari', cari.id))!).toMatchObject({ not: 'B notu', telefon: '05320000000', yetkili: 'Hasan', surum: 3 });
    expect(await b.bekleyenSayisi()).toBe(0);

    // Yetkisiz yazma: sunucu reddeder, cihaz sunucudaki hâli alır; hiç gönderilmemiş yeni kayıt cihazda kalır.
    sunucu.yasak.add('firma');
    await new KayitServisi(b, ob).guncelle('firma', oa.firmaId, { ad: 'Değişti' }).catch(() => undefined);
    await b.yaz('firma', { ...(await b.getir('firma', oa.firmaId))!, ad: 'Elle değişti', surum: 99 });
    const r = await esitle(b, sunucu);
    expect(r.reddedilen.map((x) => x.sebep)).toContain('yetki');
    expect((await b.getir('firma', oa.firmaId))!.ad).toBe('Firma');
    expect(await b.bekleyenSayisi()).toBe(0);
  });

  it('çok kayıt parça parça gönderilir ve çekilir', async () => {
    const sunucu = new SahteSunucu();
    const a = await yeniDepo();
    const oa = await ilkKurulum(a, { firmaAdi: 'Firma', kullaniciAdi: 'Ali' });
    const sa = new KayitServisi(a, oa);
    for (let i = 0; i < 320; i++) await cariOlustur(a, sa, { ad: `Cari ${i}`, roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await bulutaAc(a, oa, 'Firma', sunucu);
    expect(sunucu.gonderimler).toBeGreaterThan(2);
    const b = await yeniDepo();
    await bulutFirmasinaKatil(b, { firmaId: oa.firmaId, kullaniciId: oa.kullaniciId }, sunucu);
    expect((await b.listele('cari', { firmaId: oa.firmaId })).length).toBe(321);
  });

  it('internetsizken çok kez düzelten cihaz, başka cihazın değişikliğini ezmez; yeniden bağlanış sunucudakini korur', async () => {
    const sunucu = new SahteSunucu();
    const a = await yeniDepo();
    const oa = await ilkKurulum(a, { firmaAdi: 'Firma', kullaniciAdi: 'Ali' });
    const sa = new KayitServisi(a, oa);
    const veli = await kullaniciEkle(a, sa, { ad: 'Veli', eposta: null }, 'yonetici');
    const cari = await cariOlustur(a, sa, { ad: 'Beton AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await bulutaAc(a, oa, 'Firma', sunucu);
    const b = await yeniDepo();
    await bulutFirmasinaKatil(b, { firmaId: oa.firmaId, kullaniciId: veli.kullanici.id }, sunucu);
    const ob = (await oturumuYukle(b))!;
    const sb = new KayitServisi(b, ob);

    // B bir kez değiştirip gönderir; A üç kez değiştirir (sürümü daha büyük) ama B'nin telefonunu silmez.
    await sb.guncelle('cari', cari.id, { telefon: '05320000000' });
    await esitle(b, sunucu);
    await sa.guncelle('cari', cari.id, { not: 'bir' });
    await sa.guncelle('cari', cari.id, { not: 'iki' });
    await sa.guncelle('cari', cari.id, { yetkili: 'Hasan' });
    await esitle(a, sunucu);
    await esitle(b, sunucu);
    for (const d of [a, b]) expect(await d.getir('cari', cari.id)).toMatchObject({ telefon: '05320000000', not: 'iki', yetkili: 'Hasan' });

    // İç içe ayar: A rol yetkilerini, B ortak maddeleri değiştirir; ikisi de kalır.
    const firma = (await a.getir('firma', oa.firmaId))!;
    await sa.guncelle('firma', oa.firmaId, { ayarlar: { ...firma.ayarlar, rolYetkileri: { santiye: ['gider'] } } });
    const fb = (await b.getir('firma', oa.firmaId))!;
    await sb.guncelle('firma', oa.firmaId, { ayarlar: { ...fb.ayarlar, ilerlemeUyariEsigi: 20 } });
    await esitle(a, sunucu);
    await esitle(b, sunucu);
    await esitle(a, sunucu);
    for (const d of [a, b])
      expect((await d.getir('firma', oa.firmaId))!.ayarlar).toMatchObject({ rolYetkileri: { santiye: ['gider'] }, ilerlemeUyariEsigi: 20 });

    // A bağlantıyı keser; B çalışmaya devam eder; A yeniden açınca B'nin değişikliği geri alınmaz.
    const { bulutBaglantisiniKes } = await import('./esitleme');
    await bulutBaglantisiniKes(a);
    await sb.guncelle('cari', cari.id, { not: 'B sonra' });
    await esitle(b, sunucu);
    // Sunucu firmayı tanıyor: yeniden bağlanış.
    sunucu.firmaOlustur = async () => ({ firmaId: oa.firmaId, yeni: false }) as never;
    await bulutaAc(a, oa, 'Firma', sunucu);
    expect((await a.getir('cari', cari.id))!.not).toBe('B sonra');
    await esitle(b, sunucu);
    expect((await b.getir('cari', cari.id))!.not).toBe('B sonra');
  });
});
