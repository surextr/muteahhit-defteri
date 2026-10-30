import { kalanTutar, odemeAcikTutar } from '../hesap/bakiye';
import { bolumNo } from '../hesap/bolum';
import {
  HAZIR_SATIS_MADDELERI,
  PLAN_TURU_ADI,
  satisEksikleri,
  satisKayitHatalari,
  satisOzeti,
  satisPlanDurumu,
  satisProtokolu,
  type SatisIcerigi,
  type SatisOzeti,
  type SatisPlanSatiriDurumu,
} from '../hesap/satis';
import type { SozlesmeMetni } from '../hesap/ustaSozlesmesi';
import { dovizdenTl } from '../hesap/para';
import type { Depo } from '../veri/depo';
import type { BagimsizBolum, Blok, Cari, CariRol, Firma, Kat, Satis, SatisMaddesi, SatisPlanSatiri, Tarih } from '../veri/tipler';
import { tamAdres } from './adres';
import { CARI_ROL_ADI } from './cari';
import { firmaAyariDegistir } from './firma';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Daire satışı. Taslak = rezerve: bölüm satışa kapanır, borç doğmaz (kapora alınırsa tahsilat cariye avans olur).
// Onay = ön satış protokolü imzalandı: plan satırları müşteriye alacak olur, açık tahsilatları (kapora) bu alacaklara
// bağlanır, bölüm "sözleşmeli" olur. İmzalıda plan değişirse alacaklar eşitlenir; tahsil edilmiş kısım korunur.

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const CARI_ROL_SIRASI = Object.keys(CARI_ROL_ADI) as CariRol[];

export const satisMaddeleri = (firma: Firma): SatisMaddesi[] => firma.ayarlar.satisMaddeleri ?? HAZIR_SATIS_MADDELERI;

export async function satisGetir(depo: Depo, firmaId: string, id: string): Promise<Satis | null> {
  const s = await depo.getir('satis', id);
  return s && s.firmaId === firmaId && !s.iptal ? s : null;
}

/** Bölümün iptal edilmemiş satışı (en fazla bir tane). */
export async function bolumSatisi(depo: Depo, firmaId: string, bolumId: string): Promise<Satis | null> {
  return aktif(await depo.listele('satis', { bolumId, firmaId }))[0] ?? null;
}

async function bolumHazirla(depo: Depo, firmaId: string, bolumId: string) {
  const bolum = await depo.getir('bagimsizBolum', bolumId);
  if (!bolum || bolum.firmaId !== firmaId || bolum.iptal) throw new IsKuraliHatasi('Bağımsız bölüm bulunamadı.');
  const [blok, kat] = await Promise.all([depo.getir('blok', bolum.blokId), depo.getir('kat', bolum.katId)]);
  return { bolum, blok: blok ?? null, kat: kat ?? null, no: bolumNo(blok?.ad, bolum.no) };
}

/**
 * Rezervasyon (taslak satış). Bölüm satışa açık olmalı: arsa sahibinin değil, başka satışı yok. Müşteri kartına
 * "müşteri" rolü eklenir; protokol maddeleri firma ayarından kopyalanır.
 */
export async function satisOlustur(depo: Depo, servis: KayitServisi, firma: Firma, g: { bolumId: string; cariId: string; tarih: Tarih }): Promise<Satis> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const { bolum, no } = await bolumHazirla(depo, firmaId, g.bolumId);
    if (bolum.sahiplik === 'arsa_sahibi') throw new IsKuraliHatasi(`${no} arsa sahibine ait; satılamaz.`);
    if (await bolumSatisi(depo, firmaId, bolum.id)) throw new IsKuraliHatasi(`${no} için zaten bir satış var.`);
    const cari = await depo.getir('cari', g.cariId);
    if (!cari || cari.firmaId !== firmaId || cari.iptal) throw new IsKuraliHatasi('Müşteriyi seçin.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(g.tarih)) throw new IsKuraliHatasi('Satış tarihini seçin.');
    if (!cari.roller.includes('musteri')) {
      const roller = CARI_ROL_SIRASI.filter((r) => r === 'musteri' || cari.roller.includes(r));
      await servis.guncelle('cari', cari.id, { roller }, `${no} satışıyla müşteri rolü eklendi.`);
    }
    const satis = await servis.ekle('satis', {
      projeId: bolum.projeId,
      bolumId: bolum.id,
      cariId: cari.id,
      tarih: g.tarih,
      fiyat: 0,
      indirim: 0,
      kdvOrani: 1,
      takas: [],
      ekIstekler: [],
      plan: [],
      teslimTarihi: null,
      teslimEdildi: null,
      tapuTarihi: null,
      maddeler: satisMaddeleri(firma).map((m) => ({ ...m })),
      durum: 'rezerve',
      sozlesmeSurumu: 1,
      not: '',
      doviz: null,
    });
    await servis.guncelle('bagimsizBolum', bolum.id, { satisDurumu: 'rezerve' });
    return satis;
  });
}

export function satisIcerigi(s: Satis): SatisIcerigi {
  return {
    tarih: s.tarih,
    fiyat: s.fiyat,
    indirim: s.indirim,
    kdvOrani: s.kdvOrani,
    takas: s.takas.map((x) => ({ ...x })),
    ekIstekler: (s.ekIstekler ?? []).map((x) => ({ ...x })),
    plan: s.plan.map((x) => ({ ...x })),
    teslimTarihi: s.teslimTarihi,
    tapuTarihi: s.tapuTarihi,
    maddeler: s.maddeler.map((x) => ({ ...x })),
    not: s.not,
    doviz: s.doviz ? { ...s.doviz } : null,
  };
}

function temizle(g: SatisIcerigi): SatisIcerigi {
  // Dövizli satışta TL fiyat sözleşme kurundan hesaplanır.
  return {
    ...g,
    doviz: g.doviz ?? null,
    fiyat: g.doviz && g.doviz.kur > 0 ? dovizdenTl(g.doviz.tutar, g.doviz.kur) : g.fiyat,
    teslimTarihi: g.teslimTarihi || null,
    tapuTarihi: g.tapuTarihi || null,
    takas: g.takas.map((x) => ({ aciklama: x.aciklama.trim(), deger: x.deger })).filter((x) => x.aciklama || x.deger),
    ekIstekler: (g.ekIstekler ?? []).map((x) => ({ ...x, ad: x.ad.trim() })).filter((x) => x.ad || x.tutar),
    plan: g.plan.map((x) => ({ ...x, aciklama: x.aciklama.trim() })),
    maddeler: g.maddeler.map((m) => ({ ...m, metin: m.metin.trim() })),
    not: g.not.trim(),
  };
}

const alacakAciklamasi = (no: string, p: SatisPlanSatiri, sira: number) =>
  `${no} satışı · ${p.aciklama || `${PLAN_TURU_ADI[p.tur]}${p.tur === 'taksit' ? ` ${sira}` : ''}`}`;

/** Taksit numarası (aynı türdeki satırlar arasında vade sırası). */
function taksitSirasi(plan: SatisPlanSatiri[], p: SatisPlanSatiri): number {
  return (
    [...plan]
      .sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi))
      .filter((x) => x.tur === p.tur)
      .findIndex((x) => x.id === p.id) + 1
  );
}

/**
 * İmzalı satışın planını alacaklarla eşitler: kalkan satırın alacağı iptal, değişenin alacağı güncellenir, yeni satıra
 * alacak açılır. Tahsil edilmiş alacak kaldırılamaz ve tahsil edilenin altına indirilemez. Dönüş: alacak kimlikli plan.
 */
async function planiAlacaklaEsitle(depo: Depo, servis: KayitServisi, s: Satis, plan: SatisPlanSatiri[], gerekce?: string): Promise<SatisPlanSatiri[]> {
  const firmaId = servis.oturum.firmaId;
  const { no } = await bolumHazirla(depo, firmaId, s.bolumId);
  const eslestirmeler = await depo.listele('eslestirme', { firmaId });
  const tahsilEdilen = async (alacakId: string) => {
    const a = await depo.getir('alacak', alacakId);
    return a && !a.iptal ? a.tutar - kalanTutar('alacak', a, a.tutar, eslestirmeler) : 0;
  };
  const yeniIdler = new Set(plan.map((p) => p.id));
  for (const eski of s.plan) {
    if (yeniIdler.has(eski.id) || !eski.alacakId) continue;
    if ((await tahsilEdilen(eski.alacakId)) > 0)
      throw new IsKuraliHatasi(`${eski.aciklama || PLAN_TURU_ADI[eski.tur]} (${eski.vadeTarihi}) tahsil edilmiş; plandan çıkarılamaz.`);
    await servis.iptal('alacak', eski.alacakId, gerekce ?? 'Ödeme planından çıkarıldı.');
  }
  const sonuc: SatisPlanSatiri[] = [];
  for (const p of plan) {
    const eski = s.plan.find((x) => x.id === p.id);
    const veri = { tarih: s.tarih, vadeTarihi: p.vadeTarihi, tutar: p.tutar, aciklama: alacakAciklamasi(no, p, taksitSirasi(plan, p)) };
    if (eski?.alacakId) {
      const tahsil = await tahsilEdilen(eski.alacakId);
      if (p.tutar < tahsil)
        throw new IsKuraliHatasi(`${veri.aciklama}: ${(tahsil / 100).toLocaleString('tr-TR')} TL tahsil edilmiş; tutar bunun altına inemez.`);
      await servis.guncelle('alacak', eski.alacakId, veri, gerekce);
      sonuc.push({ ...p, alacakId: eski.alacakId });
    } else {
      const a = await servis.ekle('alacak', { projeId: s.projeId, cariId: s.cariId, ...veri, kaynakTur: 'satis', kaynakId: s.id });
      sonuc.push({ ...p, alacakId: a.id });
    }
  }
  return sonuc;
}

/**
 * Kaydeder. Taslak eksikle kaydedilir; imzalıda eksik bırakılamaz, gerekçe istenir, plan alacaklarla eşitlenir ve
 * sürüm bir artar.
 */
export async function satisKaydet(depo: Depo, servis: KayitServisi, id: string, girdi: SatisIcerigi, gerekce?: string): Promise<Satis> {
  const g = temizle(girdi);
  const h = satisKayitHatalari(g);
  if (h.length > 0) throw new IsKuraliHatasi(h.join(' '));
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const s = await satisGetir(depo, firmaId, id);
    if (!s) throw new IsKuraliHatasi('Satış bulunamadı.');
    if (s.onay) {
      const eksik = satisEksikleri(g);
      if (eksik.length > 0) throw new IsKuraliHatasi(`İmzalı satışta eksik bilgi bırakılamaz: ${eksik.join(' ')}`);
      // Önce satış kaydı (gerekçe kuralı burada denetlenir), sonra alacaklar.
      const guncel = await servis.guncelle('satis', id, g, gerekce);
      if (guncel.surum === s.surum) return guncel;
      const plan = await planiAlacaklaEsitle(depo, servis, s, g.plan, gerekce);
      return servis.guncelle('satis', id, { plan, sozlesmeSurumu: s.sozlesmeSurumu + 1 }, gerekce);
    }
    // Taslakta alacak yoktur; plan satırlarının alacak bağı boş kalır.
    return servis.guncelle('satis', id, { ...g, plan: g.plan.map((p) => ({ ...p, alacakId: null })) }, gerekce);
  });
}

/**
 * Protokol imzalandı: eksik bilgi kalmamalı. Plan satırları alacak olur, müşterinin açık tahsilatları (kapora) en
 * eski vadeli alacaktan başlayarak bağlanır, bölüm "sözleşmeli" olur.
 */
export async function satisOnayla(depo: Depo, servis: KayitServisi, id: string): Promise<Satis> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const s = await satisGetir(depo, firmaId, id);
    if (!s) throw new IsKuraliHatasi('Satış bulunamadı.');
    if (s.onay) throw new IsKuraliHatasi('Bu satış zaten imzalı.');
    const eksik = satisEksikleri(satisIcerigi(s));
    if (eksik.length > 0) throw new IsKuraliHatasi(`Önce eksik bilgileri tamamlayın: ${eksik.join(' ')}`);
    const plan = await planiAlacaklaEsitle(depo, servis, s, s.plan);
    await servis.guncelle('satis', id, { plan, durum: 'sozlesmeli' });
    await servis.onayla('satis', id);
    await servis.guncelle('bagimsizBolum', s.bolumId, { satisDurumu: 'sozlesmeli' });
    await acikTahsilatlariBagla(depo, servis, s.cariId, plan);
    return (await satisGetir(depo, firmaId, id))!;
  });
}

/** Müşterinin alacağa bağlanmamış tahsilatlarını (kapora, avans) bu satışın alacaklarına vade sırasıyla bağlar. */
async function acikTahsilatlariBagla(depo: Depo, servis: KayitServisi, cariId: string, plan: SatisPlanSatiri[]): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  const tahsilatlar = aktif(await depo.listele('odeme', { cariId, firmaId }))
    .filter((o) => o.yon === 'tahsilat' && o.amac === 'cari')
    .sort((a, b) => a.tarih.localeCompare(b.tarih));
  const sirali = [...plan].sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi));
  for (const t of tahsilatlar) {
    let acik = odemeAcikTutar(t, await depo.listele('eslestirme', { odemeId: t.id, firmaId }));
    for (const p of sirali) {
      if (acik <= 0) break;
      const a = p.alacakId ? await depo.getir('alacak', p.alacakId) : undefined;
      if (!a || a.iptal) continue;
      const kalan = kalanTutar('alacak', a, a.tutar, await depo.listele('eslestirme', { hedefId: a.id, firmaId }));
      if (kalan <= 0) continue;
      const tutar = Math.min(acik, kalan);
      await servis.ekle('eslestirme', { kaynakTur: 'odeme', odemeId: t.id, hedefTur: 'alacak', hedefId: a.id, tutar });
      acik -= tutar;
    }
  }
}

/** Anahtar teslimi: bölüm "teslim edildi" olur. Boş tarih teslimi geri alır. */
export async function satisTeslim(depo: Depo, servis: KayitServisi, id: string, tarih: Tarih | null, gerekce?: string): Promise<Satis> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const s = await satisGetir(depo, firmaId, id);
    if (!s) throw new IsKuraliHatasi('Satış bulunamadı.');
    if (!s.onay) throw new IsKuraliHatasi('Teslim için önce protokol imzalanmış olmalı.');
    if (tarih && !/^\d{4}-\d{2}-\d{2}$/.test(tarih)) throw new IsKuraliHatasi('Teslim tarihini seçin.');
    // Teslim sözleşmeyi değiştirmez; imzalı kayıtta geçmişe kendi gerekçesiyle yazılır.
    const guncel = await servis.guncelle('satis', id, { teslimEdildi: tarih }, gerekce ?? (tarih ? 'Anahtar teslim edildi.' : 'Teslim geri alındı.'));
    await servis.guncelle('bagimsizBolum', s.bolumId, { teslimDurumu: tarih ? 'teslim_edildi' : 'teslim_edilmedi' });
    return guncel;
  });
}

/**
 * Satış iptali (vazgeçme): alacaklarından tahsil edilmiş bir şey varsa engellenir (önce tahsilat eşleştirmesi ya da
 * iade ödemesi yapılır). Alacaklar ve belgeler satışla iptal olur; bölüm yeniden satışa çıkar.
 */
export async function satisIptal(depo: Depo, servis: KayitServisi, id: string, gerekce?: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const s = await satisGetir(depo, firmaId, id);
    if (!s) throw new IsKuraliHatasi('Satış bulunamadı.');
    const eslestirmeler = await depo.listele('eslestirme', { firmaId });
    const alacaklar = aktif(await depo.listele('alacak', { kaynakId: s.id, firmaId }));
    const tahsil = alacaklar.reduce((t, a) => t + a.tutar - kalanTutar('alacak', a, a.tutar, eslestirmeler), 0);
    if (tahsil > 0) {
      throw new IsKuraliHatasi(
        `Bu satıştan ${(tahsil / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} TL tahsil edilmiş. Önce ilgili tahsilatları iptal edin ya da müşteriye iade ödemesi yapıp eşleştirmeyi kaldırın.`,
      );
    }
    await servis.iptal('satis', id, gerekce);
    await servis.guncelle('bagimsizBolum', s.bolumId, { satisDurumu: 'satista', teslimDurumu: 'teslim_edilmedi' }, gerekce);
  });
}

/** Bu satıştaki madde metinlerini firmanın varsayılanı yapar (sonraki satışlara gelir). */
export async function satisMaddeleriniVarsayilanYap(servis: KayitServisi, firma: Firma, maddeler: SatisMaddesi[]): Promise<Firma> {
  return firmaAyariDegistir(servis, firma, { satisMaddeleri: maddeler.map((m) => ({ id: m.id, baslik: m.baslik.trim(), metin: m.metin.trim() })) });
}

// ─── Okuma ─────────────────────────────────────────────────────────

export interface SatisSatiri {
  satis: Satis;
  cari: Cari;
  bolum: BagimsizBolum;
  blok: Blok | null;
  kat: Kat | null;
  /** "A-7". */
  bolumNo: string;
  durumlar: SatisPlanSatiriDurumu[];
  ozet: SatisOzeti;
}

async function alacakKalanlari(depo: Depo, firmaId: string, satislar: Satis[]): Promise<Map<string, number>> {
  const eslestirmeler = await depo.listele('eslestirme', { firmaId });
  const m = new Map<string, number>();
  for (const s of satislar) {
    for (const a of aktif(await depo.listele('alacak', { kaynakId: s.id, firmaId }))) m.set(a.id, kalanTutar('alacak', a, a.tutar, eslestirmeler));
  }
  return m;
}

async function satirKur(depo: Depo, firmaId: string, s: Satis, kalanlar: Map<string, number>, bugun: Tarih): Promise<SatisSatiri | null> {
  const [cari, b] = await Promise.all([depo.getir('cari', s.cariId), bolumHazirla(depo, firmaId, s.bolumId).catch(() => null)]);
  if (!cari || !b) return null;
  const durumlar = satisPlanDurumu(s.plan, kalanlar, bugun);
  return { satis: s, cari, bolum: b.bolum, blok: b.blok, kat: b.kat, bolumNo: b.no, durumlar, ozet: satisOzeti(s, durumlar) };
}

export async function satisDetayi(depo: Depo, firmaId: string, id: string, bugun: Tarih): Promise<SatisSatiri | null> {
  const s = await satisGetir(depo, firmaId, id);
  if (!s) return null;
  return satirKur(depo, firmaId, s, await alacakKalanlari(depo, firmaId, [s]), bugun);
}

export interface ProjeSatislari {
  satirlar: SatisSatiri[];
  /** Satışa açık (müteahhidin, satışı olmayan) bölüm sayısı. */
  satisaAcik: number;
  ozet: { adet: number; rezerve: number; net: number; tahsil: number; kalan: number; geciken: number };
}

export async function projeSatislari(depo: Depo, firmaId: string, projeId: string, bugun: Tarih): Promise<ProjeSatislari> {
  const [satislar, bolumler] = await Promise.all([depo.listele('satis', { projeId, firmaId }), depo.listele('bagimsizBolum', { projeId, firmaId })]);
  const aktifler = aktif(satislar);
  const kalanlar = await alacakKalanlari(depo, firmaId, aktifler);
  const satirlar: SatisSatiri[] = [];
  for (const s of aktifler) {
    const x = await satirKur(depo, firmaId, s, kalanlar, bugun);
    if (x) satirlar.push(x);
  }
  satirlar.sort((a, b) => a.bolumNo.localeCompare(b.bolumNo, 'tr', { numeric: true }));
  const satilan = new Set(aktifler.map((s) => s.bolumId));
  const imzali = satirlar.filter((x) => x.satis.onay);
  const t = (f: (x: SatisSatiri) => number) => imzali.reduce((s, x) => s + f(x), 0);
  return {
    satirlar,
    satisaAcik: aktif(bolumler).filter((b) => b.sahiplik !== 'arsa_sahibi' && !satilan.has(b.id)).length,
    ozet: {
      adet: imzali.length,
      rezerve: satirlar.length - imzali.length,
      net: t((x) => x.ozet.net),
      tahsil: t((x) => x.ozet.tahsil),
      kalan: t((x) => x.ozet.kalan),
      geciken: t((x) => x.ozet.geciken),
    },
  };
}

/** Satışa açık bölümler (yeni satış ekranındaki seçim için), blok ve numara sırasıyla. */
export async function satisaAcikBolumler(depo: Depo, firmaId: string, projeId: string): Promise<{ bolum: BagimsizBolum; no: string }[]> {
  const [bolumler, bloklar, satislar] = await Promise.all([
    depo.listele('bagimsizBolum', { projeId, firmaId }),
    depo.listele('blok', { projeId, firmaId }),
    depo.listele('satis', { projeId, firmaId }),
  ]);
  const satilan = new Set(aktif(satislar).map((s) => s.bolumId));
  const blokAdi = new Map(bloklar.map((b) => [b.id, b.ad]));
  return aktif(bolumler)
    .filter((b) => b.sahiplik !== 'arsa_sahibi' && !satilan.has(b.id))
    .map((bolum) => ({ bolum, no: bolumNo(blokAdi.get(bolum.blokId), bolum.no) }))
    .sort((a, b) => a.no.localeCompare(b.no, 'tr', { numeric: true }));
}

export interface ProtokolBelgesi {
  satis: Satis;
  metin: SozlesmeMetni;
}

export async function protokolGetir(depo: Depo, firma: Firma, id: string): Promise<ProtokolBelgesi | null> {
  const s = await satisGetir(depo, firma.id, id);
  if (!s) return null;
  const [cari, proje, b] = await Promise.all([depo.getir('cari', s.cariId), depo.getir('proje', s.projeId), bolumHazirla(depo, firma.id, s.bolumId)]);
  if (!cari || !proje) return null;
  return {
    satis: s,
    metin: satisProtokolu(satisIcerigi(s), {
      firma,
      cari,
      proje,
      projeAdresi: tamAdres(proje),
      bolum: b.bolum,
      blokAdi: b.blok?.ad ?? null,
      katAdi: b.kat?.ad ?? null,
    }),
  };
}
