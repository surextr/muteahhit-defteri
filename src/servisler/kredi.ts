import { krediHatalari, krediOzeti, type KrediIcerigi, type KrediOzeti } from '../hesap/kredi';
import type { Depo } from '../veri/depo';
import type { Hesap, Kredi, Kurus, Tarih } from '../veri/tipler';
import { giderIptal, giderOlustur, hesapYontemi } from './gider';
import { sistemKalemiHazirla } from './kalem';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Banka kredisi (şema 23). Kullanım: tahsilat (amac 'krediKullanim') hesaba girer; banka carisi seçildiyse onun ekstresinde
// borç olarak görünür. Taksit ödemesi: anapara ödemesi (amac 'krediAnapara') + faiz gideri (carisiz, peşin, "Kredi faizi
// ve banka masrafları" kalemi). Ödenmiş taksit planı değiştirilemez; geri almak ödemeyi ve gideri iptal eder.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

async function hesapDenetle(depo: Depo, firmaId: string, hesapId: string): Promise<Hesap> {
  const h = await depo.getir('hesap', hesapId);
  if (!h || h.firmaId !== firmaId || h.iptal) throw new IsKuraliHatasi('Hesabı seçin.');
  if (h.tur === 'kredi_karti') throw new IsKuraliHatasi('Kredi kasa ya da banka hesabına girer, oradan ödenir.');
  if (h.paraBirimi !== 'TRY') throw new IsKuraliHatasi('Dövizli kredi henüz desteklenmiyor; TL hesabı seçin.');
  return h;
}

async function icerikDenetle(depo: Depo, firmaId: string, g: KrediIcerigi): Promise<KrediIcerigi> {
  const k: KrediIcerigi = { ...g, ad: g.ad.trim(), aciklama: g.aciklama.trim() };
  const h = krediHatalari(k);
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  await hesapDenetle(depo, firmaId, k.hesapId);
  if (k.bankaCariId) {
    const c = await depo.getir('cari', k.bankaCariId);
    if (!c || c.firmaId !== firmaId || c.iptal) throw new IsKuraliHatasi('Banka carisi bulunamadı.');
  }
  if (k.projeId) {
    const p = await depo.getir('proje', k.projeId);
    if (!p || p.firmaId !== firmaId || p.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
  }
  return k;
}

export async function krediGetir(depo: Depo, firmaId: string, id: string): Promise<Kredi | null> {
  const k = await depo.getir('kredi', id);
  return k && k.firmaId === firmaId && !k.iptal ? k : null;
}

/** Firmanın kredileri durumlarıyla (kalan borç, sonraki taksit). */
export async function krediOzetleri(depo: Depo, firmaId: string, bugun: Tarih): Promise<KrediOzeti[]> {
  const [krediler, odemeler, giderler] = await Promise.all([depo.listele('kredi', { firmaId }), depo.listele('odeme', { firmaId }), depo.listele('gider', { firmaId })]);
  const ilgiliOdeme = odemeler.filter((o) => o.krediId);
  const ilgiliGider = giderler.filter((g) => g.krediId);
  return aktif(krediler)
    .map((k) => krediOzeti(k, ilgiliOdeme, ilgiliGider, bugun))
    .sort((a, b) => (a.sonraki?.taksit.vadeTarihi ?? '9999').localeCompare(b.sonraki?.taksit.vadeTarihi ?? '9999'));
}

export async function krediOzetiGetir(depo: Depo, firmaId: string, id: string, bugun: Tarih): Promise<KrediOzeti | null> {
  return (await krediOzetleri(depo, firmaId, bugun)).find((o) => o.kredi.id === id) ?? null;
}

/** Krediyi ve kullanım tahsilatını (para hesaba girer) birlikte kaydeder. */
export async function krediOlustur(depo: Depo, servis: KayitServisi, g: KrediIcerigi): Promise<Kredi> {
  const firmaId = servis.oturum.firmaId;
  const k = await icerikDenetle(depo, firmaId, g);
  return depo.islem(async () => {
    const hesap = await hesapDenetle(depo, firmaId, k.hesapId);
    const kredi = await servis.ekle('kredi', k);
    await servis.ekle('odeme', {
      tarih: k.kullanimTarihi,
      yon: 'tahsilat',
      amac: 'krediKullanim',
      yontem: hesapYontemi(hesap),
      cariId: k.bankaCariId,
      hesapId: hesap.id,
      cekSenetId: null,
      projeId: k.projeId,
      tutar: k.anapara,
      doviz: null,
      aciklama: `${k.ad} · kredi kullanımı`,
      krediId: kredi.id,
      krediTaksitId: null,
    });
    return kredi;
  });
}

/**
 * Bilgileri ve planı bütün olarak değiştirir. Ödemesi olan taksit çıkarılamaz, ödenenin altına indirilemez; kullanım
 * tahsilatı yeni tutar/tarih/hesapla güncellenir.
 */
export async function krediKaydet(depo: Depo, servis: KayitServisi, id: string, g: KrediIcerigi, gerekce?: string): Promise<Kredi> {
  const firmaId = servis.oturum.firmaId;
  const k = await icerikDenetle(depo, firmaId, g);
  return depo.islem(async () => {
    const eski = await krediGetir(depo, firmaId, id);
    if (!eski) throw new IsKuraliHatasi('Kredi bulunamadı.');
    const ozet = await krediOzetiGetir(depo, firmaId, id, '0000-01-01');
    const yeniler = new Map(k.taksitler.map((t) => [t.id, t]));
    for (const d of ozet?.taksitler ?? []) {
      if (d.odenenAnapara + d.odenenFaiz === 0) continue;
      const y = yeniler.get(d.taksit.id);
      if (!y) throw new IsKuraliHatasi(`${d.taksit.vadeTarihi} vadeli taksit ödenmiş; plandan çıkarılamaz (önce ödemeyi geri alın).`);
      if (y.anapara < d.odenenAnapara || y.faiz < d.odenenFaiz) throw new IsKuraliHatasi(`${d.taksit.vadeTarihi} vadeli taksit ödenen tutarın altına indirilemez.`);
    }
    if (k.bankaCariId !== eski.bankaCariId && ozet && ozet.odenenAnapara > 0)
      throw new IsKuraliHatasi('Taksit ödenmiş kredinin bankası değiştirilemez.');
    const guncel = await servis.guncelle('kredi', id, k, gerekce);
    const hesap = await hesapDenetle(depo, firmaId, k.hesapId);
    for (const o of aktif(await depo.listele('odeme', { firmaId, krediId: id }))) {
      if (o.amac !== 'krediKullanim') continue;
      await servis.guncelle(
        'odeme',
        o.id,
        { tarih: k.kullanimTarihi, tutar: k.anapara, hesapId: hesap.id, yontem: hesapYontemi(hesap), cariId: k.bankaCariId, projeId: k.projeId, aciklama: `${k.ad} · kredi kullanımı` },
        gerekce,
      );
    }
    return guncel;
  });
}

/** Taksiti öder: kalan anapara bankaya ödeme, kalan faiz gider (peşin) olarak; ikisi aynı hesaptan, aynı gün. */
export async function krediTaksitiOde(depo: Depo, servis: KayitServisi, krediId: string, taksitId: string, g: { tarih: Tarih; hesapId: string }): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  if (!TARIH.test(g.tarih)) throw new IsKuraliHatasi('Ödeme tarihini seçin.');
  await depo.islem(async () => {
    const ozet = await krediOzetiGetir(depo, firmaId, krediId, g.tarih);
    if (!ozet) throw new IsKuraliHatasi('Kredi bulunamadı.');
    const d = ozet.taksitler.find((x) => x.taksit.id === taksitId);
    if (!d) throw new IsKuraliHatasi('Taksit bulunamadı.');
    if (d.kalanAnapara + d.kalanFaiz === 0) throw new IsKuraliHatasi('Bu taksit zaten ödenmiş.');
    const k = ozet.kredi;
    const hesap = await hesapDenetle(depo, firmaId, g.hesapId);
    const aciklama = `${k.ad} · ${d.taksit.vadeTarihi} vadeli taksit`;
    if (d.kalanAnapara > 0)
      await servis.ekle('odeme', {
        tarih: g.tarih,
        yon: 'odeme',
        amac: 'krediAnapara',
        yontem: hesapYontemi(hesap),
        cariId: k.bankaCariId,
        hesapId: hesap.id,
        cekSenetId: null,
        projeId: k.projeId,
        tutar: d.kalanAnapara,
        doviz: null,
        aciklama: `${aciklama} (anapara)`,
        krediId: k.id,
        krediTaksitId: d.taksit.id,
      });
    if (d.kalanFaiz > 0) {
      const kalem = k.projeId ? await sistemKalemiHazirla(depo, servis, k.projeId, 'kredi_faizi') : null;
      await giderOlustur(
        depo,
        servis,
        {
          tarih: g.tarih,
          projeId: k.projeId,
          cariId: null,
          faturaNo: null,
          vadeTarihi: null,
          aciklama: `${aciklama} (faiz ve masraflar)`,
          satirlar: [{ kalemId: kalem?.id ?? null, aciklama: 'Kredi faizi ve banka masrafları', miktar: null, birim: null, tutar: d.kalanFaiz, kdvDahil: false, kdvOrani: 0, tevkifat: null }],
        },
        { hesapId: hesap.id, tutar: d.kalanFaiz },
        { kredi: { krediId: k.id, krediTaksitId: d.taksit.id } },
      );
    }
  });
}

/** Taksit ödemesini geri alır: taksite bağlı anapara ödemeleri ve faiz giderleri (ödemeleriyle) iptal olur. */
export async function krediTaksitOdemesiniGeriAl(depo: Depo, servis: KayitServisi, krediId: string, taksitId: string, gerekce: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const odemeler = aktif(await depo.listele('odeme', { firmaId, krediId })).filter((o) => o.krediTaksitId === taksitId);
    const giderler = aktif(await depo.listele('gider', { firmaId, krediId })).filter((x) => x.krediTaksitId === taksitId);
    if (!odemeler.length && !giderler.length) throw new IsKuraliHatasi('Bu taksitin ödemesi yok.');
    for (const o of odemeler) await servis.iptal('odeme', o.id, gerekce);
    // Carisiz peşin faiz giderinin ödemesi gider iptaliyle birlikte iptal olur.
    for (const x of giderler) await giderIptal(depo, servis, x.id, gerekce, true);
  });
}

/** Taksit ödemesi olan kredi iptal edilmez; iptal kullanım tahsilatına yayılır. */
export async function krediIptal(depo: Depo, servis: KayitServisi, id: string, gerekce: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const ozet = await krediOzetiGetir(depo, firmaId, id, '0000-01-01');
    if (!ozet) throw new IsKuraliHatasi('Kredi bulunamadı.');
    if (ozet.odenenAnapara + ozet.odenenFaiz > 0) throw new IsKuraliHatasi('Taksit ödenmiş kredi iptal edilemez; önce taksit ödemelerini geri alın.');
    await servis.iptal('kredi', id, gerekce);
  });
}

/** Vadesi `gun` gün içinde olan ya da geçmiş ödenmemiş taksitler (Bugün ekranı, nakit akışı). */
export interface KrediVadesi {
  krediId: string;
  krediAdi: string;
  projeId: string | null;
  taksitId: string;
  vadeTarihi: Tarih;
  kalan: Kurus;
}

export function krediVadeleri(ozetler: KrediOzeti[]): KrediVadesi[] {
  return ozetler.flatMap((o) =>
    o.taksitler
      .filter((d) => d.durum !== 'odendi')
      .map((d) => ({ krediId: o.kredi.id, krediAdi: o.kredi.ad, projeId: o.kredi.projeId, taksitId: d.taksit.id, vadeTarihi: d.taksit.vadeTarihi, kalan: d.kalanAnapara + d.kalanFaiz })),
  );
}
