import { aramaAnahtari } from '../hesap/metin';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { HAZIR_KALEM_KODU } from '../veri/sabit/hazirKalemKodlari';
import { HAKEDIS_SEKLI_ADI, HAZIR_ORTAK_MADDELER, HAZIR_USTA_TIPLERI } from '../veri/sabit/hazirUstaTipleri';
import type { Firma, OrtakMadde, UstaTipi } from '../veri/tipler';
import { firmaAyariDegistir } from './firma';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Usta tipleri ve kalem şablonları. Hazır tipler ilk açılışta bir kez eklenir (eksik olan tamamlanır, var olana
// dokunulmaz); firma bunları kendi yöresine göre değiştirir. Her değişiklik şablon sürümünü bir artırır.
// Ayar niteliğindedir: gerekçe istenmez, geçmişe yazılır.

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);

/** Eksik hazır tipleri ekler (sistem koduyla eşleşir; gizlenmiş tip yeniden eklenmez). Dönüş: eklenen sayısı. */
export async function hazirUstaTipleriniEkle(depo: Depo, servis: KayitServisi): Promise<number> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const mevcut = new Set(aktif(await depo.listele('ustaTipi', { firmaId })).map((u) => u.sistemKodu));
    let sayi = 0;
    for (const h of HAZIR_USTA_TIPLERI) {
      if (mevcut.has(h.kod)) continue;
      await servis.ekle('ustaTipi', {
        ad: h.ad,
        sistemKodu: h.kod,
        fiyatlamaBirimi: h.fiyatlamaBirimi,
        butceKalemiKodu: h.butceKalemiKodu,
        hakedisSekli: h.hakedisSekli,
        kalemler: h.kalemler.map((k) => ({ ad: k.ad, birim: k.birim, aciklama: k.aciklama ?? '' })),
        sorular: h.sorular.map((s) => ({ ...s })),
        ozelSartlar: [...h.ozelSartlar],
        kapaliOrtakMaddeler: [...(h.kapaliOrtakMaddeler ?? [])],
        sablonSurumu: 1,
        gizli: false,
      });
      sayi++;
    }
    return sayi;
  });
}

/** Firmanın usta tipleri, ada göre; gizliler dahil (ekran ayırır). */
export async function ustaTipleriListele(depo: Depo, firmaId: string): Promise<UstaTipi[]> {
  return aktif(await depo.listele('ustaTipi', { firmaId })).sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
}

export async function ustaTipiGetir(depo: Depo, firmaId: string, id: string): Promise<UstaTipi | null> {
  const u = await depo.getir('ustaTipi', id);
  return u && u.firmaId === firmaId && !u.iptal ? u : null;
}

export type UstaTipiGirdisi = Pick<
  UstaTipi,
  'ad' | 'fiyatlamaBirimi' | 'butceKalemiKodu' | 'hakedisSekli' | 'kalemler' | 'sorular' | 'ozelSartlar' | 'kapaliOrtakMaddeler'
>;

function temizle(g: UstaTipiGirdisi): UstaTipiGirdisi {
  return {
    ad: g.ad.trim().replace(/\s+/g, ' '),
    fiyatlamaBirimi: g.fiyatlamaBirimi.trim(),
    butceKalemiKodu: g.butceKalemiKodu || null,
    hakedisSekli: g.hakedisSekli,
    kalemler: g.kalemler.map((k) => ({ ad: k.ad.trim(), birim: k.birim.trim(), aciklama: k.aciklama.trim() })).filter((k) => k.ad),
    sorular: g.sorular.map((s) => ({ soru: s.soru.trim(), varsayilan: s.varsayilan })).filter((s) => s.soru),
    ozelSartlar: g.ozelSartlar.map((s) => s.trim()).filter(Boolean),
    kapaliOrtakMaddeler: [...new Set(g.kapaliOrtakMaddeler)],
  };
}

function hatalar(g: UstaTipiGirdisi): string[] {
  const h: string[] = [];
  if (!g.ad) h.push('Usta tipinin adını yazın.');
  if (!g.fiyatlamaBirimi) h.push('Fiyatlama birimini yazın (m², daire, götürü…).');
  if (!(g.hakedisSekli in HAKEDIS_SEKLI_ADI)) h.push('Hakediş şeklini seçin.');
  if (g.butceKalemiKodu && !Object.values(HAZIR_KALEM_KODU).includes(g.butceKalemiKodu)) h.push('Bütçe kalemi bulunamadı.');
  if (g.kalemler.some((k) => !k.birim)) h.push('Her kalemin birimini yazın.');
  return h;
}

/** Yeni tip açar (id yoksa) ya da günceller; güncellemede şablon sürümü bir artar. */
export async function ustaTipiKaydet(depo: Depo, servis: KayitServisi, id: string | null, girdi: UstaTipiGirdisi): Promise<UstaTipi> {
  const g = temizle(girdi);
  const h = hatalar(g);
  if (h.length > 0) throw new IsKuraliHatasi(h.join(' '));
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const digerleri = aktif(await depo.listele('ustaTipi', { firmaId })).filter((u) => u.id !== id);
    if (digerleri.some((u) => aramaAnahtari(u.ad) === aramaAnahtari(g.ad))) throw new IsKuraliHatasi(`"${g.ad}" adında bir usta tipi zaten var.`);
    if (!id) return servis.ekle('ustaTipi', { ...g, sistemKodu: null, sablonSurumu: 1, gizli: false });
    const mevcut = await ustaTipiGetir(depo, firmaId, id);
    if (!mevcut) throw new IsKuraliHatasi('Usta tipi bulunamadı.');
    return servis.guncelle('ustaTipi', id, { ...g, sablonSurumu: mevcut.sablonSurumu + 1 });
  });
}

export async function ustaTipiGizle(depo: Depo, servis: KayitServisi, id: string, gizli: boolean): Promise<void> {
  const mevcut = await ustaTipiGetir(depo, servis.oturum.firmaId, id);
  if (!mevcut) throw new IsKuraliHatasi('Usta tipi bulunamadı.');
  await servis.guncelle('ustaTipi', id, { gizli });
}

/** "Şu tipten kopyala": yeni tip için başlangıç girdisi. */
export function ustaTipiKopyasi(u: UstaTipi, ad: string): UstaTipiGirdisi {
  return {
    ad,
    fiyatlamaBirimi: u.fiyatlamaBirimi,
    butceKalemiKodu: u.butceKalemiKodu,
    hakedisSekli: u.hakedisSekli,
    kalemler: u.kalemler.map((k) => ({ ...k })),
    sorular: u.sorular.map((s) => ({ ...s })),
    ozelSartlar: [...u.ozelSartlar],
    kapaliOrtakMaddeler: [...u.kapaliOrtakMaddeler],
  };
}

// ─── Ortak sözleşme maddeleri ──────────────────────────────────────

export const ortakMaddeler = (firma: Firma): OrtakMadde[] => firma.ayarlar.ortakMaddeler ?? HAZIR_ORTAK_MADDELER;

/** Listeyi kaydeder; yeni maddeye kalıcı kimlik verilir, var olanın kimliği korunur. */
export async function ortakMaddeleriKaydet(servis: KayitServisi, firma: Firma, maddeler: { id: string | null; metin: string }[]): Promise<Firma> {
  const temiz = maddeler.map((m) => ({ id: m.id ?? `m_${yeniId()}`, metin: m.metin.trim() })).filter((m) => m.metin);
  if (new Set(temiz.map((m) => aramaAnahtari(m.metin))).size !== temiz.length) throw new IsKuraliHatasi('Aynı madde iki kez yazılmış.');
  return firmaAyariDegistir(servis, firma, { ortakMaddeler: temiz });
}
