import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { FiyatKalemi, MaliyetSatiri } from '../veri/tipler';
import { basligiBul, hucreSayi, kalemOnerileri, metrajAktarimi, metrajSatirlari } from './metraj';
import { csvOku, xlsxOku } from './tabloOku';

const kalem = (id: string, ad: string, birim: string, tur: FiyatKalemi['tur'] = 'malzeme') => ({ id, ad, birim, tur, butceKalemiKodu: 'beton', fiyat: null }) as unknown as FiyatKalemi;

const TABLO = [
  ['SÜREX İNŞAAT METRAJ CETVELİ'],
  [],
  ['Poz No', 'İmalatın Cinsi', 'Birimi', 'Miktarı', 'Birim Fiyat', 'Tutarı'],
  [null, 'KABA İNŞAAT'],
  ['15.150.1005', 'C30/37 hazır beton dökülmesi', 'm³', 412.5, '3.300,00', 1361250],
  ['15.160.1003', 'Ø12 nervürlü beton çelik çubuğu', 'ton', '45,2', 26000, null],
  ['', 'Ø14 nervürlü demir', 'kg', 12000, 26, null],
  [null, 'Ara Toplam', null, null, null, 1500000],
  [null, 'İNCE İŞLER'],
  ['', 'İç cephe plastik boya', 'm²', 3200, null, null],
  ['', 'Özel cam korkuluk', 'mt', 0],
];

describe('metraj tablosu', () => {
  it('xlsx ve CSV okunur', () => {
    const sayfa = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>Birim &amp; ölçü</t></is></c></row>
<row r="3"><c r="B3"><v>412.5</v></c><c r="D3" t="str"><f>A1</f><v>x</v></c></row></sheetData></worksheet>`;
    const veri = zipSync({
      'xl/workbook.xml': strToU8('<workbook><sheets><sheet name="Metraj" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      'xl/_rels/workbook.xml.rels': strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      'xl/sharedStrings.xml': strToU8('<sst><si><r><t>İmalat</t></r><r><t xml:space="preserve"> cinsi</t></r></si></sst>'),
      'xl/worksheets/sheet1.xml': strToU8(sayfa),
    });
    expect(xlsxOku(veri)).toEqual([{ ad: 'Metraj', satirlar: [['İmalat cinsi', null, 'Birim & ölçü'], [], [null, 412.5, null, 'x']] }]);
    expect(csvOku('Tanım;Birim;Miktar\r\n"Beton; C30";m3;"1.250,5"\n').satirlar).toEqual([
      ['Tanım', 'Birim', 'Miktar'],
      ['Beton; C30', 'm3', '1.250,5'],
    ]);
  });

  it('başlık, satırlar, grup, toplam satırı atlanır', () => {
    expect(hucreSayi('1.250,5')).toBe(1250.5);
    expect(hucreSayi('12.5')).toBe(12.5);
    const b = basligiBul(TABLO)!;
    expect(b).toEqual({ satir: 2, sutunlar: { poz: 0, tanim: 1, birim: 2, miktar: 3, birimFiyat: 4, tutar: 5 } });
    const s = metrajSatirlari(TABLO, b.satir, b.sutunlar);
    expect(s.map((x) => [x.satirNo, x.tanim, x.miktar, x.birimFiyat, x.grup])).toEqual([
      [5, 'C30/37 hazır beton dökülmesi', 412.5, 330000, 'KABA İNŞAAT'],
      [6, 'Ø12 nervürlü beton çelik çubuğu', 45.2, 2600000, 'KABA İNŞAAT'],
      [7, 'Ø14 nervürlü demir', 12000, 2600, 'KABA İNŞAAT'],
      [10, 'İç cephe plastik boya', 3200, null, 'İNCE İŞLER'],
    ]);
  });

  it('kalem önerisi ve aktarım: aynı kaleme giden satırlar toplanır, kg → ton, serbest satır, Excel fiyatı isteğe bağlı', () => {
    const beton = kalem('b', 'Hazır beton C30/37', 'm³');
    const demir = kalem('d', 'Nervürlü demir Ø12', 'ton');
    const boya = kalem('y', 'Boyacı · İç boya (astar + 2 kat)', 'm²', 'iscilik');
    const kalemler = [beton, demir, boya, kalem('x', 'Hazır beton C25/30', 'm³')];
    expect(kalemOnerileri({ tanim: 'C30/37 hazır beton dökülmesi', birim: 'm³' }, kalemler, new Set()).map((k) => k.id)).toEqual(['b']);
    expect(kalemOnerileri({ tanim: 'İç cephe plastik boya', birim: 'm²' }, kalemler, new Set()).map((k) => k.id)).toEqual(['y']);
    const b = basligiBul(TABLO)!;
    const satirlar = metrajSatirlari(TABLO, b.satir, b.sutunlar);
    const hesapta = { id: 'h1', fiyatKalemiId: 'b' } as MaliyetSatiri;
    const r = metrajAktarimi(
      'metraj.xlsx',
      satirlar,
      new Map([
        [5, { tur: 'kalem', kalemId: 'b' }],
        [6, { tur: 'kalem', kalemId: 'd' }],
        [7, { tur: 'kalem', kalemId: 'd' }],
        [10, { tur: 'serbest', satirTuru: 'iscilik' }],
      ]),
      new Map(kalemler.map((k) => [k.id, k])),
      [hesapta],
      true,
    );
    expect(r.guncellenecek.get('h1')).toEqual({ miktar: 412.5, dayanak: 'metraj.xlsx: satır 5 · 412,5 m³', ozelFiyat: 330000 });
    expect(r.eklenecek.map((x) => [x.ad, x.miktar, x.birim, x.ozelFiyat, x.miktarKaynagi, x.fiyatKalemiId])).toEqual([
      ['İç cephe plastik boya', 3200, 'm²', null, 'proje', null],
      ['Nervürlü demir Ø12', 57.2, 'ton', 2600000, 'proje', 'd'],
    ]);
    expect(r.eklenecek[1]!.dayanak).toBe('metraj.xlsx: satır 6, 7 · 57,2 ton');
    const u = metrajAktarimi('m', satirlar, new Map([[10, { tur: 'kalem', kalemId: 'b' }]]), new Map(kalemler.map((k) => [k.id, k])), [], false);
    expect(u.uyarilar).toHaveLength(1);
  });
});
