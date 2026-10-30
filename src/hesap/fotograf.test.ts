import { describe, expect, it } from 'vitest';
import { aylaraGore, cekimTarihiBul, dosyaAdindanTarih, exifOku, konumdanProje, konumMetniCoz, mesafeKm } from './fotograf';

const baytlar = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
// 8×8 JPEG, EXIF büyük uçlu (MM): DateTime 2026:01:01, DateTimeOriginal 2026:10:12 14:35:22, GPS 36°53'24"K 30°42'36"D (Antalya)
const EXIFLI = baytlar('/9j/4AAQSkZJRgABAQAAAQABAAD/4QDaRXhpZgAATU0AKgAAAAgAAwEyAAIAAAAUAAAAModpAAQAAAABAAAARoglAAQAAAABAAAAbAAAAAAyMDI2OjAxOjAxIDAwOjAwOjAwAAABkAMAAgAAABQAAABYAAAAADIwMjY6MTA6MTIgMTQ6MzU6MjIAAAQAAQACAAAAAk4AAAAAAgAFAAAAAwAAAKIAAwACAAAAAkUAAAAABAAFAAAAAwAAALoAAAAAAAAAJAAAAAEAAAA1AAAAAQAAABgAAAABAAAAHgAAAAEAAAAqAAAAAQAAACQAAAAB/9sAQwAIBgYHBgUIBwcHCQkICgwUDQwLCwwZEhMPFB0aHx4dGhwcICQuJyAiLCMcHCg3KSwwMTQ0NB8nOT04MjwuMzQy/9sAQwEJCQkMCwwYDQ0YMiEcITIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy/8AAEQgACAAIAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8Ajooor5o+wP/Z');
const EXIFSIZ = baytlar('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwCOiiivmj7A/9k=');

/** Küçük uçlu (II) en küçük EXIF: yalnız DateTimeOriginal. */
function kucukUcluJpeg(tarih: string): Uint8Array {
  const t = new Uint8Array(200);
  const v = new DataView(t.buffer);
  t.set([0x49, 0x49]);
  v.setUint16(2, 42, true);
  v.setUint32(4, 8, true);
  v.setUint16(8, 1, true); // IFD0: 1 etiket
  v.setUint16(10, 0x8769, true);
  v.setUint16(12, 4, true);
  v.setUint32(14, 1, true);
  v.setUint32(18, 26, true); // Exif IFD 26'da
  v.setUint16(26, 1, true);
  v.setUint16(28, 0x9003, true);
  v.setUint16(30, 2, true);
  v.setUint32(32, 20, true);
  v.setUint32(36, 50, true);
  for (let i = 0; i < tarih.length; i++) t[50 + i] = tarih.charCodeAt(i);
  const app1 = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...t]);
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff, ...app1, 0xff, 0xd9]);
}

describe('exifOku', () => {
  it('çekim tarihini ve GPS konumunu okur (büyük uçlu)', () => {
    const e = exifOku(EXIFLI);
    expect(e.tarih).toBe('2026-10-12');
    expect(e.zaman).toBe('14:35');
    expect(e.konum!.enlem).toBeCloseTo(36.89, 2);
    expect(e.konum!.boylam).toBeCloseTo(30.71, 2);
  });
  it('küçük uçlu EXIF', () => {
    expect(exifOku(kucukUcluJpeg('2025:03:04 08:09:10'))).toEqual({ tarih: '2025-03-04', zaman: '08:09', konum: null });
  });
  it('EXIF yoksa, bozuk ya da JPEG değilse boş döner', () => {
    expect(exifOku(EXIFSIZ)).toEqual({ tarih: null, zaman: null, konum: null });
    expect(exifOku(new Uint8Array([1, 2, 3]))).toEqual({ tarih: null, zaman: null, konum: null });
    expect(exifOku(EXIFLI.subarray(0, 60))).toEqual({ tarih: null, zaman: null, konum: null });
    expect(exifOku(kucukUcluJpeg('2025:13:40 08:09:10')).tarih).toBeNull();
  });
});

describe('dosyaAdindanTarih', () => {
  it.each([
    ['IMG-20261012-WA0003.jpg', '2026-10-12', null],
    ['IMG_20261012_143522.jpg', '2026-10-12', '14:35'],
    ['PXL_20261012_143522123.jpg', '2026-10-12', null],
    ['20261012_143522.jpg', '2026-10-12', '14:35'],
    ['WhatsApp Image 2026-10-12 at 14.35.22.jpeg', '2026-10-12', '14:35'],
    ['Screenshot_2026-10-12-14-35-22.png', '2026-10-12', '14:35'],
  ])('%s', (ad, tarih, zaman) => {
    expect(dosyaAdindanTarih(ad)).toEqual({ tarih, zaman });
  });
  it('tarih olmayan sayıları almaz', () => {
    expect(dosyaAdindanTarih('IMG_4521.JPG')).toBeNull();
    expect(dosyaAdindanTarih('foto-20261340.jpg')).toBeNull();
    expect(dosyaAdindanTarih('120261012.jpg')).toBeNull();
  });
});

describe('cekimTarihiBul', () => {
  it('önce EXIF, sonra dosya adı, yoksa elle', () => {
    expect(cekimTarihiBul(exifOku(EXIFLI), 'IMG-20200101-WA0001.jpg').kaynak).toBe('exif');
    expect(cekimTarihiBul(exifOku(EXIFSIZ), 'IMG-20200101-WA0001.jpg')).toEqual({ tarih: '2020-01-01', zaman: null, kaynak: 'dosyaAdi' });
    expect(cekimTarihiBul(exifOku(EXIFSIZ), 'foto.jpg')).toEqual({ tarih: null, zaman: null, kaynak: 'elle' });
  });
});

describe('konum', () => {
  const antalya = { enlem: 36.8969, boylam: 30.7133 };
  it('mesafe', () => {
    expect(mesafeKm(antalya, { enlem: 39.9334, boylam: 32.8597 })).toBeCloseTo(386, 0);
    expect(mesafeKm(antalya, antalya)).toBe(0);
  });
  it('en yakın proje, yarıçap içinde', () => {
    const projeler = [
      { id: 'a', konum: { enlem: 36.9, boylam: 30.715 } },
      { id: 'b', konum: { enlem: 36.8972, boylam: 30.7135 } },
      { id: 'c', konum: null },
    ];
    expect(konumdanProje(antalya, projeler)?.id).toBe('b');
    expect(konumdanProje({ enlem: 37.5, boylam: 30.7 }, projeler)).toBeNull();
    expect(konumdanProje(null, projeler)).toBeNull();
  });
  it('yazılan konum ve Google Haritalar bağlantısı', () => {
    expect(konumMetniCoz('36.8969, 30.7133')).toEqual(antalya);
    expect(konumMetniCoz('36,8969 30,7133')).toEqual(antalya);
    expect(konumMetniCoz('https://www.google.com/maps/@36.8969,30.7133,17z')).toEqual(antalya);
    expect(konumMetniCoz('https://maps.google.com/?q=36.8969,30.7133')).toEqual(antalya);
    expect(konumMetniCoz('https://www.google.com/maps/place/X/@36.1,30.1,17z/data=!3d36.8969!4d30.7133')).toEqual(antalya);
    expect(konumMetniCoz('Antalya')).toBeNull();
  });
});

it('aylaraGore: en yeni ay ve fotoğraf önce', () => {
  const f = (cekimTarihi: string, cekimZamani: string | null = null, olusturmaZamani = '2026-01-01T00:00:00Z') => ({ cekimTarihi, cekimZamani, olusturmaZamani });
  const g = aylaraGore([f('2026-09-01'), f('2026-10-02', '08:00'), f('2026-10-02', '15:00'), f('2026-10-20')]);
  expect(g.map((x) => x.ay)).toEqual(['2026-10', '2026-09']);
  expect(g[0]!.fotograflar.map((x) => x.cekimTarihi + (x.cekimZamani ?? ''))).toEqual(['2026-10-20', '2026-10-0215:00', '2026-10-0208:00']);
});
