import { useEffect, useState } from 'react';
import { uyariEsigi } from '../hesap/ilerleme';
import { yerAdi } from '../servisler/adres';
import { projeIlerlemeOzetleri, type ProjeIlerlemeOzeti } from '../servisler/ilerleme';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { useUygulama, useProjeErisimi } from './baglam';
import { ProjeIlerlemeSatiri } from './Ilerleme';
import { sihirbazTaslagiGetir } from './ProjeSihirbazi';
import { git } from './rota';

export const ARSA_TIPI_ADI = { kat_karsiligi: 'Kat karşılığı', satin_alma: 'Satın alma' } as const;

export function ProjelerEkrani() {
  const { depo, oturum, firma } = useUygulama();
  const erisim = useProjeErisimi();
  const [ilerlemeler, setIlerlemeler] = useState<Map<string, ProjeIlerlemeOzeti>>(new Map());
  const [projeler, setProjeler] = useState<ProjeOzeti[] | null>(null);
  /** Yarım kalan yeni proje taslağının adı ('' : adsız); null: taslak yok. */
  const [taslakAdi, setTaslakAdi] = useState<string | null>(null);

  useEffect(() => {
    void projeleriListele(depo, oturum.firmaId, erisim).then(setProjeler);
    void projeIlerlemeOzetleri(depo, oturum.firmaId, firma.ayarlar.kdvMaliyeteDahil, uyariEsigi(firma.ayarlar)).then(setIlerlemeler);
    void sihirbazTaslagiGetir(depo, oturum.firmaId).then((t) => setTaslakAdi(t ? t.veri.proje.ad.trim() : null));
  }, [depo, oturum.firmaId, firma.ayarlar, erisim]);

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
              {yerAdi(proje) && <span className="soluk">{[proje.mahalle, yerAdi(proje)].filter(Boolean).join(', ')}</span>}
              <span>
                {daireSayisi} daire{dukkanSayisi > 0 && ` · ${dukkanSayisi} dükkan`} · {ARSA_TIPI_ADI[proje.arsaTipi]}
              </span>
              <ProjeIlerlemeSatiri ozet={ilerlemeler.get(proje.id)} />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
