import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eksikIsDurumu, eksikListesiMesaji, HAZIR_TESLIM_MADDELERI, tamamlamaEksikleri, teslimSayimi } from '../hesap/teslim';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { BagimsizBolum, Firma } from '../veri/tipler';
import { cariOlustur } from './cari';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { BOS_BLOK, projeOlustur } from './proje';
import { yapilacaklariGetir } from './yapilacaklar';
import { satisIcerigi, satisKaydet, satisOlustur, satisOnayla } from './satis';
import {
  eksikIsEkle,
  eksikIsIptal,
  eksikIsYapildi,
  projeTeslimOzeti,
  teslimAyrintisi,
  teslimBaslat,
  teslimGeriAl,
  teslimIptal,
  teslimKaydet,
  teslimMaddeleriniVarsayilanYap,
  teslimTamamla,
  type TeslimIcerigi,
} from './teslim';

const TL = (n: number) => Math.round(n * 100);

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let firma: Firma;
let projeId: string;
let bolumler: BagimsizBolum[];

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
    [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 2, katBasinaDaire: 2 }],
  );
  projeId = p.id;
  bolumler = (await depo.listele('bagimsizBolum', { projeId, firmaId: oturum.firmaId })).sort((a, b) => Number(a.no) - Number(b.no));
});
afterEach(() => depo.kapat());

async function imzaliSatis(bolumId: string) {
  const musteri = await cariOlustur(depo, servis, { ad: 'Ayşe Kaya', roller: ['musteri'], telefon: '0532 111 22 33', vergiNo: null, adres: null, not: '' });
  const s = await satisOlustur(depo, servis, firma, { bolumId, cariId: musteri.id, tarih: '2026-11-01' });
  const ic = satisIcerigi(s);
  await satisKaydet(depo, servis, s.id, {
    ...ic,
    fiyat: TL(3_000_000),
    plan: [{ id: 'p', tur: 'pesinat', vadeTarihi: '2026-11-15', tutar: TL(3_000_000), aciklama: '', alacakId: null }],
    teslimTarihi: '2027-06-30',
    maddeler: ic.maddeler.map((m) => ({ ...m, metin: 'Anlaşıldı.' })),
  });
  return { satis: await satisOnayla(depo, servis, s.id), musteri };
}

const icerik = (t: TeslimIcerigi): TeslimIcerigi => ({
  teslimAlan: t.teslimAlan,
  tarih: t.tarih,
  maddeler: t.maddeler,
  sayaclar: t.sayaclar,
  anahtarSayisi: t.anahtarSayisi,
  eksikSonTarih: t.eksikSonTarih,
  not: t.not,
});

describe('daire teslimi (saf)', () => {
  it('sayım, tamamlama eksikleri, eksik iş durumu, mesaj', () => {
    const m = HAZIR_TESLIM_MADDELERI.slice(0, 3).map((x, i) => ({ id: `${i}`, ...x, durum: null, not: '', eksikIsId: null }));
    expect(teslimSayimi(m)).toMatchObject({ toplam: 3, bakilmadi: 3 });
    expect(tamamlamaEksikleri({ maddeler: m, eksikSonTarih: null })).toEqual(['3 maddeye bakılmadı (Uygun, Eksik ya da Yok seçin).']);
    const d = m.map((x, i) => ({ ...x, durum: i === 0 ? ('eksik' as const) : ('uygun' as const) }));
    expect(tamamlamaEksikleri({ maddeler: d, eksikSonTarih: null })).toHaveLength(1);
    expect(tamamlamaEksikleri({ maddeler: d, eksikSonTarih: '2027-07-10' })).toEqual([]);
    expect([eksikIsDurumu({ yapildi: null, sonTarih: '2027-01-01' }, '2027-01-02'), eksikIsDurumu({ yapildi: null, sonTarih: null }, '2027-01-02'), eksikIsDurumu({ yapildi: '2027-01-01', sonTarih: '2026-01-01' }, '2027-01-02')]).toEqual(['gecikti', 'acik', 'yapildi']);
    expect(eksikListesiMesaji({ firmaAdi: 'Sürex', projeAdi: 'Güneş', isler: [{ bolum: 'A-1', baslik: 'Silikon', aciklama: 'banyo', sonTarih: '2027-07-10' }] })).toContain('1. A-1 · Silikon (banyo) · en geç 10.07.2027');
  });
});

describe('daire teslimi (kayıtlarla)', () => {
  it('kontrol → eksik iş eşitleme → tamamlama (satışa anahtar teslimi) → geri alma', async () => {
    const { satis, musteri } = await imzaliSatis(bolumler[0]!.id);
    const t = await teslimBaslat(depo, servis, firma, bolumler[0]!.id, '2027-06-20');
    expect(t).toMatchObject({ satisId: satis.id, cariId: musteri.id, tamamlandi: null });
    expect(t.maddeler).toHaveLength(HAZIR_TESLIM_MADDELERI.length);
    // İkinci açış aynı kaydı döndürür.
    expect((await teslimBaslat(depo, servis, firma, bolumler[0]!.id, '2027-06-21')).id).toBe(t.id);

    // İki eksik: eksik işler açılır, son tarihi tutanaktaki gün.
    const [a, b] = t.maddeler;
    let k = await teslimKaydet(depo, servis, t.id, {
      ...icerik(t),
      eksikSonTarih: '2027-07-10',
      maddeler: t.maddeler.map((m) => (m.id === a!.id ? { ...m, durum: 'eksik', not: 'kilit sıkı' } : m.id === b!.id ? { ...m, durum: 'eksik' } : { ...m, durum: 'uygun' })),
    });
    let isler = (await depo.listele('eksikIs', { firmaId: oturum.firmaId, teslimId: t.id })).filter((e) => !e.iptal);
    expect(isler.map((e) => [e.baslik, e.aciklama, e.sonTarih, e.kaynak])).toEqual(
      expect.arrayContaining([
        [a!.ad, 'kilit sıkı', '2027-07-10', 'teslim'],
        [b!.ad, '', '2027-07-10', 'teslim'],
      ]),
    );
    // Biri düzeldi: açık eksik iş iptal olur; gün değişince açık işin günü de değişir.
    k = await teslimKaydet(depo, servis, t.id, { ...icerik(k), eksikSonTarih: '2027-07-15', maddeler: k.maddeler.map((m) => (m.id === b!.id ? { ...m, durum: 'uygun' } : m)) });
    isler = (await depo.listele('eksikIs', { firmaId: oturum.firmaId, teslimId: t.id })).filter((e) => !e.iptal);
    expect(isler.map((e) => [e.baslik, e.sonTarih])).toEqual([[a!.ad, '2027-07-15']]);
    expect(k.maddeler.find((m) => m.id === b!.id)!.eksikIsId).toBeNull();
    // Teslimden gelen açık eksik iş listeden iptal edilmez.
    await expect(eksikIsIptal(depo, servis, isler[0]!.id)).rejects.toThrow('teslim ekranında');

    // Tamamlanacak işler: teslim günü 30 gün içinde; son günü geçmiş eksik iş.
    const kodlar = async (gun: string) => (await yapilacaklariGetir(depo, firma, gun, null, () => true, {})).map((x) => x.kod);
    expect(await kodlar('2027-06-10')).toContain('daire_teslimi');
    expect(await kodlar('2027-05-01')).not.toContain('daire_teslimi');
    expect(await kodlar('2027-07-20')).toContain('eksik_is_gecikti');

    // Tamamla: bölüm ve satış teslim edildi.
    const r = await teslimTamamla(depo, servis, t.id, '2027-06-25');
    expect(r.teslim.tamamlandi).toBe('2027-06-25');
    expect((await depo.getir('bagimsizBolum', bolumler[0]!.id))!.teslimDurumu).toBe('teslim_edildi');
    expect((await depo.getir('satis', satis.id))!.teslimEdildi).toBe('2027-06-25');
    await expect(teslimIptal(depo, servis, t.id)).rejects.toThrow('geri alın');
    const ay = (await teslimAyrintisi(depo, firma, t.id))!;
    expect(ay.tutanak.baslik).toBe('DAİRE TESLİM TUTANAĞI');
    expect(ay.tutanak.maddeler.find((m) => m.baslik === 'Eksikler')!.liste).toEqual([`Genel · ${a!.ad}: kilit sıkı`]);

    // Özet: açık eksik 1; yapıldı işaretlenince 0.
    let o = await projeTeslimOzeti(depo, oturum.firmaId, projeId, '2027-07-20');
    expect(o.sayilar).toMatchObject({ teslimEdilecek: 1, teslimEdildi: 1, acikEksik: 1, gecikenEksik: 1 });
    await eksikIsYapildi(depo, servis, isler[0]!.id, '2027-07-12', 'yağlandı');
    expect(await kodlar('2027-07-20')).not.toContain('eksik_is_gecikti');
    expect(await kodlar('2027-06-10')).not.toContain('daire_teslimi');
    o = await projeTeslimOzeti(depo, oturum.firmaId, projeId, '2027-07-20');
    expect(o.sayilar.acikEksik).toBe(0);
    expect(o.eksikler[0]!.is.yapildiNot).toBe('yağlandı');

    // Geri alma.
    await teslimGeriAl(depo, servis, t.id, 'Yanlış daire');
    expect((await depo.getir('bagimsizBolum', bolumler[0]!.id))!.teslimDurumu).toBe('teslim_edilmedi');
    expect((await depo.getir('satis', satis.id))!.teslimEdildi).toBeNull();
  });

  it('bakılmamış madde ve imzasız satış teslimi engeller; elle eksik iş; firma listesi', async () => {
    const t = await teslimBaslat(depo, servis, firma, bolumler[1]!.id, '2027-06-20');
    expect(t.cariId).toBeNull();
    await expect(teslimTamamla(depo, servis, t.id, '2027-06-20')).rejects.toThrow('bakılmadı');

    const musteri = await cariOlustur(depo, servis, { ad: 'Ali Veli', roller: ['musteri'], telefon: null, vergiNo: null, adres: null, not: '' });
    await satisOlustur(depo, servis, firma, { bolumId: bolumler[2]!.id, cariId: musteri.id, tarih: '2026-11-01' });
    const t2 = await teslimBaslat(depo, servis, firma, bolumler[2]!.id, '2027-06-20');
    await teslimKaydet(depo, servis, t2.id, { ...icerik(t2), maddeler: t2.maddeler.map((m) => ({ ...m, durum: 'uygun' })) });
    await expect(teslimTamamla(depo, servis, t2.id, '2027-06-20')).rejects.toThrow('imzalanmadan');

    const usta = await cariOlustur(depo, servis, { ad: 'Hasan Boyacı', roller: ['usta'], telefon: null, vergiNo: null, adres: null, not: '' });
    const e = await eksikIsEkle(depo, servis, { projeId, bolumId: null, kaynak: 'kontrol', baslik: 'Merdiven boyası', aciklama: '', sorumluCariId: usta.id, sonTarih: null });
    let o = await projeTeslimOzeti(depo, oturum.firmaId, projeId, '2027-07-20');
    expect(o.eksikler.map((x) => [x.is.baslik, x.bolumAdi, x.sorumluAdi])).toEqual([['Merdiven boyası', null, 'Hasan Boyacı']]);
    expect(o.bolumler.find((x) => x.bolum.id === bolumler[2]!.id)).toMatchObject({ durum: 'kontrolde', teslimEdilecek: true, cariAdi: 'Ali Veli', sifat: 'Alıcı' });
    await eksikIsIptal(depo, servis, e.id);
    o = await projeTeslimOzeti(depo, oturum.firmaId, projeId, '2027-07-20');
    expect(o.eksikler).toHaveLength(0);

    firma = await teslimMaddeleriniVarsayilanYap(servis, firma, [{ grup: 'Genel', ad: 'Kapı' }, { grup: '', ad: 'Pencere' }, { grup: 'X', ad: ' ' }]);
    const t3 = await teslimBaslat(depo, servis, firma, bolumler[3]!.id, '2027-06-20');
    expect(t3.maddeler.map((m) => [m.grup, m.ad])).toEqual([
      ['Genel', 'Kapı'],
      ['Diğer', 'Pencere'],
    ]);
  });
});
