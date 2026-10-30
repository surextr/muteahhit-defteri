import { kalanTutar } from '../hesap/bakiye';
import { vadeleriGrupla, type VadeGruplari, type VadeKalemi } from '../hesap/bugun';
import type { Depo } from '../veri/depo';
import type { Kurus, Tarih } from '../veri/tipler';
import { giderleriListele } from './gider';
import { bekleyenSayisi } from './havuz';
import { hesaplariListele, type HesapOzeti } from './hesap';
import { krediOzetleri, krediVadeleri } from './kredi';
import { bolumNo } from '../hesap/bolum';

// "Bugün" ana ekranı: vadesi gelen/geçen ödeme ve tahsilatlar, çekler, onay bekleyen belgeler, taslaklar, kasa/banka.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');

export interface BugunOzeti {
  vadeler: VadeGruplari;
  /** Vadesi yazılmamış ödenmemiş fatura sayısı ve tutarı (vade listesine girmez). */
  vadesizBorc: { adet: number; tutar: Kurus };
  bekleyenBelge: number;
  taslakSozlesmeler: { id: string; ad: string; yol: string }[];
  imzasizSatislar: { id: string; ad: string; yol: string }[];
  hesaplar: HesapOzeti[];
  /** Yeni firmada "İlk adımlar": hangileri yapılmış. */
  baslangic: { hesap: boolean; proje: boolean; cari: boolean; gider: boolean };
}

/**
 * Kişinin erişebildiği projelerin (null: hepsi) kayıtlarından. Projesiz kayıtlar (genel gider, çek) herkese görünür;
 * görünecek bölümleri ekran yetkilere göre seçer.
 */
export async function bugunOzeti(depo: Depo, firmaId: string, bugun: Tarih, erisim: Set<string> | null, gun = 7): Promise<BugunOzeti> {
  const k = { firmaId };
  const [giderler, alacaklar, eslestirmeler, cekler, cariler, sozlesmeler, satislar, bolumler, bloklar, hesaplar, belge] = await Promise.all([
    giderleriListele(depo, firmaId, {}, bugun),
    depo.listele('alacak', k),
    depo.listele('eslestirme', k),
    depo.listele('cekSenet', k),
    depo.listele('cari', k),
    depo.listele('ustaSozlesmesi', k),
    depo.listele('satis', k),
    depo.listele('bagimsizBolum', k),
    depo.listele('blok', k),
    hesaplariListele(depo, firmaId),
    bekleyenSayisi(depo, firmaId),
  ]);
  const projeler = await depo.listele('proje', k);
  const gorunur = (projeId: string | null) => !erisim || projeId === null || erisim.has(projeId);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const blokAdi = new Map(bloklar.map((b) => [b.id, b.ad]));
  const bolum = new Map(bolumler.map((b) => [b.id, bolumNo(blokAdi.get(b.blokId), b.no)]));
  const kalemler: VadeKalemi[] = [];
  let vadesiz = { adet: 0, tutar: 0 };

  for (const g of giderler) {
    if (g.gider.tur !== 'alis' || g.kalan <= 0 || !gorunur(g.gider.projeId)) continue;
    if (!g.gider.vadeTarihi) {
      vadesiz = { adet: vadesiz.adet + 1, tutar: vadesiz.tutar + g.kalan };
      continue;
    }
    kalemler.push({
      tur: 'odenecek_fatura',
      id: g.gider.id,
      vade: g.gider.vadeTarihi,
      tutar: g.kalan,
      baslik: g.cariAdi ?? 'Carisiz',
      ayrinti: [g.gider.faturaNo, g.projeAdi].filter(Boolean).join(' · ') || `Fatura ${tarihYaz(g.gider.tarih)}`,
      yol: `giderler/${g.gider.id}`,
    });
  }
  const satisBolumu = new Map(aktif(satislar).map((s) => [s.id, bolum.get(s.bolumId) ?? '']));
  for (const a of aktif(alacaklar)) {
    if (!gorunur(a.projeId)) continue;
    const kalan = kalanTutar('alacak', a, a.tutar, eslestirmeler);
    if (kalan <= 0) continue;
    kalemler.push({
      tur: 'tahsil_alacak',
      id: a.id,
      vade: a.vadeTarihi ?? a.tarih,
      tutar: kalan,
      baslik: cariAdi.get(a.cariId) ?? '?',
      ayrinti: a.kaynakTur === 'satis' && a.kaynakId ? `${satisBolumu.get(a.kaynakId) ?? 'Satış'} · ${a.aciklama.replace(/^.*?satışı · /, '')}` : a.aciklama,
      yol: a.kaynakTur === 'satis' && a.kaynakId ? `satislar/${a.kaynakId}` : `cariler/${a.cariId}`,
    });
  }
  for (const c of aktif(cekler)) {
    const acik = c.yon === 'alinan' ? c.durum === 'portfoyde' || c.durum === 'tahsilde' : c.durum === 'verildi';
    if (!acik) continue;
    kalemler.push({
      tur: c.yon === 'alinan' ? 'alinan_cek' : 'verilen_cek',
      id: c.id,
      vade: c.vadeTarihi,
      tutar: c.tutar,
      baslik: cariAdi.get(c.cariId) ?? '?',
      ayrinti: [c.tur === 'cek' ? 'Çek' : 'Senet', c.banka, c.seriNo].filter(Boolean).join(' · '),
      yol: `cekler/${c.id}`,
    });
  }
  for (const v of krediVadeleri(await krediOzetleri(depo, firmaId, bugun))) {
    if (!gorunur(v.projeId)) continue;
    kalemler.push({ tur: 'kredi_taksiti', id: v.taksitId, vade: v.vadeTarihi, tutar: v.kalan, baslik: v.krediAdi, ayrinti: 'Kredi taksiti', yol: `krediler/${v.krediId}` });
  }

  return {
    vadeler: vadeleriGrupla(kalemler, bugun, gun),
    vadesizBorc: vadesiz,
    bekleyenBelge: belge,
    taslakSozlesmeler: aktif(sozlesmeler)
      .filter((s) => !s.onay && gorunur(s.projeId))
      .map((s) => ({ id: s.id, ad: `${cariAdi.get(s.cariId) ?? '?'} · ${s.ustaTipiAdi}`, yol: `sozlesmeler/${s.id}` })),
    imzasizSatislar: aktif(satislar)
      .filter((s) => !s.onay && gorunur(s.projeId))
      .map((s) => ({ id: s.id, ad: `${bolum.get(s.bolumId) ?? '?'} · ${cariAdi.get(s.cariId) ?? '?'}`, yol: `satislar/${s.id}` })),
    hesaplar: hesaplar.filter((h) => !h.hesap.iptal),
    baslangic: {
      hesap: hesaplar.some((h) => !h.hesap.iptal),
      proje: projeler.some((p) => p.iptal === null),
      // Program kendi açtığı "Vergi dairesi" kartı sayılmaz.
      cari: cariler.some((c) => c.iptal === null && !c.roller.includes('vergi_dairesi')),
      gider: giderler.length > 0,
    },
  };
}
