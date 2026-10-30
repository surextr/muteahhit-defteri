import { useCallback, useEffect, useMemo, useState } from 'react';
import { dovizdenTl, tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { sayiOku } from '../hesap/sayi';
import { kurYaz, PLAN_TURU_ADI, planOner, satisEksikleri, satisTutarlari, type SatisIcerigi, type SatisPlanDurumu } from '../hesap/satis';
import { yerelGun } from '../hesap/tarih';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import { projeGetir } from '../servisler/proje';
import {
  projeSatislari,
  protokolGetir,
  satisaAcikBolumler,
  satisDetayi,
  satisIcerigi,
  satisIptal,
  satisKaydet,
  satisMaddeleriniVarsayilanYap,
  satisOlustur,
  satisOnayla,
  satisTeslim,
  bolumSatisi,
  type ProjeSatislari,
  type ProtokolBelgesi,
  type SatisSatiri,
} from '../servisler/satis';
import { yeniId } from '../veri/kimlik';
import type { BagimsizBolum, ParaBirimi, Proje, Satis, SatisPlanSatiri } from '../veri/tipler';
import { useUygulama } from './baglam';
import { SozlesmeBelgesiGorunumu } from './BelgeGorunumu';
import { BelgelerKarti } from './Belgeler';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { CariSecici } from './CariSecici';
import { TutarGirdisi } from './Girdiler';
import { git } from './rota';
import { KurulumUyarilari } from './HavuzSozlesme';

// Daire satışı: proje kartı, bölümden "Satış yap", satış formu (bedel, takas, ödeme planı, teslim, protokol maddeleri),
// imza, tahsilat durumu ve yazdırılabilir ön satış protokolü.

const tarihYaz = (t: string | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '—');

const PLAN_DURUM_ADI: Record<SatisPlanDurumu, string> = {
  bekliyor: 'İmza bekliyor',
  tahsil_edildi: 'Tahsil edildi',
  kismen: 'Kısmen',
  gecikti: 'Gecikti',
  yaklasan: '30 gün içinde',
  ileride: 'İleride',
};

function PlanRozeti({ d }: { d: SatisPlanDurumu }) {
  const sinif = d === 'tahsil_edildi' ? 'rozet-tamam' : d === 'gecikti' ? 'rozet-gecikti' : 'rozet-taslak';
  return <span className={sinif}>{PLAN_DURUM_ADI[d]}</span>;
}

export function SatisDurumu({ s }: { s: Pick<Satis, 'onay' | 'teslimEdildi'> }) {
  if (s.teslimEdildi) return <span className="rozet-tamam">Teslim edildi</span>;
  return s.onay ? <span className="rozet-tamam">Sözleşmeli</span> : <span className="rozet-taslak">Rezerve</span>;
}

// ─── Proje kartı ───────────────────────────────────────────────────

export function SatislarKarti({ projeId }: { projeId: string }) {
  const { depo, oturum } = useUygulama();
  const [veri, setVeri] = useState<ProjeSatislari | null>(null);
  useEffect(() => {
    void projeSatislari(depo, oturum.firmaId, projeId, yerelGun(new Date())).then(setVeri);
  }, [depo, oturum.firmaId, projeId]);

  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Satışlar</h2>
        <a className="dugme" href={`#/satislar/yeni/${projeId}`}>
          + Satış
        </a>
      </div>
      {veri === null && <p>Yükleniyor…</p>}
      {veri && (
        <>
          <p className="soluk kucuk">
            {veri.ozet.adet} sözleşmeli{veri.ozet.rezerve > 0 && ` · ${veri.ozet.rezerve} rezerve`} · {veri.satisaAcik} satışa açık
          </p>
          {veri.ozet.adet > 0 && (
            <>
              <p className="ozet-tutar">
                <span>Satış toplamı</span>
                <span>{tlYaz(veri.ozet.net)}</span>
              </p>
              <p className="ozet-tutar">
                <span>Tahsil edilen</span>
                <span>{tlYaz(veri.ozet.tahsil)}</span>
              </p>
              <p className="ozet-tutar ozet-ara">
                <span>Kalan alacak</span>
                <span>{tlYaz(veri.ozet.kalan)}</span>
              </p>
              {veri.ozet.geciken > 0 && <p className="mesaj mesaj-uyari">Vadesi geçmiş {tlYaz(veri.ozet.geciken)} tahsil edilmedi.</p>}
            </>
          )}
          {veri.satirlar.length === 0 ? (
            <p className="soluk">
              Henüz satış yok. <a href={`#/projeler/${projeId}/bina`}>Bina</a> sekmesinde krokide bir daireye dokunup "Satış yap" ile de başlayabilirsiniz.
            </p>
          ) : (
            <ul className="liste">
              {veri.satirlar.map((x) => (
                <li key={x.satis.id}>
                  <a href={`#/satislar/${x.satis.id}`} className="genis-satir">
                    <span className="baslik-satiri">
                      <strong>
                        {x.bolumNo} · {x.cari.ad}
                      </strong>
                      <SatisDurumu s={x.satis} />
                    </span>
                    <span className="soluk blok kucuk">
                      {x.ozet.net > 0 ? tlYaz(x.ozet.net) : 'fiyat yazılmadı'}
                      {x.satis.onay && ` · kalan ${tlYaz(x.ozet.kalan)}`}
                      {x.ozet.geciken > 0 && ` · geciken ${tlYaz(x.ozet.geciken)}`}
                      {x.satis.onay && x.ozet.sonraki && x.ozet.geciken === 0 && ` · sıradaki ${tarihYaz(x.ozet.sonraki.satir.vadeTarihi)}`}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

/** Krokide seçilen bölümün formunda: satışı varsa bağlantı, yoksa "Satış yap". */
export function BolumSatisBaglantisi({ bolum }: { bolum: BagimsizBolum }) {
  const { depo, oturum } = useUygulama();
  const [satis, setSatis] = useState<Satis | null | undefined>(undefined);
  useEffect(() => {
    void bolumSatisi(depo, oturum.firmaId, bolum.id).then(setSatis);
  }, [depo, oturum.firmaId, bolum.id]);
  if (satis === undefined || bolum.sahiplik === 'arsa_sahibi') return null;
  return (
    <p>
      {satis ? (
        <a className="dugme ikincil" href={`#/satislar/${satis.id}`}>
          Satışı aç
        </a>
      ) : (
        <a className="dugme ikincil" href={`#/satislar/yeni/${bolum.projeId}/${bolum.id}`}>
          Satış yap
        </a>
      )}
    </p>
  );
}

// ─── Yeni satış ────────────────────────────────────────────────────

export function SatisYeni({ projeId, bolumId }: { projeId: string; bolumId?: string }) {
  const { depo, oturum, servis, firma } = useUygulama();
  const [proje, setProje] = useState<Proje | null | undefined>(undefined);
  const [bolumler, setBolumler] = useState<{ bolum: BagimsizBolum; no: string }[]>([]);
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [secili, setSecili] = useState(bolumId ?? '');
  const [cariId, setCariId] = useState<string | null>(null);
  const [tarih, setTarih] = useState(yerelGun(new Date()));
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, b, c] = await Promise.all([
        projeGetir(depo, oturum.firmaId, projeId),
        satisaAcikBolumler(depo, oturum.firmaId, projeId),
        carileriListele(depo, oturum.firmaId),
      ]);
      setProje(p);
      setBolumler(b);
      setCariler(c.filter((x) => !x.cari.roller.includes('vergi_dairesi')));
    })();
  }, [depo, oturum.firmaId, projeId]);

  async function olustur() {
    setIslemde(true);
    setHata(null);
    try {
      const s = await satisOlustur(depo, servis, firma, { bolumId: secili, cariId: cariId ?? '', tarih });
      git(`satislar/${s.id}`);
    } catch (e) {
      setHata(hataMetni(e));
      setIslemde(false);
    }
  }

  if (proje === undefined) return <p>Yükleniyor…</p>;
  if (proje === null) return <p className="hata">Proje bulunamadı.</p>;
  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <h1>Yeni satış</h1>
      <section className="kart">
        <Alan
          etiket="Bağımsız bölüm"
          aciklama={bolumler.length === 0 ? 'Satışa açık bölüm yok (arsa sahibinin ya da satılmış olanlar listede yok).' : undefined}
        >
          <select value={secili} onChange={(e) => setSecili(e.target.value)}>
            <option value="">Seçin</option>
            {bolumler.map(({ bolum, no }) => (
              <option key={bolum.id} value={bolum.id}>
                {no}
                {bolum.odaSayisi !== null && ` · ${bolum.odaSayisi}+${bolum.salonSayisi ?? 0}`}
                {bolum.brutM2 !== null && ` · ${bolum.brutM2} m²`}
              </option>
            ))}
          </select>
        </Alan>
        <div className="alan">
          <span className="alan-etiket">Müşteri</span>
          <CariSecici
            cariler={cariler}
            secili={cariId}
            onSec={setCariId}
            oncelikli={['musteri']}
            hizliEkle={{ rol: 'musteri', onEklendi: (c) => setCariler((l) => [...l, { cari: c, bakiye: 0 }]) }}
          />
        </div>
        <Alan etiket="Tarih" aciklama="Rezervasyon ya da protokol tarihi; sonra değiştirilebilir.">
          <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
        </Alan>
        {hata && <Hatalar hatalar={[hata]} />}
        <div className="dugmeler">
          <button type="button" disabled={!secili || !cariId || islemde} onClick={() => void olustur()}>
            {islemde ? 'Hazırlanıyor…' : 'Rezerve et ve devam et'}
          </button>
        </div>
        <p className="soluk kucuk">Bölüm "rezerve" olur. Fiyat, ödeme planı ve protokol bir sonraki ekranda yazılır; borç protokol imzalanınca doğar.</p>
      </section>
    </>
  );
}

// ─── Satış formu ───────────────────────────────────────────────────

interface FormPlan {
  id: string;
  tur: SatisPlanSatiri['tur'];
  vadeTarihi: string;
  tutar: string;
  aciklama: string;
  alacakId: string | null;
}
interface Form {
  tarih: string;
  fiyat: string;
  indirim: string;
  kdvOrani: number;
  takas: { aciklama: string; deger: string }[];
  plan: FormPlan[];
  teslimTarihi: string;
  tapuTarihi: string;
  maddeler: SatisIcerigi['maddeler'];
  not: string;
  paraBirimi: ParaBirimi;
  dovizFiyat: string;
  kur: string;
}

const tutarYaz = (k: number) => (k > 0 ? tutarMetni(k) : '');

function birAySonra(t: string): string {
  const [y, a, g] = t.split('-').map(Number) as [number, number, number];
  const yil = a === 12 ? y + 1 : y;
  const ay = a === 12 ? 1 : a + 1;
  const son = new Date(Date.UTC(yil, ay, 0)).getUTCDate();
  return `${yil}-${String(ay).padStart(2, '0')}-${String(Math.min(g, son)).padStart(2, '0')}`;
}

const formaCevir = (s: SatisIcerigi): Form => ({
  tarih: s.tarih,
  fiyat: tutarYaz(s.fiyat),
  indirim: tutarYaz(s.indirim),
  kdvOrani: s.kdvOrani,
  takas: s.takas.map((x) => ({ aciklama: x.aciklama, deger: tutarYaz(x.deger) })),
  plan: s.plan.map((p) => ({ ...p, tutar: tutarYaz(p.tutar) })),
  teslimTarihi: s.teslimTarihi ?? '',
  tapuTarihi: s.tapuTarihi ?? '',
  maddeler: s.maddeler.map((m) => ({ ...m })),
  not: s.not,
  paraBirimi: s.doviz?.paraBirimi ?? 'TRY',
  dovizFiyat: s.doviz ? tutarMetni(s.doviz.tutar) : '',
  kur: s.doviz ? kurYaz(s.doviz.kur) : '',
});

function formdan(f: Form): { icerik: SatisIcerigi; hatalar: string[] } {
  const hatalar: string[] = [];
  const oku = (m: string, ad: string) => {
    if (!m.trim()) return 0;
    const v = tlOku(m);
    if (v === null) hatalar.push(`${ad} okunamadı (örn. 2.500.000).`);
    return v ?? 0;
  };
  let doviz: SatisIcerigi['doviz'] = null;
  if (f.paraBirimi !== 'TRY') {
    const kur = f.kur.trim() ? sayiOku(f.kur) : 0;
    if (kur === null) hatalar.push('Kur okunamadı (örn. 34,5).');
    doviz = { paraBirimi: f.paraBirimi, tutar: oku(f.dovizFiyat, 'Dövizli fiyat'), kur: kur ?? 0 };
  }
  return {
    icerik: {
      tarih: f.tarih,
      doviz,
      fiyat: doviz && doviz.kur > 0 ? dovizdenTl(doviz.tutar, doviz.kur) : oku(f.fiyat, 'Fiyat'),
      indirim: oku(f.indirim, 'İndirim'),
      kdvOrani: f.kdvOrani,
      takas: f.takas.map((x) => ({ aciklama: x.aciklama, deger: oku(x.deger, `"${x.aciklama || 'Takas'}" değeri`) })),
      plan: f.plan.map((p) => ({ ...p, tutar: oku(p.tutar, `${tarihYaz(p.vadeTarihi)} vadeli ödeme`) })),
      teslimTarihi: f.teslimTarihi || null,
      tapuTarihi: f.tapuTarihi || null,
      maddeler: f.maddeler,
      not: f.not,
    },
    hatalar: [...new Set(hatalar)],
  };
}

export function SatisEkrani({ id }: { id: string }) {
  const { depo, oturum, servis, firma, yenile: firmaYenile } = useUygulama();
  const [x, setX] = useState<SatisSatiri | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [oneri, setOneri] = useState({ pesinat: '', adet: '', ilkVade: '' });
  const { degistir, kutu, hata } = useGerekceliDegisiklik();

  const yukle = useCallback(async () => {
    const d = await satisDetayi(depo, oturum.firmaId, id, yerelGun(new Date()));
    setX(d);
    if (d) setForm(formaCevir(satisIcerigi(d.satis)));
  }, [depo, oturum.firmaId, id]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  const cevrim = useMemo(() => (form ? formdan(form) : null), [form]);
  const kayitli = useMemo(() => (x ? JSON.stringify(formaCevir(satisIcerigi(x.satis))) : ''), [x]);

  if (x === undefined || (x && !form)) return <p>Yükleniyor…</p>;
  if (x === null || !form || !cevrim) return <p className="hata">Satış bulunamadı.</p>;

  const s = x.satis;
  const imzali = !!s.onay;
  const degisti = JSON.stringify(form) !== kayitli;
  const t = satisTutarlari(cevrim.icerik);
  const eksik = satisEksikleri(cevrim.icerik);
  const durum = new Map(x.durumlar.map((d) => [d.satir.id, d]));
  const yaz = <K extends keyof Form>(alan: K, deger: Form[K]) => {
    setMesaj(null);
    setForm({ ...form, [alan]: deger });
  };
  const planYaz = (i: number, d: Partial<FormPlan>) =>
    yaz(
      'plan',
      form.plan.map((p, j) => (j === i ? { ...p, ...d } : p)),
    );

  async function kaydet(sonra?: () => void) {
    if (!cevrim || cevrim.hatalar.length > 0) return;
    await degistir(
      'İmzalı satışta değişiklik',
      async (gerekce) => {
        await satisKaydet(depo, servis, id, cevrim.icerik, gerekce);
        await yukle();
        setMesaj('Kaydedildi.');
        sonra?.();
      },
      'İmzalı protokolde değişiklik kayıt geçmişine gerekçesiyle yazılır ve protokolün sürüm numarası artar.',
    );
  }

  function planiOner() {
    const pesinat = oneri.pesinat.trim() ? tlOku(oneri.pesinat) : 0;
    const adet = Number(oneri.adet || '0');
    if (pesinat === null || !Number.isInteger(adet) || adet < 0 || adet > 120 || !cevrim) return setMesaj('Peşinat ve taksit sayısını kontrol edin.');
    // İlk taksit boşsa satıştan bir ay sonra (ay sonu taşmaz).
    const ilkVade = oneri.ilkVade || birAySonra(cevrim.icerik.tarih);
    const plan = planOner(cevrim.icerik, { pesinat, taksitSayisi: adet, ilkVade }, yeniId);
    yaz(
      'plan',
      plan.map((p) => ({ ...p, tutar: tutarYaz(p.tutar) })),
    );
  }

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${s.projeId}`}>← Proje</a>
      </p>
      <div className="baslik-satiri">
        <h1>
          {x.bolumNo} · {x.cari.ad}
        </h1>
        <SatisDurumu s={s} />
      </div>
      <KurulumUyarilari />
      {imzali && (
        <p className="mesaj mesaj-not">
          Protokol imzalandı ({tarihYaz(yerelGun(new Date(s.onay!.zaman)))}). Ödeme planı müşterinin carisine alacak olarak yazıldı; değişiklik gerekçe ister.
        </p>
      )}

      {!imzali &&
        (eksik.length > 0 ? (
          <section className="mesaj mesaj-uyari">
            <strong>İmzadan önce tamamlanacak ({eksik.length})</strong>
            <ul>
              {eksik.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
        ) : (
          <p className="mesaj mesaj-basari">Eksik bilgi yok; protokol yazdırılıp imzalatılabilir.</p>
        ))}

      {imzali && (
        <section className="kart">
          <h2>Tahsilat</h2>
          <p className="ozet-tutar">
            <span>Tahsil edilen</span>
            <span>{tlYaz(x.ozet.tahsil)}</span>
          </p>
          <p className="ozet-tutar ozet-ara">
            <span>Kalan</span>
            <span>{tlYaz(x.ozet.kalan)}</span>
          </p>
          {x.ozet.geciken > 0 && <p className="mesaj mesaj-uyari">Vadesi geçmiş {tlYaz(x.ozet.geciken)} var.</p>}
          <div className="dugmeler">
            <a className="dugme" href={`#/odemeler/tahsilat/${s.cariId}`}>
              Tahsilat gir
            </a>
            <a className="dugme ikincil" href={`#/cariler/${s.cariId}`}>
              Müşteri ekstresi
            </a>
          </div>
          <p className="soluk kucuk">Tahsilat en eski vadeli ödemeden başlayarak kapanır; tahsilat ekranında değiştirilebilir.</p>
        </section>
      )}

      <section className="kart">
        <h2>Bedel</h2>
        <div className="iki-sutun">
          <Alan etiket="Para birimi" aciklama={form.paraBirimi === 'TRY' ? undefined : 'Ödemeler TL; kur protokolde sabitlenir.'}>
            <select value={form.paraBirimi} onChange={(e) => yaz('paraBirimi', e.target.value as ParaBirimi)}>
              {(['TRY', 'USD', 'EUR', 'GBP'] as const).map((p) => (
                <option key={p} value={p}>
                  {p === 'TRY' ? 'TL' : p}
                </option>
              ))}
            </select>
          </Alan>
          {form.paraBirimi !== 'TRY' && (
            <>
              <Alan etiket={`Satış fiyatı (KDV dahil, ${form.paraBirimi})`}>
                <TutarGirdisi value={form.dovizFiyat} placeholder="0" onChange={(v) => yaz('dovizFiyat', v)} />
              </Alan>
              <Alan etiket={`Kur (1 ${form.paraBirimi} = ? ₺)`} aciklama="Protokol tarihindeki kur">
                <input inputMode="decimal" value={form.kur} placeholder="örn. 34,50" onChange={(e) => yaz('kur', e.target.value)} />
              </Alan>
            </>
          )}
          <Alan etiket="Satış fiyatı (KDV dahil, ₺)" aciklama={form.paraBirimi !== 'TRY' ? 'Döviz × kur' : undefined}>
            {form.paraBirimi === 'TRY' ? (
              <TutarGirdisi value={form.fiyat} placeholder="0" onChange={(v) => yaz('fiyat', v)} />
            ) : (
              <input value={cevrim.icerik.fiyat > 0 ? tutarMetni(cevrim.icerik.fiyat) : ''} readOnly placeholder="—" />
            )}
          </Alan>
          <Alan etiket="İndirim (₺)">
            <TutarGirdisi value={form.indirim} placeholder="0" onChange={(v) => yaz('indirim', v)} />
          </Alan>
          <Alan etiket="KDV oranı" aciklama="Konutta net alana ve yere göre değişir.">
            <select value={form.kdvOrani} onChange={(e) => yaz('kdvOrani', Number(e.target.value))}>
              {[0, 1, 10, 20].map((o) => (
                <option key={o} value={o}>
                  %{o}
                </option>
              ))}
            </select>
          </Alan>
          <Alan etiket="Tarih">
            <input type="date" value={form.tarih} onChange={(e) => yaz('tarih', e.target.value)} />
          </Alan>
        </div>
        <h3>Takas</h3>
        {form.takas.length === 0 && <p className="soluk kucuk">Bedelin bir kısmı araç, arsa ya da başka daireyle ödeniyorsa ekleyin.</p>}
        {form.takas.map((tk, i) => (
          <div key={i} className="asama-satiri">
            <input
              value={tk.aciklama}
              placeholder="örn. 2019 model araç, plaka…"
              aria-label={`${i + 1}. takasın açıklaması`}
              onChange={(e) =>
                yaz(
                  'takas',
                  form.takas.map((y, j) => (j === i ? { ...y, aciklama: e.target.value } : y)),
                )
              }
            />
            <TutarGirdisi
              value={tk.deger}
              placeholder="Değer (₺)"
              onChange={(v) =>
                yaz(
                  'takas',
                  form.takas.map((y, j) => (j === i ? { ...y, deger: v } : y)),
                )
              }
            />
            <button
              type="button"
              className="ikincil"
              aria-label={`${i + 1}. takası çıkar`}
              onClick={() =>
                yaz(
                  'takas',
                  form.takas.filter((_, j) => j !== i),
                )
              }
            >
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="baglanti-dugmesi" onClick={() => yaz('takas', [...form.takas, { aciklama: '', deger: '' }])}>
          + Takas ekle
        </button>
        <p className="ozet-tutar ozet-ara">
          <span>Satış bedeli (KDV dahil)</span>
          <span>{tlYaz(t.net)}</span>
        </p>
        <p className="soluk kucuk">
          İçindeki KDV %{form.kdvOrani}: {tlYaz(t.kdv)}
          {t.takas > 0 && ` · takas ${tlYaz(t.takas)}`}
        </p>
        <p className="ozet-tutar ozet-toplam">
          <span>Nakit tahsil edilecek</span>
          <strong>{tlYaz(t.nakit)}</strong>
        </p>
      </section>

      <section className="kart">
        <h2>Ödeme planı</h2>
        {form.plan.map((p, i) => {
          const d = durum.get(p.id);
          return (
            <div key={p.id} className="plan-satiri">
              <select value={p.tur} aria-label={`${i + 1}. ödemenin türü`} onChange={(e) => planYaz(i, { tur: e.target.value as SatisPlanSatiri['tur'] })}>
                {(Object.keys(PLAN_TURU_ADI) as SatisPlanSatiri['tur'][]).map((k) => (
                  <option key={k} value={k}>
                    {PLAN_TURU_ADI[k]}
                  </option>
                ))}
              </select>
              <input type="date" value={p.vadeTarihi} aria-label={`${i + 1}. ödemenin vadesi`} onChange={(e) => planYaz(i, { vadeTarihi: e.target.value })} />
              <button
                type="button"
                className="ikincil"
                aria-label={`${i + 1}. ödemeyi çıkar`}
                onClick={() =>
                  yaz(
                    'plan',
                    form.plan.filter((_, j) => j !== i),
                  )
                }
              >
                ✕
              </button>
              <div className="plan-tutar">
                <TutarGirdisi value={p.tutar} placeholder="Tutar (₺)" onChange={(v) => planYaz(i, { tutar: v })} />
              </div>
              <input
                className="plan-aciklama"
                value={p.aciklama}
                placeholder="Açıklama (isteğe bağlı)"
                aria-label={`${i + 1}. ödemenin açıklaması`}
                onChange={(e) => planYaz(i, { aciklama: e.target.value })}
              />
              {d && imzali && !degisti && (
                <span className="plan-durum">
                  <PlanRozeti d={d.durum} />
                  {d.tahsil > 0 && d.kalan > 0 && <span className="soluk kucuk"> kalan {tlYaz(d.kalan)}</span>}
                </span>
              )}
            </div>
          );
        })}
        <button
          type="button"
          className="baglanti-dugmesi"
          onClick={() =>
            yaz('plan', [
              ...form.plan,
              { id: yeniId(), tur: 'taksit', vadeTarihi: form.plan.at(-1)?.vadeTarihi ?? form.tarih, tutar: '', aciklama: '', alacakId: null },
            ])
          }
        >
          + Ödeme ekle
        </button>
        <p className="ara-toplam">
          <span>Plan toplamı</span>
          <span>{tlYaz(t.planToplami)}</span>
        </p>
        {t.planFarki !== 0 && t.nakit > 0 && (
          <p className="mesaj mesaj-uyari">
            Plan, nakit tahsil edilecek tutardan {t.planFarki > 0 ? `${tlYaz(t.planFarki)} eksik` : `${tlYaz(-t.planFarki)} fazla`}.
          </p>
        )}
        {!imzali && t.nakit > 0 && (
          <details className="plan-oneri" open={form.plan.length === 0}>
            <summary className="soluk">Planı hazırla: peşinat + eşit taksit</summary>
            <div className="ilave-sayilar">
              <TutarGirdisi value={oneri.pesinat} placeholder="Peşinat (₺)" onChange={(v) => setOneri({ ...oneri, pesinat: v })} />
              <input
                inputMode="numeric"
                value={oneri.adet}
                placeholder="Taksit"
                aria-label="Taksit sayısı"
                onChange={(e) => setOneri({ ...oneri, adet: e.target.value })}
              />
              <input type="date" value={oneri.ilkVade} aria-label="İlk taksit vadesi" onChange={(e) => setOneri({ ...oneri, ilkVade: e.target.value })} />
            </div>
            <p className="soluk kucuk">
              Kapora satırları korunur; peşinat satış gününe, kalan aylık eşit taksitlere yazılır (ilk vade boşsa satıştan bir ay sonra).
            </p>
            <button type="button" className="ikincil" onClick={planiOner}>
              Planı oluştur
            </button>
          </details>
        )}
      </section>

      <section className="kart">
        <h2>Teslim ve tapu</h2>
        <div className="iki-sutun">
          <Alan etiket="Teslim tarihi (taahhüt)">
            <input type="date" value={form.teslimTarihi} onChange={(e) => yaz('teslimTarihi', e.target.value)} />
          </Alan>
          <Alan etiket="Tapu devri">
            <input type="date" value={form.tapuTarihi} onChange={(e) => yaz('tapuTarihi', e.target.value)} />
          </Alan>
        </div>
        {imzali && <TeslimAlani satis={s} onDegisti={yukle} />}
      </section>

      <section className="kart">
        <h2>Protokol maddeleri</h2>
        <p className="soluk kucuk">Her madde için bu satışta ne anlaşıldığını yazın. Boş madde protokolde "…" olarak kalır ve imzayı engeller.</p>
        {form.maddeler.map((m, i) => (
          <Alan key={m.id} etiket={m.baslik}>
            <textarea
              rows={2}
              className={m.metin.trim() ? undefined : 'bos-alan'}
              value={m.metin}
              onChange={(e) =>
                yaz(
                  'maddeler',
                  form.maddeler.map((y, j) => (j === i ? { ...y, metin: e.target.value } : y)),
                )
              }
            />
          </Alan>
        ))}
        <button
          type="button"
          className="baglanti-dugmesi"
          disabled={form.maddeler.every((m) => !m.metin.trim())}
          onClick={() =>
            void degistir('Varsayılan protokol maddeleri', async () => {
              await satisMaddeleriniVarsayilanYap(servis, firma, form.maddeler);
              await firmaYenile();
              setMesaj('Madde metinleri sonraki satışlara da gelecek.');
            })
          }
        >
          Bu metinleri sonraki satışlarda da kullan
        </button>
      </section>

      <section className="kart">
        <Alan etiket="Not" aciklama="Yalnızca sizin için; protokole yazılmaz.">
          <textarea rows={2} value={form.not} onChange={(e) => yaz('not', e.target.value)} />
        </Alan>
      </section>

      <div className="kaydet-cubugu">
        {kutu}
        {cevrim.hatalar.length > 0 && <Hatalar hatalar={cevrim.hatalar} />}
        {hata && <Hatalar hatalar={[hata]} />}
        {mesaj && !degisti && <p className="mesaj mesaj-basari">{mesaj}</p>}
        <div className="dugmeler">
          <button type="button" disabled={!degisti || cevrim.hatalar.length > 0} onClick={() => void kaydet()}>
            Kaydet
          </button>
          <button
            type="button"
            className="ikincil"
            onClick={() => (degisti ? void kaydet(() => git(`satislar/${id}/protokol`)) : git(`satislar/${id}/protokol`))}
          >
            {degisti ? 'Kaydet ve protokolü gör' : 'Protokolü gör / yazdır'}
          </button>
        </div>
      </div>

      {!imzali && <ImzaKarti satis={s} eksikVar={eksik.length > 0} degisti={degisti} onDegisti={yukle} />}

      <BelgelerKarti bagliTur="satis" bagliId={s.id} varsayilanTur="sozlesme" baslik="İmzalı protokol ve belgeler" />

      <IptalKarti satis={s} />
    </>
  );
}

function TeslimAlani({ satis, onDegisti }: { satis: Satis; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [tarih, setTarih] = useState(satis.teslimEdildi ?? yerelGun(new Date()));
  return (
    <>
      {satis.teslimEdildi ? (
        <p className="mesaj mesaj-basari">Anahtar {tarihYaz(satis.teslimEdildi)} tarihinde teslim edildi.</p>
      ) : (
        <div className="satir-ici">
          <input type="date" className="kisa-tarih" value={tarih} aria-label="Teslim edilen gün" onChange={(e) => setTarih(e.target.value)} />
          <button
            type="button"
            className="ikincil"
            onClick={() => void degistir('Teslim', async (g) => (await satisTeslim(depo, servis, satis.id, tarih, g), await onDegisti()))}
          >
            Anahtar teslim edildi
          </button>
        </div>
      )}
      {kutu}
      {hata && <Hatalar hatalar={[hata]} />}
    </>
  );
}

function ImzaKarti(props: { satis: Satis; eksikVar: boolean; degisti: boolean; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const [hata, setHata] = useState<string | null>(null);
  async function onayla() {
    setHata(null);
    try {
      await satisOnayla(depo, servis, props.satis.id);
      await props.onDegisti();
    } catch (e) {
      setHata(hataMetni(e));
    }
  }
  return (
    <section className="kart">
      <h2>İmza</h2>
      <p className="soluk">
        Protokolü yazdırıp müşteriyle imzaladıktan sonra işaretleyin. Ödeme planı müşterinin carisine alacak olarak yazılır; önceden alınan kapora bu alacaklara
        bağlanır.
      </p>
      {props.eksikVar && <p className="soluk kucuk">Eksik bilgiler tamamlanınca işaretlenebilir.</p>}
      {props.degisti && <p className="soluk kucuk">Önce değişiklikleri kaydedin.</p>}
      {hata && <Hatalar hatalar={[hata]} />}
      <div className="dugmeler">
        <button type="button" disabled={props.eksikVar || props.degisti} onClick={() => void onayla()}>
          Protokol imzalandı
        </button>
      </div>
    </section>
  );
}

function IptalKarti({ satis }: { satis: Satis }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  return (
    <section className="kart">
      <details>
        <summary className="soluk">{satis.onay ? 'Satışı iptal et (vazgeçme)' : 'Rezervasyonu kaldır'}</summary>
        <p className="soluk kucuk">Bölüm yeniden satışa çıkar. Tahsilatı olan satış iptal edilmez: önce tahsilatları iptal edin ya da iade ödemesi yapın.</p>
        {kutu}
        {hata && <Hatalar hatalar={[hata]} />}
        <button
          type="button"
          className="tehlikeli"
          onClick={() =>
            void degistir('Satış iptali', async (gerekce) => {
              await satisIptal(depo, servis, satis.id, gerekce);
              git(`projeler/${satis.projeId}`);
            })
          }
        >
          İptal et
        </button>
      </details>
    </section>
  );
}

// ─── Protokol ──────────────────────────────────────────────────────

export function ProtokolEkrani({ id }: { id: string }) {
  const { depo, firma } = useUygulama();
  const [belge, setBelge] = useState<ProtokolBelgesi | null | undefined>(undefined);
  useEffect(() => {
    void protokolGetir(depo, firma, id).then(setBelge);
  }, [depo, firma, id]);
  if (belge === undefined) return <p>Yükleniyor…</p>;
  if (belge === null) return <p className="hata">Satış bulunamadı.</p>;
  const eksik = satisEksikleri(satisIcerigi(belge.satis));
  return (
    <>
      <div className="yazdirma-gizle">
        <p>
          <a className="geri-baglanti" href={`#/satislar/${id}`}>← Satışa dön</a>
        </p>
        <div className="mesaj mesaj-not">
          <p>
            <strong>İmzalamadan önce kontrol edin.</strong> Bu metin girdiğiniz bilgilerle hazırlanan bir taslaktır; hukuki danışmanlık yerine geçmez. Resmi
            satış tapu müdürlüğünde yapılır.
          </p>
          {eksik.length > 0 && <p>{eksik.length} eksik bilgi var; metinde "…" olarak görünür.</p>}
        </div>
        <div className="dugmeler">
          <button type="button" onClick={() => window.print()}>
            Yazdır / PDF olarak kaydet
          </button>
        </div>
      </div>
      <SozlesmeBelgesiGorunumu metin={belge.metin} logo={firma.logo} taslak={!belge.satis.onay} surum={belge.satis.sozlesmeSurumu} />
    </>
  );
}
