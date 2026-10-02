import type { Depo } from '../veri/depo';
import { BOS_FIRMA_BILGILERI } from '../veri/gecisler';
import { yeniId } from '../veri/kimlik';
import { vergiDairesiHazirla } from './cari';
import { IsKuraliHatasi, KayitServisi, type Oturum } from './kayitServisi';

/** Cihaza özeldir: yedeğe girmez, geri yüklemede korunur. */
export const META_CIHAZ = 'cihazId';
const META_FIRMA = 'aktifFirmaId';
const META_KULLANICI = 'aktifKullaniciId';

/** Bu cihazın kalıcı kimliği; işlem geçmişinde hangi cihazdan girildiği görünür. */
export async function cihazKimligi(depo: Depo): Promise<string> {
  let id = await depo.metaGetir<string>(META_CIHAZ);
  if (!id) {
    id = yeniId();
    await depo.metaYaz(META_CIHAZ, id);
  }
  return id;
}

/** Kurulum yapılmışsa açık oturum, yapılmamışsa null. */
export async function oturumuYukle(depo: Depo): Promise<Oturum | null> {
  const firmaId = await depo.metaGetir<string>(META_FIRMA);
  const kullaniciId = await depo.metaGetir<string>(META_KULLANICI);
  if (!firmaId || !kullaniciId) return null;
  return { firmaId, kullaniciId, cihazId: await cihazKimligi(depo) };
}

export interface KurulumBilgisi {
  firmaAdi: string;
  kullaniciAdi: string;
}

/** İlk açılış: firma, yönetici kullanıcı ve üyeliği tek seferde oluşturur. */
export async function ilkKurulum(
  depo: Depo,
  bilgi: KurulumBilgisi,
  saat: () => Date = () => new Date(),
): Promise<Oturum> {
  const firmaAdi = bilgi.firmaAdi.trim();
  const kullaniciAdi = bilgi.kullaniciAdi.trim();
  if (!firmaAdi) throw new IsKuraliHatasi('Firma adı boş olamaz.');
  if (!kullaniciAdi) throw new IsKuraliHatasi('Kullanıcı adı boş olamaz.');
  if (await oturumuYukle(depo)) throw new IsKuraliHatasi('Bu cihazda kurulum zaten yapılmış.');

  return depo.islem(async () => {
    const oturum: Oturum = { firmaId: yeniId(), kullaniciId: yeniId(), cihazId: await cihazKimligi(depo) };
    const servis = new KayitServisi(depo, oturum, saat);
    await servis.ekle(
      'firma',
      {
        ad: firmaAdi,
        abonelikDurumu: 'deneme',
        ayarlar: { kdvMaliyeteDahil: true, anaParaBirimi: 'TRY' },
        bilgiler: { ...BOS_FIRMA_BILGILERI },
        logo: null,
      },
      oturum.firmaId,
    );
    await servis.ekle('kullanici', { ad: kullaniciAdi, eposta: null }, oturum.kullaniciId);
    await servis.ekle('uyelik', { kullaniciId: oturum.kullaniciId, rol: 'yonetici', projeIdleri: null });
    // Tevkif edilen KDV'nin borç yazıldığı hazır kart.
    await vergiDairesiHazirla(depo, servis);
    await depo.metaYaz(META_FIRMA, oturum.firmaId);
    await depo.metaYaz(META_KULLANICI, oturum.kullaniciId);
    return oturum;
  });
}

/**
 * Bu cihazı kullanan kişiyi değiştirir: bundan sonraki kayıtlar işlem geçmişine onun adıyla yazılır.
 * Şifre yoktur; giriş ve yetki Supabase aşamasında gelecek.
 */
export async function cihazKullanicisiniDegistir(depo: Depo, firmaId: string, kullaniciId: string): Promise<void> {
  const uyelikler = await depo.listele('uyelik', { firmaId, kullaniciId });
  const kullanici = await depo.getir('kullanici', kullaniciId);
  if (!kullanici || kullanici.iptal || !uyelikler.some((u) => u.iptal === null)) {
    throw new IsKuraliHatasi('Bu kişi firmanın kullanıcısı değil.');
  }
  await depo.metaYaz(META_KULLANICI, kullaniciId);
}
