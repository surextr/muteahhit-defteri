import type { ReactNode } from 'react';
import type { SiralamaYonu } from './ekran';

/** Sıralanabilir tablo başlığı. */
export function SiraBasligi<K extends string>(props: {
  anahtar: K;
  sira: { anahtar: K; yon: SiralamaYonu };
  onSec: (k: K, ilkYon?: SiralamaYonu) => void;
  ilkYon?: SiralamaYonu;
  sag?: boolean;
  children: ReactNode;
}) {
  const aktif = props.sira.anahtar === props.anahtar;
  return (
    <th className={props.sag ? 'sag' : undefined} aria-sort={aktif ? (props.sira.yon === 'artan' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="sira-dugmesi" onClick={() => props.onSec(props.anahtar, props.ilkYon)}>
        {props.children}
        <span aria-hidden="true" className="sira-ok">
          {aktif ? (props.sira.yon === 'artan' ? '▲' : '▼') : ''}
        </span>
      </button>
    </th>
  );
}

/** Liste ve seçilen kaydın ayrıntısı yan yana (bilgisayar). */
export function ListeDetay({ liste, detay }: { liste: ReactNode; detay: ReactNode }) {
  return (
    <div className="liste-detay">
      <div className="liste-tarafi">{liste}</div>
      <div className="detay-tarafi">{detay}</div>
    </div>
  );
}
