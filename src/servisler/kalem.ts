import { butceAgaci, kalemGerceklesen, type ButceOzeti } from '../hesap/butce';
import { aramaAnahtari } from '../hesap/metin';
import type { Depo } from '../veri/depo';
import type { Kalem, Kurus, Proje } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Maliyet kalemleri ve bütçesi: ana kalem → alt kalem (iki seviye).
// Bütçe yalnızca alt kalemi olmayan kalemde girilir; ana kalem alt kalemlerini toplar.
// Gerçekleşen, gider satırlarından hesaplanır (8. adım); burada saklanmaz.

export interface KalemGirdisi {
  ad: string;
  birim: string | null;
  butceMiktari: number | null;
  butceTutari: Kurus | null;
}

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
/** Ad tekrarı denetimi: büyük/küçük ve Türkçe harfsiz yazım aynı ad sayılır ("Celik" = "Çelik"). */
const adAnahtari = aramaAnahtari;

function temizle(g: KalemGirdisi): KalemGirdisi {
  return {
    ad: g.ad.trim().replace(/\s+/g, ' '),
    birim: g.birim?.trim() || null,
    butceMiktari: g.butceMiktari,
    butceTutari: g.butceTutari,
  };
}

function girdiHatalari(g: KalemGirdisi): string[] {
  const hatalar: string[] = [];
  if (!g.ad) hatalar.push('Kalem adı boş olamaz.');
  if (g.butceTutari !== null && (!Number.isInteger(g.butceTutari) || g.butceTutari < 0)) {
    hatalar.push('Bütçe tutarı sıfır ya da daha büyük olmalı.');
  }
  if (g.butceMiktari !== null && (!Number.isFinite(g.butceMiktari) || g.butceMiktari <= 0)) {
    hatalar.push('Bütçe miktarı sıfırdan büyük olmalı.');
  }
  if (g.butceMiktari !== null && !g.birim) hatalar.push('Miktar girildiyse birimini de yazın (m³, ton, m²…).');
  return hatalar;
}

async function projeKalemleri(depo: Depo, firmaId: string, projeId: string): Promise<Kalem[]> {
  return aktif(await depo.listele('kalem', { projeId, firmaId }));
}

/** Kaleme doğrudan yazılmış, iptal edilmemiş gider satırı sayısı. */
async function giderSatiriSayisi(depo: Depo, firmaId: string, kalemId: string): Promise<number> {
  const satirlar = aktif(await depo.listele('giderSatiri', { kalemId, firmaId }));
  let sayi = 0;
  for (const s of satirlar) {
    const gider = await depo.getir('gider', s.giderId);
    if (gider && !gider.iptal) sayi++;
  }
  return sayi;
}

function ayniAdKontrol(kardesler: Kalem[], ad: string, haricId?: string) {
  const ayni = kardesler.find((k) => k.id !== haricId && adAnahtari(k.ad) === adAnahtari(ad));
  if (ayni) throw new IsKuraliHatasi(`Bu seviyede "${ayni.ad}" adlı bir kalem zaten var.`);
}

export async function kalemEkle(
  depo: Depo,
  servis: KayitServisi,
  projeId: string,
  ustKalemId: string | null,
  girdi: KalemGirdisi,
): Promise<Kalem> {
  const g = temizle(girdi);
  const hatalar = girdiHatalari(g);
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  const firmaId = servis.oturum.firmaId;

  return depo.islem(async () => {
    const proje = await depo.getir('proje', projeId);
    if (!proje || proje.firmaId !== firmaId || proje.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
    const kalemler = await projeKalemleri(depo, firmaId, projeId);

    if (ustKalemId !== null) {
      const ust = kalemler.find((k) => k.id === ustKalemId);
      if (!ust) throw new IsKuraliHatasi('Ana kalem bulunamadı.');
      if (ust.ustKalemId !== null) throw new IsKuraliHatasi('Kalemler iki seviyelidir; alt kalemin altına kalem eklenemez.');
      if (ust.butceTutari !== null) {
        throw new IsKuraliHatasi(
          `"${ust.ad}" kaleminin kendi bütçesi var. Alt kalem eklemeden önce o bütçeyi silin; ana kalemin bütçesi alt kalemlerden toplanır.`,
        );
      }
      if ((await giderSatiriSayisi(depo, firmaId, ust.id)) > 0) {
        throw new IsKuraliHatasi(`"${ust.ad}" kalemine doğrudan gider yazılmış; altına kalem eklenemez.`);
      }
    }

    const kardesler = kalemler.filter((k) => k.ustKalemId === ustKalemId);
    ayniAdKontrol(kardesler, g.ad);
    const sira = kardesler.reduce((m, k) => Math.max(m, k.sira), 0) + 1;
    return servis.ekle('kalem', { projeId, ustKalemId, ...g, sira });
  });
}

export async function kalemGuncelle(
  depo: Depo,
  servis: KayitServisi,
  kalemId: string,
  girdi: KalemGirdisi,
  gerekce?: string,
): Promise<Kalem> {
  const g = temizle(girdi);
  const hatalar = girdiHatalari(g);
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
  const firmaId = servis.oturum.firmaId;

  return depo.islem(async () => {
    const kalem = await depo.getir('kalem', kalemId);
    if (!kalem || kalem.firmaId !== firmaId || kalem.iptal) throw new IsKuraliHatasi('Kalem bulunamadı.');
    const kalemler = await projeKalemleri(depo, firmaId, kalem.projeId);
    const altVar = kalemler.some((k) => k.ustKalemId === kalem.id);
    if (altVar && (g.butceTutari !== null || g.butceMiktari !== null)) {
      throw new IsKuraliHatasi('Alt kalemi olan kalemin bütçesi alt kalemlerden toplanır; bütçeyi alt kalemlere girin.');
    }
    ayniAdKontrol(kalemler.filter((k) => k.ustKalemId === kalem.ustKalemId), g.ad, kalem.id);
    return servis.guncelle('kalem', kalemId, g, gerekce);
  });
}

/** Alt kalemi ya da gideri olan kalem iptal edilemez; maliyet kaybolmasın. */
export async function kalemIptal(depo: Depo, servis: KayitServisi, kalemId: string, gerekce?: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const kalem = await depo.getir('kalem', kalemId);
    if (!kalem || kalem.firmaId !== firmaId || kalem.iptal) throw new IsKuraliHatasi('Kalem bulunamadı.');
    const kalemler = await projeKalemleri(depo, firmaId, kalem.projeId);
    if (kalemler.some((k) => k.ustKalemId === kalem.id)) {
      throw new IsKuraliHatasi('Önce alt kalemleri kaldırın.');
    }
    if ((await giderSatiriSayisi(depo, firmaId, kalem.id)) > 0) {
      throw new IsKuraliHatasi('Bu kaleme gider yazılmış; kaldırılamaz. Giderleri başka kaleme aktarın ya da iptal edin.');
    }
    await servis.iptal('kalem', kalemId, gerekce);
  });
}

/** Sıradaki komşusuyla yer değiştirir (yön −1: yukarı, +1: aşağı). Sıralama gerekçe istemez. */
export async function kalemTasi(depo: Depo, servis: KayitServisi, kalemId: string, yon: -1 | 1): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const kalem = await depo.getir('kalem', kalemId);
    if (!kalem || kalem.firmaId !== firmaId || kalem.iptal) throw new IsKuraliHatasi('Kalem bulunamadı.');
    const kardesler = (await projeKalemleri(depo, firmaId, kalem.projeId))
      .filter((k) => k.ustKalemId === kalem.ustKalemId)
      .sort((a, b) => a.sira - b.sira);
    const i = kardesler.findIndex((k) => k.id === kalemId);
    const komsu = kardesler[i + yon];
    if (!komsu) return;
    const not = 'Sıralama değiştirildi';
    await servis.guncelle('kalem', kalem.id, { sira: komsu.sira }, not);
    await servis.guncelle('kalem', komsu.id, { sira: kalem.sira }, not);
  });
}

// ─── Hazır kalemler ────────────────────────────────────────────────

/**
 * Bütçesiz şablon; kullanıcı kendi yöresine göre düzenler.
 * Arsa kalemi yalnızca satın almada, arsa sahibi giderleri yalnızca kat karşılığında gelir.
 */
export const HAZIR_KALEMLER: { ad: string; altlar: string[]; yalnizca?: Proje['arsaTipi'] }[] = [
  { ad: 'Arsa', altlar: ['Arsa bedeli', 'Tapu harcı ve masrafları', 'Emlak komisyonu'], yalnizca: 'satin_alma' },
  {
    ad: 'Arsa ve kat karşılığı giderleri',
    altlar: ['Arsa sahibine nakit ödeme', 'Kira yardımı', 'Taşınma desteği', 'Noter ve vekâlet masrafları', 'Yıkım ve tahliye'],
    yalnizca: 'kat_karsiligi',
  },
  {
    ad: 'Proje giderleri',
    altlar: ['Mimari proje', 'Statik proje', 'Elektrik ve mekanik tesisat projeleri', 'Zemin etüdü', 'Harita ve aplikasyon'],
  },
  {
    ad: 'Ruhsat, harç ve yapı denetim',
    altlar: ['Yapı ruhsatı harçları', 'Belediye harç ve katılım payları', 'Yapı denetim ücreti'],
  },
  { ad: 'Hafriyat ve temel', altlar: ['Hafriyat', 'Temel yalıtımı'] },
  { ad: 'Kaba inşaat', altlar: ['Beton', 'Demir', 'Kalıp işçiliği', 'Duvar'] },
  { ad: 'Çatı', altlar: ['Çatı işçiliği ve malzemesi'] },
  { ad: 'İnce inşaat', altlar: ['Sıva', 'Alçı', 'Boya', 'Seramik ve fayans', 'Mermer', 'Şap', 'Kapı', 'Doğrama (PVC/alüminyum)'] },
  { ad: 'Tesisat', altlar: ['Elektrik', 'Sıhhi tesisat', 'Isıtma ve doğalgaz'] },
  { ad: 'Asansör', altlar: [] },
  { ad: 'Dış cephe', altlar: ['Mantolama', 'İskele'] },
  { ad: 'Çevre düzenlemesi', altlar: [] },
  {
    ad: 'İskan ve abonelikler',
    altlar: ['İskan harç ve masrafları', 'Elektrik aboneliği', 'Su ve kanalizasyon aboneliği', 'Doğalgaz aboneliği'],
  },
  { ad: 'Genel giderler', altlar: ['Şantiye giderleri', 'SGK primleri', 'İş güvenliği ve sigorta'] },
];

/** Projede hiç kalem yokken hazır listeyi ekler. */
export async function hazirKalemleriEkle(depo: Depo, servis: KayitServisi, projeId: string): Promise<number> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const proje = await depo.getir('proje', projeId);
    if (!proje || proje.firmaId !== firmaId || proje.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
    if ((await projeKalemleri(depo, firmaId, projeId)).length > 0) {
      throw new IsKuraliHatasi('Projede zaten kalem var; hazır liste yalnızca boş projeye eklenir.');
    }
    let sayi = 0;
    const bos = { birim: null, butceMiktari: null, butceTutari: null };
    for (const [i, ana] of HAZIR_KALEMLER.filter((k) => !k.yalnizca || k.yalnizca === proje.arsaTipi).entries()) {
      const k = await servis.ekle('kalem', { projeId, ustKalemId: null, ad: ana.ad, ...bos, sira: i + 1 });
      sayi++;
      for (const [j, alt] of ana.altlar.entries()) {
        await servis.ekle('kalem', { projeId, ustKalemId: k.id, ad: alt, ...bos, sira: j + 1 });
        sayi++;
      }
    }
    return sayi;
  });
}

// ─── Bütçe ve gerçekleşen ──────────────────────────────────────────

/** kdvDahil: firma ayarı (raporda maliyet KDV dahil mi). */
export async function projeButcesiGetir(depo: Depo, firmaId: string, projeId: string, kdvDahil: boolean): Promise<ButceOzeti> {
  const [kalemler, giderler] = await Promise.all([
    depo.listele('kalem', { projeId, firmaId }),
    depo.listele('gider', { projeId, firmaId }),
  ]);
  const satirlar = (await Promise.all(giderler.map((g) => depo.listele('giderSatiri', { giderId: g.id, firmaId })))).flat();
  return butceAgaci(kalemler, kalemGerceklesen(satirlar, giderler, kdvDahil));
}

/**
 * Projede gider satırlarına en son yazılan kalemler (yeniden eskiye, tekrarsız).
 * Gider formunda kalem listesinin başında önerilir. İptal edilmiş gider ve kalem sayılmaz.
 */
export async function sonKullanilanKalemler(depo: Depo, firmaId: string, projeId: string, sinir = 5): Promise<string[]> {
  const [giderler, kalemler] = await Promise.all([
    depo.listele('gider', { projeId, firmaId }),
    depo.listele('kalem', { projeId, firmaId }),
  ]);
  const aktifKalem = new Set(aktif(kalemler).map((k) => k.id));
  const satirlar = (await Promise.all(aktif(giderler).map((g) => depo.listele('giderSatiri', { giderId: g.id, firmaId })))).flat();
  const sonuc: string[] = [];
  for (const s of aktif(satirlar).sort((a, b) => b.olusturmaZamani.localeCompare(a.olusturmaZamani))) {
    if (s.kalemId && aktifKalem.has(s.kalemId) && !sonuc.includes(s.kalemId)) sonuc.push(s.kalemId);
    if (sonuc.length >= sinir) break;
  }
  return sonuc;
}
