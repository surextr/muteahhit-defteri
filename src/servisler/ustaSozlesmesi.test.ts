import { beforeEach, describe, expect, it } from 'vitest';
import type { SozlesmeIcerigi } from '../hesap/ustaSozlesmesi';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, Firma, UstaTipi } from '../veri/tipler';
import { belgeEkle } from './belge';
import { cariGuncelle, cariOlustur } from './cari';
import { GerekceGerekliHatasi, KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';
import {
  kayitHatalari,
  projeSozlesmeleri,
  sozlesmeBelgesiGetir,
  sozlesmeIcerigi,
  ustaSozlesmesiGetir,
  ustaSozlesmesiIptal,
  ustaSozlesmesiKaydet,
  ustaSozlesmesiOlustur,
  ustaSozlesmesiOnayla,
} from './ustaSozlesmesi';
import { hazirUstaTipleriniEkle, ustaTipiKaydet, ustaTipiKopyasi, ustaTipleriListele } from './ustaTipi';

const TL = (n: number) => Math.round(n * 100);

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let firma: Firma;
let projeId: string;
let usta: Cari;
let kalipci: UstaTipi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
  firma = (await depo.getir('firma', oturum.firmaId))!;
  const p = await projeOlustur(
    depo,
    servis,
    {
      ad: 'Güneş Apt.',
      il: null,
      ilce: null,
      mahalle: null,
      adres: 'Merkez',
      parseller: [],
      arsaTipi: 'satin_alma',
      baslangicTarihi: null,
      planlananBitis: null,
      gerceklesenBitis: null,
      alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null },
    },
    [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 1, katBasinaDaire: 1 }],
  );
  projeId = p.id;
  usta = await cariOlustur(depo, servis, { ad: 'Usta Ali', roller: ['usta'], telefon: null, vergiNo: null, adres: null, not: '' });
  await hazirUstaTipleriniEkle(depo, servis);
  kalipci = (await ustaTipleriListele(depo, oturum.firmaId)).find((t) => t.sistemKodu === 'kalipci')!;
});

const olustur = () => ustaSozlesmesiOlustur(depo, servis, firma, { projeId, ustaTipiId: kalipci.id, cariId: usta.id });

/** Bütün eksikleri doldurulmuş içerik. */
function tamamla(g: SozlesmeIcerigi): SozlesmeIcerigi {
  return {
    ...g,
    sozlesmeTarihi: '2026-11-01',
    kalemler: g.kalemler.map((k, i) => ({ ...k, birimFiyat: TL(100 + i), miktar: i === 0 ? 500 : null })),
    sorumluluklar: g.sorumluluklar.map((r) => ({ ...r, cevap: r.cevap ?? 'muteahhit' })),
    ortakMaddeler: g.ortakMaddeler.map((m) => ({ ...m, cevap: 'Şantiye şefi ile birlikte.' })),
  };
}

describe('tipten taslak', () => {
  it('kalemler fiyatsız, bütçe kalemi tipten; varsayılanlı sorular cevaplı, diğerleri cevapsız; ortak maddeler ve şartlar kopyalanır', async () => {
    const s = await olustur();
    expect(s).toMatchObject({ ustaTipiAdi: kalipci.ad, sablonSurumu: kalipci.sablonSurumu, hakedisSekli: 'beton_dokumu', onay: null, sozlesmeSurumu: 1, toplamTutar: 0 });
    expect(s.kalemler).toHaveLength(kalipci.kalemler.length);
    expect(s.kalemler[0]).toMatchObject({ birimFiyat: 0, miktar: null, butceKalemiKodu: 'kalip_isciligi' });
    expect(s.sorumluluklar.map((r) => r.cevap)).toEqual(kalipci.sorular.map((q) => q.varsayilan));
    expect(s.ortakMaddeler).toHaveLength(7);
    expect(s.ortakMaddeler[0]).toEqual({ id: 'olcum', baslik: 'Ölçüm yöntemi ve metrajı kimin onaylayacağı', cevap: '' });
    expect(s.ozelSartlar).toBe(kalipci.ozelSartlar.join('\n'));
    const liste = await projeSozlesmeleri(depo, oturum.firmaId, projeId);
    expect(liste).toHaveLength(1);
    expect(liste[0]!.cariAdi).toBe('Usta Ali');
    expect(liste[0]!.eksikSayisi).toBeGreaterThan(0);
  });

  it('tipte kapatılan ortak madde sözleşmeye gelmez; şablon sonradan değişse de sözleşme değişmez', async () => {
    const k = ustaTipiKopyasi(kalipci, kalipci.ad);
    const yeni = await ustaTipiKaydet(depo, servis, kalipci.id, { ...k, kapaliOrtakMaddeler: ['bosluk'] });
    const s = await olustur();
    expect(s.ortakMaddeler.map((m) => m.id)).not.toContain('bosluk');
    expect(s.sablonSurumu).toBe(yeni.sablonSurumu);
    await ustaTipiKaydet(depo, servis, kalipci.id, { ...k, ozelSartlar: ['Yeni şart'] });
    expect((await ustaSozlesmesiGetir(depo, oturum.firmaId, s.id))!.ozelSartlar).toBe(s.ozelSartlar);
  });
});

describe('branş', () => {
  it('sözleşme kartın bilmediği branşı karta ekler; ana branş değişmez, bilinen branş tekrar eklenmez', async () => {
    const siva = (await ustaTipleriListele(depo, oturum.firmaId)).find((t) => t.sistemKodu === 'sivaci')!;
    await cariGuncelle(depo, servis, usta.id, { ad: usta.ad, roller: ['usta'], ustaTipiIdleri: [siva.id], telefon: null, vergiNo: null, adres: null, not: '' });
    await olustur();
    await olustur();
    expect((await depo.getir('cari', usta.id))!.ustaTipiIdleri).toEqual([siva.id, kalipci.id]);
  });

  it('usta rolü olmayan karta sözleşmede usta rolü de eklenir', async () => {
    const ted = await cariOlustur(depo, servis, { ad: 'Demir Ltd.', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    await ustaSozlesmesiOlustur(depo, servis, firma, { projeId, ustaTipiId: kalipci.id, cariId: ted.id });
    const c = (await depo.getir('cari', ted.id))!;
    expect(c.roller).toEqual(['usta', 'tedarikci']);
    expect(c.ustaTipiIdleri).toEqual([kalipci.id]);
  });
});

describe('kaydetme ve onay', () => {
  it('taslak eksik bilgiyle kaydedilir; toplam hesaplanır, bütçe kalemi projeye eklenir', async () => {
    const s = await olustur();
    const g = sozlesmeIcerigi(s);
    g.kalemler[0] = { ...g.kalemler[0]!, miktar: 250.5, birimFiyat: TL(120) };
    const k = await ustaSozlesmesiKaydet(depo, servis, s.id, g);
    expect(k.toplamTutar).toBe(TL(30060));
    const kalemler = await depo.listele('kalem', { firmaId: oturum.firmaId, projeId });
    expect(kalemler.some((x) => x.sistemKodu === 'kalip_isciligi' && !x.iptal)).toBe(true);
  });

  it('eksik bilgi varken onaylanmaz; tamamlanınca onaylanır', async () => {
    const s = await olustur();
    await expect(ustaSozlesmesiOnayla(depo, servis, s.id)).rejects.toThrow('Önce eksik bilgileri tamamlayın');
    await ustaSozlesmesiKaydet(depo, servis, s.id, tamamla(sozlesmeIcerigi(s)));
    await ustaSozlesmesiOnayla(depo, servis, s.id);
    expect((await ustaSozlesmesiGetir(depo, oturum.firmaId, s.id))!.onay).not.toBeNull();
  });

  it('imzalı sözleşmede değişiklik gerekçe ister, sürüm artar, eksik bilgi bırakılamaz', async () => {
    const s = await olustur();
    const tam = tamamla(sozlesmeIcerigi(s));
    await ustaSozlesmesiKaydet(depo, servis, s.id, tam);
    await ustaSozlesmesiOnayla(depo, servis, s.id);

    const degisik = { ...tam, odemeKosulu: 'Hakedişten 10 gün sonra' };
    await expect(ustaSozlesmesiKaydet(depo, servis, s.id, degisik)).rejects.toBeInstanceOf(GerekceGerekliHatasi);
    const k = await ustaSozlesmesiKaydet(depo, servis, s.id, degisik, 'Usta ile yeniden anlaşıldı');
    expect(k).toMatchObject({ odemeKosulu: 'Hakedişten 10 gün sonra', sozlesmeSurumu: 2 });

    // Değişiklik yoksa sürüm artmaz.
    const ayni = await ustaSozlesmesiKaydet(depo, servis, s.id, degisik, 'x');
    expect(ayni.sozlesmeSurumu).toBe(2);

    await expect(ustaSozlesmesiKaydet(depo, servis, s.id, { ...degisik, sozlesmeTarihi: null }, 'x')).rejects.toThrow('İmzalı sözleşmede eksik bilgi bırakılamaz');
  });

  it('kayıt hataları: bitiş başlamadan önce, birimsiz kalem, ana kaleme bağlama', () => {
    const g: SozlesmeIcerigi = {
      sozlesmeTarihi: null,
      baslamaTarihi: '2026-12-01',
      bitisTarihi: '2026-11-01',
      fiyatlamaBirimi: 'm²',
      kalemler: [{ ad: 'Duvar', birim: '', aciklama: '', miktar: -1, birimFiyat: TL(1), butceKalemiKodu: 'kaba_insaat' }],
      sorumluluklar: [],
      ortakMaddeler: [],
      ozelSartlar: '',
      hakedisSekli: 'kat',
      odemeKosulu: '',
      sgkTaahhudu: null,
      not: '',
    };
    expect(kayitHatalari(g)).toEqual([
      'Bitiş tarihi başlama tarihinden önce olamaz.',
      '"Duvar" kaleminin birimini yazın.',
      '"Duvar" kaleminin miktarı geçersiz.',
      '"Duvar" için bütçe kalemi olarak alt kalem seçin.',
    ]);
  });
});

describe('iptal ve belge', () => {
  it('iptal edilen sözleşme listeden çıkar, belgesi de iptal olur', async () => {
    const s = await olustur();
    const b = await belgeEkle(depo, servis, {
      tur: 'sozlesme',
      tarih: '2026-11-01',
      ad: 'İmzalı',
      bagliTur: 'ustaSozlesmesi',
      bagliId: s.id,
      dosya: new Blob(['x'], { type: 'image/jpeg' }),
    });
    await ustaSozlesmesiIptal(servis, s.id);
    expect(await projeSozlesmeleri(depo, oturum.firmaId, projeId)).toEqual([]);
    expect((await depo.getir('belge', b.id))!.iptal).not.toBeNull();
  });

  it('yazdırılacak belge: proje, cari ve metin', async () => {
    const s = await olustur();
    const b = (await sozlesmeBelgesiGetir(depo, firma, s.id))!;
    expect(b.cari.ad).toBe('Usta Ali');
    expect(b.metin.taraflar.map((t) => t.ad)).toEqual(['Sürex İnşaat', 'Usta Ali']);
    expect(b.metin.maddeler[0]!.paragraflar[0]).toContain('"Güneş Apt." projesinde (Merkez)');
  });
});
