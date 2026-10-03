import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { veriKatmaniniAc } from '../veri';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { HAZIR_USTA_TIPLERI } from '../veri/sabit/hazirUstaTipleri';
import { YAPRAK_KALEM_KODLARI } from '../veri/sabit/hazirKalemKodlari';
import type { Firma } from '../veri/tipler';
import { KayitServisi, type Oturum } from './kayitServisi';
import { ilkKurulum } from './kurulum';
import {
  hazirUstaTipleriniEkle,
  ortakMaddeleriKaydet,
  ortakMaddeler,
  ustaTipiGizle,
  ustaTipiKaydet,
  ustaTipiKopyasi,
  ustaTipleriListele,
} from './ustaTipi';

let depo: Depo;
let oturum: Oturum;
let servis: KayitServisi;

beforeEach(async () => {
  depo = await veriKatmaniniAc(`test-${yeniId()}`);
  oturum = await ilkKurulum(depo, { firmaAdi: 'Firma', kullaniciAdi: 'Yönetici' });
  servis = new KayitServisi(depo, oturum);
});
afterEach(() => depo.kapat());

describe('hazır usta tipleri', () => {
  it('21 tip bir kez eklenir; bütçe kalemi kodları hazır kalemlerde var', async () => {
    expect(HAZIR_USTA_TIPLERI).toHaveLength(21);
    // Gider ana kaleme yazılamaz: tipler ve satırlar yalnız yaprak kalemlere bağlı.
    const yaprak = new Set(YAPRAK_KALEM_KODLARI.map((k) => k.kod));
    for (const h of HAZIR_USTA_TIPLERI) {
      expect(yaprak.has(h.butceKalemiKodu!), h.kod).toBe(true);
      for (const k of h.kalemler) if (k.butceKalemiKodu) expect(yaprak.has(k.butceKalemiKodu), `${h.kod}: ${k.ad}`).toBe(true);
    }
    expect(yaprak.has('ince_insaat')).toBe(false);
    expect(yaprak.has('asansor')).toBe(true);
    expect(new Set(HAZIR_USTA_TIPLERI.map((h) => h.kod)).size).toBe(21);

    expect(await hazirUstaTipleriniEkle(depo, servis)).toBe(21);
    expect(await hazirUstaTipleriniEkle(depo, servis)).toBe(0);
    const kalipci = (await ustaTipleriListele(depo, oturum.firmaId)).find((u) => u.sistemKodu === 'kalipci')!;
    expect(kalipci).toMatchObject({ ad: 'Kalıpçı (demir işçiliği dahil)', hakedisSekli: 'beton_dokumu', butceKalemiKodu: 'kalip_isciligi', sablonSurumu: 1 });
    const asansor = (await ustaTipleriListele(depo, oturum.firmaId)).find((u) => u.sistemKodu === 'asansorcu')!;
    expect(asansor.kapaliOrtakMaddeler).toContain('bosluk');
  });
});

describe('usta tipi düzenleme', () => {
  it('güncelleme sürümü artırır; gizlenen tip yeniden eklenmez; aynı ad reddedilir', async () => {
    await hazirUstaTipleriniEkle(depo, servis);
    const duvarci = (await ustaTipleriListele(depo, oturum.firmaId)).find((u) => u.sistemKodu === 'duvarci')!;
    const g = ustaTipiKopyasi(duvarci, duvarci.ad);
    g.kalemler.push({ ad: 'Bims duvar 13,5', birim: 'm²', aciklama: '', butceKalemiKodu: null });
    const yeni = await ustaTipiKaydet(depo, servis, duvarci.id, g);
    expect(yeni.sablonSurumu).toBe(2);
    expect(yeni.kalemler.at(-1)!.ad).toBe('Bims duvar 13,5');

    await ustaTipiGizle(depo, servis, duvarci.id, true);
    expect(await hazirUstaTipleriniEkle(depo, servis)).toBe(0);

    await expect(ustaTipiKaydet(depo, servis, null, ustaTipiKopyasi(duvarci, 'duvarci'))).rejects.toThrow('zaten var');
    const kopya = await ustaTipiKaydet(depo, servis, null, ustaTipiKopyasi(duvarci, 'Gazbeton duvarcı'));
    expect(kopya).toMatchObject({ sistemKodu: null, sablonSurumu: 1, gizli: false });
    await expect(ustaTipiKaydet(depo, servis, null, { ...ustaTipiKopyasi(duvarci, 'X'), fiyatlamaBirimi: ' ' })).rejects.toThrow('Fiyatlama');
    await expect(ustaTipiKaydet(depo, servis, null, { ...ustaTipiKopyasi(duvarci, 'Y'), butceKalemiKodu: 'ince_insaat' })).rejects.toThrow('alt kalem');
    const su = (await ustaTipleriListele(depo, oturum.firmaId)).find((u) => u.sistemKodu === 'su_yalitimci')!;
    expect(su.kalemler.map((k) => k.butceKalemiKodu)).toEqual(['temel_yalitimi', 'cati_teras_yalitimi', 'islak_hacim_yalitimi']);
  });

  it('ortak maddeler: varsayılan 7, yeni maddeye kalıcı kimlik', async () => {
    const firma = async () => (await depo.getir('firma', oturum.firmaId)) as Firma;
    expect(ortakMaddeler(await firma()).map((m) => m.id)).toContain('bosluk');
    const liste = [...ortakMaddeler(await firma()), { id: null, metin: 'İş güvenliği ekipmanı' }];
    const f = await ortakMaddeleriKaydet(servis, await firma(), liste);
    expect(f.ayarlar.ortakMaddeler).toHaveLength(8);
    expect(f.ayarlar.ortakMaddeler.at(-1)!.id).toMatch(/^m_/);
    await expect(ortakMaddeleriKaydet(servis, f, [...f.ayarlar.ortakMaddeler, { id: null, metin: 'iş güvenliği ekipmanı' }])).rejects.toThrow('iki kez');
  });
});
