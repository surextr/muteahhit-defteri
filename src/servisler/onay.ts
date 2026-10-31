import { acikTalimat, dogrudanOdeyebilir, esikUstu, onayAkisi, onayAkisiHatalari } from '../hesap/onay';
import type { Depo } from '../veri/depo';
import type { Hakedis, KararBilgisi, Odeme, OdemeOnayi, OnayAkisiAyari } from '../veri/tipler';
import { hakedisGetir } from './hakedis';
import { IsKuraliHatasi, YetkiHatasi, type KayitServisi } from './kayitServisi';
import { odemeYap, type OdemeGirdisi } from './odeme';

// Onay akışı (firma ayarı `onayAkisi`, isteğe bağlı): eşik üstü ödemeyi yönetici dışındaki kişi talimat olarak gönderir,
// (kontrol adımı açıksa muhasebe kontrol eder) yönetici onaylayınca ödeme o anda girilir. Eşik üstü hakedişi yalnız yönetici
// onaylar. Banka dosyasından alınan, çekle ya da kredi ekranından yapılan ödemeler akışa girmez (gerçekleşmiş işlemlerdir).

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);

async function karar(servis: KayitServisi, not: string): Promise<KararBilgisi> {
  return { kullaniciId: servis.oturum.kullaniciId, zaman: new Date().toISOString(), not: not.trim() };
}

export async function onayAkisiGetir(servis: KayitServisi): Promise<OnayAkisiAyari | null> {
  return onayAkisi(await servis.firmaAyarlari());
}

/** Ödeme formu: kişi doğrudan ödeyebiliyorsa ödeme, değilse talimat oluşur. */
export async function odemeYapVeyaOnayaGonder(depo: Depo, servis: KayitServisi, g: OdemeGirdisi): Promise<{ odeme: Odeme } | { talimat: OdemeOnayi }> {
  const a = await onayAkisiGetir(servis);
  const yetkili = await servis.yetkisiVar('odeme');
  if (yetkili && dogrudanOdeyebilir(a, await servis.rol(), g.tutar)) return { odeme: await odemeYap(depo, servis, g) };
  if (!a?.odeme) throw new YetkiHatasi('Ödeme yetkiniz yok.');
  return { talimat: await odemeTalimatiOlustur(depo, servis, g) };
}

export async function odemeTalimatiOlustur(depo: Depo, servis: KayitServisi, g: OdemeGirdisi): Promise<OdemeOnayi> {
  const firmaId = servis.oturum.firmaId;
  if (!Number.isInteger(g.tutar) || g.tutar <= 0) throw new IsKuraliHatasi('Ödeme tutarını yazın.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g.tarih)) throw new IsKuraliHatasi('Ödeme tarihini seçin.');
  const dagitilan = g.dagitim.reduce((t, d) => t + d.tutar, 0);
  if (dagitilan > g.tutar) throw new IsKuraliHatasi('Faturalara dağıtılan tutar ödemeden fazla olamaz.');
  return depo.islem(async () => {
    const cari = await depo.getir('cari', g.cariId);
    if (!cari || cari.firmaId !== firmaId || cari.iptal) throw new IsKuraliHatasi('Cariyi seçin.');
    const hesap = await depo.getir('hesap', g.hesapId);
    if (!hesap || hesap.firmaId !== firmaId || hesap.iptal) throw new IsKuraliHatasi('Ödemenin yapılacağı hesabı seçin.');
    let projeId: string | null = null;
    for (const d of g.dagitim) {
      const gider = await depo.getir('gider', d.giderId);
      if (!gider || gider.firmaId !== firmaId || gider.iptal || gider.cariId !== g.cariId) throw new IsKuraliHatasi('Dağıtılan fatura bulunamadı.');
      projeId ??= gider.projeId;
    }
    return servis.ekle('odemeOnayi', {
      cariId: g.cariId,
      hesapId: g.hesapId,
      tutar: g.tutar,
      tarih: g.tarih,
      aciklama: g.aciklama.trim(),
      dagitim: g.dagitim.filter((d) => d.tutar > 0).map((d) => ({ giderId: d.giderId, tutar: d.tutar })),
      projeId,
      durum: 'bekliyor',
      kontrol: null,
      karar: null,
      odemeId: null,
    });
  });
}

async function talimatGetir(depo: Depo, servis: KayitServisi, id: string): Promise<OdemeOnayi> {
  const t = await depo.getir('odemeOnayi', id);
  if (!t || t.firmaId !== servis.oturum.firmaId || t.iptal) throw new IsKuraliHatasi('Ödeme talimatı bulunamadı.');
  if (!acikTalimat(t.durum)) throw new IsKuraliHatasi('Bu talimat sonuçlandı.');
  return t;
}

/** Muhasebe kontrolü (kontrol adımı açıkken onaydan önce şart); hazırlayan kendi talimatını kontrol edemez. */
export async function odemeTalimatiKontrolEt(depo: Depo, servis: KayitServisi, id: string, not = ''): Promise<void> {
  const t = await talimatGetir(depo, servis, id);
  const rol = await servis.rol();
  if (rol !== 'muhasebe' && rol !== 'yonetici') throw new YetkiHatasi('Kontrolü muhasebe yapar.');
  if (t.olusturan === servis.oturum.kullaniciId) throw new IsKuraliHatasi('Hazırladığınız talimatı siz kontrol edemezsiniz.');
  if (t.durum === 'kontrol_edildi') throw new IsKuraliHatasi('Bu talimat zaten kontrol edildi.');
  await servis.guncelle('odemeOnayi', id, { durum: 'kontrol_edildi', kontrol: await karar(servis, not) });
}

/** Yönetici onayı: ödeme o anda girilir (ödeme kuralları yeniden denetlenir), talimat ödemeye bağlanır. */
export async function odemeTalimatiOnayla(depo: Depo, servis: KayitServisi, id: string, not = ''): Promise<Odeme> {
  const t = await talimatGetir(depo, servis, id);
  if ((await servis.rol()) !== 'yonetici') throw new YetkiHatasi('Ödeme talimatını yönetici onaylar.');
  const a = await onayAkisiGetir(servis);
  if (a?.kontrol && t.durum !== 'kontrol_edildi') throw new IsKuraliHatasi('Önce muhasebe kontrol etmeli.');
  return depo.islem(async () => {
    const odeme = await odemeYap(depo, servis, {
      tarih: t.tarih,
      cariId: t.cariId,
      hesapId: t.hesapId,
      tutar: t.tutar,
      aciklama: t.aciklama,
      dagitim: t.dagitim,
    });
    await servis.guncelle('odemeOnayi', id, { durum: 'onaylandi', karar: await karar(servis, not), odemeId: odeme.id });
    return odeme;
  });
}

export async function odemeTalimatiReddet(depo: Depo, servis: KayitServisi, id: string, gerekce: string): Promise<void> {
  await talimatGetir(depo, servis, id);
  if ((await servis.rol()) !== 'yonetici') throw new YetkiHatasi('Ödeme talimatını yönetici reddeder.');
  if (!gerekce.trim()) throw new IsKuraliHatasi('Red gerekçesini yazın.');
  await servis.guncelle('odemeOnayi', id, { durum: 'reddedildi', karar: await karar(servis, gerekce) });
}

export async function odemeTalimatiGeriCek(depo: Depo, servis: KayitServisi, id: string): Promise<void> {
  const t = await talimatGetir(depo, servis, id);
  if (t.olusturan !== servis.oturum.kullaniciId) throw new IsKuraliHatasi('Talimatı yalnız hazırlayan geri çeker.');
  await servis.guncelle('odemeOnayi', id, { durum: 'geri_cekildi' });
}

export async function hakedisKontrolEt(depo: Depo, servis: KayitServisi, id: string, not = ''): Promise<void> {
  const h = await hakedisGetir(depo, servis.oturum.firmaId, id);
  if (!h) throw new IsKuraliHatasi('Hakediş bulunamadı.');
  if (h.onay) throw new IsKuraliHatasi('Hakediş zaten onaylı.');
  const rol = await servis.rol();
  if (rol !== 'muhasebe' && rol !== 'yonetici') throw new YetkiHatasi('Kontrolü muhasebe yapar.');
  if (h.olusturan === servis.oturum.kullaniciId && rol !== 'yonetici') throw new IsKuraliHatasi('Hazırladığınız hakedişi siz kontrol edemezsiniz.');
  await servis.guncelle('hakedis', id, { kontrol: await karar(servis, not) });
}

export interface BekleyenOnaylar {
  talimatlar: OdemeOnayi[];
  /** Akışa giren (eşik üstü) onaysız hakedişler. */
  hakedisler: Hakedis[];
  /** Son sonuçlananlar (30 gün). */
  sonuclananlar: OdemeOnayi[];
}

export async function bekleyenOnaylar(depo: Depo, firmaId: string, ayar: OnayAkisiAyari | null, erisim: Set<string> | null): Promise<BekleyenOnaylar> {
  const gorunur = (p: string | null) => !erisim || p === null || erisim.has(p);
  const [talimatlar, hakedisler] = await Promise.all([depo.listele('odemeOnayi', { firmaId }), depo.listele('hakedis', { firmaId })]);
  const sinir = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const t = aktif(talimatlar).filter((x) => gorunur(x.projeId));
  return {
    talimatlar: t.filter((x) => acikTalimat(x.durum)).sort((a, b) => a.olusturmaZamani.localeCompare(b.olusturmaZamani)),
    hakedisler: aktif(hakedisler)
      .filter((h) => !h.onay && gorunur(h.projeId) && esikUstu(ayar, 'hakedis', h.borcTutari))
      .sort((a, b) => a.tarih.localeCompare(b.tarih)),
    sonuclananlar: t
      .filter((x) => !acikTalimat(x.durum) && (x.guncellemeZamani ?? x.olusturmaZamani) >= sinir)
      .sort((a, b) => (b.guncellemeZamani ?? '').localeCompare(a.guncellemeZamani ?? '')),
  };
}

/** Ayarı kaydeder (yalnız yönetici: firma tablosu). */
export async function onayAkisiKaydet(depo: Depo, servis: KayitServisi, a: OnayAkisiAyari): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  const [uyelikler, firma] = await Promise.all([depo.listele('uyelik', { firmaId }), depo.getir('firma', firmaId)]);
  const h = onayAkisiHatalari(a, aktif(uyelikler).some((u) => u.rol === 'muhasebe'));
  if (h.length) throw new IsKuraliHatasi(h.join(' '));
  if (!firma) throw new IsKuraliHatasi('Firma bulunamadı.');
  await servis.guncelle('firma', firmaId, { ayarlar: { ...firma.ayarlar, onayAkisi: a } });
}
