import type { Depo } from '../veri/depo';
import { aramaAnahtari } from '../hesap/metin';
import type { Kullanici, Rol, Uyelik } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';

// Firmanın kullanıcıları ve rolleri.
// Bu aşamada veri yalnızca bu cihazda: roller kimin ne yaptığını işlem geçmişinde ayırt etmek içindir.
// Yetki kısıtı (kim neyi görebilir/değiştirebilir) Supabase aşamasında, girişle birlikte uygulanacak.

export const ROL_ADI: Record<Rol, string> = { yonetici: 'Yönetici', muhasebe: 'Muhasebe', santiye: 'Şantiye' };

/** Supabase aşamasında uygulanacak yetkiler; şimdilik ekranda bilgi olarak gösterilir. */
export const ROL_ACIKLAMASI: Record<Rol, string> = {
  yonetici: 'Her şey: projeler, bütçe, ödemeler, raporlar, kullanıcılar ve ayarlar.',
  muhasebe: 'Gider, ödeme, tahsilat, çek/senet, cariler ve raporlar; kullanıcı ve firma ayarları hariç.',
  santiye: 'Gider/fiş ve belge girişi, kendi projeleri; ödeme ve raporlar hariç.',
};

export const ROLLER = Object.keys(ROL_ADI) as Rol[];

export interface KullaniciSatiri {
  kullanici: Kullanici;
  uyelik: Uyelik;
}

export interface KullaniciGirdisi {
  ad: string;
  eposta: string | null;
}

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
/** Ad tekrarı denetimi: büyük/küçük ve Türkçe harfsiz yazım aynı ad sayılır ("Celik" = "Çelik"). */
const adAnahtari = aramaAnahtari;
const EPOSTA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function temizle(g: KullaniciGirdisi): KullaniciGirdisi {
  return { ad: g.ad.trim().replace(/\s+/g, ' '), eposta: g.eposta?.trim().toLowerCase() || null };
}

/** Firmanın etkin üyeleri: önce yöneticiler, sonra ada göre. */
export async function kullanicilariListele(depo: Depo, firmaId: string): Promise<KullaniciSatiri[]> {
  const sonuc: KullaniciSatiri[] = [];
  for (const uyelik of aktif(await depo.listele('uyelik', { firmaId }))) {
    const kullanici = await depo.getir('kullanici', uyelik.kullaniciId);
    if (kullanici && !kullanici.iptal) sonuc.push({ kullanici, uyelik });
  }
  return sonuc.sort((a, b) => ROLLER.indexOf(a.uyelik.rol) - ROLLER.indexOf(b.uyelik.rol) || a.kullanici.ad.localeCompare(b.kullanici.ad, 'tr'));
}

async function girdiDenetle(depo: Depo, firmaId: string, g: KullaniciGirdisi, haricKullaniciId?: string) {
  const hatalar: string[] = [];
  if (!g.ad) hatalar.push('Kullanıcının adını yazın.');
  if (g.eposta && !EPOSTA.test(g.eposta)) hatalar.push('E-posta adresi geçerli görünmüyor.');
  // Geçmişte "kim yaptı" adla görünür; aynı ad iki kişiyi karıştırır.
  const ayni = (await kullanicilariListele(depo, firmaId)).find(
    (k) => k.kullanici.id !== haricKullaniciId && adAnahtari(k.kullanici.ad) === adAnahtari(g.ad),
  );
  if (g.ad && ayni) hatalar.push(`"${ayni.kullanici.ad}" adlı bir kullanıcı zaten var; geçmişte ayırt edilebilmesi için soyadını da yazın.`);
  if (hatalar.length > 0) throw new IsKuraliHatasi(hatalar.join(' '));
}

export async function kullaniciEkle(depo: Depo, servis: KayitServisi, girdi: KullaniciGirdisi, rol: Rol): Promise<KullaniciSatiri> {
  const g = temizle(girdi);
  if (!ROLLER.includes(rol)) throw new IsKuraliHatasi('Rol seçin.');
  return depo.islem(async () => {
    await girdiDenetle(depo, servis.oturum.firmaId, g);
    const kullanici = await servis.ekle('kullanici', g);
    const uyelik = await servis.ekle('uyelik', { kullaniciId: kullanici.id, rol, projeIdleri: null });
    return { kullanici, uyelik };
  });
}

export async function kullaniciGuncelle(
  depo: Depo,
  servis: KayitServisi,
  kullaniciId: string,
  girdi: KullaniciGirdisi,
  gerekce?: string,
): Promise<Kullanici> {
  const g = temizle(girdi);
  return depo.islem(async () => {
    const uye = (await kullanicilariListele(depo, servis.oturum.firmaId)).find((k) => k.kullanici.id === kullaniciId);
    if (!uye) throw new IsKuraliHatasi('Kullanıcı bulunamadı.');
    await girdiDenetle(depo, servis.oturum.firmaId, g, kullaniciId);
    return servis.guncelle('kullanici', kullaniciId, g, gerekce);
  });
}

/** Firmada en az bir yönetici kalmalı; yoksa kimse kullanıcıları yönetemez. */
async function yoneticiKalirMi(depo: Depo, firmaId: string, degisenUyelikId: string): Promise<boolean> {
  return (await kullanicilariListele(depo, firmaId)).some((k) => k.uyelik.rol === 'yonetici' && k.uyelik.id !== degisenUyelikId);
}

async function uyelikGetir(depo: Depo, firmaId: string, uyelikId: string): Promise<Uyelik> {
  const uyelik = await depo.getir('uyelik', uyelikId);
  if (!uyelik || uyelik.firmaId !== firmaId || uyelik.iptal) throw new IsKuraliHatasi('Kullanıcı bulunamadı.');
  return uyelik;
}

export async function rolDegistir(depo: Depo, servis: KayitServisi, uyelikId: string, rol: Rol, gerekce?: string): Promise<void> {
  if (!ROLLER.includes(rol)) throw new IsKuraliHatasi('Rol seçin.');
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const uyelik = await uyelikGetir(depo, firmaId, uyelikId);
    if (uyelik.rol === 'yonetici' && rol !== 'yonetici' && !(await yoneticiKalirMi(depo, firmaId, uyelikId))) {
      throw new IsKuraliHatasi('Firmada en az bir yönetici kalmalı. Önce başka birini yönetici yapın.');
    }
    await servis.guncelle('uyelik', uyelikId, { rol }, gerekce);
  });
}

/**
 * Kullanıcının firmadaki üyeliği iptal edilir (ayrıldı). Geçmişteki kayıtları adıyla görünmeye devam eder.
 * Bu cihazı kullanan kişi kendini ve son yöneticiyi çıkaramaz.
 */
export async function uyelikIptal(depo: Depo, servis: KayitServisi, uyelikId: string, gerekce?: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  await depo.islem(async () => {
    const uyelik = await uyelikGetir(depo, firmaId, uyelikId);
    if (uyelik.kullaniciId === servis.oturum.kullaniciId) {
      throw new IsKuraliHatasi('Bu cihazı şu an siz kullanıyorsunuz; kendinizi çıkaramazsınız.');
    }
    if (uyelik.rol === 'yonetici' && !(await yoneticiKalirMi(depo, firmaId, uyelikId))) {
      throw new IsKuraliHatasi('Firmada en az bir yönetici kalmalı.');
    }
    await servis.iptal('uyelik', uyelikId, gerekce);
  });
}
