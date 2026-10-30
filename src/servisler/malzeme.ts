import { stokAnahtari, stokOzeti, talepDurumu, talepHatalari, teslimMiktarlari, type StokSatiri, type TalepDurumu, type TalepIcerigi } from '../hesap/malzeme';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { MalzemeHareketi, MalzemeTalebi, MalzemeTeklifi, Tarih } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Malzeme talebi (şema 24): şantiye ister, teklifler girilir ve karşılaştırılır, biri seçilir (sipariş), teslim alınan
// miktar stoğa giriş olur. Şantiyede kullanılan malzeme çıkış hareketidir. Fatura ayrıca gider olarak girilir.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export interface TalepOzeti {
  talep: MalzemeTalebi;
  durum: TalepDurumu;
  teslim: Map<string, number>;
}

export async function projeTalepleri(depo: Depo, firmaId: string, projeId: string): Promise<TalepOzeti[]> {
  const [talepler, hareketler] = await Promise.all([depo.listele('malzemeTalebi', { firmaId, projeId }), depo.listele('malzemeHareketi', { firmaId, projeId })]);
  return aktif(talepler)
    .sort((a, b) => b.tarih.localeCompare(a.tarih) || b.olusturmaZamani.localeCompare(a.olusturmaZamani))
    .map((t) => {
      const teslim = teslimMiktarlari(t.id, hareketler);
      return { talep: t, durum: talepDurumu(t, teslim), teslim };
    });
}

export async function talepOzetiGetir(depo: Depo, firmaId: string, id: string): Promise<TalepOzeti | null> {
  const t = await depo.getir('malzemeTalebi', id);
  if (!t || t.firmaId !== firmaId || t.iptal) return null;
  const teslim = teslimMiktarlari(t.id, await depo.listele('malzemeHareketi', { firmaId, talepId: id }));
  return { talep: t, durum: talepDurumu(t, teslim), teslim };
}

function temizle(g: TalepIcerigi): TalepIcerigi {
  return {
    tarih: g.tarih,
    gerekenTarih: g.gerekenTarih || null,
    aciklama: g.aciklama.trim(),
    satirlar: g.satirlar.map((s) => ({ ...s, ad: s.ad.trim(), birim: s.birim.trim(), not: s.not.trim() })),
  };
}

export async function talepOlustur(depo: Depo, servis: KayitServisi, projeId: string, g: TalepIcerigi): Promise<MalzemeTalebi> {
  const firmaId = servis.oturum.firmaId;
  const t = temizle(g);
  const h = talepHatalari(t);
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  return depo.islem(async () => {
    const p = await depo.getir('proje', projeId);
    if (!p || p.firmaId !== firmaId || p.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
    return servis.ekle('malzemeTalebi', { projeId, ...t, teklifler: [], seciliTeklifId: null, kapandi: false });
  });
}

/** Satırları ve bilgileri değiştirir; teslim alınmış satır çıkarılamaz. Satırdan çıkan teklif fiyatları atılır. */
export async function talepKaydet(depo: Depo, servis: KayitServisi, id: string, g: TalepIcerigi): Promise<MalzemeTalebi> {
  const firmaId = servis.oturum.firmaId;
  const t = temizle(g);
  const h = talepHatalari(t);
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  return depo.islem(async () => {
    const o = await talepOzetiGetir(depo, firmaId, id);
    if (!o) throw new IsKuraliHatasi('Talep bulunamadı.');
    const idler = new Set(t.satirlar.map((s) => s.id));
    for (const s of o.talep.satirlar) if (!idler.has(s.id) && (o.teslim.get(s.id) ?? 0) > 0) throw new IsKuraliHatasi(`${s.ad} teslim alınmış; talepten çıkarılamaz.`);
    const teklifler = o.talep.teklifler.map((k) => ({ ...k, fiyatlar: Object.fromEntries(Object.entries(k.fiyatlar).filter(([sid]) => idler.has(sid))) }));
    return servis.guncelle('malzemeTalebi', id, { ...t, teklifler });
  });
}

/** Teklifi ekler (kimliği yoksa) ya da değiştirir. */
export async function teklifKaydet(depo: Depo, servis: KayitServisi, talepId: string, k: Omit<MalzemeTeklifi, 'id'> & { id?: string }): Promise<MalzemeTalebi> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const o = await talepOzetiGetir(depo, firmaId, talepId);
    if (!o) throw new IsKuraliHatasi('Talep bulunamadı.');
    const cari = await depo.getir('cari', k.cariId);
    if (!cari || cari.firmaId !== firmaId || cari.iptal) throw new IsKuraliHatasi('Teklifi veren tedarikçiyi seçin.');
    if (!TARIH.test(k.tarih)) throw new IsKuraliHatasi('Teklif tarihini seçin.');
    const fiyatlar: Record<string, number | null> = {};
    for (const s of o.talep.satirlar) {
      const f = k.fiyatlar[s.id];
      if (f !== null && f !== undefined && (!Number.isInteger(f) || f < 0)) throw new IsKuraliHatasi(`${s.ad}: fiyat geçersiz.`);
      fiyatlar[s.id] = f ?? null;
    }
    if (Object.values(fiyatlar).every((f) => f === null)) throw new IsKuraliHatasi('En az bir malzemenin fiyatını yazın.');
    if (![0, 1, 10, 20].includes(k.kdvOrani)) throw new IsKuraliHatasi('KDV oranını seçin.');
    const teklif: MalzemeTeklifi = { id: k.id ?? yeniId(), cariId: k.cariId, tarih: k.tarih, fiyatlar, kdvOrani: k.kdvOrani, teslimGun: k.teslimGun, not: k.not.trim() };
    const varMi = o.talep.teklifler.some((x) => x.id === teklif.id);
    const teklifler = varMi ? o.talep.teklifler.map((x) => (x.id === teklif.id ? teklif : x)) : [...o.talep.teklifler, teklif];
    return servis.guncelle('malzemeTalebi', talepId, { teklifler });
  });
}

export async function teklifCikar(depo: Depo, servis: KayitServisi, talepId: string, teklifId: string): Promise<MalzemeTalebi> {
  const o = await talepOzetiGetir(depo, servis.oturum.firmaId, talepId);
  if (!o) throw new IsKuraliHatasi('Talep bulunamadı.');
  if (o.talep.seciliTeklifId === teklifId && [...o.teslim.values()].some((x) => x > 0)) throw new IsKuraliHatasi('Teslim alınmış siparişin teklifi çıkarılamaz.');
  return servis.guncelle('malzemeTalebi', talepId, {
    teklifler: o.talep.teklifler.filter((x) => x.id !== teklifId),
    seciliTeklifId: o.talep.seciliTeklifId === teklifId ? null : o.talep.seciliTeklifId,
  });
}

/** Teklifi seçer (sipariş verildi); null seçimi kaldırır. Teslim başladıysa tedarikçi değişmez. */
export async function teklifSec(depo: Depo, servis: KayitServisi, talepId: string, teklifId: string | null): Promise<MalzemeTalebi> {
  const o = await talepOzetiGetir(depo, servis.oturum.firmaId, talepId);
  if (!o) throw new IsKuraliHatasi('Talep bulunamadı.');
  if (teklifId && !o.talep.teklifler.some((x) => x.id === teklifId)) throw new IsKuraliHatasi('Teklif bulunamadı.');
  if ([...o.teslim.values()].some((x) => x > 0) && teklifId !== o.talep.seciliTeklifId) throw new IsKuraliHatasi('Teslim başlamış siparişin tedarikçisi değiştirilemez.');
  return servis.guncelle('malzemeTalebi', talepId, { seciliTeklifId: teklifId });
}

/** Teslim alınan miktarlar stoğa giriş olur (seçilen teklifin tedarikçisiyle). */
export async function teslimAl(
  depo: Depo,
  servis: KayitServisi,
  talepId: string,
  g: { tarih: Tarih; irsaliyeNo: string; miktarlar: Map<string, number>; not: string },
): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  if (!TARIH.test(g.tarih)) throw new IsKuraliHatasi('Teslim tarihini seçin.');
  await depo.islem(async () => {
    const o = await talepOzetiGetir(depo, firmaId, talepId);
    if (!o) throw new IsKuraliHatasi('Talep bulunamadı.');
    const cariId = o.talep.teklifler.find((x) => x.id === o.talep.seciliTeklifId)?.cariId ?? null;
    let sayi = 0;
    for (const s of o.talep.satirlar) {
      const m = g.miktarlar.get(s.id) ?? 0;
      if (!Number.isFinite(m) || m < 0) throw new IsKuraliHatasi(`${s.ad}: miktar geçersiz.`);
      if (m === 0) continue;
      await servis.ekle('malzemeHareketi', {
        projeId: o.talep.projeId,
        tarih: g.tarih,
        tur: 'giris',
        ad: s.ad,
        birim: s.birim,
        miktar: m,
        talepId,
        talepSatiriId: s.id,
        cariId,
        irsaliyeNo: g.irsaliyeNo.trim() || null,
        not: g.not.trim(),
      });
      sayi++;
    }
    if (!sayi) throw new IsKuraliHatasi('Teslim alınan miktarı yazın.');
  });
}

export async function talepKapat(_depo: Depo, servis: KayitServisi, talepId: string, kapandi: boolean): Promise<void> {
  await servis.guncelle('malzemeTalebi', talepId, { kapandi });
}

/** Teslimi olmayan talep iptal edilir. */
export async function talepIptal(depo: Depo, servis: KayitServisi, talepId: string): Promise<void> {
  const o = await talepOzetiGetir(depo, servis.oturum.firmaId, talepId);
  if (!o) throw new IsKuraliHatasi('Talep bulunamadı.');
  if ([...o.teslim.values()].some((x) => x > 0)) throw new IsKuraliHatasi('Teslim alınmış talep iptal edilemez; "Kapat" kullanın ya da teslim hareketlerini iptal edin.');
  await servis.iptal('malzemeTalebi', talepId);
}

export async function projeStokHareketleri(depo: Depo, firmaId: string, projeId: string): Promise<MalzemeHareketi[]> {
  return aktif(await depo.listele('malzemeHareketi', { firmaId, projeId })).sort((a, b) => b.tarih.localeCompare(a.tarih) || b.olusturmaZamani.localeCompare(a.olusturmaZamani));
}

export async function projeStogu(depo: Depo, firmaId: string, projeId: string): Promise<StokSatiri[]> {
  return stokOzeti(await projeStokHareketleri(depo, firmaId, projeId));
}

/** Elle giriş ya da şantiyede kullanım (çıkış). Çıkış stoktan fazla olamaz. */
export async function stokHareketiEkle(
  depo: Depo,
  servis: KayitServisi,
  projeId: string,
  g: { tarih: Tarih; tur: 'giris' | 'cikis'; ad: string; birim: string; miktar: number; not: string },
): Promise<MalzemeHareketi> {
  const firmaId = servis.oturum.firmaId;
  const ad = g.ad.trim();
  const birim = g.birim.trim();
  if (!TARIH.test(g.tarih)) throw new IsKuraliHatasi('Tarihi seçin.');
  if (!ad || !birim) throw new IsKuraliHatasi('Malzemenin adını ve birimini yazın.');
  if (!Number.isFinite(g.miktar) || g.miktar <= 0) throw new IsKuraliHatasi('Miktarı yazın.');
  return depo.islem(async () => {
    const p = await depo.getir('proje', projeId);
    if (!p || p.firmaId !== firmaId || p.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
    if (g.tur === 'cikis') {
      const s = (await projeStogu(depo, firmaId, projeId)).find((x) => x.anahtar === stokAnahtari(ad, birim));
      if (!s || s.kalan < g.miktar - 1e-9) throw new IsKuraliHatasi(`Stokta ${s ? s.kalan.toLocaleString('tr-TR') : 0} ${birim} ${ad} var; daha fazlası kullanılamaz.`);
    }
    return servis.ekle('malzemeHareketi', { projeId, tarih: g.tarih, tur: g.tur, ad, birim, miktar: g.miktar, talepId: null, talepSatiriId: null, cariId: null, irsaliyeNo: null, not: g.not.trim() });
  });
}

export async function stokHareketiIptal(_depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  await servis.iptal('malzemeHareketi', id);
}
