import { useEffect, useState } from 'react';
import { tamSayiOku } from '../hesap/sayi';
import { BOS_BLOK, binaPlaniHazirla, projeOlustur, type BinaPlani, type BlokGirdisi } from '../servisler/proje';
import { taslakGetir, taslakSil, taslakYaz, type Taslak } from '../servisler/taslak';
import type { Depo } from '../veri/depo';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { BOS_PROJE, ProjeBilgiAlanlari, projeGirdisi, type ProjeFormu } from './ProjeBilgiFormu';
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

// ─── Taslak ────────────────────────────────────────────────────────

interface SihirbazTaslagi {
  adim: 1 | 2 | 3;
  proje: ProjeFormu;
  bloklar: BlokFormu[];
}

/** Taslak biçimi değişirse artırılır; eski taslak sessizce yok sayılır. */
/** 2: proje formuna il/ilçe/mahalle ve arsa alanı eklendi (şema 5). */
const TASLAK_BICIMI = 2;
const BOS_TASLAK: SihirbazTaslagi = { adim: 1, proje: BOS_PROJE, bloklar: [blokFormu('A')] };
const bosMu = (t: SihirbazTaslagi) => JSON.stringify(t) === JSON.stringify(BOS_TASLAK);

export const sihirbazTaslagiGetir = (depo: Depo, firmaId: string): Promise<Taslak<SihirbazTaslagi> | null> =>
  taslakGetir<SihirbazTaslagi>(depo, firmaId, 'projeSihirbazi', TASLAK_BICIMI);

const zamanYaz = (z: string) =>
  new Date(z).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

// ─── Sihirbaz ──────────────────────────────────────────────────────

export function ProjeSihirbazi() {
  const { depo, servis, oturum } = useUygulama();
  const [taslak, setTaslak] = useState<SihirbazTaslagi>(BOS_TASLAK);
  /** Kayıtlı taslak okunana kadar yazma yapılmaz; yoksa boş form taslağın üstüne yazılırdı. */
  const [okundu, setOkundu] = useState(false);
  const [devamZamani, setDevamZamani] = useState<string | null>(null);
  const [plan, setPlan] = useState<BinaPlani | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);
  const [vazgeciliyor, setVazgeciliyor] = useState(false);
  const { adim, proje, bloklar } = taslak;

  useEffect(() => {
    let iptal = false;
    void sihirbazTaslagiGetir(depo, oturum.firmaId).then((kayitli) => {
      if (iptal) return;
      if (kayitli) {
        let t = kayitli.veri;
        // Önizleme adımı plandan çizilir; plan kurulamıyorsa bina adımına dönülür.
        if (t.adim === 3) {
          const sonuc = binaPlaniHazirla(t.bloklar.map(blokGirdisi));
          if (sonuc.plan) setPlan(sonuc.plan);
          else t = { ...t, adim: 2 };
        }
        setTaslak(t);
        setDevamZamani(kayitli.zaman);
      }
      setOkundu(true);
    });
    return () => {
      iptal = true;
    };
  }, [depo, oturum.firmaId]);

  // Her değişiklik hemen saklanır; boş form taslak sayılmaz.
  useEffect(() => {
    if (!okundu || islemde) return;
    void (bosMu(taslak)
      ? taslakSil(depo, oturum.firmaId, 'projeSihirbazi')
      : taslakYaz(depo, oturum.firmaId, 'projeSihirbazi', TASLAK_BICIMI, taslak));
  }, [taslak, okundu, islemde, depo, oturum.firmaId]);

  const setAdim = (adim: SihirbazTaslagi['adim']) => setTaslak((t) => ({ ...t, adim }));
  const setProje = (proje: ProjeFormu) => setTaslak((t) => ({ ...t, proje }));
  const setBloklar = (f: (liste: BlokFormu[]) => BlokFormu[]) => setTaslak((t) => ({ ...t, bloklar: f(t.bloklar) }));
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
      await taslakSil(depo, oturum.firmaId, 'projeSihirbazi');
      git(`projeler/${p.id}`);
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  async function vazgec() {
    setIslemde(true);
    await taslakSil(depo, oturum.firmaId, 'projeSihirbazi');
    git('projeler');
  }

  const geri = (hedef: 1 | 2) => {
    setHatalar([]);
    setAdim(hedef);
  };

  const vazgecDugmesi = (
    <button type="button" className="ikincil" onClick={() => setVazgeciliyor(true)} disabled={islemde}>
      Vazgeç
    </button>
  );

  const vazgecOnayi = vazgeciliyor && (
    <div className="mesaj mesaj-uyari" role="alertdialog" aria-labelledby="vazgec-baslik">
      <h3 id="vazgec-baslik">Yeni proje taslağı silinsin mi?</h3>
      <p>Bu sihirbazda girdiğiniz bütün bilgiler silinir. Bu işlem geri alınamaz.</p>
      <div className="dugmeler">
        <button type="button" className="tehlikeli" onClick={() => void vazgec()} disabled={islemde}>
          Evet, taslağı sil
        </button>
        <button type="button" className="ikincil" onClick={() => setVazgeciliyor(false)} disabled={islemde}>
          Hayır, devam et
        </button>
      </div>
    </div>
  );

  if (!okundu) return <p>Yükleniyor…</p>;

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

      {devamZamani && (
        <p className="mesaj mesaj-not" role="status">
          Kaldığınız yerden devam ediliyor (son değişiklik: {zamanYaz(devamZamani)}).
        </p>
      )}

      {adim === 1 && (
        <section className="kart">
          <ProjeBilgiAlanlari form={proje} onDegisti={setProje} />
          <Hatalar hatalar={hatalar} />
          {vazgecOnayi}
          <div className="dugmeler">
            <button type="button" onClick={ileri1}>
              İleri
            </button>
            {vazgecDugmesi}
          </div>
          <p className="mesaj-not">Girdikleriniz bu cihazda taslak olarak saklanır; başka ekrana geçip dönebilirsiniz.</p>
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
          {vazgecOnayi}
          <div className="dugmeler">
            <button type="button" onClick={ileri2}>
              Önizle
            </button>
            <button type="button" className="ikincil" onClick={() => geri(1)}>
              Geri
            </button>
            {vazgecDugmesi}
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
          {vazgecOnayi}
          <div className="dugmeler">
            <button type="button" onClick={olustur} disabled={islemde}>
              {islemde ? 'Oluşturuluyor…' : 'Projeyi oluştur'}
            </button>
            <button type="button" className="ikincil" onClick={() => geri(2)} disabled={islemde}>
              Geri
            </button>
            {vazgecDugmesi}
          </div>
        </>
      )}
    </>
  );
}
