import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { KalemSecici, type KalemSecenegi } from './KalemSecici';
import { TutarGirdisi } from './Girdiler';
import { giderToplamlari, KDV_ORANLARI, satirHesapla, TEVKIFAT_ORANLARI, tevkifatYaz, type SatirTutarlari } from '../hesap/gider';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import {
  giderDetayiGetir,
  giderGuncelle,
  giderleriListele,
  giderOlustur,
  iadeOlustur,
  MukerrerFaturaUyarisi,
  sonCariler,
  type GiderOzeti,
  type GiderDetayi,
  type GiderGirdisi,
  type PesinOdeme,
  type SatirFormGirdisi,
} from '../servisler/gider';
import { hesaplariListele, type HesapOzeti } from '../servisler/hesap';
import { projeButcesiGetir, sonKullanilanKalemler } from '../servisler/kalem';
import { belgeEkle } from '../servisler/belge';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { taslakGetir, taslakSil, taslakYaz } from '../servisler/taslak';
import type { Tevkifat } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { BekleyenBelgeler, type HazirDosya } from './Belgeler';
import { CariSecici } from './CariSecici';
import { EksiBakiyeUyarisi, hesapBakiyeMetni } from './HesaplarEkrani';
import { gorunurYap } from './Kroki';
import { git } from './rota';

// ─── Form durumu ───────────────────────────────────────────────────

interface SatirFormu {
  id?: string;
  kalemId: string;
  aciklama: string;
  miktar: string;
  birim: string;
  tutar: string;
  kdvDahil: boolean;
  kdvOrani: string;
  /** '' ya da '4/10' */
  tevkifat: string;
}

/** İadede: 'veresiye' alacak kalır, 'pesin' para hemen geri alındı. */
type OdemeDurumu = 'veresiye' | 'pesin' | 'kismi';

interface GiderFormDurumu {
  tarih: string;
  /** '' : şirket genel gideri */
  projeId: string;
  cariId: string | null;
  /**
   * "Carisiz" bilinçli seçildi mi. cariId null iken false ise henüz seçim yapılmamıştır ve kaydedilemez;
   * açılışta hiçbir şey seçili gelmez (yanlış cariye borç ya da kasadan habersiz peşin çıkış olmasın).
   */
  carisiz: boolean;
  faturaNo: string;
  vadeTarihi: string;
  aciklama: string;
  satirlar: SatirFormu[];
  odemeDurumu: OdemeDurumu;
  hesapId: string;
  odenen: string;
  /** İadede asıl fatura; '' bağsız. */
  iadeEdilenGiderId: string;
}

const TASLAK_BICIMI = 3;

/** Fiş ve faturada en alttaki tutar KDV dahildir; hızlı girişte varsayılan odur. */
const bosSatir = (): SatirFormu => ({ kalemId: '', aciklama: '', miktar: '', birim: '', tutar: '', kdvDahil: true, kdvOrani: '20', tevkifat: '' });

/** Kasa hazır gelmez; yalnızca Carisiz, Peşin ya da Kısmen seçilince son kullanılan kasa doldurulur. */
const bosForm = (projeId = ''): GiderFormDurumu => ({
  tarih: yerelGun(new Date()),
  projeId,
  cariId: null,
  carisiz: false,
  faturaNo: '',
  vadeTarihi: '',
  aciklama: '',
  satirlar: [bosSatir()],
  odemeDurumu: 'veresiye',
  hesapId: '',
  odenen: '',
  iadeEdilenGiderId: '',
});

/** Asıl faturanın satırları iade formuna (KDV hariç, tevkifat oranıyla) kopyalanır; kullanıcı iade edileni düzeltir. */
const iadeSatirlari = (d: GiderDetayi): SatirFormu[] =>
  d.satirlar.map((s) => ({
    kalemId: s.kalemId ?? '',
    aciklama: s.aciklama,
    miktar: s.miktar === null ? '' : sayiYaz(s.miktar),
    birim: s.birim ?? '',
    tutar: tutarMetni(s.kdvHaricTutar),
    kdvDahil: false,
    kdvOrani: String(s.kdvOrani),
    tevkifat: s.tevkifat ? tevkifatYaz(s.tevkifat) : '',
  }));

const tevkifatOku = (m: string): Tevkifat | null => {
  const [pay, payda] = m.split('/').map(Number);
  return m && pay && payda ? { pay, payda } : null;
};

/** Düzenleme: kayıttaki satırlar KDV hariç tutarla açılır (yuvarlama farkı olmasın). İadede eksi tutarlar artı yazılır. */
function detaydanForm(d: GiderDetayi): GiderFormDurumu {
  return {
    tarih: d.gider.tarih,
    projeId: d.gider.projeId ?? '',
    cariId: d.gider.cariId,
    carisiz: d.gider.cariId === null,
    faturaNo: d.gider.faturaNo ?? '',
    vadeTarihi: d.gider.vadeTarihi ?? '',
    aciklama: d.gider.aciklama,
    satirlar: d.satirlar.map((s) => ({
      id: s.id,
      kalemId: s.kalemId ?? '',
      aciklama: s.aciklama,
      miktar: s.miktar === null ? '' : sayiYaz(s.miktar),
      birim: s.birim ?? '',
      tutar: tutarMetni(Math.abs(s.kdvHaricTutar)),
      kdvDahil: false,
      kdvOrani: String(s.kdvOrani),
      tevkifat: s.tevkifat ? tevkifatYaz(s.tevkifat) : '',
    })),
    odemeDurumu: 'veresiye',
    hesapId: '',
    odenen: '',
    iadeEdilenGiderId: d.gider.iadeEdilenGiderId ?? '',
  };
}

function satirGirdisi(s: SatirFormu): SatirFormGirdisi | null {
  const tutar = tlOku(s.tutar);
  const miktar = s.miktar.trim() ? sayiOku(s.miktar) : null;
  if (tutar === null || (s.miktar.trim() && miktar === null)) return null;
  return {
    ...(s.id ? { id: s.id } : {}),
    kalemId: s.kalemId || null,
    aciklama: s.aciklama,
    miktar,
    birim: s.birim || null,
    tutar,
    kdvDahil: s.kdvDahil,
    kdvOrani: Number(s.kdvOrani),
    tevkifat: tevkifatOku(s.tevkifat),
  };
}

function girdiyeCevir(f: GiderFormDurumu): { girdi: GiderGirdisi | null; hatalar: string[] } {
  const hatalar: string[] = [];
  const satirlar = f.satirlar.map((s, i) => {
    const g = satirGirdisi(s);
    if (!g) hatalar.push(`${f.satirlar.length > 1 ? `${i + 1}. satır: ` : ''}tutarı ya da miktarı sayı olarak yazın (örn. 12.500 ya da 850,50).`);
    return g;
  });
  if (hatalar.length > 0) return { girdi: null, hatalar };
  return {
    girdi: {
      tarih: f.tarih,
      projeId: f.projeId || null,
      cariId: f.cariId,
      faturaNo: f.faturaNo || null,
      vadeTarihi: f.vadeTarihi || null,
      aciklama: f.aciklama,
      satirlar: satirlar as SatirFormGirdisi[],
      iadeEdilenGiderId: f.iadeEdilenGiderId || null,
    },
    hatalar,
  };
}

// ─── Ekran ─────────────────────────────────────────────────────────

interface Kaynaklar {
  projeler: ProjeOzeti[];
  cariler: CariOzeti[];
  hesaplar: HesapOzeti[];
}

/** Kalem seçimi: alt kalemi olan ana kalem seçilemez, alt kalemleri grup olarak gelir. */

/**
 * Gider ve iade faturası formu. İade: `iade` ya da düzenlenen kaydın türü; `asilGiderId` ile
 * asıl faturadan doldurulmuş açılır.
 */
export function GiderFormu(props: { duzenlenen?: GiderDetayi; projeId?: string; iade?: boolean; asilGiderId?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const yeni = !props.duzenlenen;
  const iade = props.duzenlenen ? props.duzenlenen.gider.tur === 'iade' : !!props.iade;
  const taslakAdi = iade ? 'iadeFormu' : 'giderFormu';
  const belgeTaslagi = iade ? 'iadeFormuBelgeleri' : 'giderFormuBelgeleri';
  /** İadede: seçili carinin alışları (asıl fatura seçimi için). */
  const [alislar, setAlislar] = useState<GiderOzeti[]>([]);
  /** Bağlı iadede asıl faturanın tevkifat oranları ('' = tevkifatsız); bağsızda null. */
  const [asilOranlari, setAsilOranlari] = useState<string[] | null>(null);
  const [kaynak, setKaynak] = useState<Kaynaklar | null>(null);
  /** Son kullanılan kasa/banka; yalnızca Carisiz, Peşin ya da Kısmen seçilince forma yazılır. */
  const [varsayilanHesapId, setVarsayilanHesapId] = useState('');
  const [form, setForm] = useState<GiderFormDurumu | null>(props.duzenlenen ? detaydanForm(props.duzenlenen) : null);
  const [taslakZamani, setTaslakZamani] = useState<string | null>(null);
  const [kalemler, setKalemler] = useState<KalemSecenegi[]>([]);
  /** Yüklenirken "kalem yok" uyarısı anlık görünmesin. */
  const [kalemYuklendi, setKalemYuklendi] = useState(false);
  const [sonKalemler, setSonKalemler] = useState<string[]>([]);
  /** Cari önerileri: hiçbiri hazır seçili gelmez (yanlış cariye borç yazılmasın). */
  const [cariOnerileri, setCariOnerileri] = useState<{ son: string[]; kalemeGore: Map<string, string> }>({ son: [], kalemeGore: new Map() });
  /** Kaydetme hatası ya da mükerrer uyarısı çıkınca ekrana getirilir (Kaydet çubuğu altta sabit). */
  const uyariRef = useRef<HTMLDivElement>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);
  const [mukerrer, setMukerrer] = useState<MukerrerFaturaUyarisi['mevcut'] | null>(null);
  /** Gider kaydedildi ama belgelerden biri eklenemedi: kullanıcı görsün, ikinci kez kaydedilmesin. */
  const [kayitliId, setKayitliId] = useState<string | null>(null);
  /** Proje ve tarih seçimi açık mı (kapalıyken tek satır özet). */
  const [baglamAcik, setBaglamAcik] = useState(false);
  const kaydedildi = useRef(false);
  /** Yeni giderde seçilen fiş/fatura fotoğrafları; gider kaydedilince eklenir (taslağa girmez). */
  const [belgeler, setBelgeler] = useState<HazirDosya[]>([]);

  // Kaynaklar ve (yeni gider ise) taslak ya da son kullanılan proje/hesap.
  useEffect(() => {
    let iptal = false;
    void (async () => {
      const f = oturum.firmaId;
      const [projeler, cariler, hesaplar] = await Promise.all([
        projeleriListele(depo, f),
        carileriListele(depo, f),
        hesaplariListele(depo, f),
      ]);
      if (iptal) return;
      setKaynak({ projeler, cariler, hesaplar: hesaplar.filter((h) => h.hesap.paraBirimi === 'TRY') });
      if (!yeni) return;
      if (props.asilGiderId) {
        const asil = await giderDetayiGetir(depo, f, props.asilGiderId, yerelGun(new Date()));
        if (iptal || !asil) return;
        setForm({
          ...bosForm(asil.gider.projeId ?? ''),
          cariId: asil.gider.cariId,
          carisiz: asil.gider.cariId === null,
          iadeEdilenGiderId: asil.gider.id,
          satirlar: iadeSatirlari(asil),
        });
        return;
      }
      const taslak = await taslakGetir<GiderFormDurumu>(depo, f, taslakAdi, TASLAK_BICIMI);
      const varsayilan = await taslakGetir<{ projeId: string; hesapId: string }>(depo, f, 'giderVarsayilanlari', 1);
      if (iptal) return;
      setVarsayilanHesapId(varsayilan?.veri.hesapId ?? '');
      if (taslak) {
        setForm(taslak.veri);
        setTaslakZamani(taslak.zaman);
        const dosyalar = await taslakGetir<HazirDosya[]>(depo, f, belgeTaslagi, 1);
        if (!iptal && dosyalar) setBelgeler(dosyalar.veri);
      } else {
        const projeId = props.projeId ?? varsayilan?.veri.projeId ?? '';
        setForm(bosForm(projeler.some((p) => p.proje.id === projeId) ? projeId : ''));
      }
    })();
    return () => {
      iptal = true;
    };
  }, [depo, oturum.firmaId, yeni, props.projeId, props.asilGiderId, taslakAdi, belgeTaslagi]);

  // Bağlı iadede tevkifat oranı asıl faturadan gelir; tek oranlıysa bütün satırlara uygulanır.
  const iadeEdilenGiderId = iade ? (form?.iadeEdilenGiderId ?? '') : '';
  useEffect(() => {
    if (!iadeEdilenGiderId) return setAsilOranlari(null);
    void giderDetayiGetir(depo, oturum.firmaId, iadeEdilenGiderId, yerelGun(new Date())).then((d) => {
      if (!d) return setAsilOranlari(null);
      const oranlar = [...new Set(d.satirlar.map((s) => (s.tevkifat ? tevkifatYaz(s.tevkifat) : '')))];
      setAsilOranlari(oranlar);
      if (oranlar.length === 1) {
        setForm((f) => f && { ...f, satirlar: f.satirlar.map((s) => ({ ...s, tevkifat: s.kdvOrani === '0' ? '' : oranlar[0]! })) });
      }
    });
  }, [iadeEdilenGiderId, depo, oturum.firmaId]);

  // İadede carinin alışları: asıl fatura seçimi ve kalan borcu.
  const cariId = form?.cariId ?? null;
  useEffect(() => {
    if (!iade || !cariId) return setAlislar([]);
    void giderleriListele(depo, oturum.firmaId, { cariId }, yerelGun(new Date())).then((l) => setAlislar(l.filter((g) => g.gider.tur === 'alis')));
  }, [iade, cariId, depo, oturum.firmaId]);

  // Seçili projenin kalemleri.
  const projeId = form?.projeId ?? '';
  useEffect(() => {
    if (!projeId) {
      setKalemler([]);
      setSonKalemler([]);
      return;
    }
    setKalemYuklendi(false);
    // Alt kalemi olan ana kalem seçilemez; seçenekler yalnızca en alttaki kalemlerdir.
    void projeButcesiGetir(depo, oturum.firmaId, projeId, true).then((o) => {
      setKalemYuklendi(true);
      setKalemler(
        o.dugumler.flatMap((d): KalemSecenegi[] =>
          d.altlar.length > 0
            ? d.altlar.map((a) => ({ id: a.kalem.id, ad: a.kalem.ad, ustAd: d.kalem.ad }))
            : [{ id: d.kalem.id, ad: d.kalem.ad, ustAd: null }],
        ),
      );
    });
    void sonKullanilanKalemler(depo, oturum.firmaId, projeId).then(setSonKalemler);
  }, [depo, oturum.firmaId, projeId]);

  useEffect(() => {
    void sonCariler(depo, oturum.firmaId, projeId || null).then(setCariOnerileri);
  }, [depo, oturum.firmaId, projeId]);

  useEffect(() => {
    if (hatalar.length > 0 || hata || mukerrer) gorunurYap(uyariRef.current);
  }, [hatalar, hata, mukerrer]);

  // Yeni giderde her değişiklik taslak olarak saklanır.
  useEffect(() => {
    if (!yeni || !form || kaydedildi.current) return;
    void taslakYaz(depo, oturum.firmaId, taslakAdi, TASLAK_BICIMI, form);
  }, [yeni, form, depo, oturum.firmaId, taslakAdi]);

  // Seçilen fotoğraflar da taslakla saklanır (yalnızca değişince yazılır).
  const ilkBelgeYazimi = useRef(true);
  useEffect(() => {
    if (ilkBelgeYazimi.current) {
      ilkBelgeYazimi.current = false;
      return;
    }
    if (!yeni || kaydedildi.current) return;
    if (belgeler.length === 0) void taslakSil(depo, oturum.firmaId, belgeTaslagi);
    else void taslakYaz(depo, oturum.firmaId, belgeTaslagi, 1, belgeler);
  }, [yeni, belgeler, depo, oturum.firmaId, belgeTaslagi]);

  const hesaplanan = useMemo(() => {
    if (!form) return null;
    const satirlar = form.satirlar.map((s) => {
      const g = satirGirdisi(s);
      return g ? satirHesapla(g) : null;
    });
    const gecerli = satirlar.filter((s): s is SatirTutarlari => s !== null);
    return { satirlar, toplam: giderToplamlari(gecerli) };
  }, [form]);

  if (!kaynak || !form || !hesaplanan) return <p>Yükleniyor…</p>;

  const yaz = <K extends keyof GiderFormDurumu>(alan: K, deger: GiderFormDurumu[K]) => setForm((f) => f && { ...f, [alan]: deger });
  const satirYaz = <K extends keyof SatirFormu>(i: number, alan: K, deger: SatirFormu[K]) =>
    setForm((f) => f && { ...f, satirlar: f.satirlar.map((s, j) => (j === i ? { ...s, [alan]: deger } : s)) });
  const t = hesaplanan.toplam;
  const carisiz = form.cariId === null && form.carisiz;
  const cariSecilmedi = form.cariId === null && !form.carisiz;
  /** Kasa boşsa son kullanılanı yazar (iadede kredi kartı olamaz). */
  const kasaDoldur = (f: GiderFormDurumu): GiderFormDurumu => {
    if (f.hesapId || !varsayilanHesapId) return f;
    const h = kaynak.hesaplar.find((x) => x.hesap.id === varsayilanHesapId);
    return h && !(iade && h.hesap.tur === 'kredi_karti') ? { ...f, hesapId: varsayilanHesapId } : f;
  };
  const odemeSec = (k: OdemeDurumu) => setForm((f) => f && (k === 'veresiye' ? { ...f, odemeDurumu: k } : kasaDoldur({ ...f, odemeDurumu: k })));
  // İade: önce asıl faturanın kalan borcundan düşer, artanı alacak kalır ya da geri alınır.
  const asil = alislar.find((g) => g.gider.id === form.iadeEdilenGiderId);
  // Cari alacağı tevkifat sonrası tutardır.
  const mahsup = iade && asil ? Math.min(t.odenecek, asil.kalan) : 0;
  const serbest = t.odenecek - mahsup;
  const tekOran = asilOranlari?.length === 1 ? asilOranlari[0]! : null;
  const yeniSatir = (): SatirFormu => ({ ...bosSatir(), tevkifat: tekOran ?? '' });
  // Carisiz alış yalnızca peşin olabilir.
  const odemeDurumu: OdemeDurumu = carisiz ? 'pesin' : form.odemeDurumu;
  const secenekGrubu = (s: SatirFormu, i: number) => (
    <KalemSecici
      secenekler={kalemler}
      son={sonKalemler}
      secili={s.kalemId}
      onSec={(id) => satirYaz(i, 'kalemId', id)}
      projeVar={!!form.projeId}
    />
  );

  async function kaydet(mukerrerOnayli = false) {
    if (!form) return;
    setMukerrer(null);
    const { girdi, hatalar } = girdiyeCevir(form);
    if (cariSecilmedi) hatalar.unshift("Cari seçin ya da Carisiz'i işaretleyin.");
    let odeme: PesinOdeme | null = null;
    if (yeni && odemeDurumu !== 'veresiye' && (!iade || serbest > 0)) {
      const tutar = iade ? serbest : odemeDurumu === 'pesin' ? t.odenecek : tlOku(form.odenen);
      if (!form.hesapId) hatalar.push(iade ? 'Paranın girdiği kasa/bankayı seçin.' : 'Ödemenin yapıldığı kasa/banka/kartı seçin.');
      if (tutar === null) hatalar.push('Ödenen tutarı yazın.');
      if (form.hesapId && tutar !== null) odeme = { hesapId: form.hesapId, tutar };
    }
    setHatalar(hatalar);
    if (!girdi || hatalar.length > 0) return;

    const bitir = async (id: string) => {
      kaydedildi.current = true;
      // Gider kaydedildi; belge eklenemezse gider yine durur, belge detaydan yeniden eklenir.
      const eklenemeyen: string[] = [];
      for (const b of yeni ? belgeler : []) {
        try {
          await belgeEkle(depo, servis, { bagliTur: 'gider', bagliId: id, tur: form.cariId ? 'fatura' : 'fis', tarih: form.tarih, ad: b.ad, dosya: b.dosya });
        } catch (e) {
          eklenemeyen.push(`${b.ad} (${hataMetni(e)})`);
        }
      }
      if (yeni) {
        await taslakSil(depo, oturum.firmaId, taslakAdi);
        await taslakSil(depo, oturum.firmaId, belgeTaslagi);
        if (!iade) await taslakYaz(depo, oturum.firmaId, 'giderVarsayilanlari', 1, { projeId: form.projeId, hesapId: form.hesapId });
      }
      if (eklenemeyen.length > 0) {
        setHatalar([`Gider kaydedildi ama şu belgeler eklenemedi: ${eklenemeyen.join(', ')}. Gider ekranından yeniden ekleyin.`]);
        setKayitliId(id);
        setIslemde(false);
        return;
      }
      git(`giderler/${id}`);
    };
    const uyariYakala = (e: unknown) => {
      if (e instanceof MukerrerFaturaUyarisi) setMukerrer(e.mevcut);
      else throw e;
    };

    if (yeni) {
      setIslemde(true);
      try {
        const g = iade
          ? await iadeOlustur(depo, servis, girdi, odeme, { mukerrerOnayli })
          : await giderOlustur(depo, servis, girdi, odeme, { mukerrerOnayli });
        await bitir(g.id);
      } catch (e) {
        if (e instanceof MukerrerFaturaUyarisi) setMukerrer(e.mevcut);
        else setHatalar([hataMetni(e)]);
        setIslemde(false);
      }
    } else {
      const eski = props.duzenlenen!.gider;
      void degistir('Gider değişiyor', async (g) => {
        try {
          await giderGuncelle(depo, servis, eski.id, girdi, g, { mukerrerOnayli });
          await bitir(eski.id);
        } catch (e) {
          uyariYakala(e);
        }
      });
    }
  }

  async function vazgec() {
    kaydedildi.current = true;
    if (yeni) {
      await taslakSil(depo, oturum.firmaId, taslakAdi);
      await taslakSil(depo, oturum.firmaId, belgeTaslagi);
    }
    if (props.asilGiderId) return git(`giderler/${props.asilGiderId}`);
    git(yeni ? (props.projeId ? `projeler/${props.projeId}` : 'kayit') : `giderler/${props.duzenlenen!.gider.id}`);
  }

  const projeAdi = kaynak.projeler.find((p) => p.proje.id === form.projeId)?.proje.ad;
  const tekSatir = form.satirlar.length === 1;
  const sonUc = sonKalemler
    .map((id) => kalemler.find((k) => k.id === id))
    .filter((k): k is KalemSecenegi => !!k)
    .slice(0, 3);

  // Seçilen kalemde en son kullanılan cari başta ve vurgulu; sonra son kullanılanlar (en çok 3 düğme).
  const kalemCarisi = cariOnerileri.kalemeGore.get(form.satirlar[0]?.kalemId ?? '');
  const kalemAdi = kalemler.find((k) => k.id === form.satirlar[0]?.kalemId)?.ad;
  const oneriler = [
    ...(kalemCarisi ? [{ id: kalemCarisi, vurgulu: true, not: `${kalemAdi ?? 'bu kalem'} için en son kullanılan` }] : []),
    ...cariOnerileri.son.filter((id) => id !== kalemCarisi).map((id) => ({ id, vurgulu: false })),
  ].slice(0, 3);

  /** Tutar ve kalem: hızlı girişin çekirdeği. */
  const satirTemeli = (s: SatirFormu, i: number, buyuk: boolean) => (
    <>
      <Alan etiket={`Tutar (KDV ${s.kdvDahil ? 'dahil' : 'hariç'})`}>
        <TutarGirdisi
          className={buyuk ? 'tutar-buyuk' : undefined}
          value={s.tutar}
          placeholder="0"
          autoFocus={buyuk && yeni && !props.asilGiderId}
          onChange={(v) => satirYaz(i, 'tutar', v)}
        />
      </Alan>
      <div className="alan">
        <span className="alan-etiket">Kalem</span>
        {sonUc.length > 0 && (
          <div className="filtreler son-kalemler" role="group" aria-label="Son kullanılan kalemler">
            {sonUc.map((k) => (
              <button key={k.id} type="button" aria-pressed={s.kalemId === k.id} onClick={() => satirYaz(i, 'kalemId', k.id)}>
                {k.ad}
              </button>
            ))}
          </div>
        )}
        {secenekGrubu(s, i)}
        {form.projeId && kalemYuklendi && kalemler.length === 0 && (
          <p className="mesaj-not">
            Bu projede kalem yok. <a href={`#/projeler/${form.projeId}/butce`}>Bütçe ekranından kalem ekleyin.</a>
          </p>
        )}
      </div>
    </>
  );

  const kdvOzeti = (s: SatirFormu) =>
    [`%${s.kdvOrani}`, s.kdvOrani === '0' ? null : s.kdvDahil ? 'KDV dahil' : 'KDV hariç', s.tevkifat ? `tevkifat ${s.tevkifat}` : 'tevkifat yok']
      .filter(Boolean)
      .join(' · ');
  const miktarOzeti = (s: SatirFormu) => [s.miktar && `${s.miktar} ${s.birim}`.trim(), s.aciklama].filter(Boolean).join(' · ');

  const kdvAlanlari = (s: SatirFormu, i: number) => {
    const h = hesaplanan.satirlar[i];
    return (
      <>
        <div className="iki-sutun">
          <Alan etiket="KDV">
            <select value={s.kdvOrani} onChange={(e) => satirYaz(i, 'kdvOrani', e.target.value)}>
              {KDV_ORANLARI.map((o) => (
                <option key={o} value={o}>
                  %{o}
                </option>
              ))}
            </select>
          </Alan>
          <Alan etiket="Tevkifat" aciklama={asilOranlari ? 'İade edilen faturadan' : undefined}>
            <select value={s.tevkifat} onChange={(e) => satirYaz(i, 'tevkifat', e.target.value)} disabled={s.kdvOrani === '0' || tekOran !== null}>
              {(asilOranlari ?? ['', ...TEVKIFAT_ORANLARI.map(tevkifatYaz)]).map((o) => (
                <option key={o} value={o}>
                  {o || 'Tevkifat yok'}
                </option>
              ))}
            </select>
          </Alan>
        </div>
        <fieldset className="secenekler">
          <legend className="gorunmez">Tutar KDV dahil mi</legend>
          <label>
            <input type="radio" name={`kdv-dahil-${i}`} checked={s.kdvDahil} onChange={() => satirYaz(i, 'kdvDahil', true)} /> KDV dahil
          </label>
          <label>
            <input type="radio" name={`kdv-dahil-${i}`} checked={!s.kdvDahil} onChange={() => satirYaz(i, 'kdvDahil', false)} /> KDV hariç
          </label>
        </fieldset>
        {h && (
          <p className="mesaj-not">
            KDV hariç {tlYaz(h.kdvHaricTutar)} · KDV {tlYaz(h.kdvTutari)}
            {h.tevkifatTutari > 0 && ` · tevkif edilen ${tlYaz(h.tevkifatTutari)}`}
          </p>
        )}
      </>
    );
  };

  const miktarAlanlari = (s: SatirFormu, i: number) => {
    const h = hesaplanan.satirlar[i];
    const miktar = sayiOku(s.miktar);
    return (
      <>
        <Alan etiket="Açıklama">
          <input value={s.aciklama} placeholder="C30 beton" onChange={(e) => satirYaz(i, 'aciklama', e.target.value)} />
        </Alan>
        <div className="iki-sutun">
          <Alan etiket="Miktar">
            <input value={s.miktar} inputMode="decimal" placeholder="İsteğe bağlı" onChange={(e) => satirYaz(i, 'miktar', e.target.value)} />
          </Alan>
          <Alan etiket="Birim">
            <input value={s.birim} placeholder="m³, ton, adet" onChange={(e) => satirYaz(i, 'birim', e.target.value)} />
          </Alan>
        </div>
        {h && miktar ? <p className="mesaj-not">Birim fiyat {tlYaz(Math.round(h.kdvHaricTutar / miktar))} (KDV hariç)</p> : null}
      </>
    );
  };

  const faturaOzeti = [form.faturaNo && `No ${form.faturaNo}`, form.vadeTarihi && `vade ${tarihMetni(form.vadeTarihi)}`, form.aciklama]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <h1>{iade ? (yeni ? 'İade faturası' : 'İadeyi düzenle') : yeni ? 'Yeni gider' : 'Gideri düzenle'}</h1>
      {iade && yeni && (
        <p className="mesaj-not">
          Tedarikçiye geri verilen mal ya da alınan iade faturası. Tutarlar maliyetten, kalem gerçekleşeninden ve cari borcundan düşer.
        </p>
      )}
      {taslakZamani && (
        <p className="mesaj mesaj-not" role="status">
          Yarım kalan girişten devam ediliyor. Baştan başlamak için Vazgeç'e basın.
        </p>
      )}

      {/* Yanlış projeye gider yazmak en riskli hata: proje adı en üstte, belirgin. */}
      <section className="kart gider-baglam">
        {baglamAcik ? (
          <>
            <div className="iki-sutun">
              <Alan etiket="Proje">
                <select
                  value={form.projeId}
                  onChange={(e) => setForm((f) => f && { ...f, projeId: e.target.value, satirlar: f.satirlar.map((s) => ({ ...s, kalemId: '' })) })}
                >
                  <option value="">Şirket genel gideri</option>
                  {kaynak.projeler.map(({ proje }) => (
                    <option key={proje.id} value={proje.id}>
                      {proje.ad}
                    </option>
                  ))}
                </select>
              </Alan>
              <Alan etiket="Tarih">
                <input type="date" value={form.tarih} onChange={(e) => yaz('tarih', e.target.value)} />
              </Alan>
            </div>
            <button type="button" className="ikincil" onClick={() => setBaglamAcik(false)}>
              Tamam
            </button>
          </>
        ) : (
          <div className="baglam-satiri">
            <span>
              <strong className="baglam-proje">{projeAdi ?? 'Şirket genel gideri'}</strong>
              <span className="soluk"> · {tarihMetni(form.tarih)}</span>
            </span>
            <button type="button" className="ikincil" onClick={() => setBaglamAcik(true)} aria-label="Proje ve tarihi değiştir">
              Değiştir
            </button>
          </div>
        )}
      </section>

      <section className="kart">
        {yeni && <BekleyenBelgeler dosyalar={belgeler} onDegisti={setBelgeler} />}
        {tekSatir && satirTemeli(form.satirlar[0]!, 0, true)}

        <div className="alan">
          <span className="alan-etiket">{iade ? 'Cari (kime iade edildi)' : 'Cari (kimden alındı)'}</span>
          <CariSecici
            cariler={kaynak.cariler}
            secili={form.cariId}
            onSec={(id) =>
              setForm((f) => {
                if (!f) return f;
                const yeniForm = { ...f, cariId: id, carisiz: id === null, iadeEdilenGiderId: '' };
                // Carisiz alış peşindir: kasa hazır gelir.
                return id === null ? kasaDoldur(yeniForm) : yeniForm;
              })
            }
            bosSecili={form.carisiz}
            oncelikli={['tedarikci', 'usta']}
            bosEtiket={iade ? 'Carisiz (para hemen geri alındı)' : 'Carisiz (peşin alış, fiş)'}
            yeniCariYolu={yeni && !iade ? 'cariler/yeni/tedarikci' : undefined}
            oneriler={oneriler}
          />
        </div>
        {iade && form.cariId && (
          <Alan etiket="İade edilen fatura" aciklama="İsteğe bağlı. Seçilirse iade önce o faturanın kalan borcundan düşer.">
            <select
              value={form.iadeEdilenGiderId}
              disabled={!yeni}
              onChange={(e) => {
                const id = e.target.value;
                yaz('iadeEdilenGiderId', id);
                const bos = form.satirlar.every((s) => !s.tutar.trim());
                if (!id || !bos) return;
                // Boş formu asıl faturanın proje ve satırlarıyla doldur.
                void giderDetayiGetir(depo, oturum.firmaId, id, yerelGun(new Date())).then(
                  (d) => d && setForm((f) => f && { ...f, projeId: d.gider.projeId ?? '', satirlar: iadeSatirlari(d) }),
                );
              }}
            >
              <option value="">Faturaya bağlamadan</option>
              {alislar.map(({ gider: g, kalan }) => (
                <option key={g.id} value={g.id}>
                  {new Date(`${g.tarih}T00:00`).toLocaleDateString('tr-TR')}
                  {g.faturaNo ? ` · ${g.faturaNo}` : ''} · {tlYaz(g.toplam)}
                  {kalan > 0 ? ` (kalan ${tlYaz(kalan)})` : ' (ödendi)'}
                </option>
              ))}
            </select>
          </Alan>
        )}

        {yeni && iade && (
          <>
            {mahsup > 0 && <p className="mesaj-not">{tlYaz(mahsup)} seçilen faturanın kalan borcundan düşer.</p>}
            {serbest > 0 && (
              <div className="alan">
                <span className="alan-etiket">İade karşılığı</span>
                {carisiz ? (
                  <p className="mesaj-not">Carisiz iadede para hemen geri alınmış sayılır.</p>
                ) : (
                  <div className="filtreler" role="group" aria-label="İade karşılığı">
                    {(
                      [
                        ['veresiye', 'Alacak kalsın'],
                        ['pesin', 'Para geri alındı'],
                      ] as const
                    ).map(([k, ad]) => (
                      <button key={k} type="button" aria-pressed={odemeDurumu === k} onClick={() => odemeSec(k)}>
                        {ad}
                      </button>
                    ))}
                  </div>
                )}
                {odemeDurumu === 'veresiye' ? (
                  <p className="mesaj-not">{tlYaz(serbest)} cariden alacak kalır; sonraki faturalara mahsup edilir ya da tahsilatla kapanır.</p>
                ) : (
                  <div className="iki-sutun">
                    <Alan etiket="Nereye girdi">
                      <select value={form.hesapId} onChange={(e) => yaz('hesapId', e.target.value)}>
                        <option value="">Seçin</option>
                        {kaynak.hesaplar
                          .filter(({ hesap }) => hesap.tur !== 'kredi_karti')
                          .map(({ hesap, bakiye }) => (
                            <option key={hesap.id} value={hesap.id}>
                              {hesap.ad} ({hesapBakiyeMetni(bakiye, hesap)})
                            </option>
                          ))}
                      </select>
                    </Alan>
                    <Alan etiket="Geri alınan (₺)">
                      <input value={tutarMetni(serbest)} readOnly />
                    </Alan>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {yeni && !iade && (
          <div className="alan">
            <span className="alan-etiket">Ödeme</span>
            {carisiz ? (
              <p className="mesaj-not">Carisiz alış peşin ödenmiş sayılır.</p>
            ) : (
              <div className="filtreler" role="group" aria-label="Ödeme durumu">
                {(
                  [
                    ['veresiye', 'Veresiye'],
                    ['pesin', 'Peşin'],
                    ['kismi', 'Kısmen'],
                  ] as const
                ).map(([k, ad]) => (
                  <button key={k} type="button" aria-pressed={form.odemeDurumu === k} onClick={() => odemeSec(k)}>
                    {ad}
                  </button>
                ))}
              </div>
            )}
            {odemeDurumu !== 'veresiye' && (
              <div className="iki-sutun">
                <Alan etiket="Nereden ödendi">
                  <select value={form.hesapId} onChange={(e) => yaz('hesapId', e.target.value)}>
                    <option value="">Seçin</option>
                    {kaynak.hesaplar.map(({ hesap, bakiye }) => (
                      <option key={hesap.id} value={hesap.id}>
                        {hesap.ad} ({hesapBakiyeMetni(bakiye, hesap)})
                      </option>
                    ))}
                  </select>
                </Alan>
                <Alan etiket="Ödenen (₺)">
                  {odemeDurumu === 'kismi' ? (
                    <TutarGirdisi value={form.odenen} onChange={(v) => yaz('odenen', v)} />
                  ) : (
                    <input value={tutarMetni(t.odenecek)} readOnly />
                  )}
                </Alan>
              </div>
            )}
            {odemeDurumu !== 'veresiye' && (
              <EksiBakiyeUyarisi
                hesap={kaynak.hesaplar.find((h) => h.hesap.id === form.hesapId)}
                tutar={odemeDurumu === 'pesin' ? t.odenecek : tlOku(form.odenen)}
              />
            )}
            {kaynak.hesaplar.length === 0 && odemeDurumu !== 'veresiye' && (
              <p className="mesaj-not">
                Önce <a href="#/hesaplar/yeni">kasa ya da banka hesabı açın</a>.
              </p>
            )}
          </div>
        )}
      </section>

      {tekSatir ? (
        <>
          <Katlanir baslik="KDV ve tevkifat" ozet={kdvOzeti(form.satirlar[0]!)} acik={!yeni && (!!form.satirlar[0]!.tevkifat || form.satirlar[0]!.kdvOrani !== '20')}>
            {kdvAlanlari(form.satirlar[0]!, 0)}
          </Katlanir>
          <Katlanir baslik="Miktar ve birim fiyat" ozet={miktarOzeti(form.satirlar[0]!)} acik={!yeni && !!miktarOzeti(form.satirlar[0]!)}>
            {miktarAlanlari(form.satirlar[0]!, 0)}
          </Katlanir>
        </>
      ) : (
        form.satirlar.map((s, i) => (
          <section className="kart" key={s.id ?? i}>
            <div className="baslik-satiri">
              <h2>{i + 1}. kalem</h2>
              <button type="button" className="ikincil" onClick={() => setForm((f) => f && { ...f, satirlar: f.satirlar.filter((_, j) => j !== i) })}>
                Çıkar
              </button>
            </div>
            {satirTemeli(s, i, false)}
            <Katlanir baslik="KDV, tevkifat, miktar" ozet={[kdvOzeti(s), miktarOzeti(s)].filter(Boolean).join(' · ')} acik={!!s.tevkifat}>
              {kdvAlanlari(s, i)}
              {miktarAlanlari(s, i)}
            </Katlanir>
          </section>
        ))
      )}

      <Katlanir baslik="Fatura no, vade, açıklama" ozet={faturaOzeti} acik={!yeni && !!faturaOzeti}>
        <div className="iki-sutun">
          <Alan etiket="Fatura / fiş no">
            <input value={form.faturaNo} onChange={(e) => yaz('faturaNo', e.target.value)} />
          </Alan>
          <Alan etiket="Vade">
            <input type="date" value={form.vadeTarihi} onChange={(e) => yaz('vadeTarihi', e.target.value)} />
          </Alan>
        </div>
        <Alan etiket="Açıklama">
          <input value={form.aciklama} onChange={(e) => yaz('aciklama', e.target.value)} />
        </Alan>
      </Katlanir>

      <button type="button" className="ikincil genis" onClick={() => setForm((f) => f && { ...f, satirlar: [...f.satirlar, yeniSatir()] })}>
        + Başka kalem ekle
      </button>

      <section className="kart">
        <dl className="bilgi">
          <dt>{iade ? 'İade toplamı' : 'Toplam'}</dt>
          <dd>
            <strong>{tlYaz(t.toplam)}</strong> <span className="soluk">· KDV {tlYaz(t.kdvToplam)}</span>
          </dd>
          {t.tevkifatToplam > 0 && (
            <div className="bilgi-satir">
              <dt>Tevkif edilen KDV</dt>
              <dd>
                {tlYaz(t.tevkifatToplam)} <span className="soluk">{iade ? '(vergi dairesi borcundan düşer)' : '(vergi dairesine)'}</span>
              </dd>
            </div>
          )}
          {t.tevkifatToplam > 0 && (
            <div className="bilgi-satir">
              <dt>{iade ? 'Cariden düşen' : 'Cariye ödenecek'}</dt>
              <dd>
                <strong>{tlYaz(t.odenecek)}</strong>
              </dd>
            </div>
          )}
        </dl>

        <div ref={uyariRef}>
          {kutu}
          <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
        </div>
        {mukerrer && (
          <div className="mesaj mesaj-uyari" role="alertdialog" aria-labelledby="mukerrer-baslik">
            <h3 id="mukerrer-baslik">Bu fatura daha önce girilmiş olabilir</h3>
            <p>
              Aynı cariden {mukerrer.faturaNo} numaralı fatura {new Date(`${mukerrer.tarih}T00:00`).toLocaleDateString('tr-TR')} tarihinde{' '}
              {tlYaz(mukerrer.toplam)} olarak kayıtlı. <a href={`#/giderler/${mukerrer.id}`}>Kaydı aç</a>
            </p>
            <div className="dugmeler">
              <button type="button" onClick={() => void kaydet(true)} disabled={islemde}>
                Farklı fatura, yine de kaydet
              </button>
              <button type="button" className="ikincil" onClick={() => setMukerrer(null)}>
                Vazgeç
              </button>
            </div>
          </div>
        )}
        {kayitliId && (
          <a className="dugme" href={`#/giderler/${kayitliId}`}>
            Gidere git
          </a>
        )}
        {yeni && <p className="mesaj-not">Yazdıklarınız bu cihazda taslak olarak saklanır; başka ekrana geçip dönebilirsiniz.</p>}
      </section>

      {/* Ekranın altında sabit: kaydırmadan kaydedilir, toplam her an görünür. */}
      <div className="kaydet-cubugu">
        <button type="button" className="kaydet-dugmesi" onClick={() => void kaydet()} disabled={islemde || !!kayitliId}>
          {islemde ? 'Kaydediliyor…' : `${tlYaz(t.toplam)} · Kaydet`}
        </button>
        <button type="button" className="ikincil" onClick={() => void vazgec()} disabled={islemde}>
          Vazgeç
        </button>
      </div>
    </>
  );
}

/** Katlanır bölüm: kapalıyken başlığın yanında içindeki seçimin özeti görünür. */
function Katlanir(props: { baslik: string; ozet: string; acik: boolean; children: ReactNode }) {
  const [acik, setAcik] = useState(props.acik);
  return (
    <details className="kart katlanir" open={acik} onToggle={(e) => setAcik(e.currentTarget.open)}>
      <summary>
        <span className="katlanir-baslik">{props.baslik}</span>
        {props.ozet && <span className="katlanir-ozet">{props.ozet}</span>}
      </summary>
      <div className="katlanir-icerik">{props.children}</div>
    </details>
  );
}

/** "Bugün", "Dün" ya da 3.10.2026. */
function tarihMetni(t: string): string {
  const bugun = yerelGun(new Date());
  const dun = yerelGun(new Date(Date.now() - 86_400_000));
  if (t === bugun) return 'Bugün';
  if (t === dun) return 'Dün';
  return new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
}
