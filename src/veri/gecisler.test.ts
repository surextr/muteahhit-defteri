import { describe, expect, it } from 'vitest';
import { TABLO_DONUSTURUCULERI } from './gecisler';

describe('şema 4 → 5', () => {
  it('proje adresi ve arsa alanı, firma bilgileri ve logo eklenir; var olan değerler korunur', () => {
    const sonuc = TABLO_DONUSTURUCULERI[4]!({
      proje: [{ id: 'p1', adres: 'Merkez', alanlar: { net: 100, brut: null, toplamInsaat: null, satilabilir: null } }],
      firma: [{ id: 'f1', ad: 'Firma' }],
      cari: [{ id: 'c1' }],
    });
    expect(sonuc.proje).toEqual([
      { id: 'p1', adres: 'Merkez', il: null, ilce: null, mahalle: null, alanlar: { arsa: null, net: 100, brut: null, toplamInsaat: null, satilabilir: null } },
    ]);
    expect(sonuc.firma).toEqual([
      {
        id: 'f1',
        ad: 'Firma',
        logo: null,
        bilgiler: { yetkili: '', telefon: '', eposta: '', web: '', adres: '', vergiDairesi: '', vergiNo: '' },
      },
    ]);
    expect(sonuc.cari).toEqual([{ id: 'c1' }]);
  });
});

describe('şema 5 → 6', () => {
  it('tek ada/parsel ve arsa alanı parsel listesine taşınır; boş proje boş liste olur', () => {
    const { proje } = TABLO_DONUSTURUCULERI[5]!({
      proje: [
        { id: 'p1', ada: '101', parsel: '5', alanlar: { arsa: 950, net: 100 } },
        { id: 'p2', ada: '', parsel: '', alanlar: { arsa: null, net: null } },
      ],
    });
    expect(proje).toEqual([
      { id: 'p1', alanlar: { net: 100 }, parseller: [{ ada: '101', parsel: '5', alanM2: 950 }], planlananBitis: null, gerceklesenBitis: null },
      { id: 'p2', alanlar: { net: null }, parseller: [], planlananBitis: null, gerceklesenBitis: null },
    ]);
  });

  it('bölümün hattı katın içindeki numara sırasıdır; blok ve sözleşmeye varsayılanlar gelir', () => {
    const t = TABLO_DONUSTURUCULERI[5]!({
      bagimsizBolum: [
        { id: 'b10', katId: 'k2', no: '10' },
        { id: 'b4', katId: 'k1', no: '4' },
        { id: 'b9', katId: 'k2', no: '9' },
        { id: 'b5', katId: 'k1', no: '5' },
      ],
      blok: [{ id: 'A' }],
      katKarsiligiSozlesme: [{ id: 's1' }],
    });
    expect((t.bagimsizBolum as { id: string; hat: number }[]).map((b) => [b.id, b.hat])).toEqual([
      ['b10', 2],
      ['b4', 1],
      ['b9', 1],
      ['b5', 2],
    ]);
    expect(t.blok).toEqual([{ id: 'A', asansorSayisi: 0, kapaliOtopark: false, siginak: false, jenerator: false }]);
    expect(t.katKarsiligiSozlesme).toEqual([{ id: 's1', arsaSahipleri: [], payYontemi: 'brut' }]);
  });
});

describe('şema 6 → 7', () => {
  const bolum = (id: string, odaTipi: string | null, ek: Record<string, unknown> = {}) => ({
    id,
    firmaId: 'f1',
    katId: 'k1',
    iptal: null,
    odaTipi,
    ozellikler: [],
    ...ek,
  });

  it('oda tipi yazısı sayılara, dubleks işarete; çözülemeyen yazı özelliklere; firmaya eklenen tipler', () => {
    const t = TABLO_DONUSTURUCULERI[6]!({
      firma: [{ id: 'f1', ayarlar: { kdvMaliyeteDahil: true, anaParaBirimi: 'TRY' } }],
      kat: [
        { id: 'k1', tip: 'normal' },
        { id: 'k2', tip: 'cati_dubleksi' },
      ],
      bagimsizBolum: [
        bolum('b1', '3+1'),
        bolum('b2', '4+2 dubleks'),
        bolum('b3', 'Penthouse', { ozellikler: ['Havuz'] }),
        bolum('b4', null, { katId: 'k2' }),
        bolum('b5', 'stüdyo'),
      ],
    });
    const b = Object.fromEntries((t.bagimsizBolum as Record<string, unknown>[]).map((x) => [x.id, x]));
    expect(b.b1).toMatchObject({ odaSayisi: 3, salonSayisi: 1, dubleks: null });
    expect(b.b1).not.toHaveProperty('odaTipi');
    expect(b.b2).toMatchObject({ odaSayisi: 4, salonSayisi: 2, dubleks: 'cati' });
    expect(b.b3).toMatchObject({ odaSayisi: null, ozellikler: ['Havuz', 'Penthouse'] });
    expect(b.b4).toMatchObject({ odaSayisi: null, dubleks: 'cati' });
    expect(b.b5).toMatchObject({ odaSayisi: 1, salonSayisi: 0 });
    expect((t.firma as { ayarlar: unknown }[])[0]!.ayarlar).toEqual({
      kdvMaliyeteDahil: true,
      anaParaBirimi: 'TRY',
      odaTipleri: { eklenen: ['4+2'], gizli: [] },
    });
  });
});

describe('şema 7 → 8', () => {
  it('hazır kalemlere ad eşleşmesiyle sistem kodu; kullanıcının kalemi null', () => {
    const t = TABLO_DONUSTURUCULERI[7]!({
      kalem: [
        { id: 'a', ustKalemId: null, ad: 'Arsa ve kat karşılığı giderleri' },
        { id: 'b', ustKalemId: 'a', ad: 'Kira yardımı' },
        { id: 'c', ustKalemId: null, ad: 'Benim kalemim' },
      ],
      katKarsiligiSozlesme: [{ id: 's', gecikmeCezasi: 'Aylık 20 bin', kiraYardimi: '', arsaSahipleri: [{ cariId: 'x', hisse: 100 }] }],
    });
    expect((t.kalem as { sistemKodu: string | null }[]).map((k) => k.sistemKodu)).toEqual(['arsa_ve_kat_karsiligi_giderleri', 'kira_yardimi', null]);
    expect((t.katKarsiligiSozlesme as Record<string, unknown>[])[0]).toMatchObject({
      not: 'Gecikme cezası: Aylık 20 bin',
      gecikmeCezasi: null,
      arsaSahipleri: [{ cariId: 'x', hisse: 100, kiraAylik: null, teslimAlindi: null }],
    });
  });
});

describe('şema 8 → 9', () => {
  it('firmaya ortak sözleşme maddeleri; eski usta tipi alanları yeni yapıya', () => {
    const t = TABLO_DONUSTURUCULERI[8]!({
      firma: [{ id: 'f1', ayarlar: { kdvMaliyeteDahil: true } }],
      ustaTipi: [{ id: 'u1', ad: 'Eski', fiyatlamaBirimi: 'm²', hazirKalemler: [{ ad: 'Duvar', birim: 'm²' }], varsayilanSartlar: ['Şart'], sablonSurumu: 3 }],
    });
    const f = (t.firma as { ayarlar: { ortakMaddeler: { id: string }[] } }[])[0]!;
    expect(f.ayarlar.ortakMaddeler.map((m) => m.id)).toEqual(['olcum', 'bosluk', 'malzeme', 'baslama', 'ilave', 'ayip', 'kesinti']);
    expect((t.ustaTipi as Record<string, unknown>[])[0]).toMatchObject({
      kalemler: [{ ad: 'Duvar', birim: 'm²', aciklama: '' }],
      ozelSartlar: ['Şart'],
      sablonSurumu: 3,
      gizli: false,
      sistemKodu: null,
    });
  });
});

describe('şema 9 → 10 ve taşınan kalem', () => {
  it('hazır tipler ana kalemden alt kaleme; firmanın değiştirdiği tipe dokunulmaz; su yalıtım satırları', () => {
    const t = TABLO_DONUSTURUCULERI[9]!({
      ustaTipi: [
        { id: '1', sistemKodu: 'demir_dograma', butceKalemiKodu: 'ince_insaat', kalemler: [{ ad: 'Korkuluk', birim: 'metre', aciklama: '' }] },
        { id: '2', sistemKodu: 'dolapci', butceKalemiKodu: 'boya', kalemler: [] },
        { id: '3', sistemKodu: 'su_yalitimci', butceKalemiKodu: 'temel_yalitimi', kalemler: [{ ad: 'Islak hacim yalıtımı', birim: 'm²', aciklama: '' }] },
      ],
    });
    const u = t.ustaTipi as { butceKalemiKodu: string; kalemler: { butceKalemiKodu: string | null }[] }[];
    expect(u[0]).toMatchObject({ butceKalemiKodu: 'demir_dograma_ve_korkuluk', kalemler: [{ butceKalemiKodu: null }] });
    expect(u[1]!.butceKalemiKodu).toBe('boya');
    expect(u[2]!.kalemler[0]!.butceKalemiKodu).toBe('islak_hacim_yalitimi');
  });

  it('eski projedeki "Hafriyat ve temel › Temel yalıtımı" yerinde kalır, kodunu alır', () => {
    const t = TABLO_DONUSTURUCULERI[7]!({
      kalem: [
        { id: 'h', ustKalemId: null, ad: 'Hafriyat ve temel' },
        { id: 'y', ustKalemId: 'h', ad: 'Temel yalıtımı' },
      ],
    });
    expect((t.kalem as { ustKalemId: string | null; sistemKodu: string }[])[1]).toMatchObject({ ustKalemId: 'h', sistemKodu: 'temel_yalitimi' });
  });
});
