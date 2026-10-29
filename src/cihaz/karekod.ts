// Fotoğraf ya da PDF'teki karekodları cihazda okur (internet gerekmez, hiçbir yere gönderilmez).
// Tarayıcının BarcodeDetector'ı varsa o, yoksa jsQR kullanılır. PDF'in ilk iki sayfası pdf.js ile çizilir.
// Kütüphaneler yalnızca bu dosya ilk kullanılınca yüklenir.

type Tuval = HTMLCanvasElement;

interface BarkodOkuyucu {
  detect(kaynak: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

async function tarayiciOkuyucusu(): Promise<BarkodOkuyucu | null> {
  const BD = (globalThis as { BarcodeDetector?: { new (o: { formats: string[] }): BarkodOkuyucu; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
  if (!BD) return null;
  try {
    const bicimler = (await BD.getSupportedFormats?.()) ?? ['qr_code'];
    return bicimler.includes('qr_code') ? new BD({ formats: ['qr_code'] }) : null;
  } catch {
    return null;
  }
}

function tuvaleCiz(kaynak: ImageBitmap | Tuval, enUzun: number): Tuval {
  const oran = Math.min(1, enUzun / Math.max(kaynak.width, kaynak.height));
  const t = document.createElement('canvas');
  t.width = Math.max(1, Math.round(kaynak.width * oran));
  t.height = Math.max(1, Math.round(kaynak.height * oran));
  const c = t.getContext('2d', { willReadFrequently: true });
  if (c) {
    c.fillStyle = '#fff';
    c.fillRect(0, 0, t.width, t.height);
    c.drawImage(kaynak, 0, 0, t.width, t.height);
  }
  return t;
}

async function tuvaldenOku(kaynak: ImageBitmap | Tuval): Promise<string[]> {
  const okuyucu = await tarayiciOkuyucusu();
  if (okuyucu) {
    try {
      const sonuc = await okuyucu.detect(tuvaleCiz(kaynak, 2400));
      if (sonuc.length > 0) return sonuc.map((s) => s.rawValue);
    } catch {
      // jsQR ile devam
    }
  }
  const { default: jsQR } = await import('jsqr');
  // Karekod sayfada küçükse büyük çözünürlük, bulanıksa küçültmek işe yarar.
  for (const boyut of [2000, 1200, 800]) {
    const t = tuvaleCiz(kaynak, boyut);
    const veri = t.getContext('2d')?.getImageData(0, 0, t.width, t.height);
    if (!veri) continue;
    const kod = jsQR(veri.data, veri.width, veri.height, { inversionAttempts: 'attemptBoth' });
    if (kod?.data) return [kod.data];
  }
  return [];
}

async function pdfSayfalari(dosya: Blob, enCok: number): Promise<Tuval[]> {
  const pdfjs = await import('pdfjs-dist');
  const { default: isci } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = isci;
  const yukleme = pdfjs.getDocument({ data: new Uint8Array(await dosya.arrayBuffer()) });
  const belge = await yukleme.promise;
  const sayfalar: Tuval[] = [];
  try {
    for (let n = 1; n <= Math.min(enCok, belge.numPages); n++) {
      const sayfa = await belge.getPage(n);
      const gorunum = sayfa.getViewport({ scale: 2.5 });
      const t = document.createElement('canvas');
      t.width = Math.round(gorunum.width);
      t.height = Math.round(gorunum.height);
      const c = t.getContext('2d');
      if (!c) continue;
      await sayfa.render({ canvas: t, canvasContext: c, viewport: gorunum }).promise;
      sayfalar.push(t);
    }
  } finally {
    void yukleme.destroy();
  }
  return sayfalar;
}

/** Dosyadaki karekodların içerikleri; bulunamazsa ya da okunamazsa boş liste. */
export async function karekodlariOku(dosya: Blob): Promise<string[]> {
  try {
    if (dosya.type === 'application/pdf') {
      for (const sayfa of await pdfSayfalari(dosya, 2)) {
        const s = await tuvaldenOku(sayfa);
        if (s.length > 0) return s;
      }
      return [];
    }
    if (!dosya.type.startsWith('image/')) return [];
    const resim = await createImageBitmap(dosya, { imageOrientation: 'from-image' });
    try {
      return await tuvaldenOku(resim);
    } finally {
      resim.close();
    }
  } catch {
    return [];
  }
}
