import { strToU8, zipSync } from 'fflate';
import type { Kurus, Tarih } from '../veri/tipler';

// Excel (.xlsx) dosyası üretir (saf; tarayıcıda ve testte aynı). Office Open XML'in en küçük geçerli hâli: her sayfa
// bir tablo, ilk satır kalın başlık, TL tutarlar sayı (₺ biçimli, toplanabilir), tarihler gerçek Excel tarihi.

export type Hucre = string | number | null | { tl: Kurus } | { tarih: Tarih } | { kalin: string };

export interface ExcelSayfasi {
  /** Sekme adı (en çok 31 karakter; Excel'in yasakladığı karakterler atılır). */
  ad: string;
  /** Tablonun üstünde başlık satırları (rapor adı, tarih aralığı…). */
  ust?: string[];
  basliklar: string[];
  satirlar: Hucre[][];
}

const kacir = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0'da geçersiz denetim karakterleri
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

const sutunHarfi = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** 'YYYY-AA-GG' → Excel seri günü (1900 tarih sistemi). */
export function excelGunu(t: Tarih): number {
  return Math.round((Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

// Biçimler: 0 düz, 1 kalın, 2 TL, 3 tarih, 4 kalın TL
const STIL = { duz: 0, kalin: 1, tl: 2, tarih: 3 } as const;

function hucreXml(h: Hucre, ref: string, kalinSatir: boolean): string {
  if (h === null || h === '') return '';
  if (typeof h === 'number') return `<c r="${ref}"${kalinSatir ? ' s="1"' : ''}><v>${h}</v></c>`;
  if (typeof h === 'string') return `<c r="${ref}" t="inlineStr"${kalinSatir ? ' s="1"' : ''}><is><t xml:space="preserve">${kacir(h)}</t></is></c>`;
  if ('tl' in h) return `<c r="${ref}" s="${kalinSatir ? 4 : STIL.tl}"><v>${h.tl / 100}</v></c>`;
  if ('tarih' in h) return /^\d{4}-\d{2}-\d{2}$/.test(h.tarih) ? `<c r="${ref}" s="${STIL.tarih}"><v>${excelGunu(h.tarih)}</v></c>` : '';
  return `<c r="${ref}" t="inlineStr" s="${STIL.kalin}"><is><t xml:space="preserve">${kacir(h.kalin)}</t></is></c>`;
}

const hucreMetni = (h: Hucre) =>
  h === null ? '' : typeof h === 'string' ? h : typeof h === 'number' ? String(h) : 'tl' in h ? '₺0.000.000,00' : 'tarih' in h ? '00.00.0000' : h.kalin;

function sayfaXml(s: ExcelSayfasi): string {
  const satirlar: string[] = [];
  let r = 1;
  for (const u of s.ust ?? []) satirlar.push(`<row r="${r}">${hucreXml({ kalin: u }, `A${r++}`, false)}</row>`);
  if (s.ust?.length) r++;
  const baslikSatiri = r;
  satirlar.push(`<row r="${r}">${s.basliklar.map((b, i) => hucreXml({ kalin: b }, `${sutunHarfi(i)}${r}`, false)).join('')}</row>`);
  r++;
  for (const satir of s.satirlar) {
    // İlk hücresi kalın olan satır (ara toplam, genel toplam) bütünüyle kalın yazılır.
    const kalin = typeof satir[0] === 'object' && satir[0] !== null && 'kalin' in satir[0];
    satirlar.push(`<row r="${r}">${satir.map((h, i) => hucreXml(h, `${sutunHarfi(i)}${r}`, kalin && i > 0)).join('')}</row>`);
    r++;
  }
  const genislik = s.basliklar.map((b, i) =>
    Math.min(60, Math.max(8, b.length + 2, ...s.satirlar.map((x) => hucreMetni(x[i] ?? null).length + 2))),
  );
  const sutunlar = `<cols>${genislik.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`;
  const son = `${sutunHarfi(Math.max(0, s.basliklar.length - 1))}${Math.max(baslikSatiri, r - 1)}`;
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${baslikSatiri}" topLeftCell="A${baslikSatiri + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    sutunlar +
    `<sheetData>${satirlar.join('')}</sheetData>` +
    `<autoFilter ref="A${baslikSatiri}:${son}"/>` +
    `</worksheet>`
  );
}

const sayfaAdi = (ad: string, kullanilan: Set<string>) => {
  let a = ad.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || 'Sayfa';
  for (let i = 2; kullanilan.has(a); i++) a = `${a.slice(0, 28)} ${i}`;
  kullanilan.add(a);
  return a;
};

export function excelOlustur(sayfalar: ExcelSayfasi[]): Uint8Array {
  const adlar = new Set<string>();
  const sayfaAdlari = sayfalar.map((s) => sayfaAdi(s.ad, adlar));
  const dosyalar: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        sayfalar.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        `</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>` +
        sayfaAdlari.map((a, i) => `<sheet name="${kacir(a)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        `</sheets>` +
        // Otomatik süzgeç Excel'de tanımlı ad ister.
        `<definedNames>${sayfalar
          .map((s, i) => {
            const bas = (s.ust?.length ? s.ust.length + 1 : 0) + 1;
            const son = `$${sutunHarfi(Math.max(0, s.basliklar.length - 1))}$${bas + s.satirlar.length}`;
            return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${kacir(sayfaAdlari[i]!).replace(/'/g, "''")}'!$A$${bas}:${son}</definedName>`;
          })
          .join('')}</definedNames></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        sayfalar.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sayfalar.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;₺&quot;;[Red]\\-#,##0.00\\ &quot;₺&quot;"/><numFmt numFmtId="165" formatCode="dd\\.mm\\.yyyy"/></numFmts>` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="5">` +
        `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
        `<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
        `<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
        `<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
        `</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
    ),
  };
  sayfalar.forEach((s, i) => (dosyalar[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sayfaXml(s))));
  return zipSync(dosyalar, { level: 6 });
}

export const EXCEL_TURU = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Dosya adına uygun yazı: "Ahmet Usta ekstre 2026-10-30.xlsx". */
export const dosyaAdiTemizle = (ad: string) => ad.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
