import { useEffect, useState } from 'react';

// Sayfa adresi #/projeler/123 biçiminde tutulur: GitHub Pages'te ve internetsiz
// çalışırken sunucuya gitmeden açılır, geri tuşu çalışır.

const oku = (): string[] => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);

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
