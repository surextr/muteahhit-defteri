/// <reference lib="webworker" />
import { DxfOkuyucu, dxfKodlamasi } from '../hesap/dxf';

// DXF'i arka planda (sayfa donmadan) parça parça okur; büyük dosyada ilerleme bildirir.

self.onmessage = async (e: MessageEvent<{ dosya: File }>) => {
  const { dosya } = e.data;
  try {
    const bas = new TextDecoder('latin1').decode(await dosya.slice(0, 65536).arrayBuffer());
    const cozucu = new TextDecoder(dxfKodlamasi(bas));
    const okuyucu = new DxfOkuyucu();
    const akis = dosya.stream().getReader();
    let okunan = 0;
    let bildirilen = 0;
    for (;;) {
      const { done, value } = await akis.read();
      if (done) break;
      okunan += value.byteLength;
      okuyucu.besle(cozucu.decode(value, { stream: true }));
      if (okunan - bildirilen > 4_000_000) {
        bildirilen = okunan;
        postMessage({ tur: 'ilerleme', oran: okunan / dosya.size });
      }
    }
    okuyucu.besle(cozucu.decode());
    const c = okuyucu.bitir();
    const parcalar = [...c.parcalar].map(([k, l]) => [k, Float64Array.from(l)] as const);
    postMessage({ tur: 'bitti', yazilar: c.yazilar, bloklar: c.bloklar, birimKodu: c.birimKodu, parcalar }, parcalar.map(([, a]) => a.buffer));
  } catch (hata) {
    postMessage({ tur: 'hata', mesaj: hata instanceof Error ? hata.message : String(hata) });
  }
};
