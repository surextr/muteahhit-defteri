import type { CariHareketi } from '../hesap/bakiye';
import { farkAdaylari, mutabakatDurumu, mutabakatFarki, mutabakatMektubu, yanitHatalari, type FarkAdayi, type MutabakatDurumu } from '../hesap/mutabakat';
import type { SozlesmeMetni } from '../hesap/ustaSozlesmesi';
import type { Depo } from '../veri/depo';
import type { Cari, Firma, Kurus, Mutabakat, MutabakatYaniti, Tarih } from '../veri/tipler';
import { carileriListele } from './cari';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import { cariEkstresiGetir } from './odeme';

// Cari mutabakatı (şema 28): tarih itibarıyla bakiye mektubu, gönderim, yanıt (mutabık / farklı), fark çözümü.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;
const gunEkle = (t: Tarih, n: number): Tarih => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const bakiyeTarihte = (h: CariHareketi[], tarih: Tarih): Kurus => h.filter((x) => x.tarih <= tarih).at(-1)?.bakiye ?? 0;

export async function cariMutabakatlari(depo: Depo, firmaId: string, cariId: string): Promise<Mutabakat[]> {
  return aktif(await depo.listele('mutabakat', { firmaId, cariId })).sort((a, b) => b.tarih.localeCompare(a.tarih) || b.olusturmaZamani.localeCompare(a.olusturmaZamani));
}

/** Tarih itibarıyla mutabakat hazırlar; döküm önceki mutabık (ya da fark çözülmüş) mutabakatın ertesi gününden başlar. */
export async function mutabakatHazirla(depo: Depo, servis: KayitServisi, cariId: string, tarih: Tarih): Promise<Mutabakat> {
  const firmaId = servis.oturum.firmaId;
  if (!TARIH.test(tarih)) throw new IsKuraliHatasi('Mutabakat tarihini seçin.');
  const cari = await depo.getir('cari', cariId);
  if (!cari || cari.firmaId !== firmaId || cari.iptal) throw new IsKuraliHatasi('Cari bulunamadı.');
  const [hareketler, onceki] = await Promise.all([cariEkstresiGetir(depo, firmaId, cariId), cariMutabakatlari(depo, firmaId, cariId)]);
  if (onceki.some((m) => m.tarih === tarih && mutabakatDurumu(m) !== 'farkli')) throw new IsKuraliHatasi('Bu cariye bu tarihli mutabakat zaten var.');
  const son = onceki.find((m) => m.tarih < tarih && (mutabakatDurumu(m) === 'mutabik' || mutabakatDurumu(m) === 'cozuldu'));
  return servis.ekle('mutabakat', {
    cariId,
    tarih,
    bakiye: bakiyeTarihte(hareketler, tarih),
    donemBaslangic: son ? gunEkle(son.tarih, 1) : null,
    gonderildi: null,
    yanit: null,
    cozuldu: null,
    not: '',
  });
}

async function getir(depo: Depo, firmaId: string, id: string): Promise<Mutabakat> {
  const m = await depo.getir('mutabakat', id);
  if (!m || m.firmaId !== firmaId || m.iptal) throw new IsKuraliHatasi('Mutabakat bulunamadı.');
  return m;
}

export async function mutabakatGonderildi(depo: Depo, servis: KayitServisi, id: string, tarih: Tarih | null): Promise<Mutabakat> {
  const m = await getir(depo, servis.oturum.firmaId, id);
  if (tarih && (!TARIH.test(tarih) || tarih < m.tarih)) throw new IsKuraliHatasi('Gönderim günü mutabakat tarihinden önce olamaz.');
  if (!tarih && m.yanit) throw new IsKuraliHatasi('Yanıtı girilmiş mutabakatın gönderimi geri alınmaz; önce yanıtı kaldırın.');
  return servis.guncelle('mutabakat', id, { gonderildi: tarih });
}

/** Yanıt; `null` yanıtı kaldırır. Gönderilmemişse yanıt günü gönderim sayılır. */
export async function mutabakatYaniti(depo: Depo, servis: KayitServisi, id: string, y: MutabakatYaniti | null): Promise<Mutabakat> {
  const m = await getir(depo, servis.oturum.firmaId, id);
  if (!y) return servis.guncelle('mutabakat', id, { yanit: null, cozuldu: null });
  const yanit = { ...y, not: y.not.trim(), karsiBakiye: y.mutabik ? null : y.karsiBakiye };
  const h = yanitHatalari(yanit, m.gonderildi, m.tarih);
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  // Karşı bakiye bizimkiyle aynı yazıldıysa mutabıktır.
  if (!yanit.mutabik && yanit.karsiBakiye === m.bakiye) Object.assign(yanit, { mutabik: true, karsiBakiye: null });
  return servis.guncelle('mutabakat', id, { yanit, cozuldu: null, gonderildi: m.gonderildi ?? yanit.tarih });
}

export async function mutabakatCozuldu(depo: Depo, servis: KayitServisi, id: string, tarih: Tarih, not: string): Promise<Mutabakat> {
  const m = await getir(depo, servis.oturum.firmaId, id);
  if (mutabakatDurumu(m) !== 'farkli') throw new IsKuraliHatasi('Yalnız farklı yanıtlı mutabakat çözüldü işaretlenir.');
  if (!not.trim()) throw new IsKuraliHatasi('Farkın neden olduğunu ve ne yapıldığını yazın.');
  if (!TARIH.test(tarih)) throw new IsKuraliHatasi('Günü seçin.');
  return servis.guncelle('mutabakat', id, { cozuldu: { tarih, not: not.trim() } });
}

export async function mutabakatNotu(depo: Depo, servis: KayitServisi, id: string, not: string): Promise<Mutabakat> {
  await getir(depo, servis.oturum.firmaId, id);
  return servis.guncelle('mutabakat', id, { not: not.trim() });
}

export async function mutabakatIptal(depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  await getir(depo, servis.oturum.firmaId, id);
  await servis.iptal('mutabakat', id, 'Mutabakat kaldırıldı.');
}

export interface MutabakatAyrintisi {
  mutabakat: Mutabakat;
  cari: Cari;
  durum: MutabakatDurumu;
  /** Bugünkü kayıtlarla aynı tarihteki bakiye (sonradan geriye tarihli kayıt girildiyse mektuptakinden farklıdır). */
  guncelBakiye: Kurus;
  /** Dönem içi hareketler. */
  hareketler: CariHareketi[];
  devir: Kurus;
  fark: Kurus;
  adaylar: FarkAdayi[];
  mektup: SozlesmeMetni;
}

export async function mutabakatAyrintisi(depo: Depo, firma: Firma, id: string): Promise<MutabakatAyrintisi | null> {
  const m = await depo.getir('mutabakat', id);
  if (!m || m.firmaId !== firma.id || m.iptal) return null;
  const cari = await depo.getir('cari', m.cariId);
  if (!cari) return null;
  const tum = await cariEkstresiGetir(depo, firma.id, m.cariId);
  const kadar = tum.filter((h) => h.tarih <= m.tarih);
  const hareketler = m.donemBaslangic ? kadar.filter((h) => h.tarih >= m.donemBaslangic!) : kadar;
  const devir = m.donemBaslangic ? bakiyeTarihte(tum, gunEkle(m.donemBaslangic, -1)) : 0;
  const fark = mutabakatFarki(m);
  return {
    mutabakat: m,
    cari,
    durum: mutabakatDurumu(m),
    guncelBakiye: bakiyeTarihte(tum, m.tarih),
    hareketler,
    devir,
    fark,
    // Dönem dışındaki (yanlış tarihli) kayıtlar da aday olabilir.
    adaylar: farkAdaylari(tum, fark),
    mektup: mutabakatMektubu(m, { firma, cari, hareketler, devir }),
  };
}

export interface MutabakatListeSatiri {
  cari: Cari;
  /** Seçilen tarihteki bakiye. */
  bakiye: Kurus;
  son: Mutabakat | null;
  sonDurum: MutabakatDurumu | null;
}

/** Toplu mutabakat ekranı: tarihte bakiyesi olan ya da mutabakatı olan cariler (vergi dairesi hariç). */
export async function mutabakatListesi(depo: Depo, firmaId: string, tarih: Tarih): Promise<MutabakatListeSatiri[]> {
  const [cariler, mutabakatlar] = await Promise.all([carileriListele(depo, firmaId), depo.listele('mutabakat', { firmaId })]);
  const son = new Map<string, Mutabakat>();
  for (const m of aktif(mutabakatlar).sort((a, b) => a.tarih.localeCompare(b.tarih) || a.olusturmaZamani.localeCompare(b.olusturmaZamani))) son.set(m.cariId, m);
  const satirlar: MutabakatListeSatiri[] = [];
  for (const { cari, bakiye } of cariler) {
    if (cari.iptal || cari.roller.includes('vergi_dairesi')) continue;
    const m = son.get(cari.id) ?? null;
    if (bakiye === 0 && !m) continue;
    // Güncel bakiye sıfır olsa da seçilen tarihte bakiye olabilir: ekstreden.
    const b = bakiyeTarihte(await cariEkstresiGetir(depo, firmaId, cari.id), tarih);
    if (b === 0 && !m) continue;
    satirlar.push({ cari, bakiye: b, son: m, sonDurum: m ? mutabakatDurumu(m) : null });
  }
  return satirlar.sort((a, b) => Math.abs(b.bakiye) - Math.abs(a.bakiye));
}

/** Açık işler (Tamamlanacak işler): farkı çözülmemiş ve 14 günden uzun yanıtsız mutabakatlar. */
export async function acikMutabakatlar(depo: Depo, firmaId: string, bugun: Tarih): Promise<{ farkli: Mutabakat[]; yanitsiz: Mutabakat[] }> {
  const l = aktif(await depo.listele('mutabakat', { firmaId }));
  return {
    farkli: l.filter((m) => mutabakatDurumu(m) === 'farkli'),
    yanitsiz: l.filter((m) => mutabakatDurumu(m) === 'gonderildi' && m.gonderildi! <= gunEkle(bugun, -14)),
  };
}
