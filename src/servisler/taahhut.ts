import { sozlesmeToplami } from '../hesap/ustaSozlesmesi';
import { sozlesmeTaahhudu, taahhutToplami, type SozlesmeTaahhudu } from '../hesap/taahhut';
import type { Depo } from '../veri/depo';
import type { Kurus, OdemePlani, Tarih, UstaSozlesmesi } from '../veri/tipler';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import { ustaSozlesmesiGetir } from './ustaSozlesmesi';

// Taahhüt ve tahmini ödeme planı. Plan taahhüttür, borç doğurmaz; ödenen, sözleşmenin hakediş giderlerine eşleşen
// ödemelerdir (avans gidere bağlanınca sayılır).

const aktif = <T extends { iptal: unknown }>(liste: T[]) => liste.filter((k) => k.iptal === null);
const TARIH = /^\d{4}-\d{2}-\d{2}$/;

export async function sozlesmeOdemePlani(depo: Depo, firmaId: string, sozlesmeId: string): Promise<OdemePlani[]> {
  return aktif(await depo.listele('odemePlani', { sozlesmeId, firmaId })).sort((a, b) => a.vadeTarihi.localeCompare(b.vadeTarihi));
}

export interface PlanSatiriGirdisi {
  /** Var olan satır; yeni satırda yok. */
  id?: string;
  vadeTarihi: Tarih;
  tutar: Kurus;
  aciklama: string;
}

/** Planı bütün olarak kaydeder: listede olmayan satır iptal edilir, değişen güncellenir, yeni eklenir. */
export async function odemePlaniKaydet(depo: Depo, servis: KayitServisi, sozlesmeId: string, satirlar: PlanSatiriGirdisi[], gerekce?: string): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  const h: string[] = [];
  for (const s of satirlar) {
    if (!TARIH.test(s.vadeTarihi)) h.push('Her satırın vade tarihini seçin.');
    if (!Number.isInteger(s.tutar) || s.tutar <= 0) h.push('Her satırın tutarı sıfırdan büyük olmalı.');
  }
  if (h.length > 0) throw new IsKuraliHatasi([...new Set(h)].join(' '));
  await depo.islem(async () => {
    if (!(await ustaSozlesmesiGetir(depo, firmaId, sozlesmeId))) throw new IsKuraliHatasi('Sözleşme bulunamadı.');
    const mevcut = await sozlesmeOdemePlani(depo, firmaId, sozlesmeId);
    const kalan = new Set(satirlar.map((s) => s.id).filter(Boolean));
    for (const m of mevcut) if (!kalan.has(m.id)) await servis.iptal('odemePlani', m.id, gerekce);
    for (const s of satirlar) {
      const veri = { vadeTarihi: s.vadeTarihi, tutar: s.tutar, aciklama: s.aciklama.trim() };
      if (s.id && mevcut.some((m) => m.id === s.id)) await servis.guncelle('odemePlani', s.id, veri, gerekce);
      else await servis.ekle('odemePlani', { sozlesmeId, ...veri });
    }
  });
}

async function sozlesmeOdenen(depo: Depo, firmaId: string, giderIdleri: string[]): Promise<Kurus> {
  let toplam = 0;
  for (const id of giderIdleri) {
    toplam += aktif(await depo.listele('eslestirme', { hedefId: id, firmaId }))
      .filter((e) => e.hedefTur === 'gider')
      .reduce((t, e) => t + e.tutar, 0);
  }
  return toplam;
}

export async function sozlesmeTaahhuduGetir(depo: Depo, firmaId: string, s: UstaSozlesmesi, bugun: Tarih): Promise<SozlesmeTaahhudu> {
  const [hakedisler, iadeler, plan] = await Promise.all([
    depo.listele('hakedis', { sozlesmeId: s.id, firmaId }),
    depo.listele('teminatIadesi', { sozlesmeId: s.id, firmaId }),
    sozlesmeOdemePlani(depo, firmaId, s.id),
  ]);
  const giderIdleri = hakedisler.filter((h) => h.iptal === null && h.onay && h.giderId).map((h) => h.giderId!);
  const { toplam, eksikMiktar } = sozlesmeToplami(s.kalemler);
  return sozlesmeTaahhudu({
    sozlesmeTutari: toplam,
    eksikMiktar,
    hakedisler,
    teminatIadeleri: iadeler,
    odenen: await sozlesmeOdenen(depo, firmaId, giderIdleri),
    plan,
    bugun,
  });
}

export interface TaahhutSatiri {
  sozlesme: UstaSozlesmesi;
  cariAdi: string;
  taahhut: SozlesmeTaahhudu;
}

/** Projenin bütün usta sözleşmeleri (taslaklar hariç) ve toplamları. */
export async function projeTaahhutleri(depo: Depo, firmaId: string, projeId: string, bugun: Tarih): Promise<{ satirlar: TaahhutSatiri[]; toplam: ReturnType<typeof taahhutToplami>; taslakSayisi: number }> {
  const [sozlesmeler, cariler] = await Promise.all([depo.listele('ustaSozlesmesi', { projeId, firmaId }), depo.listele('cari', { firmaId })]);
  const ad = new Map(cariler.map((c) => [c.id, c.ad]));
  const aktifler = aktif(sozlesmeler);
  const satirlar: TaahhutSatiri[] = [];
  for (const s of aktifler.filter((x) => x.onay)) {
    satirlar.push({ sozlesme: s, cariAdi: ad.get(s.cariId) ?? '?', taahhut: await sozlesmeTaahhuduGetir(depo, firmaId, s, bugun) });
  }
  satirlar.sort((a, b) => b.taahhut.kalanBorc - a.taahhut.kalanBorc || a.cariAdi.localeCompare(b.cariAdi, 'tr'));
  return { satirlar, toplam: taahhutToplami(satirlar.map((x) => x.taahhut)), taslakSayisi: aktifler.length - satirlar.length };
}
