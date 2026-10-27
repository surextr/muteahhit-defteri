import { sgkHatalari, sgkOzeti, type SgkGirdisi, type SgkOzeti } from '../hesap/sgk';
import type { Depo } from '../veri/depo';
import type { SgkKaydi, UstaSozlesmesi } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// SGK takibi: proje ve ay bazında işçi bildirimleri, usta sözleşmesine bağlı (ya da müteahhidin kendi işçisi).

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);

export interface SgkGrubu {
  /** null: müteahhidin kendi işçileri. */
  sozlesme: UstaSozlesmesi | null;
  cariAdi: string;
  kayitlar: SgkKaydi[];
  ozet: SgkOzeti;
}

export interface SgkDonemi {
  gruplar: SgkGrubu[];
  ozet: SgkOzeti;
  /** İmzalı sözleşmelerden bu ay hiç bildirim girilmemiş olanlar (iş sürüyorsa kontrol edilmeli). */
  bildirimsiz: { sozlesme: UstaSozlesmesi; cariAdi: string }[];
}

function temizle(g: SgkGirdisi): SgkGirdisi {
  return { ...g, isciAdi: g.isciAdi.trim().replace(/\s+/g, ' '), girisTarihi: g.girisTarihi || null, cikisTarihi: g.cikisTarihi || null };
}

async function denetle(depo: Depo, firmaId: string, projeId: string, g: SgkGirdisi) {
  const h = sgkHatalari(g);
  if (g.sozlesmeId) {
    const s = await depo.getir('ustaSozlesmesi', g.sozlesmeId);
    if (!s || s.firmaId !== firmaId || s.iptal || s.projeId !== projeId) h.push('Sözleşme bu projede bulunamadı.');
  }
  if (h.length > 0) throw new IsKuraliHatasi(h.join(' '));
}

export async function sgkEkle(depo: Depo, servis: KayitServisi, projeId: string, girdi: SgkGirdisi): Promise<SgkKaydi> {
  const g = temizle(girdi);
  return depo.islem(async () => {
    await denetle(depo, servis.oturum.firmaId, projeId, g);
    return servis.ekle('sgkKaydi', { projeId, ...g });
  });
}

export async function sgkGuncelle(depo: Depo, servis: KayitServisi, id: string, girdi: SgkGirdisi, gerekce?: string): Promise<SgkKaydi> {
  const g = temizle(girdi);
  return depo.islem(async () => {
    const k = await depo.getir('sgkKaydi', id);
    if (!k || k.firmaId !== servis.oturum.firmaId || k.iptal) throw new IsKuraliHatasi('Kayıt bulunamadı.');
    await denetle(depo, servis.oturum.firmaId, k.projeId, g);
    return servis.guncelle('sgkKaydi', id, g, gerekce);
  });
}

export async function sgkIptal(servis: KayitServisi, id: string, gerekce?: string): Promise<void> {
  await servis.iptal('sgkKaydi', id, gerekce);
}

/**
 * Önceki ayın işçilerini bu aya taşır (gün ve prim boş: o ay için yazılır). Bu ayda aynı sözleşmede aynı adla kayıt
 * varsa o işçi atlanır; çıkış tarihi önceki ayda olan işçi taşınmaz. Dönüş: eklenen kayıt sayısı.
 */
export async function oncekiAydanKopyala(depo: Depo, servis: KayitServisi, projeId: string, donem: string, oncekiDonem: string): Promise<number> {
  const firmaId = servis.oturum.firmaId;
  return depo.islem(async () => {
    const tumu = aktif(await depo.listele('sgkKaydi', { projeId, firmaId }));
    const anahtar = (k: Pick<SgkKaydi, 'sozlesmeId' | 'isciAdi'>) => `${k.sozlesmeId ?? ''}|${k.isciAdi.toLocaleLowerCase('tr-TR')}`;
    const buAy = new Set(tumu.filter((k) => k.donem === donem).map(anahtar));
    let sayi = 0;
    for (const k of tumu.filter((x) => x.donem === oncekiDonem)) {
      if (buAy.has(anahtar(k)) || (k.cikisTarihi && k.cikisTarihi.slice(0, 7) <= oncekiDonem)) continue;
      await servis.ekle('sgkKaydi', {
        projeId,
        sozlesmeId: k.sozlesmeId,
        donem,
        isciAdi: k.isciAdi,
        girisTarihi: k.girisTarihi,
        cikisTarihi: null,
        gun: 0,
        prim: 0,
        odeyen: k.odeyen,
        hakediseDahil: k.hakediseDahil,
      });
      buAy.add(anahtar(k));
      sayi++;
    }
    return sayi;
  });
}

export async function sgkDonemi(depo: Depo, firmaId: string, projeId: string, donem: string): Promise<SgkDonemi> {
  const [kayitlar, sozlesmeler, cariler] = await Promise.all([
    depo.listele('sgkKaydi', { projeId, firmaId }),
    depo.listele('ustaSozlesmesi', { projeId, firmaId }),
    depo.listele('cari', { firmaId }),
  ]);
  const ad = new Map(cariler.map((c) => [c.id, c.ad]));
  const ayin = aktif(kayitlar)
    .filter((k) => k.donem === donem)
    .sort((a, b) => a.isciAdi.localeCompare(b.isciAdi, 'tr'));
  const imzali = aktif(sozlesmeler).filter((s) => s.onay);
  const gruplar: SgkGrubu[] = [];
  for (const s of imzali) {
    const k = ayin.filter((x) => x.sozlesmeId === s.id);
    if (k.length > 0) gruplar.push({ sozlesme: s, cariAdi: ad.get(s.cariId) ?? '?', kayitlar: k, ozet: sgkOzeti(k) });
  }
  const kendi = ayin.filter((x) => !x.sozlesmeId || !imzali.some((s) => s.id === x.sozlesmeId));
  if (kendi.length > 0) gruplar.push({ sozlesme: null, cariAdi: 'Kendi işçilerimiz', kayitlar: kendi, ozet: sgkOzeti(kendi) });
  // İş başlamış (başlama tarihi bu ay sonundan önce ya da boş) ve bitmemiş sözleşmeler bildirim bekler.
  const aySonu = `${donem}-31`;
  const ayBasi = `${donem}-01`;
  const bildirimsiz = imzali
    .filter((s) => !ayin.some((k) => k.sozlesmeId === s.id))
    .filter((s) => (!s.baslamaTarihi || s.baslamaTarihi <= aySonu) && (!s.bitisTarihi || s.bitisTarihi >= ayBasi))
    .map((s) => ({ sozlesme: s, cariAdi: ad.get(s.cariId) ?? '?' }));
  return { gruplar, ozet: sgkOzeti(ayin), bildirimsiz };
}
