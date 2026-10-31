import { aramaAnahtari } from './metin';
import type { Hakedis, Kalem, KalemIlerlemesi, Kurus, TakipBasligi, UstaSozlesmesi } from '../veri/tipler';
import type { ButceOzeti } from './butce';
import { isButceKodu } from './hakedis';

/**
 * İlerleme takibi (saf). Ana kalemin tamamlanma yüzdesi elle girilir (ya da hakedişten önerilip onaylanır);
 * proje ilerlemesi bütçe ağırlıklı ortalamadır. Harcama ilerlemenin eşikten fazla önüne geçince erken uyarı verilir.
 */

/** Harcama yüzdesi ilerleme yüzdesini bu kadar puandan fazla geçerse uyarı (varsayılan; firma ayarı `ilerlemeUyariEsigi`). */
export const ILERLEME_UYARI_ESIGI = 10;

export const uyariEsigi = (ayarlar: { ilerlemeUyariEsigi?: number }): number => ayarlar.ilerlemeUyariEsigi ?? ILERLEME_UYARI_ESIGI;

/** Kalem başına geçerli kayıt: en yeni tarihli, eşitse en son girilen; iptal edilenler sayılmaz. */
export function gecerliIlerlemeler(kayitlar: KalemIlerlemesi[]): Map<string, KalemIlerlemesi> {
  const sonuc = new Map<string, KalemIlerlemesi>();
  for (const k of kayitlar) {
    if (k.iptal !== null) continue;
    const onceki = sonuc.get(k.kalemId);
    if (!onceki || k.tarih > onceki.tarih || (k.tarih === onceki.tarih && k.olusturmaZamani >= onceki.olusturmaZamani)) sonuc.set(k.kalemId, k);
  }
  return sonuc;
}

/** Kalemin kayıtları, yeniden eskiye (geçmiş listesi için). */
export function kalemGecmisi(kayitlar: KalemIlerlemesi[], kalemId: string): KalemIlerlemesi[] {
  return kayitlar.filter((k) => k.kalemId === kalemId).sort((a, b) => b.tarih.localeCompare(a.tarih) || b.olusturmaZamani.localeCompare(a.olusturmaZamani));
}

export interface KalemIlerlemeSatiri {
  kalem: Kalem;
  /** Ana kalemin bütçesi (alt kalemlerin toplamı); yoksa null. */
  butce: Kurus | null;
  harcanan: Kurus;
  /** Girilmiş yüzde; hiç girilmediyse null. */
  yuzde: number | null;
  /** Geçerli kaydın tarihi. */
  tarih: string | null;
  /** harcanan / bütçe × 100; bütçe yoksa null. */
  harcamaYuzdesi: number | null;
  /** Harcama yüzdesi − ilerleme yüzdesi; hesaplanamıyorsa null. */
  fark: number | null;
  uyari: boolean;
}

export interface ProjeIlerlemesi {
  kalemler: KalemIlerlemeSatiri[];
  butce: Kurus;
  harcanan: Kurus;
  /** Bütçe ağırlıklı genel ilerleme; bütçe ya da hiç ilerleme girişi yoksa null. */
  ilerleme: number | null;
  /** Toplam harcanan / toplam bütçe; bütçe yoksa null. */
  harcamaYuzdesi: number | null;
  fark: number | null;
  uyari: boolean;
  /** Projede en az bir ilerleme girişi var mı. */
  girildi: boolean;
}

/**
 * Proje ve ana kalem düzeyinde ilerleme ve harcama. Projede hiç ilerleme girilmemişse yüzdeler boş kalır ve uyarı
 * verilmez; girildiyse yüzdesi girilmemiş ana kalem %0 sayılır (henüz başlamadı).
 */
export function projeIlerlemesi(butce: ButceOzeti, yuzdeler: Map<string, KalemIlerlemesi>, esik = ILERLEME_UYARI_ESIGI): ProjeIlerlemesi {
  const girildi = butce.dugumler.some((d) => yuzdeler.has(d.kalem.id));
  const kalemler = butce.dugumler.map((d): KalemIlerlemeSatiri => {
    const k = yuzdeler.get(d.kalem.id);
    const yuzde = k ? k.yuzde : null;
    const harcamaYuzdesi = d.butce ? (d.gerceklesen * 100) / d.butce : null;
    const etkin = yuzde ?? (girildi ? 0 : null);
    const fark = harcamaYuzdesi !== null && etkin !== null ? harcamaYuzdesi - etkin : null;
    return {
      kalem: d.kalem,
      butce: d.butce,
      harcanan: d.gerceklesen,
      yuzde,
      tarih: k?.tarih ?? null,
      harcamaYuzdesi,
      fark,
      uyari: fark !== null && fark > esik,
    };
  });
  const butceli = kalemler.filter((k) => k.butce !== null && k.butce > 0);
  const toplamButce = butceli.reduce((t, k) => t + k.butce!, 0);
  const ilerleme = girildi && toplamButce > 0 ? butceli.reduce((t, k) => t + k.butce! * (k.yuzde ?? 0), 0) / toplamButce : null;
  const harcamaYuzdesi = butce.butce > 0 ? (butce.gerceklesen * 100) / butce.butce : null;
  const fark = ilerleme !== null && harcamaYuzdesi !== null ? harcamaYuzdesi - ilerleme : null;
  return { kalemler, butce: butce.butce, harcanan: butce.gerceklesen, ilerleme, harcamaYuzdesi, fark, uyari: fark !== null && fark > esik, girildi };
}

/** Devam eden takip başlığı: durumu 'devam' olanların sıraca ilki; birden çoksa "Kaba inşaat +1". */
export function devamEdenAsama(basliklar: TakipBasligi[]): string | null {
  const devam = basliklar.filter((t) => t.iptal === null && t.durum === 'devam').sort((a, b) => a.sira - b.sira);
  if (devam.length === 0) return null;
  return devam.length === 1 ? devam[0]!.ad : `${devam[0]!.ad} +${devam.length - 1}`;
}

export interface HakedisOnerisi {
  /** Ana kalem. */
  kalemId: string;
  /** Sözleşmelere göre yapılan iş / sözleşme tutarı × 100 (en çok 100). */
  yuzde: number;
  sozlesmeTutari: Kurus;
  yapilan: Kurus;
  /** Öneriye giren en yeni onaylı hakediş (kayda bağ olarak yazılır). */
  sonHakedisId: string | null;
  sozlesmeSayisi: number;
}

export interface KalemSozlesmeToplami {
  /** İmzalı sözleşmelerde bu ana kaleme düşen iş (miktarlı kalemler, aşama tutarları; KDV hariç). */
  sozlesme: Kurus;
  /** Onaylı hakedişlerde yapılan iş (ilave iş hariç). */
  yapilan: Kurus;
  sonHakedis: Hakedis | null;
  sozlesmeler: Set<string>;
}

/** İmzalı usta sözleşmelerinin ve onaylı hakedişlerinin ana kalem başına toplamları (öneri ve iş sonu tahmini için). */
export function kalemSozlesmeToplamlari(kalemler: Kalem[], sozlesmeler: UstaSozlesmesi[], hakedisler: Hakedis[]): Map<string, KalemSozlesmeToplami> {
  const aktifKalemler = kalemler.filter((k) => k.iptal === null);
  const anaIdleri = new Set(aktifKalemler.filter((k) => k.ustKalemId === null).map((k) => k.id));
  const anaKalemi = new Map<string, string>();
  for (const k of aktifKalemler) {
    if (!k.sistemKodu) continue;
    const ana = k.ustKalemId === null ? k.id : k.ustKalemId;
    if (anaIdleri.has(ana)) anaKalemi.set(k.sistemKodu, ana);
  }

  type Toplam = KalemSozlesmeToplami;
  const toplamlar = new Map<string, Toplam>();
  const al = (kod: string | null, sozlesmeId: string): Toplam | null => {
    const ana = kod ? anaKalemi.get(kod) : undefined;
    if (!ana) return null;
    const t = toplamlar.get(ana) ?? { sozlesme: 0, yapilan: 0, sonHakedis: null, sozlesmeler: new Set<string>() };
    t.sozlesmeler.add(sozlesmeId);
    toplamlar.set(ana, t);
    return t;
  };

  const imzalilar = sozlesmeler.filter((s) => s.iptal === null && s.onay !== null);
  for (const s of imzalilar) {
    // Kalem ya da aşama hangi ana kaleme düşüyor; tutar takibinde iş kalemlerinin miktarlı toplamı sözleşme tutarıdır.
    const yontemi = new Map(s.bolumler.map((b) => [b.ustaTipiId, b]));
    for (const b of s.bolumler) {
      if (b.takipYontemi !== 'asama') continue;
      const t = al(isButceKodu(s.kalemler, b.ustaTipiId), s.id);
      if (t) t.sozlesme += b.asamalar.reduce((x, a) => x + a.tutar, 0);
    }
    for (const k of s.kalemler) {
      if (yontemi.get(k.ustaTipiId)?.takipYontemi === 'asama' || k.miktar === null) continue;
      const t = al(k.butceKalemiKodu ?? isButceKodu(s.kalemler, k.ustaTipiId), s.id);
      if (t) t.sozlesme += Math.round(k.miktar * k.birimFiyat);
    }
    for (const h of hakedisler) {
      if (h.sozlesmeId !== s.id || h.iptal !== null || h.onay === null) continue;
      for (const x of h.satirlar) {
        if (x.tur === 'ilave') continue;
        const t = al(x.butceKalemiKodu ?? isButceKodu(s.kalemler, x.ustaTipiId), s.id);
        if (!t) continue;
        t.yapilan += x.tutar;
        if (!t.sonHakedis || h.tarih > t.sonHakedis.tarih || (h.tarih === t.sonHakedis.tarih && h.no > t.sonHakedis.no)) t.sonHakedis = h;
      }
    }
  }
  return toplamlar;
}

/**
 * Hakedişten ilerleme önerisi: imzalı sözleşmelerde bu ana kaleme (ya da altlarına) bağlı işin tutarına göre
 * onaylı hakedişlerde yapılan iş. Metrajda miktarlı kalemler (miktar × birim fiyat), aşamalıda aşama tutarları
 * sözleşme tutarını verir; ilave işler sayılmaz. Miktarı belli olmayan iş öneriye girmez.
 */
export function hakedisOnerileri(kalemler: Kalem[], sozlesmeler: UstaSozlesmesi[], hakedisler: Hakedis[]): Map<string, HakedisOnerisi> {
  const toplamlar = kalemSozlesmeToplamlari(kalemler, sozlesmeler, hakedisler);
  const sonuc = new Map<string, HakedisOnerisi>();
  for (const [kalemId, t] of toplamlar) {
    if (t.sozlesme <= 0 || t.yapilan <= 0) continue;
    const yuzde = Math.min(100, Math.round((t.yapilan * 1000) / t.sozlesme) / 10);
    sonuc.set(kalemId, {
      kalemId,
      yuzde,
      sozlesmeTutari: t.sozlesme,
      yapilan: t.yapilan,
      sonHakedisId: t.sonHakedis?.id ?? null,
      sozlesmeSayisi: t.sozlesmeler.size,
    });
  }
  return sonuc;
}

/** Yüzde girişi denetimi: 0–100, en çok bir ondalık. */
export function yuzdeHatasi(yuzde: number | null): string | null {
  if (yuzde === null || Number.isNaN(yuzde)) return 'Yüzde yazın.';
  if (yuzde < 0 || yuzde > 100) return 'Yüzde 0 ile 100 arasında olmalı.';
  return null;
}

/** Ekranda yüzde: "%42" / "%42,5". */
export function yuzdeYaz(n: number | null): string {
  return n === null ? '—' : `%${n.toLocaleString('tr-TR', { maximumFractionDigits: n < 10 ? 1 : 0 })}`;
}

/**
 * Kalem ilerlemesi ile aynı adlı takip başlığının durumu çelişiyorsa uyarı: ilerlemesi olan kalemin başlığı "başlamadı",
 * %100 kalemin başlığı "tamamlanmadı" ya da tamamlanan başlığın kalemi %100 değil. Eşleşme ada göredir (Kaba inşaat, İnce inşaat…).
 */
export function takipCelismeleri(
  kalemler: { ad: string; yuzde: number | null }[],
  basliklar: { ad: string; durum: 'baslamadi' | 'devam' | 'tamamlandi'; iptal?: unknown }[],
): string[] {
  const anahtar = (a: string) => aramaAnahtari(a).trim();
  const sonuc: string[] = [];
  for (const b of basliklar) {
    if (b.iptal) continue;
    const k = kalemler.find((x) => anahtar(x.ad) === anahtar(b.ad));
    if (!k || k.yuzde === null) continue;
    const y = `%${k.yuzde.toLocaleString('tr-TR')}`;
    if (b.durum === 'baslamadi' && k.yuzde > 0) sonuc.push(`${b.ad} ${y} ilerlemiş, takip başlığı "Başlamadı" görünüyor.`);
    else if (b.durum !== 'tamamlandi' && k.yuzde >= 100) sonuc.push(`${b.ad} %100 ilerlemiş, takip başlığı tamamlanmadı.`);
    else if (b.durum === 'tamamlandi' && k.yuzde < 100) sonuc.push(`${b.ad} takip başlığı tamamlandı, ilerlemesi ${y}.`);
  }
  return sonuc;
}
