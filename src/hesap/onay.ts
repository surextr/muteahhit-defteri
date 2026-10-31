import type { FirmaAyarlari, Kurus, OnayAkisiAyari, OdemeOnayiDurumu, Rol } from '../veri/tipler';

// Onay akışı kuralları (saf). Akış kapalıysa hiçbir şey onaya takılmaz.

export const VARSAYILAN_ONAY_AKISI: OnayAkisiAyari = { acik: false, esik: 5_000_000, kontrol: false, odeme: true, hakedis: true };

export const onayAkisi = (a: Pick<FirmaAyarlari, 'onayAkisi'>): OnayAkisiAyari | null => (a.onayAkisi?.acik ? a.onayAkisi : null);

/** Bu tutardaki ödeme/hakediş onay akışına girer mi (rolden bağımsız). */
export const esikUstu = (a: OnayAkisiAyari | null, tur: 'odeme' | 'hakedis', tutar: Kurus) => !!a && a[tur] && tutar >= a.esik;

/** Kişi bu ödemeyi doğrudan yapabilir mi (yönetici her zaman). */
export const dogrudanOdeyebilir = (a: OnayAkisiAyari | null, rol: Rol, tutar: Kurus) => rol === 'yonetici' || !esikUstu(a, 'odeme', tutar);

export const ODEME_ONAYI_DURUMU_ADI: Record<OdemeOnayiDurumu, string> = {
  bekliyor: 'Onay bekliyor',
  kontrol_edildi: 'Kontrol edildi, onay bekliyor',
  onaylandi: 'Onaylandı, ödendi',
  reddedildi: 'Reddedildi',
  geri_cekildi: 'Geri çekildi',
};

export const acikTalimat = (d: OdemeOnayiDurumu) => d === 'bekliyor' || d === 'kontrol_edildi';

/** Onay akışı ayarı denetimi. */
export function onayAkisiHatalari(a: OnayAkisiAyari, muhasebeVar: boolean): string[] {
  const h: string[] = [];
  if (!Number.isInteger(a.esik) || a.esik < 0) h.push('Tutar eşiği geçersiz.');
  if (a.acik && !a.odeme && !a.hakedis) h.push('Onay akışında ödeme ya da hakedişten en az birini seçin.');
  if (a.acik && a.kontrol && !muhasebeVar) h.push('Kontrol adımı için firmada muhasebe rolünde bir kullanıcı olmalı.');
  return h;
}
