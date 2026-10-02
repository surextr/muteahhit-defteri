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

/** İç içe alanları (örn. alanlar.net) tek tek karşılaştırır; yalnızca değişenleri döndürür. */
export function farklar(eski: Record<string, unknown>, yeni: Record<string, unknown>, onEk = ''): [string, unknown, unknown][] {
  const sonuc: [string, unknown, unknown][] = [];
  for (const alan of new Set([...Object.keys(eski), ...Object.keys(yeni)])) {
    const e = eski[alan] ?? null;
    const y = yeni[alan] ?? null;
    if (nesneMi(e) && nesneMi(y)) sonuc.push(...farklar(e, y, `${onEk}${alan}.`));
    else if (JSON.stringify(e) !== JSON.stringify(y)) sonuc.push([`${onEk}${alan}`, e, y]);
  }
  return sonuc;
}

export function genelDeger(d: unknown): string {
  if (d === null || d === undefined || d === '') return '—';
  if (typeof d === 'boolean') return d ? 'Evet' : 'Hayır';
  if (typeof d === 'number') return d.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return new Date(`${d}T00:00`).toLocaleDateString('tr-TR');
  if (Array.isArray(d)) return d.length === 0 ? '—' : d.map(genelDeger).join(', ');
  return String(d);
}

export function GecmisListesi({ satirlar, bicim }: { satirlar: GecmisSatiri[]; bicim: AlanBicimi }) {
  const yaz = (alan: string, d: unknown) => bicim.degerYaz?.(alan, d) ?? genelDeger(d);
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
          {islem.islem === 'guncelle' && (
            <ul>
              {farklar(islem.eski ?? {}, islem.yeni ?? {}).map(([alan, e, y]) => (
                <li key={alan}>
                  {bicim.etiketler[alan] ?? alan}: <del>{yaz(alan, e)}</del> → <ins>{yaz(alan, y)}</ins>
                </li>
              ))}
            </ul>
          )}
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
  },
  degerYaz: (alan, d) => {
    const son = alan.split('.').at(-1)!;
    if (PARA_ALANLARI.has(son) && typeof d === 'number') return tlYaz(d);
    if (son === 'rol' && typeof d === 'string' && d in ROL_ADI) return ROL_ADI[d as Rol];
    if (KIMLIK_ALANI.test(son)) return d === null ? '—' : 'seçili';
    return undefined;
  },
};
