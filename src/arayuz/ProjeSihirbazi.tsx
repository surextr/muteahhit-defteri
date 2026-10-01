import { useState } from 'react';
import { sayiOku, tamSayiOku } from '../hesap/sayi';
import {
  ALAN_TANIMLARI,
  BOS_BLOK,
  binaPlaniHazirla,
  projeHatalari,
  projeOlustur,
  type BinaPlani,
  type BlokGirdisi,
  type ProjeGirdisi,
} from '../servisler/proje';
import type { ProjeAlanlari } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { git } from './rota';

// ─── Form durumu (kullanıcının yazdığı metinler) ────────────────────

type SayiAlani = Exclude<keyof BlokGirdisi, 'ad' | 'zeminBolumTipi'>;
type BlokFormu = Record<SayiAlani, string> & Pick<BlokGirdisi, 'ad' | 'zeminBolumTipi'>;

const blokFormu = (ad: string): BlokFormu => ({
  ad,
  zeminBolumTipi: BOS_BLOK.zeminBolumTipi,
  bodrumKatSayisi: String(BOS_BLOK.bodrumKatSayisi),
  bodrumKatBolumSayisi: String(BOS_BLOK.bodrumKatBolumSayisi),
  zeminBolumSayisi: String(BOS_BLOK.zeminBolumSayisi),
  normalKatSayisi: String(BOS_BLOK.normalKatSayisi),
  katBasinaDaire: String(BOS_BLOK.katBasinaDaire),
  catiDubleksSayisi: String(BOS_BLOK.catiDubleksSayisi),
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

/** Boş alan 0 sayılır; geçersiz yazım NaN olur ve sihirbaz hatasıyla bildirilir. */
const blokGirdisi = (f: BlokFormu): BlokGirdisi => {
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
  };
};

interface ProjeFormu {
  ad: string;
  adres: string;
  ada: string;
  parsel: string;
  arsaTipi: ProjeGirdisi['arsaTipi'];
  baslangicTarihi: string;
  alanlar: Record<keyof ProjeAlanlari, string>;
}

const BOS_PROJE: ProjeFormu = {
  ad: '',
  adres: '',
  ada: '',
  parsel: '',
  arsaTipi: 'kat_karsiligi',
  baslangicTarihi: '',
  alanlar: { net: '', brut: '', toplamInsaat: '', satilabilir: '' },
};

function projeGirdisi(f: ProjeFormu): { girdi: ProjeGirdisi; hatalar: string[] } {
  const hatalar: string[] = [];
  const alanlar = {} as ProjeAlanlari;
  for (const ad of Object.keys(ALAN_TANIMLARI) as (keyof ProjeAlanlari)[]) {
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

// ─── Sihirbaz ──────────────────────────────────────────────────────

export function ProjeSihirbazi() {
  const { depo, servis } = useUygulama();
  const [adim, setAdim] = useState<1 | 2 | 3>(1);
  const [proje, setProje] = useState<ProjeFormu>(BOS_PROJE);
  const [bloklar, setBloklar] = useState<BlokFormu[]>([blokFormu('A')]);
  const [plan, setPlan] = useState<BinaPlani | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);

  const projeDegistir = (alan: keyof Omit<ProjeFormu, 'alanlar'>, deger: string) =>
    setProje((p) => ({ ...p, [alan]: deger }));
  const blokDegistir = (i: number, alan: keyof BlokFormu, deger: string) =>
    setBloklar((liste) => liste.map((b, j) => (j === i ? { ...b, [alan]: deger } : b)));

  function ileri1() {
    const { hatalar } = projeGirdisi(proje);
    setHatalar(hatalar);
    if (hatalar.length === 0) setAdim(2);
  }

  function ileri2() {
    const sonuc = binaPlaniHazirla(bloklar.map(blokGirdisi));
    setHatalar(sonuc.hatalar);
    setPlan(sonuc.plan);
    if (sonuc.plan) setAdim(3);
  }

  async function olustur() {
    setIslemde(true);
    setHatalar([]);
    try {
      const p = await projeOlustur(depo, servis, projeGirdisi(proje).girdi, bloklar.map(blokGirdisi));
      git(`projeler/${p.id}`);
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  const geri = (hedef: 1 | 2) => {
    setHatalar([]);
    setAdim(hedef);
  };

  return (
    <>
      <h1>Yeni proje</h1>
      <ol className="adimlar" aria-label="Sihirbaz adımları">
        {['Proje bilgileri', 'Bina', 'Önizleme'].map((ad, i) => (
          <li key={ad} aria-current={adim === i + 1 ? 'step' : undefined}>
            {ad}
          </li>
        ))}
      </ol>

      {adim === 1 && (
        <section className="kart">
          <Alan etiket="Proje adı">
            <input value={proje.ad} onChange={(e) => projeDegistir('ad', e.target.value)} autoFocus />
          </Alan>
          <Alan etiket="Adres">
            <input value={proje.adres} onChange={(e) => projeDegistir('adres', e.target.value)} />
          </Alan>
          <div className="iki-sutun">
            <Alan etiket="Ada">
              <input value={proje.ada} onChange={(e) => projeDegistir('ada', e.target.value)} inputMode="numeric" />
            </Alan>
            <Alan etiket="Parsel">
              <input value={proje.parsel} onChange={(e) => projeDegistir('parsel', e.target.value)} inputMode="numeric" />
            </Alan>
          </div>
          <Alan etiket="Arsa tipi">
            <select value={proje.arsaTipi} onChange={(e) => projeDegistir('arsaTipi', e.target.value)}>
              <option value="kat_karsiligi">Kat karşılığı</option>
              <option value="satin_alma">Satın alma</option>
            </select>
          </Alan>
          <Alan etiket="Başlangıç tarihi">
            <input type="date" value={proje.baslangicTarihi} onChange={(e) => projeDegistir('baslangicTarihi', e.target.value)} />
          </Alan>
          <h3>Alanlar</h3>
          <p className="soluk">Bilinmiyorsa boş bırakın, sonra girilebilir.</p>
          {(Object.keys(ALAN_TANIMLARI) as (keyof ProjeAlanlari)[]).map((ad) => (
            <Alan key={ad} etiket={ALAN_TANIMLARI[ad].etiket} aciklama={ALAN_TANIMLARI[ad].aciklama}>
              <input
                value={proje.alanlar[ad]}
                inputMode="decimal"
                onChange={(e) => setProje((p) => ({ ...p, alanlar: { ...p.alanlar, [ad]: e.target.value } }))}
              />
            </Alan>
          ))}
          <Hatalar hatalar={hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={ileri1}>
              İleri
            </button>
            <button type="button" className="ikincil" onClick={() => git('projeler')}>
              Vazgeç
            </button>
          </div>
        </section>
      )}

      {adim === 2 && (
        <>
          {bloklar.map((b, i) => (
            <section className="kart" key={i}>
              <div className="baslik-satiri">
                <h2>{b.ad.trim() || '?'} Blok</h2>
                {bloklar.length > 1 && (
                  <button
                    type="button"
                    className="ikincil"
                    onClick={() => setBloklar((liste) => liste.filter((_, j) => j !== i))}
                  >
                    Bloğu çıkar
                  </button>
                )}
              </div>
              <Alan etiket="Blok adı">
                <input value={b.ad} onChange={(e) => blokDegistir(i, 'ad', e.target.value)} />
              </Alan>
              <div className="iki-sutun">
                {BLOK_SAYI_ALANLARI.map(({ alan, etiket, aciklama }) => (
                  <Alan key={alan} etiket={etiket} aciklama={aciklama}>
                    <input value={b[alan]} inputMode="numeric" onChange={(e) => blokDegistir(i, alan, e.target.value)} />
                  </Alan>
                ))}
              </div>
              <Alan etiket="Zemin kattaki bölümler">
                <select value={b.zeminBolumTipi} onChange={(e) => blokDegistir(i, 'zeminBolumTipi', e.target.value)}>
                  <option value="daire">Daire</option>
                  <option value="dukkan">Dükkan</option>
                </select>
              </Alan>
            </section>
          ))}
          <button
            type="button"
            className="ikincil genis"
            onClick={() => setBloklar((liste) => [...liste, blokFormu(String.fromCharCode(65 + liste.length))])}
          >
            + Blok ekle
          </button>
          <Hatalar hatalar={hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={ileri2}>
              Önizle
            </button>
            <button type="button" className="ikincil" onClick={() => geri(1)}>
              Geri
            </button>
          </div>
        </>
      )}

      {adim === 3 && plan && (
        <>
          <section className="kart">
            <h2>{proje.ad.trim()}</h2>
            <p>
              <strong>{plan.daireSayisi}</strong> daire
              {plan.dukkanSayisi > 0 && (
                <>
                  , <strong>{plan.dukkanSayisi}</strong> dükkan
                </>
              )}{' '}
              oluşturulacak. Takip başlıkları (anlaşma, ruhsat, kaba, ince, iskan, satış) da eklenecek.
            </p>
            <p className="soluk">Dairelerin oda tipi ve m² bilgileri sonra proje ekranından girilir.</p>
          </section>
          {plan.bloklar.map((b) => (
            <section className="kart" key={b.ad}>
              <h2>{b.ad} Blok</h2>
              <ul className="kat-listesi">
                {[...b.katlar].reverse().map((k) => (
                  <li key={k.ad}>
                    <span className="kat-adi">{k.ad}</span>
                    <span>{k.bolumler.length === 0 ? <em className="soluk">bölüm yok</em> : k.bolumler.map((x) => x.no).join(', ')}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <Hatalar hatalar={hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={olustur} disabled={islemde}>
              {islemde ? 'Oluşturuluyor…' : 'Projeyi oluştur'}
            </button>
            <button type="button" className="ikincil" onClick={() => geri(2)} disabled={islemde}>
              Geri
            </button>
          </div>
        </>
      )}
    </>
  );
}
