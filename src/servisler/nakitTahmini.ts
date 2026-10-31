import type { VadeTuru } from '../hesap/bugun';
import { bolumNo } from '../hesap/bolum';
import { plandanBorcuDus, type NakitKalemi, type NakitKaynagi } from '../hesap/nakitTahmini';
import { PLAN_TURU_ADI, satisTutarlari } from '../hesap/satis';
import { donemAdi, kdvTakvimi, type KdvTakvimi } from '../hesap/kdvTakvimi';
import { gelecekTekrarlar, PERIYOT_ADI } from '../hesap/sabitGider';
import { tevkifatDonemleri } from '../hesap/tevkifat';
import type { Depo } from '../veri/depo';
import type { Kurus, Tarih } from '../veri/tipler';
import { acikVadeler } from './bugun';
import { birimToplamlari, hesaplariListele } from './hesap';
import { katKarsiligiOzeti } from './katKarsiligi';
import { firmaSatinAlmaDurumlari } from './malzeme';
import { sozlesmeTaahhuduGetir } from './taahhut';

// Nakit tahmininin kalemleri: Bugün ekranının açık vadeleri (kesin) + usta sözleşmesi ödeme planları, arsa sahibine
// nakit plan ve kira, rezerve satışların planı (planlı). Haftalara dağıtım saf `nakitTahmini`nde; ekran seçenekleri
// (planlı say / gecikmiş tahsilatı say) kalemleri yeniden okumadan uygulanır.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const gunEkle = (t: Tarih, n: number): Tarih => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

const VADE_KAYNAGI: Record<VadeTuru, { kaynak: NakitKaynagi; yon: 'giris' | 'cikis' }> = {
  odenecek_fatura: { kaynak: 'fatura', yon: 'cikis' },
  verilen_cek: { kaynak: 'verilen_cek', yon: 'cikis' },
  kredi_taksiti: { kaynak: 'kredi', yon: 'cikis' },
  tahsil_alacak: { kaynak: 'alacak', yon: 'giris' },
  alinan_cek: { kaynak: 'alinan_cek', yon: 'giris' },
};

export interface NakitKalemleri {
  kalemler: NakitKalemi[];
  kasaBanka: Kurus;
  /** KDV beyannamesi tahmini (proje kısıtlı kişide null). */
  kdv: KdvTakvimi | null;
  /** Tapu / teslim tarihi bilinmeyen imzalı satışların KDV'si (tahmine girmedi). */
  tarihsizSatisKdv: Kurus;
  /** Arsa sahibine koşula bağlı (vadesiz) nakit ödemeler: tarihi belli olmadığı için tahmine girmez. */
  kosulluArsa: Kurus;
}

export async function nakitKalemleri(depo: Depo, firmaId: string, bugun: Tarih, erisim: Set<string> | null): Promise<NakitKalemleri> {
  const k = { firmaId };
  const [vadeler, hesaplar, sozlesmeler, projeler, satislar, cariler, bolumler, bloklar, sabitler, giderler, giderSatirlari, eslestirmeler] = await Promise.all([
    acikVadeler(depo, firmaId, bugun, erisim),
    hesaplariListele(depo, firmaId),
    depo.listele('ustaSozlesmesi', k),
    depo.listele('proje', k),
    depo.listele('satis', k),
    depo.listele('cari', k),
    depo.listele('bagimsizBolum', k),
    depo.listele('blok', k),
    depo.listele('sabitGider', k),
    depo.listele('gider', k),
    depo.listele('giderSatiri', k),
    depo.listele('eslestirme', k),
  ]);
  const gorunur = (projeId: string | null) => !erisim || projeId === null || erisim.has(projeId);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const projeAdi = new Map(projeler.map((p) => [p.id, p.ad]));
  const blokAdi = new Map(bloklar.map((b) => [b.id, b.ad]));
  const bolum = new Map(bolumler.map((b) => [b.id, bolumNo(blokAdi.get(b.blokId), b.no)]));

  const kalemler: NakitKalemi[] = [
    ...vadeler.kalemler.map((v): NakitKalemi => ({ ...VADE_KAYNAGI[v.tur], tarih: v.vade, tutar: v.tutar, baslik: v.baslik, ayrinti: v.ayrinti, yol: v.yol })),
    ...vadeler.vadesiz.map((v): NakitKalemi => ({ kaynak: 'fatura', yon: 'cikis', tarih: null, tutar: v.tutar, baslik: v.baslik, ayrinti: `${v.ayrinti} · vadesiz`, yol: v.yol })),
  ];

  // Usta sözleşmesi ödeme planı: ödenmemiş satırlardan, hakedişle borca dönüşüp henüz ödenmemiş kısım düşülür.
  for (const s of aktif(sozlesmeler).filter((x) => x.onay && gorunur(x.projeId))) {
    const t = await sozlesmeTaahhuduGetir(depo, firmaId, s, bugun);
    const satirlar = t.plan.filter((p) => p.kalan > 0).map((p) => ({ tarih: p.plan.vadeTarihi, tutar: p.kalan, aciklama: p.plan.aciklama }));
    for (const p of plandanBorcuDus(satirlar, Math.max(0, t.kalanBorc))) {
      kalemler.push({
        kaynak: 'sozlesme_plani',
        yon: 'cikis',
        tarih: p.tarih,
        tutar: p.tutar,
        baslik: `${cariAdi.get(s.cariId) ?? '?'} · ${s.ustaTipiAdi}`,
        ayrinti: [projeAdi.get(s.projeId), p.aciklama || 'Ödeme planı'].filter(Boolean).join(' · '),
        yol: `sozlesmeler/${s.id}`,
      });
    }
  }

  // Arsa sahibine nakit ödeme planı ve kira yardımı (teslime kadar tahmin dahil).
  let kosulluArsa = 0;
  for (const p of aktif(projeler).filter((x) => gorunur(x.id))) {
    const o = await katKarsiligiOzeti(depo, firmaId, p.id, bugun);
    if (!o) continue;
    for (const y of o.yukumlulukler)
      for (const v of y.vadeler) {
        if (v.kalan <= 0) continue;
        if (!v.vade) {
          kosulluArsa += v.kalan;
          continue;
        }
        kalemler.push({
          kaynak: 'arsa_sahibi',
          yon: 'cikis',
          tarih: v.vade,
          tutar: v.kalan,
          baslik: cariAdi.get(v.cariId) ?? '?',
          ayrinti: `${p.ad} · ${v.tur === 'kira' ? 'Kira yardımı' : v.aciklama || 'Nakit ödeme'}`,
          yol: `projeler/${p.id}/arsa`,
        });
      }
  }

  // Rezerve (imzalanmamış) satışların planı: imzadan sonra alacak olur, o zamana kadar planlı giriş.
  for (const s of aktif(satislar).filter((x) => !x.onay && gorunur(x.projeId))) {
    for (const p of s.plan) {
      kalemler.push({
        kaynak: 'rezerve_satis',
        yon: 'giris',
        tarih: p.vadeTarihi,
        tutar: p.tutar,
        baslik: cariAdi.get(s.cariId) ?? '?',
        ayrinti: `${bolum.get(s.bolumId) ?? 'Satış'} · ${p.aciklama || PLAN_TURU_ADI[p.tur]} (rezerve)`,
        yol: `satislar/${s.id}`,
      });
    }
  }

  // Siparişi verilmiş, faturası (tamamı) gelmemiş malzeme: beklenen ödeme gününde (gereken gün + vade) planlı çıkış.
  for (const x of await firmaSatinAlmaDurumlari(depo, firmaId, erisim)) {
    if (x.satinAlma.faturalanmamis <= 0 || x.talep.kapandi || !x.odemeTarihi) continue;
    kalemler.push({
      kaynak: 'siparis',
      yon: 'cikis',
      tarih: x.odemeTarihi,
      tutar: x.satinAlma.faturalanmamis,
      baslik: x.tedarikciId ? cariAdi.get(x.tedarikciId) ?? '?' : '?',
      ayrinti: `${projeAdi.get(x.talep.projeId) ?? ''} · ${x.talep.satirlar.map((s) => s.ad).slice(0, 2).join(', ')} (faturası gelmedi)`,
      yol: `talepler/${x.talep.id}`,
    });
  }

  // Sabit giderler: bugünden 13 hafta (ve biraz fazlası) sonrasına kadar, o ay gideri girilmemiş tekrarlar.
  const ufuk = gunEkle(bugun, 7 * 26);
  const aktifGiderler = aktif(giderler);
  const satirKalemleri = new Map<string, string[]>();
  for (const x of aktif(giderSatirlari)) if (x.kalemId) satirKalemleri.set(x.giderId, [...(satirKalemleri.get(x.giderId) ?? []), x.kalemId]);
  const ayGiderleri = aktifGiderler.map((g) => ({ ay: g.tarih.slice(0, 7), cariId: g.cariId, kalemIdleri: satirKalemleri.get(g.id) ?? [] }));
  for (const t of gelecekTekrarlar(sabitler.filter((x) => gorunur(x.projeId)), ayGiderleri, bugun, ufuk)) {
    kalemler.push({
      kaynak: 'sabit_gider',
      yon: 'cikis',
      tarih: t.tarih,
      tutar: t.sabit.tutar,
      baslik: t.sabit.ad,
      ayrinti: [t.sabit.cariId && cariAdi.get(t.sabit.cariId), t.sabit.projeId ? projeAdi.get(t.sabit.projeId) : 'Genel', PERIYOT_ADI[t.sabit.periyot]].filter(Boolean).join(' · '),
      yol: 'sabit-giderler',
    });
  }

  // KDV tevkifatı: dönemin ödenmemiş kısmı, beyan son günü (izleyen ayın 28'i). Geçmişse gecikmiş ödemedir.
  if (!erisim) {
    const vd = cariler.find((c) => c.roller.includes('vergi_dairesi') && !c.iptal);
    for (const d of tevkifatDonemleri(giderler, giderSatirlari, eslestirmeler)) {
      if (d.kalan <= 0) continue;
      kalemler.push({ kaynak: 'tevkifat', yon: 'cikis', tarih: d.sonGun, tutar: d.kalan, baslik: 'Vergi dairesi', ayrinti: `${donemAdi(d.donem)} KDV tevkifatı (KDV 2)`, yol: vd ? `cariler/${vd.id}` : 'cariler' });
    }
  }

  // KDV beyannamesi: hesaplanan (imzalı satışın KDV'si tapu, yoksa teslim gününde) − indirilecek (alışların KDV'si) − devreden.
  let kdv: KdvTakvimi | null = null;
  let tarihsizSatisKdv = 0;
  if (!erisim) {
    const giderTarihi = new Map(aktifGiderler.map((g) => [g.id, g.tarih]));
    const indirilecek = aktif(giderSatirlari).flatMap((x) => (giderTarihi.has(x.giderId) && x.kdvTutari ? [{ tarih: giderTarihi.get(x.giderId)!, kdv: x.kdvTutari }] : []));
    const hesaplanan = aktif(satislar)
      .filter((x) => x.onay)
      .flatMap((x) => {
        const t = x.tapuTarihi ?? x.teslimEdildi ?? x.teslimTarihi;
        const tutar = satisTutarlari(x).kdv;
        if (!t) tarihsizSatisKdv += tutar;
        return t && tutar ? [{ tarih: t, kdv: tutar }] : [];
      });
    kdv = kdvTakvimi(hesaplanan, indirilecek, bugun, ufuk);
    for (const d of kdv.donemler) {
      if (d.odenecek <= 0) continue;
      kalemler.push({ kaynak: 'kdv', yon: 'cikis', tarih: d.sonGun, tutar: d.odenecek, baslik: 'Vergi dairesi', ayrinti: `${donemAdi(d.donem)} KDV beyannamesi (tahmini)`, yol: 'nakit' });
    }
  }

  const tl = (kart: boolean) => birimToplamlari(hesaplar, kart).find((x) => x.paraBirimi === 'TRY')?.toplam ?? 0;
  return { kalemler, kasaBanka: tl(false) + tl(true), kosulluArsa, kdv, tarihsizSatisKdv };
}
