import { bolumNo } from '../hesap/bolum';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Belge, KayitTabloAdi, Tarih } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Belgeler: fiş, fatura, dekont, sözleşme, fotoğraf. Künye `belge` tablosunda (işlem geçmişine yazılır),
// dosyanın kendisi `belgeDosyasi` tablosunda (listeler hızlı açılsın diye ayrı; geçmişe yazılmaz).
// Belge silinmez, iptal edilir; dosyası yedekte kalır. Bağlı kayıt iptal edilince belgesi de iptal olur.

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

/** Belgenin bağlanabildiği kayıtlar (plan: proje, sözleşme, hakediş, fatura, daire; sözleşme/hakediş 2. aşamada). */
export type BelgeBagi = 'gider' | 'odeme' | 'cekSenet' | 'proje' | 'bagimsizBolum' | 'cari' | 'katKarsiligiSozlesme' | 'ilaveImalat';
const BAGLAR = new Set<string>(['gider', 'odeme', 'cekSenet', 'proje', 'bagimsizBolum', 'cari', 'katKarsiligiSozlesme', 'ilaveImalat']);

export const BELGE_TUR_ADI: Record<Belge['tur'], string> = {
  fis: 'Fiş',
  fatura: 'Fatura',
  dekont: 'Dekont',
  sozlesme: 'Sözleşme',
  fotograf: 'Fotoğraf',
  diger: 'Diğer',
};

/** Telefon fotoğrafı küçültülerek eklenir; bu sınır büyük PDF'ler içindir. */
export const EN_BUYUK_BELGE = 15 * 1024 * 1024;
/** Kabul edilen dosyalar: resim ve PDF (SVG değil: içinde betik olabilir). */
export const BELGE_KABUL = 'image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf';
const IZINLI = new Set(BELGE_KABUL.split(','));

export interface BelgeGirdisi {
  bagliTur: BelgeBagi;
  bagliId: string;
  tur: Belge['tur'];
  tarih: Tarih;
  ad: string;
  dosya: Blob;
}

async function bagliKayitDenetle(depo: Depo, firmaId: string, bagliTur: string, bagliId: string) {
  if (!BAGLAR.has(bagliTur)) throw new IsKuraliHatasi('Belge bu kayda bağlanamaz.');
  const kayit = await depo.getir(bagliTur as KayitTabloAdi, bagliId);
  if (!kayit || (kayit as { firmaId?: string }).firmaId !== firmaId || kayit.iptal) throw new IsKuraliHatasi('Belgenin bağlanacağı kayıt bulunamadı.');
}

/** Künye ve dosya tek işlemde. Dosya önceden (cihazda) küçültülmüş olmalıdır. */
export async function belgeEkle(depo: Depo, servis: KayitServisi, g: BelgeGirdisi): Promise<Belge> {
  const firmaId = servis.oturum.firmaId;
  const hatalar: string[] = [];
  if (!IZINLI.has(g.dosya.type)) hatalar.push('Yalnızca fotoğraf (JPEG, PNG, WebP, HEIC) ya da PDF eklenebilir.');
  if (g.dosya.size === 0) hatalar.push('Dosya boş.');
  if (g.dosya.size > EN_BUYUK_BELGE) hatalar.push(`Dosya çok büyük (en çok ${EN_BUYUK_BELGE / 1024 / 1024} MB).`);
  if (!TARIH.test(g.tarih)) hatalar.push('Belge tarihini girin.');
  if (!(g.tur in BELGE_TUR_ADI)) hatalar.push('Belge türünü seçin.');
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  return depo.islem(async () => {
    await bagliKayitDenetle(depo, firmaId, g.bagliTur, g.bagliId);
    const belge = await servis.ekle('belge', {
      tur: g.tur,
      tarih: g.tarih,
      ad: g.ad.trim() || BELGE_TUR_ADI[g.tur],
      bagliTur: g.bagliTur,
      bagliId: g.bagliId,
      mime: g.dosya.type,
      boyut: g.dosya.size,
    });
    await depo.ekle('belgeDosyasi', { id: yeniId(), firmaId, belgeId: belge.id, dosya: g.dosya });
    return belge;
  });
}

/** Adı ve türü değişir; dosya değişmez (yanlış dosyaysa iptal edilip yenisi eklenir). */
export async function belgeGuncelle(
  servis: KayitServisi,
  belgeId: string,
  g: { ad: string; tur: Belge['tur'] },
  gerekce?: string,
): Promise<Belge> {
  if (!(g.tur in BELGE_TUR_ADI)) throw new IsKuraliHatasi('Belge türünü seçin.');
  return servis.guncelle('belge', belgeId, { ad: g.ad.trim() || BELGE_TUR_ADI[g.tur], tur: g.tur }, gerekce);
}

export const belgeIptal = (servis: KayitServisi, belgeId: string, gerekce?: string): Promise<void> => servis.iptal('belge', belgeId, gerekce);

// ─── Okuma ─────────────────────────────────────────────────────────

/** Kaydın belgeleri, en yeni önce. */
export async function belgeleriListele(depo: Depo, firmaId: string, bagliTur: BelgeBagi, bagliId: string): Promise<Belge[]> {
  return aktif(await depo.listele('belge', { bagliId, firmaId }))
    .filter((b) => b.bagliTur === bagliTur)
    .sort((a, b) => b.tarih.localeCompare(a.tarih) || b.olusturmaZamani.localeCompare(a.olusturmaZamani));
}

export async function belgeDosyasiGetir(depo: Depo, firmaId: string, belgeId: string): Promise<Blob | null> {
  const [dosya] = await depo.listele('belgeDosyasi', { belgeId });
  return dosya && dosya.firmaId === firmaId ? dosya.dosya : null;
}

export interface BelgeOzeti {
  belge: Belge;
  /** Bağlı kaydın kısa adı (örn. "Fatura F-12 · Beton AŞ"). */
  bagliAdi: string;
  /** Bağlı kaydın ekran yolu (#/… olmadan); kayıt iptalse null. */
  yol: string | null;
}

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');

/** Bağlı kaydın adı ve ekran yolu. */
async function bagliKayit(depo: Depo, b: Belge, cariAdi: Map<string, string>): Promise<{ ad: string; yol: string | null }> {
  const iptalse = (k: { iptal: unknown } | undefined, ad: string, yol: string) => (k && !k.iptal ? { ad, yol } : { ad: `${ad} (iptal)`, yol: null });
  switch (b.bagliTur) {
    case 'gider': {
      const g = await depo.getir('gider', b.bagliId);
      const ad = g ? `${g.tur === 'iade' ? 'İade' : 'Gider'} ${tarihYaz(g.tarih)}${g.faturaNo ? ` · ${g.faturaNo}` : ''}${g.cariId ? ` · ${cariAdi.get(g.cariId) ?? ''}` : ''}` : 'Gider';
      return iptalse(g, ad, `giderler/${b.bagliId}`);
    }
    case 'odeme': {
      const o = await depo.getir('odeme', b.bagliId);
      const ad = o ? `${o.yon === 'tahsilat' ? 'Tahsilat' : 'Ödeme'} ${tarihYaz(o.tarih)}${o.cariId ? ` · ${cariAdi.get(o.cariId) ?? ''}` : ''}` : 'Ödeme';
      return iptalse(o, ad, `odemeler/${b.bagliId}`);
    }
    case 'cekSenet': {
      const c = await depo.getir('cekSenet', b.bagliId);
      const ad = c ? `${c.tur === 'cek' ? 'Çek' : 'Senet'}${c.seriNo ? ` ${c.seriNo}` : ''} · ${cariAdi.get(c.cariId) ?? ''}` : 'Çek/senet';
      return iptalse(c, ad, `cekler/${b.bagliId}`);
    }
    case 'proje': {
      const p = await depo.getir('proje', b.bagliId);
      return iptalse(p, p ? `Proje ${p.ad}` : 'Proje', `projeler/${b.bagliId}`);
    }
    case 'katKarsiligiSozlesme': {
      const k = await depo.getir('katKarsiligiSozlesme', b.bagliId);
      const p = k ? await depo.getir('proje', k.projeId) : undefined;
      return iptalse(k, `${p?.ad ?? 'Proje'} · Kat karşılığı sözleşmesi`, k ? `projeler/${k.projeId}` : '');
    }
    case 'ilaveImalat': {
      const i = await depo.getir('ilaveImalat', b.bagliId);
      return iptalse(i, `İlave imalat${i ? ` · ${i.aciklama}` : ''}`, i ? `projeler/${i.projeId}` : '');
    }
    case 'bagimsizBolum': {
      const bb = await depo.getir('bagimsizBolum', b.bagliId);
      const p = bb ? await depo.getir('proje', bb.projeId) : undefined;
      const blok = bb ? await depo.getir('blok', bb.blokId) : undefined;
      return iptalse(bb, `${p?.ad ?? 'Proje'} · ${bb ? bolumNo(blok?.ad, bb.no) : '?'}`, bb ? `projeler/${bb.projeId}` : '');
    }
    case 'cari': {
      const c = await depo.getir('cari', b.bagliId);
      return iptalse(c, c ? `Cari ${c.ad}` : 'Cari', `cariler/${b.bagliId}`);
    }
    default:
      return { ad: b.bagliTur, yol: null };
  }
}

/** Bütün belgeler, en yeni önce; türe göre süzülebilir. */
export async function tumBelgeler(depo: Depo, firmaId: string, tur?: Belge['tur']): Promise<BelgeOzeti[]> {
  const [belgeler, cariler] = await Promise.all([depo.listele('belge', { firmaId }), depo.listele('cari', { firmaId })]);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const sonuc: BelgeOzeti[] = [];
  for (const belge of aktif(belgeler)
    .filter((b) => !tur || b.tur === tur)
    .sort((a, b) => b.tarih.localeCompare(a.tarih) || b.olusturmaZamani.localeCompare(a.olusturmaZamani))) {
    const k = await bagliKayit(depo, belge, cariAdi);
    sonuc.push({ belge, bagliAdi: k.ad, yol: k.yol });
  }
  return sonuc;
}

export async function belgeDetayiGetir(depo: Depo, firmaId: string, belgeId: string): Promise<BelgeOzeti | null> {
  const belge = await depo.getir('belge', belgeId);
  if (!belge || belge.firmaId !== firmaId || belge.iptal) return null;
  const cariler = await depo.listele('cari', { firmaId });
  const k = await bagliKayit(depo, belge, new Map(cariler.map((c) => [c.id, c.ad])));
  return { belge, bagliAdi: k.ad, yol: k.yol };
}
