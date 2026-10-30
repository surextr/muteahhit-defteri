import type { Hava, Kurus, PuantajDurumu, PuantajSatiri, SantiyeGunlugu, Tarih } from '../veri/tipler';

// Şantiye günlüğü ve puantaj (saf): yevmiye tutarı, aylık puantaj özeti, giderine yazılmamış yevmiyeler, kayıt denetimi.

export const HAVA: Record<Hava, { simge: string; ad: string }> = {
  gunesli: { simge: '☀️', ad: 'Güneşli' },
  parcali: { simge: '⛅', ad: 'Parçalı bulutlu' },
  bulutlu: { simge: '☁️', ad: 'Bulutlu' },
  yagmurlu: { simge: '🌧️', ad: 'Yağmurlu' },
  karli: { simge: '❄️', ad: 'Karlı' },
  ruzgarli: { simge: '💨', ad: 'Rüzgârlı' },
  sisli: { simge: '🌫️', ad: 'Sisli' },
};

export const PUANTAJ_DURUMU: Record<PuantajDurumu, { ad: string; kisa: string; gun: number }> = {
  tam: { ad: 'Tam gün', kisa: '✓', gun: 1 },
  yarim: { ad: 'Yarım gün', kisa: '½', gun: 0.5 },
  yok: { ad: 'Gelmedi', kisa: '–', gun: 0 },
};

/** Mesai saat ücreti verilmemişse yevmiye / 8 × 1,5. */
export const mesaiSaatUcreti = (s: Pick<PuantajSatiri, 'yevmiye' | 'mesaiUcreti'>): Kurus => s.mesaiUcreti ?? Math.round((s.yevmiye / 8) * 1.5);

export function puantajTutari(s: Pick<PuantajSatiri, 'durum' | 'yevmiye' | 'mesaiSaat' | 'mesaiUcreti'>): Kurus {
  return Math.round(s.yevmiye * PUANTAJ_DURUMU[s.durum].gun) + Math.round(s.mesaiSaat * mesaiSaatUcreti(s));
}

export interface PuantajKisiOzeti {
  cariId: string;
  gun: number;
  mesaiSaat: number;
  tutar: Kurus;
  /** Gidere yazılmamış satırlar ve tutarları. */
  yazilmamis: { gunlukId: string; satirId: string; tarih: Tarih; tutar: Kurus }[];
  yazilmamisTutar: Kurus;
  /** Gün → durum (aynı gün iki kayıt olmaz). */
  gunler: Map<Tarih, PuantajDurumu>;
}

/**
 * `ay` ('YYYY-AA') verilirse yalnız o ayın günlükleri. `aktifGiderler`: iptal edilmemiş giderlerin kimlikleri (iptal
 * edilmiş gidere yazılmış satır yazılmamış sayılır).
 */
export function puantajOzeti(gunlukler: SantiyeGunlugu[], aktifGiderler: ReadonlySet<string>, ay?: string): PuantajKisiOzeti[] {
  const kisiler = new Map<string, PuantajKisiOzeti>();
  for (const g of gunlukler) {
    if (g.iptal || (ay && !g.tarih.startsWith(ay))) continue;
    for (const s of g.puantaj) {
      const k: PuantajKisiOzeti = kisiler.get(s.cariId) ?? { cariId: s.cariId, gun: 0, mesaiSaat: 0, tutar: 0, yazilmamis: [], yazilmamisTutar: 0, gunler: new Map() };
      const tutar = puantajTutari(s);
      k.gun += PUANTAJ_DURUMU[s.durum].gun;
      k.mesaiSaat += s.mesaiSaat;
      k.tutar += tutar;
      k.gunler.set(g.tarih, s.durum);
      if (tutar > 0 && !(s.giderId && aktifGiderler.has(s.giderId))) {
        k.yazilmamis.push({ gunlukId: g.id, satirId: s.id, tarih: g.tarih, tutar });
        k.yazilmamisTutar += tutar;
      }
      kisiler.set(s.cariId, k);
    }
  }
  return [...kisiler.values()];
}

export type GunlukIcerigi = Pick<SantiyeGunlugu, 'hava' | 'sicaklik' | 'calisilmadi' | 'yapilanIsler' | 'ekipler' | 'puantaj' | 'sorunlar' | 'not'>;

export function gunlukHatalari(g: GunlukIcerigi): string[] {
  const h: string[] = [];
  if (g.sicaklik !== null && (!Number.isFinite(g.sicaklik) || g.sicaklik < -50 || g.sicaklik > 60)) h.push('Sıcaklık geçersiz.');
  for (const e of g.ekipler) {
    if (!e.cariId && !e.ad.trim()) h.push('Ekibin adını yazın ya da cariyi seçin.');
    if (!Number.isInteger(e.kisi) || e.kisi < 0 || e.kisi > 999) h.push('Ekip kişi sayısı geçersiz.');
  }
  const kisiler = new Set<string>();
  for (const p of g.puantaj) {
    if (!p.cariId) h.push('Puantajda işçiyi seçin.');
    else if (kisiler.has(p.cariId)) h.push('Aynı işçi bir günde iki kez yazılmış.');
    kisiler.add(p.cariId);
    if (!Number.isInteger(p.yevmiye) || p.yevmiye < 0) h.push('Yevmiye geçersiz.');
    if (p.durum !== 'yok' && p.yevmiye === 0) h.push('Çalışan işçinin yevmiyesini yazın.');
    if (!Number.isFinite(p.mesaiSaat) || p.mesaiSaat < 0 || p.mesaiSaat > 16) h.push('Mesai saati geçersiz.');
    if (p.mesaiUcreti !== null && (!Number.isInteger(p.mesaiUcreti) || p.mesaiUcreti < 0)) h.push('Mesai ücreti geçersiz.');
  }
  return [...new Set(h)];
}

/** Günlüğün kısa özeti (liste): "☀️ 18° · 4 işçi · 3 ekip 11 kişi". */
export function gunlukOzeti(g: Pick<SantiyeGunlugu, 'hava' | 'sicaklik' | 'calisilmadi' | 'ekipler' | 'puantaj'>): string {
  const calisan = g.puantaj.filter((p) => p.durum !== 'yok').length;
  const kisi = g.ekipler.reduce((t, e) => t + e.kisi, 0);
  return [
    g.hava ? `${HAVA[g.hava].simge}${g.sicaklik !== null ? ` ${g.sicaklik}°` : ''}` : g.sicaklik !== null ? `${g.sicaklik}°` : null,
    g.calisilmadi ? 'çalışılmadı' : null,
    calisan ? `${calisan} işçi` : null,
    g.ekipler.length ? `${g.ekipler.length} ekip${kisi ? ` ${kisi} kişi` : ''}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
