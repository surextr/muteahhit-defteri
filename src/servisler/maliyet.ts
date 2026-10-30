import { BOS_GIRDILER, girdiHatalari, maliyetOzeti, satirFiyati, satirHatalari, satirlariGuncelle } from '../hesap/maliyet';
import type { Depo } from '../veri/depo';
import { yeniId } from '../veri/kimlik';
import { MALIYET_FORMULLERI, type MaliyetFormulu } from '../veri/sabit/maliyetFormulleri';
import type { BagimsizBolum, BinaGirdileri, Blok, FiyatKalemi, Firma, Kurus, MaliyetHesabi, MaliyetSatiri, Kat } from '../veri/tipler';
import { firmaAyariDegistir } from './firma';
import { fiyatKalemleri, hazirFiyatKalemleriniEkle } from './fiyat';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Maliyet hesabı (şema 22): projeli ya da projesiz; formül + elle (+ projeden, sonraki adım) satırlar, listeden fiyat,
// onayla başlangıç maliyeti olarak dondurma, revizyon.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);

export async function maliyetHesaplari(depo: Depo, firmaId: string, projeId?: string | null): Promise<MaliyetHesabi[]> {
  const l = aktif(await depo.listele('maliyetHesabi', { firmaId }));
  return (projeId === undefined ? l : l.filter((h) => h.projeId === projeId)).sort((a, b) => b.olusturmaZamani.localeCompare(a.olusturmaZamani));
}

export async function maliyetHesabiGetir(depo: Depo, firmaId: string, id: string): Promise<MaliyetHesabi | null> {
  const h = await depo.getir('maliyetHesabi', id);
  return h && h.firmaId === firmaId && !h.iptal ? h : null;
}

/** Katalog kimliğe göre (iptal edilmişler hariç). */
export async function katalogHaritasi(depo: Depo, firmaId: string): Promise<Map<string, FiyatKalemi>> {
  return new Map((await fiyatKalemleri(depo, firmaId)).map((k) => [k.id, k]));
}

export function formulSatiri(f: MaliyetFormulu, kalem: FiyatKalemi, katsayi: number | null = null): MaliyetSatiri {
  return {
    id: yeniId(),
    fiyatKalemiId: kalem.id,
    tur: kalem.tur,
    ad: f.ad ?? kalem.ad,
    birim: kalem.birim,
    butceKalemiKodu: kalem.butceKalemiKodu,
    miktarKaynagi: 'formul',
    formulKodu: f.kod,
    katsayi: katsayi !== null && katsayi !== f.katsayi ? katsayi : null,
    miktar: null,
    dayanak: '',
    ozelFiyat: null,
    dondurulan: null,
  };
}

/** Listeden ya da serbest (kalemsiz) elle satır. */
export function elleSatir(g: { kalem: FiyatKalemi | null; tur: MaliyetSatiri['tur']; ad: string; birim: string; butceKalemiKodu: string | null; miktar: number | null; dayanak: string }): MaliyetSatiri {
  return {
    id: yeniId(),
    fiyatKalemiId: g.kalem?.id ?? null,
    tur: g.kalem?.tur ?? g.tur,
    ad: g.ad.trim() || g.kalem?.ad || '',
    birim: g.kalem?.birim ?? g.birim.trim(),
    butceKalemiKodu: g.kalem ? g.kalem.butceKalemiKodu : g.butceKalemiKodu,
    miktarKaynagi: 'elle',
    formulKodu: null,
    katsayi: null,
    miktar: g.miktar,
    dayanak: g.dayanak.trim(),
    ozelFiyat: null,
    dondurulan: null,
  };
}

export interface ProjeGirdileri {
  girdiler: Partial<BinaGirdileri>;
  /** Projeden gelen alanların açıklaması ("Bina: 2 blok, en çok 8 kat"). */
  notlar: string[];
}

/** Projeden doldurulabilen girdiler: inşaat alanı, kat sayıları (blokların en yükseği), bağımsız bölüm sayısı. */
export async function projedenGirdiler(depo: Depo, firmaId: string, projeId: string): Promise<ProjeGirdileri> {
  const k = { firmaId, projeId };
  const [proje, katlar, bolumler] = await Promise.all([depo.getir('proje', projeId), depo.listele('kat', k), depo.listele('bagimsizBolum', k)]);
  if (!proje || proje.firmaId !== firmaId) throw new IsKuraliHatasi('Proje bulunamadı.');
  const g: Partial<BinaGirdileri> = {};
  const notlar: string[] = [];
  const alan = proje.alanlar.toplamInsaat ?? proje.alanlar.brut;
  if (alan) {
    g.insaatAlani = alan;
    notlar.push(proje.alanlar.toplamInsaat ? 'İnşaat alanı proje bilgilerinden' : 'İnşaat alanı yerine brüt alan');
  }
  const bloklar = new Map<string, { normal: number; bodrum: number }>();
  for (const kt of aktif(katlar)) {
    const b = bloklar.get(kt.blokId) ?? { normal: 0, bodrum: 0 };
    if (kt.tip === 'bodrum') b.bodrum++;
    else b.normal++;
    bloklar.set(kt.blokId, b);
  }
  if (bloklar.size) {
    g.normalKatSayisi = Math.max(...[...bloklar.values()].map((b) => b.normal));
    g.bodrumKatSayisi = Math.max(...[...bloklar.values()].map((b) => b.bodrum));
    notlar.push(`Kat sayıları bina krokisinden${bloklar.size > 1 ? ` (${bloklar.size} bloğun en yükseği)` : ''}`);
  }
  const bolum = aktif(bolumler).length;
  if (bolum) {
    g.daireSayisi = bolum;
    notlar.push('Bağımsız bölüm sayısı krokiden');
  }
  return { girdiler: g, notlar };
}

export interface ProjeBinasi {
  bloklar: Blok[];
  katlar: Kat[];
  bolumler: BagimsizBolum[];
}

/** Ek istek krokisi için projenin blok, kat ve bölümleri (iptal edilmemiş, sıralı). */
export async function projeBinasi(depo: Depo, firmaId: string, projeId: string): Promise<ProjeBinasi> {
  const k = { firmaId, projeId };
  const [bloklar, katlar, bolumler] = await Promise.all([depo.listele('blok', k), depo.listele('kat', k), depo.listele('bagimsizBolum', k)]);
  return {
    bloklar: aktif(bloklar).sort((a, b) => a.sira - b.sira),
    katlar: aktif(katlar).sort((a, b) => b.sira - a.sira),
    bolumler: aktif(bolumler).sort((a, b) => a.hat - b.hat || a.no.localeCompare(b.no, 'tr', { numeric: true })),
  };
}

export interface BolumEkIstegi {
  maliyetSatiriId: string;
  ad: string;
  birim: string;
  birimMiktar: number;
  not: string;
  /** Bu bölüm için maliyet (KDV hariç); fiyat yoksa null. */
  maliyet: Kurus | null;
  kdvOrani: number;
  hesapId: string;
  hesapAdi: string;
}

/** Projenin en son maliyet hesabında bu bölüme girilmiş ek istekler (satışa eklemek için). */
export async function bolumEkIstekleri(depo: Depo, firmaId: string, projeId: string, bolumId: string): Promise<BolumEkIstegi[]> {
  const h = (await maliyetHesaplari(depo, firmaId, projeId))[0];
  if (!h) return [];
  const katalog = await katalogHaritasi(depo, firmaId);
  return h.satirlar
    .filter((x) => x.ekIstek?.bolumIdleri.includes(bolumId))
    .map((x) => {
      const f = satirFiyati(x, x.fiyatKalemiId ? katalog.get(x.fiyatKalemiId) : undefined);
      return {
        maliyetSatiriId: x.id,
        ad: x.ekIstek!.not ? `${x.ad} (${x.ekIstek!.not})` : x.ad,
        birim: x.birim,
        birimMiktar: x.ekIstek!.birimMiktar,
        not: x.ekIstek!.not,
        maliyet: f.fiyat === null ? null : Math.round(x.ekIstek!.birimMiktar * f.fiyat),
        kdvOrani: f.kdvOrani,
        hesapId: h.id,
        hesapAdi: `${h.ad} · Rev. ${h.revizyon}`,
      };
    });
}

export interface MaliyetHesabiGirdisi {
  ad: string;
  projeId: string | null;
  girdiler: BinaGirdileri;
  aciklama: string;
}

/** Yeni hesap: bütün hazır formüller satır olarak gelir (listede kalemi olmayan formül atlanır). */
export async function maliyetHesabiOlustur(depo: Depo, servis: KayitServisi, g: MaliyetHesabiGirdisi): Promise<MaliyetHesabi> {
  const firmaId = servis.oturum.firmaId;
  const ad = g.ad.trim();
  if (!ad) throw new IsKuraliHatasi('Hesaba bir ad verin (örn. "Güneş Apt. ön maliyet").');
  if (g.projeId) {
    const p = await depo.getir('proje', g.projeId);
    if (!p || p.firmaId !== firmaId || p.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
  }
  const girdiler = { ...BOS_GIRDILER, ...g.girdiler };
  const hata = girdiHatalari(girdiler);
  if (hata.length) throw new IsKuraliHatasi(hata.join(' '));
  await hazirFiyatKalemleriniEkle(depo, servis).catch(() => 0);
  const kod = new Map((await fiyatKalemleri(depo, firmaId)).filter((k) => k.sistemKodu).map((k) => [k.sistemKodu!, k]));
  const firmaKatsayilari = (await depo.getir('firma', firmaId))?.ayarlar.maliyetKatsayilari ?? {};
  const satirlar = MALIYET_FORMULLERI.flatMap((f) => {
    const k = kod.get(f.fiyatKalemiKodu);
    return k ? [formulSatiri(f, k, firmaKatsayilari[f.kod] ?? null)] : [];
  });
  return depo.islem(async () =>
    servis.ekle('maliyetHesabi', {
      ad,
      projeId: g.projeId,
      revizyon: 1,
      oncekiHesapId: null,
      girdiler,
      satirlar: satirlariGuncelle(girdiler, satirlar),
      aciklama: g.aciklama.trim(),
    }),
  );
}

export interface MaliyetHesabiDegisikligi {
  ad: string;
  aciklama: string;
  girdiler: BinaGirdileri;
  satirlar: MaliyetSatiri[];
}

/** Ad, girdiler ve satırlar bütün olarak; formül satırları yeniden hesaplanır. Onaylı hesap değişmez (revizyon açılır). */
export async function maliyetHesabiKaydet(depo: Depo, servis: KayitServisi, id: string, d: MaliyetHesabiDegisikligi): Promise<MaliyetHesabi> {
  const h = await maliyetHesabiGetir(depo, servis.oturum.firmaId, id);
  if (!h) throw new IsKuraliHatasi('Maliyet hesabı bulunamadı.');
  if (h.onay) throw new IsKuraliHatasi('Onaylanmış hesap değiştirilemez; değişiklik için revizyon açın.');
  const ad = d.ad.trim();
  const hatalar = [...(ad ? [] : ['Hesaba bir ad verin.']), ...girdiHatalari(d.girdiler), ...satirHatalari(d.satirlar)];
  if (new Set(d.satirlar.map((s) => s.id)).size !== d.satirlar.length) hatalar.push('Satır kimlikleri tekrarlanıyor.');
  if (d.satirlar.some((s) => s.ekIstek)) {
    if (!h.projeId) hatalar.push('Daire bazında ek istek yalnız projeli hesapta girilir.');
    else {
      const bolumler = new Set(aktif(await depo.listele('bagimsizBolum', { firmaId: h.firmaId, projeId: h.projeId })).map((b) => b.id));
      if (d.satirlar.some((s) => s.ekIstek?.bolumIdleri.some((b) => !bolumler.has(b)))) hatalar.push('Ek istekte projede olmayan bölüm var.');
    }
  }
  if (hatalar.length) throw new IsKuraliHatasi(hatalar.join(' '));
  const satirlar = satirlariGuncelle(
    d.girdiler,
    d.satirlar.map((s) => ({ ...s, ad: s.ad.trim(), birim: s.birim.trim(), dayanak: s.dayanak.trim(), dondurulan: null })),
  );
  return depo.islem(async () => servis.guncelle('maliyetHesabi', id, { ad, aciklama: d.aciklama.trim(), girdiler: d.girdiler, satirlar }));
}

/**
 * Onay = başlangıç maliyeti: miktarı eksik ya da fiyatsız satır varsa olmaz; o günkü fiyatlar (liste ya da hesaba özel)
 * satırlara dondurulur. Liste sonra değişse de hesap değişmez.
 */
export async function maliyetHesabiOnayla(depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  const h = await maliyetHesabiGetir(depo, firmaId, id);
  if (!h) throw new IsKuraliHatasi('Maliyet hesabı bulunamadı.');
  const katalog = await katalogHaritasi(depo, firmaId);
  const o = maliyetOzeti(h, katalog);
  const adlar = (l: typeof o.fiyatsiz) => l.slice(0, 5).map((x) => x.satir.ad).join(', ') + (l.length > 5 ? ` ve ${l.length - 5} satır daha` : '');
  const hatalar: string[] = [];
  if (o.miktarsiz.length) hatalar.push(`Miktarı çıkmayan satırlar var (${adlar(o.miktarsiz)}): girdileri tamamlayın ya da satırı çıkarın.`);
  if (o.fiyatsiz.length) hatalar.push(`Fiyatı olmayan satırlar var (${adlar(o.fiyatsiz)}): fiyat listesine ya da satıra fiyat girin.`);
  if (hatalar.length) throw new IsKuraliHatasi(hatalar.join(' '));
  const satirlar = h.satirlar.map((s) => ({ ...s, dondurulan: satirFiyati(s, s.fiyatKalemiId ? katalog.get(s.fiyatKalemiId) : undefined) }));
  await depo.islem(async () => {
    await servis.guncelle('maliyetHesabi', id, { satirlar });
    await servis.onayla('maliyetHesabi', id);
  });
}

/** Onaylı hesabın kopyası (revizyon +1): fiyatlar yeniden listeden okunur, hesaba özel fiyatlar kalır. Eskisi değişmez. */
export async function revizyonAc(depo: Depo, servis: KayitServisi, id: string): Promise<MaliyetHesabi> {
  const firmaId = servis.oturum.firmaId;
  const h = await maliyetHesabiGetir(depo, firmaId, id);
  if (!h) throw new IsKuraliHatasi('Maliyet hesabı bulunamadı.');
  if (!h.onay) throw new IsKuraliHatasi('Revizyon yalnız onaylanmış hesaptan açılır; bu hesap zaten değiştirilebilir.');
  const acik = aktif(await depo.listele('maliyetHesabi', { firmaId })).find((x) => x.oncekiHesapId === id);
  if (acik) throw new IsKuraliHatasi(`Bu hesabın revizyonu zaten açılmış (Rev. ${acik.revizyon}).`);
  return depo.islem(async () =>
    servis.ekle('maliyetHesabi', {
      ad: h.ad,
      projeId: h.projeId,
      revizyon: h.revizyon + 1,
      oncekiHesapId: h.id,
      girdiler: { ...h.girdiler },
      satirlar: h.satirlar.map((s) => ({ ...s, dondurulan: null })),
      aciklama: h.aciklama,
    }),
  );
}

export async function maliyetHesabiIptal(depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  await depo.islem(async () => {
    await servis.iptal('maliyetHesabi', id);
  });
}

/** Formül katsayısını firmanın varsayılanı yapar (null: hazır değere döner); yalnız bundan sonra açılan hesaplara uygulanır. */
export async function katsayiVarsayilanYap(servis: KayitServisi, firma: Firma, kod: string, deger: number | null): Promise<Firma> {
  const f = MALIYET_FORMULLERI.find((x) => x.kod === kod);
  if (!f) throw new IsKuraliHatasi('Formül bulunamadı.');
  if (deger !== null && (!Number.isFinite(deger) || deger < 0)) throw new IsKuraliHatasi('Katsayı geçersiz.');
  const katsayilar = { ...(firma.ayarlar.maliyetKatsayilari ?? {}) };
  if (deger === null || deger === f.katsayi) delete katsayilar[kod];
  else katsayilar[kod] = deger;
  return firmaAyariDegistir(servis, firma, { maliyetKatsayilari: katsayilar });
}

/** Metraj tablosundan (ya da başka projeden okumadan) gelen değişiklikleri hesaba yazar: var olan satırların miktarı, yeni satırlar. */
export async function hesabaProjedenYaz(
  depo: Depo,
  servis: KayitServisi,
  id: string,
  d: { guncellenecek: Map<string, { miktar: number; dayanak: string; ozelFiyat?: Kurus | null }>; eklenecek: Omit<MaliyetSatiri, 'id'>[]; girdiler?: Partial<BinaGirdileri> },
): Promise<MaliyetHesabi> {
  const h = await maliyetHesabiGetir(depo, servis.oturum.firmaId, id);
  if (!h) throw new IsKuraliHatasi('Maliyet hesabı bulunamadı.');
  const satirlar = [
    ...h.satirlar.map((s) => {
      const g = d.guncellenecek.get(s.id);
      return g ? { ...s, miktarKaynagi: 'proje' as const, miktar: g.miktar, dayanak: g.dayanak, ...(g.ozelFiyat !== undefined ? { ozelFiyat: g.ozelFiyat } : {}) } : s;
    }),
    ...d.eklenecek.map((s) => ({ ...s, id: yeniId() })),
  ];
  return maliyetHesabiKaydet(depo, servis, id, { ad: h.ad, aciklama: h.aciklama, girdiler: { ...h.girdiler, ...d.girdiler }, satirlar });
}
