/**
 * Üç yollu birleştirme (saf): aynı kayıt bu cihazda ve başka cihazda değiştiyse, bu cihazın değiştirdiği alanlar
 * (tabana göre farklı olanlar) korunur, diğer alanlar sunucudaki hâlden alınır. Taban yoksa (iki cihaz aynı kaydı ayrı
 * ayrı oluşturduysa) bu cihazın hâli geçer. Sürüm sunucudakinin bir fazlası olur; böylece sunucu kabul eder.
 */

const ORTAK = new Set(['surum', 'guncelleyen', 'guncellemeZamani']);
const esit = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const nesne = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Alan alan; iç içe nesnelerde (örn. firma.ayarlar) de alt alan alan. Diziler (plan satırları, kalemler) bütün olarak. */
function alanlariBirlestir(taban: unknown, benim: Record<string, unknown>, onlarin: Record<string, unknown>, atla: Set<string>): Record<string, unknown> {
  const t = nesne(taban) ? taban : null;
  const sonuc: Record<string, unknown> = {};
  for (const alan of new Set([...Object.keys(onlarin), ...Object.keys(benim)])) {
    if (atla.has(alan)) continue;
    const [b, o] = [benim[alan], onlarin[alan]];
    if (!t) sonuc[alan] = alan in benim ? b : o;
    else if (nesne(b) && nesne(o) && nesne(t[alan])) sonuc[alan] = alanlariBirlestir(t[alan], b, o, new Set());
    else sonuc[alan] = esit(b, t[alan]) ? o : b;
  }
  return sonuc;
}

/** Birleşen kayıt sunucudakiyle aynı mı (bu cihazdan eklenecek bir şey kalmadı mı). */
export function ayniIcerik(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const temiz = (x: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(x)
        .filter(([k]) => !ORTAK.has(k))
        .sort(([x1], [x2]) => x1.localeCompare(x2)),
    );
  return esit(temiz(a), temiz(b));
}

export function birlestir(
  taban: Record<string, unknown> | null,
  benim: Record<string, unknown>,
  onlarin: Record<string, unknown>,
  zaman: string,
): Record<string, unknown> {
  const sonuc = alanlariBirlestir(taban, benim, onlarin, ORTAK);
  return {
    ...sonuc,
    guncelleyen: benim.guncelleyen ?? onlarin.guncelleyen,
    guncellemeZamani: zaman,
    surum: (typeof onlarin.surum === 'number' ? onlarin.surum : 0) + 1,
  };
}
