import type { Depo } from '../veri/depo';
import type { Zaman } from '../veri/tipler';

// Yarım kalan form (örn. proje sihirbazı) cihazda taslak olarak saklanır:
// başka ekrana geçilip dönülünce kaldığı yerden devam edilir.
// Taslak kayıt değildir; işlem geçmişine yazılmaz, yalnızca bu cihazın meta tablosunda durur.

/** giderVarsayilanlari: son kullanılan proje ve hesap (taslak değil, hızlı girişte öneri). */
export type TaslakAdi = 'projeSihirbazi' | 'giderFormu' | 'giderVarsayilanlari';

export interface Taslak<T> {
  /** Taslak biçimi değişirse eski taslak okunmaz. */
  bicim: number;
  zaman: Zaman;
  veri: T;
}

const anahtar = (firmaId: string, ad: TaslakAdi) => `taslak:${firmaId}:${ad}`;

export async function taslakGetir<T>(depo: Depo, firmaId: string, ad: TaslakAdi, bicim: number): Promise<Taslak<T> | null> {
  const taslak = await depo.metaGetir<Taslak<T>>(anahtar(firmaId, ad));
  return taslak && taslak.bicim === bicim ? taslak : null;
}

export async function taslakYaz<T>(
  depo: Depo,
  firmaId: string,
  ad: TaslakAdi,
  bicim: number,
  veri: T,
  saat: () => Date = () => new Date(),
): Promise<void> {
  await depo.metaYaz(anahtar(firmaId, ad), { bicim, zaman: saat().toISOString(), veri } satisfies Taslak<T>);
}

export async function taslakSil(depo: Depo, firmaId: string, ad: TaslakAdi): Promise<void> {
  await depo.metaSil(anahtar(firmaId, ad));
}
