import { bolumNo } from '../hesap/bolum';
import { tlYaz } from '../hesap/para';
import type { Depo } from '../veri/depo';
import type { IslemGecmisi, IslemTuru, KayitTabloAdi, Tarih } from '../veri/tipler';

export interface GecmisSatiri {
  islem: IslemGecmisi;
  kullaniciAdi: string;
}

async function kullaniciAdlari(depo: Depo, islemler: IslemGecmisi[]): Promise<Map<string, string>> {
  const adlar = new Map<string, string>();
  for (const id of new Set(islemler.map((i) => i.kullaniciId))) {
    adlar.set(id, (await depo.getir('kullanici', id))?.ad ?? 'Bilinmeyen kullanıcı');
  }
  return adlar;
}

const yeniOnce = (a: IslemGecmisi, b: IslemGecmisi) => b.zaman.localeCompare(a.zaman) || b.id.localeCompare(a.id);

/** Bir kaydın değişiklik geçmişi, en yenisi önce. */
export async function kayitGecmisiGetir(depo: Depo, firmaId: string, kayitId: string): Promise<GecmisSatiri[]> {
  const islemler = await depo.listele('islemGecmisi', { kayitId, firmaId });
  const adlar = await kullaniciAdlari(depo, islemler);
  return islemler.sort(yeniOnce).map((islem) => ({ islem, kullaniciAdi: adlar.get(islem.kullaniciId)! }));
}

// ─── Firma geneli geçmiş ───────────────────────────────────────────

export const KAYIT_TURU_ADI: Record<string, string> = {
  firma: 'Firma',
  kullanici: 'Kullanıcı',
  uyelik: 'Kullanıcı rolü',
  ayarDegeri: 'Ayar',
  proje: 'Proje',
  projeOrtagi: 'Proje ortağı',
  blok: 'Blok',
  kat: 'Kat',
  bagimsizBolum: 'Bağımsız bölüm',
  ortakAlan: 'Ortak alan',
  takipBasligi: 'Takip başlığı',
  kalemIlerlemesi: 'Kalem ilerlemesi',
  projeFotografi: 'Şantiye fotoğrafı',
  fiyatKalemi: 'Malzeme / işçilik fiyatı',
  maliyetHesabi: 'Maliyet hesabı',
  kredi: 'Kredi',
  santiyeGunlugu: 'Şantiye günlüğü',
  malzemeTalebi: 'Malzeme talebi',
  malzemeHareketi: 'Stok hareketi',
  odemeOnayi: 'Ödeme talimatı',
  yapilacakAtama: 'İş ataması',
  daireTeslimi: 'Daire teslimi',
  eksikIs: 'Eksik iş',
  sabitGider: 'Sabit gider',
  kalem: 'Kalem / bütçe',
  cari: 'Cari',
  acilisBakiyesi: 'Açılış bakiyesi',
  hesap: 'Kasa/banka',
  gider: 'Gider',
  giderSatiri: 'Gider satırı',
  odeme: 'Ödeme / tahsilat',
  eslestirme: 'Eşleştirme',
  transfer: 'Transfer',
  cekSenet: 'Çek / senet',
  cekHareketi: 'Çek hareketi',
  belge: 'Belge',
  belgeHavuzu: 'Onay bekleyen belge',
  katKarsiligiSozlesme: 'Kat karşılığı sözleşmesi',
  arsaSahibiTahsisi: 'Arsa sahibi tahsisi',
  arsaSahibiOdemesi: 'Arsa sahibine ödeme planı',
  ilaveImalat: 'İlave imalat',
  alacak: 'Alacak',
  ustaTipi: 'Usta tipi',
  ustaSozlesmesi: 'Usta sözleşmesi',
  hakedis: 'Hakediş',
  teminatIadesi: 'Teminat serbest bırakma',
  odemePlani: 'Ödeme planı',
  sgkKaydi: 'SGK kaydı',
  satis: 'Satış',
  yedek: 'Yedekten geri yükleme',
};

/**
 * Kullanıcının doğrudan yönettiği kayıtlar. Diğerleri (gider satırı, eşleştirme, çek hareketi…)
 * bir ana kaydın parçasıdır; çoğunlukla ana kaydın değişikliği ya da iptaliyle birlikte yazılır.
 */
export const ANA_KAYITLAR = new Set<string>([
  'firma',
  'kullanici',
  'uyelik',
  'ayarDegeri',
  'proje',
  'projeOrtagi',
  'bagimsizBolum',
  'katKarsiligiSozlesme',
  'arsaSahibiTahsisi',
  'arsaSahibiOdemesi',
  'ilaveImalat',
  'ortakAlan',
  'takipBasligi',
  'kalemIlerlemesi',
  'projeFotografi',
  'fiyatKalemi',
  'maliyetHesabi',
  'kredi',
  'santiyeGunlugu',
  'malzemeTalebi',
  'malzemeHareketi',
  'odemeOnayi',
  'yapilacakAtama',
  'daireTeslimi',
  'eksikIs',
  'sabitGider',
  'kalem',
  'cari',
  'acilisBakiyesi',
  'hesap',
  'gider',
  'odeme',
  'transfer',
  'cekSenet',
  'belge',
  'ustaTipi',
  'ustaSozlesmesi',
  'hakedis',
  'teminatIadesi',
  'odemePlani',
  'sgkKaydi',
  'satis',
  'yedek',
]);

export interface GecmisSuzgeci {
  islemler?: IslemTuru[];
  kullaniciId?: string;
  /** Yalnızca ANA_KAYITLAR. */
  yalnizcaAnaKayitlar?: boolean;
  yalnizcaGerekceli?: boolean;
  /** Bu günler dahil, cihazın yerel saatine göre. */
  baslangic?: Tarih;
  bitis?: Tarih;
}

export interface KayitEtiketi {
  turAdi: string;
  /** "Beton AŞ · ₺120.000,00" gibi kısa özet; kayıt okunamazsa null. */
  ozet: string | null;
  /** Kaydın açıldığı ekran (#/ olmadan); yoksa ya da kayıt iptal edilmişse null (ekranlar iptal kaydı göstermez). */
  yol: string | null;
  /** Kayıt şu an iptal edilmiş durumda. */
  iptalEdildi?: boolean;
}

export interface FirmaGecmisSatiri extends GecmisSatiri {
  etiket: KayitEtiketi;
}

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const yerelGun = (z: string) => {
  const d = new Date(z);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Kaydın kısa özeti ve ekranı. Bağlı kayıtlarda ana kaydın ekranına gidilir. */
export async function kayitEtiketi(depo: Depo, kayitTur: string, kayitId: string): Promise<KayitEtiketi> {
  const etiket = await etiketHazirla(depo, kayitTur, kayitId);
  if (!(kayitTur in KAYIT_TURU_ADI) || kayitTur === 'yedek') return etiket;
  const kayit = (await depo.getir(kayitTur as KayitTabloAdi, kayitId)) as { iptal?: unknown } | undefined;
  if (!kayit?.iptal) return etiket;
  // Ana kaydın ekranı iptal kaydı göstermez; bağlı kayıtta (satır, eşleştirme) ana kayda gidilebilir.
  return { ...etiket, yol: ANA_KAYITLAR.has(kayitTur) ? null : etiket.yol, iptalEdildi: true };
}

async function etiketHazirla(depo: Depo, kayitTur: string, kayitId: string): Promise<KayitEtiketi> {
  const turAdi = KAYIT_TURU_ADI[kayitTur] ?? kayitTur;
  const bos = { turAdi, ozet: null, yol: null };
  if (kayitTur === 'yedek') return bos;
  if (!(kayitTur in KAYIT_TURU_ADI)) return bos;
  const k = (await depo.getir(kayitTur as KayitTabloAdi, kayitId)) as Record<string, unknown> | undefined;
  if (!k) return bos;
  const s = (alan: string) => k[alan] as string;
  const n = (alan: string) => k[alan] as number;
  const adOku = async (tablo: KayitTabloAdi, id: unknown) =>
    typeof id === 'string' ? (((await depo.getir(tablo, id)) as { ad?: string } | undefined)?.ad ?? null) : null;

  switch (kayitTur) {
    case 'firma':
      return { turAdi, ozet: s('ad'), yol: 'ayarlar' };
    case 'kullanici':
      return { turAdi, ozet: s('ad'), yol: 'ayarlar/kullanicilar' };
    case 'uyelik':
      return { turAdi, ozet: await adOku('kullanici', k.kullaniciId), yol: 'ayarlar/kullanicilar' };
    case 'proje':
      return { turAdi, ozet: s('ad'), yol: `projeler/${kayitId}` };
    case 'kalem':
      return { turAdi, ozet: s('ad'), yol: `projeler/${s('projeId')}/butce` };
    case 'projeOrtagi':
      return { turAdi, ozet: `${(await adOku('cari', k.cariId)) ?? '?'} · %${n('oran')}`, yol: `projeler/${s('projeId')}` };
    case 'blok':
    case 'kat':
    case 'ortakAlan':
    case 'takipBasligi':
      return { turAdi, ozet: s('ad'), yol: `projeler/${s('projeId')}` };
    case 'kalemIlerlemesi':
      return { turAdi, ozet: `${(await adOku('kalem', k.kalemId)) ?? '?'} · %${n('yuzde')} · ${tarihYaz(s('tarih'))}`, yol: `projeler/${s('projeId')}/ilerleme` };
    case 'fiyatKalemi':
      return { turAdi, ozet: `${s('ad')}${k.fiyat != null ? ` · ${tlYaz(n('fiyat'))}/${s('birim')}` : ''}`, yol: 'maliyet/fiyatlar' };
    case 'maliyetHesabi':
      return { turAdi, ozet: `${s('ad')} · Rev. ${n('revizyon')}`, yol: `maliyet/${kayitId}` };
    case 'malzemeTalebi':
      return { turAdi, ozet: tarihYaz(s('tarih')), yol: `talepler/${kayitId}` };
    case 'malzemeHareketi':
      return { turAdi, ozet: `${s('tur') === 'giris' ? 'Giriş' : 'Çıkış'} · ${s('ad')} ${n('miktar')} ${s('birim')}`, yol: `projeler/${s('projeId')}/stok` };
    case 'odemeOnayi':
      return { turAdi, ozet: `${(await adOku('cari', s('cariId'))) ?? '?'} · ${tlYaz(n('tutar'))}`, yol: 'onaylar' };
    case 'daireTeslimi':
      return { turAdi, ozet: s('tamamlandi') ? `Teslim ${tarihYaz(s('tamamlandi'))}` : `Kontrol ${tarihYaz(s('tarih'))}`, yol: `teslim/${kayitId}` };
    case 'sabitGider':
      return { turAdi, ozet: `${s('ad')} · ${tlYaz(n('tutar'))}`, yol: 'sabit-giderler' };
    case 'eksikIs':
      return { turAdi, ozet: s('baslik'), yol: `projeler/${s('projeId')}/teslim` };
    case 'yapilacakAtama':
      return { turAdi, ozet: s('not') || 'Atama', yol: 'yapilacaklar' };
    case 'santiyeGunlugu':
      return { turAdi, ozet: tarihYaz(s('tarih')), yol: `gunluk/${s('projeId')}/${s('tarih')}` };
    case 'kredi':
      return { turAdi, ozet: `${s('ad')} · ${tlYaz(n('anapara'))}`, yol: `krediler/${kayitId}` };
    case 'projeFotografi':
      return { turAdi, ozet: `${tarihYaz(s('cekimTarihi'))}${s('aciklama') ? ` · ${s('aciklama')}` : ''}`, yol: `projeler/${s('projeId')}/fotograflar` };
    case 'bagimsizBolum':
      return { turAdi, ozet: bolumNo(await adOku('blok', k.blokId), s('no')), yol: `projeler/${s('projeId')}` };
    case 'katKarsiligiSozlesme':
      return { turAdi, ozet: `Arsa sahipleri %${n('arsaSahibiOrani')}`, yol: `projeler/${s('projeId')}` };
    case 'arsaSahibiOdemesi':
      return { turAdi, ozet: `${(await adOku('cari', k.cariId)) ?? '?'} · ${tlYaz(n('tutar'))}`, yol: `projeler/${s('projeId')}` };
    case 'ilaveImalat':
      return { turAdi, ozet: `${s('aciklama')} · ${tlYaz(n('tutar'))}`, yol: `projeler/${s('projeId')}` };
    case 'alacak':
      return { turAdi, ozet: `${(await adOku('cari', k.cariId)) ?? '?'} · ${tlYaz(n('tutar'))}`, yol: `cariler/${s('cariId')}` };
    case 'arsaSahibiTahsisi': {
      const bolum = await depo.getir('bagimsizBolum', s('bolumId'));
      const no = bolum ? bolumNo(await adOku('blok', bolum.blokId), bolum.no) : '?';
      return { turAdi, ozet: `${no} · ${(await adOku('cari', k.cariId)) ?? '?'}`, yol: bolum ? `projeler/${bolum.projeId}` : null };
    }
    case 'cari':
      return { turAdi, ozet: s('ad'), yol: `cariler/${kayitId}` };
    case 'hesap':
      return { turAdi, ozet: s('ad'), yol: `hesaplar/${kayitId}` };
    case 'acilisBakiyesi': {
      const hedef = s('hedefTur') === 'cari' ? 'cari' : 'hesap';
      return {
        turAdi,
        ozet: `${(await adOku(hedef, k.hedefId)) ?? '?'} · ${tlYaz(Math.abs(n('tutar')))}`,
        yol: `${hedef === 'cari' ? 'cariler' : 'hesaplar'}/${s('hedefId')}`,
      };
    }
    case 'gider': {
      const kim = (await adOku('cari', k.cariId)) ?? 'Carisiz';
      const iade = s('tur') === 'iade' ? 'İade · ' : '';
      return { turAdi, ozet: `${iade}${kim} · ${tlYaz(Math.abs(n('toplam')))} · ${tarihYaz(s('tarih'))}`, yol: `giderler/${kayitId}` };
    }
    case 'giderSatiri':
      return { turAdi, ozet: tlYaz(Math.abs(n('toplam'))), yol: `giderler/${s('giderId')}` };
    case 'odeme': {
      const yon = s('yon') === 'tahsilat' ? 'Tahsilat' : 'Ödeme';
      const kim = await adOku('cari', k.cariId);
      return { turAdi, ozet: `${yon}${kim ? ` · ${kim}` : ''} · ${tlYaz(n('tutar'))} · ${tarihYaz(s('tarih'))}`, yol: `odemeler/${kayitId}` };
    }
    case 'eslestirme':
      return {
        turAdi,
        ozet: tlYaz(n('tutar')),
        yol: s('kaynakTur') === 'iade' ? `giderler/${s('odemeId')}` : `odemeler/${s('odemeId')}`,
      };
    case 'transfer':
      return {
        turAdi,
        ozet: `${(await adOku('hesap', k.kaynakHesapId)) ?? '?'} → ${(await adOku('hesap', k.hedefHesapId)) ?? '?'} · ${tarihYaz(s('tarih'))}`,
        yol: `hesaplar/${s('kaynakHesapId')}`,
      };
    case 'cekSenet':
      return {
        turAdi,
        ozet: `${(await adOku('cari', k.cariId)) ?? '?'} · ${tlYaz(n('tutar'))} · vade ${tarihYaz(s('vadeTarihi'))}`,
        yol: `cekler/${kayitId}`,
      };
    case 'cekHareketi':
      return { turAdi, ozet: tarihYaz(s('tarih')), yol: `cekler/${s('cekSenetId')}` };
    case 'belge':
      return { turAdi, ozet: s('ad'), yol: `belgeler/${kayitId}` };
    case 'ustaTipi':
      return { turAdi, ozet: s('ad'), yol: `ayarlar/usta-tipleri/${kayitId}` };
    case 'ustaSozlesmesi':
      return { turAdi, ozet: `${(await adOku('cari', k.cariId)) ?? '?'} · ${s('ustaTipiAdi')}`, yol: `sozlesmeler/${kayitId}` };
    case 'hakedis':
      return { turAdi, ozet: `${n('no')}. hakediş · ${(await adOku('cari', k.cariId)) ?? '?'} · ${tlYaz(n('brutTutar'))}`, yol: `hakedisler/${kayitId}` };
    case 'teminatIadesi':
      return { turAdi, ozet: `${(await adOku('cari', k.cariId)) ?? '?'} · ${tlYaz(n('tutar'))}`, yol: `sozlesmeler/${s('sozlesmeId')}` };
    case 'odemePlani':
      return { turAdi, ozet: `${tarihYaz(s('vadeTarihi'))} · ${tlYaz(n('tutar'))}`, yol: `sozlesmeler/${s('sozlesmeId')}` };
    case 'satis':
      return { turAdi, ozet: `${(await adOku('cari', k.cariId)) ?? '?'} · ${tlYaz(n('fiyat') - n('indirim'))}`, yol: `satislar/${kayitId}` };
    case 'sgkKaydi':
      return { turAdi, ozet: `${s('isciAdi')} · ${s('donem')} · ${n('gun')} gün`, yol: `projeler/${s('projeId')}/sgk` };
    default:
      return bos;
  }
}

export interface GecmisSayfasi {
  satirlar: FirmaGecmisSatiri[];
  /** Süzgece uyan toplam kayıt; sayfa daha fazlasını gösterebilir mi diye. */
  toplam: number;
}

/** Firmanın işlem geçmişi, en yeni önce; süzgeçli ve sayfalı (`sinir` kadar). */
export async function firmaGecmisiGetir(depo: Depo, firmaId: string, suzgec: GecmisSuzgeci = {}, sinir = 50): Promise<GecmisSayfasi> {
  const uyan = (await depo.listele('islemGecmisi', { firmaId }))
    .filter((i) => {
      if (suzgec.islemler?.length && !suzgec.islemler.includes(i.islem)) return false;
      if (suzgec.kullaniciId && i.kullaniciId !== suzgec.kullaniciId) return false;
      if (suzgec.yalnizcaAnaKayitlar && !ANA_KAYITLAR.has(i.kayitTur)) return false;
      if (suzgec.yalnizcaGerekceli && !i.gerekce) return false;
      const gun = yerelGun(i.zaman);
      if (suzgec.baslangic && gun < suzgec.baslangic) return false;
      if (suzgec.bitis && gun > suzgec.bitis) return false;
      return true;
    })
    .sort(yeniOnce);
  const sayfa = uyan.slice(0, sinir);
  const adlar = await kullaniciAdlari(depo, sayfa);
  const etiketler = new Map<string, KayitEtiketi>();
  const satirlar: FirmaGecmisSatiri[] = [];
  for (const islem of sayfa) {
    const anahtar = `${islem.kayitTur}:${islem.kayitId}`;
    if (!etiketler.has(anahtar)) etiketler.set(anahtar, await kayitEtiketi(depo, islem.kayitTur, islem.kayitId));
    satirlar.push({ islem, kullaniciAdi: adlar.get(islem.kullaniciId)!, etiket: etiketler.get(anahtar)! });
  }
  return { satirlar, toplam: uyan.length };
}
