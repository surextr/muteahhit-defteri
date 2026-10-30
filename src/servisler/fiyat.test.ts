import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { HAZIR_FIYAT_KALEMLERI } from '../veri/sabit/hazirFiyatKalemleri';
import { cariOlustur } from './cari';
import {
  arastirilacakIsaretle,
  arastirmaKaydet,
  fiyatGir,
  fiyatKalemiEkle,
  fiyatKalemiIptal,
  fiyatKalemleri,
  fiyatOnerileri,
  hazirFiyatKalemleriniEkle,
} from './fiyat';
import { giderOlustur } from './gider';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';
import { sozlesmeIcerigi, ustaSozlesmesiKaydet, ustaSozlesmesiOlustur, ustaSozlesmesiOnayla } from './ustaSozlesmesi';
import { hazirUstaTipleriniEkle, ustaTipleriListele } from './ustaTipi';

const TL = (n: number) => Math.round(n * 100);
const BUGUN = '2026-10-30';
let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

describe('fiyat kataloğu', () => {
  it('hazır kalemler bir kez eklenir; iptal edilen geri gelmez; kimlik koddan', async () => {
    expect(await hazirFiyatKalemleriniEkle(depo, servis)).toBe(HAZIR_FIYAT_KALEMLERI.length);
    expect(await hazirFiyatKalemleriniEkle(depo, servis)).toBe(0);
    const liste = await fiyatKalemleri(depo, oturum.firmaId);
    expect(new Set(liste.map((k) => k.tur))).toEqual(new Set(['malzeme', 'iscilik', 'makine']));
    const beton = liste.find((k) => k.sistemKodu === 'm_beton_c30')!;
    expect(beton).toMatchObject({ ad: 'Hazır beton C30/37', birim: 'm³', fiyat: null, kdvOrani: 20, arastirilacak: false });
    expect(liste.find((k) => k.tur === 'iscilik')!.kdvOrani).toBe(0);
    await fiyatKalemiIptal(depo, servis, beton.id);
    expect(await hazirFiyatKalemleriniEkle(depo, servis)).toBe(0);

    // Başka cihaz (aynı firma) aynı kimlikleri üretir.
    const depo2 = await veriKatmaniniAc(`test-${yeniId()}`);
    const servis2 = new KayitServisi(depo2, { ...oturum });
    await depo2.ekle('firma', (await depo.getir('firma', oturum.firmaId))!);
    await hazirFiyatKalemleriniEkle(depo2, servis2);
    expect((await depo2.getir('fiyatKalemi', beton.id))?.sistemKodu).toBe('m_beton_c30');
    depo2.kapat();
  });

  it('fiyat girişi, kaynak ve tarih; araştırılacak işareti; denetim', async () => {
    const k = await fiyatKalemiEkle(depo, servis, { tur: 'malzeme', ad: ' Bims briket ', birim: 'adet', butceKalemiKodu: 'duvar', aciklama: '', kdvOrani: 20 });
    expect(k.ad).toBe('Bims briket');
    await arastirilacakIsaretle(depo, servis, [k.id], true);
    expect((await depo.getir('fiyatKalemi', k.id))!.arastirilacak).toBe(true);
    await expect(fiyatGir(depo, servis, k.id, { fiyat: 0, kaynak: 'elle', not: '', tarih: BUGUN }, BUGUN)).rejects.toThrow('Fiyatı yazın');
    await expect(fiyatGir(depo, servis, k.id, { fiyat: 100, kaynak: 'elle', not: '', tarih: '2026-11-01' }, BUGUN)).rejects.toThrow('bugünden sonra');
    const f = await fiyatGir(depo, servis, k.id, { fiyat: TL(32), kaynak: 'arastirma', not: ' Yapı market teklifi ', tarih: BUGUN }, BUGUN);
    expect(f).toMatchObject({ fiyat: 3200, fiyatKaynagi: 'arastirma', kaynakNotu: 'Yapı market teklifi', fiyatTarihi: BUGUN, arastirilacak: false });
    await expect(fiyatKalemiEkle(depo, servis, { tur: 'malzeme', ad: '', birim: '', butceKalemiKodu: null, aciklama: '', kdvOrani: 20 })).rejects.toThrow('adını');

    await arastirmaKaydet(depo, servis, new Map([[k.id, { tarih: BUGUN, enDusuk: 3000, enYuksek: 3600, onerilen: 3300, not: '', kaynaklar: [] }]]));
    const a = (await depo.getir('fiyatKalemi', k.id))!;
    expect(a.arastirma?.onerilen).toBe(3300);
    expect(a.fiyat).toBe(3200); // araştırma fiyatı değiştirmez
  });

  it('öneriler: malzemede son alış, işçilikte imzalı sözleşme', async () => {
    await hazirFiyatKalemleriniEkle(depo, servis);
    await hazirUstaTipleriniEkle(depo, servis);
    const tedarikci = await cariOlustur(depo, servis, { ad: 'Akdeniz Beton', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    const satir = (aciklama: string, miktar: number, birim: string, tutar: number) => ({ kalemId: null, aciklama, miktar, birim, tutar, kdvDahil: false, kdvOrani: 20, tevkifat: null });
    await giderOlustur(depo, servis, { tarih: '2026-09-10', projeId: null, cariId: tedarikci.id, faturaNo: '1', vadeTarihi: null, aciklama: '', satirlar: [satir('C30 beton', 10, 'm3', TL(31_000))] });
    await giderOlustur(depo, servis, { tarih: '2026-10-10', projeId: null, cariId: tedarikci.id, faturaNo: '2', vadeTarihi: null, aciklama: '', satirlar: [satir('C30 beton pompalı', 20, 'm3', TL(66_000)), satir('Ø12 nervürlü demir', 2000, 'kg', TL(52_000))] });

    const p = await projeOlustur(
      depo,
      servis,
      { ad: 'Güneş Apt.', il: null, ilce: null, mahalle: null, adres: '', parseller: [], arsaTipi: 'satin_alma', baslangicTarihi: null, planlananBitis: null, gerceklesenBitis: null, alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null } },
      [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 1, katBasinaDaire: 1 }],
    );
    const usta = await cariOlustur(depo, servis, { ad: 'Ali Usta', roller: ['usta'], telefon: null, vergiNo: null, adres: null, not: '' });
    const siva = (await ustaTipleriListele(depo, oturum.firmaId)).find((t) => t.sistemKodu === 'sivaci')!;
    const firma = (await depo.getir('firma', oturum.firmaId))!;
    const s = await ustaSozlesmesiOlustur(depo, servis, firma, { projeId: p.id, ustaTipiIdleri: [siva.id], cariId: usta.id });
    const ic = sozlesmeIcerigi(s);
    await ustaSozlesmesiKaydet(depo, servis, s.id, {
      ...ic,
      sozlesmeTarihi: '2026-10-01',
      kalemler: ic.kalemler.map((k) => ({ ...k, birimFiyat: k.ad === 'İç sıva' ? TL(165) : TL(190) })),
      sorumluluklar: ic.sorumluluklar.map((r) => ({ ...r, cevap: r.cevap ?? 'muteahhit' })),
      ortakMaddeler: ic.ortakMaddeler.map((m) => ({ ...m, cevap: 'Şantiye şefi ile.' })),
    });
    const kalemler = await fiyatKalemleri(depo, oturum.firmaId);
    const kod = (k: string) => kalemler.find((x) => x.sistemKodu === k)!.id;
    const icSiva = kalemler.find((x) => x.tur === 'iscilik' && x.ustaTipiKodu === 'sivaci' && x.ad.endsWith('İç sıva'))!;

    let o = await fiyatOnerileri(depo, oturum.firmaId, kalemler);
    expect(o.get(icSiva.id)).toBeUndefined(); // imzasız sözleşme öneri vermez
    await ustaSozlesmesiOnayla(depo, servis, s.id);
    o = await fiyatOnerileri(depo, oturum.firmaId, kalemler);
    expect(o.get(kod('m_beton_c30'))).toEqual({ kaynak: 'sonAlis', tarih: '2026-10-10', fiyat: TL(3300), aciklama: 'C30 beton pompalı · Akdeniz Beton' });
    expect(o.get(kod('m_demir_12'))?.fiyat).toBe(TL(26_000)); // kg → ton
    expect(o.get(kod('m_demir_14'))).toBeUndefined();
    expect(o.get(icSiva.id)).toEqual({ kaynak: 'sonSozlesme', tarih: '2026-10-01', fiyat: TL(165), aciklama: 'Ali Usta sözleşmesi' });
  });
});
