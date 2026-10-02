import { useState } from 'react';
import { CARI_ROL_ADI, type CariOzeti } from '../servisler/cari';
import { aramaUyar, rakamlar } from '../hesap/metin';
import type { Cari, CariRol } from '../veri/tipler';
import { Bakiye } from './CariFormu';

/**
 * Ad ve nota Türkçe harfsiz de uyar ("sahin" → "Şahin"); telefon rakamlarla aranır ("0532 111").
 */
export function cariAramaUyar(cari: Pick<Cari, 'ad' | 'telefon' | 'not'>, arama: string): boolean {
  if (!arama.trim()) return true;
  if (aramaUyar(`${cari.ad} ${cari.not}`, arama)) return true;
  const r = rakamlar(arama);
  return r.length >= 3 && rakamlar(cari.telefon ?? '').includes(r);
}

/**
 * Aranabilir cari seçimi. `bosEtiket` verilirse "cari yok" seçeneği de çıkar (örn. carisiz peşin gider).
 * Öncelikli roldekiler (örn. tedarikçi, usta) önce listelenir.
 */
export function CariSecici(props: {
  cariler: CariOzeti[];
  secili: string | null;
  onSec: (cariId: string | null) => void;
  oncelikli?: CariRol[];
  bosEtiket?: string;
  /** Yeni cari açma bağlantısı (taslak saklandığı için form kaybolmaz). */
  yeniCariYolu?: string;
}) {
  const [arama, setArama] = useState('');
  const [acik, setAcik] = useState(props.secili === null && !props.bosEtiket);
  const secili = props.cariler.find((c) => c.cari.id === props.secili);

  if (!acik) {
    return (
      <div className="secili-cari">
        <div>
          <strong>{secili ? secili.cari.ad : (props.bosEtiket ?? 'Seçilmedi')}</strong>
          {secili && (
            <div className="soluk">
              <Bakiye tutar={secili.bakiye} />
            </div>
          )}
        </div>
        <button type="button" className="ikincil" onClick={() => setAcik(true)}>
          Değiştir
        </button>
      </div>
    );
  }

  const oncelik = (c: CariOzeti) => (props.oncelikli?.some((r) => c.cari.roller.includes(r)) ? 0 : 1);
  const bulunan = props.cariler
    .filter(({ cari }) => cariAramaUyar(cari, arama))
    .sort((a, b) => oncelik(a) - oncelik(b))
    .slice(0, 8);

  const sec = (id: string | null) => {
    props.onSec(id);
    setArama('');
    setAcik(false);
  };

  return (
    <div className="cari-secici">
      <input
        type="search"
        value={arama}
        placeholder="Cari ara: ad ya da telefon"
        aria-label="Cari ara"
        onChange={(e) => setArama(e.target.value)}
        autoFocus
      />
      <ul className="secim-listesi">
        {props.bosEtiket && (
          <li>
            <button type="button" onClick={() => sec(null)}>
              <span>{props.bosEtiket}</span>
            </button>
          </li>
        )}
        {bulunan.map(({ cari }) => (
          <li key={cari.id}>
            <button type="button" aria-pressed={cari.id === props.secili} onClick={() => sec(cari.id)}>
              <span>{cari.ad}</span>
              <span className="soluk">{cari.roller.map((r) => CARI_ROL_ADI[r]).join(', ')}</span>
            </button>
          </li>
        ))}
        {bulunan.length === 0 && <li className="soluk">Bulunamadı.</li>}
      </ul>
      <div className="dugmeler">
        {props.yeniCariYolu && (
          <a className="dugme ikincil" href={`#/${props.yeniCariYolu}`}>
            + Yeni cari
          </a>
        )}
        {(props.secili !== null || props.bosEtiket) && (
          <button type="button" className="ikincil" onClick={() => setAcik(false)}>
            Vazgeç
          </button>
        )}
      </div>
    </div>
  );
}
