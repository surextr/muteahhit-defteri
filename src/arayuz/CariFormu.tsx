import { tlOku, tlYaz } from '../hesap/para';
import { CARI_ROL_ADI, CARI_ROLLERI, type AcilisGirdisi, type CariGirdisi } from '../servisler/cari';
import type { AcilisBakiyesi, Cari, CariRol, Kurus } from '../veri/tipler';
import { Alan } from './bilesenler';

// Cari kartı formu (yeni cari ve düzenleme) ve bakiye gösterimi.

export interface CariFormDurumu {
  ad: string;
  roller: CariRol[];
  telefon: string;
  vergiNo: string;
  adres: string;
  not: string;
}

export const bosCariFormu = (rol?: CariRol): CariFormDurumu => ({
  ad: '',
  roller: rol ? [rol] : [],
  telefon: '',
  vergiNo: '',
  adres: '',
  not: '',
});

export const cariFormu = (c: Cari): CariFormDurumu => ({
  ad: c.ad,
  roller: c.roller,
  telefon: c.telefon ?? '',
  vergiNo: c.vergiNo ?? '',
  adres: c.adres ?? '',
  not: c.not,
});

export const cariGirdisi = (f: CariFormDurumu): CariGirdisi => ({ ...f });

export function CariAlanlari({ form, onDegisti }: { form: CariFormDurumu; onDegisti: (f: CariFormDurumu) => void }) {
  const yaz = (alan: keyof Omit<CariFormDurumu, 'roller'>, deger: string) => onDegisti({ ...form, [alan]: deger });
  const rolDegistir = (rol: CariRol, secili: boolean) =>
    onDegisti({ ...form, roller: secili ? [...form.roller, rol] : form.roller.filter((r) => r !== rol) });
  return (
    <>
      <Alan etiket="Ad / unvan">
        <input value={form.ad} onChange={(e) => yaz('ad', e.target.value)} placeholder="Ahmet Yılmaz (kalıpçı)" autoFocus />
      </Alan>
      <fieldset className="secenekler">
        <legend>Roller</legend>
        {CARI_ROLLERI.map((rol) => (
          <label key={rol}>
            <input type="checkbox" checked={form.roller.includes(rol)} onChange={(e) => rolDegistir(rol, e.target.checked)} />{' '}
            {CARI_ROL_ADI[rol]}
          </label>
        ))}
      </fieldset>
      <p className="alan-aciklama rol-notu">Aynı kişi birden çok rolde olabilir: hem usta hem müşteri gibi. Tek kart açın.</p>
      <div className="iki-sutun">
        <Alan etiket="Telefon">
          <input type="tel" value={form.telefon} onChange={(e) => yaz('telefon', e.target.value)} placeholder="0532 000 00 00" />
        </Alan>
        <Alan etiket="Vergi / TC no">
          <input value={form.vergiNo} inputMode="numeric" onChange={(e) => yaz('vergiNo', e.target.value)} />
        </Alan>
      </div>
      <Alan etiket="Adres">
        <input value={form.adres} onChange={(e) => yaz('adres', e.target.value)} />
      </Alan>
      <Alan etiket="Not">
        <input value={form.not} onChange={(e) => yaz('not', e.target.value)} />
      </Alan>
    </>
  );
}

// ─── Bakiye ────────────────────────────────────────────────────────

/** Artı = borcumuz, eksi = alacağımız. */
export function bakiyeMetni(bakiye: Kurus): { metin: string; sinif: string } {
  if (bakiye > 0) return { metin: `Borcumuz ${tlYaz(bakiye)}`, sinif: 'bakiye-borc' };
  if (bakiye < 0) return { metin: `Alacağımız ${tlYaz(-bakiye)}`, sinif: 'bakiye-alacak' };
  return { metin: 'Hesap kapalı', sinif: 'bakiye-sifir' };
}

export function Bakiye({ tutar }: { tutar: Kurus }) {
  const { metin, sinif } = bakiyeMetni(tutar);
  return <span className={`bakiye ${sinif}`}>{metin}</span>;
}

// ─── Açılış bakiyesi formu ─────────────────────────────────────────

export type AcilisYonu = 'yok' | 'borcumuz' | 'alacagimiz';

export interface AcilisFormu {
  yon: AcilisYonu;
  tutar: string;
  tarih: string;
}

export const acilisFormu = (a: AcilisBakiyesi | null, bugun: string): AcilisFormu =>
  a
    ? { yon: a.tutar > 0 ? 'borcumuz' : 'alacagimiz', tutar: (Math.abs(a.tutar) / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 }), tarih: a.tarih }
    : { yon: 'yok', tutar: '', tarih: bugun };

/** Formdan açılış bakiyesi; 'yok' seçiliyse null. */
export function acilisGirdisi(f: AcilisFormu): { acilis: AcilisGirdisi | null; hatalar: string[] } {
  if (f.yon === 'yok') return { acilis: null, hatalar: [] };
  const tutar = tlOku(f.tutar);
  if (tutar === null || tutar <= 0) return { acilis: null, hatalar: ['Açılış bakiyesi tutarını girin (örn. 25.000 ya da 1.250,50).'] };
  if (!f.tarih) return { acilis: null, hatalar: ['Açılış bakiyesinin tarihini girin.'] };
  return { acilis: { tutar: f.yon === 'borcumuz' ? tutar : -tutar, tarih: f.tarih }, hatalar: [] };
}

export function AcilisAlanlari({ form, onDegisti }: { form: AcilisFormu; onDegisti: (f: AcilisFormu) => void }) {
  return (
    <>
      <Alan etiket="Programa geçmeden önceki durum">
        <select value={form.yon} onChange={(e) => onDegisti({ ...form, yon: e.target.value as AcilisYonu })}>
          <option value="yok">Borç/alacak yok</option>
          <option value="borcumuz">Biz ona borçluyuz</option>
          <option value="alacagimiz">O bize borçlu</option>
        </select>
      </Alan>
      {form.yon !== 'yok' && (
        <div className="iki-sutun">
          <Alan etiket="Tutar (₺)">
            <input value={form.tutar} inputMode="decimal" placeholder="25.000" onChange={(e) => onDegisti({ ...form, tutar: e.target.value })} />
          </Alan>
          <Alan etiket="Tarih">
            <input type="date" value={form.tarih} onChange={(e) => onDegisti({ ...form, tarih: e.target.value })} />
          </Alan>
        </div>
      )}
    </>
  );
}
