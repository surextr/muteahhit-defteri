import { cariOner, kayitliOlanlar, turOner, type BankaHareketi, type HareketTuru } from '../hesap/bankaHareketi';
import { otomatikDagit } from '../hesap/eslestirme';
import type { Depo } from '../veri/depo';
import type { Kurus, Tarih } from '../veri/tipler';
import { giderOlustur } from './gider';
import { hesapDetayiGetir, transferYap } from './hesap';
import { IsKuraliHatasi, type KayitServisi } from './kayitServisi';
import { krediOzetleri, krediTaksitiOde, krediVadeleri } from './kredi';
import { acikGiderler, odemeYap, tahsilatKaydet } from './odeme';

// Banka hareketlerini dosyadan alma: dosyadaki her hareket programdaki hesap hareketleriyle eşlenir; kayıtlı olmayanlar
// için tür ve cari önerilir, kullanıcı onaylayınca ödeme / tahsilat / masraf gideri / transfer / kredi taksiti yazılır.

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);

export interface AktarimSatiri {
  hareket: BankaHareketi;
  /** Programda zaten olan hareket (kayıt türü ve açıklaması). */
  kayitli: { kayitTur: string; aciklama: string } | null;
  tur: HareketTuru;
  cariId: string | null;
  /** Tutarı tutan ödenmemiş kredi taksiti. */
  kredi: { krediId: string; taksitId: string; ad: string; vade: Tarih } | null;
}

export interface BankaAktarimi {
  satirlar: AktarimSatiri[];
  /** Programdaki hesap bakiyesi. */
  bakiye: Kurus;
}

export async function bankaAktarimiHazirla(depo: Depo, firmaId: string, hesapId: string, hareketler: BankaHareketi[], bugun: Tarih): Promise<BankaAktarimi> {
  const detay = await hesapDetayiGetir(depo, firmaId, hesapId);
  if (!detay) throw new IsKuraliHatasi('Hesap bulunamadı.');
  const mevcut = detay.hareketler.filter((h) => h.kayitTur !== 'acilisBakiyesi').map((h) => ({ id: `${h.kayitTur}:${h.kayitId}:${h.tur}`, tarih: h.tarih, tutar: h.tutar, aciklama: h.aciklama, kayitTur: h.kayitTur }));
  const eslesen = kayitliOlanlar(hareketler, mevcut);
  const mevcutHarita = new Map(mevcut.map((m) => [m.id, m]));
  const cariler = aktif(await depo.listele('cari', { firmaId })).filter((c) => !c.roller.includes('vergi_dairesi'));
  const taksitler = krediVadeleri(await krediOzetleri(depo, firmaId, bugun));
  const kullanilanTaksit = new Set<string>();
  const satirlar = hareketler.map((h): AktarimSatiri => {
    const m = eslesen.get(h.satirNo);
    if (m) {
      const x = mevcutHarita.get(m)!;
      return { hareket: h, kayitli: { kayitTur: x.kayitTur, aciklama: x.aciklama }, tur: 'atla', cariId: null, kredi: null };
    }
    const cariId = cariOner(h.aciklama, cariler);
    const t = h.tutar < 0 ? taksitler.find((v) => !kullanilanTaksit.has(v.taksitId) && v.kalan === -h.tutar) : undefined;
    if (t) kullanilanTaksit.add(t.taksitId);
    const kredi = t ? { krediId: t.krediId, taksitId: t.taksitId, ad: t.krediAdi, vade: t.vadeTarihi } : null;
    return { hareket: h, kayitli: null, tur: turOner(h, !!cariId, !!kredi), cariId, kredi };
  });
  return { satirlar, bakiye: detay.bakiye };
}

export interface HareketSecimi {
  tur: HareketTuru;
  cariId?: string | null;
  karsiHesapId?: string | null;
  kredi?: { krediId: string; taksitId: string } | null;
}

/** Bir hareketi seçilen türde kaydeder. Ödeme carinin açık borçlarına en eski vadeden dağıtılır, artanı avans kalır. */
export async function bankaHareketiKaydet(depo: Depo, servis: KayitServisi, hesapId: string, h: BankaHareketi, s: HareketSecimi, bugun: Tarih): Promise<void> {
  const firmaId = servis.oturum.firmaId;
  const tutar = Math.abs(h.tutar);
  const aciklama = h.aciklama.slice(0, 200);
  switch (s.tur) {
    case 'atla':
      return;
    case 'odeme': {
      if (h.tutar > 0) throw new IsKuraliHatasi('Giriş hareketi ödeme olamaz.');
      if (!s.cariId) throw new IsKuraliHatasi('Ödemenin yapıldığı cariyi seçin.');
      const acik = await acikGiderler(depo, firmaId, s.cariId, bugun);
      const anahtar = (g: (typeof acik)[number]) => `${g.hedefTur}:${g.gider.id}`;
      const { dagitim } = otomatikDagit(
        tutar,
        acik.map((g) => ({ id: anahtar(g), sira: g.vade, kalan: g.kalan })),
      );
      await odemeYap(depo, servis, {
        tarih: h.tarih,
        cariId: s.cariId,
        hesapId,
        tutar,
        aciklama,
        dagitim: acik.filter((g) => dagitim.has(anahtar(g))).map((g) => ({ hedefTur: g.hedefTur, giderId: g.gider.id, tutar: dagitim.get(anahtar(g))! })),
      });
      return;
    }
    case 'tahsilat':
      if (h.tutar < 0) throw new IsKuraliHatasi('Çıkış hareketi tahsilat olamaz.');
      if (!s.cariId) throw new IsKuraliHatasi('Paranın geldiği cariyi seçin.');
      await tahsilatKaydet(depo, servis, { tarih: h.tarih, amac: 'cari', cariId: s.cariId, hesapId, tutar, projeId: null, aciklama });
      return;
    case 'masraf':
      if (h.tutar > 0) throw new IsKuraliHatasi('Giriş hareketi masraf olamaz.');
      await giderOlustur(
        depo,
        servis,
        {
          tarih: h.tarih,
          projeId: null,
          cariId: null,
          faturaNo: null,
          vadeTarihi: null,
          aciklama: aciklama || 'Banka masrafı',
          satirlar: [{ kalemId: null, aciklama: 'Banka masrafı', miktar: null, birim: null, tutar, kdvDahil: false, kdvOrani: 0, tevkifat: null }],
        },
        { hesapId, tutar },
      );
      return;
    case 'transfer': {
      if (!s.karsiHesapId || s.karsiHesapId === hesapId) throw new IsKuraliHatasi('Karşı hesabı seçin.');
      const cikis = h.tutar < 0;
      await transferYap(depo, servis, {
        tarih: h.tarih,
        kaynakHesapId: cikis ? hesapId : s.karsiHesapId,
        hedefHesapId: cikis ? s.karsiHesapId : hesapId,
        tutar,
        hedefTutar: null,
        aciklama,
      });
      return;
    }
    case 'kredi':
      if (!s.kredi) throw new IsKuraliHatasi('Kredi taksitini seçin.');
      await krediTaksitiOde(depo, servis, s.kredi.krediId, s.kredi.taksitId, { tarih: h.tarih, hesapId });
      return;
  }
}
