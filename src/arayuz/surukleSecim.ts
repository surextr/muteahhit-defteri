import { useEffect, useRef, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';

// Krokide sürükleyerek çoklu seçim. Bilgisayarda fareyle basılıp sürüklenir; telefonda kutucuğa
// basılı tutulur (kısa titreşim), sonra parmak kaydırılır — basılı tutmadan kaydırmak sayfayı kaydırır.
// İlk kutu ile parmağın/farenin altındaki kutu arasındaki dikdörtgen (aynı blokta) seçilir; ilk kutu
// seçili değilse eklenir, seçiliyse çıkarılır. Kutucuklar data-bolum, data-blok, data-satir, data-hat taşır.

export interface HucreKonumu {
  id: string;
  blokId: string;
  satir: number;
  hat: number;
}

const BASILI_TUTMA_MS = 400;
/** Bu kadar kayan parmak basılı tutmuyor, sayfayı kaydırıyor sayılır. */
const KAYMA_PAYI_PX = 10;

function hucreBul(x: number, y: number): HucreKonumu | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-bolum]');
  if (!el) return null;
  const d = el.dataset;
  return { id: d.bolum!, blokId: d.blok!, satir: Number(d.satir), hat: Number(d.hat) };
}

interface Durum {
  pointerId: number;
  dokunma: boolean;
  bas: HucreKonumu;
  ekle: boolean;
  taban: Set<string>;
  aktif: boolean;
  x: number;
  y: number;
  zamanlayici: number | undefined;
}

export function useSurukleSecim(ayar: {
  etkin: boolean;
  secili: Set<string>;
  setSecili: (s: Set<string>) => void;
  /** Aynı bloktaki iki kutunun belirlediği dikdörtgendeki bölümler. */
  aralik: (blokId: string, a: HucreKonumu, b: HucreKonumu) => string[];
}) {
  const ref = useRef<HTMLElement>(null);
  const durum = useRef<Durum | null>(null);
  const sonSurukleme = useRef(0);
  const guncel = useRef(ayar);
  guncel.current = ayar;

  const bitir = () => {
    const d = durum.current;
    if (!d) return;
    window.clearTimeout(d.zamanlayici);
    if (d.aktif) sonSurukleme.current = Date.now();
    durum.current = null;
  };

  const uygula = (hedef: HucreKonumu) => {
    const d = durum.current!;
    const yeni = new Set(d.taban);
    for (const id of guncel.current.aralik(d.bas.blokId, d.bas, hedef)) {
      if (d.ekle) yeni.add(id);
      else yeni.delete(id);
    }
    guncel.current.setSecili(yeni);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Sürükleme başladıysa parmak hareketi sayfayı kaydırmasın (pasif olmayan dinleyici gerekir).
    const touchmove = (e: TouchEvent) => {
      if (durum.current?.aktif) e.preventDefault();
    };
    el.addEventListener('touchmove', touchmove, { passive: false });
    window.addEventListener('pointerup', bitir);
    return () => {
      el.removeEventListener('touchmove', touchmove);
      window.removeEventListener('pointerup', bitir);
    };
  }, []);

  const olaylar = {
    onPointerDown(e: ReactPointerEvent) {
      if (!guncel.current.etkin || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const bas = hucreBul(e.clientX, e.clientY);
      if (!bas) return;
      if (e.pointerType === 'mouse') e.preventDefault(); // metin seçimi ve sürükleme görüntüsü olmasın
      const { secili } = guncel.current;
      const d: Durum = {
        pointerId: e.pointerId,
        dokunma: e.pointerType !== 'mouse',
        bas,
        ekle: !secili.has(bas.id),
        taban: new Set(secili),
        aktif: false,
        x: e.clientX,
        y: e.clientY,
        zamanlayici: undefined,
      };
      if (d.dokunma) {
        d.zamanlayici = window.setTimeout(() => {
          if (durum.current !== d) return;
          d.aktif = true;
          navigator.vibrate?.(15);
          uygula(bas);
        }, BASILI_TUTMA_MS);
      }
      durum.current = d;
    },
    onPointerMove(e: ReactPointerEvent) {
      const d = durum.current;
      if (!d || e.pointerId !== d.pointerId) return;
      if (!d.aktif) {
        if (d.dokunma) {
          if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > KAYMA_PAYI_PX) bitir();
          return;
        }
        const h = hucreBul(e.clientX, e.clientY);
        if (!h || h.id === d.bas.id) return;
        d.aktif = true;
      }
      const h = hucreBul(e.clientX, e.clientY);
      if (h && h.blokId === d.bas.blokId) uygula(h);
    },
    onPointerCancel: bitir,
    onContextMenu(e: ReactMouseEvent) {
      // Basılı tutunca telefonun menüsü açılmasın.
      if (guncel.current.etkin) e.preventDefault();
    },
  };

  /** Sürükleme bitince ilk kutuya gelen tıklama yok sayılır (seçimi geri almasın). */
  const tiklamaYutulsun = () => Date.now() - sonSurukleme.current < 500;

  return { ref, olaylar, tiklamaYutulsun };
}
