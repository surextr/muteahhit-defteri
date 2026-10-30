import { strFromU8, unzipSync } from 'fflate';

// Excel (.xlsx) ve CSV okuyucu (saf): sayfalar satır satır hücre dizisi olarak. Biçim, formül ve birleştirme yok sayılır;
// formüllü hücrede Excel'in kaydettiği son değer alınır.

export type HucreDegeri = string | number | null;

export interface TabloSayfasi {
  ad: string;
  satirlar: HucreDegeri[][];
}

const varlik = (m: string) =>
  m
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** <t> parçalarının birleşimi (zengin metindeki <r> parçaları dahil). */
const metinler = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => varlik(m[1]!)).join('');

/** "AB12" → 27 (0 tabanlı sütun). */
export function sutunNo(ref: string): number {
  const harf = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const h of harf) n = n * 26 + (h.charCodeAt(0) - 64);
  return n - 1;
}

export function xlsxOku(veri: Uint8Array): TabloSayfasi[] {
  const dosyalar = unzipSync(veri);
  const oku = (yol: string) => (dosyalar[yol] ? strFromU8(dosyalar[yol]!) : '');
  const ortak = [...oku('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => metinler(m[1]!));
  const iliski = new Map([...oku('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map((m) => [/Id="([^"]+)"/.exec(m[0])?.[1] ?? '', /Target="([^"]+)"/.exec(m[0])?.[1] ?? '']));
  const sayfalar: TabloSayfasi[] = [];
  for (const m of oku('xl/workbook.xml').matchAll(/<sheet\b[^>]*>/g)) {
    const ad = varlik(/name="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1] ?? '';
    let hedef = iliski.get(rid) ?? '';
    hedef = hedef.startsWith('/') ? hedef.slice(1) : `xl/${hedef.replace(/^\.\//, '')}`;
    const xml = oku(hedef);
    if (!xml) continue;
    const satirlar: HucreDegeri[][] = [];
    for (const r of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const no = Number(/\br="(\d+)"/.exec(r[1]!)?.[1] ?? satirlar.length + 1) - 1;
      const satir: HucreDegeri[] = [];
      for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ozellik = c[1]!;
        const ic = c[2] ?? '';
        const ref = /\br="([A-Z]+\d+)"/.exec(ozellik)?.[1];
        const tur = /\bt="([^"]+)"/.exec(ozellik)?.[1];
        const v = /<v>([\s\S]*?)<\/v>/.exec(ic)?.[1];
        let deger: HucreDegeri = null;
        if (tur === 's') deger = v !== undefined ? (ortak[Number(v)] ?? null) : null;
        else if (tur === 'inlineStr') deger = metinler(ic);
        else if (tur === 'str' || tur === 'e') deger = v !== undefined ? varlik(v) : null;
        else if (tur === 'b') deger = v === '1' ? 'DOĞRU' : 'YANLIŞ';
        else if (v !== undefined) deger = Number.isFinite(Number(v)) ? Number(v) : varlik(v);
        satir[ref ? sutunNo(ref) : satir.length] = deger;
      }
      satirlar[no] = Array.from(satir, (x) => x ?? null);
    }
    sayfalar.push({ ad, satirlar: Array.from(satirlar, (x) => x ?? []) });
  }
  return sayfalar;
}

/** CSV: ayraç ; , ya da sekme (ilk satırdan); tırnaklı alanlar. Sayılar metin kalır (metraj okuyucu çevirir). */
export function csvOku(metin: string, ad = 'CSV'): TabloSayfasi {
  const ilk = metin.split(/\r?\n/, 1)[0] ?? '';
  const ayrac = [';', '\t', ','].sort((a, b) => ilk.split(b).length - ilk.split(a).length)[0]!;
  const satirlar: HucreDegeri[][] = [];
  let satir: HucreDegeri[] = [];
  let alan = '';
  let tirnak = false;
  for (let i = 0; i < metin.length; i++) {
    const h = metin[i]!;
    if (tirnak) {
      if (h === '"' && metin[i + 1] === '"') (alan += '"'), i++;
      else if (h === '"') tirnak = false;
      else alan += h;
    } else if (h === '"') tirnak = true;
    else if (h === ayrac) satir.push(alan), (alan = '');
    else if (h === '\n' || h === '\r') {
      if (h === '\r' && metin[i + 1] === '\n') i++;
      satir.push(alan);
      satirlar.push(satir.map((x) => (typeof x === 'string' && x.trim() === '' ? null : x)));
      satir = [];
      alan = '';
    } else alan += h;
  }
  if (alan || satir.length) {
    satir.push(alan);
    satirlar.push(satir.map((x) => (typeof x === 'string' && x.trim() === '' ? null : x)));
  }
  return { ad, satirlar };
}
