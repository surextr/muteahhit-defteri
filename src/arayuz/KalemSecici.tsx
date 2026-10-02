import { useState } from 'react';
import { aramaUyar } from '../hesap/metin';

/** Seçilebilir kalem: alt kalemi olmayan kalem. Alt kalemse ana kalemin adı da gelir. */
export interface KalemSecenegi {
  id: string;
  ad: string;
  ustAd: string | null;
}

const tamAd = (k: KalemSecenegi) => (k.ustAd ? `${k.ustAd} › ${k.ad}` : k.ad);

/**
 * Aranabilir kalem seçimi. Arama boşken son kullanılan kalemler başta çıkar, sonra bütün kalemler.
 * Arama Türkçe harfsiz de çalışır ("seramik", "sap" → "Şap"); ana kalem adıyla da bulunur ("ince").
 */
export function KalemSecici(props: {
  secenekler: KalemSecenegi[];
  /** Son kullanılan kalem kimlikleri, en yeni önce. */
  son: string[];
  secili: string;
  onSec: (kalemId: string) => void;
  /** Proje seçilmemişse kalem seçilemez. */
  projeVar: boolean;
}) {
  const [acik, setAcik] = useState(false);
  const [arama, setArama] = useState('');
  const secili = props.secenekler.find((k) => k.id === props.secili);

  if (!props.projeVar) return <p className="secili-cari soluk">Kalem için önce proje seçin</p>;

  if (!acik) {
    return (
      <button type="button" className="secili-cari secici-dugme" onClick={() => setAcik(true)} aria-haspopup="listbox">
        <span>{secili ? tamAd(secili) : <span className="soluk">Kalemsiz</span>}</span>
        <span className="soluk" aria-hidden="true">
          ▾
        </span>
      </button>
    );
  }

  const sec = (id: string) => {
    props.onSec(id);
    setArama('');
    setAcik(false);
  };

  const sonlar = props.son.map((id) => props.secenekler.find((k) => k.id === id)).filter((k): k is KalemSecenegi => !!k);
  const bulunan = arama.trim() ? props.secenekler.filter((k) => aramaUyar(tamAd(k), arama)) : props.secenekler;

  const satir = (k: KalemSecenegi) => (
    <li key={k.id}>
      <button type="button" role="option" aria-selected={k.id === props.secili} aria-pressed={k.id === props.secili} onClick={() => sec(k.id)}>
        <span>{k.ad}</span>
        {k.ustAd && <span className="soluk">{k.ustAd}</span>}
      </button>
    </li>
  );

  return (
    <div className="cari-secici">
      <input type="search" value={arama} placeholder="Kalem ara" aria-label="Kalem ara" onChange={(e) => setArama(e.target.value)} autoFocus />
      <ul className="secim-listesi secim-listesi-uzun" role="listbox" aria-label="Kalemler">
        <li>
          <button type="button" role="option" aria-selected={!props.secili} onClick={() => sec('')}>
            <span>Kalemsiz</span>
          </button>
        </li>
        {!arama.trim() && sonlar.length > 0 && (
          <>
            <li className="secim-baslik">Son kullanılanlar</li>
            {sonlar.map(satir)}
            <li className="secim-baslik">Bütün kalemler</li>
          </>
        )}
        {bulunan.map(satir)}
        {bulunan.length === 0 && <li className="soluk">Bulunamadı.</li>}
      </ul>
      <div className="dugmeler">
        <button type="button" className="ikincil" onClick={() => setAcik(false)}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}
