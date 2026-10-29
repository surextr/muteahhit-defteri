import { aramaAnahtari } from '../hesap/metin';
import { sozlesmeIcerigi } from './ustaSozlesmesi';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { Cari, CariRol, Firma, GecikmeCezasi, KatKarsiligiSozlesme, Satis, SozlesmeKalemi, UstaSozlesmesi, UstaTipi, YzSozlesme, YzTaraf } from '../veri/tipler';
import { katKarsiligiGetir, katKarsiligiKaydet } from './arsaSahibi';
import { cariOlustur, type CariOzeti } from './cari';
import { havuzBagla } from './havuz';
import { arsaSahibiOdemesiEkle, katKarsiligiAyrintilariKaydet } from './katKarsiligi';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import { satisIcerigi, satisKaydet, satisOlustur } from './satis';
import { odemePlaniKaydet } from './taahhut';
import { ustaSozlesmesiKaydet, ustaSozlesmesiOlustur } from './ustaSozlesmesi';

// Program dışında imzalanmış eski sözleşmeyi (yapay zekâ ile okunmuş) programa kurar: usta/taşeron sözleşmesi,
// kat karşılığı sözleşmesi ya da daire satışı. Okunamayan bilgi boş kalır (program uydurmaz); sözleşme taslak
// kurulur, kullanıcı eksikleri tamamlayıp imzalı olarak onaylar. Taranmış asıl nüsha kayda bağlanır.

const PROGRAM_DISI_NOTU = 'Bu sözleşme program dışında imzalanmıştır; asıl nüsha belgelerdedir.';

/** Okunan kişi/firma için kayıtlı cari: önce TC/VKN, sonra ad (Türkçe harfsiz) eşleşmesi. */
export function cariEslestir(cariler: CariOzeti[], t: { ad: string | null; no: string | null }): Cari | null {
  const aktif = cariler.map((c) => c.cari).filter((c) => !c.roller.includes('vergi_dairesi'));
  if (t.no) {
    const c = aktif.find((x) => (x.vergiNo ?? '').replace(/\D/g, '') === t.no);
    if (c) return c;
  }
  if (t.ad) {
    const a = aramaAnahtari(t.ad);
    return aktif.find((x) => aramaAnahtari(x.ad) === a) ?? null;
  }
  return null;
}

/** Okunan iş adlarına ("Sıva", "Kalıp") uyan usta tipleri; tip adının ilk 4 harfi iş adında geçiyorsa ya da tersi. */
export function tipEslestir(tipler: UstaTipi[], isler: string[]): string[] {
  const kok = (s: string) => aramaAnahtari(s.replace(/\s*\([^)]*\)/g, '')).replace(/[^a-z0-9 ]/g, '').trim();
  const sonuc: string[] = [];
  for (const is of isler) {
    const i = kok(is);
    if (i.length < 3) continue;
    const t = tipler.find((x) => {
      const k = kok(x.ad);
      return k.length >= 3 && (i.includes(k.slice(0, 4)) || k.includes(i.slice(0, 4)));
    });
    if (t && !sonuc.includes(t.id)) sonuc.push(t.id);
  }
  return sonuc;
}

/** Okunan bilgilerle (ad, TC/VKN, telefon, adres, yetkili) cari kartı açar. */
export function okunanCariyiAc(depo: Depo, servis: KayitServisi, t: YzTaraf, rol: CariRol): Promise<Cari> {
  if (!t.ad) throw new IsKuraliHatasi('Sözleşmede karşı tarafın adı okunamadı; cariyi listeden seçin ya da elle açın.');
  return cariOlustur(
    depo,
    servis,
    { ad: t.ad, roller: [rol], telefon: t.telefon, vergiNo: t.no, adres: t.adres, not: '', yetkili: rol === 'taseron' ? t.yetkili : null },
    null,
    { ayniAdOnayli: true },
  );
}

/** Usta/taşeron sözleşmesi: tiplerden kurulur, okunan kalemler, tarihler, şartlar ve ödeme planı yazılır. */
export async function ustaSozlesmesiKur(
  depo: Depo,
  servis: KayitServisi,
  firma: Firma,
  g: { havuzId: string; projeId: string; cariId: string; ustaTipiIdleri: string[]; okuma: YzSozlesme },
): Promise<{ sozlesme: UstaSozlesmesi; uyarilar: string[] }> {
  const u = g.okuma.usta;
  const uyarilar: string[] = [];
  const s = await ustaSozlesmesiOlustur(depo, servis, firma, { projeId: g.projeId, ustaTipiIdleri: g.ustaTipiIdleri, cariId: g.cariId });
  const ic = sozlesmeIcerigi(s);
  const tipKodu = new Map<string, string | null>();
  for (const k of ic.kalemler) if (!tipKodu.has(k.ustaTipiId)) tipKodu.set(k.ustaTipiId, k.butceKalemiKodu);
  const tipAdi = new Map(ic.bolumler.map((b) => [b.ustaTipiId, aramaAnahtari(b.ustaTipiAdi)]));
  const bolumBul = (is: string | null) => {
    if (!is) return ic.bolumler[0]!.ustaTipiId;
    const i = aramaAnahtari(is).slice(0, 4);
    return ic.bolumler.find((b) => tipAdi.get(b.ustaTipiId)!.includes(i))?.ustaTipiId ?? ic.bolumler[0]!.ustaTipiId;
  };
  if (u && u.kalemler.length > 0) {
    ic.kalemler = u.kalemler.map((k): SozlesmeKalemi => {
      const ustaTipiId = bolumBul(k.is);
      if (k.birimFiyat === null) uyarilar.push(`"${k.ad}" kaleminin birim fiyatı okunamadı.`);
      if (!k.birim) uyarilar.push(`"${k.ad}" kaleminin birimi okunamadı.`);
      return {
        id: yeniId(),
        ustaTipiId,
        ad: k.ad,
        birim: k.birim ?? '…',
        aciklama: '',
        miktar: k.miktar,
        birimFiyat: k.birimFiyat ?? 0,
        butceKalemiKodu: tipKodu.get(ustaTipiId) ?? null,
      };
    });
  } else {
    uyarilar.push('Sözleşmede kalem okunamadı; şablondaki kalemler fiyatsız geldi.');
  }
  ic.sozlesmeTarihi = g.okuma.tarih ?? ic.sozlesmeTarihi;
  ic.baslamaTarihi = u?.baslama ?? null;
  ic.bitisTarihi = u?.bitis && (!u.baslama || u.bitis >= u.baslama) ? u.bitis : null;
  if (u?.ozelSartlar.length) ic.ozelSartlar = u.ozelSartlar.map((m, i) => (/^\d+[.)-]/.test(m) ? m : `${i + 1}. ${m}`)).join('\n');
  if (u?.hakedisSekli) ic.odemeKosulu = u.hakedisSekli;
  if (u?.teminatOrani !== null && u?.teminatOrani !== undefined && u.teminatOrani >= 0 && u.teminatOrani <= 50) ic.teminatOrani = u.teminatOrani;
  ic.not = [PROGRAM_DISI_NOTU, ic.not].filter(Boolean).join('\n');
  const sozlesme = await ustaSozlesmesiKaydet(depo, servis, s.id, ic);
  const plan = (u?.odemePlani ?? []).filter((p): p is { vade: string; tutar: number; aciklama: string } => !!p.vade && !!p.tutar && p.tutar > 0);
  if (plan.length > 0) await odemePlaniKaydet(depo, servis, s.id, plan.map((p) => ({ vadeTarihi: p.vade, tutar: p.tutar, aciklama: p.aciklama })));
  if (plan.length < (u?.odemePlani.length ?? 0)) uyarilar.push('Vadesi ya da tutarı okunamayan ödeme planı satırları alınmadı.');
  await havuzBagla(depo, servis, g.havuzId, { tablo: 'ustaSozlesmesi', id: s.id, tur: 'sozlesme', ad: 'İmzalı sözleşme (program dışı)' });
  return { sozlesme, uyarilar };
}

const CEZA_BIRIMI: Record<'daire_aylik' | 'toplam_aylik' | 'gunluk', GecikmeCezasi['birim']> = { daire_aylik: 'daire_ay', toplam_aylik: 'ay', gunluk: 'gun' };

/** Kat karşılığı: paylaşım, arsa sahipleri ve hisseleri, tarih/teslim/ceza; tek arsa sahibinde nakit ödeme planı. */
export async function katKarsiligiKur(
  depo: Depo,
  servis: KayitServisi,
  g: { havuzId: string; projeId: string; oran: number; sahipler: { cariId: string; hisse: number }[]; okuma: YzSozlesme },
): Promise<{ sozlesme: KatKarsiligiSozlesme; uyarilar: string[] }> {
  if (await katKarsiligiGetir(depo, servis.oturum.firmaId, g.projeId)) {
    throw new IsKuraliHatasi('Bu projede kat karşılığı sözleşmesi zaten var; belgeyi "Bir kayda bağla" ile ona ekleyin.');
  }
  const k = g.okuma.katKarsiligi;
  const uyarilar: string[] = [];
  await katKarsiligiKaydet(depo, servis, g.projeId, { arsaSahibiOrani: g.oran, payYontemi: 'brut', arsaSahipleri: g.sahipler });
  const teslimSuresiAy = k?.teslimSuresiAy && Number.isInteger(k.teslimSuresiAy) && k.teslimSuresiAy >= 1 && k.teslimSuresiAy <= 120 ? k.teslimSuresiAy : null;
  const sozlesme = await katKarsiligiAyrintilariKaydet(depo, servis, g.projeId, {
    sozlesmeTarihi: g.okuma.tarih,
    teslimTarihi: teslimSuresiAy ? null : (k?.teslimTarihi ?? null),
    teslimSuresiAy,
    gecikmeCezasi: k?.gecikmeCezasi ? { tutar: k.gecikmeCezasi.tutar, birim: CEZA_BIRIMI[k.gecikmeCezasi.birim] } : null,
    not: PROGRAM_DISI_NOTU,
    kiralar: [],
  });
  if (k?.kiraYardimiAylik) uyarilar.push('Kira yardımı okundu; başlangıç ayıyla birlikte arsa sahipleri kartından girin.');
  const odemeler = (k?.nakitOdemeler ?? []).filter((o) => o.tutar && o.tutar > 0);
  if (odemeler.length > 0 && g.sahipler.length === 1) {
    for (const o of odemeler) {
      await arsaSahibiOdemesiEkle(depo, servis, g.projeId, { cariId: g.sahipler[0]!.cariId, vadeTarihi: o.vade, kosul: o.vade ? '' : o.aciklama || 'Sözleşmeye göre', tutar: o.tutar!, aciklama: o.aciklama });
    }
  } else if (odemeler.length > 0) {
    uyarilar.push('Arsa sahiplerine nakit ödemeler okundu; kime ödeneceği belli olmadığı için kat karşılığı kartından girin.');
  }
  await havuzBagla(depo, servis, g.havuzId, { tablo: 'katKarsiligiSozlesme', id: sozlesme.id, tur: 'sozlesme', ad: 'İmzalı kat karşılığı sözleşmesi' });
  return { sozlesme, uyarilar };
}

/** Daire satışı: rezerve edilir, fiyat/KDV/plan/teslim yazılır; imza kullanıcıda. */
export async function satisKur(
  depo: Depo,
  servis: KayitServisi,
  firma: Firma,
  g: { havuzId: string; bolumId: string; cariId: string; okuma: YzSozlesme; bugun: string },
): Promise<{ satis: Satis; uyarilar: string[] }> {
  const s = g.okuma.satis;
  const uyarilar: string[] = [];
  const yeni = await satisOlustur(depo, servis, firma, { bolumId: g.bolumId, cariId: g.cariId, tarih: g.okuma.tarih ?? g.bugun });
  if (!g.okuma.tarih) uyarilar.push('Sözleşme tarihi okunamadı; bugünün tarihi yazıldı, düzeltin.');
  const ic = satisIcerigi(yeni);
  if (s?.paraBirimi && s.paraBirimi !== 'TRY') uyarilar.push(`Satış ${s.paraBirimi} cinsinden; dövizli satış bilgisini (kur) girin.`);
  else if (s?.fiyat) ic.fiyat = s.fiyat;
  if (s?.kdvOrani !== null && s?.kdvOrani !== undefined && [0, 1, 10, 20].includes(s.kdvOrani)) ic.kdvOrani = s.kdvOrani;
  ic.teslimTarihi = s?.teslimTarihi ?? null;
  const plan = (s?.plan ?? []).filter((p): p is typeof p & { vade: string; tutar: number } => !!p.vade && p.tutar !== null && p.tutar > 0);
  if (plan.length < (s?.plan.length ?? 0)) uyarilar.push('Vadesi okunamayan ödeme satırları alınmadı; planı tamamlayın.');
  if (s?.paraBirimi === 'TRY' || !s?.paraBirimi) ic.plan = plan.map((p) => ({ id: yeniId(), tur: p.tur, vadeTarihi: p.vade, tutar: p.tutar, aciklama: '', alacakId: null }));
  ic.not = [PROGRAM_DISI_NOTU, ic.not].filter(Boolean).join('\n');
  const satis = await satisKaydet(depo, servis, yeni.id, ic);
  await havuzBagla(depo, servis, g.havuzId, { tablo: 'satis', id: yeni.id, tur: 'sozlesme', ad: 'İmzalı satış sözleşmesi' });
  return { satis, uyarilar };
}

/** Hisseler okunmadıysa eşit bölünür (toplam %100; son kişi küsuratı alır). */
export function hisseleriTamamla(hisseler: (number | null)[]): number[] {
  if (hisseler.length === 0) return [];
  if (hisseler.every((h) => h !== null && h > 0)) return hisseler as number[];
  const esit = Math.floor((100 / hisseler.length) * 100) / 100;
  return hisseler.map((_, i) => (i === hisseler.length - 1 ? Math.round((100 - esit * (hisseler.length - 1)) * 100) / 100 : esit));
}
