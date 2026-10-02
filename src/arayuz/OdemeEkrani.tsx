import { useCallback, useEffect, useState } from 'react';
import { otomatikDagit } from '../hesap/eslestirme';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import { hesaplariListele, type HesapOzeti } from '../servisler/hesap';
import {
  acikGiderler,
  avansEslestir,
  iadeMahsup,
  odemeDetayiGetir,
  odemeYap,
  TAHSILAT_AMACI_ADI,
  tahsilatKaydet,
  type AcikGider,
  type BorcTuru,
  type Dagitim,
  type OdemeDetayi,
  type TahsilatAmaci,
} from '../servisler/odeme';
import { giderDetayiGetir } from '../servisler/gider';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { CariSecici } from './CariSecici';
import { EksiBakiyeUyarisi, hesapBakiyeMetni } from './HesaplarEkrani';
import { git } from './rota';

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const bugun = () => yerelGun(new Date());

export function HesapSecimi(props: { hesaplar: HesapOzeti[]; secili: string; onSec: (id: string) => void; etiket: string }) {
  return (
    <Alan etiket={props.etiket}>
      <select value={props.secili} onChange={(e) => props.onSec(e.target.value)}>
        <option value="">Seçin</option>
        {props.hesaplar.map(({ hesap, bakiye }) => (
          <option key={hesap.id} value={hesap.id}>
            {hesap.ad} ({hesapBakiyeMetni(bakiye, hesap)})
          </option>
        ))}
      </select>
    </Alan>
  );
}

// ─── Dağıtım: ödeme hangi giderleri kapatıyor ──────────────────────

/** Borç anahtarı ('gider:<id>' ya da 'tevkifat:<id>') → kullanıcının yazdığı tutar metni. Listede olmayan seçili değildir. */
export type DagitimFormu = Record<string, string>;

const anahtar = (g: Pick<AcikGider, 'hedefTur' | 'gider'>) => `${g.hedefTur}:${g.gider.id}`;

export const formdanDagitim = (f: DagitimFormu): { dagitim: Dagitim[]; hatali: boolean } => {
  let hatali = false;
  const dagitim = Object.entries(f).map(([a, metin]) => {
    const [hedefTur, giderId] = a.split(':') as [BorcTuru, string];
    const tutar = tlOku(metin);
    if (tutar === null) hatali = true;
    return { hedefTur, giderId, tutar: tutar ?? 0 };
  });
  return { dagitim, hatali };
};

export const otomatik = (tutar: number, giderler: AcikGider[]): DagitimFormu =>
  Object.fromEntries(
    [...otomatikDagit(tutar, giderler.map((g) => ({ id: anahtar(g), sira: g.vade, kalan: g.kalan }))).dagitim].map(([id, t]) => [id, tutarMetni(t)]),
  );

export function DagitimListesi(props: { giderler: AcikGider[]; form: DagitimFormu; onDegisti: (f: DagitimFormu) => void }) {
  if (props.giderler.length === 0) return <p className="soluk">Bu carinin açık borcu yok; ödeme avans olarak kaydedilir.</p>;
  return (
    <ul className="liste dagitim">
      {props.giderler.map((borc) => {
        const { gider, kalan, projeAdi, vadesiGecti, vade } = borc;
        const a = anahtar(borc);
        const secili = a in props.form;
        const tevkifat = borc.hedefTur === 'tevkifat';
        return (
          <li key={a}>
            <label className="onay-kutusu">
              <input
                type="checkbox"
                checked={secili}
                onChange={(e) => {
                  const f = { ...props.form };
                  if (e.target.checked) f[a] = tutarMetni(kalan);
                  else delete f[a];
                  props.onDegisti(f);
                }}
              />
              <span>
                {tevkifat && 'KDV tevkifatı · '}
                <strong>{tarihYaz(gider.tarih)}</strong> {gider.faturaNo && `· ${gider.faturaNo} `}·{' '}
                {tevkifat ? (borc.saticiAdi ?? 'Carisiz alış') : (projeAdi ?? 'Genel')}
                <span className={`soluk blok ${vadesiGecti ? 'bakiye-borc' : ''}`}>
                  Kalan {tlYaz(kalan)}
                  {tevkifat ? ` · son gün ${tarihYaz(vade)}` : gider.vadeTarihi && ` · vade ${tarihYaz(gider.vadeTarihi)}`}
                </span>
              </span>
            </label>
            {secili && (
              <input
                className="dagitim-tutar"
                value={props.form[a]}
                inputMode="decimal"
                aria-label="Bu gidere yazılan tutar"
                onChange={(e) => props.onDegisti({ ...props.form, [a]: e.target.value })}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Ödeme ─────────────────────────────────────────────────────────

export function OdemeFormu(props: { cariId?: string; giderId?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [cariler, setCariler] = useState<CariOzeti[] | null>(null);
  const [hesaplar, setHesaplar] = useState<HesapOzeti[]>([]);
  const [cariId, setCariId] = useState<string | null>(props.cariId ?? null);
  const [giderler, setGiderler] = useState<AcikGider[]>([]);
  const [form, setForm] = useState({ tarih: bugun(), hesapId: '', tutar: '', aciklama: '' });
  const [dagitim, setDagitim] = useState<DagitimFormu>({});
  /** Kullanıcı dağıtımı elle değiştirdiyse tutar değişince yeniden dağıtılmaz. */
  const [elle, setElle] = useState(false);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    void Promise.all([carileriListele(depo, oturum.firmaId), hesaplariListele(depo, oturum.firmaId)]).then(([c, h]) => {
      setCariler(c);
      setHesaplar(h.filter((x) => x.hesap.paraBirimi === 'TRY'));
    });
  }, [depo, oturum.firmaId]);

  useEffect(() => {
    setGiderler([]);
    setDagitim({});
    setElle(false);
    if (!cariId) return;
    void acikGiderler(depo, oturum.firmaId, cariId, bugun()).then((liste) => {
      setGiderler(liste);
      // Gider ekranından gelindiyse o giderin kalanı hazır gelir.
      const hedef = liste.find((g) => g.hedefTur === 'gider' && g.gider.id === props.giderId);
      if (hedef) {
        setForm((f) => ({ ...f, tutar: tutarMetni(hedef.kalan) }));
        setDagitim({ [anahtar(hedef)]: tutarMetni(hedef.kalan) });
        setElle(true);
      }
    });
  }, [depo, oturum.firmaId, cariId, props.giderId]);

  if (!cariler) return <p>Yükleniyor…</p>;

  const tutar = tlOku(form.tutar);
  const { dagitim: dagitimListesi, hatali } = formdanDagitim(dagitim);
  const dagitilan = dagitimListesi.reduce((t, d) => t + d.tutar, 0);
  const avans = tutar !== null ? tutar - dagitilan : null;
  const toplamBorc = giderler.reduce((t, g) => t + g.kalan, 0);

  function tutarDegisti(metin: string) {
    setForm((f) => ({ ...f, tutar: metin }));
    const t = tlOku(metin);
    if (!elle && t !== null) setDagitim(otomatik(t, giderler));
  }

  async function kaydet() {
    const yeniHatalar: string[] = [];
    if (!cariId) yeniHatalar.push('Ödeme yapılan cariyi seçin.');
    if (tutar === null) yeniHatalar.push('Ödeme tutarını yazın.');
    if (!form.hesapId) yeniHatalar.push('Ödemenin çıktığı kasa/banka/kartı seçin.');
    if (hatali) yeniHatalar.push('Giderlere yazılan tutarlardan biri sayı değil.');
    setHatalar(yeniHatalar);
    if (yeniHatalar.length > 0) return;
    setIslemde(true);
    try {
      const o = await odemeYap(depo, servis, { tarih: form.tarih, cariId: cariId!, hesapId: form.hesapId, tutar: tutar!, aciklama: form.aciklama, dagitim: dagitimListesi });
      git(`odemeler/${o.id}`);
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  return (
    <>
      <h1>Ödeme yap</h1>
      <section className="kart">
        <div className="alan">
          <span className="alan-etiket">Kime</span>
          <CariSecici cariler={cariler} secili={cariId} onSec={setCariId} oncelikli={['tedarikci', 'usta']} />
        </div>
        {cariId && (
          <>
            <div className="iki-sutun">
              <Alan etiket="Tutar (₺)" aciklama={toplamBorc > 0 ? `Açık borç toplamı ${tlYaz(toplamBorc)}` : undefined}>
                <input value={form.tutar} inputMode="decimal" placeholder="0" onChange={(e) => tutarDegisti(e.target.value)} autoFocus />
              </Alan>
              <Alan etiket="Tarih">
                <input type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} />
              </Alan>
            </div>
            <HesapSecimi hesaplar={hesaplar} secili={form.hesapId} onSec={(hesapId) => setForm({ ...form, hesapId })} etiket="Nereden" />
            <EksiBakiyeUyarisi hesap={hesaplar.find((h) => h.hesap.id === form.hesapId)} tutar={tutar} />
            <Alan etiket="Açıklama">
              <input value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} />
            </Alan>
          </>
        )}
      </section>

      {cariId && (
        <section className="kart">
          <div className="baslik-satiri">
            <h2>Hangi borçları kapatıyor</h2>
            {giderler.length > 0 && tutar !== null && (
              <button
                type="button"
                className="ikincil"
                onClick={() => {
                  setDagitim(otomatik(tutar, giderler));
                  setElle(false);
                }}
              >
                Otomatik
              </button>
            )}
          </div>
          <p className="soluk">En eski vadeden başlayarak dağıtılır; isterseniz değiştirin.</p>
          <DagitimListesi
            giderler={giderler}
            form={dagitim}
            onDegisti={(f) => {
              setDagitim(f);
              setElle(true);
            }}
          />
          {avans !== null && (
            <p className={avans < 0 ? 'mesaj mesaj-uyari' : 'mesaj-not'}>
              {avans < 0
                ? `Dağıtılan ${tlYaz(dagitilan)}, ödemeden ${tlYaz(-avans)} fazla.`
                : avans > 0
                  ? `${tlYaz(avans)} hiçbir borca bağlanmadı; cariye avans olarak kalır.`
                  : 'Ödemenin tamamı borçlara bağlandı.'}
            </p>
          )}
          <Hatalar hatalar={hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={() => void kaydet()} disabled={islemde}>
              {islemde ? 'Kaydediliyor…' : 'Ödemeyi kaydet'}
            </button>
            <button type="button" className="ikincil" onClick={() => history.back()} disabled={islemde}>
              Vazgeç
            </button>
          </div>
        </section>
      )}
    </>
  );
}

// ─── Avansı gidere bağlama ─────────────────────────────────────────

function AvansEslestir({ detay, onBitti }: { detay: OdemeDetayi; onBitti: () => Promise<void> }) {
  const { depo, oturum, servis } = useUygulama();
  const [giderler, setGiderler] = useState<AcikGider[] | null>(null);
  const [dagitim, setDagitim] = useState<DagitimFormu>({});
  const [hatalar, setHatalar] = useState<string[]>([]);

  useEffect(() => {
    void acikGiderler(depo, oturum.firmaId, detay.odeme.cariId!, bugun()).then((liste) => {
      setGiderler(liste);
      setDagitim(otomatik(detay.acik, liste));
    });
  }, [depo, oturum.firmaId, detay]);

  if (!giderler) return null;
  if (giderler.length === 0) return <p className="soluk">Bu carinin bağlanacak açık gideri yok. Yeni gider girildiğinde buradan bağlayabilirsiniz.</p>;

  async function kaydet() {
    const { dagitim: liste, hatali } = formdanDagitim(dagitim);
    if (hatali) return setHatalar(['Tutarlardan biri sayı değil.']);
    try {
      await avansEslestir(depo, servis, detay.odeme.id, liste);
      await onBitti();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <>
      <DagitimListesi giderler={giderler} form={dagitim} onDegisti={setDagitim} />
      <Hatalar hatalar={hatalar} />
      <button type="button" onClick={() => void kaydet()}>
        Giderlere bağla
      </button>
    </>
  );
}

// ─── İade alacağını faturalara mahsup ──────────────────────────────

export function IadeMahsup(props: { iadeId: string; cariId: string; acik: number; onBitti: () => Promise<void> }) {
  const { depo, oturum, servis } = useUygulama();
  const [giderler, setGiderler] = useState<AcikGider[] | null>(null);
  const [dagitim, setDagitim] = useState<DagitimFormu>({});
  const [hatalar, setHatalar] = useState<string[]>([]);

  useEffect(() => {
    void acikGiderler(depo, oturum.firmaId, props.cariId, bugun()).then((liste) => {
      // İade yalnızca faturalara mahsup edilir (tevkifat değil).
      const faturalar = liste.filter((g) => g.hedefTur === 'gider');
      setGiderler(faturalar);
      setDagitim(otomatik(props.acik, faturalar));
    });
  }, [depo, oturum.firmaId, props.cariId, props.acik]);

  if (!giderler) return null;
  if (giderler.length === 0) return <p className="soluk">Bu carinin mahsup edilecek açık faturası yok. Yeni fatura girildiğinde buradan mahsup edebilirsiniz.</p>;

  async function kaydet() {
    const { dagitim: liste, hatali } = formdanDagitim(dagitim);
    if (hatali) return setHatalar(['Tutarlardan biri sayı değil.']);
    try {
      await iadeMahsup(depo, servis, props.iadeId, liste);
      await props.onBitti();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <>
      <p className="soluk">En eski vadeden başlayarak dağıtılır; isterseniz değiştirin.</p>
      <DagitimListesi giderler={giderler} form={dagitim} onDegisti={setDagitim} />
      <Hatalar hatalar={hatalar} />
      <button type="button" onClick={() => void kaydet()}>
        Mahsup et
      </button>
    </>
  );
}

// ─── Tahsilat ──────────────────────────────────────────────────────

/** `iadeId`: tedarikçinin iade karşılığı geri verdiği para; o iadenin alacağını kapatır. */
export function TahsilatFormu(props: { cariId?: string; iadeId?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [kaynak, setKaynak] = useState<{ cariler: CariOzeti[]; hesaplar: HesapOzeti[]; projeler: ProjeOzeti[] } | null>(null);
  const [form, setForm] = useState({
    amac: 'cari' as TahsilatAmaci,
    cariId: props.cariId ?? (null as string | null),
    hesapId: '',
    tutar: '',
    tarih: bugun(),
    projeId: '',
    aciklama: '',
  });
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);
  const [iade, setIade] = useState<{ ad: string; acik: number } | null>(null);

  useEffect(() => {
    const f = oturum.firmaId;
    void Promise.all([carileriListele(depo, f), hesaplariListele(depo, f), projeleriListele(depo, f)]).then(([cariler, h, projeler]) =>
      setKaynak({ cariler, hesaplar: h.filter((x) => x.hesap.paraBirimi === 'TRY' && x.hesap.tur !== 'kredi_karti'), projeler }),
    );
  }, [depo, oturum.firmaId]);

  // İade karşılığı: tutar iadenin açık alacağıyla, proje iadenin projesiyle gelir.
  useEffect(() => {
    if (!props.iadeId) return;
    void giderDetayiGetir(depo, oturum.firmaId, props.iadeId, bugun()).then((d) => {
      if (!d || d.gider.tur !== 'iade') return;
      setIade({ ad: `${tarihYaz(d.gider.tarih)}${d.gider.faturaNo ? ` · ${d.gider.faturaNo}` : ''}`, acik: d.iadeAcik });
      setForm((f) => ({
        ...f,
        tutar: tutarMetni(d.iadeAcik),
        projeId: d.gider.projeId ?? '',
        aciklama: f.aciklama || `İade${d.gider.faturaNo ? ` ${d.gider.faturaNo}` : ''}`,
      }));
    });
  }, [depo, oturum.firmaId, props.iadeId]);

  if (!kaynak) return <p>Yükleniyor…</p>;
  const cariler = form.amac === 'ortakSermaye' ? kaynak.cariler.filter((c) => c.cari.roller.includes('ortak')) : kaynak.cariler;

  async function kaydet() {
    const tutar = tlOku(form.tutar);
    const yeniHatalar = [...(tutar === null ? ['Tutarı yazın.'] : []), ...(form.hesapId ? [] : ['Paranın girdiği hesabı seçin.'])];
    setHatalar(yeniHatalar);
    if (yeniHatalar.length > 0) return;
    setIslemde(true);
    try {
      const o = await tahsilatKaydet(depo, servis, { ...form, tutar: tutar!, projeId: form.projeId || null, iadeId: iade ? props.iadeId : null });
      git(`odemeler/${o.id}`);
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  return (
    <>
      <h1>Tahsilat</h1>
      <section className="kart">
        {iade && (
          <p className="mesaj mesaj-not" role="status">
            İade karşılığı geri alınan para ({iade.ad}). Açık alacak {tlYaz(iade.acik)}; fazlası cariye borç yazılır.
          </p>
        )}
        {!iade && (
          <>
            <div className="filtreler" role="group" aria-label="Tahsilatın amacı">
              {(Object.entries(TAHSILAT_AMACI_ADI) as [TahsilatAmaci, string][]).map(([k, ad]) => (
                <button key={k} type="button" aria-pressed={form.amac === k} onClick={() => setForm({ ...form, amac: k })}>
                  {ad}
                </button>
              ))}
            </div>
            <p className="mesaj-not">
              {form.amac === 'cari' && 'Cariden gelen para; cariye olan alacağımızı kapatır ya da ona borç yazar. Satış tahsilatı 3. aşamada.'}
              {form.amac === 'ortakSermaye' && 'Gelir değildir; ortağa borç olarak görünür.'}
              {form.amac === 'krediKullanim' && 'Gelir değildir. Krediyi veren bankayı cari olarak seçebilirsiniz.'}
            </p>
          </>
        )}
        <div className="alan">
          <span className="alan-etiket">Kimden</span>
          <CariSecici
            key={form.amac}
            cariler={cariler}
            secili={form.cariId}
            onSec={(cariId) => setForm({ ...form, cariId })}
            bosEtiket={form.amac === 'krediKullanim' ? 'Cari seçmeden' : undefined}
            oncelikli={form.amac === 'cari' ? ['musteri'] : undefined}
          />
        </div>
        <div className="iki-sutun">
          <Alan etiket="Tutar (₺)">
            <input value={form.tutar} inputMode="decimal" placeholder="0" onChange={(e) => setForm({ ...form, tutar: e.target.value })} />
          </Alan>
          <Alan etiket="Tarih">
            <input type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} />
          </Alan>
        </div>
        <HesapSecimi hesaplar={kaynak.hesaplar} secili={form.hesapId} onSec={(hesapId) => setForm({ ...form, hesapId })} etiket="Nereye girdi" />
        <Alan etiket="Proje" aciklama="İsteğe bağlı; nakit akışı raporunda projeye yazılır.">
          <select value={form.projeId} onChange={(e) => setForm({ ...form, projeId: e.target.value })}>
            <option value="">Projesiz</option>
            {kaynak.projeler.map(({ proje }) => (
              <option key={proje.id} value={proje.id}>
                {proje.ad}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Açıklama">
          <input value={form.aciklama} onChange={(e) => setForm({ ...form, aciklama: e.target.value })} />
        </Alan>
        <Hatalar hatalar={hatalar} />
        <div className="dugmeler">
          <button type="button" onClick={() => void kaydet()} disabled={islemde}>
            {islemde ? 'Kaydediliyor…' : 'Tahsilatı kaydet'}
          </button>
          <button type="button" className="ikincil" onClick={() => history.back()} disabled={islemde}>
            Vazgeç
          </button>
        </div>
      </section>
    </>
  );
}

// ─── Ödeme / tahsilat detayı ───────────────────────────────────────

export function OdemeDetay({ odemeId }: { odemeId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  /** undefined: okunuyor, null: bulunamadı */
  const [detay, setDetay] = useState<OdemeDetayi | null | undefined>(undefined);
  const [baglaniyor, setBaglaniyor] = useState(false);
  const [iptalSoruluyor, setIptalSoruluyor] = useState(false);

  const yenile = useCallback(async () => {
    setDetay(await odemeDetayiGetir(depo, oturum.firmaId, odemeId));
    setBaglaniyor(false);
  }, [depo, oturum.firmaId, odemeId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  if (detay === undefined) return <p>Yükleniyor…</p>;
  if (detay === null) return <p className="hata">Kayıt bulunamadı ya da iptal edilmiş.</p>;
  const { odeme } = detay;
  const tahsilat = odeme.yon === 'tahsilat';

  return (
    <>
      <p>
        <a href={odeme.cariId ? `#/cariler/${odeme.cariId}` : '#/kayit'}>← {detay.cariAdi ?? 'Kayıt'}</a>
      </p>
      <h1>{tahsilat ? 'Tahsilat' : 'Ödeme'}</h1>
      {kutu}
      <Hatalar hatalar={hata ? [hata] : []} />
      <section className="kart">
        <p className="bakiye-buyuk">
          <strong className={tahsilat ? 'bakiye-alacak' : 'bakiye-borc'}>
            {tahsilat ? '+' : '−'}
            {tlYaz(odeme.tutar)}
          </strong>
        </p>
        <dl className="bilgi">
          <dt>Tarih</dt>
          <dd>{tarihYaz(odeme.tarih)}</dd>
          <dt>{tahsilat ? 'Kimden' : 'Kime'}</dt>
          <dd>{odeme.cariId ? <a href={`#/cariler/${odeme.cariId}`}>{detay.cariAdi}</a> : '—'}</dd>
          <dt>{tahsilat ? 'Nereye' : 'Nereden'}</dt>
          <dd>
            {odeme.hesapId ? (
              <a href={`#/hesaplar/${odeme.hesapId}`}>{detay.hesapAdi}</a>
            ) : odeme.cekSenetId ? (
              <a href={`#/cekler/${odeme.cekSenetId}`}>{odeme.yontem === 'ciro' ? 'Ciro edilen çek' : odeme.yontem === 'senet' ? 'Senet' : 'Çek'}</a>
            ) : (
              '—'
            )}
          </dd>
          {tahsilat && (
            <div className="bilgi-satir">
              <dt>Amaç</dt>
              <dd>{TAHSILAT_AMACI_ADI[odeme.amac as TahsilatAmaci] ?? odeme.amac}</dd>
            </div>
          )}
          {odeme.aciklama && (
            <div className="bilgi-satir">
              <dt>Açıklama</dt>
              <dd>{odeme.aciklama}</dd>
            </div>
          )}
        </dl>
      </section>

      {(!tahsilat || detay.eslesmeler.length > 0) && (
        <section className="kart">
          <h2>{tahsilat ? 'Kapattığı iade alacağı' : 'Kapattığı borçlar'}</h2>
          {detay.eslesmeler.length === 0 && <p className="soluk">Henüz hiçbir gidere bağlanmadı.</p>}
          <ul className="liste">
            {detay.eslesmeler.map(({ eslestirme, gider, saticiAdi }) => (
              <li key={eslestirme.id}>
                <a href={`#/giderler/${gider.id}`}>
                  {eslestirme.hedefTur === 'tevkifat' && 'KDV tevkifatı · '}
                  {eslestirme.hedefTur === 'iade' && 'İade · '}
                  {tarihYaz(gider.tarih)}
                  {gider.faturaNo && ` · ${gider.faturaNo}`}
                  {saticiAdi && ` · ${saticiAdi}`}
                </a>
                <span className="satir-ici">
                  <strong>{tlYaz(eslestirme.tutar)}</strong>
                  <button
                    type="button"
                    className="baglanti-dugmesi"
                    onClick={() =>
                      void degistir(eslestirme, 'Eşleştirme kaldırılıyor', async (g) => {
                        await servis.iptal('eslestirme', eslestirme.id, g);
                        await yenile();
                      })
                    }
                  >
                    Kaldır
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {detay.acik > 0 && (
            <>
              <p className="mesaj-not">{tlYaz(detay.acik)} hiçbir borca bağlı değil (avans).</p>
              {baglaniyor ? (
                <AvansEslestir detay={detay} onBitti={yenile} />
              ) : (
                <button type="button" className="ikincil" onClick={() => setBaglaniyor(true)}>
                  Giderlere bağla
                </button>
              )}
            </>
          )}
        </section>
      )}

      {odeme.cekSenetId ? (
        <section className="kart">
          <p className="mesaj-not">
            Bu kayıt çek/senetle yapıldı. Değiştirmek ya da iptal etmek için{' '}
            <a href={`#/cekler/${odeme.cekSenetId}`}>çek/senet ekranını</a> kullanın.
          </p>
        </section>
      ) : (
        <section className="kart">
          <h2>{tahsilat ? 'Tahsilatı' : 'Ödemeyi'} iptal et</h2>
          <p className="soluk">
            {tahsilat
              ? 'Para hesaba girmemiş sayılır.'
              : 'Para hesaba geri dönmüş sayılır; kapattığı borçlar yeniden açılır.'}{' '}
            Kayıt geçmişte kalır.
          </p>
          {iptalSoruluyor ? (
            <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="İptal onayı">
              <p>Bu kayıt iptal edilsin mi?</p>
              <div className="dugmeler">
                <button
                  type="button"
                  className="tehlikeli"
                  onClick={() => {
                    setIptalSoruluyor(false);
                    void degistir(odeme, 'İptal ediliyor', async (g) => {
                      await servis.iptal('odeme', odeme.id, g);
                      git(odeme.cariId ? `cariler/${odeme.cariId}` : 'kayit');
                    });
                  }}
                >
                  Evet, iptal et
                </button>
                <button type="button" className="ikincil" onClick={() => setIptalSoruluyor(false)}>
                  Hayır
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="ikincil" onClick={() => setIptalSoruluyor(true)}>
              İptal et
            </button>
          )}
        </section>
      )}
    </>
  );
}
