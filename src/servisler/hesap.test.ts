import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import {
  birimToplamlari,
  hesapAcilisAyarla,
  hesapAcilisGetir,
  hesapDetayiGetir,
  hesapGuncelle,
  hesapIptal,
  hesapOlustur,
  hesaplariListele,
  ibanGecerli,
  transferYap,
  type HesapGirdisi,
  type TransferGirdisi,
} from './hesap';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

const TL = (n: number) => n * 100;
const GECERLI_IBAN = 'TR33 0006 1005 1978 6457 8413 26';
const girdi = (ek: Partial<HesapGirdisi> = {}): HesapGirdisi => ({
  ad: 'Merkez kasa',
  tur: 'kasa',
  paraBirimi: 'TRY',
  banka: null,
  iban: null,
  ...ek,
});
const transfer = (ek: Partial<TransferGirdisi> & Pick<TransferGirdisi, 'kaynakHesapId' | 'hedefHesapId'>): TransferGirdisi => ({
  tarih: '2026-10-02',
  tutar: TL(100),
  hedefTutar: null,
  aciklama: '',
  ...ek,
});
const bakiyeler = async () =>
  Object.fromEntries((await hesaplariListele(depo, oturum.firmaId)).map((o) => [o.hesap.ad, o.bakiye]));

describe('IBAN', () => {
  it('mod-97 denetimi', () => {
    expect(ibanGecerli(GECERLI_IBAN)).toBe(true);
    expect(ibanGecerli('tr330006100519786457841326')).toBe(true);
    expect(ibanGecerli('TR33 0006 1005 1978 6457 8413 27')).toBe(false);
    expect(ibanGecerli('TR33 0006')).toBe(false);
    expect(ibanGecerli('DE89370400440532013000')).toBe(false);
  });
});

describe('kasa/banka hesabı', () => {
  it('açılış bakiyesiyle oluşur; kasalar önce listelenir', async () => {
    await hesapOlustur(depo, servis, girdi({ ad: 'Ziraat TL', tur: 'banka', banka: 'Ziraat', iban: GECERLI_IBAN }), {
      tutar: TL(50_000),
      tarih: '2026-10-01',
    });
    const kasa = await hesapOlustur(depo, servis, girdi({ banka: 'kasada banka olmaz' }), { tutar: TL(2_000), tarih: '2026-10-01' });
    expect(kasa.banka).toBeNull();
    const liste = await hesaplariListele(depo, oturum.firmaId);
    expect(liste.map((o) => [o.hesap.ad, o.bakiye])).toEqual([
      ['Merkez kasa', TL(2_000)],
      ['Ziraat TL', TL(50_000)],
    ]);
    expect(liste[1]!.hesap.iban).toBe('TR330006100519786457841326');
  });

  it.each([
    [girdi({ ad: '' }), 'Hesap adı boş'],
    [girdi({ tur: 'banka', iban: 'TR12 3456' }), 'IBAN hatalı'],
  ])('hatalı girdi reddedilir: %#', async (g, mesaj) => {
    await expect(hesapOlustur(depo, servis, g)).rejects.toThrow(mesaj);
  });

  it('aynı adla ikinci hesap açılmaz', async () => {
    await hesapOlustur(depo, servis, girdi());
    await expect(hesapOlustur(depo, servis, girdi({ ad: 'merkez  KASA' }))).rejects.toThrow('zaten var');
  });

  it('hareketi olan hesabın para birimi değişmez; hareketsizinki değişir', async () => {
    const usd = await hesapOlustur(depo, servis, girdi({ ad: 'Dolar kasası' }));
    await hesapGuncelle(depo, servis, usd.id, girdi({ ad: 'Dolar kasası', paraBirimi: 'USD' }));
    await hesapAcilisAyarla(depo, servis, usd.id, { tutar: 500_00, tarih: '2026-10-01' });
    await expect(hesapGuncelle(depo, servis, usd.id, girdi({ ad: 'Dolar kasası', paraBirimi: 'EUR' }))).rejects.toThrow(
      'para birimi değiştirilemez',
    );
    expect((await hesapAcilisGetir(depo, oturum.firmaId, usd.id))?.tutar).toBe(500_00);
  });

  it('hareketi olan hesap iptal edilemez; hareketsiz hesap açılışıyla iptal olur', async () => {
    const kasa = await hesapOlustur(depo, servis, girdi(), { tutar: TL(10), tarih: '2026-10-01' });
    const banka = await hesapOlustur(depo, servis, girdi({ ad: 'Banka', tur: 'banka' }));
    const tr = await transferYap(depo, servis, transfer({ kaynakHesapId: kasa.id, hedefHesapId: banka.id, tutar: TL(5) }));
    await expect(hesapIptal(depo, servis, banka.id)).rejects.toThrow('iptal edilemez');

    await servis.iptal('transfer', tr.id);
    await hesapIptal(depo, servis, banka.id);
    await hesapIptal(depo, servis, kasa.id);
    expect(await hesaplariListele(depo, oturum.firmaId)).toEqual([]);
    expect(await hesapAcilisGetir(depo, oturum.firmaId, kasa.id)).toBeNull();
  });
});

describe('transfer', () => {
  it('kaynaktan düşer, hedefe ekler; toplam para değişmez; iptal geri alır', async () => {
    const kasa = await hesapOlustur(depo, servis, girdi(), { tutar: TL(1_000), tarih: '2026-10-01' });
    const banka = await hesapOlustur(depo, servis, girdi({ ad: 'Banka', tur: 'banka' }), { tutar: TL(5_000), tarih: '2026-10-01' });
    const tr = await transferYap(
      depo,
      servis,
      transfer({ kaynakHesapId: banka.id, hedefHesapId: kasa.id, tutar: TL(750), aciklama: ' Şantiye harçlığı ' }),
    );
    expect(tr).toMatchObject({ hedefTutar: null, aciklama: 'Şantiye harçlığı' });
    expect(await bakiyeler()).toEqual({ 'Merkez kasa': TL(1_750), Banka: TL(4_250) });

    const detay = await hesapDetayiGetir(depo, oturum.firmaId, kasa.id);
    expect(detay!.bakiye).toBe(TL(1_750));
    expect(detay!.hareketler.map((x) => [x.tur, x.tutar, x.bakiye, detay!.hesapAdlari[x.karsiHesapId ?? ''] ?? null])).toEqual([
      ['transferGiris', TL(750), TL(1_750), 'Banka'],
      ['acilis', TL(1_000), TL(1_000), null],
    ]);

    await servis.iptal('transfer', tr.id);
    expect(await bakiyeler()).toEqual({ 'Merkez kasa': TL(1_000), Banka: TL(5_000) });
  });

  it('farklı para birimleri arasında hedef tutarı zorunludur', async () => {
    const tl = await hesapOlustur(depo, servis, girdi({ ad: 'TL', tur: 'banka' }), { tutar: TL(100_000), tarih: '2026-10-01' });
    const usd = await hesapOlustur(depo, servis, girdi({ ad: 'USD', tur: 'banka', paraBirimi: 'USD' }));
    await expect(
      transferYap(depo, servis, transfer({ kaynakHesapId: tl.id, hedefHesapId: usd.id, tutar: TL(41_000) })),
    ).rejects.toThrow('USD tutarını girin');
    await transferYap(depo, servis, transfer({ kaynakHesapId: tl.id, hedefHesapId: usd.id, tutar: TL(41_000), hedefTutar: 1_000_00 }));
    expect(await bakiyeler()).toEqual({ TL: TL(59_000), USD: 1_000_00 });
    expect(birimToplamlari(await hesaplariListele(depo, oturum.firmaId))).toEqual([
      { paraBirimi: 'TRY', toplam: TL(59_000) },
      { paraBirimi: 'USD', toplam: 1_000_00 },
    ]);
  });

  it('aynı para biriminde hedef tutarı yok sayılır', async () => {
    const a = await hesapOlustur(depo, servis, girdi({ ad: 'A' }));
    const b = await hesapOlustur(depo, servis, girdi({ ad: 'B' }));
    const tr = await transferYap(depo, servis, transfer({ kaynakHesapId: a.id, hedefHesapId: b.id, hedefTutar: TL(999) }));
    expect(tr.hedefTutar).toBeNull();
  });

  it.each([
    ['aynı hesap', { hedef: 'ayni' }, 'aynı olamaz'],
    ['sıfır tutar', { tutar: 0 }, 'sıfırdan büyük'],
    ['eksi tutar', { tutar: -5 }, 'sıfırdan büyük'],
    ['tarih yok', { tarih: '' }, 'tarihini'],
    ['hedef yok', { hedef: 'yok' }, 'gireceği hesabı'],
  ])('hatalı transfer reddedilir: %s', async (_ad, ek, mesaj) => {
    const a = await hesapOlustur(depo, servis, girdi({ ad: 'A' }));
    const b = await hesapOlustur(depo, servis, girdi({ ad: 'B' }));
    const { hedef, ...geri } = ek as { hedef?: string } & Partial<TransferGirdisi>;
    const hedefId = hedef === 'ayni' ? a.id : hedef === 'yok' ? 'yok' : b.id;
    await expect(transferYap(depo, servis, transfer({ kaynakHesapId: a.id, hedefHesapId: hedefId, ...geri }))).rejects.toThrow(mesaj);
    expect(await depo.listele('transfer')).toEqual([]);
  });
});
