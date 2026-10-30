import type { BlokYeri, Yazi } from '../hesap/dxf';
import type { Cizim } from '../hesap/planOkuma';
import { IsKuraliHatasi } from '../servisler/kayitServisi';

// Proje dosyasını cihazda okur (dosya dışarı gitmez): PDF'te konumlu yazılar (pdf.js), DXF'te yazı + çizgi + blok
// (arka planda, `dxfIsci`). DWG kapalı biçimdir: DXF'e çevirme yolu gösterilir.

export const DWG_UYARISI =
  'DWG dosyası doğrudan okunmuyor. AutoCAD\'de "Farklı kaydet → DXF" ile kaydedin ya da ücretsiz ODA File Converter ile DXF\'e çevirip o dosyayı yükleyin.';

export async function planDosyasiOku(dosya: File, ilerleme: (oran: number) => void): Promise<Cizim> {
  const ad = dosya.name;
  const uzanti = ad.toLowerCase().split('.').pop();
  if (uzanti === 'dwg') throw new IsKuraliHatasi(DWG_UYARISI);
  if (uzanti === 'pdf' || dosya.type === 'application/pdf') return pdfOku(dosya, ilerleme);
  if (uzanti === 'dxf') return dxfOku(dosya, ilerleme);
  throw new IsKuraliHatasi('Mimari proje olarak PDF ya da DXF dosyası yükleyin.');
}

async function pdfOku(dosya: File, ilerleme: (oran: number) => void): Promise<Cizim> {
  const pdfjs = await import('pdfjs-dist');
  const { default: isci } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = isci;
  const yukleme = pdfjs.getDocument({ data: new Uint8Array(await dosya.arrayBuffer()) });
  const belge = await yukleme.promise;
  const yazilar: Yazi[] = [];
  try {
    let kayma = 0;
    for (let n = 1; n <= belge.numPages; n++) {
      const sayfa = await belge.getPage(n);
      const [, , , yukseklik] = sayfa.view as [number, number, number, number];
      const icerik = await sayfa.getTextContent();
      for (const it of icerik.items) {
        if (!('str' in it) || !it.str.trim()) continue;
        const [a, b, , , e, f] = it.transform as number[];
        // Sayfalar alt alta dizilir (planlar karışmasın).
        yazilar.push({ x: e!, y: f! - kayma, h: Math.hypot(a!, b!) || it.height, metin: it.str.trim(), katman: '', aci: Math.round((Math.atan2(b!, a!) * 180) / Math.PI) });
      }
      kayma += yukseklik * 1.5;
      ilerleme(n / belge.numPages);
    }
  } finally {
    void yukleme.destroy();
  }
  if (!yazilar.length) throw new IsKuraliHatasi('PDF\'te okunabilir yazı yok (taranmış olabilir). AutoCAD\'den basılmış PDF ya da DXF yükleyin.');
  return { kaynak: 'pdf', dosyaAdi: dosya.name, birimKodu: null, yazilar, bloklar: [], parcalar: new Map() };
}

function dxfOku(dosya: File, ilerleme: (oran: number) => void): Promise<Cizim> {
  return new Promise((coz, reddet) => {
    const isci = new Worker(new URL('./dxfIsci.ts', import.meta.url), { type: 'module' });
    isci.onmessage = (e: MessageEvent) => {
      const d = e.data as
        | { tur: 'ilerleme'; oran: number }
        | { tur: 'hata'; mesaj: string }
        | { tur: 'bitti'; yazilar: Yazi[]; bloklar: BlokYeri[]; birimKodu: number | null; parcalar: [string, Float64Array][] };
      if (d.tur === 'ilerleme') return ilerleme(d.oran);
      isci.terminate();
      if (d.tur === 'hata') return reddet(new IsKuraliHatasi(`DXF okunamadı: ${d.mesaj}`));
      ilerleme(1);
      coz({ kaynak: 'dxf', dosyaAdi: dosya.name, birimKodu: d.birimKodu, yazilar: d.yazilar, bloklar: d.bloklar, parcalar: new Map(d.parcalar) });
    };
    isci.onerror = (e) => {
      isci.terminate();
      reddet(new IsKuraliHatasi(`DXF okunamadı: ${e.message}`));
    };
    isci.postMessage({ dosya });
  });
}
