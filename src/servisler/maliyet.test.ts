import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BOS_GIRDILER, maliyetOzeti } from '../hesap/maliyet';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { MALIYET_FORMULLERI } from '../veri/sabit/maliyetFormulleri';
import { fiyatGir, fiyatKalemleri } from './fiyat';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import {
  elleSatir,
  katalogHaritasi,
  maliyetHesabiGetir,
  maliyetHesabiKaydet,
  maliyetHesabiOlustur,
  maliyetHesabiOnayla,
  maliyetHesaplari,
  projedenGirdiler,
  revizyonAc,
  katsayiVarsayilanYap,
  hesabaProjedenYaz,
  projeBinasi,
} from './maliyet';
import { BOS_BLOK, projeOlustur } from './proje';

const BUGUN = '2026-10-30';
const G = { ...BOS_GIRDILER, insaatAlani: 1000, tabanAlani: 250, normalKatSayisi: 4, bodrumKatSayisi: 0, katYuksekligi: 3, daireSayisi: 8, islakHacimSayisi: 16, sureAy: 12 };
let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

describe('maliyet hesabı', () => {
  it('projesiz hesap: hazır formüller satır olur, miktarlar hesaplanır', async () => {
    await expect(maliyetHesabiOlustur(depo, servis, { ad: ' ', projeId: null, girdiler: G, aciklama: '' })).rejects.toThrow('ad verin');
    const h = await maliyetHesabiOlustur(depo, servis, { ad: 'Ön maliyet', projeId: null, girdiler: G, aciklama: '' });
    expect(h.revizyon).toBe(1);
    expect(h.satirlar).toHaveLength(MALIYET_FORMULLERI.length);
    const beton = h.satirlar.find((s) => s.formulKodu === 'beton')!;
    expect(beton).toMatchObject({ tur: 'malzeme', ad: 'Hazır beton (betonarme)', birim: 'm³', miktar: 400, miktarKaynagi: 'formul' });
    expect(h.satirlar.find((s) => s.formulKodu === 'kalip_iscilik')).toMatchObject({ tur: 'iscilik', miktar: 1000 });
    expect(await maliyetHesaplari(depo, oturum.firmaId)).toHaveLength(1);
  });

  it('projeden girdiler: alan, kat sayıları, bağımsız bölüm', async () => {
    const p = await projeOlustur(
      depo,
      servis,
      { ad: 'Güneş Apt.', il: null, ilce: null, mahalle: null, adres: '', parseller: [], arsaTipi: 'satin_alma', baslangicTarihi: null, planlananBitis: null, gerceklesenBitis: null, alanlar: { net: null, brut: 1500, toplamInsaat: 1800, satilabilir: null } },
      [{ ...BOS_BLOK, bodrumKatSayisi: 1, zeminBolumSayisi: 2, normalKatSayisi: 3, katBasinaDaire: 2 }],
    );
    const r = await projedenGirdiler(depo, oturum.firmaId, p.id);
    expect(r.girdiler).toMatchObject({ insaatAlani: 1800, bodrumKatSayisi: 1, normalKatSayisi: 4, daireSayisi: 8 });
    const h = await maliyetHesabiOlustur(depo, servis, { ad: 'Güneş', projeId: p.id, girdiler: { ...BOS_GIRDILER, ...r.girdiler }, aciklama: '' });
    expect(await maliyetHesaplari(depo, oturum.firmaId, p.id)).toHaveLength(1);
    expect(await maliyetHesaplari(depo, oturum.firmaId, null)).toHaveLength(0);
    expect(h.satirlar.find((s) => s.formulKodu === 'beton')!.miktar).toBe(720);
  });

  it('kaydet: elle satır dayanaksız olmaz, formül yeniden hesaplanır; onay fiyatsızda olmaz, fiyatı dondurur; revizyon', async () => {
    const h = await maliyetHesabiOlustur(depo, servis, { ad: 'Ön maliyet', projeId: null, girdiler: G, aciklama: '' });
    const katalog = await fiyatKalemleri(depo, oturum.firmaId);
    const beton = katalog.find((k) => k.sistemKodu === 'm_beton_c30')!;
    const yalniz = h.satirlar.filter((s) => s.formulKodu === 'beton').map((s) => ({ ...s, katsayi: 0.45 }));
    const elle = elleSatir({ kalem: katalog.find((k) => k.sistemKodu === 'm_bims')!, tur: 'malzeme', ad: '', birim: '', butceKalemiKodu: null, miktar: 500, dayanak: '' });
    await expect(maliyetHesabiKaydet(depo, servis, h.id, { ad: 'Ön maliyet', aciklama: '', girdiler: G, satirlar: [...yalniz, elle] })).rejects.toThrow('dayanağını');
    const serbest = elleSatir({ kalem: null, tur: 'makine', ad: 'Vinç kirası', birim: 'gün', butceKalemiKodu: null, miktar: 3, dayanak: 'Teklif' });
    const k = await maliyetHesabiKaydet(depo, servis, h.id, {
      ad: 'Ön maliyet',
      aciklama: '',
      girdiler: { ...G, insaatAlani: 1200 },
      satirlar: [...yalniz, { ...elle, dayanak: 'Mimari projeden ölçü' }, { ...serbest, ozelFiyat: 400000 }],
    });
    expect(k.satirlar.map((s) => [s.ad, s.miktar])).toEqual([
      ['Hazır beton (betonarme)', 540],
      ['Bims blok', 500],
      ['Vinç kirası', 3],
    ]);
    expect(k.satirlar[0]!.dayanak).toBe('İnşaat alanı 1.200 m² × 0,45 m³/m²');

    await expect(maliyetHesabiOnayla(depo, servis, h.id)).rejects.toThrow(/Fiyatı olmayan satırlar var \(Hazır beton \(betonarme\), Bims blok\)/);
    await fiyatGir(depo, servis, beton.id, { fiyat: 330000, kaynak: 'elle', not: '', tarih: BUGUN }, BUGUN);
    await fiyatGir(depo, servis, k.satirlar[1]!.fiyatKalemiId!, { fiyat: 3000, kaynak: 'arastirma', not: '', tarih: BUGUN }, BUGUN);
    await maliyetHesabiOnayla(depo, servis, h.id);
    const onayli = (await maliyetHesabiGetir(depo, oturum.firmaId, h.id))!;
    expect(onayli.onay).not.toBeNull();
    expect(onayli.satirlar.map((s) => s.dondurulan?.fiyat)).toEqual([330000, 3000, 400000]);
    expect(onayli.satirlar[2]!.dondurulan?.kaynak).toBe('ozel');

    // Liste değişince onaylı hesap değişmez.
    await fiyatGir(depo, servis, beton.id, { fiyat: 360000, kaynak: 'elle', not: '', tarih: BUGUN }, BUGUN);
    const katalogH = await katalogHaritasi(depo, oturum.firmaId);
    expect(maliyetOzeti(onayli, katalogH).toplam).toBe(540 * 330000 + 500 * 3000 + 3 * 400000);
    await expect(maliyetHesabiKaydet(depo, servis, h.id, { ad: 'x', aciklama: '', girdiler: G, satirlar: [] })).rejects.toThrow('revizyon açın');

    const r = await revizyonAc(depo, servis, h.id);
    expect(r).toMatchObject({ revizyon: 2, oncekiHesapId: h.id, onay: null });
    expect(r.satirlar.every((s) => s.dondurulan === null)).toBe(true);
    expect(maliyetOzeti(r, katalogH).toplam).toBe(540 * 360000 + 500 * 3000 + 3 * 400000);
    await expect(revizyonAc(depo, servis, h.id)).rejects.toThrow('zaten açılmış');
    await expect(revizyonAc(depo, servis, r.id)).rejects.toThrow('yalnız onaylanmış');
  });

  it('firma varsayılan katsayısı yeni hesaplara uygulanır, hazır değere dönülür', async () => {
    let firma = (await depo.getir('firma', oturum.firmaId))!;
    firma = await katsayiVarsayilanYap(servis, firma, 'beton', 0.45);
    expect(firma.ayarlar.maliyetKatsayilari).toEqual({ beton: 0.45 });
    const h = await maliyetHesabiOlustur(depo, servis, { ad: 'A', projeId: null, girdiler: G, aciklama: '' });
    expect(h.satirlar.find((s) => s.formulKodu === 'beton')).toMatchObject({ katsayi: 0.45, miktar: 450 });
    expect(h.satirlar.find((s) => s.formulKodu === 'demir')!.miktar).toBe(49.5);
    firma = await katsayiVarsayilanYap(servis, firma, 'beton', null);
    expect(firma.ayarlar.maliyetKatsayilari).toEqual({});
    await expect(katsayiVarsayilanYap(servis, firma, 'yok', 1)).rejects.toThrow('Formül');
  });

  it('projeden yazma: var olan satır güncellenir (bağlılar da), yeni satır eklenir', async () => {
    const h = await maliyetHesabiOlustur(depo, servis, { ad: 'A', projeId: null, girdiler: G, aciklama: '' });
    const duvar = h.satirlar.find((s) => s.formulKodu === 'duvar')!;
    const r = await hesabaProjedenYaz(depo, servis, h.id, {
      guncellenecek: new Map([[duvar.id, { miktar: 1500, dayanak: 'metraj.xlsx: satır 9', ozelFiyat: 25000 }]]),
      eklenecek: [{ ...elleSatir({ kalem: null, tur: 'iscilik', ad: 'Fore kazık', birim: 'metre', butceKalemiKodu: null, miktar: 80, dayanak: 'metraj.xlsx: satır 12' }), miktarKaynagi: 'proje' }],
    });
    expect(r.satirlar.find((s) => s.id === duvar.id)).toMatchObject({ miktarKaynagi: 'proje', miktar: 1500, ozelFiyat: 25000 });
    expect(r.satirlar.find((s) => s.formulKodu === 'tugla')!.miktar).toBe(37500);
    expect(r.satirlar.at(-1)).toMatchObject({ ad: 'Fore kazık', miktarKaynagi: 'proje', miktar: 80 });
  });

  it('daire bazında ek istek: miktar bölüm × bölüm başı, bölüm ek maliyeti; projesiz hesapta olmaz', async () => {
    const p = await projeOlustur(
      depo,
      servis,
      { ad: 'Ek Apt.', il: null, ilce: null, mahalle: null, adres: '', parseller: [], arsaTipi: 'satin_alma', baslangicTarihi: null, planlananBitis: null, gerceklesenBitis: null, alanlar: { net: null, brut: 1000, toplamInsaat: 1000, satilabilir: null } },
      [{ ...BOS_BLOK, normalKatSayisi: 2, katBasinaDaire: 2 }],
    );
    const bina = await projeBinasi(depo, oturum.firmaId, p.id);
    expect(bina.bolumler.length).toBeGreaterThanOrEqual(4);
    const h = await maliyetHesabiOlustur(depo, servis, { ad: 'A', projeId: p.id, girdiler: G, aciklama: '' });
    const [b1, b2] = bina.bolumler;
    const s = { ...elleSatir({ kalem: null, tur: 'malzeme', ad: 'Ankastre set', birim: 'takım', butceKalemiKodu: null, miktar: null, dayanak: 'Ek istek' }), ozelFiyat: 5000000 };
    const r = await maliyetHesabiKaydet(depo, servis, h.id, { ad: 'A', aciklama: '', girdiler: G, satirlar: [...h.satirlar, { ...s, ekIstek: { bolumIdleri: [b1!.id, b2!.id], birimMiktar: 1, not: '' } }] });
    expect(r.satirlar.at(-1)!.miktar).toBe(2);
    const o = maliyetOzeti(r, await katalogHaritasi(depo, oturum.firmaId));
    expect(o.ekIstekler.tutar).toBe(10000000);
    expect(o.bolumEkleri.get(b1!.id)).toBe(5000000);
    await expect(
      maliyetHesabiKaydet(depo, servis, h.id, { ad: 'A', aciklama: '', girdiler: G, satirlar: [...h.satirlar, { ...s, ekIstek: { bolumIdleri: [], birimMiktar: 1, not: '' } }] }),
    ).rejects.toThrow('bölümlerini seçin');
    const projesiz = await maliyetHesabiOlustur(depo, servis, { ad: 'B', projeId: null, girdiler: G, aciklama: '' });
    await expect(
      maliyetHesabiKaydet(depo, servis, projesiz.id, { ad: 'B', aciklama: '', girdiler: G, satirlar: [{ ...s, ekIstek: { bolumIdleri: [b1!.id], birimMiktar: 1, not: '' } }] }),
    ).rejects.toThrow('yalnız projeli');
  });

  it('miktarı çıkmayan satır varken onaylanmaz', async () => {
    const h = await maliyetHesabiOlustur(depo, servis, { ad: 'Eksik', projeId: null, girdiler: { ...BOS_GIRDILER, insaatAlani: 500 }, aciklama: '' });
    await expect(maliyetHesabiOnayla(depo, servis, h.id)).rejects.toThrow('Miktarı çıkmayan satırlar var');
  });
});
