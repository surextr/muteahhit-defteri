import { mesafeKm, type Konum, type TarihKaynagi } from '../hesap/fotograf';
import type { Depo } from '../veri/depo';
import type { Kat, Proje, ProjeFotografi, Tarih } from '../veri/tipler';
import { belgeDosyasiGetir, belgeEkle } from './belge';
import { havuzBagla, havuzSatiriGetir } from './havuz';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Şantiye fotoğrafları: inşaatın aşama aşama fotoğrafları (şema 20). Künye `projeFotografi`, dosya bağlı `belge`.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export interface FotografBilgisi {
  cekimTarihi: Tarih;
  cekimZamani: string | null;
  tarihKaynagi: TarihKaynagi;
  takipBasligiId: string | null;
  kalemId: string | null;
  blokId: string | null;
  katId: string | null;
  aciklama: string;
}

export interface FotografGirdisi extends FotografBilgisi {
  projeId: string;
  /** Cihazda küçültülmüş dosya (en uzun kenar 1600 px). */
  dosya: Blob;
  dosyaAdi: string;
  kucukResim: string;
  /** Fotoğrafın EXIF konumu: yalnız uzaklık hesabı için; saklanmaz. */
  konum: Konum | null;
}

async function bilgiDenetle(depo: Depo, firmaId: string, projeId: string, g: FotografBilgisi, bugun: Tarih): Promise<void> {
  const hatalar: string[] = [];
  if (!TARIH.test(g.cekimTarihi)) hatalar.push('Çekim tarihini girin.');
  else if (g.cekimTarihi > bugun) hatalar.push('Çekim tarihi bugünden sonra olamaz.');
  if (g.cekimZamani !== null && !/^\d{2}:\d{2}$/.test(g.cekimZamani)) hatalar.push('Çekim saati geçersiz.');
  const bagli = async <T extends 'takipBasligi' | 'kalem' | 'blok' | 'kat'>(tablo: T, id: string | null, ad: string) => {
    if (!id) return;
    const k = await depo.getir(tablo, id);
    if (!k || k.firmaId !== firmaId || k.iptal || (k as { projeId?: string }).projeId !== projeId) hatalar.push(`${ad} bu projede bulunamadı.`);
  };
  await bagli('takipBasligi', g.takipBasligiId, 'Aşama');
  await bagli('kalem', g.kalemId, 'Bütçe kalemi');
  await bagli('blok', g.blokId, 'Blok');
  await bagli('kat', g.katId, 'Kat');
  if (g.katId && g.blokId) {
    const kat = await depo.getir('kat', g.katId);
    if (kat && kat.blokId !== g.blokId) hatalar.push('Kat seçilen bloğa ait değil.');
  }
  if (hatalar.length) throw new IsKuraliHatasi(hatalar.join(' '));
}

/** Fotoğraf ve dosyası tek işlemde. Proje konumu ve fotoğrafın konumu varsa uzaklık yazılır. */
export async function fotografEkle(depo: Depo, servis: KayitServisi, g: FotografGirdisi, bugun: Tarih): Promise<ProjeFotografi> {
  const firmaId = servis.oturum.firmaId;
  const proje = await depo.getir('proje', g.projeId);
  if (!proje || proje.firmaId !== firmaId || proje.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
  await bilgiDenetle(depo, firmaId, g.projeId, g, bugun);
  const uzaklikKm = proje.konum && g.konum ? Math.round(mesafeKm(proje.konum, g.konum) * 10) / 10 : null;
  return depo.islem(async () => {
    const f = await servis.ekle('projeFotografi', {
      projeId: g.projeId,
      cekimTarihi: g.cekimTarihi,
      cekimZamani: g.cekimZamani,
      tarihKaynagi: g.tarihKaynagi,
      takipBasligiId: g.takipBasligiId,
      kalemId: g.kalemId,
      blokId: g.blokId,
      katId: g.katId,
      aciklama: g.aciklama.trim(),
      kucukResim: g.kucukResim,
      uzaklikKm,
    });
    await belgeEkle(depo, servis, { bagliTur: 'projeFotografi', bagliId: f.id, tur: 'fotograf', tarih: g.cekimTarihi, ad: g.dosyaAdi || 'Şantiye fotoğrafı', dosya: g.dosya });
    return f;
  });
}

/** Tarih, aşama, yer, açıklama değişir; fotoğrafın kendisi değişmez (yanlışsa iptal edilip yenisi eklenir). */
export async function fotografGuncelle(depo: Depo, servis: KayitServisi, id: string, g: FotografBilgisi, bugun: Tarih): Promise<ProjeFotografi> {
  const f = await depo.getir('projeFotografi', id);
  if (!f || f.firmaId !== servis.oturum.firmaId || f.iptal) throw new IsKuraliHatasi('Fotoğraf bulunamadı.');
  await bilgiDenetle(depo, f.firmaId, f.projeId, g, bugun);
  return depo.islem(async () => {
    const yeni = await servis.guncelle('projeFotografi', id, { ...g, aciklama: g.aciklama.trim() });
    // Belgenin tarihi de çekim tarihine uysun (Belgeler listesinde doğru sırada görünsün).
    const belge = aktif(await depo.listele('belge', { firmaId: f.firmaId, bagliId: id }))[0];
    if (belge && belge.tarih !== g.cekimTarihi) await servis.guncelle('belge', belge.id, { tarih: g.cekimTarihi });
    return yeni;
  });
}

export async function fotografIptal(depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  await depo.islem(async () => {
    await servis.iptal('projeFotografi', id);
  });
}

export interface FotografSatiri {
  fotograf: ProjeFotografi;
  asamaAdi: string | null;
  kalemAdi: string | null;
  /** "A Blok · 3. Kat" */
  yerAdi: string | null;
  belgeId: string | null;
}

export interface FotografSecenekleri {
  asamalar: { id: string; ad: string; durum: 'baslamadi' | 'devam' | 'tamamlandi' }[];
  /** Ana kalemler. */
  kalemler: { id: string; ad: string }[];
  bloklar: { id: string; ad: string; katlar: { id: string; ad: string }[] }[];
}

/** Formdaki seçimler: aşamalar (takip başlıkları sırasıyla), ana kalemler, bloklar ve katları. */
export async function fotografSecenekleri(depo: Depo, firmaId: string, projeId: string): Promise<FotografSecenekleri> {
  const k = { firmaId, projeId };
  const [basliklar, kalemler, bloklar, katlar] = await Promise.all([
    depo.listele('takipBasligi', k),
    depo.listele('kalem', k),
    depo.listele('blok', k),
    depo.listele('kat', k),
  ]);
  const katSirasi = (a: Kat, b: Kat) => b.sira - a.sira; // üst kat önce
  return {
    asamalar: aktif(basliklar)
      .sort((a, b) => a.sira - b.sira)
      .map((b) => ({ id: b.id, ad: b.ad, durum: b.durum })),
    kalemler: aktif(kalemler)
      .filter((x) => x.ustKalemId === null)
      .sort((a, b) => a.sira - b.sira)
      .map((x) => ({ id: x.id, ad: x.ad })),
    bloklar: aktif(bloklar)
      .sort((a, b) => a.sira - b.sira)
      .map((b) => ({
        id: b.id,
        ad: b.ad,
        katlar: aktif(katlar)
          .filter((kt) => kt.blokId === b.id)
          .sort(katSirasi)
          .map((kt) => ({ id: kt.id, ad: kt.ad })),
      })),
  };
}

/** Projenin iptal edilmemiş fotoğrafları, aşama/kalem/yer adlarıyla. */
export async function projeFotograflari(depo: Depo, firmaId: string, projeId: string): Promise<FotografSatiri[]> {
  const k = { firmaId, projeId };
  const [fotolar, basliklar, kalemler, bloklar, katlar, belgeler] = await Promise.all([
    depo.listele('projeFotografi', k),
    depo.listele('takipBasligi', k),
    depo.listele('kalem', k),
    depo.listele('blok', k),
    depo.listele('kat', k),
    depo.listele('belge', { firmaId, bagliTur: 'projeFotografi' }),
  ]);
  const ad = new Map<string, string>([...basliklar, ...kalemler, ...katlar].map((x) => [x.id, x.ad]));
  const blokAdi = new Map(bloklar.map((b) => [b.id, b.ad]));
  const belgesi = new Map(aktif(belgeler).map((b) => [b.bagliId, b.id]));
  return aktif(fotolar).map((f) => ({
    fotograf: f,
    asamaAdi: f.takipBasligiId ? (ad.get(f.takipBasligiId) ?? null) : null,
    kalemAdi: f.kalemId ? (ad.get(f.kalemId) ?? null) : null,
    yerAdi:
      [f.blokId ? blokEtiketi(blokAdi.get(f.blokId)) : null, f.katId ? ad.get(f.katId) : null]
        .filter(Boolean)
        .join(' · ') || null,
    belgeId: belgesi.get(f.id) ?? null,
  }));
}

/** "A" → "A Blok"; uzun ad olduğu gibi. */
export const blokEtiketi = (ad: string | undefined) => (!ad ? null : ad.length <= 3 && !/blok/i.test(ad) ? `${ad} Blok` : ad);

export const fotografDosyasi = (depo: Depo, firmaId: string, belgeId: string) => belgeDosyasiGetir(depo, firmaId, belgeId);

/** Konumu olan projeler (fotoğrafı konumdan projeye bağlamak için). */
export async function konumluProjeler(depo: Depo, firmaId: string, erisim: Set<string> | null): Promise<Pick<Proje, 'id' | 'ad' | 'konum'>[]> {
  return aktif(await depo.listele('proje', { firmaId }))
    .filter((p) => p.konum && (!erisim || erisim.has(p.id)))
    .map((p) => ({ id: p.id, ad: p.ad, konum: p.konum }));
}

/**
 * Belge havuzundaki fotoğrafı projenin şantiye fotoğrafı yapar: künye yazılır, belge havuzdan fotoğrafa bağlanır.
 * Uzaklık, yüklerken hesaplanan proje uzaklıklarından gelir (konum saklanmadı).
 */
export async function havuzdanFotograf(
  depo: Depo,
  servis: KayitServisi,
  havuzId: string,
  g: FotografBilgisi & { projeId: string; kucukResim: string },
  bugun: Tarih,
): Promise<ProjeFotografi> {
  const firmaId = servis.oturum.firmaId;
  const satir = await havuzSatiriGetir(depo, firmaId, havuzId);
  if (!satir || satir.havuz.durum !== 'bekliyor') throw new IsKuraliHatasi('Belge havuzda bulunamadı ya da zaten bağlanmış.');
  if (!satir.belge.mime.startsWith('image/')) throw new IsKuraliHatasi('Yalnız fotoğraf şantiye fotoğrafı olabilir.');
  const proje = await depo.getir('proje', g.projeId);
  if (!proje || proje.firmaId !== firmaId || proje.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
  await bilgiDenetle(depo, firmaId, g.projeId, g, bugun);
  return depo.islem(async () => {
    const f = await servis.ekle('projeFotografi', {
      projeId: g.projeId,
      cekimTarihi: g.cekimTarihi,
      cekimZamani: g.cekimZamani,
      tarihKaynagi: g.tarihKaynagi,
      takipBasligiId: g.takipBasligiId,
      kalemId: g.kalemId,
      blokId: g.blokId,
      katId: g.katId,
      aciklama: g.aciklama.trim(),
      kucukResim: g.kucukResim,
      uzaklikKm: satir.havuz.cekim?.projeUzakliklari[g.projeId] ?? null,
    });
    await havuzBagla(depo, servis, havuzId, { tablo: 'projeFotografi', id: f.id, tur: 'fotograf' });
    if (satir.belge.tarih !== g.cekimTarihi) await servis.guncelle('belge', satir.belge.id, { tarih: g.cekimTarihi });
    return f;
  });
}
