import { useEffect, useState } from 'react';

// Sayfa adresi #/projeler/123 biçiminde tutulur: statik sunucuda ve internetsiz
// çalışırken sunucuya gitmeden açılır, geri tuşu çalışır.

const oku = (): string[] => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

/** Uygulama içindeki geçiş sayısı: geri gidilecek bir önceki ekran var mı (doğrudan açılan adreste yok). */
let gecis = 0;
if (typeof window !== 'undefined') window.addEventListener('hashchange', () => gecis++);

/** Bir önceki ekrana döner; uygulamada geçmiş yoksa `yedek` adrese gider. */
export function geriGit(yedek: string): void {
  if (gecis > 0) {
    gecis -= 2;
    window.history.back();
  } else git(yedek);
}

export function git(yol: string): void {
  window.location.hash = `/${yol}`;
}

export function useRota(): string[] {
  const [yol, setYol] = useState(oku);
  useEffect(() => {
    const degisti = () => {
      setYol(oku());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', degisti);
    return () => window.removeEventListener('hashchange', degisti);
  }, []);
  return yol;
}
