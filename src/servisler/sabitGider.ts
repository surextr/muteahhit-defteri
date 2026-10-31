import { aylikKarsilik, girilmeyenTekrarlar, sabitGiderHatalari, type AyGideri, type SabitGiderIcerigi, type SabitTekrar } from '../hesap/sabitGider';
import type { Depo } from '../veri/depo';
import type { Kurus, SabitGider, Tarih } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Sabit giderler (şema 27): kira, maaş, muhasebeci… Borç doğurmaz; nakit tahmininde planlı çıkış olur. Ödendiğinde gider
// olarak girilir; o ay aynı cariye (carisizde aynı kaleme) gider girildiyse o ayın tekrarı tahmine girmez.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);

export interface SabitGiderSatiri {
  sabit: SabitGider;
  cariAdi: string | null;
  projeAdi: string | null;
  kalemAdi: string | null;
  aylik: Kurus;
}

export async function sabitGiderleriListele(depo: Depo, firmaId: string): Promise<SabitGiderSatiri[]> {
  const k = { firmaId };
  const [sabitler, cariler, projeler, kalemler] = await Promise.all([depo.listele('sabitGider', k), depo.listele('cari', k), depo.listele('proje', k), depo.listele('kalem', k)]);
  const ad = <T extends { id: string; ad: string }>(l: T[]) => new Map(l.map((x) => [x.id, x.ad]));
  const [c, p, ka] = [ad(cariler), ad(projeler), ad(kalemler)];
  return aktif(sabitler)
    .map((s) => ({
      sabit: s,
      cariAdi: s.cariId ? (c.get(s.cariId) ?? '?') : null,
      projeAdi: s.projeId ? (p.get(s.projeId) ?? '?') : null,
      kalemAdi: s.kalemId ? (ka.get(s.kalemId) ?? '?') : null,
      aylik: aylikKarsilik(s),
    }))
    .sort((a, b) => b.aylik - a.aylik || a.sabit.ad.localeCompare(b.sabit.ad, 'tr'));
}

async function denetle(depo: Depo, firmaId: string, g: SabitGiderIcerigi) {
  for (const [tablo, id, ad] of [
    ['cari', g.cariId, 'Cari'],
    ['proje', g.projeId, 'Proje'],
    ['kalem', g.kalemId, 'Kalem'],
  ] as const) {
    if (!id) continue;
    const x = await depo.getir(tablo, id);
    if (!x || x.firmaId !== firmaId || x.iptal) throw new IsKuraliHatasi(`${ad} bulunamadı.`);
  }
}

/** `id` verilirse günceller, yoksa ekler. */
export async function sabitGiderKaydet(depo: Depo, servis: KayitServisi, g: SabitGiderIcerigi, id?: string): Promise<SabitGider> {
  const firmaId = servis.oturum.firmaId;
  const icerik: SabitGiderIcerigi = { ...g, ad: g.ad.trim(), not: g.not.trim(), bitis: g.bitis || null };
  const h = sabitGiderHatalari(icerik);
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  return depo.islem(async () => {
    await denetle(depo, firmaId, icerik);
    if (!id) return servis.ekle('sabitGider', icerik);
    const mevcut = await depo.getir('sabitGider', id);
    if (!mevcut || mevcut.firmaId !== firmaId || mevcut.iptal) throw new IsKuraliHatasi('Sabit gider bulunamadı.');
    return servis.guncelle('sabitGider', id, icerik);
  });
}

export async function sabitGiderIptal(depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  const s = await depo.getir('sabitGider', id);
  if (!s || s.firmaId !== servis.oturum.firmaId || s.iptal) throw new IsKuraliHatasi('Sabit gider bulunamadı.');
  await servis.iptal('sabitGider', id, 'Sabit gider kaldırıldı.');
}

/** Ayda girilmiş giderler (cari + satır kalemleri): sabit giderin o ay girilip girilmediği buna bakar. */
export async function ayGiderleri(depo: Depo, firmaId: string): Promise<AyGideri[]> {
  const k = { firmaId };
  const [giderler, satirlar] = await Promise.all([depo.listele('gider', k), depo.listele('giderSatiri', k)]);
  const kalemler = new Map<string, string[]>();
  for (const x of aktif(satirlar)) if (x.kalemId) kalemler.set(x.giderId, [...(kalemler.get(x.giderId) ?? []), x.kalemId]);
  return aktif(giderler).map((g) => ({ ay: g.tarih.slice(0, 7), cariId: g.cariId, kalemIdleri: kalemler.get(g.id) ?? [] }));
}

export async function girilmeyenSabitGiderler(depo: Depo, firmaId: string, bugun: Tarih): Promise<SabitTekrar[]> {
  const [sabitler, giderler] = await Promise.all([depo.listele('sabitGider', { firmaId }), ayGiderleri(depo, firmaId)]);
  return girilmeyenTekrarlar(sabitler, giderler, bugun);
}

/** Bu tekrar için gider formu yolu (cari ve kalem dolu, Peşin seçili). */
export function sabitGiderFormYolu(s: Pick<SabitGider, 'projeId' | 'cariId' | 'kalemId'>): string {
  if (!s.projeId) return 'giderler/yeni';
  if (!s.cariId) return `giderler/yeni/${s.projeId}`;
  return `giderler/yeni/${s.projeId}/${s.cariId}${s.kalemId ? `/${s.kalemId}` : ''}`;
}
