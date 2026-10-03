// Kat karşılığı yükümlülükleri: teslim tarihi, kira yardımı, gecikme cezası, nakit ödeme planı.
// Hiçbiri cari borcu değildir ve saklanmaz; sözleşmeden ve ödenenlerden hesaplanır.
// Ödenen = projede o arsa sahibine yazılmış giderler; nakit ve kira vadelerine tarih sırasıyla dağıtılır.
// Gecikme cezası ayrı gösterilir, kalana girmez (otomatik borç değildir).

import type { ArsaSahibiOdemesi, GecikmeCezasi, KatKarsiligiSozlesme, Kurus, Tarih } from '../veri/tipler';

/** Ay ekler; hedef ayda o gün yoksa ayın son günü (31 Ocak + 1 ay = 28/29 Şubat). */
export function ayEkle(t: Tarih, ay: number): Tarih {
  const [y, a, g] = t.split('-').map(Number) as [number, number, number];
  const toplam = y * 12 + (a - 1) + ay;
  const yil = Math.floor(toplam / 12);
  const ayNo = (toplam % 12) + 1;
  const sonGun = new Date(Date.UTC(yil, ayNo, 0)).getUTCDate();
  return `${yil}-${String(ayNo).padStart(2, '0')}-${String(Math.min(g, sonGun)).padStart(2, '0')}`;
}

/** Kesin tarih ya da "ruhsattan X ay"; ruhsat alınmamışsa null. */
export function teslimTarihiHesapla(s: Pick<KatKarsiligiSozlesme, 'teslimTarihi' | 'teslimSuresiAy'>, ruhsatTarihi: Tarih | null): Tarih | null {
  if (s.teslimSuresiAy !== null) return ruhsatTarihi ? ayEkle(ruhsatTarihi, s.teslimSuresiAy) : null;
  return s.teslimTarihi;
}

/** Aylık vadeler: başlangıç, +1 ay, … bitişe kadar (dahil). */
export function aylikVadeler(baslangic: Tarih, bitis: Tarih): Tarih[] {
  const sonuc: Tarih[] = [];
  for (let i = 0; i < 600; i++) {
    const v = ayEkle(baslangic, i);
    if (v > bitis) break;
    sonuc.push(v);
  }
  return sonuc;
}

export type VadeTuru = 'nakit' | 'kira';

export interface KatKarsiligiVadesi {
  cariId: string;
  tur: VadeTuru;
  /** Koşula bağlı nakit ödemede null. */
  vade: Tarih | null;
  tutar: Kurus;
  /** Ödenenler tarih sırasıyla dağıtıldıktan sonra kalan. */
  kalan: Kurus;
  aciklama: string;
  /** Nakit ödemede plan satırının kimliği. */
  planId?: string;
}

export interface ArsaSahibiYukumlulugu {
  cariId: string;
  nakitToplam: Kurus;
  /** Bugüne kadar doğan kira (teslim alınana kadar). */
  kiraAy: number;
  kiraDogan: Kurus;
  /** Teslim edilene kadar doğacak kira dahil (teslim tarihi biliniyorsa); "bitirmek için gereken para" için. */
  kiraTahmini: Kurus;
  cezaAy: number;
  cezaDogan: Kurus;
  odenen: Kurus;
  /** nakit + doğan kira − ödenen (ceza hariç). */
  kalan: Kurus;
  vadesiGecen: Kurus;
  vadeler: KatKarsiligiVadesi[];
}

export interface YukumlulukGirdisi {
  sozlesme: Pick<KatKarsiligiSozlesme, 'arsaSahipleri' | 'gecikmeCezasi'>;
  plan: (Pick<ArsaSahibiOdemesi, 'cariId' | 'vadeTarihi' | 'kosul' | 'tutar' | 'aciklama' | 'iptal'> & { id?: string })[];
  /** cariId → projede ona yazılmış giderlerin toplamı */
  odenen: ReadonlyMap<string, Kurus>;
  /** cariId → tahsis edilen daire sayısı (daire başı cezada) */
  daireSayisi: ReadonlyMap<string, number>;
  teslim: Tarih | null;
  bugun: Tarih;
}

/** Teslim tarihinden sonra geçen tam ay sayısı (teslim alınana ya da bugüne kadar). */
function gecikmeAyi(teslim: Tarih | null, bitis: Tarih): number {
  if (!teslim || bitis <= teslim) return 0;
  return aylikVadeler(teslim, bitis).length - 1;
}

const cezaTutari = (ceza: GecikmeCezasi | null, ay: number, daire: number) =>
  !ceza ? 0 : ceza.tutar * ay * (ceza.birim === 'daire_ay' ? daire : 1);

export function arsaSahibiYukumlulukleri(g: YukumlulukGirdisi): ArsaSahibiYukumlulugu[] {
  return g.sozlesme.arsaSahipleri.map((s) => {
    const bitis = s.teslimAlindi && s.teslimAlindi < g.bugun ? s.teslimAlindi : g.bugun;

    const nakit = g.plan
      .filter((p) => p.iptal === null && p.cariId === s.cariId)
      .map((p): KatKarsiligiVadesi => ({
        cariId: s.cariId,
        tur: 'nakit',
        vade: p.vadeTarihi,
        tutar: p.tutar,
        kalan: p.tutar,
        aciklama: p.aciklama || p.kosul,
        planId: p.id,
      }));

    // Kira: başlangıçtan teslim alınana kadar her ay; teslim alınmadıysa teslim tarihine kadar tahmin.
    const kiraVadeleri: KatKarsiligiVadesi[] = [];
    if (s.kiraAylik && s.kiraBaslangic) {
      const son = s.teslimAlindi ?? (g.teslim && g.teslim > g.bugun ? g.teslim : g.bugun);
      for (const v of aylikVadeler(s.kiraBaslangic, son)) {
        if (s.teslimAlindi && v >= s.teslimAlindi) break;
        kiraVadeleri.push({ cariId: s.cariId, tur: 'kira', vade: v, tutar: s.kiraAylik, kalan: s.kiraAylik, aciklama: 'Kira yardımı' });
      }
    }
    const dogmusKira = kiraVadeleri.filter((v) => v.vade! <= bitis);

    // Ödenenler önce vadesi olanlara tarih sırasıyla, sonra koşullu nakit ödemelere dağıtılır.
    const vadeler = [...nakit, ...kiraVadeleri].sort((a, b) => (a.vade ?? '9999').localeCompare(b.vade ?? '9999'));
    let dagitilacak = g.odenen.get(s.cariId) ?? 0;
    for (const v of vadeler) {
      const d = Math.min(dagitilacak, v.kalan);
      v.kalan -= d;
      dagitilacak -= d;
    }

    const nakitToplam = nakit.reduce((t, v) => t + v.tutar, 0);
    const kiraDogan = dogmusKira.reduce((t, v) => t + v.tutar, 0);
    const odenen = g.odenen.get(s.cariId) ?? 0;
    const cezaAy = gecikmeAyi(g.teslim, bitis);
    return {
      cariId: s.cariId,
      nakitToplam,
      kiraAy: dogmusKira.length,
      kiraDogan,
      kiraTahmini: kiraVadeleri.reduce((t, v) => t + v.tutar, 0),
      cezaAy,
      cezaDogan: cezaTutari(g.sozlesme.gecikmeCezasi, cezaAy, g.daireSayisi.get(s.cariId) ?? 0),
      odenen,
      kalan: nakitToplam + kiraDogan - odenen,
      vadesiGecen: vadeler.filter((v) => v.vade !== null && v.vade <= g.bugun).reduce((t, v) => t + v.kalan, 0),
      vadeler: vadeler.filter((v) => v.kalan > 0),
    };
  });
}

export type VadeDurumu = 'gecti' | 'yaklasiyor' | 'ileride' | 'kosullu';

/** Vade uyarısı: geçmiş, 30 gün içinde, ileride ya da koşula bağlı. */
export function vadeDurumu(vade: Tarih | null, bugun: Tarih, yakinGun = 30): VadeDurumu {
  if (!vade) return 'kosullu';
  if (vade < bugun) return 'gecti';
  const sinir = new Date(`${bugun}T00:00Z`);
  sinir.setUTCDate(sinir.getUTCDate() + yakinGun);
  return vade <= sinir.toISOString().slice(0, 10) ? 'yaklasiyor' : 'ileride';
}
