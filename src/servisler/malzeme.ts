import { giderBorcu, giderKalanBorc } from '../hesap/bakiye';
import {
  satinAlmaDurumu,
  siparisVerildi,
  stokAnahtari,
  stokOzeti,
  talepDurumu,
  talepHatalari,
  teklifKarsilastir,
  teslimMiktarlari,
  type SatinAlmaDurumu,
  type StokSatiri,
  type TalepDurumu,
  type TalepFaturasi,
  type TalepIcerigi,
} from '../hesap/malzeme';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Gider, Kurus, MalzemeHareketi, MalzemeTalebi, MalzemeTeklifi, Tarih } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Malzeme talebi (şema 24) ve satın alma zinciri: şantiye ister, teklifler (fiyat, nakliye, vade) girilir ve karşılaştırılır,
// biri seçilir, sipariş onaylanır; teslim alınan miktar stoğa giriş olur; fatura gider olarak girilir ve talebe bağlanır
// (`gider.talepId`); sipariş / teslim / fatura / ödeme karşılaştırılır (`satinAlmaDurumu`). Kullanılan malzeme çıkıştır.

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
    const nakliye = k.nakliye ?? 0;
    if (!Number.isInteger(nakliye) || nakliye < 0) throw new IsKuraliHatasi('Nakliye tutarı geçersiz.');
    const vadeGun = k.vadeGun ?? null;
    if (vadeGun !== null && (!Number.isInteger(vadeGun) || vadeGun < 0 || vadeGun > 730)) throw new IsKuraliHatasi('Ödeme vadesi 0–730 gün olmalı.');
    const teklif: MalzemeTeklifi = {
      id: k.id ?? yeniId(),
      cariId: k.cariId,
      tarih: k.tarih,
      fiyatlar,
      kdvOrani: k.kdvOrani,
      teslimGun: k.teslimGun,
      not: k.not.trim(),
      nakliye,
      vadeGun,
      odemeKosulu: (k.odemeKosulu ?? '').trim(),
    };
    if (o.talep.seciliTeklifId === teklif.id && siparisVerildi(o.talep) && o.talep.siparis) {
      const onceki = o.talep.teklifler.find((x) => x.id === teklif.id);
      if (onceki && JSON.stringify({ ...onceki, not: '' }) !== JSON.stringify({ ...teklif, not: '' }))
        throw new IsKuraliHatasi('Onaylanmış siparişin teklifi değiştirilemez; önce siparişi geri alın.');
    }
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

/** Teklifi seçer (sipariş onayı bekler); null seçimi kaldırır. Teslim ya da fatura başladıysa tedarikçi değişmez. */
export async function teklifSec(depo: Depo, servis: KayitServisi, talepId: string, teklifId: string | null): Promise<MalzemeTalebi> {
  const firmaId = servis.oturum.firmaId;
  const o = await talepOzetiGetir(depo, firmaId, talepId);
  if (!o) throw new IsKuraliHatasi('Talep bulunamadı.');
  if (teklifId && !o.talep.teklifler.some((x) => x.id === teklifId)) throw new IsKuraliHatasi('Teklif bulunamadı.');
  if (teklifId === o.talep.seciliTeklifId) return o.talep;
  if ([...o.teslim.values()].some((x) => x > 0)) throw new IsKuraliHatasi('Teslim başlamış siparişin tedarikçisi değiştirilemez.');
  if ((await talepFaturaGiderleri(depo, firmaId, talepId)).length) throw new IsKuraliHatasi('Faturası girilmiş siparişin tedarikçisi değiştirilemez.');
  return servis.guncelle('malzemeTalebi', talepId, { seciliTeklifId: teklifId, siparis: null });
}

/** Seçilen teklifle sipariş verildi (onay): kim, ne zaman, KDV dahil tutar. */
export async function siparisVer(depo: Depo, servis: KayitServisi, talepId: string, tarih: Tarih): Promise<MalzemeTalebi> {
  if (!TARIH.test(tarih)) throw new IsKuraliHatasi('Sipariş tarihini seçin.');
  const o = await talepOzetiGetir(depo, servis.oturum.firmaId, talepId);
  if (!o) throw new IsKuraliHatasi('Talep bulunamadı.');
  if (!o.talep.seciliTeklifId) throw new IsKuraliHatasi('Önce bir teklif seçin.');
  if (o.talep.siparis) throw new IsKuraliHatasi('Sipariş zaten onaylandı.');
  const k = teklifKarsilastir(o.talep).toplamlar.find((x) => x.teklif.id === o.talep.seciliTeklifId)!;
  if (k.eksik) throw new IsKuraliHatasi('Seçilen teklifte fiyatı olmayan malzeme var; fiyatı yazın ya da malzemeyi talepten çıkarın.');
  return servis.guncelle('malzemeTalebi', talepId, { siparis: { tarih, kullaniciId: servis.oturum.kullaniciId, tutar: k.tutar + k.kdv } });
}

/** Onayı geri alır (teklif seçili kalır); teslim ya da fatura varsa olmaz. */
export async function siparisGeriAl(depo: Depo, servis: KayitServisi, talepId: string): Promise<MalzemeTalebi> {
  const firmaId = servis.oturum.firmaId;
  const o = await talepOzetiGetir(depo, firmaId, talepId);
  if (!o) throw new IsKuraliHatasi('Talep bulunamadı.');
  if ([...o.teslim.values()].some((x) => x > 0)) throw new IsKuraliHatasi('Teslim başlamış sipariş geri alınamaz.');
  if ((await talepFaturaGiderleri(depo, firmaId, talepId)).length) throw new IsKuraliHatasi('Faturası girilmiş sipariş geri alınamaz.');
  return servis.guncelle('malzemeTalebi', talepId, { siparis: null });
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
    if (!siparisVerildi(o.talep)) throw new IsKuraliHatasi('Önce teklifi seçip siparişi onaylayın.');
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

// ─── Fatura ve ödeme ────────────────────────────────────────────────

async function talepFaturaGiderleri(depo: Depo, firmaId: string, talepId: string): Promise<Gider[]> {
  const talep = await depo.getir('malzemeTalebi', talepId);
  if (!talep) return [];
  return aktif(await depo.listele('gider', { firmaId, projeId: talep.projeId })).filter((g) => g.talepId === talepId && g.tur === 'alis');
}

async function faturalariOku(depo: Depo, firmaId: string, giderler: Gider[]): Promise<TalepFaturasi[]> {
  if (!giderler.length) return [];
  const eslestirmeler = await depo.listele('eslestirme', { firmaId });
  const sonuc: TalepFaturasi[] = [];
  for (const g of giderler) {
    const satirlar = aktif(await depo.listele('giderSatiri', { giderId: g.id, firmaId }));
    sonuc.push({
      giderId: g.id,
      tarih: g.tarih,
      faturaNo: g.faturaNo,
      borc: giderBorcu(g),
      kalan: Math.max(0, giderKalanBorc(g, eslestirmeler)),
      toplam: g.toplam,
      satirlar: satirlar.map((x) => ({ aciklama: x.aciklama, birim: x.birim, miktar: x.miktar, kdvHaricTutar: x.kdvHaricTutar, kdvTutari: x.kdvTutari })),
    });
  }
  return sonuc.sort((a, b) => a.tarih.localeCompare(b.tarih));
}

export interface SatinAlmaOzeti extends TalepOzeti {
  faturalar: TalepFaturasi[];
  satinAlma: SatinAlmaDurumu;
}

export async function satinAlmaGetir(depo: Depo, firmaId: string, talepId: string): Promise<SatinAlmaOzeti | null> {
  const o = await talepOzetiGetir(depo, firmaId, talepId);
  if (!o) return null;
  const faturalar = await faturalariOku(depo, firmaId, await talepFaturaGiderleri(depo, firmaId, talepId));
  return { ...o, faturalar, satinAlma: satinAlmaDurumu(o.talep, o.teslim, faturalar) };
}

export interface FaturaOnerisi {
  projeId: string;
  cariId: string;
  vadeTarihi: Tarih | null;
  kdvOrani: number;
  satirlar: { ad: string; birim: string; miktar: number; birimFiyat: Kurus }[];
  nakliye: Kurus;
}

const gunEkle = (t: Tarih, n: number): Tarih => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * "Fatura gir" için dolu satırlar: teslim alınıp faturalanmamış miktar (hiç teslim yoksa siparişten faturalanmamış),
 * sipariş fiyatı, teklifin KDV'si; nakliye faturalanmadıysa ayrı satır. Vade = bugün + teklifin vadesi.
 */
export function faturaOnerisi(o: SatinAlmaOzeti, bugun: Tarih): FaturaOnerisi | null {
  const teklif = o.talep.teklifler.find((k) => k.id === o.talep.seciliTeklifId);
  if (!teklif) return null;
  const teslimVar = o.satinAlma.satirlar.some((s) => s.teslim > s.faturaMiktari + 1e-9);
  const satirlar = o.satinAlma.satirlar
    .map((s) => ({ ad: s.ad, birim: s.birim, miktar: Math.max(0, (teslimVar ? s.teslim : s.siparisMiktari) - s.faturaMiktari), birimFiyat: s.siparisFiyati ?? 0 }))
    .filter((s) => s.miktar > 1e-9);
  return {
    projeId: o.talep.projeId,
    cariId: teklif.cariId,
    vadeTarihi: teklif.vadeGun ? gunEkle(bugun, teklif.vadeGun) : null,
    kdvOrani: teklif.kdvOrani,
    satirlar,
    nakliye: Math.max(0, (teklif.nakliye ?? 0) - o.satinAlma.digerFatura),
  };
}

/** Talebe bağlanabilecek faturalar: projede, seçilen tedarikçinin, henüz bir talebe bağlı olmayan alış giderleri. */
export async function baglanabilirFaturalar(depo: Depo, firmaId: string, talepId: string): Promise<Gider[]> {
  const t = await depo.getir('malzemeTalebi', talepId);
  const cariId = t?.teklifler.find((k) => k.id === t.seciliTeklifId)?.cariId;
  if (!t || !cariId) return [];
  return aktif(await depo.listele('gider', { firmaId, projeId: t.projeId }))
    .filter((g) => g.tur === 'alis' && g.cariId === cariId && !g.talepId && !g.hakedisId)
    .sort((a, b) => b.tarih.localeCompare(a.tarih));
}

/** Var olan faturayı talebe bağlar ya da bağı kaldırır (talepId null). Mali kayıt: gerekçe kuralı geçerli. */
export async function faturaBagla(depo: Depo, servis: KayitServisi, giderId: string, talepId: string | null, gerekce?: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  const g = await depo.getir('gider', giderId);
  if (!g || g.firmaId !== firmaId || g.iptal) throw new IsKuraliHatasi('Fatura bulunamadı.');
  if (talepId) {
    const t = await depo.getir('malzemeTalebi', talepId);
    if (!t || t.firmaId !== firmaId || t.iptal) throw new IsKuraliHatasi('Talep bulunamadı.');
    if (t.projeId !== g.projeId) throw new IsKuraliHatasi('Fatura başka projeye yazılmış.');
  }
  await servis.guncelle('gider', giderId, { talepId }, gerekce);
}

export interface FirmaSatinAlmaSatiri {
  talep: MalzemeTalebi;
  durum: TalepDurumu;
  satinAlma: SatinAlmaDurumu;
  /** En son teslim tarihi (fatura bekleme süresi için). */
  sonTeslim: Tarih | null;
  /** Siparişin beklenen ödeme günü: gereken tarih (yoksa sipariş + teslim süresi) + vade. */
  odemeTarihi: Tarih | null;
  tedarikciId: string | null;
}

/** Siparişi verilmiş bütün talepler (Tamamlanacak işler ve nakit tahmini için); tablolar birer kez okunur. */
export async function firmaSatinAlmaDurumlari(depo: Depo, firmaId: string, erisim: Set<string> | null): Promise<FirmaSatinAlmaSatiri[]> {
  const [talepler, hareketler, giderler] = await Promise.all([
    depo.listele('malzemeTalebi', { firmaId }),
    depo.listele('malzemeHareketi', { firmaId }),
    depo.listele('gider', { firmaId }),
  ]);
  const siparisli = aktif(talepler).filter((t) => siparisVerildi(t) && (!erisim || erisim.has(t.projeId)));
  if (!siparisli.length) return [];
  const faturaGideri = new Map<string, Gider[]>();
  for (const g of aktif(giderler)) if (g.talepId && g.tur === 'alis') faturaGideri.set(g.talepId, [...(faturaGideri.get(g.talepId) ?? []), g]);
  const sonuc: FirmaSatinAlmaSatiri[] = [];
  for (const t of siparisli) {
    const teslim = teslimMiktarlari(t.id, hareketler);
    const faturalar = await faturalariOku(depo, firmaId, faturaGideri.get(t.id) ?? []);
    const teklif = t.teklifler.find((k) => k.id === t.seciliTeklifId);
    const sonTeslim = hareketler.filter((h) => !h.iptal && h.talepId === t.id && h.tur === 'giris').map((h) => h.tarih).sort().at(-1) ?? null;
    const gelis = t.gerekenTarih ?? (t.siparis?.tarih && teklif?.teslimGun != null ? gunEkle(t.siparis.tarih, teklif.teslimGun) : t.siparis?.tarih ?? null);
    sonuc.push({
      talep: t,
      durum: talepDurumu(t, teslim),
      satinAlma: satinAlmaDurumu(t, teslim, faturalar),
      sonTeslim,
      odemeTarihi: gelis ? gunEkle(gelis, teklif?.vadeGun ?? 0) : null,
      tedarikciId: teklif?.cariId ?? null,
    });
  }
  return sonuc;
}


