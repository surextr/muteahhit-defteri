import { vadeGorunur, type VadeKalemi } from '../hesap/bugun';
import { puantajOzeti } from '../hesap/gunluk';
import { uyariEsigi } from '../hesap/ilerleme';
import { maliyetOzeti } from '../hesap/maliyet';
import { talepDurumu, teslimMiktarlari } from '../hesap/malzeme';
import {
  gruplariOlustur,
  mukerrerFaturalar,
  nakitAcigi,
  type GizlemeListesi,
  type YapilacakGrubu,
  type YapilacakKodu,
  type YapilacakOge,
} from '../hesap/yapilacaklar';
import type { Yetki } from '../hesap/yetki';
import type { Depo } from '../veri/depo';
import type { Firma, Tarih } from '../veri/tipler';
import { bugunOzeti } from './bugun';
import { giderleriListele } from './gider';
import { projeIlerlemeOzetleri } from './ilerleme';

// "Tamamlanacak işler": kayıtları okuyup saf kurallara (hesap/yapilacaklar.ts) verir. Bugün ekranının vade ve taslak
// hesabı (bugunOzeti) yeniden kullanılır; vade görünürlüğü Bugün ile aynı kuraldır (vadeGorunur).

export const META_YAPILACAK_GIZLEME = 'yapilacakGizleme';

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const yuzde = (n: number) => `%${Math.round(n)}`;
const gunEkle = (t: Tarih, n: number): Tarih => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export async function yapilacaklariGetir(
  depo: Depo,
  firma: Firma,
  bugun: Tarih,
  erisim: Set<string> | null,
  yetkiVar: (y: Yetki) => boolean,
  gizleme: GizlemeListesi,
): Promise<YapilacakGrubu[]> {
  const firmaId = firma.id;
  const k = { firmaId };
  const gorunur = (projeId: string | null) => !erisim || projeId === null || erisim.has(projeId);
  const [ozet, giderler, satirlar, belgeler, odemeler, hakedisler, talepler, hareketler, gunlukler, hesaplar, katalog, projeler, cariler, havuz, ilerlemeler] =
    await Promise.all([
      bugunOzeti(depo, firmaId, bugun, erisim),
      giderleriListele(depo, firmaId, {}, bugun),
      depo.listele('giderSatiri', k),
      depo.listele('belge', k),
      depo.listele('odeme', k),
      depo.listele('hakedis', k),
      depo.listele('malzemeTalebi', k),
      depo.listele('malzemeHareketi', k),
      depo.listele('santiyeGunlugu', k),
      depo.listele('maliyetHesabi', k),
      depo.listele('fiyatKalemi', k),
      depo.listele('proje', k),
      depo.listele('cari', k),
      depo.listele('belgeHavuzu', k),
      projeIlerlemeOzetleri(depo, firmaId, firma.ayarlar.kdvMaliyeteDahil, uyariEsigi(firma.ayarlar)),
    ]);
  const projeAdi = new Map(projeler.map((p) => [p.id, p.ad]));
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const belgeli = new Set(aktif(belgeler).map((b) => `${b.bagliTur}:${b.bagliId}`));
  const doksanGun = gunEkle(bugun, -90);
  const s: Partial<Record<YapilacakKodu, YapilacakOge[]>> = {};

  // Vadeler (Bugün ile aynı; yetkiye göre süzülür).
  const vadeOgesi = (kod: YapilacakKodu) => (v: VadeKalemi): YapilacakOge => ({
    anahtar: `${kod}:${v.tur}:${v.id}`,
    baslik: v.baslik,
    ayrinti: `${v.ayrinti} · vade ${tarihYaz(v.vade)}`,
    tutar: v.tutar,
    yol: v.yol,
  });
  const gorur = (v: VadeKalemi) => vadeGorunur(yetkiVar, v);
  const cikis = (v: VadeKalemi) => v.tur === 'odenecek_fatura' || v.tur === 'verilen_cek' || v.tur === 'kredi_taksiti';
  const gecikmis = ozet.vadeler.gecikmis.filter(gorur);
  const yaklasan = ozet.vadeler.yaklasan.filter(gorur);
  s.geciken_odeme = gecikmis.filter(cikis).map(vadeOgesi('geciken_odeme'));
  s.geciken_tahsilat = gecikmis.filter((v) => !cikis(v)).map(vadeOgesi('geciken_tahsilat'));

  // Nakit: vadesi geçmiş + 7 gün içinde ödenecekler; tahsilattan yalnız vadesi gelmemiş olanlar sayılır (gecikmiş
  // tahsilatın geleceği belli değil).
  const topla = (l: VadeKalemi[]) => l.reduce((t, v) => t + v.tutar, 0);
  s.nakit_acigi = nakitAcigi({
    odenecek: topla([...gecikmis, ...yaklasan].filter(cikis)),
    tahsilEdilecek: topla(yaklasan.filter((v) => !cikis(v))),
    kasaBanka: ozet.hesaplar.filter((h) => h.hesap.paraBirimi === 'TRY').reduce((t, h) => t + h.bakiye, 0),
    bugun,
    yol: yetkiVar('rapor') ? 'rapor' : 'hesaplar',
  });

  // Giderler: mükerrer, kalemsiz, vadesiz, taramasız.
  const alislar = giderler.filter((g) => g.gider.tur === 'alis' && gorunur(g.gider.projeId));
  const elleGirilen = alislar.filter((g) => !g.gider.hakedisId && !g.gider.krediId);
  s.mukerrer_fatura = mukerrerFaturalar(
    elleGirilen.map((g) => ({ id: g.gider.id, cariId: g.gider.cariId, cariAdi: g.cariAdi ?? '?', faturaNo: g.gider.faturaNo, tarih: g.gider.tarih, toplam: g.gider.toplam })),
  );
  const kalemsizGider = new Set(aktif(satirlar).filter((x) => x.kalemId === null).map((x) => x.giderId));
  const giderEtiketi = (g: (typeof alislar)[number]) => [g.gider.faturaNo && `Fatura ${g.gider.faturaNo}`, g.projeAdi ?? 'Genel gider', tarihYaz(g.gider.tarih)].filter(Boolean).join(' · ');
  s.kalemsiz_gider = elleGirilen
    .filter((g) => kalemsizGider.has(g.gider.id))
    .map((g) => ({ anahtar: `kalemsiz_gider:${g.gider.id}`, baslik: g.cariAdi ?? 'Carisiz', ayrinti: giderEtiketi(g), tutar: g.gider.toplam, yol: `giderler/${g.gider.id}` }));
  s.vadesiz_borc = alislar
    .filter((g) => g.kalan > 0 && !g.gider.vadeTarihi && g.gider.cariId)
    .map((g) => ({ anahtar: `vadesiz_borc:${g.gider.id}`, baslik: g.cariAdi ?? '?', ayrinti: giderEtiketi(g), tutar: g.kalan, yol: `giderler/${g.gider.id}` }));
  s.taramasiz_fatura = elleGirilen
    .filter((g) => g.gider.faturaNo && g.gider.tarih >= doksanGun && !belgeli.has(`gider:${g.gider.id}`))
    .map((g) => ({ anahtar: `taramasiz_fatura:${g.gider.id}`, baslik: g.cariAdi ?? 'Carisiz', ayrinti: giderEtiketi(g), tutar: g.gider.toplam, yol: `giderler/${g.gider.id}` }));

  // Ödemeler: havale/EFT ile cariye yapılan, dekontu olmayan.
  s.dekontsuz_odeme = aktif(odemeler)
    .filter((o) => o.yon === 'odeme' && o.amac === 'cari' && o.yontem === 'havale' && o.tarih >= doksanGun && gorunur(o.projeId) && !belgeli.has(`odeme:${o.id}`))
    .sort((a, b) => b.tarih.localeCompare(a.tarih))
    .map((o) => ({
      anahtar: `dekontsuz_odeme:${o.id}`,
      baslik: (o.cariId && cariAdi.get(o.cariId)) || 'Carisiz',
      ayrinti: [tarihYaz(o.tarih), o.aciklama].filter(Boolean).join(' · '),
      tutar: o.tutar,
      yol: `odemeler/${o.id}`,
    }));

  // Onay ve imza bekleyenler.
  s.hakedis_onayi = aktif(hakedisler)
    .filter((h) => !h.onay && gorunur(h.projeId))
    .map((h) => ({
      anahtar: `hakedis_onayi:${h.id}`,
      baslik: `${cariAdi.get(h.cariId) ?? '?'} · ${h.no}. hakediş`,
      ayrinti: [projeAdi.get(h.projeId), h.donemAsama, tarihYaz(h.tarih)].filter(Boolean).join(' · '),
      yol: `hakedisler/${h.id}`,
    }));
  s.imzasiz_sozlesme = ozet.taslakSozlesmeler.map((x) => ({ anahtar: `imzasiz_sozlesme:${x.id}`, baslik: x.ad, ayrinti: 'Taslak usta sözleşmesi', yol: x.yol }));
  s.imzasiz_satis = ozet.imzasizSatislar.map((x) => ({ anahtar: `imzasiz_satis:${x.id}`, baslik: x.ad, ayrinti: 'Rezerve satış', yol: x.yol }));
  const belgeAdi = new Map(belgeler.map((b) => [b.id, b.ad]));
  s.bekleyen_belge = aktif(havuz)
    .filter((h) => h.durum === 'bekliyor')
    .map((h) => ({
      anahtar: `bekleyen_belge:${h.id}`,
      baslik: belgeAdi.get(h.belgeId) ?? 'Belge',
      ayrinti: `Yüklendi ${tarihYaz(h.olusturmaZamani.slice(0, 10))}`,
      tutar: h.tanima?.odenecek ?? undefined,
      yol: `havuz/${h.id}`,
    }));

  // İlerleme sapması (ana kalem başına).
  s.ilerleme_sapmasi = [...ilerlemeler]
    .filter(([pid]) => gorunur(pid) && projeAdi.has(pid))
    .flatMap(([pid, o]) =>
      o.uyariKalemleri.map((x) => ({
        anahtar: `ilerleme_sapmasi:${pid}:${x.kalemId}`,
        baslik: `${projeAdi.get(pid)} · ${x.ad}`,
        ayrinti: `Harcama ${yuzde(x.harcamaYuzdesi)}, ilerleme ${yuzde(x.ilerleme)} (${Math.round(x.harcamaYuzdesi - x.ilerleme)} puan önde)`,
        yol: `projeler/${pid}/ilerleme`,
      })),
    );

  // Puantaj: bu aydan önceki, gidere yazılmamış yevmiyeler (proje + işçi başına).
  const ayBasi = `${bugun.slice(0, 7)}-01`;
  const aktifGiderler = new Set(giderler.map((g) => g.gider.id));
  const projeGunlukleri = new Map<string, typeof gunlukler>();
  for (const g of aktif(gunlukler)) if (gorunur(g.projeId)) projeGunlukleri.set(g.projeId, [...(projeGunlukleri.get(g.projeId) ?? []), g]);
  s.puantaj_yazilmamis = [...projeGunlukleri].flatMap(([pid, l]) =>
    puantajOzeti(l, aktifGiderler).flatMap((kisi) => {
      const eski = kisi.yazilmamis.filter((y) => y.tarih < ayBasi);
      if (!eski.length) return [];
      const son = eski.map((y) => y.tarih).sort().at(-1)!;
      return [
        {
          anahtar: `puantaj_yazilmamis:${pid}:${kisi.cariId}:${son}`,
          baslik: cariAdi.get(kisi.cariId) ?? '?',
          ayrinti: `${projeAdi.get(pid) ?? ''} · ${eski.length} gün, son ${tarihYaz(son)}`,
          tutar: eski.reduce((t, y) => t + y.tutar, 0),
          yol: `projeler/${pid}/puantaj`,
        },
      ];
    }),
  );

  // Malzeme: siparişi verilmiş, gereken tarihi geçmiş, tamamı gelmemiş talepler.
  s.geciken_teslim = aktif(talepler)
    .filter((t) => gorunur(t.projeId) && t.gerekenTarih && t.gerekenTarih < bugun)
    .filter((t) => {
      const d = talepDurumu(t, teslimMiktarlari(t.id, hareketler));
      return d === 'siparis' || d === 'kismen';
    })
    .map((t) => {
      const tedarikci = t.teklifler.find((x) => x.id === t.seciliTeklifId);
      return {
        anahtar: `geciken_teslim:${t.id}`,
        baslik: `${projeAdi.get(t.projeId) ?? ''} · ${t.satirlar.map((x) => x.ad).slice(0, 2).join(', ')}${t.satirlar.length > 2 ? ` +${t.satirlar.length - 2}` : ''}`,
        ayrinti: `${tedarikci ? `${cariAdi.get(tedarikci.cariId) ?? '?'} · ` : ''}gerekiyordu ${tarihYaz(t.gerekenTarih!)}`,
        yol: `talepler/${t.id}`,
      };
    });

  // Taslak maliyet hesaplarında fiyatsız / miktarsız satırlar.
  const katalogHaritasi = new Map(katalog.map((x) => [x.id, x]));
  s.eksik_maliyet = aktif(hesaplar)
    .filter((h) => !h.onay && gorunur(h.projeId))
    .flatMap((h) => {
      const o = maliyetOzeti(h, katalogHaritasi);
      const eksik = new Set([...o.fiyatsiz, ...o.miktarsiz].map((x) => x.satir.id)).size;
      if (!eksik) return [];
      return [
        {
          anahtar: `eksik_maliyet:${h.id}:${eksik}`,
          baslik: h.ad,
          ayrinti: [h.projeId ? projeAdi.get(h.projeId) : 'Projesiz', `${o.fiyatsiz.length} fiyatsız, ${o.miktarsiz.length} miktarsız satır`].filter(Boolean).join(' · '),
          yol: `maliyet/${h.id}`,
        },
      ];
    });

  return gruplariOlustur(s, yetkiVar, gizleme, bugun);
}
