import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cariBakiye } from '../hesap/bakiye';
import type { SatisIcerigi } from '../hesap/satis';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { BagimsizBolum, Cari, Firma, Hesap } from '../veri/tipler';
import { cariOlustur } from './cari';
import { hesapOlustur } from './hesap';
import { GerekceGerekliHatasi, KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { tahsilatKaydet } from './odeme';
import { BOS_BLOK, projeOlustur } from './proje';
import {
  projeSatislari,
  protokolGetir,
  satisaAcikBolumler,
  satisDetayi,
  satisIcerigi,
  satisIptal,
  satisKaydet,
  satisOlustur,
  satisOnayla,
  satisTeslim,
} from './satis';

const TL = (n: number) => Math.round(n * 100);

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
let firma: Firma;
let projeId: string;
let bolumler: BagimsizBolum[];
let musteri: Cari;
let kasa: Hesap;

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
  musteri = await cariOlustur(depo, servis, { ad: 'Ayşe Kaya', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
  kasa = await hesapOlustur(depo, servis, { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null });
});
afterEach(() => depo.kapat());

const doldur = (g: SatisIcerigi): SatisIcerigi => ({
  ...g,
  fiyat: TL(3_000_000),
  indirim: TL(100_000),
  takas: [{ aciklama: 'Araç', deger: TL(900_000) }],
  plan: [
    { id: 'k', tur: 'kapora', vadeTarihi: '2026-11-01', tutar: TL(100_000), aciklama: '', alacakId: null },
    { id: 'p', tur: 'pesinat', vadeTarihi: '2026-11-15', tutar: TL(900_000), aciklama: '', alacakId: null },
    { id: 't1', tur: 'taksit', vadeTarihi: '2026-12-15', tutar: TL(500_000), aciklama: '', alacakId: null },
    { id: 't2', tur: 'taksit', vadeTarihi: '2027-01-15', tutar: TL(500_000), aciklama: '', alacakId: null },
  ],
  teslimTarihi: '2027-06-30',
  maddeler: g.maddeler.map((m) => ({ ...m, metin: 'Taraflarca anlaşıldı.' })),
});

const bakiye = async () => {
  const k = { firmaId: oturum.firmaId };
  const [odemeler, alacaklar] = await Promise.all([depo.listele('odeme', k), depo.listele('alacak', k)]);
  return cariBakiye(musteri.id, { acilislar: [], giderler: [], hakedisler: [], odemeler, cekler: [], cekHareketleri: [], alacaklar, vergiDairesiId: null });
};

describe('daire satışı', () => {
  it('rezervasyon bölümü kapatır, müşteri rolü eklenir; aynı bölüm iki kez satılmaz', async () => {
    const s = await satisOlustur(depo, servis, firma, { bolumId: bolumler[0]!.id, cariId: musteri.id, tarih: '2026-11-01' });
    expect(s).toMatchObject({ durum: 'rezerve', onay: null, maddeler: expect.arrayContaining([expect.objectContaining({ id: 'tapu', metin: '' })]) });
    expect((await depo.getir('bagimsizBolum', bolumler[0]!.id))!.satisDurumu).toBe('rezerve');
    expect((await depo.getir('cari', musteri.id))!.roller).toEqual(['tedarikci', 'musteri']);
    await expect(satisOlustur(depo, servis, firma, { bolumId: bolumler[0]!.id, cariId: musteri.id, tarih: '2026-11-01' })).rejects.toThrow('zaten bir satış');
    expect((await satisaAcikBolumler(depo, oturum.firmaId, projeId)).map((x) => x.no)).toEqual(['A-2', 'A-3', 'A-4']);
  });

  it('kapora rezervede avans; imzayla alacaklar doğar, kapora bağlanır; tahsilat taksitleri kapatır', async () => {
    const s = await satisOlustur(depo, servis, firma, { bolumId: bolumler[0]!.id, cariId: musteri.id, tarih: '2026-11-01' });
    await tahsilatKaydet(depo, servis, { tarih: '2026-11-01', amac: 'cari', cariId: musteri.id, hesapId: kasa.id, tutar: TL(100_000), projeId, aciklama: 'Kapora' });
    expect(await bakiye()).toBe(TL(100_000));
    await expect(satisOnayla(depo, servis, s.id)).rejects.toThrow('eksik');
    await satisKaydet(depo, servis, s.id, doldur(satisIcerigi(s)));
    const o = await satisOnayla(depo, servis, s.id);
    expect(o.durum).toBe('sozlesmeli');
    expect(o.plan.every((p) => p.alacakId)).toBe(true);
    expect((await depo.getir('bagimsizBolum', bolumler[0]!.id))!.satisDurumu).toBe('sozlesmeli');
    // 2.000.000 alacak − 100.000 kapora.
    expect(await bakiye()).toBe(TL(-1_900_000));
    let d = (await satisDetayi(depo, oturum.firmaId, s.id, '2026-12-20'))!;
    expect(d.durumlar.map((x) => x.durum)).toEqual(['tahsil_edildi', 'gecikti', 'gecikti', 'yaklasan']);
    expect(d.ozet).toMatchObject({ net: TL(2_900_000), tahsil: TL(100_000), kalan: TL(1_900_000), geciken: TL(1_400_000) });
    await tahsilatKaydet(depo, servis, { tarih: '2026-12-20', amac: 'cari', cariId: musteri.id, hesapId: kasa.id, tutar: TL(1_000_000), projeId, aciklama: '' });
    d = (await satisDetayi(depo, oturum.firmaId, s.id, '2026-12-20'))!;
    expect(d.durumlar.map((x) => x.durum)).toEqual(['tahsil_edildi', 'tahsil_edildi', 'gecikti', 'yaklasan']);
    expect(d.ozet.geciken).toBe(TL(400_000));
    const p = await projeSatislari(depo, oturum.firmaId, projeId, '2026-12-20');
    expect(p.ozet).toMatchObject({ adet: 1, rezerve: 0, tahsil: TL(1_100_000), kalan: TL(900_000) });
    expect(p.satisaAcik).toBe(3);
  });

  it('imzalıda plan değişikliği gerekçe ister, alacaklar eşitlenir; tahsil edilen satır çıkarılamaz', async () => {
    const s = await satisOlustur(depo, servis, firma, { bolumId: bolumler[1]!.id, cariId: musteri.id, tarih: '2026-11-01' });
    await satisKaydet(depo, servis, s.id, doldur(satisIcerigi(s)));
    const o = await satisOnayla(depo, servis, s.id);
    await tahsilatKaydet(depo, servis, { tarih: '2026-11-02', amac: 'cari', cariId: musteri.id, hesapId: kasa.id, tutar: TL(100_000), projeId, aciklama: '' });
    const ic = satisIcerigi(o);
    const yeni = { ...ic, plan: [...ic.plan.slice(0, 3), { ...ic.plan[3]!, tutar: TL(250_000) }, { id: 't3', tur: 'taksit' as const, vadeTarihi: '2027-02-15', tutar: TL(250_000), aciklama: '', alacakId: null }] };
    await expect(satisKaydet(depo, servis, s.id, yeni)).rejects.toBeInstanceOf(GerekceGerekliHatasi);
    const k = await satisKaydet(depo, servis, s.id, yeni, 'Son taksit ikiye bölündü');
    expect(k.sozlesmeSurumu).toBe(2);
    const alacaklar = (await depo.listele('alacak', { kaynakId: s.id, firmaId: oturum.firmaId })).filter((a) => !a.iptal);
    expect(alacaklar.map((a) => a.tutar).sort((a, b) => a - b)).toEqual([TL(100_000), TL(250_000), TL(250_000), TL(500_000), TL(900_000)]);
    const kaporasiz = { ...yeni, plan: yeni.plan.slice(1), takas: [{ aciklama: 'Araç', deger: TL(1_000_000) }] };
    await expect(satisKaydet(depo, servis, s.id, kaporasiz, 'x')).rejects.toThrow('tahsil edilmiş');
    // Tahsilatlı satış iptal edilmez.
    await expect(satisIptal(depo, servis, s.id, 'Vazgeçti')).rejects.toThrow('tahsil edilmiş');
  });

  it('tahsilatsız satış iptal edilir: alacaklar kalkar, bölüm satışa döner; teslim bölüme yazılır', async () => {
    const s = await satisOlustur(depo, servis, firma, { bolumId: bolumler[2]!.id, cariId: musteri.id, tarih: '2026-11-01' });
    await satisKaydet(depo, servis, s.id, doldur(satisIcerigi(s)));
    await satisOnayla(depo, servis, s.id);
    await satisTeslim(depo, servis, s.id, '2027-06-20');
    expect((await depo.getir('bagimsizBolum', bolumler[2]!.id))!.teslimDurumu).toBe('teslim_edildi');
    const protokol = (await protokolGetir(depo, firma, s.id))!;
    expect(protokol.metin.altBaslik).toBe('Güneş Apt. · A-3');
    await satisIptal(depo, servis, s.id, 'Vazgeçti');
    expect((await depo.getir('bagimsizBolum', bolumler[2]!.id))!).toMatchObject({ satisDurumu: 'satista', teslimDurumu: 'teslim_edilmedi' });
    expect((await depo.listele('alacak', { kaynakId: s.id, firmaId: oturum.firmaId })).every((a) => a.iptal)).toBe(true);
    expect(await bakiye()).toBe(0);
  });
});
