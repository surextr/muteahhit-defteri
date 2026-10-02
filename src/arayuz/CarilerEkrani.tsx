import { useEffect, useState } from 'react';
import { cariAramaUyar } from './CariSecici';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import {
  AyniAdliCariUyarisi,
  CARI_ROL_ADI,
  CARI_ROLLERI,
  cariOlustur,
  carileriListele,
  type CariOzeti,
} from '../servisler/cari';
import type { CariRol } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Hatalar, hataMetni } from './bilesenler';
import {
  AcilisAlanlari,
  AyniAdUyarisi,
  Bakiye,
  CariAlanlari,
  acilisFormu,
  acilisGirdisi,
  bosCariFormu,
  cariGirdisi,
  type AcilisFormu,
  type CariFormDurumu,
} from './CariFormu';
import { git } from './rota';


export function CarilerEkrani() {
  const { depo, oturum } = useUygulama();
  const [cariler, setCariler] = useState<CariOzeti[] | null>(null);
  const [arama, setArama] = useState('');
  const [rol, setRol] = useState<CariRol | null>(null);

  useEffect(() => {
    void carileriListele(depo, oturum.firmaId).then(setCariler);
  }, [depo, oturum.firmaId]);

  const gorunen = (cariler ?? []).filter(
    ({ cari }) =>
      (!rol || cari.roller.includes(rol)) &&
      cariAramaUyar(cari, arama),
  );
  const borcumuz = gorunen.reduce((t, c) => t + Math.max(c.bakiye, 0), 0);
  const alacagimiz = gorunen.reduce((t, c) => t + Math.max(-c.bakiye, 0), 0);

  return (
    <>
      <div className="baslik-satiri">
        <h1>Cariler</h1>
        <button type="button" onClick={() => git(rol ? `cariler/yeni/${rol}` : 'cariler/yeni')}>
          + Yeni cari
        </button>
      </div>

      {cariler === null && <p>Yükleniyor…</p>}
      {cariler?.length === 0 && (
        <section className="kart">
          <p>Henüz cari yok.</p>
          <p className="soluk">Usta, tedarikçi, müşteri, arsa sahibi ve ortakları tek listede tutun. Bir kişi birden çok rolde olabilir.</p>
        </section>
      )}

      {cariler && cariler.length > 0 && (
        <>
          <input
            type="search"
            className="arama"
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            placeholder="Ad, telefon veya not ara"
            aria-label="Cari ara"
          />
          <div className="filtreler" role="group" aria-label="Role göre süz">
            <button type="button" aria-pressed={rol === null} onClick={() => setRol(null)}>
              Tümü
            </button>
            {CARI_ROLLERI.map((r) => (
              <button key={r} type="button" aria-pressed={rol === r} onClick={() => setRol(rol === r ? null : r)}>
                {CARI_ROL_ADI[r]}
              </button>
            ))}
          </div>
          <p className="ozet-satiri">
            <span>
              Borcumuz <strong className="bakiye-borc">{tlYaz(borcumuz)}</strong>
            </span>
            <span>
              Alacağımız <strong className="bakiye-alacak">{tlYaz(alacagimiz)}</strong>
            </span>
          </p>
          {gorunen.length === 0 && <p className="soluk">Aramaya uyan cari yok.</p>}
          <ul className="kart-listesi">
            {gorunen.map(({ cari, bakiye }) => (
              <li key={cari.id}>
                <a className="kart kart-baglanti" href={`#/cariler/${cari.id}`}>
                  <span className="baslik-satiri">
                    <strong>{cari.ad}</strong>
                    <Bakiye tutar={bakiye} />
                  </span>
                  <span className="soluk">
                    {cari.roller.map((r) => CARI_ROL_ADI[r]).join(', ')}
                    {cari.telefon && ` · ${cari.telefon}`}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ─── Yeni cari ─────────────────────────────────────────────────────

export function CariYeni({ rol }: { rol?: CariRol }) {
  const { depo, servis } = useUygulama();
  const [form, setForm] = useState<CariFormDurumu>(() => bosCariFormu(rol));
  const [acilis, setAcilis] = useState<AcilisFormu>(() => acilisFormu(null, yerelGun(new Date())));
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);
  const [ayniAdlilar, setAyniAdlilar] = useState<AyniAdliCariUyarisi['mevcutlar'] | null>(null);

  async function kaydet(ayniAdOnayli = false) {
    setAyniAdlilar(null);
    const a = acilisGirdisi(acilis);
    setHatalar(a.hatalar);
    if (a.hatalar.length > 0) return;
    setIslemde(true);
    try {
      const cari = await cariOlustur(depo, servis, cariGirdisi(form), a.acilis, { ayniAdOnayli });
      git(`cariler/${cari.id}`);
    } catch (e) {
      if (e instanceof AyniAdliCariUyarisi) setAyniAdlilar(e.mevcutlar);
      else setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  return (
    <>
      <p>
        <a href="#/cariler">← Cariler</a>
      </p>
      <h1>Yeni cari</h1>
      <section className="kart">
        <CariAlanlari
          form={form}
          onDegisti={(f) => {
            setAyniAdlilar(null);
            setForm(f);
          }}
        />
        <h3>Açılış bakiyesi</h3>
        <p className="soluk">Bu kişiyle programdan önce kalan borç/alacak varsa girin. Sonraki hareketler bakiyeyi kendisi hesaplar.</p>
        <AcilisAlanlari form={acilis} onDegisti={setAcilis} />
        <Hatalar hatalar={hatalar} />
        {ayniAdlilar && (
          <AyniAdUyarisi
            mevcutlar={ayniAdlilar}
            islemde={islemde}
            onOnayla={() => void kaydet(true)}
            onVazgec={() => setAyniAdlilar(null)}
          />
        )}
        <div className="dugmeler">
          <button type="button" onClick={() => void kaydet()} disabled={islemde}>
            {islemde ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <button type="button" className="ikincil" onClick={() => git('cariler')} disabled={islemde}>
            Vazgeç
          </button>
        </div>
      </section>
    </>
  );
}

export const cariRoluMu = (d: string | undefined): d is CariRol => CARI_ROLLERI.includes(d as CariRol);
