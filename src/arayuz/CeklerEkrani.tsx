import { useCallback, useEffect, useState } from 'react';
import { tlOku, tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import {
  CEK_DURUM_ADI,
  CEK_TUR_ADI,
  cekAl,
  cekCiro,
  cekDetayiGetir,
  cekGeriDondu,
  cekIptal,
  cekleriListele,
  cekOde,
  cekSonIslemiGeriAl,
  cekTahsil,
  cekVer,
  YAKLASAN_VADE_GUNU,
  type CekDetayi,
  type CekOzeti,
} from '../servisler/cek';
import { hesaplariListele, type HesapOzeti } from '../servisler/hesap';
import { acikGiderler, type AcikGider } from '../servisler/odeme';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import type { CekSenet } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { CariSecici } from './CariSecici';
import { DagitimListesi, formdanDagitim, HesapSecimi, otomatik, type DagitimFormu } from './OdemeEkrani';
import { git } from './rota';

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const bugun = () => yerelGun(new Date());
const cekAdi = (c: Pick<CekSenet, 'tur' | 'seriNo'>) => `${CEK_TUR_ADI[c.tur]}${c.seriNo ? ` ${c.seriNo}` : ''}`;
/** Türkçe ekler: "Çeki / Senedi", "Çekle / Senetle". */
const belirtme = (t: CekSenet['tur']) => (t === 'cek' ? 'Çeki' : 'Senedi');
const ileEki = (t: CekSenet['tur']) => (t === 'cek' ? 'Çekle' : 'Senetle');

/** Vadeye kalan gün metni; yaklaşan ve geçen vade vurgulu. */
function VadeEtiketi({ ozet }: { ozet: CekOzeti }) {
  const { cek, vadeyeGun } = ozet;
  if (vadeyeGun === null) return <span className="soluk">{CEK_DURUM_ADI[cek.durum]}</span>;
  const metin = vadeyeGun < 0 ? `vadesi ${-vadeyeGun} gün geçti` : vadeyeGun === 0 ? 'vadesi bugün' : `vadeye ${vadeyeGun} gün`;
  const sinif = vadeyeGun < 0 ? 'bakiye-borc' : vadeyeGun <= YAKLASAN_VADE_GUNU ? 'vurgu' : 'soluk';
  return (
    <span className={sinif}>
      {CEK_DURUM_ADI[cek.durum]} · {metin}
    </span>
  );
}

// ─── Liste ─────────────────────────────────────────────────────────

export function CeklerEkrani() {
  const { depo, oturum } = useUygulama();
  const [cekler, setCekler] = useState<CekOzeti[] | null>(null);
  const [yon, setYon] = useState<CekSenet['yon']>('alinan');
  const [hepsi, setHepsi] = useState(false);

  useEffect(() => {
    void cekleriListele(depo, oturum.firmaId, bugun()).then(setCekler);
  }, [depo, oturum.firmaId]);

  const yondekiler = (cekler ?? []).filter((c) => c.cek.yon === yon);
  const acik = yondekiler.filter((c) => c.vadeyeGun !== null);
  const gorunen = hepsi ? yondekiler : acik;
  const yaklasan = (cekler ?? []).filter((c) => c.vadeyeGun !== null && c.vadeyeGun <= YAKLASAN_VADE_GUNU);

  return (
    <>
      <div className="baslik-satiri">
        <h1>Çek ve senet</h1>
      </div>
      <div className="dugmeler">
        <a className="dugme" href="#/cekler/al">
          Çek/senet al
        </a>
        <a className="dugme ikincil" href="#/cekler/ver">
          Çek/senet ver
        </a>
      </div>
      {yaklasan.length > 0 && (
        <p className="mesaj mesaj-uyari" role="status">
          {yaklasan.length} çek/senedin vadesi {YAKLASAN_VADE_GUNU} gün içinde ya da geçmiş.
        </p>
      )}
      <div className="filtreler" role="group" aria-label="Yön">
        <button type="button" aria-pressed={yon === 'alinan'} onClick={() => setYon('alinan')}>
          Alınan
        </button>
        <button type="button" aria-pressed={yon === 'verilen'} onClick={() => setYon('verilen')}>
          Verilen
        </button>
        <button type="button" aria-pressed={hepsi} onClick={() => setHepsi(!hepsi)}>
          Kapananlar da
        </button>
      </div>
      {cekler === null && <p>Yükleniyor…</p>}
      {cekler && (
        <p className="ozet-satiri">
          <span>
            {yon === 'alinan' ? 'Portföyde / ciroda' : 'Ödenecek'}{' '}
            <strong className={yon === 'alinan' ? 'bakiye-alacak' : 'bakiye-borc'}>{tlYaz(acik.reduce((t, c) => t + c.cek.tutar, 0))}</strong>
          </span>
          <span>{acik.length} açık</span>
        </p>
      )}
      {cekler && gorunen.length === 0 && <p className="soluk">Kayıt yok.</p>}
      <ul className="kart-listesi">
        {gorunen.map((o) => (
          <li key={o.cek.id}>
            <a className="kart kart-baglanti" href={`#/cekler/${o.cek.id}`}>
              <span className="baslik-satiri">
                <strong>{o.cariAdi}</strong>
                <span className="bakiye">{tlYaz(o.cek.tutar)}</span>
              </span>
              <span className="soluk">
                {cekAdi(o.cek)} · vade {tarihYaz(o.cek.vadeTarihi)}
                {o.cek.banka && ` · ${o.cek.banka}`}
              </span>
              <VadeEtiketi ozet={o} />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

// ─── Al / ver ──────────────────────────────────────────────────────

export function CekFormu({ yon, cariId }: { yon: CekSenet['yon']; cariId?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const alinan = yon === 'alinan';
  const [kaynak, setKaynak] = useState<{ cariler: CariOzeti[]; projeler: ProjeOzeti[] } | null>(null);
  const [form, setForm] = useState({
    tur: 'cek' as CekSenet['tur'],
    cariId: cariId ?? (null as string | null),
    tarih: bugun(),
    vadeTarihi: '',
    tutar: '',
    banka: '',
    seriNo: '',
    projeId: '',
    aciklama: '',
  });
  const [giderler, setGiderler] = useState<AcikGider[]>([]);
  const [dagitim, setDagitim] = useState<DagitimFormu>({});
  const [elle, setElle] = useState(false);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    const f = oturum.firmaId;
    void Promise.all([carileriListele(depo, f), projeleriListele(depo, f)]).then(([cariler, projeler]) => setKaynak({ cariler, projeler }));
  }, [depo, oturum.firmaId]);

  // Verilen çekte carinin açık borçları; çek bunlara dağıtılır.
  useEffect(() => {
    setGiderler([]);
    setDagitim({});
    setElle(false);
    if (alinan || !form.cariId) return;
    void acikGiderler(depo, oturum.firmaId, form.cariId, bugun()).then(setGiderler);
  }, [alinan, form.cariId, depo, oturum.firmaId]);

  if (!kaynak) return <p>Yükleniyor…</p>;
  const yaz = (alan: keyof typeof form, deger: string | null) => setForm((f) => ({ ...f, [alan]: deger }));
  const tutar = tlOku(form.tutar);
  const { dagitim: dagitimListesi, hatali } = formdanDagitim(dagitim);
  const dagitilan = dagitimListesi.reduce((t, d) => t + d.tutar, 0);

  function tutarDegisti(metin: string) {
    yaz('tutar', metin);
    const t = tlOku(metin);
    if (!elle && t !== null) setDagitim(otomatik(t, giderler));
  }

  async function kaydet() {
    const yeni: string[] = [];
    if (!form.cariId) yeni.push(alinan ? 'Çeki kimden aldığınızı seçin.' : 'Çeki kime verdiğinizi seçin.');
    if (tutar === null) yeni.push('Tutarı yazın.');
    if (!form.vadeTarihi) yeni.push('Vade tarihini girin.');
    if (hatali) yeni.push('Faturalara yazılan tutarlardan biri sayı değil.');
    setHatalar(yeni);
    if (yeni.length > 0) return;
    setIslemde(true);
    try {
      const g = { ...form, cariId: form.cariId!, tutar: tutar!, projeId: form.projeId || null, banka: form.banka || null, seriNo: form.seriNo || null };
      const cek = alinan ? await cekAl(depo, servis, g) : await cekVer(depo, servis, g, dagitimListesi);
      git(`cekler/${cek.id}`);
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  return (
    <>
      <h1>{alinan ? 'Çek/senet al' : 'Çek/senet ver'}</h1>
      <section className="kart">
        <div className="filtreler" role="group" aria-label="Tür">
          {(['cek', 'senet'] as const).map((t) => (
            <button key={t} type="button" aria-pressed={form.tur === t} onClick={() => yaz('tur', t)}>
              {CEK_TUR_ADI[t]}
            </button>
          ))}
        </div>
        <p className="mesaj-not">
          {alinan
            ? 'Cariden tahsilat sayılır: carinin borcu düşer. Para, çek tahsil edilince kasaya/bankaya girer.'
            : 'Cariye ödeme sayılır: borcumuz düşer. Para, vadesinde "Ödendi" girilince hesaptan çıkar.'}
        </p>
        <div className="alan">
          <span className="alan-etiket">{alinan ? 'Kimden' : 'Kime'}</span>
          <CariSecici
            cariler={kaynak.cariler}
            secili={form.cariId}
            onSec={(id) => yaz('cariId', id)}
            oncelikli={alinan ? ['musteri'] : ['tedarikci', 'usta']}
          />
        </div>
        <div className="iki-sutun">
          <Alan etiket="Tutar (₺)" aciklama={!alinan && giderler.length > 0 ? `Açık borç ${tlYaz(giderler.reduce((t, g) => t + g.kalan, 0))}` : undefined}>
            <input value={form.tutar} inputMode="decimal" placeholder="0" onChange={(e) => tutarDegisti(e.target.value)} />
          </Alan>
          <Alan etiket="Vade">
            <input type="date" value={form.vadeTarihi} onChange={(e) => yaz('vadeTarihi', e.target.value)} />
          </Alan>
          <Alan etiket={alinan ? 'Alındığı gün' : 'Verildiği gün'}>
            <input type="date" value={form.tarih} onChange={(e) => yaz('tarih', e.target.value)} />
          </Alan>
          <Alan etiket={form.tur === 'cek' ? 'Çek no' : 'Senet no'}>
            <input value={form.seriNo} onChange={(e) => yaz('seriNo', e.target.value)} />
          </Alan>
          {form.tur === 'cek' && (
            <Alan etiket="Banka / şube">
              <input value={form.banka} onChange={(e) => yaz('banka', e.target.value)} />
            </Alan>
          )}
          <Alan etiket="Proje">
            <select value={form.projeId} onChange={(e) => yaz('projeId', e.target.value)}>
              <option value="">Projesiz</option>
              {kaynak.projeler.map(({ proje }) => (
                <option key={proje.id} value={proje.id}>
                  {proje.ad}
                </option>
              ))}
            </select>
          </Alan>
        </div>
        <Alan etiket="Açıklama">
          <input value={form.aciklama} onChange={(e) => yaz('aciklama', e.target.value)} />
        </Alan>
      </section>

      {!alinan && form.cariId && (
        <section className="kart">
          <h2>Hangi borçları kapatıyor</h2>
          <DagitimListesi
            giderler={giderler}
            form={dagitim}
            onDegisti={(f) => {
              setDagitim(f);
              setElle(true);
            }}
          />
          {tutar !== null && giderler.length > 0 && (
            <p className={tutar - dagitilan < 0 ? 'mesaj mesaj-uyari' : 'mesaj-not'}>
              {tutar - dagitilan < 0
                ? `Dağıtılan ${tlYaz(dagitilan)}, çekten ${tlYaz(dagitilan - tutar)} fazla.`
                : tutar - dagitilan > 0
                  ? `${tlYaz(tutar - dagitilan)} hiçbir borca bağlanmadı; cariye avans olarak kalır.`
                  : 'Çekin tamamı borçlara bağlandı.'}
            </p>
          )}
        </section>
      )}

      <section className="kart">
        <Hatalar hatalar={hatalar} />
        <div className="dugmeler">
          <button type="button" onClick={() => void kaydet()} disabled={islemde}>
            {islemde ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <button type="button" className="ikincil" onClick={() => history.back()} disabled={islemde}>
            Vazgeç
          </button>
        </div>
      </section>
    </>
  );
}

// ─── Detay ─────────────────────────────────────────────────────────

type Islem = 'tahsil' | 'ode' | 'ciro' | 'geriDondu';

function IslemFormu(props: { detay: CekDetayi; islem: Islem; onBitti: () => Promise<void>; onVazgec: () => void }) {
  const { depo, oturum, servis } = useUygulama();
  const { cek } = props.detay;
  const [tarih, setTarih] = useState(bugun());
  const [hesapId, setHesapId] = useState('');
  const [hesaplar, setHesaplar] = useState<HesapOzeti[]>([]);
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [cariId, setCariId] = useState<string | null>(null);
  const [giderler, setGiderler] = useState<AcikGider[]>([]);
  const [dagitim, setDagitim] = useState<DagitimFormu>({});
  const [geriDurum, setGeriDurum] = useState<'karsiliksiz' | 'iade_edildi'>('karsiliksiz');
  const [aciklama, setAciklama] = useState('');
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    const f = oturum.firmaId;
    if (props.islem === 'tahsil' || props.islem === 'ode') {
      void hesaplariListele(depo, f).then((h) => setHesaplar(h.filter((x) => x.hesap.paraBirimi === 'TRY' && x.hesap.tur !== 'kredi_karti')));
    }
    if (props.islem === 'ciro') void carileriListele(depo, f).then((c) => setCariler(c.filter((x) => x.cari.id !== cek.cariId)));
  }, [props.islem, depo, oturum.firmaId, cek.cariId]);

  useEffect(() => {
    if (props.islem !== 'ciro' || !cariId) return;
    void acikGiderler(depo, oturum.firmaId, cariId, bugun()).then((l) => {
      setGiderler(l);
      setDagitim(otomatik(cek.tutar, l));
    });
  }, [props.islem, cariId, depo, oturum.firmaId, cek.tutar]);

  async function kaydet() {
    setIslemde(true);
    try {
      if (props.islem === 'tahsil') await cekTahsil(depo, servis, cek.id, { tarih, hesapId });
      else if (props.islem === 'ode') await cekOde(depo, servis, cek.id, { tarih, hesapId });
      else if (props.islem === 'geriDondu') await cekGeriDondu(depo, servis, cek.id, { tarih, durum: geriDurum, aciklama });
      else {
        if (!cariId) throw new Error('Çekin ciro edildiği cariyi seçin.');
        const { dagitim: liste, hatali } = formdanDagitim(dagitim);
        if (hatali) throw new Error('Faturalara yazılan tutarlardan biri sayı değil.');
        await cekCiro(depo, servis, cek.id, { tarih, cariId, dagitim: liste, aciklama });
      }
      await props.onBitti();
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  const baslik = { tahsil: 'Tahsil edildi', ode: 'Ödendi', ciro: 'Ciro et', geriDondu: 'Geri döndü' }[props.islem];
  return (
    <div className="islem-formu">
      <h3>{baslik}</h3>
      {props.islem === 'geriDondu' && (
        <>
          <div className="filtreler" role="group" aria-label="Geri dönüş">
            <button type="button" aria-pressed={geriDurum === 'karsiliksiz'} onClick={() => setGeriDurum('karsiliksiz')}>
              Karşılıksız
            </button>
            <button type="button" aria-pressed={geriDurum === 'iade_edildi'} onClick={() => setGeriDurum('iade_edildi')}>
              İade edildi
            </button>
          </div>
          <p className="mesaj-not">
            {cek.yon === 'alinan'
              ? 'Çeki veren cari yine borçlu görünür; ciro edildiyse ciro edilen cariye borcumuz geri gelir.'
              : 'Cariye borcumuz geri gelir.'}{' '}
            Çekle kapatılan faturalar yeniden açılır.
          </p>
        </>
      )}
      {props.islem === 'ciro' && (
        <>
          <div className="alan">
            <span className="alan-etiket">Kime ciro edildi</span>
            <CariSecici cariler={cariler} secili={cariId} onSec={setCariId} oncelikli={['tedarikci', 'usta']} />
          </div>
          {cariId && <DagitimListesi giderler={giderler} form={dagitim} onDegisti={setDagitim} />}
        </>
      )}
      <div className="iki-sutun">
        <Alan etiket="Tarih">
          <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
        </Alan>
        {(props.islem === 'tahsil' || props.islem === 'ode') && (
          <HesapSecimi hesaplar={hesaplar} secili={hesapId} onSec={setHesapId} etiket={props.islem === 'tahsil' ? 'Nereye girdi' : 'Nereden çıktı'} />
        )}
      </div>
      {(props.islem === 'ciro' || props.islem === 'geriDondu') && (
        <Alan etiket="Açıklama">
          <input value={aciklama} onChange={(e) => setAciklama(e.target.value)} />
        </Alan>
      )}
      <Hatalar hatalar={hatalar} />
      <div className="dugmeler">
        <button type="button" onClick={() => void kaydet()} disabled={islemde}>
          Kaydet
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec} disabled={islemde}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

export function CekDetay({ cekId }: { cekId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  /** undefined: okunuyor, null: bulunamadı */
  const [detay, setDetay] = useState<CekDetayi | null | undefined>(undefined);
  const [islem, setIslem] = useState<Islem | null>(null);
  const [iptalSoruluyor, setIptalSoruluyor] = useState(false);

  const yenile = useCallback(async () => {
    setDetay(await cekDetayiGetir(depo, oturum.firmaId, cekId, bugun()));
    setIslem(null);
  }, [depo, oturum.firmaId, cekId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  if (detay === undefined) return <p>Yükleniyor…</p>;
  if (detay === null) return <p className="hata">Çek/senet bulunamadı ya da iptal edilmiş.</p>;
  const { cek } = detay;
  const alinan = cek.yon === 'alinan';
  const islemler: [Islem, string][] = alinan
    ? cek.durum === 'portfoyde'
      ? [
          ['tahsil', 'Tahsil edildi'],
          ['ciro', 'Ciro et'],
          ['geriDondu', 'Geri döndü'],
        ]
      : cek.durum === 'ciro_edildi'
        ? [['geriDondu', 'Geri döndü']]
        : []
    : cek.durum === 'verildi'
      ? [
          ['ode', 'Ödendi'],
          ['geriDondu', 'Geri döndü'],
        ]
      : [];
  const son = detay.hareketler.at(-1);

  return (
    <>
      <p>
        <a href="#/cekler">← Çek ve senet</a>
      </p>
      <h1>
        {alinan ? 'Alınan' : 'Verilen'} {CEK_TUR_ADI[cek.tur].toLocaleLowerCase('tr-TR')}
      </h1>
      <section className="kart">
        <p className="bakiye-buyuk">
          <strong>{tlYaz(cek.tutar)}</strong>
        </p>
        <p>
          <VadeEtiketi ozet={detay} />
        </p>
        <dl className="bilgi">
          <dt>{alinan ? 'Kimden' : 'Kime'}</dt>
          <dd>
            <a href={`#/cariler/${cek.cariId}`}>{detay.cariAdi}</a>
          </dd>
          <dt>Vade</dt>
          <dd>{tarihYaz(cek.vadeTarihi)}</dd>
          {cek.seriNo && (
            <div className="bilgi-satir">
              <dt>{cek.tur === 'cek' ? 'Çek no' : 'Senet no'}</dt>
              <dd>{cek.seriNo}</dd>
            </div>
          )}
          {cek.banka && (
            <div className="bilgi-satir">
              <dt>Banka</dt>
              <dd>{cek.banka}</dd>
            </div>
          )}
        </dl>
        {islem ? (
          <IslemFormu detay={detay} islem={islem} onBitti={yenile} onVazgec={() => setIslem(null)} />
        ) : (
          islemler.length > 0 && (
            <div className="dugmeler">
              {islemler.map(([k, ad], i) => (
                <button key={k} type="button" className={i === 0 ? undefined : 'ikincil'} onClick={() => setIslem(k)}>
                  {ad}
                </button>
              ))}
            </div>
          )
        )}
      </section>

      <section className="kart">
        <h2>Hareketler</h2>
        <ul className="liste">
          {detay.hareketler.map((x) => (
            <li key={x.id}>
              <span>
                <strong>{CEK_DURUM_ADI[x.durum]}</strong>
                <span className="soluk blok">
                  {tarihYaz(x.tarih)}
                  {x.cariAdi && ` · ${x.cariAdi}`}
                  {x.hesapAdi && ` · ${x.hesapAdi}`}
                  {x.aciklama && ` · ${x.aciklama}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {detay.odemeler.length > 0 && (
          <>
            <h3>{ileEki(cek.tur)} yapılan kayıtlar</h3>
            <ul className="liste">
              {detay.odemeler.map((o) => (
                <li key={o.id}>
                  <a href={`#/odemeler/${o.id}`}>
                    {o.yon === 'tahsilat' ? 'Tahsilat' : o.yontem === 'ciro' ? 'Ciro (ödeme)' : 'Ödeme'} · {o.cariAdi ?? '—'}
                  </a>
                  <strong>{tlYaz(o.tutar)}</strong>
                </li>
              ))}
            </ul>
          </>
        )}
        {kutu}
        <Hatalar hatalar={hata ? [hata] : []} />
        {detay.geriAlinabilir && son && !islem && (
          <button
            type="button"
            className="ikincil"
            onClick={() =>
              void degistir(son, `"${CEK_DURUM_ADI[son.durum]}" geri alınıyor`, async (g) => {
                await cekSonIslemiGeriAl(depo, servis, cek.id, g);
                await yenile();
              })
            }
          >
            Son işlemi geri al ({CEK_DURUM_ADI[son.durum]})
          </button>
        )}
        {son?.durum === 'karsiliksiz' || son?.durum === 'iade_edildi' ? (
          <p className="mesaj-not">Geri alınırsa kaldırılan fatura eşleştirmeleri kendiliğinden gelmez; ödemeyi ödeme ekranından yeniden bağlayın.</p>
        ) : null}
      </section>

      {!detay.geriAlinabilir && (
        <section className="kart">
          <h2>{belirtme(cek.tur)} iptal et</h2>
          <p className="soluk">
            Yanlış girildiyse. {ileEki(cek.tur)} yapılan {alinan ? 'tahsilat' : 'ödeme'} de iptal edilir; kayıt geçmişte kalır.
          </p>
          {iptalSoruluyor ? (
            <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="İptal onayı">
              <p>Bu {CEK_TUR_ADI[cek.tur].toLocaleLowerCase('tr-TR')} iptal edilsin mi?</p>
              <div className="dugmeler">
                <button
                  type="button"
                  className="tehlikeli"
                  onClick={() => {
                    setIptalSoruluyor(false);
                    void degistir(cek, 'İptal ediliyor', async (g) => {
                      await cekIptal(depo, servis, cek.id, g);
                      git('cekler');
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
