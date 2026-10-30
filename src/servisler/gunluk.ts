import { gunlukHatalari, puantajOzeti, PUANTAJ_DURUMU, puantajTutari, type GunlukIcerigi, type PuantajKisiOzeti } from '../hesap/gunluk';
import type { Depo } from '../veri/depo';
import type { Gider, SantiyeGunlugu, Tarih } from '../veri/tipler';
import { giderOlustur } from './gider';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Şantiye günlüğü (şema 23): proje başına günde bir kayıt; puantaj yevmiyeleri seçilen dönem için işçinin carisine
// gider (borç) olarak yazılır, yazılan satır gidere bağlanır. Gider iptal edilirse satırlar yeniden yazılabilir.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export async function projeGunlukleri(depo: Depo, firmaId: string, projeId: string): Promise<SantiyeGunlugu[]> {
  return aktif(await depo.listele('santiyeGunlugu', { firmaId, projeId })).sort((a, b) => b.tarih.localeCompare(a.tarih));
}

export async function gunlukGetir(depo: Depo, firmaId: string, projeId: string, tarih: Tarih): Promise<SantiyeGunlugu | null> {
  return (await projeGunlukleri(depo, firmaId, projeId)).find((g) => g.tarih === tarih) ?? null;
}

/** Bu tarihten önceki son günlük ("dünkü ekipler ve işçiler"). */
export async function oncekiGunluk(depo: Depo, firmaId: string, projeId: string, tarih: Tarih): Promise<SantiyeGunlugu | null> {
  return (await projeGunlukleri(depo, firmaId, projeId)).find((g) => g.tarih < tarih) ?? null;
}

async function aktifGiderler(depo: Depo, firmaId: string): Promise<Set<string>> {
  return new Set(aktif(await depo.listele('gider', { firmaId })).map((g) => g.id));
}

/**
 * Günü kaydeder (yoksa açar). Gidere yazılmış puantaj satırı çıkarılamaz, tutarı/kişisi değiştirilemez; yazılma bağı
 * korunur.
 */
export async function gunlukKaydet(depo: Depo, servis: KayitServisi, projeId: string, tarih: Tarih, g: GunlukIcerigi): Promise<SantiyeGunlugu> {
  const firmaId = servis.oturum.firmaId;
  if (!TARIH.test(tarih)) throw new IsKuraliHatasi('Tarihi seçin.');
  const icerik: GunlukIcerigi = {
    ...g,
    yapilanIsler: g.yapilanIsler.trim(),
    sorunlar: g.sorunlar.trim(),
    not: g.not.trim(),
    ekipler: g.ekipler.map((e) => ({ ...e, ad: e.ad.trim(), is: e.is.trim() })),
  };
  const h = gunlukHatalari(icerik);
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  return depo.islem(async () => {
    const p = await depo.getir('proje', projeId);
    if (!p || p.firmaId !== firmaId || p.iptal) throw new IsKuraliHatasi('Proje bulunamadı.');
    for (const c of new Set([...icerik.puantaj.map((x) => x.cariId), ...icerik.ekipler.flatMap((x) => (x.cariId ? [x.cariId] : []))])) {
      const cari = await depo.getir('cari', c);
      if (!cari || cari.firmaId !== firmaId || cari.iptal) throw new IsKuraliHatasi('Cari bulunamadı.');
    }
    const mevcut = await gunlukGetir(depo, firmaId, projeId, tarih);
    if (!mevcut) return servis.ekle('santiyeGunlugu', { projeId, tarih, ...icerik, puantaj: icerik.puantaj.map((x) => ({ ...x, giderId: null })) });
    const giderler = await aktifGiderler(depo, firmaId);
    const yeni = new Map(icerik.puantaj.map((x) => [x.id, x]));
    const puantaj = icerik.puantaj.map((x) => ({ ...x, giderId: mevcut.puantaj.find((e) => e.id === x.id)?.giderId ?? null }));
    for (const e of mevcut.puantaj) {
      if (!e.giderId || !giderler.has(e.giderId)) continue;
      const y = yeni.get(e.id);
      if (!y || y.cariId !== e.cariId || puantajTutari(y) !== puantajTutari(e))
        throw new IsKuraliHatasi('Gidere yazılmış puantaj değiştirilemez; önce o yevmiye giderini iptal edin.');
    }
    return servis.guncelle('santiyeGunlugu', mevcut.id, { ...icerik, puantaj });
  });
}

export async function projePuantaji(depo: Depo, firmaId: string, projeId: string, ay?: string): Promise<PuantajKisiOzeti[]> {
  const [gunlukler, giderler] = await Promise.all([projeGunlukleri(depo, firmaId, projeId), aktifGiderler(depo, firmaId)]);
  return puantajOzeti(gunlukler, giderler, ay);
}

const tr = (t: Tarih) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;

/**
 * İşçinin `ay`daki (ya da `bitis`e kadar bütün) yazılmamış yevmiyelerini tek gider olarak carisine borç yazar
 * (KDV 0, veresiye). Yazılan puantaj satırları gidere bağlanır.
 */
export async function puantajGideriYaz(
  depo: Depo,
  servis: KayitServisi,
  g: { projeId: string; cariId: string; ay?: string; kalemId: string | null; tarih: Tarih },
): Promise<Gider> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const kisi = (await projePuantaji(depo, firmaId, g.projeId, g.ay)).find((k) => k.cariId === g.cariId);
    if (!kisi || kisi.yazilmamisTutar <= 0) throw new IsKuraliHatasi('Gidere yazılacak yevmiye yok.');
    const gunlukler = await projeGunlukleri(depo, firmaId, g.projeId);
    const satirIdler = new Set(kisi.yazilmamis.map((x) => x.satirId));
    let gun = 0;
    let mesai = 0;
    for (const gl of gunlukler)
      for (const s of gl.puantaj)
        if (satirIdler.has(s.id)) {
          gun += PUANTAJ_DURUMU[s.durum].gun;
          mesai += s.mesaiSaat;
        }
    const tarihler = kisi.yazilmamis.map((x) => x.tarih).sort();
    const donem = tarihler.length > 1 ? `${tr(tarihler[0]!)}–${tr(tarihler.at(-1)!)}` : tr(tarihler[0]!);
    const aciklama = `Yevmiye ${donem}: ${gun.toLocaleString('tr-TR')} gün${mesai ? ` + ${mesai.toLocaleString('tr-TR')} saat mesai` : ''}`;
    const gider = await giderOlustur(depo, servis, {
      tarih: g.tarih,
      projeId: g.projeId,
      cariId: g.cariId,
      faturaNo: null,
      vadeTarihi: null,
      aciklama,
      satirlar: [{ kalemId: g.kalemId, aciklama, miktar: gun || null, birim: gun ? 'gün' : null, tutar: kisi.yazilmamisTutar, kdvDahil: false, kdvOrani: 0, tevkifat: null }],
    });
    for (const gl of gunlukler) {
      if (!gl.puantaj.some((s) => satirIdler.has(s.id))) continue;
      await servis.guncelle('santiyeGunlugu', gl.id, { puantaj: gl.puantaj.map((s) => (satirIdler.has(s.id) ? { ...s, giderId: gider.id } : s)) });
    }
    return gider;
  });
}
