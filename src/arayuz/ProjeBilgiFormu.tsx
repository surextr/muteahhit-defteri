import { sayiOku, sayiYaz } from '../hesap/sayi';
import { ALAN_TANIMLARI, projeHatalari, type ProjeGirdisi } from '../servisler/proje';
import type { Proje, ProjeAlanlari } from '../veri/tipler';
import { Alan } from './bilesenler';

// Proje bilgileri formu: yeni proje sihirbazında ve proje düzenleme ekranında aynıdır.

/** Kullanıcının yazdığı metinler; sayılar kaydederken okunur. */
export interface ProjeFormu {
  ad: string;
  adres: string;
  ada: string;
  parsel: string;
  arsaTipi: ProjeGirdisi['arsaTipi'];
  baslangicTarihi: string;
  alanlar: Record<keyof ProjeAlanlari, string>;
}

export const BOS_PROJE: ProjeFormu = {
  ad: '',
  adres: '',
  ada: '',
  parsel: '',
  arsaTipi: 'kat_karsiligi',
  baslangicTarihi: '',
  alanlar: { net: '', brut: '', toplamInsaat: '', satilabilir: '' },
};

const ALAN_ADLARI = Object.keys(ALAN_TANIMLARI) as (keyof ProjeAlanlari)[];

export const projeFormu = (p: Proje): ProjeFormu => ({
  ad: p.ad,
  adres: p.adres,
  ada: p.ada,
  parsel: p.parsel,
  arsaTipi: p.arsaTipi,
  baslangicTarihi: p.baslangicTarihi ?? '',
  alanlar: Object.fromEntries(ALAN_ADLARI.map((ad) => [ad, sayiYaz(p.alanlar[ad])])) as ProjeFormu['alanlar'],
});

export function projeGirdisi(f: ProjeFormu): { girdi: ProjeGirdisi; hatalar: string[] } {
  const hatalar: string[] = [];
  const alanlar = {} as ProjeAlanlari;
  for (const ad of ALAN_ADLARI) {
    const metin = f.alanlar[ad].trim();
    const sayi = metin === '' ? null : sayiOku(metin);
    if (metin !== '' && sayi === null) hatalar.push(`${ALAN_TANIMLARI[ad].etiket}: "${metin}" geçerli bir sayı değil.`);
    alanlar[ad] = sayi;
  }
  const girdi: ProjeGirdisi = {
    ad: f.ad,
    adres: f.adres.trim(),
    ada: f.ada.trim(),
    parsel: f.parsel.trim(),
    arsaTipi: f.arsaTipi,
    baslangicTarihi: f.baslangicTarihi || null,
    alanlar,
  };
  return { girdi, hatalar: [...projeHatalari(girdi), ...hatalar] };
}

export function ProjeBilgiAlanlari({ form, onDegisti }: { form: ProjeFormu; onDegisti: (f: ProjeFormu) => void }) {
  const yaz = (alan: keyof Omit<ProjeFormu, 'alanlar'>, deger: string) => onDegisti({ ...form, [alan]: deger });
  return (
    <>
      <Alan etiket="Proje adı">
        <input value={form.ad} onChange={(e) => yaz('ad', e.target.value)} autoFocus />
      </Alan>
      <Alan etiket="Adres">
        <input value={form.adres} onChange={(e) => yaz('adres', e.target.value)} />
      </Alan>
      <div className="iki-sutun">
        <Alan etiket="Ada">
          <input value={form.ada} onChange={(e) => yaz('ada', e.target.value)} inputMode="numeric" />
        </Alan>
        <Alan etiket="Parsel">
          <input value={form.parsel} onChange={(e) => yaz('parsel', e.target.value)} inputMode="numeric" />
        </Alan>
      </div>
      <Alan etiket="Arsa tipi">
        <select value={form.arsaTipi} onChange={(e) => yaz('arsaTipi', e.target.value)}>
          <option value="kat_karsiligi">Kat karşılığı</option>
          <option value="satin_alma">Satın alma</option>
        </select>
      </Alan>
      <Alan etiket="Başlangıç tarihi">
        <input type="date" value={form.baslangicTarihi} onChange={(e) => yaz('baslangicTarihi', e.target.value)} />
      </Alan>
      <h3>Alanlar</h3>
      <p className="soluk">Bilinmiyorsa boş bırakın, sonra girilebilir.</p>
      {ALAN_ADLARI.map((ad) => (
        <Alan key={ad} etiket={ALAN_TANIMLARI[ad].etiket} aciklama={ALAN_TANIMLARI[ad].aciklama}>
          <input
            value={form.alanlar[ad]}
            inputMode="decimal"
            onChange={(e) => onDegisti({ ...form, alanlar: { ...form.alanlar, [ad]: e.target.value } })}
          />
        </Alan>
      ))}
    </>
  );
}
