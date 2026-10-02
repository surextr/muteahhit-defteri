import { useEffect, useState } from 'react';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { adresVerisi, ilceler, iller, mahalleler, VARSAYILAN_IL, type TurkiyeAdres } from '../servisler/adres';
import { ALAN_TANIMLARI, projeHatalari, type ProjeGirdisi } from '../servisler/proje';
import type { Proje, ProjeAlanlari } from '../veri/tipler';
import { Alan } from './bilesenler';

// Proje bilgileri formu: yeni proje sihirbazında ve proje düzenleme ekranında aynıdır.

/** Kullanıcının yazdığı metinler; sayılar kaydederken okunur. */
export interface ProjeFormu {
  ad: string;
  il: string;
  ilce: string;
  mahalle: string;
  /** Açık adres: cadde, sokak, no. */
  adres: string;
  ada: string;
  parsel: string;
  arsaTipi: ProjeGirdisi['arsaTipi'];
  baslangicTarihi: string;
  alanlar: Record<keyof ProjeAlanlari, string>;
}

export const BOS_PROJE: ProjeFormu = {
  ad: '',
  il: VARSAYILAN_IL,
  ilce: '',
  mahalle: '',
  adres: '',
  ada: '',
  parsel: '',
  arsaTipi: 'kat_karsiligi',
  baslangicTarihi: '',
  alanlar: { arsa: '', net: '', brut: '', toplamInsaat: '', satilabilir: '' },
};

const ALAN_ADLARI = Object.keys(ALAN_TANIMLARI) as (keyof ProjeAlanlari)[];

export const projeFormu = (p: Proje): ProjeFormu => ({
  ad: p.ad,
  il: p.il ?? '',
  ilce: p.ilce ?? '',
  mahalle: p.mahalle ?? '',
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
    il: f.il || null,
    ilce: f.ilce || null,
    mahalle: f.mahalle || null,
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
      <AdresSecimi form={form} onDegisti={onDegisti} />
      <h3>Tapu bilgileri</h3>
      <div className="iki-sutun">
        <Alan etiket="Ada">
          <input value={form.ada} onChange={(e) => yaz('ada', e.target.value)} inputMode="numeric" />
        </Alan>
        <Alan etiket="Parsel">
          <input value={form.parsel} onChange={(e) => yaz('parsel', e.target.value)} inputMode="numeric" />
        </Alan>
      </div>
      <Alan etiket={ALAN_TANIMLARI.arsa.etiket} aciklama={ALAN_TANIMLARI.arsa.aciklama}>
        <input
          value={form.alanlar.arsa}
          inputMode="decimal"
          onChange={(e) => onDegisti({ ...form, alanlar: { ...form.alanlar, arsa: e.target.value } })}
        />
      </Alan>
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
      {ALAN_ADLARI.filter((ad) => ad !== 'arsa').map((ad) => (
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

// ─── İl / ilçe / mahalle ───────────────────────────────────────────

/** Listeden seçilir; il değişince ilçe ve mahalle, ilçe değişince mahalle sıfırlanır. */
function AdresSecimi({ form, onDegisti }: { form: ProjeFormu; onDegisti: (f: ProjeFormu) => void }) {
  const [veri, setVeri] = useState<TurkiyeAdres | null>(null);
  const [hata, setHata] = useState(false);

  useEffect(() => {
    let iptal = false;
    adresVerisi()
      .then((v) => !iptal && setVeri(v))
      .catch(() => !iptal && setHata(true));
    return () => {
      iptal = true;
    };
  }, []);

  if (hata) {
    return (
      <Alan etiket="Adres" aciklama="İl/ilçe listesi yüklenemedi; adresi elle yazın.">
        <input value={form.adres} onChange={(e) => onDegisti({ ...form, adres: e.target.value })} />
      </Alan>
    );
  }
  if (!veri) return <p className="soluk">Adres listesi yükleniyor…</p>;

  const ilceListesi = ilceler(veri, form.il || null);
  const mahalleListesi = mahalleler(veri, form.il || null, form.ilce || null);
  // Eski kayıtta listede olmayan bir değer varsa kaybolmasın diye seçenek olarak eklenir.
  const ekle = (liste: string[], deger: string) => (deger && !liste.includes(deger) ? [deger, ...liste] : liste);

  return (
    <>
      <div className="iki-sutun">
        <Alan etiket="İl">
          <select value={form.il} onChange={(e) => onDegisti({ ...form, il: e.target.value, ilce: '', mahalle: '' })}>
            <option value="">Seçin</option>
            {ekle(iller(veri), form.il).map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Alan>
        <Alan etiket="İlçe">
          <select value={form.ilce} disabled={!form.il} onChange={(e) => onDegisti({ ...form, ilce: e.target.value, mahalle: '' })}>
            <option value="">Seçin</option>
            {ekle(ilceListesi, form.ilce).map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Alan>
      </div>
      <Alan etiket="Mahalle">
        <select value={form.mahalle} disabled={!form.ilce} onChange={(e) => onDegisti({ ...form, mahalle: e.target.value })}>
          <option value="">{form.ilce ? 'Seçin' : 'Önce ilçe seçin'}</option>
          {ekle(mahalleListesi, form.mahalle).map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Alan>
      <Alan etiket="Açık adres" aciklama="Cadde, sokak, kapı no.">
        <input value={form.adres} onChange={(e) => onDegisti({ ...form, adres: e.target.value })} />
      </Alan>
    </>
  );
}
