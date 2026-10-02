import { useEffect, useState } from 'react';
import { binaPlaniHazirla, projeOlustur, type BinaPlani } from '../servisler/proje';
import { taslakGetir, taslakSil, taslakYaz, type Taslak } from '../servisler/taslak';
import type { Depo } from '../veri/depo';
import { useUygulama } from './baglam';
import { BlokAlanlari, blokFormu, blokGirdisi, type BlokFormu } from './BlokFormu';
import { Hatalar, hataMetni } from './bilesenler';
import { BOS_PROJE, ProjeBilgiAlanlari, projeGirdisi, type ProjeFormu } from './ProjeBilgiFormu';
import { git } from './rota';

// ─── Taslak ────────────────────────────────────────────────────────

interface SihirbazTaslagi {
  adim: 1 | 2 | 3;
  proje: ProjeFormu;
  bloklar: BlokFormu[];
}

/** Taslak biçimi değişirse artırılır; eski taslak sessizce yok sayılır. */
/** 3: parseller, bitiş tarihleri ve blok özellikleri eklendi (şema 6). */
const TASLAK_BICIMI = 3;
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
              <BlokAlanlari
                form={b}
                ornekler={bloklar.filter((_, j) => j !== i)}
                onDegisti={(f) => setBloklar((liste) => liste.map((x, j) => (j === i ? f : x)))}
              />
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
