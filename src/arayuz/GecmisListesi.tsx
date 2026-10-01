import type { GecmisSatiri } from '../servisler/gecmis';
import type { IslemTuru } from '../veri/tipler';

const ISLEM_ADI: Record<IslemTuru, string> = {
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
function farklar(eski: Record<string, unknown>, yeni: Record<string, unknown>, onEk = ''): [string, unknown, unknown][] {
  const sonuc: [string, unknown, unknown][] = [];
  for (const alan of new Set([...Object.keys(eski), ...Object.keys(yeni)])) {
    const e = eski[alan] ?? null;
    const y = yeni[alan] ?? null;
    if (nesneMi(e) && nesneMi(y)) sonuc.push(...farklar(e, y, `${onEk}${alan}.`));
    else if (JSON.stringify(e) !== JSON.stringify(y)) sonuc.push([`${onEk}${alan}`, e, y]);
  }
  return sonuc;
}

function genelDeger(d: unknown): string {
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
