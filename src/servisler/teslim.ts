import { bolumNo } from '../hesap/bolum';
import {
  bosSayaclar,
  eksikIsDurumu,
  eksikIsHatalari,
  eksikIsleriSirala,
  tamamlamaEksikleri,
  teslimHatalari,
  teslimMaddeleriOlustur,
  teslimTutanagi,
} from '../hesap/teslim';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import type { BagimsizBolum, DaireTeslimi, EksikIs, Firma, Tarih } from '../veri/tipler';
import { tamAdres } from './adres';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import { bolumSatisi, satisTeslim } from './satis';
import type { SozlesmeMetni } from '../hesap/ustaSozlesmesi';

// Daire teslimi (şema 26): bölüm başına bir kontrol kaydı (kontrol listesi, sayaçlar, anahtar). Eksik işaretlenen her
// madde bir `eksikIs` açar; madde düzelince açık eksik iş iptal olur. Tamamlanınca bölüm "teslim edildi" olur, imzalı
// satışta anahtar teslimi de yazılır. Eksik işler (teslimden, şantiye kontrolünden, müşteri bildiriminden) sorumlu
// usta, son tarih ve yapıldı bilgisiyle izlenir.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export type TeslimIcerigi = Pick<DaireTeslimi, 'teslimAlan' | 'tarih' | 'maddeler' | 'sayaclar' | 'anahtarSayisi' | 'eksikSonTarih' | 'not'>;
export type EksikIsIcerigi = Pick<EksikIs, 'baslik' | 'aciklama' | 'sorumluCariId' | 'sonTarih'>;

export async function teslimGetir(depo: Depo, firmaId: string, id: string): Promise<DaireTeslimi | null> {
  const t = await depo.getir('daireTeslimi', id);
  return t && t.firmaId === firmaId && !t.iptal ? t : null;
}

export async function bolumTeslimi(depo: Depo, firmaId: string, bolumId: string): Promise<DaireTeslimi | null> {
  return aktif(await depo.listele('daireTeslimi', { firmaId, bolumId }))[0] ?? null;
}

async function bolumGetir(depo: Depo, firmaId: string, bolumId: string): Promise<BagimsizBolum> {
  const b = await depo.getir('bagimsizBolum', bolumId);
  if (!b || b.firmaId !== firmaId || b.iptal) throw new IsKuraliHatasi('Bağımsız bölüm bulunamadı.');
  return b;
}

/** Bölümü kim teslim alır: imzalı ya da rezerve satışın alıcısı, yoksa tahsisli arsa sahibi. */
async function teslimAlanCari(depo: Depo, firmaId: string, bolumId: string): Promise<{ satisId: string | null; cariId: string | null; sifat: string }> {
  const satis = await bolumSatisi(depo, firmaId, bolumId);
  if (satis) return { satisId: satis.id, cariId: satis.cariId, sifat: 'Alıcı' };
  const tahsis = aktif(await depo.listele('arsaSahibiTahsisi', { firmaId })).find((t) => t.bolumId === bolumId);
  if (tahsis) return { satisId: null, cariId: tahsis.cariId, sifat: 'Arsa sahibi' };
  return { satisId: null, cariId: null, sifat: 'Malik' };
}

/** Bölümün teslim kontrolünü açar (varsa olanı döndürür). Maddeler firmanın listesinden, yoksa hazır listeden. */
export async function teslimBaslat(depo: Depo, servis: KayitServisi, firma: Firma, bolumId: string, tarih: Tarih): Promise<DaireTeslimi> {
  const firmaId = servis.oturum.firmaId;
  if (!TARIH.test(tarih)) throw new IsKuraliHatasi('Kontrol gününü seçin.');
  return depo.islem(async () => {
    const mevcut = await bolumTeslimi(depo, firmaId, bolumId);
    if (mevcut) return mevcut;
    const b = await bolumGetir(depo, firmaId, bolumId);
    const kim = await teslimAlanCari(depo, firmaId, bolumId);
    return servis.ekle('daireTeslimi', {
      projeId: b.projeId,
      bolumId,
      satisId: kim.satisId,
      cariId: kim.cariId,
      teslimAlan: '',
      tarih,
      maddeler: teslimMaddeleriOlustur(firma.ayarlar.teslimMaddeleri, yeniId),
      sayaclar: bosSayaclar(),
      anahtarSayisi: null,
      eksikSonTarih: null,
      not: '',
      tamamlandi: null,
    });
  });
}

/**
 * Kontrolü kaydeder ve eksik işleri maddelerle eşitler: eksik maddeye eksik iş açılır (son tarihi tutanaktaki gün),
 * açık eksik işin adı/notu maddeyle güncellenir, eksik olmaktan çıkan ya da silinen maddenin açık eksik işi iptal
 * olur. Yapılmış eksik iş kalır.
 */
export async function teslimKaydet(depo: Depo, servis: KayitServisi, id: string, g: TeslimIcerigi): Promise<DaireTeslimi> {
  const firmaId = servis.oturum.firmaId;
  const icerik: TeslimIcerigi = {
    ...g,
    teslimAlan: g.teslimAlan.trim(),
    not: g.not.trim(),
    maddeler: g.maddeler.map((m) => ({ ...m, grup: m.grup.trim(), ad: m.ad.trim(), not: m.not.trim() })),
    sayaclar: g.sayaclar.map((s) => ({ ...s, no: s.no.trim(), endeks: s.endeks.trim() })),
  };
  const h = teslimHatalari(icerik);
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  return depo.islem(async () => {
    const t = await teslimGetir(depo, firmaId, id);
    if (!t) throw new IsKuraliHatasi('Teslim kaydı bulunamadı.');
    const isler = new Map(aktif(await depo.listele('eksikIs', { firmaId, teslimId: id })).map((e) => [e.id, e]));
    const maddeler = [];
    const kalan = new Set(isler.keys());
    for (const m of icerik.maddeler) {
      const e = m.eksikIsId ? isler.get(m.eksikIsId) : undefined;
      if (m.durum === 'eksik') {
        if (e) {
          kalan.delete(e.id);
          if (!e.yapildi) {
            const degisen: Partial<EksikIs> = {};
            if (e.baslik !== m.ad) degisen.baslik = m.ad;
            if (e.aciklama !== m.not) degisen.aciklama = m.not;
            if (e.sonTarih === t.eksikSonTarih && icerik.eksikSonTarih !== t.eksikSonTarih) degisen.sonTarih = icerik.eksikSonTarih;
            if (Object.keys(degisen).length) await servis.guncelle('eksikIs', e.id, degisen);
          }
          maddeler.push(m);
        } else {
          const yeni = await servis.ekle('eksikIs', {
            projeId: t.projeId,
            bolumId: t.bolumId,
            teslimId: t.id,
            teslimMaddesiId: m.id,
            kaynak: 'teslim',
            baslik: m.ad,
            aciklama: m.not,
            sorumluCariId: null,
            sonTarih: icerik.eksikSonTarih,
            yapildi: null,
            yapildiNot: '',
          });
          maddeler.push({ ...m, eksikIsId: yeni.id });
        }
      } else {
        // Eksik olmaktan çıktı: yapılmışsa bağ kalır (tarihçe), açıksa iptal.
        if (e?.yapildi) kalan.delete(e.id);
        maddeler.push(e?.yapildi ? m : { ...m, eksikIsId: null });
      }
    }
    for (const eid of kalan) {
      const e = isler.get(eid)!;
      if (!e.yapildi && e.teslimMaddesiId) await servis.iptal('eksikIs', eid, 'Teslim kontrolünde eksik kaldırıldı.');
    }
    return servis.guncelle('daireTeslimi', id, { ...icerik, maddeler });
  });
}

export interface TeslimSonucu {
  teslim: DaireTeslimi;
  /** Arsa sahibinin tahsisli bütün bölümleri teslim edildiyse (kat karşılığında teslim alma günü yazılabilir). */
  arsaSahibiTamam: boolean;
}

/** Teslimi tamamlar: bütün maddelere bakılmış olmalı; bölüm "teslim edildi", imzalı satışta anahtar teslimi yazılır. */
export async function teslimTamamla(depo: Depo, servis: KayitServisi, id: string, tarih: Tarih, gerekce?: string): Promise<TeslimSonucu> {
  const firmaId = servis.oturum.firmaId;
  if (!TARIH.test(tarih)) throw new IsKuraliHatasi('Teslim gününü seçin.');
  const t = await teslimGetir(depo, firmaId, id);
  if (!t) throw new IsKuraliHatasi('Teslim kaydı bulunamadı.');
  if (t.tamamlandi) throw new IsKuraliHatasi('Bu bölüm zaten teslim edildi.');
  const eksik = tamamlamaEksikleri(t);
  if (eksik.length) throw new IsKuraliHatasi(eksik.join(' '));
  if (tarih < t.tarih) throw new IsKuraliHatasi('Teslim günü kontrol gününden önce olamaz.');
  const satis = t.satisId ? await depo.getir('satis', t.satisId) : null;
  if (satis && !satis.iptal && !satis.onay) throw new IsKuraliHatasi('Satış protokolü imzalanmadan bölüm teslim edilmez.');

  // Satış ekranından anahtar teslimi zaten yazıldıysa dokunulmaz.
  if (satis && !satis.iptal && !satis.teslimEdildi) await satisTeslim(depo, servis, satis.id, tarih, gerekce);
  return depo.islem(async () => {
    await servis.guncelle('bagimsizBolum', t.bolumId, { teslimDurumu: 'teslim_edildi' });
    const teslim = await servis.guncelle('daireTeslimi', id, { tamamlandi: tarih });
    let arsaSahibiTamam = false;
    if (!t.satisId && t.cariId) {
      const tahsisler = aktif(await depo.listele('arsaSahibiTahsisi', { firmaId })).filter((x) => x.cariId === t.cariId);
      const bolumler = await Promise.all(tahsisler.map((x) => depo.getir('bagimsizBolum', x.bolumId)));
      arsaSahibiTamam = bolumler.every((b) => !b || b.iptal || b.teslimDurumu === 'teslim_edildi');
    }
    return { teslim, arsaSahibiTamam };
  });
}

/** Teslimi geri alır (yanlış giriş): bölüm "teslim edilmedi" olur, satıştaki anahtar teslimi kaldırılır. */
export async function teslimGeriAl(depo: Depo, servis: KayitServisi, id: string, gerekce?: string): Promise<DaireTeslimi> {
  const firmaId = servis.oturum.firmaId;
  const t = await teslimGetir(depo, firmaId, id);
  if (!t?.tamamlandi) throw new IsKuraliHatasi('Teslim edilmiş bir kayıt değil.');
  const satis = t.satisId ? await depo.getir('satis', t.satisId) : null;
  if (satis && !satis.iptal && satis.teslimEdildi) await satisTeslim(depo, servis, satis.id, null, gerekce);
  return depo.islem(async () => {
    await servis.guncelle('bagimsizBolum', t.bolumId, { teslimDurumu: 'teslim_edilmedi' });
    return servis.guncelle('daireTeslimi', id, { tamamlandi: null });
  });
}

/** Henüz teslim edilmemiş kontrol kaydını iptal eder (açtığı eksik işler ve belgeleri de iptal olur). */
export async function teslimIptal(depo: Depo, servis: KayitServisi, id: string, gerekce?: string): Promise<void> {
  const t = await teslimGetir(depo, servis.oturum.firmaId, id);
  if (!t) throw new IsKuraliHatasi('Teslim kaydı bulunamadı.');
  if (t.tamamlandi) throw new IsKuraliHatasi('Teslim edilmiş kayıt iptal edilmez; önce teslimi geri alın.');
  await servis.iptal('daireTeslimi', id, gerekce);
}

/** Bölümün kontrolüyle ilgili okumalar (ekran): bölüm adı, teslim alan, tutanak metni. */
export interface TeslimAyrintisi {
  teslim: DaireTeslimi;
  bolumAdi: string;
  katAdi: string | null;
  projeAdi: string;
  cariAdi: string | null;
  cariTelefon: string | null;
  sifat: string;
  satisImzali: boolean | null;
  eksikler: EksikIs[];
  tutanak: SozlesmeMetni;
}

export async function teslimAyrintisi(depo: Depo, firma: Firma, id: string): Promise<TeslimAyrintisi | null> {
  const t = await teslimGetir(depo, firma.id, id);
  if (!t) return null;
  const [bolum, proje, cari, satis, eksikler] = await Promise.all([
    depo.getir('bagimsizBolum', t.bolumId),
    depo.getir('proje', t.projeId),
    t.cariId ? depo.getir('cari', t.cariId) : Promise.resolve(undefined),
    t.satisId ? depo.getir('satis', t.satisId) : Promise.resolve(undefined),
    depo.listele('eksikIs', { firmaId: firma.id, teslimId: id }),
  ]);
  if (!bolum || !proje) return null;
  const [blok, kat] = await Promise.all([depo.getir('blok', bolum.blokId), depo.getir('kat', bolum.katId)]);
  const sifat = t.satisId ? 'Alıcı' : t.cariId ? 'Arsa sahibi' : 'Malik';
  return {
    teslim: t,
    bolumAdi: bolumNo(blok?.ad, bolum.no),
    katAdi: kat?.ad ?? null,
    projeAdi: proje.ad,
    cariAdi: cari?.ad ?? null,
    cariTelefon: cari?.telefon ?? null,
    sifat,
    satisImzali: satis && !satis.iptal ? !!satis.onay : null,
    eksikler: aktif(eksikler),
    tutanak: teslimTutanagi(t, {
      firma,
      cari: cari ?? null,
      proje,
      projeAdresi: tamAdres(proje),
      bolum,
      blokAdi: blok?.ad ?? null,
      katAdi: kat?.ad ?? null,
      sifat,
    }),
  };
}

// ─── Eksik işler ────────────────────────────────────────────────────

async function eksikIsGetir(depo: Depo, firmaId: string, id: string): Promise<EksikIs> {
  const e = await depo.getir('eksikIs', id);
  if (!e || e.firmaId !== firmaId || e.iptal) throw new IsKuraliHatasi('Eksik iş bulunamadı.');
  return e;
}

async function sorumluDenetle(depo: Depo, firmaId: string, cariId: string | null) {
  if (!cariId) return;
  const c = await depo.getir('cari', cariId);
  if (!c || c.firmaId !== firmaId || c.iptal) throw new IsKuraliHatasi('Sorumlu cari bulunamadı.');
}

export async function eksikIsEkle(
  depo: Depo,
  servis: KayitServisi,
  g: EksikIsIcerigi & { projeId: string; bolumId: string | null; kaynak: 'kontrol' | 'musteri' },
): Promise<EksikIs> {
  const firmaId = servis.oturum.firmaId;
  const icerik = { ...g, baslik: g.baslik.trim(), aciklama: g.aciklama.trim() };
  const h = eksikIsHatalari({ ...icerik, yapildi: null });
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  return depo.islem(async () => {
    const p = await depo.getir('proje', g.projeId);
    if (!p || p.firmaId !== firmaId || p.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
    if (g.bolumId && (await bolumGetir(depo, firmaId, g.bolumId)).projeId !== g.projeId) throw new IsKuraliHatasi('Bölüm bu projede değil.');
    await sorumluDenetle(depo, firmaId, g.sorumluCariId);
    return servis.ekle('eksikIs', { ...icerik, teslimId: null, teslimMaddesiId: null, yapildi: null, yapildiNot: '' });
  });
}

export async function eksikIsKaydet(depo: Depo, servis: KayitServisi, id: string, g: EksikIsIcerigi): Promise<EksikIs> {
  const firmaId = servis.oturum.firmaId;
  const icerik = { ...g, baslik: g.baslik.trim(), aciklama: g.aciklama.trim() };
  const h = eksikIsHatalari({ ...icerik, yapildi: null });
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  return depo.islem(async () => {
    await eksikIsGetir(depo, firmaId, id);
    await sorumluDenetle(depo, firmaId, g.sorumluCariId);
    return servis.guncelle('eksikIs', id, icerik);
  });
}

/** Yapıldı işareti (gün ve not); `tarih` null işareti kaldırır. */
export async function eksikIsYapildi(depo: Depo, servis: KayitServisi, id: string, tarih: Tarih | null, not = ''): Promise<EksikIs> {
  const firmaId = servis.oturum.firmaId;
  if (tarih && !TARIH.test(tarih)) throw new IsKuraliHatasi('Yapıldığı günü seçin.');
  return depo.islem(async () => {
    await eksikIsGetir(depo, firmaId, id);
    return servis.guncelle('eksikIs', id, { yapildi: tarih, yapildiNot: tarih ? not.trim() : '' });
  });
}

/** Teslimden açılan eksik iş teslim ekranından (madde düzeltilerek) kalkar; diğerleri buradan iptal edilir. */
export async function eksikIsIptal(depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  const e = await eksikIsGetir(depo, servis.oturum.firmaId, id);
  if (e.teslimMaddesiId && !e.yapildi) throw new IsKuraliHatasi('Bu eksik teslim kontrolünden geliyor; teslim ekranında maddeyi düzeltin.');
  await servis.iptal('eksikIs', id, 'Eksik iş kaldırıldı.');
}

// ─── Proje özeti ────────────────────────────────────────────────────

export type BolumTeslimDurumu = 'bekliyor' | 'kontrolde' | 'teslim_edildi';

export interface TeslimSatiri {
  bolum: BagimsizBolum;
  no: string;
  katAdi: string;
  cariAdi: string | null;
  sifat: string | null;
  /** Satışta taahhüt edilen teslim günü. */
  taahhut: Tarih | null;
  teslim: DaireTeslimi | null;
  durum: BolumTeslimDurumu;
  /** Teslim edilecek mi (satılmış ya da arsa sahibine tahsisli). */
  teslimEdilecek: boolean;
  acikEksik: number;
  gecikenEksik: number;
}

export interface EksikIsSatiri {
  is: EksikIs;
  bolumAdi: string | null;
  sorumluAdi: string | null;
}

export interface ProjeTeslimOzeti {
  bolumler: TeslimSatiri[];
  eksikler: EksikIsSatiri[];
  sayilar: { teslimEdilecek: number; teslimEdildi: number; kontrolde: number; acikEksik: number; gecikenEksik: number };
}

export async function projeTeslimOzeti(depo: Depo, firmaId: string, projeId: string, bugun: Tarih): Promise<ProjeTeslimOzeti> {
  const k = { firmaId, projeId };
  const [bolumler, bloklar, katlar, satislar, tahsisler, teslimler, isler, cariler] = await Promise.all([
    depo.listele('bagimsizBolum', k),
    depo.listele('blok', k),
    depo.listele('kat', k),
    depo.listele('satis', k),
    depo.listele('arsaSahibiTahsisi', { firmaId }),
    depo.listele('daireTeslimi', k),
    depo.listele('eksikIs', k),
    depo.listele('cari', { firmaId }),
  ]);
  const blokAdi = new Map(bloklar.map((b) => [b.id, b.ad]));
  const blokSirasi = new Map(bloklar.map((b) => [b.id, b.sira]));
  const kat = new Map(katlar.map((x) => [x.id, x]));
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const satis = new Map(aktif(satislar).map((s) => [s.bolumId, s]));
  const tahsis = new Map(aktif(tahsisler).map((t) => [t.bolumId, t]));
  const teslim = new Map(aktif(teslimler).map((t) => [t.bolumId, t]));
  const acikIsler = aktif(isler);

  const satirlar: TeslimSatiri[] = aktif(bolumler)
    .map((b): TeslimSatiri => {
      const s = satis.get(b.id);
      const ts = tahsis.get(b.id);
      const t = teslim.get(b.id) ?? null;
      const bIsler = acikIsler.filter((e) => e.bolumId === b.id && !e.yapildi);
      const cariId = s?.cariId ?? ts?.cariId ?? null;
      return {
        bolum: b,
        no: bolumNo(blokAdi.get(b.blokId), b.no),
        katAdi: kat.get(b.katId)?.ad ?? '',
        cariAdi: cariId ? (cariAdi.get(cariId) ?? '?') : null,
        sifat: s ? 'Alıcı' : ts ? 'Arsa sahibi' : null,
        taahhut: s?.teslimTarihi ?? null,
        teslim: t,
        durum: b.teslimDurumu === 'teslim_edildi' || t?.tamamlandi ? 'teslim_edildi' : t ? 'kontrolde' : 'bekliyor',
        teslimEdilecek: !!s || !!ts,
        acikEksik: bIsler.length,
        gecikenEksik: bIsler.filter((e) => eksikIsDurumu(e, bugun) === 'gecikti').length,
      };
    })
    .sort(
      (a, b) =>
        (blokSirasi.get(a.bolum.blokId) ?? 0) - (blokSirasi.get(b.bolum.blokId) ?? 0) ||
        (kat.get(a.bolum.katId)?.sira ?? 0) - (kat.get(b.bolum.katId)?.sira ?? 0) ||
        a.bolum.no.localeCompare(b.bolum.no, 'tr', { numeric: true }),
    );
  const bolumAdi = new Map(satirlar.map((x) => [x.bolum.id, x.no]));
  const eksikler = eksikIsleriSirala(acikIsler, bugun).map((e) => ({
    is: e,
    bolumAdi: e.bolumId ? (bolumAdi.get(e.bolumId) ?? '?') : null,
    sorumluAdi: e.sorumluCariId ? (cariAdi.get(e.sorumluCariId) ?? '?') : null,
  }));
  const acik = acikIsler.filter((e) => !e.yapildi);
  return {
    bolumler: satirlar,
    eksikler,
    sayilar: {
      teslimEdilecek: satirlar.filter((x) => x.teslimEdilecek).length,
      teslimEdildi: satirlar.filter((x) => x.durum === 'teslim_edildi').length,
      kontrolde: satirlar.filter((x) => x.durum === 'kontrolde').length,
      acikEksik: acik.length,
      gecikenEksik: acik.filter((e) => eksikIsDurumu(e, bugun) === 'gecikti').length,
    },
  };
}

/** Firmanın teslim maddesi listesini sonraki teslimler için kaydeder. */
export async function teslimMaddeleriniVarsayilanYap(servis: KayitServisi, firma: Firma, maddeler: { grup: string; ad: string }[]): Promise<Firma> {
  const liste = maddeler.map((m) => ({ grup: m.grup.trim() || 'Diğer', ad: m.ad.trim() })).filter((m) => m.ad);
  if (!liste.length) throw new IsKuraliHatasi('Liste boş olamaz.');
  return servis.guncelle('firma', firma.id, { ayarlar: { ...firma.ayarlar, teslimMaddeleri: liste } });
}
