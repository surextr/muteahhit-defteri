import { tamSayiOku } from '../hesap/sayi';
import { BOS_BLOK, type BlokGirdisi } from '../servisler/proje';
import { Alan } from './bilesenler';

// Blok formu: yeni proje sihirbazında ve var olan projeye blok eklerken aynıdır.

type SayiAlani = 'bodrumKatSayisi' | 'bodrumKatBolumSayisi' | 'zeminBolumSayisi' | 'normalKatSayisi' | 'katBasinaDaire' | 'catiDubleksSayisi';

/** Kullanıcının yazdığı metinler; sayılar kaydederken okunur. */
export type BlokFormu = Record<SayiAlani, string> &
  Pick<BlokGirdisi, 'ad' | 'zeminBolumTipi' | 'kapaliOtopark' | 'siginak' | 'jenerator'> & {
    /** 0 ya da boş: asansör yok. */
    asansorSayisi: string;
  };

export const blokFormu = (ad: string): BlokFormu => ({
  ad,
  zeminBolumTipi: BOS_BLOK.zeminBolumTipi,
  bodrumKatSayisi: String(BOS_BLOK.bodrumKatSayisi),
  bodrumKatBolumSayisi: String(BOS_BLOK.bodrumKatBolumSayisi),
  zeminBolumSayisi: String(BOS_BLOK.zeminBolumSayisi),
  normalKatSayisi: String(BOS_BLOK.normalKatSayisi),
  katBasinaDaire: String(BOS_BLOK.katBasinaDaire),
  catiDubleksSayisi: String(BOS_BLOK.catiDubleksSayisi),
  asansorSayisi: String(BOS_BLOK.asansorSayisi),
  kapaliOtopark: BOS_BLOK.kapaliOtopark,
  siginak: BOS_BLOK.siginak,
  jenerator: BOS_BLOK.jenerator,
});

const BLOK_SAYI_ALANLARI: { alan: SayiAlani; etiket: string; aciklama?: string }[] = [
  { alan: 'normalKatSayisi', etiket: 'Normal kat sayısı', aciklama: 'Zemin katın üstündeki katlar.' },
  { alan: 'katBasinaDaire', etiket: 'Kat başına daire' },
  { alan: 'zeminBolumSayisi', etiket: 'Zemin kattaki bölüm sayısı' },
  { alan: 'bodrumKatSayisi', etiket: 'Bodrum kat sayısı' },
  {
    alan: 'bodrumKatBolumSayisi',
    etiket: 'Her bodrum kattaki dükkan/depo',
    aciklama: 'Satılacak bölüm yoksa 0. Otopark ve sığınak ortak alandır.',
  },
  { alan: 'catiDubleksSayisi', etiket: 'Çatı dubleksi sayısı', aciklama: '0 ise çatı katı yok.' },
];

/** Boş alan 0 sayılır; geçersiz yazım NaN olur ve plan hatasıyla bildirilir. */
export const blokGirdisi = (f: BlokFormu): BlokGirdisi => {
  const sayi = (m: string) => (m.trim() === '' ? 0 : (tamSayiOku(m) ?? Number.NaN));
  return {
    ad: f.ad,
    zeminBolumTipi: f.zeminBolumTipi,
    bodrumKatSayisi: sayi(f.bodrumKatSayisi),
    bodrumKatBolumSayisi: sayi(f.bodrumKatBolumSayisi),
    zeminBolumSayisi: sayi(f.zeminBolumSayisi),
    normalKatSayisi: sayi(f.normalKatSayisi),
    katBasinaDaire: sayi(f.katBasinaDaire),
    catiDubleksSayisi: sayi(f.catiDubleksSayisi),
    asansorSayisi: sayi(f.asansorSayisi),
    kapaliOtopark: f.kapaliOtopark,
    siginak: f.siginak,
    jenerator: f.jenerator,
  };
};

/**
 * Bir bloğun kat/daire sayıları ve bina özellikleri.
 * `ornekler` verilirse "Şu blokla aynı olsun" seçeneği çıkar: sayılar ve özellikler kopyalanır, ad korunur.
 */
export function BlokAlanlari(props: { form: BlokFormu; onDegisti: (f: BlokFormu) => void; ornekler?: BlokFormu[] }) {
  const { form, onDegisti } = props;
  const yaz = <K extends keyof BlokFormu>(alan: K, deger: BlokFormu[K]) => onDegisti({ ...form, [alan]: deger });
  const ornekler = (props.ornekler ?? []).filter((o) => o.ad.trim() && o.ad !== form.ad);
  return (
    <>
      <Alan etiket="Blok adı">
        <input value={form.ad} onChange={(e) => yaz('ad', e.target.value)} />
      </Alan>
      {ornekler.length > 0 && (
        <Alan etiket="Şu blokla aynı olsun" aciklama="Kat ve daire sayıları ile bina özellikleri kopyalanır.">
          <select
            value=""
            onChange={(e) => {
              const ornek = ornekler.find((o) => o.ad === e.target.value);
              if (ornek) onDegisti({ ...ornek, ad: form.ad });
            }}
          >
            <option value="">Seçin</option>
            {ornekler.map((o) => (
              <option key={o.ad} value={o.ad}>
                {o.ad} Blok
              </option>
            ))}
          </select>
        </Alan>
      )}
      <div className="iki-sutun">
        {BLOK_SAYI_ALANLARI.map(({ alan, etiket, aciklama }) => (
          <Alan key={alan} etiket={etiket} aciklama={aciklama}>
            <input value={form[alan]} inputMode="numeric" onChange={(e) => yaz(alan, e.target.value)} />
          </Alan>
        ))}
      </div>
      <Alan etiket="Zemin kattaki bölümler">
        <select value={form.zeminBolumTipi} onChange={(e) => yaz('zeminBolumTipi', e.target.value as BlokFormu['zeminBolumTipi'])}>
          <option value="daire">Daire</option>
          <option value="dukkan">Dükkan</option>
        </select>
      </Alan>
      <BinaOzellikleriAlanlari
        deger={{ asansorSayisi: form.asansorSayisi, kapaliOtopark: form.kapaliOtopark, siginak: form.siginak, jenerator: form.jenerator }}
        onDegisti={(d) => onDegisti({ ...form, ...d })}
      />
    </>
  );
}

export interface OzellikFormu {
  asansorSayisi: string;
  kapaliOtopark: boolean;
  siginak: boolean;
  jenerator: boolean;
}

/** Asansör (var/yok, sayı), kapalı otopark, sığınak, jeneratör. */
export function BinaOzellikleriAlanlari({ deger, onDegisti }: { deger: OzellikFormu; onDegisti: (d: OzellikFormu) => void }) {
  const asansorVar = (tamSayiOku(deger.asansorSayisi) ?? 0) > 0 || (deger.asansorSayisi.trim() !== '' && deger.asansorSayisi.trim() !== '0');
  return (
    <fieldset className="secenekler bina-ozellikleri">
      <legend>Bina özellikleri</legend>
      <label>
        <input type="checkbox" checked={asansorVar} onChange={(e) => onDegisti({ ...deger, asansorSayisi: e.target.checked ? '1' : '0' })} /> Asansör
      </label>
      {asansorVar && (
        <label className="asansor-sayisi">
          <input
            value={deger.asansorSayisi}
            inputMode="numeric"
            aria-label="Asansör sayısı"
            onChange={(e) => onDegisti({ ...deger, asansorSayisi: e.target.value })}
          />{' '}
          adet
        </label>
      )}
      <label>
        <input type="checkbox" checked={deger.kapaliOtopark} onChange={(e) => onDegisti({ ...deger, kapaliOtopark: e.target.checked })} /> Kapalı
        otopark
      </label>
      <label>
        <input type="checkbox" checked={deger.siginak} onChange={(e) => onDegisti({ ...deger, siginak: e.target.checked })} /> Sığınak
      </label>
      <label>
        <input type="checkbox" checked={deger.jenerator} onChange={(e) => onDegisti({ ...deger, jenerator: e.target.checked })} /> Jeneratör
      </label>
    </fieldset>
  );
}
