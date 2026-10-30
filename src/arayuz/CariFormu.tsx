import { tlOku, tlYaz } from '../hesap/para';
import { TelefonGirdisi, TutarGirdisi } from './Girdiler';
import { bransKisaAdi, bransOzeti } from '../hesap/brans';
import { BRANSLI_ROLLER, CARI_ROL_ADI, CARI_ROLLERI, bransliMi, type AcilisGirdisi, type AyniAdliCariUyarisi, type CariGirdisi } from '../servisler/cari';
import type { AcilisBakiyesi, Cari, CariRol, Kurus, UstaTipi } from '../veri/tipler';
import { Alan } from './bilesenler';

// Cari kartı formu (yeni cari ve düzenleme) ve bakiye gösterimi.

export interface CariFormDurumu {
  ad: string;
  roller: CariRol[];
  /** Branşlar (usta tipi kimlikleri), ilki ana branş. */
  ustaTipiIdleri: string[];
  yetkili: string;
  telefon: string;
  vergiNo: string;
  adres: string;
  not: string;
}

export const bosCariFormu = (rol?: CariRol): CariFormDurumu => ({
  ad: '',
  roller: rol ? [rol] : [],
  ustaTipiIdleri: [],
  yetkili: '',
  telefon: '',
  vergiNo: '',
  adres: '',
  not: '',
});

export const cariFormu = (c: Cari): CariFormDurumu => ({
  ad: c.ad,
  roller: c.roller,
  ustaTipiIdleri: c.ustaTipiIdleri,
  yetkili: c.yetkili ?? '',
  telefon: c.telefon ?? '',
  vergiNo: c.vergiNo ?? '',
  adres: c.adres ?? '',
  not: c.not,
});

export const cariGirdisi = (f: CariFormDurumu): CariGirdisi => ({ ...f });

/**
 * Listelerde adın altındaki satır: branşlı kartta "Taşeron · Sıvacı, Boyacı · Müşteri", branşsızda roller
 * ("Usta, Tedarikçi"). Branş yazılınca usta/taşeron rolü ayrıca yazılmaz.
 */
export function cariRolMetni(cari: Pick<Cari, 'roller' | 'ustaTipiIdleri'>, tipAdlari: ReadonlyMap<string, string>): string {
  const ozet = bransOzeti(cari, tipAdlari);
  const roller = cari.roller.filter((r) => !ozet || !BRANSLI_ROLLER.includes(r)).map((r) => CARI_ROL_ADI[r]);
  return [ozet, ...roller].filter(Boolean).join(ozet ? ' · ' : ', ');
}

export function CariAlanlari({
  form,
  onDegisti,
  tipler,
}: {
  form: CariFormDurumu;
  onDegisti: (f: CariFormDurumu) => void;
  /** Branş seçimi için usta tipleri (gizliler dahil; gizli olan yalnız zaten seçiliyse görünür). */
  tipler: UstaTipi[];
}) {
  const yaz = (alan: 'ad' | 'yetkili' | 'telefon' | 'vergiNo' | 'adres' | 'not', deger: string) => onDegisti({ ...form, [alan]: deger });
  const rolDegistir = (rol: CariRol, secili: boolean) =>
    onDegisti({ ...form, roller: secili ? [...form.roller, rol] : form.roller.filter((r) => r !== rol) });
  const bransli = bransliMi(form.roller);
  const taseron = form.roller.includes('taseron');
  return (
    <>
      <Alan etiket={taseron ? 'Ad soyad ya da firma unvanı' : 'Ad soyad / unvan'} aciklama={bransli ? 'Mesleği buraya yazmayın; aşağıdan branş seçin.' : undefined}>
        <input value={form.ad} onChange={(e) => yaz('ad', e.target.value)} placeholder={taseron ? 'Yıldız İnşaat Ltd. Şti.' : 'Ahmet Demir'} autoFocus />
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
      {bransli && (
        <BransSecimi tipler={tipler} secili={form.ustaTipiIdleri} onDegisti={(ustaTipiIdleri) => onDegisti({ ...form, ustaTipiIdleri })} />
      )}
      {(taseron || form.yetkili.trim() !== '') && (
        <Alan etiket="Yetkili" aciklama="Firma adına sözleşmeyi imzalayan kişi. Sözleşmede yüklenici bilgisine yazılır.">
          <input value={form.yetkili} onChange={(e) => yaz('yetkili', e.target.value)} placeholder="Mehmet Yıldız" />
        </Alan>
      )}
      <div className="iki-sutun">
        <Alan etiket="Telefon">
          <TelefonGirdisi value={form.telefon} onChange={(v) => yaz('telefon', v)} placeholder="0 532 000 00 00" />
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

// ─── Branş seçimi ──────────────────────────────────────────────────

/**
 * Seçili branşlar etiket olarak durur; ilki ana branştır (sözleşme açarken önce o gelir). Etikete dokunmak onu ana
 * yapar, × kaldırır. Yeni branş açılır listeden eklenir; listede olmayan meslek Ayarlar › Usta tiplerinden açılır.
 */
export function BransSecimi(props: {
  tipler: UstaTipi[];
  secili: string[];
  onDegisti: (ids: string[]) => void;
  /** Varsayılan "Branşlar". */
  baslik?: string;
  /** İlki ana olan listenin adı ("branş", "iş"); açıklamada kullanılır. */
  birim?: string;
}) {
  const birim = props.birim ?? 'branş';
  const ad = (id: string) => props.tipler.find((t) => t.id === id)?.ad;
  const secili = props.secili.filter((id) => ad(id));
  const eklenebilir = props.tipler.filter((t) => !t.gizli && !secili.includes(t.id));
  return (
    <fieldset className="secenekler brans-secimi">
      <legend>{props.baslik ?? 'Branşlar'}</legend>
      {secili.length > 0 && (
        <ul className="brans-etiketleri">
          {secili.map((id, i) => (
            <li key={id} className={i === 0 ? 'ana-brans' : undefined}>
              <button
                type="button"
                className="brans-adi"
                disabled={i === 0}
                title={i === 0 ? `Ana ${birim}` : `Ana ${birim} yap`}
                onClick={() => props.onDegisti([id, ...secili.filter((x) => x !== id)])}
              >
                {bransKisaAdi(ad(id)!)}
                {i === 0 && secili.length > 1 && <small> · ana</small>}
              </button>
              <button
                type="button"
                className="brans-kaldir"
                aria-label={`${bransKisaAdi(ad(id)!)}: kaldır`}
                onClick={() => props.onDegisti(secili.filter((x) => x !== id))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <select
        value=""
        aria-label={`${birim[0]!.toLocaleUpperCase('tr')}${birim.slice(1)} ekle`}
        onChange={(e) => e.target.value && props.onDegisti([...secili, e.target.value])}
        disabled={eklenebilir.length === 0}
      >
        <option value="">{secili.length === 0 ? `${birim[0]!.toLocaleUpperCase('tr')}${birim.slice(1)} seçin…` : `+ ${birim[0]!.toLocaleUpperCase('tr')}${birim.slice(1)} ekle…`}</option>
        {eklenebilir.map((t) => (
          <option key={t.id} value={t.id}>
            {t.ad}
          </option>
        ))}
      </select>
      <p className="alan-aciklama">
        {secili.length > 1 ? `İlk ${birim} ana ${birim}${birim === 'iş' ? 'tir' : 'tır'}; başka birini ana yapmak için adına dokunun. ` : ''}
        Listede olmayan meslek <a href="#/ayarlar/usta-tipleri">Ayarlar › Usta tipleri</a>nden eklenir.
      </p>
    </fieldset>
  );
}

// ─── Aynı adlı cari uyarısı ────────────────────────────────────────

/** Aynı adda kart varken gösterilir; telefonla ayırt edilip onaylanırsa kayıt yapılır. */
export function AyniAdUyarisi(props: {
  mevcutlar: AyniAdliCariUyarisi['mevcutlar'];
  islemde?: boolean;
  onOnayla: () => void;
  onVazgec: () => void;
}) {
  return (
    <div className="mesaj mesaj-uyari" role="alertdialog" aria-labelledby="ayni-ad-baslik">
      <h3 id="ayni-ad-baslik">Bu adla {props.mevcutlar.length === 1 ? 'bir kart' : `${props.mevcutlar.length} kart`} zaten var</h3>
      <ul>
        {props.mevcutlar.map((c) => (
          <li key={c.id}>
            <a href={`#/cariler/${c.id}`}>{c.ad}</a> · {c.telefon ?? 'telefon yok'} ·{' '}
            {c.roller.map((r) => CARI_ROL_ADI[r]).join(', ')}
          </li>
        ))}
      </ul>
      <p>Aynı kişiyse yeni kart açmayın; o kartı düzenleyip rol ekleyin. Farklı kişiyse onaylayın.</p>
      <div className="dugmeler">
        <button type="button" onClick={props.onOnayla} disabled={props.islemde}>
          Farklı kişi, yine de kaydet
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec} disabled={props.islemde}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

// ─── Bakiye ────────────────────────────────────────────────────────

/** Artı = borcumuz, eksi = alacağımız. */
export function bakiyeMetni(bakiye: Kurus): { metin: string; sinif: string } {
  if (bakiye > 0) return { metin: `Borcumuz ${tlYaz(bakiye)}`, sinif: 'bakiye-borc' };
  if (bakiye < 0) return { metin: `Alacağımız ${tlYaz(-bakiye)}`, sinif: 'bakiye-alacak' };
  return { metin: 'Borç / alacak yok', sinif: 'bakiye-sifir' };
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
            <TutarGirdisi value={form.tutar} placeholder="25.000" onChange={(v) => onDegisti({ ...form, tutar: v })} />
          </Alan>
          <Alan etiket="Tarih">
            <input type="date" value={form.tarih} onChange={(e) => onDegisti({ ...form, tarih: e.target.value })} />
          </Alan>
        </div>
      )}
    </>
  );
}
