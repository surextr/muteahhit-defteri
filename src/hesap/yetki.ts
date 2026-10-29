import tanim from '../../sunucu/api/_ic/yetkiler.json';
import type { FirmaAyarlari, Rol, TabloAdi } from '../veri/tipler';

/**
 * Rol yetkileri (saf). Tanım sunucuyla ortak dosyada (sunucu/api/_ic/yetkiler.json): sunucu eşitlemede aynı kuralla
 * yazmayı reddeder. Yönetici her şeyi yapar; muhasebe ve şantiyenin yetkilerini yönetici Ayarlar'dan seçer
 * (`firma.ayarlar.rolYetkileri`), seçilmemişse varsayılan geçerlidir.
 */

export type Yetki = 'gider' | 'odeme' | 'kasa' | 'cari' | 'satis' | 'sozlesme' | 'ilerleme' | 'proje' | 'rapor' | 'belge' | 'ayar';
export type AyarlanabilirRol = Exclude<Rol, 'yonetici'>;

export interface YetkiTanimi {
  kod: Yetki;
  ad: string;
  aciklama: string;
}

export const YETKILER = tanim.yetkiler as YetkiTanimi[];
export const VARSAYILAN_YETKILER = tanim.varsayilan as Record<AyarlanabilirRol, Yetki[]>;
/** Tabloya yazmak için gereken yetkilerden biri; 'yonetici': yalnız yönetici, 'herkes': her üye. */
export const TABLO_YETKILERI = tanim.tablolar as Record<TabloAdi, Yetki[] | 'yonetici' | 'herkes'>;

export const ROL_ADI: Record<Rol, string> = { yonetici: 'Yönetici', muhasebe: 'Muhasebe', santiye: 'Şantiye' };

export function rolYetkileri(ayarlar: Pick<FirmaAyarlari, 'rolYetkileri'>, rol: Rol): Set<Yetki> {
  if (rol === 'yonetici') return new Set(YETKILER.map((y) => y.kod));
  return new Set((ayarlar.rolYetkileri?.[rol] as Yetki[] | undefined) ?? VARSAYILAN_YETKILER[rol]);
}

export function yetkiVar(ayarlar: Pick<FirmaAyarlari, 'rolYetkileri'>, rol: Rol, yetki: Yetki): boolean {
  return rolYetkileri(ayarlar, rol).has(yetki);
}

export function tabloyaYazabilir(ayarlar: Pick<FirmaAyarlari, 'rolYetkileri'>, rol: Rol, tablo: TabloAdi): boolean {
  if (rol === 'yonetici') return true;
  const gerek = TABLO_YETKILERI[tablo];
  if (gerek === 'herkes') return true;
  if (gerek === 'yonetici' || !gerek) return false;
  const var_ = rolYetkileri(ayarlar, rol);
  return gerek.some((y) => var_.has(y));
}

/** Hata mesajı için tabloya yazmayı sağlayan yetkilerin adları. */
export function gerekenYetkiAdlari(tablo: TabloAdi): string {
  const gerek = TABLO_YETKILERI[tablo];
  if (gerek === 'yonetici' || gerek === 'herkes' || !gerek) return 'Yönetici';
  return gerek.map((k) => YETKILER.find((y) => y.kod === k)?.ad ?? k).join(' ya da ');
}

/** Kişinin girebileceği projeler; null: bütün projeler (yönetici her zaman bütün projeler). */
export function projeErisimi(uyelik: { rol: Rol; projeIdleri: string[] | null }): Set<string> | null {
  return uyelik.rol === 'yonetici' || !uyelik.projeIdleri ? null : new Set(uyelik.projeIdleri);
}

/** Kaydın projesi kişinin projeleri içinde mi (projesiz kayıt her zaman). */
export function projeyeErisir(erisim: Set<string> | null, projeId: unknown): boolean {
  return !erisim || typeof projeId !== 'string' || erisim.has(projeId);
}
