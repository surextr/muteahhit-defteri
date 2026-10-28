/**
 * Üç yollu birleştirme (saf): aynı kayıt bu cihazda ve başka cihazda değiştiyse, bu cihazın değiştirdiği alanlar
 * (tabana göre farklı olanlar) korunur, diğer alanlar sunucudaki hâlden alınır. Taban yoksa (iki cihaz aynı kaydı ayrı
 * ayrı oluşturduysa) bu cihazın hâli geçer. Sürüm sunucudakinin bir fazlası olur; böylece sunucu kabul eder.
 */

const ORTAK = new Set(['surum', 'guncelleyen', 'guncellemeZamani']);
const esit = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function birlestir(
  taban: Record<string, unknown> | null,
  benim: Record<string, unknown>,
  onlarin: Record<string, unknown>,
  zaman: string,
): Record<string, unknown> {
  const sonuc: Record<string, unknown> = {};
  for (const alan of new Set([...Object.keys(onlarin), ...Object.keys(benim)])) {
    if (ORTAK.has(alan)) continue;
    if (!taban) sonuc[alan] = alan in benim ? benim[alan] : onlarin[alan];
    else sonuc[alan] = esit(benim[alan], taban[alan]) ? onlarin[alan] : benim[alan];
  }
  return {
    ...sonuc,
    guncelleyen: benim.guncelleyen ?? onlarin.guncelleyen,
    guncellemeZamani: zaman,
    surum: (typeof onlarin.surum === 'number' ? onlarin.surum : 0) + 1,
  };
}
