import { sonAlis, sonSozlesme, type AlisSatiri, type FiyatOnerisi, type SozlesmeFiyati } from '../hesap/fiyat';
import type { Depo } from '../veri/depo';
import { bosSabitId } from '../veri/kimlik';
import { HAZIR_FIYAT_KALEMLERI } from '../veri/sabit/hazirFiyatKalemleri';
import type { FiyatArastirmasi, FiyatKaynagi, FiyatKalemi, Kurus, Tarih } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Malzeme / işçilik / makine fiyat kataloğu (şema 21). Her kalem ayrı fiyatlanır; fiyatın kaynağı ve tarihi tutulur.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Hazır listede olup firmada bulunmayanları ekler (bir kez; iptal edilen hazır kalem yeniden eklenmez).
 * Yazma yetkisi olmayan kişide eklenmez. Kimlik sistem kodundan: iki cihazda ayrı eklense de tek kayıt.
 */
export async function hazirFiyatKalemleriniEkle(depo: Depo, servis: KayitServisi): Promise<number> {
  const firmaId = servis.oturum.firmaId;
  if (!(await servis.yazabilir('fiyatKalemi'))) return 0;
  return depo.islem(async () => {
    const mevcut = new Set((await depo.listele('fiyatKalemi', { firmaId })).map((k) => k.sistemKodu));
    let sayi = 0;
    for (const h of HAZIR_FIYAT_KALEMLERI) {
      if (mevcut.has(h.kod)) continue;
      await servis.ekle(
        'fiyatKalemi',
        {
          tur: h.tur,
          ad: h.ad,
          birim: h.birim,
          butceKalemiKodu: h.butceKalemiKodu,
          aciklama: h.aciklama ?? '',
          sistemKodu: h.kod,
          ustaTipiKodu: h.ustaTipiKodu ?? null,
          fiyat: null,
          kdvOrani: h.tur === 'iscilik' ? 0 : 20,
          fiyatTarihi: null,
          fiyatKaynagi: null,
          kaynakNotu: '',
          arastirma: null,
          arastirilacak: false,
        },
        await bosSabitId((id) => depo.getir('fiyatKalemi', id), firmaId, 'fiyatKalemi', h.kod),
      );
      sayi++;
    }
    return sayi;
  });
}

export async function fiyatKalemleri(depo: Depo, firmaId: string): Promise<FiyatKalemi[]> {
  return aktif(await depo.listele('fiyatKalemi', { firmaId }));
}

export async function fiyatKalemiGetir(depo: Depo, firmaId: string, id: string): Promise<FiyatKalemi> {
  const k = await depo.getir('fiyatKalemi', id);
  if (!k || k.firmaId !== firmaId || k.iptal) throw new IsKuraliHatasi('Kalem bulunamadı.');
  return k;
}

export interface FiyatKalemiGirdisi {
  tur: FiyatKalemi['tur'];
  ad: string;
  birim: string;
  butceKalemiKodu: string | null;
  aciklama: string;
  kdvOrani: number;
}

function girdiDenetle(g: FiyatKalemiGirdisi): FiyatKalemiGirdisi {
  const ad = g.ad.trim();
  const birim = g.birim.trim();
  const hatalar: string[] = [];
  if (!ad) hatalar.push('Kalemin adını yazın.');
  if (!birim) hatalar.push('Birimi yazın (m³, ton, adet…).');
  if (!Number.isFinite(g.kdvOrani) || g.kdvOrani < 0 || g.kdvOrani > 100) hatalar.push('KDV oranı 0–100 arası olmalı.');
  if (hatalar.length) throw new IsKuraliHatasi(hatalar.join(' '));
  return { ...g, ad, birim, aciklama: g.aciklama.trim() };
}

export async function fiyatKalemiEkle(depo: Depo, servis: KayitServisi, g: FiyatKalemiGirdisi): Promise<FiyatKalemi> {
  const d = girdiDenetle(g);
  return depo.islem(async () =>
    servis.ekle('fiyatKalemi', {
      ...d,
      sistemKodu: null,
      ustaTipiKodu: null,
      fiyat: null,
      fiyatTarihi: null,
      fiyatKaynagi: null,
      kaynakNotu: '',
      arastirma: null,
      arastirilacak: false,
    }),
  );
}

export async function fiyatKalemiGuncelle(depo: Depo, servis: KayitServisi, id: string, g: FiyatKalemiGirdisi): Promise<FiyatKalemi> {
  await fiyatKalemiGetir(depo, servis.oturum.firmaId, id);
  const d = girdiDenetle(g);
  return depo.islem(async () => servis.guncelle('fiyatKalemi', id, d));
}

export interface FiyatGirisi {
  fiyat: Kurus;
  kaynak: FiyatKaynagi;
  /** Firma adı, bağlantı, teklif no… */
  not: string;
  tarih: Tarih;
}

/** Fiyat yazılır (KDV hariç, kalemin biriminde); "araştırılacak" işareti kalkar. */
export async function fiyatGir(depo: Depo, servis: KayitServisi, id: string, g: FiyatGirisi, bugun: Tarih): Promise<FiyatKalemi> {
  await fiyatKalemiGetir(depo, servis.oturum.firmaId, id);
  const hatalar: string[] = [];
  if (!Number.isInteger(g.fiyat) || g.fiyat <= 0) hatalar.push('Fiyatı yazın.');
  if (!TARIH.test(g.tarih)) hatalar.push('Fiyat tarihini girin.');
  else if (g.tarih > bugun) hatalar.push('Fiyat tarihi bugünden sonra olamaz.');
  if (hatalar.length) throw new IsKuraliHatasi(hatalar.join(' '));
  return depo.islem(async () =>
    servis.guncelle('fiyatKalemi', id, { fiyat: g.fiyat, fiyatKaynagi: g.kaynak, kaynakNotu: g.not.trim(), fiyatTarihi: g.tarih, arastirilacak: false }),
  );
}

/** Fiyatı siler (bilinmiyor); geçmişte kalır. */
export async function fiyatiKaldir(depo: Depo, servis: KayitServisi, id: string): Promise<FiyatKalemi> {
  await fiyatKalemiGetir(depo, servis.oturum.firmaId, id);
  return depo.islem(async () => servis.guncelle('fiyatKalemi', id, { fiyat: null, fiyatKaynagi: null, kaynakNotu: '', fiyatTarihi: null }));
}

export async function arastirilacakIsaretle(depo: Depo, servis: KayitServisi, idler: string[], deger: boolean): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    for (const id of idler) {
      const k = await fiyatKalemiGetir(depo, firmaId, id);
      if (k.arastirilacak !== deger) await servis.guncelle('fiyatKalemi', id, { arastirilacak: deger });
    }
  });
}

/** Yapay zekâ araştırmasının sonucu kaleme yazılır; fiyat değişmez (kullanıcı önerileni ya da başka değeri onaylar). */
export async function arastirmaKaydet(depo: Depo, servis: KayitServisi, sonuclar: Map<string, FiyatArastirmasi>): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    for (const [id, a] of sonuclar) {
      await fiyatKalemiGetir(depo, firmaId, id);
      await servis.guncelle('fiyatKalemi', id, { arastirma: a });
    }
  });
}

export async function fiyatKalemiIptal(depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  await depo.islem(async () => {
    await servis.iptal('fiyatKalemi', id);
  });
}

/**
 * Programdaki kayıtlardan fiyat önerileri: malzeme/makinede giderlerin son alışı (hakediş giderleri ve iadeler hariç),
 * işçilikte imzalı usta sözleşmelerinin son birim fiyatı. Sonuç kalem kimliğine göre.
 */
export async function fiyatOnerileri(depo: Depo, firmaId: string, kalemler: FiyatKalemi[]): Promise<Map<string, FiyatOnerisi>> {
  const [giderler, satirlar, cariler, sozlesmeler, tipler] = await Promise.all([
    depo.listele('gider', { firmaId }),
    depo.listele('giderSatiri', { firmaId }),
    depo.listele('cari', { firmaId }),
    depo.listele('ustaSozlesmesi', { firmaId }),
    depo.listele('ustaTipi', { firmaId }),
  ]);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const alisGideri = new Map(aktif(giderler).filter((g) => g.tur === 'alis' && !g.hakedisId).map((g) => [g.id, g]));
  const alislar: AlisSatiri[] = [];
  for (const s of aktif(satirlar)) {
    const g = alisGideri.get(s.giderId);
    if (!g) continue;
    alislar.push({ tarih: g.tarih, aciklama: s.aciklama, birim: s.birim, birimFiyat: s.birimFiyat, miktar: s.miktar, kdvHaricTutar: s.kdvHaricTutar, cariAdi: g.cariId ? (cariAdi.get(g.cariId) ?? null) : null });
  }
  const tipKodu = new Map(tipler.map((t) => [t.id, t.sistemKodu]));
  const sozlesmeFiyatlari: SozlesmeFiyati[] = [];
  for (const s of aktif(sozlesmeler)) {
    if (!s.onay) continue;
    const tarih = s.sozlesmeTarihi ?? s.onay.zaman.slice(0, 10);
    for (const k of s.kalemler) {
      if (k.birimFiyat === null || k.birimFiyat <= 0) continue;
      sozlesmeFiyatlari.push({ tarih, ustaTipiKodu: tipKodu.get(k.ustaTipiId) ?? null, ad: k.ad, birim: k.birim, birimFiyat: k.birimFiyat, cariAdi: cariAdi.get(s.cariId) ?? 'Usta' });
    }
  }
  const sonuc = new Map<string, FiyatOnerisi>();
  for (const k of kalemler) {
    const o = k.tur === 'iscilik' ? sonSozlesme(k, sozlesmeFiyatlari) : sonAlis(k, alislar);
    if (o) sonuc.set(k.id, o);
  }
  return sonuc;
}
