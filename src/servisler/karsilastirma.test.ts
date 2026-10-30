import { afterEach, beforeEach, expect, it } from 'vitest';
import { BOS_GIRDILER } from '../hesap/maliyet';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { cariOlustur } from './cari';
import { giderOlustur } from './gider';
import { ilerlemeKaydet } from './ilerleme';
import { karsilastirmaGetir } from './karsilastirma';
import { sistemKalemiHazirla } from './kalem';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import { maliyetHesabiKaydet, maliyetHesabiOlustur, maliyetHesabiOnayla } from './maliyet';
import { BOS_BLOK, projeOlustur } from './proje';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;
beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Sürex', kullaniciAdi: 'Y' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

it('projenin onaylı hesabı ile proje giderleri ve ilerleme', async () => {
  const p = await projeOlustur(
    depo,
    servis,
    { ad: 'Güneş', il: null, ilce: null, mahalle: null, adres: '', parseller: [], arsaTipi: 'satin_alma', baslangicTarihi: null, planlananBitis: null, gerceklesenBitis: null, alanlar: { net: null, brut: null, toplamInsaat: 1000, satilabilir: null } },
    [{ ...BOS_BLOK, zeminBolumSayisi: 0, normalKatSayisi: 1, katBasinaDaire: 1 }],
  );
  expect((await karsilastirmaGetir(depo, oturum.firmaId, p.id, 10)).hesap).toBeNull();
  const h = await maliyetHesabiOlustur(depo, servis, { ad: 'Ön', projeId: p.id, girdiler: { ...BOS_GIRDILER, insaatAlani: 1000 }, aciklama: '' });
  const beton = h.satirlar.find((s) => s.formulKodu === 'beton')!;
  await maliyetHesabiKaydet(depo, servis, h.id, { ad: 'Ön', aciklama: '', girdiler: h.girdiler, satirlar: [{ ...beton, ozelFiyat: 300000 }] });
  const taslak = await karsilastirmaGetir(depo, oturum.firmaId, p.id, 10);
  expect(taslak.hesap).toBeNull();
  expect(taslak.taslaklar).toHaveLength(1);
  await maliyetHesabiOnayla(depo, servis, h.id);

  const kalem = await depo.islem(async () => sistemKalemiHazirla(depo, servis, p.id, 'beton'));
  const ana = (await depo.getir('kalem', kalem.ustKalemId!))!;
  const cari = await cariOlustur(depo, servis, { ad: 'Akdeniz Beton', roller: ['tedarikci'], telefon: null, vergiNo: null, adres: null, not: '' });
  await giderOlustur(depo, servis, {
    tarih: '2026-10-01',
    projeId: p.id,
    cariId: cari.id,
    faturaNo: '1',
    vadeTarihi: null,
    aciklama: '',
    satirlar: [
      { kalemId: kalem.id, aciklama: 'C30 beton', miktar: 100, birim: 'm³', tutar: 33000000, kdvDahil: false, kdvOrani: 20, tevkifat: null },
      { kalemId: null, aciklama: 'Şantiye yemeği', miktar: null, birim: null, tutar: 100000, kdvDahil: false, kdvOrani: 10, tevkifat: null },
    ],
  });
  await ilerlemeKaydet(depo, servis, { projeId: p.id, kalemId: ana.id, tarih: '2026-10-02', yuzde: 25, kaynak: 'elle', hakedisId: null, not: '' });

  const r = await karsilastirmaGetir(depo, oturum.firmaId, p.id, 10);
  expect(r.hesap?.id).toBe(h.id);
  const s = r.sonuc!;
  expect(s).toMatchObject({ plan: 400 * 300000, gercek: 33000000 + 100000, ilerleme: 25, plandaYok: 100000, fiyatFarki: 33000000 - 100 * 300000 });
  const kaba = s.kalemler.find((k) => k.kod === 'kaba_insaat')!;
  expect(kaba).toMatchObject({ beklenen: 30000000, sapma: 3000000 });
  expect(kaba.eslesmeler[0]).toMatchObject({ gercekMiktar: 100, ortalamaFiyat: 330000 });
  expect(s.kalemler.find((k) => k.kod === null)!.plandaYok.map((g) => g.aciklama)).toEqual(['Şantiye yemeği']);
});
