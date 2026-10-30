// Cihaz veritabanı (IndexedDB) kapalıyken (iPhone Kilitleme Modu) kayıtların yazılacağı yedek yer. Tarayıcının açık
// bıraktığı ilk yöntem seçilir: dosya alanı (OPFS), önbellek (Cache API), küçük kayıt alanı (localStorage, ~5 MB).

export interface KaliciAlan {
  ad: 'dosya' | 'onbellek' | 'yerel';
  /** Kullanıcıya gösterilecek yer ("… saklanıyor" cümlesine uyar). */
  aciklama: string;
  oku(anahtar: string): Promise<string | null>;
  yaz(anahtar: string, metin: string): Promise<void>;
  sil(anahtar: string): Promise<void>;
  /** Dosya baytları (belge fotoğrafı, PDF) metne çevrilmeden saklanır. */
  okuIkili(anahtar: string): Promise<Uint8Array | null>;
  yazIkili(anahtar: string, baytlar: Uint8Array): Promise<void>;
}

/** Baytlar ↔ her karakteri tek bayt olan metin (localStorage'da base64'ten üçte bir daha az yer tutar). */
export function baytlariMetneCevir(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return s;
}
export function metniBaytlaraCevir(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

/** localStorage'da sıkıştırılmış metnin başındaki işaret (işaretsiz eski kayıt düz okunur). */
const SIKISTIRILMIS = '\u0001lz:';

const ONEK = 'muteahhit-kalici-';

async function dosyaAlani(): Promise<KaliciAlan> {
  const kok = await navigator.storage.getDirectory();
  const ad = (a: string) => `${ONEK}${encodeURIComponent(a)}.json`;
  return {
    ad: 'dosya',
    aciklama: 'tarayıcının dosya alanında',
    async oku(a) {
      try {
        return await (await (await kok.getFileHandle(ad(a))).getFile()).text();
      } catch {
        return null;
      }
    },
    async yaz(a, metin) {
      await dosyaYaz(ad(a), metin);
    },
    async sil(a) {
      await kok.removeEntry(ad(a)).catch(() => undefined);
    },
    async okuIkili(a) {
      try {
        return new Uint8Array(await (await (await kok.getFileHandle(ad(a))).getFile()).arrayBuffer());
      } catch {
        return null;
      }
    },
    async yazIkili(a, baytlar) {
      await dosyaYaz(ad(a), baytlar);
    },
  };
  async function dosyaYaz(dosyaAdi: string, icerik: string | Uint8Array) {
    const d = await kok.getFileHandle(dosyaAdi, { create: true });
    if (!('createWritable' in d)) throw new Error('createWritable yok');
    const w = await d.createWritable();
    await w.write(icerik as FileSystemWriteChunkType);
    await w.close();
  }
}

async function onbellekAlani(): Promise<KaliciAlan> {
  const c = await caches.open(`${ONEK}veri`);
  const istek = (a: string) => new Request(`/__kalici/${encodeURIComponent(a)}`);
  return {
    ad: 'onbellek',
    aciklama: 'tarayıcının önbelleğinde',
    async oku(a) {
      const r = await c.match(istek(a));
      return r ? r.text() : null;
    },
    async yaz(a, metin) {
      await c.put(istek(a), new Response(metin, { headers: { 'Content-Type': 'application/json' } }));
    },
    async sil(a) {
      await c.delete(istek(a));
    },
    async okuIkili(a) {
      const r = await c.match(istek(a));
      return r ? new Uint8Array(await r.arrayBuffer()) : null;
    },
    async yazIkili(a, baytlar) {
      await c.put(istek(a), new Response(baytlar as BlobPart));
    },
  };
}

/** Yalnız localStorage kalmışsa (iPhone Kilitleme Modu) yer ~5 MB: metin lz-string ile sıkıştırılır, dosya baytları
 * base64 yerine bayt başına bir karakterle yazılır. */
async function yerelAlan(): Promise<KaliciAlan> {
  const { compressToUTF16, decompressFromUTF16 } = await import('lz-string');
  return {
    ad: 'yerel',
    aciklama: 'tarayıcının küçük kayıt alanında (en çok 5 MB)',
    async oku(a) {
      const v = localStorage.getItem(ONEK + a);
      if (v === null || !v.startsWith(SIKISTIRILMIS)) return v;
      return decompressFromUTF16(v.slice(SIKISTIRILMIS.length));
    },
    yaz: async (a, metin) => localStorage.setItem(ONEK + a, SIKISTIRILMIS + compressToUTF16(metin)),
    sil: async (a) => localStorage.removeItem(ONEK + a),
    async okuIkili(a) {
      const v = localStorage.getItem(ONEK + a);
      return v === null ? null : metniBaytlaraCevir(v);
    },
    yazIkili: async (a, baytlar) => localStorage.setItem(ONEK + a, baytlariMetneCevir(baytlar)),
  };
}

/** Yazıp geri okuyarak gerçekten çalışan ilk alanı döndürür; hiçbiri yoksa null. */
export async function kaliciAlanBul(): Promise<KaliciAlan | null> {
  const adaylar: (() => Promise<KaliciAlan>)[] = [dosyaAlani, onbellekAlani, yerelAlan];
  for (const aday of adaylar) {
    try {
      const alan = await Promise.race([
        Promise.resolve().then(aday),
        new Promise<never>((_, red) => setTimeout(() => red(new Error('yanıt yok')), 3000)),
      ]);
      const deneme = `deneme-${Date.now()}`;
      await alan.yaz('__deneme', deneme);
      const okunan = await alan.oku('__deneme');
      const ikili = new Uint8Array([0, 1, 127, 128, 255]);
      await alan.yazIkili('__deneme2', ikili);
      const okunanIkili = await alan.okuIkili('__deneme2');
      await alan.sil('__deneme');
      await alan.sil('__deneme2');
      if (okunan === deneme && okunanIkili?.join() === ikili.join()) return alan;
    } catch {
      /* sıradakini dene */
    }
  }
  return null;
}
