import { useEffect, useState } from 'react';

/** Bilgisayar düzeni eşiği (stil.css'teki @media (min-width: 1000px) ile aynı). */
export const GENIS_EKRAN = '(min-width: 1000px)';

/** Ekran bilgisayar düzeninde mi (sol menü, tablolar, liste + ayrıntı yan yana). Pencere daralınca değişir. */
export function useGenisEkran(): boolean {
  const [genis, setGenis] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(GENIS_EKRAN).matches);
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const m = matchMedia(GENIS_EKRAN);
    const degisti = () => setGenis(m.matches);
    m.addEventListener('change', degisti);
    return () => m.removeEventListener('change', degisti);
  }, []);
  return genis;
}

export type SiralamaYonu = 'artan' | 'azalan';

/** Tablo sıralaması: aynı sütuna yeniden basınca yön değişir. */
export function useSiralama<K extends string>(ilk: K, ilkYon: SiralamaYonu = 'azalan') {
  const [sira, setSira] = useState<{ anahtar: K; yon: SiralamaYonu }>({ anahtar: ilk, yon: ilkYon });
  const sec = (anahtar: K, yeniYon: SiralamaYonu = 'artan') =>
    setSira((s) => (s.anahtar === anahtar ? { anahtar, yon: s.yon === 'artan' ? 'azalan' : 'artan' } : { anahtar, yon: yeniYon }));
  const sirala = <T,>(liste: T[], deger: (x: T, k: K) => string | number) =>
    [...liste].sort((a, b) => {
      const x = deger(a, sira.anahtar);
      const y = deger(b, sira.anahtar);
      const f = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'tr', { numeric: true });
      return sira.yon === 'artan' ? f : -f;
    });
  return { sira, sec, sirala };
}
