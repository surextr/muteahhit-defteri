import type { HavuzTanima, Kurus, Tarih } from '../veri/tipler';

// e-Fatura / e-Arşiv faturasını okuma (saf): GİB karekodu (JSON metin) ve UBL-TR XML dosyası.
// Okunan bilgi yalnız formu önceden doldurur; kayıt kullanıcı onayıyla yapılır.

/** "1.234,56", "1234.56", "1234" → kuruş. Okunamazsa null. */
export function tutarOku(m: unknown): Kurus | null {
  if (typeof m === 'number') return Number.isFinite(m) ? Math.round(m * 100) : null;
  if (typeof m !== 'string') return null;
  let s = m.trim().replace(/\s/g, '');
  if (!s) return null;
  const virgul = s.lastIndexOf(',');
  const nokta = s.lastIndexOf('.');
  const noktaSayisi = s.split('.').length - 1;
  if (virgul > nokta) s = s.replace(/\./g, '').replace(',', '.');
  // Yalnız noktalar: birden çoksa ya da tek nokta ardından tam üç rakam geliyorsa binlik ayracıdır ("3.500.000", "1.200").
  else if (virgul === -1 && (noktaSayisi > 1 || /^-?\d{1,3}\.\d{3}$/.test(s))) s = s.replace(/\./g, '');
  // Son ayraç ondalıktır; diğeri binlik.
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** "2026-10-29", "29-10-2026", "29.10.2026", "29/10/2026" → 'YYYY-AA-GG'. */
export function tarihOku(m: unknown): Tarih | null {
  if (typeof m !== 'string') return null;
  const s = m.trim();
  let r = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (r) return `${r[1]}-${r[2]}-${r[3]}`;
  r = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})/.exec(s);
  if (r) return `${r[3]}-${r[2]!.padStart(2, '0')}-${r[1]!.padStart(2, '0')}`;
  return null;
}

const rakam = (m: unknown) => (typeof m === 'string' || typeof m === 'number' ? String(m).replace(/\D/g, '') : '');
const vergiNoOku = (m: unknown) => {
  const r = rakam(m);
  return r.length === 10 || r.length === 11 ? r : null;
};
const metin = (m: unknown) => (typeof m === 'string' && m.trim() ? m.trim() : null);

/** Tevkifat tutarı / KDV oranı standart oranlardan birine (2/10…10/10) yakınsa onu verir. */
export function tevkifatOrani(tevkifat: Kurus, kdv: Kurus): { pay: number; payda: number } | null {
  if (tevkifat <= 0 || kdv <= 0) return null;
  const pay = Math.round((tevkifat / kdv) * 10);
  return pay >= 1 && pay <= 10 && Math.abs(tevkifat - (kdv * pay) / 10) <= Math.max(2, kdv * 0.005) ? { pay, payda: 10 } : null;
}

// ─── Karekod ───────────────────────────────────────────────────────

/**
 * GİB e-Fatura/e-Arşiv karekodu: JSON nesne (vkntckn, avkntckn, tarih, no, ettn, parabirimi, kdvmatrah(20),
 * hesaplanankdv(20), vergidahil, odenecek, tip …). Anahtar adları faturayı kesen programa göre biraz değişir; büyük/küçük
 * harf ve boşluk önemsenmez. Karekod fatura değilse null.
 */
export function karekodCoz(icerik: string): HavuzTanima | null {
  let ham: unknown;
  try {
    ham = JSON.parse(icerik.trim());
  } catch {
    return null;
  }
  if (!ham || typeof ham !== 'object' || Array.isArray(ham)) return null;
  const v = new Map<string, unknown>();
  for (const [k, d] of Object.entries(ham as Record<string, unknown>)) v.set(k.toLocaleLowerCase('en').replace(/\s/g, ''), d);
  const satici = vergiNoOku(v.get('vkntckn'));
  const no = metin(v.get('no'));
  if (!satici && !no) return null;

  const matrahlar = new Map<number, Kurus>();
  const kdvTutarlari = new Map<number, Kurus>();
  let tevkifat = 0;
  for (const [k, d] of v) {
    const oran = /\((\d+(?:[.,]\d+)?)\)/.exec(k);
    const n = tutarOku(d);
    if (n === null) continue;
    if (k.includes('tevkifat')) {
      // "hesaplanankdvtevkifat(…)", "kdvtevkifat", "tevkifattutari" gibi: tevkifat tutarı.
      if (!k.includes('matrah') && !k.includes('oran')) tevkifat += Math.abs(n);
      continue;
    }
    if (!oran) continue;
    const o = Number(oran[1]!.replace(',', '.'));
    if (k.startsWith('kdvmatrah') || k.startsWith('matrah')) matrahlar.set(o, (matrahlar.get(o) ?? 0) + n);
    else if (k.startsWith('hesaplanankdv') || k.startsWith('kdv')) kdvTutarlari.set(o, (kdvTutarlari.get(o) ?? 0) + n);
  }
  const oranlar = [...new Set([...matrahlar.keys(), ...kdvTutarlari.keys()])].sort((a, b) => b - a);
  const kdvler = oranlar.map((oran) => {
    const kdv = kdvTutarlari.get(oran) ?? Math.round(((matrahlar.get(oran) ?? 0) * oran) / 100);
    return { oran, matrah: matrahlar.get(oran) ?? Math.round((kdv * 100) / (oran || 1)), kdv };
  });
  // KDV oranı yazılmamış karekod: mal/hizmet toplamı tek satır, KDV yok sayılır.
  if (kdvler.length === 0) {
    const toplam = tutarOku(v.get('malhizmettoplam')) ?? tutarOku(v.get('vergihariç')) ?? tutarOku(v.get('vergidahil'));
    if (toplam !== null) kdvler.push({ oran: 0, matrah: toplam, kdv: 0 });
  }
  const tip = (metin(v.get('tip')) ?? '').toLocaleUpperCase('tr-TR');
  return {
    kaynak: 'karekod',
    satici: { vergiNo: satici, ad: null, adres: null, telefon: null, vergiDairesi: null },
    aliciVergiNo: vergiNoOku(v.get('avkntckn')),
    faturaNo: no,
    tarih: tarihOku(v.get('tarih')),
    ettn: metin(v.get('ettn')),
    iade: tip.includes('IADE'),
    paraBirimi: (metin(v.get('parabirimi')) ?? 'TRY').toUpperCase(),
    kdvler,
    tevkifat,
    odenecek: tutarOku(v.get('odenecek')) ?? tutarOku(v.get('vergidahil')),
    satirlar: [],
  };
}

// ─── Küçük XML okuyucu (UBL için yeterli) ─────────────────────────

export interface XmlDugum {
  /** Ön eki atılmış ad (cbc:ID → ID). */
  ad: string;
  oz: Record<string, string>;
  cocuklar: XmlDugum[];
  metin: string;
}

const varlik = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const n = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(n) ? String.fromCodePoint(n) : '';
  });

const yalinAd = (ad: string) => ad.slice(ad.indexOf(':') + 1);

/** Ad alanlarını (namespace) önemsemeyen basit XML ağacı. Bozuk XML'de null. */
export function xmlOku(xml: string): XmlDugum | null {
  const kok: XmlDugum = { ad: '#kok', oz: {}, cocuklar: [], metin: '' };
  const yigin: XmlDugum[] = [kok];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    const ust = yigin[yigin.length - 1]!;
    if (lt === -1) {
      ust.metin += varlik(xml.slice(i));
      break;
    }
    if (lt > i) ust.metin += varlik(xml.slice(i, lt));
    if (xml.startsWith('<!--', lt)) {
      const son = xml.indexOf('-->', lt);
      if (son === -1) return null;
      i = son + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const son = xml.indexOf(']]>', lt);
      if (son === -1) return null;
      ust.metin += xml.slice(lt + 9, son);
      i = son + 3;
    } else if (xml.startsWith('<?', lt) || xml.startsWith('<!', lt)) {
      const son = xml.indexOf('>', lt);
      if (son === -1) return null;
      i = son + 1;
    } else if (xml.startsWith('</', lt)) {
      const son = xml.indexOf('>', lt);
      if (son === -1) return null;
      const ad = yalinAd(xml.slice(lt + 2, son).trim());
      const acik = yigin.pop();
      if (!acik || acik.ad !== ad) return null;
      i = son + 1;
    } else {
      // Öznitelik değerlerinde ">" olabilir: tırnakları atlayarak etiket sonunu bul.
      let j = lt + 1;
      let tirnak: string | null = null;
      while (j < xml.length) {
        const c = xml[j]!;
        if (tirnak) {
          if (c === tirnak) tirnak = null;
        } else if (c === '"' || c === "'") tirnak = c;
        else if (c === '>') break;
        j++;
      }
      if (j >= xml.length) return null;
      let govde = xml.slice(lt + 1, j);
      const kendindenKapali = govde.endsWith('/');
      if (kendindenKapali) govde = govde.slice(0, -1);
      const adSonu = govde.search(/[\s/]|$/);
      const dugum: XmlDugum = { ad: yalinAd(govde.slice(0, adSonu)), oz: {}, cocuklar: [], metin: '' };
      for (const m of govde.slice(adSonu).matchAll(/([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
        dugum.oz[yalinAd(m[1]!)] = varlik(m[3] ?? m[4] ?? '');
      }
      ust.cocuklar.push(dugum);
      if (!kendindenKapali) yigin.push(dugum);
      i = j + 1;
    }
  }
  if (yigin.length !== 1) return null;
  return kok.cocuklar[0] ?? null;
}

const cocuk = (d: XmlDugum | undefined, ...yol: string[]): XmlDugum | undefined =>
  yol.reduce<XmlDugum | undefined>((x, ad) => x?.cocuklar.find((c) => c.ad === ad), d);
const cocuklar = (d: XmlDugum | undefined, ad: string) => d?.cocuklar.filter((c) => c.ad === ad) ?? [];
const deger = (d: XmlDugum | undefined, ...yol: string[]) => metin(cocuk(d, ...yol)?.metin);

/** UBL-TR fatura XML'i (e-Fatura/e-Arşiv). Fatura değilse null. */
export function ublCoz(xml: string): HavuzTanima | null {
  const kok = xmlOku(xml);
  if (!kok || kok.ad !== 'Invoice') return null;

  const taraf = (ad: string) => {
    const p = cocuk(kok, ad, 'Party');
    const vergiNo =
      cocuklar(p, 'PartyIdentification')
        .map((x) => cocuk(x, 'ID'))
        .find((id) => id && /^(VKN|TCKN)$/i.test(id.oz.schemeID ?? ''))?.metin ?? null;
    const kisi = cocuk(p, 'Person');
    const kisiAdi = [deger(kisi, 'FirstName'), deger(kisi, 'FamilyName')].filter(Boolean).join(' ');
    const adres = cocuk(p, 'PostalAddress');
    const adresMetni = [
      deger(adres, 'StreetName'),
      deger(adres, 'BuildingNumber') && `No: ${deger(adres, 'BuildingNumber')}`,
      deger(adres, 'CitySubdivisionName'),
      deger(adres, 'CityName'),
    ]
      .filter(Boolean)
      .join(' ');
    return {
      vergiNo: vergiNoOku(vergiNo),
      ad: deger(p, 'PartyName', 'Name') ?? (kisiAdi || null),
      adres: adresMetni || null,
      telefon: deger(p, 'Contact', 'Telephone'),
      vergiDairesi: deger(p, 'PartyTaxScheme', 'TaxScheme', 'Name'),
    };
  };

  const satirlar = cocuklar(kok, 'InvoiceLine').map((l) => {
    const miktarD = cocuk(l, 'InvoicedQuantity');
    const kdvAlt = cocuk(l, 'TaxTotal', 'TaxSubtotal');
    const tevkifatAlt = cocuk(l, 'WithholdingTaxTotal', 'TaxSubtotal');
    const yuzde = Number(deger(tevkifatAlt, 'Percent') ?? 'NaN');
    const pay = Math.round(yuzde / 10);
    return {
      ad: deger(l, 'Item', 'Name') ?? deger(l, 'Note') ?? '',
      miktar: miktarD ? (Number(miktarD.metin.trim()) || null) : null,
      birim: miktarD?.oz.unitCode ?? null,
      tutar: tutarOku(deger(l, 'LineExtensionAmount')) ?? 0,
      kdvOrani: Number(deger(kdvAlt, 'Percent') ?? '0') || 0,
      tevkifat: Number.isFinite(yuzde) && pay >= 1 && pay <= 10 ? { pay, payda: 10 } : null,
    };
  });

  const kdvMap = new Map<number, { matrah: Kurus; kdv: Kurus }>();
  for (const alt of cocuklar(cocuk(kok, 'TaxTotal'), 'TaxSubtotal')) {
    const kod = deger(alt, 'TaxCategory', 'TaxScheme', 'TaxTypeCode');
    if (kod && kod !== '0015') continue; // yalnız KDV
    const oran = Number(deger(alt, 'Percent') ?? '0') || 0;
    const e = kdvMap.get(oran) ?? { matrah: 0, kdv: 0 };
    e.matrah += tutarOku(deger(alt, 'TaxableAmount')) ?? 0;
    e.kdv += tutarOku(deger(alt, 'TaxAmount')) ?? 0;
    kdvMap.set(oran, e);
  }
  const tevkifat = cocuklar(kok, 'WithholdingTaxTotal').reduce((t, w) => t + Math.abs(tutarOku(deger(w, 'TaxAmount')) ?? 0), 0);
  const toplamlar = cocuk(kok, 'LegalMonetaryTotal');

  return {
    kaynak: 'xml',
    satici: taraf('AccountingSupplierParty'),
    aliciVergiNo: taraf('AccountingCustomerParty').vergiNo,
    faturaNo: deger(kok, 'ID'),
    tarih: tarihOku(deger(kok, 'IssueDate')),
    ettn: deger(kok, 'UUID'),
    iade: (deger(kok, 'InvoiceTypeCode') ?? '').toUpperCase() === 'IADE',
    paraBirimi: (deger(kok, 'DocumentCurrencyCode') ?? 'TRY').toUpperCase(),
    kdvler: [...kdvMap].sort((a, b) => b[0] - a[0]).map(([oran, e]) => ({ oran, ...e })),
    tevkifat,
    odenecek: tutarOku(deger(toplamlar, 'PayableAmount')),
    satirlar,
  };
}

// ─── Denetim ve özet ───────────────────────────────────────────────

/** Toplamlar birbirini tutuyor mu (matrah + KDV − tevkifat = ödenecek, 1 TL tolerans). Tutmuyorsa açıklama. */
export function tutarliMi(t: HavuzTanima): string | null {
  if (t.odenecek === null || t.kdvler.length === 0) return null;
  const hesap = t.kdvler.reduce((s, k) => s + k.matrah + k.kdv, 0) - t.tevkifat;
  return Math.abs(hesap - t.odenecek) > 100 ? 'Faturadaki toplamlar birbirini tutmuyor; tutarları kontrol edin.' : null;
}

/** KDV dahil toplam (tevkifat düşülmeden). */
export const tanimaToplami = (t: HavuzTanima): Kurus => t.kdvler.reduce((s, k) => s + k.matrah + k.kdv, 0);
