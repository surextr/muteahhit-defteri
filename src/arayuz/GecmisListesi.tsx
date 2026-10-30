import { FIYAT_KAYNAGI_ADI } from '../hesap/fiyat';
import { tlYaz } from '../hesap/para';
import type { GecmisSatiri } from '../servisler/gecmis';
import { ROL_ADI } from '../servisler/kullanici';
import type { IslemTuru, Rol } from '../veri/tipler';

export const ISLEM_ADI: Record<IslemTuru, string> = {
  olustur: 'Oluşturuldu',
  guncelle: 'Değiştirildi',
  iptal: 'İptal edildi',
  onayla: 'Onaylandı',
  geriYukle: 'Geri yüklendi',
};

export interface AlanBicimi {
  /** Alan yolu → ekrandaki adı, örn. { ad: 'Proje adı', 'alanlar.net': 'Net alan' } */
  etiketler: Record<string, string>;
  /** Özel gösterim (seçenek adları vb.); undefined dönerse genel biçim kullanılır. */
  degerYaz?: (alan: string, deger: unknown) => string | undefined;
}

const nesneMi = (d: unknown): d is Record<string, unknown> => typeof d === 'object' && d !== null && !Array.isArray(d);

/** Dizideki bir ögenin kısa adı: ad, ada/parsel, numara ya da ilk yazı alanı. */
export function ogeAdi(o: Record<string, unknown>): string {
  const yazi = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : null);
  if (yazi('ada') || yazi('parsel')) return `${yazi('ada') ?? '…'}/${yazi('parsel') ?? '…'}`;
  const ad = yazi('ad') ?? yazi('baslik') ?? yazi('metin') ?? yazi('soru') ?? yazi('aciklama') ?? yazi('no');
  if (ad) return ad.length > 60 ? `${ad.slice(0, 57)}…` : ad;
  const ilk = Object.entries(o).find(([k, v]) => typeof v === 'string' && v.trim() && !/id$/i.test(k));
  return ilk ? String(ilk[1]).slice(0, 60) : 'öge';
}

/**
 * Nesne dizisini ögelere eşler: hepsinde `id` varsa kimlikle, adlar tekilse adla, yoksa sırayla. Ögenin yolu "alan[ad]".
 */
function diziFarklari(alan: string, e: Record<string, unknown>[], y: Record<string, unknown>[]): [string, unknown, unknown][] {
  const hepsi = [...e, ...y];
  const kimlikli = hepsi.every((o) => typeof o.id === 'string');
  const adlar = (l: Record<string, unknown>[]) => l.map(ogeAdi);
  const adTekil = (l: Record<string, unknown>[]) => new Set(adlar(l)).size === l.length;
  const anahtar = kimlikli ? (o: Record<string, unknown>) => o.id as string : adTekil(e) && adTekil(y) ? ogeAdi : null;
  const sonuc: [string, unknown, unknown][] = [];
  const yol = (o: Record<string, unknown>, i: number) => `${alan}[${anahtar ? ogeAdi(o) : `${i + 1}. ${ogeAdi(o)}`}]`;
  if (!anahtar) {
    for (let i = 0; i < Math.max(e.length, y.length); i++) {
      const a = e[i];
      const b = y[i];
      if (a && b) sonuc.push(...farklar(a, b, `${yol(b, i)}.`));
      else if (b) sonuc.push([yol(b, i), null, 'eklendi']);
      else if (a) sonuc.push([yol(a, i), 'vardı', 'çıkarıldı']);
    }
    return sonuc;
  }
  const eskiler = new Map(e.map((o) => [anahtar(o), o]));
  const yeniler = new Set(y.map(anahtar));
  y.forEach((o, i) => {
    const a = eskiler.get(anahtar(o));
    if (a) sonuc.push(...farklar(a, o, `${yol(o, i)}.`));
    else sonuc.push([yol(o, i), null, 'eklendi']);
  });
  e.forEach((o, i) => {
    if (!yeniler.has(anahtar(o))) sonuc.push([yol(o, i), 'vardı', 'çıkarıldı']);
  });
  return sonuc;
}

const nesneDizisi = (d: unknown): d is Record<string, unknown>[] => Array.isArray(d) && d.every(nesneMi);

/** İç içe alanları (örn. alanlar.net) ve nesne dizilerini öge öge karşılaştırır; yalnızca değişenleri döndürür. */
export function farklar(eski: Record<string, unknown>, yeni: Record<string, unknown>, onEk = ''): [string, unknown, unknown][] {
  const sonuc: [string, unknown, unknown][] = [];
  for (const alan of new Set([...Object.keys(eski), ...Object.keys(yeni)])) {
    const e = eski[alan] ?? null;
    const y = yeni[alan] ?? null;
    if (JSON.stringify(e) === JSON.stringify(y)) continue;
    if (nesneMi(e) && nesneMi(y)) sonuc.push(...farklar(e, y, `${onEk}${alan}.`));
    else if ((nesneDizisi(e) || e === null) && (nesneDizisi(y) || y === null) && (e !== null || y !== null) && ((e as unknown[] | null)?.length || (y as unknown[] | null)?.length))
      sonuc.push(...diziFarklari(`${onEk}${alan}`, (e as Record<string, unknown>[] | null) ?? [], (y as Record<string, unknown>[] | null) ?? []));
    else sonuc.push([`${onEk}${alan}`, e, y]);
  }
  return sonuc;
}

/**
 * Alan yolunun ekrandaki adı: tam yol, köşeli parantezsiz genel yol ("satirlar[].miktar"), yoksa parça parça
 * ("Satırlar › Beton › Miktar").
 */
export function alanEtiketi(bicim: AlanBicimi, alan: string): string {
  if (bicim.etiketler[alan]) return bicim.etiketler[alan]!;
  const genel = alan.replace(/\[[^\]]*\]/g, '[]');
  if (bicim.etiketler[genel]) return bicim.etiketler[genel]!;
  if (!alan.includes('[')) return alan;
  return alan
    .split(/\.(?![^[]*\])/)
    .map((p) => {
      const m = /^([^[]+)(?:\[(.*)\])?$/.exec(p);
      const ad = m?.[1] ?? p;
      const ad2 = bicim.etiketler[ad] ?? GENEL_BICIM.etiketler[ad] ?? ad;
      return m?.[2] !== undefined ? `${ad2} › ${m[2]}` : ad2;
    })
    .join(' › ');
}

export function genelDeger(d: unknown): string {
  if (d === null || d === undefined || d === '') return '—';
  if (typeof d === 'boolean') return d ? 'Evet' : 'Hayır';
  if (typeof d === 'number') return d.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T00:00`).toLocaleDateString('tr-TR');
  if (Array.isArray(d)) return d.length === 0 ? '—' : d.map(genelDeger).join(', ');
  if (nesneMi(d)) return ogeAdi(d);
  return String(d);
}

/** Değişen alanlar; çoksa ilk 8'i, kalanı açılır listede (bina bilgisi değişince onlarca maliyet satırı birden değişir). */
export function DegisenListesi({ degisen, bicim, className }: { degisen: [string, unknown, unknown][]; bicim: AlanBicimi; className?: string }) {
  const yaz = (alan: string, d: unknown) => bicim.degerYaz?.(alan, d) ?? genelDeger(d);
  const satir = ([alan, e, y]: [string, unknown, unknown]) => (
    <li key={alan}>
      {alanEtiketi(bicim, alan)}: <del>{yaz(alan, e)}</del> → <ins>{yaz(alan, y)}</ins>
    </li>
  );
  const ilk = degisen.slice(0, 8);
  const kalan = degisen.slice(8);
  return (
    <ul className={className}>
      {ilk.map(satir)}
      {kalan.length > 0 && (
        <li>
          <details>
            <summary>{kalan.length} değişiklik daha</summary>
            <ul>{kalan.map(satir)}</ul>
          </details>
        </li>
      )}
    </ul>
  );
}

export function GecmisListesi({ satirlar, bicim }: { satirlar: GecmisSatiri[]; bicim: AlanBicimi }) {
  return (
    <ol className="gecmis">
      {satirlar.map(({ islem, kullaniciAdi }) => (
        <li key={islem.id}>
          <div>
            <strong>{ISLEM_ADI[islem.islem]}</strong>
            <span className="soluk">
              {' '}
              · {new Date(islem.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })} · {kullaniciAdi}
            </span>
          </div>
          {islem.islem === 'guncelle' && <DegisenListesi degisen={farklar(islem.eski ?? {}, islem.yeni ?? {})} bicim={bicim} />}
          {islem.gerekce && <p className="soluk">Gerekçe: {islem.gerekce}</p>}
        </li>
      ))}
    </ol>
  );
}

// ─── Firma geneli geçmiş için ortak biçim ───────────────────────────

const PARA_ALANLARI = new Set([
  'tutar',
  'toplam',
  'kdvHaricToplam',
  'kdvToplam',
  'tevkifatToplam',
  'butceTutari',
  'kdvHaricTutar',
  'kdvTutari',
  'tevkifatTutari',
  'birimFiyat',
  'hedefTutar',
  'fiyat',
  'ozelFiyat',
]);

/** Başka kayda bağlantı alanları: kimlik yerine "seçili" yazılır (ayrıntı kaydın kendi ekranında). */
const KIMLIK_ALANI = /Id$|Idler$/;

/** Kayıt türünü bilmeden okunabilir gösterim: sık alan adları ve para alanları. */
export const GENEL_BICIM: AlanBicimi = {
  etiketler: {
    ad: 'Ad',
    tarih: 'Tarih',
    vadeTarihi: 'Vade',
    aciklama: 'Açıklama',
    tutar: 'Tutar',
    toplam: 'Toplam',
    kdvHaricToplam: 'KDV hariç',
    kdvToplam: 'KDV',
    tevkifatToplam: 'Tevkifat',
    faturaNo: 'Fatura no',
    butceTutari: 'Bütçe',
    butceMiktari: 'Bütçe miktarı',
    birim: 'Birim',
    sira: 'Sıra',
    rol: 'Rol',
    roller: 'Roller',
    telefon: 'Telefon',
    eposta: 'E-posta',
    durum: 'Durum',
    oran: 'Oran (%)',
    iban: 'IBAN',
    not: 'Not',
    projeId: 'Proje',
    cariId: 'Cari',
    hesapId: 'Hesap',
    kalemId: 'Kalem',
    'ayarlar.kdvMaliyeteDahil': 'Maliyet KDV dahil',
    'ayarlar.odaTipleri.eklenen': 'Eklenen oda tipleri',
    'ayarlar.odaTipleri.gizli': 'Gizlenen oda tipleri',
    odaSayisi: 'Oda sayısı',
    salonSayisi: 'Salon sayısı',
    dubleks: 'Dubleks',
    logo: 'Logo',
    il: 'İl',
    ilce: 'İlçe',
    mahalle: 'Mahalle',
    adres: 'Adres',
    'alanlar.arsa': 'Arsa alanı (m²)',
    'bilgiler.yetkili': 'Yetkili',
    'bilgiler.telefon': 'Telefon',
    'bilgiler.eposta': 'E-posta',
    'bilgiler.web': 'Web',
    'bilgiler.adres': 'Adres',
    'bilgiler.vergiDairesi': 'Vergi dairesi',
    'bilgiler.vergiNo': 'Vergi no',
    parseller: 'Parsel',
    satirlar: 'Satır',
    kalemler: 'Kalem',
    miktar: 'Miktar',
    katsayi: 'Katsayı',
    dayanak: 'Dayanak',
    ozelFiyat: 'Özel fiyat',
    miktarKaynagi: 'Miktarın kaynağı',
    alanM2: 'Alan (m²)',
    ada: 'Ada',
    parsel: 'Parsel',
    dondurulan: 'Dondurulan fiyat',
    fiyat: 'Fiyat',
    fiyatKaynagi: 'Fiyat kaynağı',
    fiyatTarihi: 'Fiyat tarihi',
    kaynakNotu: 'Kaynak notu',
    kdvOrani: 'KDV oranı (%)',
  },
  degerYaz: (alan, d) => {
    const son = alan.split('.').at(-1)!;
    // Logo resim verisidir; metin olarak gösterilmez.
    if (son === 'logo') return d ? 'logo' : 'yok';
    if (PARA_ALANLARI.has(son) && typeof d === 'number') return tlYaz(d);
    if (son === 'rol' && typeof d === 'string' && d in ROL_ADI) return ROL_ADI[d as Rol];
    if (KIMLIK_ALANI.test(son)) return d === null ? '—' : 'seçili';
    if (son === 'fiyatKaynagi' && typeof d === 'string' && d in FIYAT_KAYNAGI_ADI) return FIYAT_KAYNAGI_ADI[d as keyof typeof FIYAT_KAYNAGI_ADI];
    return undefined;
  },
};
