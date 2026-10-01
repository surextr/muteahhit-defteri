import type { ReactNode } from 'react';
import { useUygulama } from './baglam';

const MENU = [
  { yol: 'projeler', ad: 'Projeler', simge: '🏗️' },
  { yol: 'cariler', ad: 'Cariler', simge: '👥' },
  { yol: 'ayarlar', ad: 'Ayarlar', simge: '⚙️' },
] as const;

/** Üst başlık, içerik ve telefonda başparmakla ulaşılan alt menü. */
export function Kabuk({ aktif, children }: { aktif: string; children: ReactNode }) {
  const { firma } = useUygulama();
  return (
    <>
      <header className="ust">
        <span className="ust-firma">{firma.ad}</span>
      </header>
      <main className="sayfa">{children}</main>
      <nav className="alt-menu" aria-label="Ana menü">
        {MENU.map((m) => (
          <a key={m.yol} href={`#/${m.yol}`} aria-current={aktif === m.yol ? 'page' : undefined}>
            <span aria-hidden="true">{m.simge}</span>
            {m.ad}
          </a>
        ))}
      </nav>
    </>
  );
}
