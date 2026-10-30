// DXF okuyucu (saf, parça parça beslenir): büyük dosyalar belleğe bütün alınmadan okunur. Yalnız model uzayındaki
// (ENTITIES bölümü, kağıt uzayı hariç) çizgi, çoklu çizgi, yazı ve blok yerleştirmeleri alınır; ölçüm için yeterli.

export interface Yazi {
  x: number;
  y: number;
  /** Yazı yüksekliği (çizim biriminde). */
  h: number;
  metin: string;
  katman: string;
  /** Derece; 0 = yatay. */
  aci: number;
}

export interface BlokYeri {
  ad: string;
  katman: string;
  x: number;
  y: number;
}

export interface DxfCizim {
  /** $INSUNITS (4 mm, 5 cm, 6 m…); çoğu çizimde güvenilmez, ölçek ayrıca tahmin edilir. */
  birimKodu: number | null;
  surum: string | null;
  yazilar: Yazi[];
  bloklar: BlokYeri[];
  /** Katman → [ortaX, ortaY, uzunluk, …] (çizgi ve çoklu çizgi parçaları). */
  parcalar: Map<string, number[]>;
}

/** DXF yazısındaki biçim kodlarını temizler: \P, {\f…;}, \U+00B2, %%c… */
export function dxfMetniTemizle(m: string): string {
  return m
    .replace(/\\U\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\M\+[0-9A-Fa-f]{5}/g, '')
    .replace(/\\[Pp]/g, ' ')
    .replace(/\\[fFcCHhTtQqWwAa][^;\\{}]*;/g, '')
    .replace(/\\S([^;]*?)[#^/]([^;]*);/g, '$1/$2')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/\\\\/g, '\\')
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoO]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Dosyanın başından metin kodlaması: AutoCAD 2007 (AC1021) ve sonrası UTF-8; öncesi kod sayfası (Türkçe ANSI_1254). */
export function dxfKodlamasi(bas: string): string {
  const surum = /\$ACADVER\s*\r?\n\s*1\s*\r?\n\s*(AC\d{4})/.exec(bas)?.[1];
  if (surum && surum >= 'AC1021') return 'utf-8';
  const sayfa = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*(\S+)/.exec(bas)?.[1]?.toUpperCase();
  if (sayfa?.startsWith('ANSI_')) return `windows-${sayfa.slice(5)}`;
  return surum ? 'windows-1254' : 'utf-8';
}

interface Varlik {
  tip: string;
  katman: string;
  kagit: boolean;
  x: number[];
  y: number[];
  x2: number;
  y2: number;
  h: number;
  aci: number;
  metin: string;
  ad: string;
  kapali: boolean;
}

const yeniVarlik = (tip: string): Varlik => ({ tip, katman: '0', kagit: false, x: [], y: [], x2: NaN, y2: NaN, h: 0, aci: 0, metin: '', ad: '', kapali: false });

export class DxfOkuyucu {
  private kalan = '';
  private kod: number | null = null;
  private bolum = '';
  private bolumAdiBekleniyor = false;
  private baslikDegiskeni = '';
  private v: Varlik | null = null;
  /** Eski tip POLYLINE: köşeleri VERTEX'lerle gelir, SEQEND'de biter. */
  private poli: Varlik | null = null;
  private sonuc: DxfCizim = { birimKodu: null, surum: null, yazilar: [], bloklar: [], parcalar: new Map() };

  besle(parca: string): void {
    const metin = this.kalan + parca;
    let bas = 0;
    for (;;) {
      const son = metin.indexOf('\n', bas);
      if (son < 0) break;
      let satir = metin.slice(bas, son);
      if (satir.endsWith('\r')) satir = satir.slice(0, -1);
      bas = son + 1;
      if (this.kod === null) {
        const k = Number(satir.trim());
        this.kod = Number.isFinite(k) ? k : null;
      } else {
        this.cift(this.kod, satir);
        this.kod = null;
      }
    }
    this.kalan = metin.slice(bas);
  }

  bitir(): DxfCizim {
    if (this.kalan) this.besle('\n');
    this.varlikBitir();
    return this.sonuc;
  }

  private cift(kod: number, deger: string): void {
    if (kod === 0) {
      this.varlikBitir();
      const d = deger.trim();
      if (d === 'SECTION') this.bolumAdiBekleniyor = true;
      else if (d === 'ENDSEC') this.bolum = '';
      else if (this.bolum === 'ENTITIES') this.v = yeniVarlik(d);
      return;
    }
    if (this.bolumAdiBekleniyor && kod === 2) {
      this.bolum = deger.trim();
      this.bolumAdiBekleniyor = false;
      return;
    }
    if (this.bolum === 'HEADER') {
      if (kod === 9) this.baslikDegiskeni = deger.trim();
      else if (this.baslikDegiskeni === '$INSUNITS' && kod === 70) this.sonuc.birimKodu = Number(deger);
      else if (this.baslikDegiskeni === '$ACADVER' && kod === 1) this.sonuc.surum = deger.trim();
      return;
    }
    const v = this.v;
    if (!v) return;
    switch (kod) {
      case 8:
        v.katman = deger.trim();
        break;
      case 67:
        v.kagit = deger.trim() === '1';
        break;
      case 10:
        v.x.push(Number(deger));
        break;
      case 20:
        v.y.push(Number(deger));
        break;
      case 11:
        v.x2 = Number(deger);
        break;
      case 21:
        v.y2 = Number(deger);
        break;
      case 40:
        if (v.tip === 'TEXT' || v.tip === 'MTEXT') v.h = Number(deger);
        break;
      case 50:
        if (v.tip === 'TEXT' || v.tip === 'MTEXT') v.aci = Number(deger);
        break;
      case 70:
        if (v.tip === 'LWPOLYLINE' || v.tip === 'POLYLINE') v.kapali = (Number(deger) & 1) === 1;
        break;
      case 1:
        v.metin += deger;
        break;
      case 3:
        if (v.tip === 'MTEXT') v.metin += deger;
        break;
      case 2:
        if (v.tip === 'INSERT') v.ad = deger.trim();
        break;
    }
  }

  private parca(katman: string, x1: number, y1: number, x2: number, y2: number): void {
    const u = Math.hypot(x2 - x1, y2 - y1);
    if (!Number.isFinite(u) || u === 0) return;
    let l = this.sonuc.parcalar.get(katman);
    if (!l) this.sonuc.parcalar.set(katman, (l = []));
    l.push((x1 + x2) / 2, (y1 + y2) / 2, u);
  }

  private cokluCizgi(v: Varlik): void {
    const n = Math.min(v.x.length, v.y.length);
    for (let i = 1; i < n; i++) this.parca(v.katman, v.x[i - 1]!, v.y[i - 1]!, v.x[i]!, v.y[i]!);
    if (v.kapali && n > 2) this.parca(v.katman, v.x[n - 1]!, v.y[n - 1]!, v.x[0]!, v.y[0]!);
  }

  private varlikBitir(): void {
    const v = this.v;
    this.v = null;
    if (!v) return;
    if (v.tip === 'VERTEX') {
      if (this.poli && v.x.length && v.y.length) {
        this.poli.x.push(v.x[0]!);
        this.poli.y.push(v.y[0]!);
      }
      return;
    }
    if (v.tip === 'SEQEND') {
      if (this.poli) this.cokluCizgi(this.poli);
      this.poli = null;
      return;
    }
    if (v.kagit) return;
    switch (v.tip) {
      case 'LINE':
        if (v.x.length && v.y.length) this.parca(v.katman, v.x[0]!, v.y[0]!, v.x2, v.y2);
        break;
      case 'LWPOLYLINE':
        this.cokluCizgi(v);
        break;
      case 'POLYLINE':
        this.poli = { ...v, x: [], y: [] };
        break;
      case 'TEXT':
      case 'MTEXT': {
        const metin = dxfMetniTemizle(v.metin);
        if (metin && v.x.length && v.y.length) this.sonuc.yazilar.push({ x: v.x[0]!, y: v.y[0]!, h: v.h, metin, katman: v.katman, aci: v.aci });
        break;
      }
      case 'INSERT':
        if (v.ad && v.x.length && v.y.length) this.sonuc.bloklar.push({ ad: v.ad, katman: v.katman, x: v.x[0]!, y: v.y[0]! });
        break;
    }
  }
}
