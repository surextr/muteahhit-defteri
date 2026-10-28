import type { ReactNode } from 'react';
import { ROL_ADI } from '../servisler/kullanici';
import type { Yetki } from '../hesap/yetki';
import { useUygulama, useYetki } from './baglam';
import { durumMetni } from './Bulut';

const MENU: { yol: string; ad: string; simge: string; yetki?: Yetki }[] = [
  { yol: 'projeler', ad: 'Projeler', simge: '🏗️' },
  { yol: 'cariler', ad: 'Cariler', simge: '👥', yetki: 'cari' },
  { yol: 'kayit', ad: 'Kayıt', simge: '＋' },
  { yol: 'hesaplar', ad: 'Kasa/Banka', simge: '🏦', yetki: 'kasa' },
  { yol: 'ayarlar', ad: 'Ayarlar', simge: '⚙️' },
];

/** Üst başlık, içerik ve telefonda başparmakla ulaşılan alt menü. */
export function Kabuk({ aktif, children }: { aktif: string; children: ReactNode }) {
  const { firma, kullanici, bulut } = useUygulama();
  const yetki = useYetki();
  return (
    <>
      <header className="ust">
        <span className="ust-firma">
          {firma.ad}
          {bulut.durum.tur !== 'bagli_degil' && (
            <a href="#/ayarlar" className={`bulut-simge bulut-${bulut.durum.tur}`} title={durumMetni(bulut.durum)} aria-label={durumMetni(bulut.durum)}>
              ☁
            </a>
          )}
        </span>
        <a className="ust-kullanici" href="#/ayarlar/kullanicilar" title="Bu cihazı kullanan kişi">
          {kullanici.ad}
          {kullanici.rol && <span className="soluk-acik"> · {ROL_ADI[kullanici.rol]}</span>}
        </a>
      </header>
      <main className="sayfa">{children}</main>
      <nav className="alt-menu" aria-label="Ana menü">
        {MENU.filter((m) => !m.yetki || yetki(m.yetki)).map((m) => (
          <a key={m.yol} href={`#/${m.yol}`} aria-current={aktif === m.yol ? 'page' : undefined}>
            <span aria-hidden="true">{m.simge}</span>
            {m.ad}
          </a>
        ))}
      </nav>
    </>
  );
}
