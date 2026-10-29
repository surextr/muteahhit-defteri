// Tarayıcının cihaz veritabanı (IndexedDB) kullanılabilir mi? iPhone/iPad/Mac'te Kilitleme Modu (Lockdown Mode) ve bazı
// gizli pencereler IndexedDB'yi kapatır: `indexedDB` ya yoktur, ya okunurken hata verir, ya da `open` hiç yanıt vermez.
// Program bütün kayıtları cihazda tuttuğu için bu durumda açılamaz; ekran kullanıcıya ne yapacağını söyler.

export type DepolamaDurumu = 'var' | 'yok';

export async function cihazVeritabaniDurumu(sureMs = 4000): Promise<DepolamaDurumu> {
  let fabrika: IDBFactory | undefined;
  try {
    fabrika = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  } catch {
    return 'yok';
  }
  if (!fabrika || typeof fabrika.open !== 'function') return 'yok';
  return new Promise<DepolamaDurumu>((coz) => {
    const zaman = setTimeout(() => coz('yok'), sureMs);
    const bitir = (d: DepolamaDurumu) => {
      clearTimeout(zaman);
      coz(d);
    };
    try {
      const istek = fabrika.open('muteahhit-deneme');
      istek.onsuccess = () => {
        try {
          istek.result.close();
          fabrika.deleteDatabase('muteahhit-deneme');
        } catch {
          /* önemsiz */
        }
        bitir('var');
      };
      istek.onerror = () => bitir('yok');
      istek.onblocked = () => bitir('var');
    } catch {
      bitir('yok');
    }
  });
}
