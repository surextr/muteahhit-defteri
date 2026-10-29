// Cihaz veritabanı (IndexedDB) kapalıyken (iPhone Kilitleme Modu) kayıtların yazılacağı yedek yer. Tarayıcının açık
// bıraktığı ilk yöntem seçilir: dosya alanı (OPFS), önbellek (Cache API), küçük kayıt alanı (localStorage, ~5 MB).

export interface KaliciAlan {
  ad: 'dosya' | 'onbellek' | 'yerel';
  /** Kullanıcıya gösterilecek yer ("… saklanıyor" cümlesine uyar). */
  aciklama: string;
  oku(anahtar: string): Promise<string | null>;
  yaz(anahtar: string, metin: string): Promise<void>;
  sil(anahtar: string): Promise<void>;
}

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
      const d = await kok.getFileHandle(ad(a), { create: true });
      if (!('createWritable' in d)) throw new Error('createWritable yok');
      const w = await d.createWritable();
      await w.write(metin);
      await w.close();
    },
    async sil(a) {
      await kok.removeEntry(ad(a)).catch(() => undefined);
    },
  };
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
  };
}

function yerelAlan(): KaliciAlan {
  return {
    ad: 'yerel',
    aciklama: 'tarayıcının küçük kayıt alanında (en çok 5 MB)',
    oku: async (a) => localStorage.getItem(ONEK + a),
    yaz: async (a, metin) => localStorage.setItem(ONEK + a, metin),
    sil: async (a) => localStorage.removeItem(ONEK + a),
  };
}

/** Yazıp geri okuyarak gerçekten çalışan ilk alanı döndürür; hiçbiri yoksa null. */
export async function kaliciAlanBul(): Promise<KaliciAlan | null> {
  const adaylar: (() => Promise<KaliciAlan> | KaliciAlan)[] = [dosyaAlani, onbellekAlani, yerelAlan];
  for (const aday of adaylar) {
    try {
      const alan = await Promise.race([
        Promise.resolve().then(aday),
        new Promise<never>((_, red) => setTimeout(() => red(new Error('yanıt yok')), 3000)),
      ]);
      const deneme = `deneme-${Date.now()}`;
      await alan.yaz('__deneme', deneme);
      const okunan = await alan.oku('__deneme');
      await alan.sil('__deneme');
      if (okunan === deneme) return alan;
    } catch {
      /* sıradakini dene */
    }
  }
  return null;
}
