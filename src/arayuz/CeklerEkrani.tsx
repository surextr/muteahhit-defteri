import { useCallback, useEffect, useState } from 'react';
import { TutarGirdisi } from './Girdiler';
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
  cekPanosu,
  cekSonIslemiGeriAl,
  cekTahsil,
  cekTahsileVer,
  cekVer,
  YAKLASAN_VADE_GUNU,
  type CekDetayi,
  type CekOzeti,
  type CekPanosu,
} from '../servisler/cek';
import { hesaplariListele, type HesapOzeti } from '../servisler/hesap';
import { acikGiderler, type AcikGider } from '../servisler/odeme';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import type { CekSenet } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { BelgelerKarti } from './Belgeler';
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
  const [pano, setPano] = useState<CekPanosu | null>(null);

  useEffect(() => {
    void cekleriListele(depo, oturum.firmaId, bugun()).then(setCekler);
    void cekPanosu(depo, oturum.firmaId, bugun()).then(setPano);
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
      {pano?.uyarilar.map((u) => (
        <p key={u.hesapId} className="mesaj mesaj-uyari" role="status">
          <a href={`#/hesaplar/${u.hesapId}`}>{u.hesapAdi}</a>: {YAKLASAN_VADE_GUNU} gün içinde ödenecek {u.cekIdler.length} çek{' '}
          {tlYaz(u.gereken)}, bakiye {tlYaz(u.bakiye)}. {tlYaz(u.eksik)} eksik.
        </p>
      ))}
      {yaklasan.length > 0 && (
        <p className="mesaj mesaj-not" role="status">
          {yaklasan.length} çek/senedin vadesi {YAKLASAN_VADE_GUNU} gün içinde ya da geçmiş.
        </p>
      )}
      {pano && <VadeOzetiKarti pano={pano} />}
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
                {o.cek.yon === 'alinan' && o.kesideci !== o.cariAdi && ` · keşideci ${o.kesideci}`}
              </span>
              <VadeEtiketi ozet={o} />
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

const ayYaz = (ay: string) => new Date(`${ay}-01T00:00`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

/** Bu ay ve sonraki iki ay: ödenecek verilen ve tahsil edilecek alınan çekler; vadesi geçenler ayrı. */
function VadeOzetiKarti({ pano }: { pano: CekPanosu }) {
  const { gecikmis, aylar } = pano.vade;
  const satir = (baslik: string, a: (typeof aylar)[number], sinif?: string) => (
    <li key={a.ay} className={sinif}>
      <strong>{baslik}</strong>
      <span className="vade-ozet-tutarlar">
        <span>
          Ödenecek <strong className="bakiye-borc">{tlYaz(a.odenecek)}</strong> <span className="soluk">({a.odenecekAdet})</span>
        </span>
        <span>
          Tahsil edilecek <strong className="bakiye-alacak">{tlYaz(a.tahsilEdilecek)}</strong> <span className="soluk">({a.tahsilAdet})</span>
        </span>
      </span>
    </li>
  );
  return (
    <section className="kart">
      <h2>Vade özeti</h2>
      <ul className="liste vade-ozeti">
        {gecikmis.odenecekAdet + gecikmis.tahsilAdet > 0 && satir('Vadesi geçmiş', gecikmis, 'gecikmis')}
        {aylar.map((a, i) => satir(i === 0 ? `Bu ay (${ayYaz(a.ay)})` : ayYaz(a.ay), a))}
      </ul>
      <p className="mesaj-not">Ödenecek: verilip henüz ödenmemiş çekler. Tahsil edilecek: portföyde ya da bankada tahsildeki alınan çekler.</p>
    </section>
  );
}

// ─── Al / ver ──────────────────────────────────────────────────────

export function CekFormu({ yon, cariId }: { yon: CekSenet['yon']; cariId?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const alinan = yon === 'alinan';
  const { firma } = useUygulama();
  const [kaynak, setKaynak] = useState<{ cariler: CariOzeti[]; projeler: ProjeOzeti[]; bankalar: HesapOzeti[] } | null>(null);
  const [form, setForm] = useState({
    tur: 'cek' as CekSenet['tur'],
    cariId: cariId ?? (null as string | null),
    tarih: bugun(),
    vadeTarihi: '',
    tutar: '',
    banka: '',
    sube: '',
    seriNo: '',
    kesideci: '',
    hesapId: '',
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
    void Promise.all([carileriListele(depo, f), projeleriListele(depo, f), hesaplariListele(depo, f)]).then(([cariler, projeler, hesaplar]) =>
      setKaynak({ cariler, projeler, bankalar: hesaplar.filter((h) => h.hesap.tur === 'banka' && h.hesap.paraBirimi === 'TRY') }),
    );
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

  // Vadesi yakın verilen çekte seçilen hesabın bakiyesi yetmiyorsa uyarı (kaydı engellemez).
  const secilenBanka = kaynak.bankalar.find((h) => h.hesap.id === form.hesapId);
  const vadeYakin = !!form.vadeTarihi && (Date.parse(`${form.vadeTarihi}T00:00Z`) - Date.parse(`${bugun()}T00:00Z`)) / 86_400_000 <= YAKLASAN_VADE_GUNU;
  const bakiyeYetmez = !alinan && !!secilenBanka && vadeYakin && tutar !== null && secilenBanka.bakiye < tutar;

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
      const g = {
        ...form,
        cariId: form.cariId!,
        tutar: tutar!,
        projeId: form.projeId || null,
        banka: form.banka || null,
        sube: form.sube || null,
        seriNo: form.seriNo || null,
        kesideci: form.kesideci || null,
        hesapId: alinan ? null : form.hesapId || null,
      };
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
            <TutarGirdisi value={form.tutar} placeholder="0" onChange={(v) => tutarDegisti(v)} />
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
            <>
              <Alan etiket="Banka">
                <input value={form.banka} onChange={(e) => yaz('banka', e.target.value)} />
              </Alan>
              <Alan etiket="Şube">
                <input value={form.sube} onChange={(e) => yaz('sube', e.target.value)} />
              </Alan>
            </>
          )}
          <Alan
            etiket={form.tur === 'cek' ? 'Keşideci' : 'Borçlu'}
            aciklama={alinan ? 'Ciro ile gelen çekte çeki yazan; boşsa çeki veren cari.' : 'Boşsa firmanız.'}
          >
            <input
              value={form.kesideci}
              placeholder={alinan ? (kaynak.cariler.find((c) => c.cari.id === form.cariId)?.cari.ad ?? '') : firma.ad}
              onChange={(e) => yaz('kesideci', e.target.value)}
            />
          </Alan>
          {!alinan && form.tur === 'cek' && (
            <Alan etiket="Banka hesabımız" aciklama="Vadesinde parası buradan çıkar; bakiye yetmezse uyarılır.">
              <select value={form.hesapId} onChange={(e) => yaz('hesapId', e.target.value)}>
                <option value="">Seçilmedi</option>
                {kaynak.bankalar.map(({ hesap }) => (
                  <option key={hesap.id} value={hesap.id}>
                    {hesap.ad}
                  </option>
                ))}
              </select>
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
        {bakiyeYetmez && (
          <p className="mesaj mesaj-uyari" role="status">
            Vade {YAKLASAN_VADE_GUNU} gün içinde; {secilenBanka!.hesap.ad} bakiyesi {tlYaz(secilenBanka!.bakiye)}, çek {tlYaz(tutar!)}.
          </p>
        )}
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

type Islem = 'tahsileVer' | 'tahsil' | 'ode' | 'ciro' | 'geriDondu';

function IslemFormu(props: { detay: CekDetayi; islem: Islem; onBitti: () => Promise<void>; onVazgec: () => void }) {
  const { depo, oturum, servis } = useUygulama();
  const { cek } = props.detay;
  const [tarih, setTarih] = useState(bugun());
  // Tahsildeki çek o bankada tahsil edilir; verilen çek yazıldığı hesaptan ödenir.
  const [hesapId, setHesapId] = useState(props.islem === 'tahsileVer' ? '' : (props.detay.hesap?.id ?? ''));
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
    if (props.islem === 'tahsil' || props.islem === 'ode' || props.islem === 'tahsileVer') {
      const banka = props.islem === 'tahsileVer';
      void hesaplariListele(depo, f).then((h) =>
        setHesaplar(h.filter((x) => x.hesap.paraBirimi === 'TRY' && (banka ? x.hesap.tur === 'banka' : x.hesap.tur !== 'kredi_karti'))),
      );
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
      if (props.islem === 'tahsileVer') await cekTahsileVer(depo, servis, cek.id, { tarih, hesapId });
      else if (props.islem === 'tahsil') await cekTahsil(depo, servis, cek.id, { tarih, hesapId });
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

  const baslik = { tahsileVer: 'Bankaya tahsile ver', tahsil: 'Tahsil edildi', ode: 'Ödendi', ciro: 'Ciro et', geriDondu: 'Geri döndü' }[props.islem];
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
        {(props.islem === 'tahsil' || props.islem === 'ode' || props.islem === 'tahsileVer') && (
          <HesapSecimi
            hesaplar={hesaplar}
            secili={hesapId}
            onSec={setHesapId}
            etiket={props.islem === 'tahsileVer' ? 'Hangi banka hesabına' : props.islem === 'tahsil' ? 'Nereye girdi' : 'Nereden çıktı'}
          />
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
  const [pano, setPano] = useState<CekPanosu | null>(null);

  const yenile = useCallback(async () => {
    setDetay(await cekDetayiGetir(depo, oturum.firmaId, cekId, bugun()));
    setPano(await cekPanosu(depo, oturum.firmaId, bugun()));
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
          ['tahsileVer', 'Bankaya tahsile ver'],
          ['tahsil', 'Tahsil edildi'],
          ['ciro', 'Ciro et'],
          ['geriDondu', 'Geri döndü'],
        ]
      : cek.durum === 'tahsilde'
        ? [
            ['tahsil', 'Tahsil edildi'],
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
  const karsilikUyarisi = pano?.uyarilar.find((u) => u.cekIdler.includes(cek.id));

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
              <dd>
                {cek.banka}
                {cek.sube && ` · ${cek.sube}`}
              </dd>
            </div>
          )}
          <dt>{cek.tur === 'cek' ? 'Keşideci' : 'Borçlu'}</dt>
          <dd>{detay.kesideci}</dd>
          {detay.hesap && (
            <div className="bilgi-satir">
              <dt>{alinan ? 'Tahsildeki banka' : 'Banka hesabımız'}</dt>
              <dd>
                <a href={`#/hesaplar/${detay.hesap.id}`}>{detay.hesap.ad}</a>
              </dd>
            </div>
          )}
        </dl>
        {karsilikUyarisi && (
          <p className="mesaj mesaj-uyari" role="status">
            {karsilikUyarisi.hesapAdi} bakiyesi {tlYaz(karsilikUyarisi.bakiye)}; {YAKLASAN_VADE_GUNU} gün içinde bu hesaptan ödenecek çekler{' '}
            {tlYaz(karsilikUyarisi.gereken)}. {tlYaz(karsilikUyarisi.eksik)} eksik.
          </p>
        )}
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

      <BelgelerKarti bagliTur="cekSenet" bagliId={cek.id} varsayilanTur="fotograf" baslik={`${CEK_TUR_ADI[cek.tur]} fotoğrafı`} />

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
