import type { CekDurumu, CekSenet, Kurus, Tarih } from '../veri/tipler';

// Çek/senet vade özeti ve karşılık uyarısı. Veritabanını bilmez.

const aktif = (k: { iptal: unknown }): boolean => k.iptal === null;

/** Parası bize gelecek alınan çekler: portföyde ya da bankada tahsilde (ciro edilen artık bizim değil). */
const TAHSIL_EDILECEK = new Set<CekDurumu>(['portfoyde', 'tahsilde']);

const ayAnahtari = (t: Tarih) => t.slice(0, 7);

export interface AyVadeOzeti {
  /** 'YYYY-AA' */
  ay: string;
  odenecek: Kurus;
  odenecekAdet: number;
  tahsilEdilecek: Kurus;
  tahsilAdet: number;
}

export interface VadeOzeti {
  /** Vadesi geçmiş, hâlâ açık çekler (bu ayın öncesi dahil, bugünden önce). */
  gecikmis: AyVadeOzeti;
  /** Bu aydan başlayarak `aySayisi` ay; vadesi geçmişler bu aya girmez. */
  aylar: AyVadeOzeti[];
}

function sonrakiAy(ay: string): string {
  const [y, a] = ay.split('-').map(Number) as [number, number];
  return a === 12 ? `${y + 1}-01` : `${y}-${String(a + 1).padStart(2, '0')}`;
}

/** Aylık vade özeti: ödenecek verilen çekler (verildi) ve tahsil edilecek alınan çekler (portföyde, tahsilde). */
export function vadeOzeti(cekler: CekSenet[], bugun: Tarih, aySayisi = 3): VadeOzeti {
  const bos = (ay: string): AyVadeOzeti => ({ ay, odenecek: 0, odenecekAdet: 0, tahsilEdilecek: 0, tahsilAdet: 0 });
  const aylar: AyVadeOzeti[] = [];
  let ay = ayAnahtari(bugun);
  for (let i = 0; i < aySayisi; i++, ay = sonrakiAy(ay)) aylar.push(bos(ay));
  const gecikmis = bos('gecikmis');
  for (const c of cekler) {
    if (!aktif(c)) continue;
    const odenecek = c.yon === 'verilen' && c.durum === 'verildi';
    const tahsil = c.yon === 'alinan' && TAHSIL_EDILECEK.has(c.durum);
    if (!odenecek && !tahsil) continue;
    const hedef = c.vadeTarihi < bugun ? gecikmis : aylar.find((x) => x.ay === ayAnahtari(c.vadeTarihi));
    if (!hedef) continue;
    if (odenecek) {
      hedef.odenecek += c.tutar;
      hedef.odenecekAdet++;
    } else {
      hedef.tahsilEdilecek += c.tutar;
      hedef.tahsilAdet++;
    }
  }
  return { gecikmis, aylar };
}

export interface KarsilikUyarisi {
  hesapId: string;
  /** Vadesi `gun` gün içinde (ya da geçmiş) ödenmemiş verilen çeklerin toplamı. */
  gereken: Kurus;
  bakiye: Kurus;
  /** gereken − bakiye (artı). */
  eksik: Kurus;
  cekIdler: string[];
}

const gunEkle = (t: Tarih, gun: number) => new Date(Date.parse(`${t}T00:00Z`) + gun * 86_400_000).toISOString().slice(0, 10);

/**
 * Verilen çekin vadesi `gun` gün içindeyse (ya da geçtiyse) ve bağlı banka hesabının bakiyesi
 * o hesaba yazılmış bu çeklerin toplamına yetmiyorsa uyarı. Hesabı seçilmemiş çek uyarıya girmez.
 */
export function karsilikUyarilari(cekler: CekSenet[], bakiyeler: Map<string, Kurus>, bugun: Tarih, gun = 7): KarsilikUyarisi[] {
  const sinir = gunEkle(bugun, gun);
  const hesaplar = new Map<string, { gereken: Kurus; cekIdler: string[] }>();
  for (const c of cekler) {
    if (!aktif(c) || c.yon !== 'verilen' || c.durum !== 'verildi' || !c.hesapId || c.vadeTarihi > sinir) continue;
    const h = hesaplar.get(c.hesapId) ?? { gereken: 0, cekIdler: [] };
    h.gereken += c.tutar;
    h.cekIdler.push(c.id);
    hesaplar.set(c.hesapId, h);
  }
  return [...hesaplar.entries()]
    .map(([hesapId, h]) => {
      const bakiye = bakiyeler.get(hesapId) ?? 0;
      return { hesapId, gereken: h.gereken, bakiye, eksik: h.gereken - bakiye, cekIdler: h.cekIdler };
    })
    .filter((u) => u.eksik > 0);
}
