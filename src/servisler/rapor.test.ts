import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { hesapOlustur } from './hesap';
import { kalemEkle } from './kalem';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { tahsilatKaydet } from './odeme';
import { BOS_BLOK, projeOlustur } from './proje';
import { firmaRaporuGetir, karZararGetir } from './rapor';
import { satisIcerigi, satisKaydet, satisOlustur, satisOnayla } from './satis';

const TL = (n: number) => Math.round(n * 100);

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex İnşaat', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

describe('proje kâr/zarar raporu', () => {
  it('satış, gider ve tahsilattan kâr ve nakit', async () => {
    const firma = (await depo.getir('firma', oturum.firmaId))!;
    const p = await projeOlustur(
      depo,
      servis,
      {
        ad: 'Güneş Apt.',
        il: null,
        ilce: null,
        mahalle: null,
        adres: '',
        parseller: [],
        arsaTipi: 'satin_alma',
        baslangicTarihi: null,
        planlananBitis: null,
        gerceklesenBitis: null,
        alanlar: { net: null, brut: null, toplamInsaat: null, satilabilir: null },
      },
      [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 1, katBasinaDaire: 2 }],
    );
    const bolumler = await depo.listele('bagimsizBolum', { projeId: p.id, firmaId: oturum.firmaId });
    const kalem = await kalemEkle(depo, servis, p.id, null, { ad: 'Kaba yapı', birim: null, butceMiktari: null, butceTutari: TL(2_000_000) });
    const kasa = await hesapOlustur(depo, servis, { ad: 'Kasa', tur: 'kasa', paraBirimi: 'TRY', banka: null, iban: null });
    const tedarikci = await cariOlustur(depo, servis, { ad: 'Beton AŞ', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
    const musteri = await cariOlustur(depo, servis, { ad: 'Ayşe Kaya', roller: ['musteri'], telefon: null, vergiNo: null, adres: null, not: '' });
    await giderOlustur(
      depo,
      servis,
      {
        tarih: '2026-10-01',
        projeId: p.id,
        cariId: tedarikci.id,
        faturaNo: 'F-1',
        vadeTarihi: '2026-12-01',
        aciklama: '',
        satirlar: [{ kalemId: kalem.id, aciklama: '', miktar: null, birim: null, tutar: TL(1_000_000), kdvDahil: true, kdvOrani: 20, tevkifat: null }],
      },
      { hesapId: kasa.id, tutar: TL(400_000) },
    );
    const s = await satisOlustur(depo, servis, firma, { bolumId: bolumler[0]!.id, cariId: musteri.id, tarih: '2026-10-01' });
    const ic = satisIcerigi(s);
    await satisKaydet(depo, servis, s.id, {
      ...ic,
      fiyat: TL(2_020_000),
      kdvOrani: 1,
      plan: [
        { id: 'p', tur: 'pesinat', vadeTarihi: '2026-10-01', tutar: TL(1_020_000), aciklama: '', alacakId: null },
        { id: 't', tur: 'taksit', vadeTarihi: '2027-01-01', tutar: TL(1_000_000), aciklama: '', alacakId: null },
      ],
      teslimTarihi: '2027-06-30',
      maddeler: ic.maddeler.map((m) => ({ ...m, metin: 'Anlaşıldı.' })),
    });
    await satisOnayla(depo, servis, s.id);
    await tahsilatKaydet(depo, servis, {
      tarih: '2026-10-02',
      amac: 'cari',
      cariId: musteri.id,
      hesapId: kasa.id,
      tutar: TL(1_020_000),
      projeId: p.id,
      aciklama: '',
    });

    const r = await karZararGetir(depo, oturum.firmaId, p.id, true, '2026-11-01');
    expect(r.gelir.imzali).toMatchObject({ adet: 1, kdvHaric: TL(2_000_000) });
    expect(r.gelir.satilmamis).toMatchObject({ adet: 1, tahmin: TL(2_000_000) });
    expect(r.maliyet).toMatchObject({ gerceklesen: TL(1_000_000), tahmini: TL(2_000_000) });
    expect(r.kar.tahmini).toBe(TL(2_000_000));
    expect(r.nakit).toMatchObject({ tahsilEdilen: TL(1_020_000), odenen: TL(400_000), bekleyenTahsilat: TL(1_000_000), odenecekBorc: TL(600_000) });

    const f = await firmaRaporuGetir(depo, oturum.firmaId, true, '2026-11-01');
    expect(f.projeler).toHaveLength(1);
    expect(f).toMatchObject({ kar: TL(2_000_000), eldeki: TL(620_000), bekleyenTahsilat: TL(1_000_000), odenecekBorc: TL(600_000) });
    expect((await firmaRaporuGetir(depo, oturum.firmaId, true, '2026-11-01', new Set(['baska']))).projeler).toHaveLength(0);
  });
});
