import { describe, expect, it } from 'vitest';
import { MALIYET_FORMULLERI } from '../veri/sabit/maliyetFormulleri';
import { HAZIR_FIYAT_KALEMLERI } from '../veri/sabit/hazirFiyatKalemleri';
import type { FiyatKalemi, MaliyetSatiri } from '../veri/tipler';
import { BOS_GIRDILER, formulleriHesapla, maliyetOzeti, satirHatalari, satirlariGuncelle } from './maliyet';

const G = { ...BOS_GIRDILER, insaatAlani: 2000, tabanAlani: 400, normalKatSayisi: 5, bodrumKatSayisi: 1, katYuksekligi: 3, daireSayisi: 10, islakHacimSayisi: 20, sureAy: 18 };

const satir = (s: Partial<MaliyetSatiri>): MaliyetSatiri => ({
  id: 's1',
  fiyatKalemiId: 'k1',
  tur: 'malzeme',
  ad: 'Beton',
  birim: 'm³',
  butceKalemiKodu: 'beton',
  miktarKaynagi: 'formul',
  formulKodu: 'beton',
  katsayi: null,
  miktar: null,
  dayanak: '',
  ozelFiyat: null,
  dondurulan: null,
  ...s,
});

const kalem = (id: string, fiyat: number | null, kdvOrani = 20) => ({ id, fiyat, kdvOrani, fiyatKaynagi: 'elle', fiyatTarihi: '2026-10-01' }) as FiyatKalemi;

describe('maliyet formülleri', () => {
  it('formül kodları tekil, dayandıkları formül önce, fiyat kalemleri hazır listede', () => {
    const kodlar = MALIYET_FORMULLERI.map((f) => f.kod);
    expect(new Set(kodlar).size).toBe(kodlar.length);
    const hazir = new Set(HAZIR_FIYAT_KALEMLERI.map((k) => k.kod));
    MALIYET_FORMULLERI.forEach((f, i) => {
      expect(hazir.has(f.fiyatKalemiKodu), f.fiyatKalemiKodu).toBe(true);
      for (const t of f.taban) if (t.startsWith('f:')) expect(kodlar.slice(0, i), `${f.kod} → ${t}`).toContain(t.slice(2));
    });
    // Tam girdiyle her formül miktar verir.
    const r = formulleriHesapla({ ...G, disCevre: 80 });
    expect([...r.entries()].filter(([, v]) => v.miktar === null).map(([k]) => k)).toEqual([]);
  });

  it('miktar ve dayanak; formüle dayanan formül; katsayı değişince', () => {
    const r = formulleriHesapla(G);
    expect(r.get('beton')).toMatchObject({ miktar: 800, dayanak: 'İnşaat alanı 2.000 m² × 0,4 m³/m²' });
    expect(r.get('demir')!.miktar).toBe(88);
    expect(r.get('kazi')).toMatchObject({ miktar: 1600, dayanak: 'Taban 400 m² × 4 m derinlik (1 bodrum + 1 m temel) × 1 m³/m³' });
    expect(r.get('cephe' as string)).toBeUndefined();
    expect(r.get('mantolama')!.dayanak).toContain('çevre 80 m (tahmini) × 5 kat × 3 m');
    expect(r.get('asansor')!.miktar).toBe(1);
    expect(r.get('seramik_yapistirici')!.dayanak).toMatch(/^\(.+ \+ .+\) × 0,2 torba\/m²$/);
    const k = formulleriHesapla(G, new Map([['beton', 0.5]]), new Map([['beton', 'Hazır beton']]));
    expect(k.get('demir')).toMatchObject({ miktar: 110, dayanak: 'Hazır beton 1.000 × 0,11 ton/m³' });
  });

  it('girdi eksikse miktar yok, hangi girdinin eksik olduğu yazar', () => {
    const r = formulleriHesapla({ ...G, insaatAlani: null, katYuksekligi: null });
    expect(r.get('beton')).toMatchObject({ miktar: null, dayanak: 'Girdi eksik: Toplam inşaat alanı' });
    expect(r.get('demir')!.miktar).toBeNull();
    expect(r.get('kazi')!.dayanak).toBe('Girdi eksik: Kat yüksekliği');
    expect(formulleriHesapla({ ...G, bodrumKatSayisi: 0, katYuksekligi: null }).get('kazi')!.miktar).toBe(400);
  });

  it('satırları günceller: formül satırı yeniden, elle satır olduğu gibi', () => {
    const l = satirlariGuncelle(G, [
      satir({ katsayi: 0.45 }),
      satir({ id: 's2', miktarKaynagi: 'elle', formulKodu: null, miktar: 12, dayanak: 'Usta tahmini' }),
    ]);
    expect(l[0]).toMatchObject({ miktar: 900, dayanak: 'İnşaat alanı 2.000 m² × 0,45 m³/m²' });
    expect(l[1]).toMatchObject({ miktar: 12, dayanak: 'Usta tahmini' });
  });

  it('özet: tür toplamları, KDV, özel fiyat, dondurulan, fiyatsız ve miktarsız', () => {
    const katalog = new Map([
      ['k1', kalem('k1', 330000)],
      ['k2', kalem('k2', 15000, 0)],
      ['k3', kalem('k3', null)],
    ]);
    const o = maliyetOzeti(
      {
        girdiler: G,
        satirlar: [
          satir({ miktar: 10 }),
          satir({ id: 's2', fiyatKalemiId: 'k2', tur: 'iscilik', miktar: 100, butceKalemiKodu: 'siva' }),
          satir({ id: 's3', fiyatKalemiId: 'k3', miktar: 5 }),
          satir({ id: 's4', fiyatKalemiId: 'k3', miktar: 2, ozelFiyat: 1000 }),
          satir({ id: 's5', fiyatKalemiId: 'k1', miktar: null }),
          satir({ id: 's6', fiyatKalemiId: 'k1', miktar: 1, dondurulan: { fiyat: 300000, kaynak: 'elle', tarih: '2026-01-01', kdvOrani: 10 } }),
          satir({ id: 's7', fiyatKalemiId: null, tur: 'makine', miktar: 3, ozelFiyat: 500000 }),
        ],
      },
      katalog,
    );
    expect(o.turler.malzeme).toEqual({ tutar: 3300000 + 2000 + 300000, kdv: 660000 + 400 + 30000, satir: 5 });
    expect(o.turler.iscilik).toEqual({ tutar: 1500000, kdv: 0, satir: 1 });
    expect(o.turler.makine.tutar).toBe(1500000);
    expect(o.toplam).toBe(3602000 + 1500000 + 1500000);
    expect(o.fiyatsiz.map((x) => x.satir.id)).toEqual(['s3']);
    expect(o.miktarsiz.map((x) => x.satir.id)).toEqual(['s5']);
    expect(o.butceKalemleri.get('siva')).toBe(1500000);
    expect(o.m2Basina).toBe(Math.round(o.toplam / 2000));
    expect(o.satirlar[3]!.fiyat.kaynak).toBe('ozel');
  });

  it('satır denetimi: elle satırda dayanak ve miktar zorunlu', () => {
    expect(satirHatalari([satir({ miktarKaynagi: 'elle', formulKodu: null, miktar: null, dayanak: ' ' })])).toEqual([
      'Beton: elle girilen miktarın dayanağını yazın (ölçü, teklif, usta tahmini…).',
      'Beton: miktarı yazın.',
    ]);
    expect(satirHatalari([satir({ miktar: -1 }), satir({ ad: '', birim: '' })])).toEqual(['Beton: miktar eksi olamaz.', 'Satırın adını yazın.', 'Adsız satır: birimi yazın.']);
  });
});
