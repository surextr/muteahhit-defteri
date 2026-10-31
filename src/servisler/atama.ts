import type { Depo } from '../veri/depo';
import type { Tarih, YapilacakAtama } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Tamamlanacak işler maddesinin kişiye atanması. Madde kayıtlardan hesaplanır; atama maddenin anahtarıyla tutulur ve
// eşitlemeyle diğer cihazlara gider. Madde çözülünce atama listede görünmez (kayıt kalır, zararsız).

/** Anahtar → geçerli atama (iptal edilmemiş, en son değişen). */
export async function atamalar(depo: Depo, firmaId: string): Promise<Map<string, YapilacakAtama>> {
  const m = new Map<string, YapilacakAtama>();
  for (const a of await depo.listele('yapilacakAtama', { firmaId })) {
    if (a.iptal) continue;
    const o = m.get(a.anahtar);
    if (!o || (a.guncellemeZamani ?? a.olusturmaZamani) > (o.guncellemeZamani ?? o.olusturmaZamani)) m.set(a.anahtar, a);
  }
  return m;
}

export async function ata(depo: Depo, servis: KayitServisi, g: { anahtar: string; kullaniciId: string; not: string; sonTarih: Tarih | null }): Promise<YapilacakAtama> {
  const firmaId = servis.oturum.firmaId;
  if (!g.anahtar) throw new IsKuraliHatasi('Madde bulunamadı.');
  if (g.sonTarih && !/^\d{4}-\d{2}-\d{2}$/.test(g.sonTarih)) throw new IsKuraliHatasi('Son tarihi seçin.');
  const uyelikler = await depo.listele('uyelik', { firmaId });
  const k = await depo.getir('kullanici', g.kullaniciId);
  // Tek kişilik firmada üyelik yok: cihazı kullanan kişi atanabilir.
  const firmada = uyelikler.length ? uyelikler.some((u) => !u.iptal && u.kullaniciId === g.kullaniciId) : g.kullaniciId === servis.oturum.kullaniciId;
  if (!k || k.iptal || !firmada) throw new IsKuraliHatasi('Kişiyi seçin.');
  const var_ = (await atamalar(depo, firmaId)).get(g.anahtar);
  const veri = { kullaniciId: g.kullaniciId, not: g.not.trim(), sonTarih: g.sonTarih };
  return var_ ? servis.guncelle('yapilacakAtama', var_.id, veri) : servis.ekle('yapilacakAtama', { anahtar: g.anahtar, ...veri });
}

export async function atamaKaldir(_depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  await servis.iptal('yapilacakAtama', id);
}
