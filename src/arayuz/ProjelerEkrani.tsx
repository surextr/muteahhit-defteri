import { useEffect, useState } from 'react';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { useUygulama } from './baglam';
import { sihirbazTaslagiGetir } from './ProjeSihirbazi';
import { git } from './rota';

export const ARSA_TIPI_ADI = { kat_karsiligi: 'Kat karşılığı', satin_alma: 'Satın alma' } as const;

export function ProjelerEkrani() {
  const { depo, oturum } = useUygulama();
  const [projeler, setProjeler] = useState<ProjeOzeti[] | null>(null);
  /** Yarım kalan yeni proje taslağının adı ('' : adsız); null: taslak yok. */
  const [taslakAdi, setTaslakAdi] = useState<string | null>(null);

  useEffect(() => {
    void projeleriListele(depo, oturum.firmaId).then(setProjeler);
    void sihirbazTaslagiGetir(depo, oturum.firmaId).then((t) => setTaslakAdi(t ? t.veri.proje.ad.trim() : null));
  }, [depo, oturum.firmaId]);

  return (
    <>
      <div className="baslik-satiri">
        <h1>Projeler</h1>
        <button type="button" onClick={() => git('projeler/yeni')}>
          {taslakAdi === null ? '+ Yeni proje' : 'Taslağa devam et'}
        </button>
      </div>
      {taslakAdi !== null && (
        <a className="kart kart-baglanti taslak-karti" href="#/projeler/yeni">
          <strong>Yarım kalan yeni proje{taslakAdi && `: ${taslakAdi}`}</strong>
          <span className="soluk">Sihirbaza kaldığınız yerden devam etmek için dokunun.</span>
        </a>
      )}
      {projeler === null && <p>Yükleniyor…</p>}
      {projeler?.length === 0 && (
        <section className="kart">
          <p>Henüz proje yok.</p>
          <p className="soluk">Yeni proje sihirbazı binayı bloklarıyla, katlarıyla ve dairelerle birlikte kurar.</p>
        </section>
      )}
      <ul className="kart-listesi">
        {projeler?.map(({ proje, daireSayisi, dukkanSayisi }) => (
          <li key={proje.id}>
            <a className="kart kart-baglanti" href={`#/projeler/${proje.id}`}>
              <strong>{proje.ad}</strong>
              {proje.adres && <span className="soluk">{proje.adres}</span>}
              <span>
                {daireSayisi} daire{dukkanSayisi > 0 && ` · ${dukkanSayisi} dükkan`} · {ARSA_TIPI_ADI[proje.arsaTipi]}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
