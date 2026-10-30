import Dexie from 'dexie';
import type { KaliciAlan } from '../../cihaz/kaliciAlan';

// Bellek modu: tarayıcı IndexedDB'yi kapatmışsa (iPhone Kilitleme Modu) Dexie bellekte çalışan bir IndexedDB
// (fake-indexeddb) üzerinde açılır; değişen tablolar `KaliciAlan`a (dosya alanı / önbellek / localStorage) JSON olarak
// yazılır, açılışta oradan geri kurulur. Uygulamanın geri kalanı farkı bilmez: aynı şema, aynı geçişler çalışır.
// Kayıt düzeyi değil tablo düzeyi: değişen tablo bütünüyle yeniden yazılır; dosyalar ayrı ve bir kez yazılır.

interface DizinTanimi {
  ad: string;
  yol: string | string[];
  tekil: boolean;
  coklu: boolean;
}
interface TabloTanimi {
  ad: string;
  yol: string | string[] | null;
  otomatik: boolean;
  dizinler: DizinTanimi[];
}
interface Sema {
  surum: number;
  tablolar: TabloTanimi[];
}

/** Kalıcı yazılmayan veritabanları: geçiş öncesi yedek arşivi büyük olabilir, algılama deneme veritabanı. */
const saklanmaz = (ad: string) => ad.endsWith('-yedekler') || ad === 'muteahhit-deneme';

// ─── Blob ↔ JSON ───
// Dosyalar (Blob) tablo metnine gömülmez: içerik özetiyle (SHA-256) ayrı anahtara bayt olarak yazılır, tabloda
// { __dosya, tur } kalır. Aynı dosya bir kez yazılır; hiçbir tablonun göstermediği dosya silinir.
// Eski biçim { __blob, tur, veri(base64) } okunmaya devam eder.

const dosyaAnahtari = (ozet: string) => `dosya/${ozet}`;

async function ozetAl(b: Uint8Array): Promise<string> {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', b as BufferSource));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Blob'ları dosya anahtarına çevirir; `yeni`: yazılması gereken dosyalar, `kullanilan`: tablonun gösterdikleri. */
async function kodla(d: unknown, yeni: Map<string, Uint8Array>, kullanilan: Set<string>): Promise<unknown> {
  if (d instanceof Blob) {
    const b = new Uint8Array(await d.arrayBuffer());
    const anahtar = dosyaAnahtari(await ozetAl(b));
    kullanilan.add(anahtar);
    yeni.set(anahtar, b);
    return { __dosya: anahtar, tur: d.type };
  }
  if (Array.isArray(d)) {
    const l: unknown[] = [];
    for (const x of d) l.push(await kodla(x, yeni, kullanilan));
    return l;
  }
  if (d && typeof d === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(d)) o[k] = await kodla(v, yeni, kullanilan);
    return o;
  }
  return d;
}

/** Dosya anahtarlarını Blob'a çevirir (baytlar `dosyalar`dan); `kullanilan` doldurulur. */
function coz(d: unknown, dosyalar: Map<string, Uint8Array>, kullanilan: Set<string>): unknown {
  if (d && typeof d === 'object') {
    const o = d as { __dosya?: string; __blob?: unknown; tur?: string; veri?: string };
    if (typeof o.__dosya === 'string') {
      kullanilan.add(o.__dosya);
      return new Blob([(dosyalar.get(o.__dosya) ?? new Uint8Array()) as BlobPart], { type: o.tur ?? '' });
    }
    if (o.__blob === true) {
      const s = atob(o.veri ?? '');
      const b = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
      return new Blob([b], { type: o.tur ?? '' });
    }
  }
  if (Array.isArray(d)) return d.map((x) => coz(x, dosyalar, kullanilan));
  if (d && typeof d === 'object') return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, coz(v, dosyalar, kullanilan)]));
  return d;
}

/** Metindeki dosya anahtarları (geri kurulumda baytları okumak için). */
function dosyaAnahtarlari(metin: string): string[] {
  return [...new Set([...metin.matchAll(/"__dosya":"(dosya\/[0-9a-f]{64})"/g)].map((m) => m[1]!))];
}

// ─── Ham IndexedDB yardımcıları ───

const istek = <T>(r: IDBRequest<T>) =>
  new Promise<T>((coz_, red) => {
    r.onsuccess = () => coz_(r.result);
    r.onerror = () => red(r.error);
  });

const tabloAnahtari = (db: string, tablo: string) => `${db}/${tablo}`;
const semaAnahtari = (db: string) => `${db}/__sema`;
const LISTE = '__veritabanlari';

export interface BellekModu {
  alan: KaliciAlan;
  /** Bekleyen değişiklikleri hemen yazar. */
  kaydet(): Promise<void>;
}

/**
 * Dexie'yi bellekteki IndexedDB'ye yönlendirir ve kalıcı alandaki son hâli geri kurar. Uygulamadaki herhangi bir Dexie
 * nesnesi oluşturulmadan önce çağrılmalı. `hata`: yazma başarısız olunca (yer kalmadı vb.) çağrılır.
 */
export async function bellekModunuKur(alan: KaliciAlan, hata: (mesaj: string) => void): Promise<BellekModu> {
  const sahte = await import('fake-indexeddb');
  const fabrika: IDBFactory = sahte.indexedDB;

  /** Her tablonun gösterdiği dosya anahtarları (kullanılmayan dosyayı silmek için). */
  const tabloDosyalari = new Map<string, Set<string>>();
  const dosyaKullaniliyor = (a: string) => [...tabloDosyalari.values()].some((s) => s.has(a));

  // 1) Geri kurulum: her veritabanı kendi kayıtlı sürümü ve tablo yapısıyla; Dexie sonra normal geçişlerini yapar.
  const adlar: string[] = JSON.parse((await alan.oku(LISTE)) ?? '[]');
  for (const db of adlar) {
    const semaMetni = await alan.oku(semaAnahtari(db));
    if (!semaMetni) continue;
    const sema = JSON.parse(semaMetni) as Sema;
    const ac = fabrika.open(db, sema.surum);
    ac.onupgradeneeded = () => {
      for (const t of sema.tablolar) {
        const ts = ac.result.createObjectStore(t.ad, { keyPath: t.yol ?? undefined, autoIncrement: t.otomatik });
        for (const d of t.dizinler) ts.createIndex(d.ad, d.yol, { unique: d.tekil, multiEntry: d.coklu });
      }
    };
    const baglanti = await istek(ac);
    for (const t of sema.tablolar) {
      const metin = await alan.oku(tabloAnahtari(db, t.ad));
      if (!metin) continue;
      const dosyalar = new Map<string, Uint8Array>();
      for (const a of dosyaAnahtarlari(metin)) {
        const b = await alan.okuIkili(a);
        if (b) dosyalar.set(a, b);
      }
      const kullanilan = new Set<string>();
      const satirlar = coz(JSON.parse(metin), dosyalar, kullanilan) as [IDBValidKey, unknown][];
      tabloDosyalari.set(tabloAnahtari(db, t.ad), kullanilan);
      const tx = baglanti.transaction(t.ad, 'readwrite');
      const ts = tx.objectStore(t.ad);
      for (const [k, v] of satirlar) ts.put(v, t.yol === null ? k : undefined);
      await new Promise<void>((c, r) => {
        tx.oncomplete = () => c();
        tx.onerror = () => r(tx.error);
      });
    }
    baglanti.close();
  }

  // 2) Değişiklik izleme: yazan her işlem bittiğinde dokunduğu tablolar "kirli" olur.
  const kirli = new Map<string, Set<string>>();
  const izlenen = new Set(adlar);
  const isaretle = (db: string, tablolar: Iterable<string>) => {
    if (saklanmaz(db)) return;
    izlenen.add(db);
    const k = kirli.get(db) ?? new Set<string>();
    for (const t of tablolar) k.add(t);
    kirli.set(db, k);
    zamanla();
  };
  type IslemFn = (this: IDBDatabase, adlar: string | string[], mod?: IDBTransactionMode, ...ek: unknown[]) => IDBTransaction;
  const proto = sahte.IDBDatabase.prototype as unknown as { transaction: IslemFn };
  const asilIslem = proto.transaction;
  proto.transaction = function (this: IDBDatabase, adlar_: string | string[], mod?: IDBTransactionMode, ...ek: unknown[]) {
    const tx = asilIslem.call(this, adlar_, mod, ...ek);
    if (mod === 'readwrite') {
      const db = this.name;
      const liste = typeof adlar_ === 'string' ? [adlar_] : [...adlar_];
      tx.addEventListener('complete', () => isaretle(db, liste));
    }
    return tx;
  };
  // Şema yükseltmesi (Dexie geçişleri) transaction() dışından yürür: açılışta sürüm değiştiyse hepsi yazılır.
  const asilAc = fabrika.open.bind(fabrika);
  fabrika.open = (ad: string, surum?: number) => {
    const r = asilAc(ad, surum);
    let yukseldi = false;
    r.addEventListener('upgradeneeded', () => (yukseldi = true));
    r.addEventListener('success', () => {
      if (yukseldi) isaretle(ad, [...r.result.objectStoreNames]);
    });
    return r;
  };
  const asilSil = fabrika.deleteDatabase.bind(fabrika);
  fabrika.deleteDatabase = (ad: string) => {
    const r = asilSil(ad);
    r.addEventListener('success', () => isaretle(ad, []));
    return r;
  };

  // 3) Yazma: değişen tablolar ve şema; silinen veritabanının kayıtları kaldırılır.
  let zamanlayici: ReturnType<typeof setTimeout> | null = null;
  let suren: Promise<void> = Promise.resolve();
  function zamanla() {
    if (zamanlayici) clearTimeout(zamanlayici);
    zamanlayici = setTimeout(() => void kaydet(), 800);
  }

  async function bir(db: string, tablolar: Set<string>) {
    const var_ = (await fabrika.databases()).some((d) => d.name === db);
    if (!var_) {
      const eski = await alan.oku(semaAnahtari(db));
      if (eski)
        for (const t of (JSON.parse(eski) as Sema).tablolar) {
          const tk = tabloAnahtari(db, t.ad);
          const onceki = tabloDosyalari.get(tk) ?? new Set<string>();
          tabloDosyalari.delete(tk);
          for (const a of onceki) if (!dosyaKullaniliyor(a)) await alan.sil(a);
          await alan.sil(tk);
        }
      await alan.sil(semaAnahtari(db));
      izlenen.delete(db);
      return;
    }
    const baglanti = await istek(asilAc(db));
    try {
      const adlar_ = [...baglanti.objectStoreNames];
      const sema: Sema = { surum: baglanti.version, tablolar: [] };
      const okunacak = adlar_.filter((t) => tablolar.has(t));
      const tx = adlar_.length ? baglanti.transaction(adlar_, 'readonly') : null;
      const veriler: [string, [IDBValidKey, unknown][]][] = [];
      for (const ad of adlar_) {
        const ts = tx!.objectStore(ad);
        sema.tablolar.push({
          ad,
          yol: ts.keyPath as string | string[] | null,
          otomatik: ts.autoIncrement,
          dizinler: [...ts.indexNames].map((i) => {
            const d = ts.index(i);
            return { ad: i, yol: d.keyPath as string | string[], tekil: d.unique, coklu: d.multiEntry };
          }),
        });
        if (okunacak.includes(ad)) {
          const [anahtarlar, degerler] = await Promise.all([istek(ts.getAllKeys()), istek(ts.getAll())]);
          veriler.push([ad, anahtarlar.map((k, i) => [k, degerler[i]])]);
        }
      }
      baglanti.close();
      for (const [ad, satirlar] of veriler) {
        const tk = tabloAnahtari(db, ad);
        const yeni = new Map<string, Uint8Array>();
        const kullanilan = new Set<string>();
        const metin = JSON.stringify(await kodla(satirlar, yeni, kullanilan));
        for (const [a, b] of yeni) if (!dosyaKullaniliyor(a)) await alan.yazIkili(a, b);
        await alan.yaz(tk, metin);
        const onceki = tabloDosyalari.get(tk) ?? new Set<string>();
        tabloDosyalari.set(tk, kullanilan);
        for (const a of onceki) if (!kullanilan.has(a) && !dosyaKullaniliyor(a)) await alan.sil(a);
      }
      await alan.yaz(semaAnahtari(db), JSON.stringify(sema));
    } finally {
      baglanti.close();
    }
  }

  function kaydet(): Promise<void> {
    if (zamanlayici) clearTimeout(zamanlayici);
    zamanlayici = null;
    suren = suren.then(async () => {
      const isler = [...kirli.entries()];
      kirli.clear();
      try {
        for (const [db, tablolar] of isler) await bir(db, tablolar);
        await alan.yaz(LISTE, JSON.stringify([...izlenen]));
      } catch (e) {
        // Yazılamayan tablolar kirli kalır, sonraki değişiklikte yeniden denenir.
        for (const [db, t] of isler) {
          const k = kirli.get(db) ?? new Set<string>();
          for (const x of t) k.add(x);
          kirli.set(db, k);
        }
        const m = e instanceof Error ? e.message : String(e);
        hata(/quota|exceed|space|yer/i.test(m) ? 'Tarayıcıda yer kalmadı; son değişiklikler saklanamadı. Yedek alın.' : `Kayıtlar saklanamadı: ${m}`);
      }
    });
    return suren;
  }

  // Uygulama arka plana geçerken / kapanırken beklemeden yaz.
  const hemen = () => {
    if (kirli.size) void kaydet();
  };
  addEventListener('pagehide', hemen);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && hemen());

  Dexie.dependencies.indexedDB = fabrika;
  Dexie.dependencies.IDBKeyRange = sahte.IDBKeyRange;
  // Dexie Safari'de açılmadan önce (idbReady) Dexie.dependencies'e değil doğrudan genel `indexedDB`ye bakar; Kilitleme
  // Modunda o yok ("Can't find variable: indexedDB"). Bellekteki veritabanı genel ada da konur.
  for (const [ad, deger] of [
    ['indexedDB', fabrika],
    ['IDBKeyRange', sahte.IDBKeyRange],
  ] as const) {
    try {
      Object.defineProperty(globalThis, ad, { value: deger, configurable: true, writable: true });
    } catch {
      /* tanımlanamazsa Dexie'nin kendi denetimi hata verir; ekran ayrıntıyı gösterir */
    }
  }
  return { alan, kaydet };
}
