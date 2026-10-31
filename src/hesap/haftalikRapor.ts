import type { DaireTeslimi, EksikIs, Hakedis, Kurus, MalzemeHareketi, MalzemeTalebi, ProjeFotografi, SantiyeGunlugu, Satis, Tarih, TakipBasligi, UstaSozlesmesi } from '../veri/tipler';
import { HAVA } from './gunluk';
import type { ProjeIlerlemesi } from './ilerleme';
import { tlYaz } from './para';

// Haftalık şantiye raporu (saf): pazartesi–pazar; günlüklerden çalışılan gün, adam-gün, ekipler, yapılan işler ve sorunlar;
// ilerleme değişimi; ana kaleme göre harcama; teslim alınan malzeme; hakediş, sözleşme, satış, teslim olayları; eksik işler;
// fotoğraflar; gelecek hafta. Hiçbir şey saklanmaz.

const gunEkle = (t: Tarih, n: number): Tarih => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const icinde = (t: Tarih | null | undefined, bas: Tarih, bit: Tarih) => !!t && t >= bas && t <= bit;
const gun = (zaman: string) => zaman.slice(0, 10);
const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);

/** Tarihin haftasının pazartesisi. */
export function haftaBasi(t: Tarih): Tarih {
  const g = new Date(`${t}T00:00:00Z`).getUTCDay(); // 0 pazar
  return gunEkle(t, -((g + 6) % 7));
}

export const haftaSonu = (bas: Tarih): Tarih => gunEkle(bas, 6);

export interface HaftaGirdisi {
  baslangic: Tarih;
  bugun: Tarih;
  gunlukler: SantiyeGunlugu[];
  cariAdi: Map<string, string>;
  bolumAdi: Map<string, string>;
  /** Hafta başından önceki ve hafta sonundaki ilerleme / harcama. */
  ilerlemeOnce: ProjeIlerlemesi;
  ilerlemeSonra: ProjeIlerlemesi;
  /** Haftada girilen fatura sayısı (iade hariç). */
  faturaSayisi: number;
  hareketler: MalzemeHareketi[];
  fotograflar: ProjeFotografi[];
  hakedisler: Hakedis[];
  sozlesmeler: UstaSozlesmesi[];
  satislar: Satis[];
  teslimler: DaireTeslimi[];
  eksikler: EksikIs[];
  talepler: MalzemeTalebi[];
  basliklar: TakipBasligi[];
  /** Gelecek hafta vadesi gelen ödenmemiş faturalar. */
  odenecek: { baslik: string; vade: Tarih; tutar: Kurus }[];
}

export interface RaporGunu {
  tarih: Tarih;
  gunluk: boolean;
  hava: string | null;
  calisilmadi: boolean;
  kisi: number;
  yapilan: string;
}

export interface HaftalikRapor {
  baslangic: Tarih;
  bitis: Tarih;
  /** Hafta bitmediyse bugüne kadar. */
  devamEdiyor: boolean;
  gunler: RaporGunu[];
  calisilanGun: number;
  calisilmayanGun: number;
  gunluksuzGun: number;
  adamGun: number;
  ekipler: { ad: string; adamGun: number; isler: string[] }[];
  ilerleme: { once: number | null; sonra: number | null; kalemler: { ad: string; once: number | null; sonra: number }[] };
  harcama: { toplam: Kurus; kalemler: { ad: string; tutar: Kurus }[]; faturaSayisi: number };
  malzeme: { ad: string; birim: string; miktar: number }[];
  olaylar: { tarih: Tarih; metin: string }[];
  eksik: { acilan: number; kapanan: number; acik: number; geciken: number };
  sorunlar: { tarih: Tarih; metin: string }[];
  fotograflar: ProjeFotografi[];
  gelecek: { odenecek: { baslik: string; vade: Tarih; tutar: Kurus }[]; malzeme: { ad: string; gerekli: Tarih }[]; asamalar: string[] };
  /** Raporda hiçbir şey yok (günlük, gider, olay…). */
  bos: boolean;
}

/** Eşit aralıklı en çok `n` öğe (sıra korunur). */
function esitSec<T>(l: T[], n: number): T[] {
  if (l.length <= n) return l;
  return Array.from({ length: n }, (_, i) => l[Math.round((i * (l.length - 1)) / (n - 1))]!);
}

export function haftalikRapor(g: HaftaGirdisi): HaftalikRapor {
  const bas = g.baslangic;
  const bit = haftaSonu(bas);
  const son = g.bugun < bit ? g.bugun : bit;
  const gunlukler = aktif(g.gunlukler).filter((x) => icinde(x.tarih, bas, bit));
  const gunlukGunu = new Map(gunlukler.map((x) => [x.tarih, x]));

  // Ekipler ve adam-gün: ekip kişi sayısı + yevmiyeli işçi (tam 1, yarım 0,5).
  const ekipler = new Map<string, { adamGun: number; isler: Set<string> }>();
  const ekipEkle = (ad: string, n: number, is: string) => {
    const e = ekipler.get(ad) ?? { adamGun: 0, isler: new Set<string>() };
    e.adamGun += n;
    if (is.trim()) e.isler.add(is.trim());
    ekipler.set(ad, e);
  };
  const gunler: RaporGunu[] = [];
  for (let i = 0; i < 7; i++) {
    const t = gunEkle(bas, i);
    const x = gunlukGunu.get(t);
    let kisi = 0;
    if (x && !x.calisilmadi) {
      for (const e of x.ekipler) {
        kisi += e.kisi;
        ekipEkle(e.cariId ? (g.cariAdi.get(e.cariId) ?? e.ad) : e.ad || 'Ekip', e.kisi, e.is);
      }
      for (const p of x.puantaj) {
        const n = p.durum === 'tam' ? 1 : p.durum === 'yarim' ? 0.5 : 0;
        if (!n) continue;
        kisi += n;
        ekipEkle('Yevmiyeli işçiler', n, '');
      }
    }
    gunler.push({ tarih: t, gunluk: !!x, hava: x?.hava ? `${HAVA[x.hava].ad}${x.sicaklik !== null ? ` ${x.sicaklik}°` : ''}` : null, calisilmadi: !!x?.calisilmadi, kisi, yapilan: x?.yapilanIsler.trim() ?? '' });
  }
  const gecen = gunler.filter((x) => x.tarih <= son);

  // İlerleme: ana kalemlerde değişen yüzde.
  const onceYuzde = new Map(g.ilerlemeOnce.kalemler.map((k) => [k.kalem.id, k.yuzde]));
  const onceHarcanan = new Map(g.ilerlemeOnce.kalemler.map((k) => [k.kalem.id, k.harcanan]));
  const ilerlemeKalemleri = g.ilerlemeSonra.kalemler
    .filter((k) => k.yuzde !== null && k.yuzde !== (onceYuzde.get(k.kalem.id) ?? null))
    .map((k) => ({ ad: k.kalem.ad, once: onceYuzde.get(k.kalem.id) ?? null, sonra: k.yuzde! }));
  const harcamaKalemleri = g.ilerlemeSonra.kalemler
    .map((k) => ({ ad: k.kalem.ad, tutar: k.harcanan - (onceHarcanan.get(k.kalem.id) ?? 0) }))
    .filter((k) => k.tutar !== 0)
    .sort((a, b) => b.tutar - a.tutar);
  const harcamaToplam = g.ilerlemeSonra.harcanan - g.ilerlemeOnce.harcanan;
  const kalemliToplam = harcamaKalemleri.reduce((t, k) => t + k.tutar, 0);
  if (harcamaToplam - kalemliToplam !== 0) harcamaKalemleri.push({ ad: 'Kalemi seçilmemiş', tutar: harcamaToplam - kalemliToplam });

  // Malzeme girişleri: ad + birim başına.
  const malzeme = new Map<string, { ad: string; birim: string; miktar: number }>();
  for (const h of aktif(g.hareketler)) {
    if (h.tur !== 'giris' || !icinde(h.tarih, bas, bit)) continue;
    const a = `${h.ad.toLocaleLowerCase('tr')}|${h.birim}`;
    const m = malzeme.get(a) ?? { ad: h.ad, birim: h.birim, miktar: 0 };
    m.miktar += h.miktar;
    malzeme.set(a, m);
  }

  // Olaylar.
  const olaylar: { tarih: Tarih; metin: string }[] = [];
  for (const h of aktif(g.hakedisler)) if (h.onay && icinde(gun(h.onay.zaman), bas, bit)) olaylar.push({ tarih: gun(h.onay.zaman), metin: `${g.cariAdi.get(h.cariId) ?? '?'} ${h.no}. hakedişi onaylandı (${tlYaz(h.borcTutari)})` });
  for (const s of aktif(g.sozlesmeler)) if (s.onay && icinde(gun(s.onay.zaman), bas, bit)) olaylar.push({ tarih: gun(s.onay.zaman), metin: `${g.cariAdi.get(s.cariId) ?? '?'} ile ${s.ustaTipiAdi} sözleşmesi imzalandı` });
  for (const s of aktif(g.satislar)) {
    if (s.onay && icinde(gun(s.onay.zaman), bas, bit)) olaylar.push({ tarih: gun(s.onay.zaman), metin: `${g.bolumAdi.get(s.bolumId) ?? '?'} satıldı (${g.cariAdi.get(s.cariId) ?? '?'})` });
    else if (!s.onay && icinde(s.tarih, bas, bit)) olaylar.push({ tarih: s.tarih, metin: `${g.bolumAdi.get(s.bolumId) ?? '?'} rezerve edildi (${g.cariAdi.get(s.cariId) ?? '?'})` });
  }
  for (const t of aktif(g.teslimler)) if (icinde(t.tamamlandi, bas, bit)) olaylar.push({ tarih: t.tamamlandi!, metin: `${g.bolumAdi.get(t.bolumId) ?? '?'} teslim edildi` });
  for (const b of aktif(g.basliklar)) {
    if (icinde(b.baslangicTarihi, bas, bit)) olaylar.push({ tarih: b.baslangicTarihi!, metin: `${b.ad} başladı` });
    if (b.durum === 'tamamlandi' && icinde(b.bitisTarihi, bas, bit)) olaylar.push({ tarih: b.bitisTarihi!, metin: `${b.ad} tamamlandı` });
  }
  olaylar.sort((a, b) => a.tarih.localeCompare(b.tarih));

  const eksikler = aktif(g.eksikler);
  const sonrakiBas = gunEkle(bit, 1);
  const sonrakiBit = gunEkle(bit, 7);

  const fotograflar = esitSec(
    aktif(g.fotograflar)
      .filter((f) => icinde(f.cekimTarihi, bas, bit))
      .sort((a, b) => a.cekimTarihi.localeCompare(b.cekimTarihi) || (a.cekimZamani ?? '').localeCompare(b.cekimZamani ?? '')),
    8,
  );

  const rapor: HaftalikRapor = {
    baslangic: bas,
    bitis: bit,
    devamEdiyor: g.bugun < bit,
    gunler,
    // Ekip yazılmasa da iş yazılan gün çalışılmış sayılır.
    calisilanGun: gecen.filter((x) => x.gunluk && !x.calisilmadi && (x.kisi > 0 || x.yapilan !== '')).length,
    calisilmayanGun: gecen.filter((x) => x.calisilmadi).length,
    gunluksuzGun: gecen.filter((x) => !x.gunluk).length,
    adamGun: gunler.reduce((t, x) => t + x.kisi, 0),
    ekipler: [...ekipler].map(([ad, e]) => ({ ad, adamGun: e.adamGun, isler: [...e.isler] })).sort((a, b) => b.adamGun - a.adamGun),
    ilerleme: { once: g.ilerlemeOnce.ilerleme, sonra: g.ilerlemeSonra.ilerleme, kalemler: ilerlemeKalemleri },
    harcama: { toplam: harcamaToplam, kalemler: harcamaKalemleri, faturaSayisi: g.faturaSayisi },
    malzeme: [...malzeme.values()],
    olaylar,
    eksik: {
      acilan: eksikler.filter((e) => icinde(gun(e.olusturmaZamani), bas, bit)).length,
      kapanan: eksikler.filter((e) => icinde(e.yapildi, bas, bit)).length,
      acik: eksikler.filter((e) => !e.yapildi).length,
      geciken: eksikler.filter((e) => !e.yapildi && e.sonTarih && e.sonTarih < g.bugun).length,
    },
    sorunlar: gunlukler.filter((x) => x.sorunlar.trim()).map((x) => ({ tarih: x.tarih, metin: x.sorunlar.trim() })).sort((a, b) => a.tarih.localeCompare(b.tarih)),
    fotograflar,
    gelecek: {
      odenecek: g.odenecek.filter((x) => icinde(x.vade, sonrakiBas, sonrakiBit)).sort((a, b) => a.vade.localeCompare(b.vade)),
      malzeme: aktif(g.talepler)
        .filter((t) => !t.kapandi && icinde(t.gerekenTarih, sonrakiBas, sonrakiBit))
        .map((t) => ({ ad: t.satirlar.map((s) => s.ad).slice(0, 3).join(', '), gerekli: t.gerekenTarih! })),
      asamalar: aktif(g.basliklar)
        .filter((b) => b.durum === 'devam')
        .sort((a, b) => a.sira - b.sira)
        .map((b) => b.ad),
    },
    bos: false,
  };
  rapor.bos = gunlukler.length === 0 && harcamaToplam === 0 && olaylar.length === 0 && malzeme.size === 0 && fotograflar.length === 0 && ilerlemeKalemleri.length === 0;
  return rapor;
}

const tarihKisa = (t: Tarih) => new Date(`${t}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
const yuzde = (n: number | null) => (n === null ? '—' : `%${(Math.round(n * 10) / 10).toLocaleString('tr-TR')}`);
export const haftaAdi = (r: Pick<HaftalikRapor, 'baslangic' | 'bitis'>) => `${tarihKisa(r.baslangic)} – ${tarihKisa(r.bitis)}`;
export const yuzdeYazi = yuzde;

/** WhatsApp özeti (ortaklara / yöneticiye). */
export function haftalikMesaj(projeAdi: string, r: HaftalikRapor, firmaAdi: string): string {
  const s: string[] = [`${projeAdi} · haftalık rapor (${haftaAdi(r)})`, ''];
  s.push(`• Çalışılan gün: ${r.calisilanGun}${r.calisilmayanGun ? `, hava yüzünden ${r.calisilmayanGun} gün çalışılmadı` : ''} · ${r.adamGun.toLocaleString('tr-TR')} adam-gün`);
  if (r.ilerleme.sonra !== null) s.push(`• İlerleme: ${yuzde(r.ilerleme.once)} → ${yuzde(r.ilerleme.sonra)}`);
  if (r.harcama.toplam) s.push(`• Harcama: ${tlYaz(r.harcama.toplam)}${r.harcama.kalemler[0] ? ` (en çok ${r.harcama.kalemler[0].ad})` : ''}`);
  for (const o of r.olaylar.slice(0, 5)) s.push(`• ${o.metin}`);
  if (r.malzeme.length) s.push(`• Gelen malzeme: ${r.malzeme.slice(0, 4).map((m) => `${m.ad} ${m.miktar.toLocaleString('tr-TR')} ${m.birim}`).join(', ')}`);
  if (r.eksik.acik) s.push(`• Açık eksik iş: ${r.eksik.acik}${r.eksik.geciken ? ` (${r.eksik.geciken} gecikti)` : ''}`);
  if (r.sorunlar.length) s.push(`• Sorun: ${r.sorunlar.map((x) => x.metin).join(' / ')}`);
  if (r.gelecek.odenecek.length) s.push(`• Gelecek hafta ödenecek: ${tlYaz(r.gelecek.odenecek.reduce((t, x) => t + x.tutar, 0))}`);
  s.push('', firmaAdi);
  return s.join('\n');
}
