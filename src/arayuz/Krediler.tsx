import { useCallback, useEffect, useMemo, useState } from 'react';
import { esitTaksitPlani, krediHatalari, TAKSIT_DURUMU_ADI, type KrediIcerigi, type KrediOzeti, type TaksitDurumu } from '../hesap/kredi';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import { hesaplariListele, type HesapOzeti } from '../servisler/hesap';
import { krediIptal, krediKaydet, krediOlustur, krediOzetiGetir, krediOzetleri, krediTaksitiOde, krediTaksitOdemesiniGeriAl } from '../servisler/kredi';
import { projeleriListele } from '../servisler/proje';
import { yeniId } from '../veri/kimlik';
import type { Proje } from '../veri/tipler';
import { useProjeErisimi, useUygulama } from './baglam';
import { Alan, BosDurum, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { CariSecici } from './CariSecici';
import { TutarGirdisi } from './Girdiler';
import { git } from './rota';

// Banka kredileri: liste (kalan borç, sonraki taksit), yeni kredi / düzenleme (eşit taksit önerisi), taksit ödeme ve geri alma.

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const DURUM_SINIFI: Record<TaksitDurumu, string> = { odendi: 'rozet-tamam', kismen: 'rozet-taslak', gecikti: 'rozet-gecikti', yaklasan: 'rozet-taslak', bekliyor: '' };

export function KredilerEkrani() {
  const { depo, oturum } = useUygulama();
  const [liste, setListe] = useState<KrediOzeti[] | null>(null);
  useEffect(() => {
    void krediOzetleri(depo, oturum.firmaId, yerelGun(new Date())).then(setListe);
  }, [depo, oturum.firmaId]);
  const kalan = (liste ?? []).reduce((t, o) => t + o.kalanAnapara, 0);
  return (
    <>
      <p>
        <a className="geri-baglanti" href="#/hesaplar">← Kasa ve banka</a>
      </p>
      <div className="baslik-satiri">
        <h1>Krediler</h1>
        <button type="button" onClick={() => git('krediler/yeni')}>
          + Yeni kredi
        </button>
      </div>
      {liste === null && <p>Yükleniyor…</p>}
      {liste?.length === 0 && (
        <BosDurum metin="Kayıtlı kredi yok. Kredi girilince para hesaba girer, taksitler vadesinde Bugün ekranında görünür." />
      )}
      {liste && liste.length > 0 && (
        <>
          <section className="kart">
            <p className="ozet-tutar ozet-toplam">
              <span>Bankalara kalan anapara borcu</span>
              <strong>{tlYaz(kalan)}</strong>
            </p>
          </section>
          <ul className="kart-listesi liste-arasi">
            {liste.map((o) => (
              <li key={o.kredi.id}>
                <a className="kart kart-baglanti" href={`#/krediler/${o.kredi.id}`}>
                  <span className="baslik-satiri">
                    <strong>{o.kredi.ad}</strong>
                    <span className="bakiye">{tlYaz(o.kalanAnapara)}</span>
                  </span>
                  <span className="soluk">
                    {o.sonraki
                      ? `Sonraki taksit ${tarihYaz(o.sonraki.taksit.vadeTarihi)} · ${tlYaz(o.sonraki.kalanAnapara + o.sonraki.kalanFaiz)}`
                      : 'Bütün taksitler ödendi'}
                    {o.geciken > 0 && <span className="etiket-cip etiket-iptal">vadesi geçmiş {tlYaz(o.geciken)}</span>}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

interface TaksitFormu {
  id: string;
  vadeTarihi: string;
  anapara: string;
  faiz: string;
}
interface Form {
  ad: string;
  bankaCariId: string | null;
  hesapId: string;
  projeId: string;
  kullanimTarihi: string;
  anapara: string;
  faizOrani: string;
  taksitler: TaksitFormu[];
  aciklama: string;
}

const BOS_FORM = (): Form => ({ ad: '', bankaCariId: null, hesapId: '', projeId: '', kullanimTarihi: yerelGun(new Date()), anapara: '', faizOrani: '', taksitler: [], aciklama: '' });

function formdan(f: Form): { icerik: KrediIcerigi; hatalar: string[] } {
  const hatalar: string[] = [];
  const oku = (m: string, ad: string) => {
    if (!m.trim()) return 0;
    const v = tlOku(m);
    if (v === null) hatalar.push(`${ad} okunamadı (örn. 25.000).`);
    return v ?? 0;
  };
  const faiz = f.faizOrani.trim() ? sayiOku(f.faizOrani) : null;
  if (f.faizOrani.trim() && faiz === null) hatalar.push('Faiz oranı okunamadı (örn. 2,79).');
  return {
    icerik: {
      ad: f.ad,
      bankaCariId: f.bankaCariId,
      hesapId: f.hesapId,
      projeId: f.projeId || null,
      kullanimTarihi: f.kullanimTarihi,
      anapara: oku(f.anapara, 'Kredi tutarı'),
      faizOrani: faiz,
      taksitler: f.taksitler.map((t, i) => ({ id: t.id, vadeTarihi: t.vadeTarihi, anapara: oku(t.anapara, `${i + 1}. taksitin anaparası`), faiz: oku(t.faiz, `${i + 1}. taksitin faizi`) })),
      aciklama: f.aciklama,
    },
    hatalar: [...new Set(hatalar)],
  };
}

const formaCevir = (o: KrediOzeti['kredi']): Form => ({
  ad: o.ad,
  bankaCariId: o.bankaCariId,
  hesapId: o.hesapId,
  projeId: o.projeId ?? '',
  kullanimTarihi: o.kullanimTarihi,
  anapara: tutarMetni(o.anapara),
  faizOrani: sayiYaz(o.faizOrani),
  taksitler: o.taksitler.map((t) => ({ id: t.id, vadeTarihi: t.vadeTarihi, anapara: t.anapara ? tutarMetni(t.anapara) : '', faiz: t.faiz ? tutarMetni(t.faiz) : '' })),
  aciklama: o.aciklama,
});

/** Yeni kredi (`id` yok) ya da var olan kredinin ekranı. */
export function KrediEkrani({ id }: { id?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const erisim = useProjeErisimi();
  const [ozet, setOzet] = useState<KrediOzeti | null | undefined>(id ? undefined : null);
  const [form, setForm] = useState<Form | null>(id ? null : BOS_FORM());
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [hesaplar, setHesaplar] = useState<HesapOzeti[]>([]);
  const [projeler, setProjeler] = useState<Proje[]>([]);
  const [oneri, setOneri] = useState({ adet: '', ilkVade: '' });
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [hata, setHata] = useState<string[]>([]);
  const gerekceli = useGerekceliDegisiklik();

  const yukle = useCallback(async () => {
    if (!id) return;
    const o = await krediOzetiGetir(depo, oturum.firmaId, id, yerelGun(new Date()));
    setOzet(o);
    if (o) setForm(formaCevir(o.kredi));
  }, [depo, oturum.firmaId, id]);
  useEffect(() => {
    void yukle();
    void carileriListele(depo, oturum.firmaId).then(setCariler);
    void hesaplariListele(depo, oturum.firmaId).then((l) => setHesaplar(l.filter((h) => h.hesap.tur !== 'kredi_karti' && h.hesap.paraBirimi === 'TRY')));
    void projeleriListele(depo, oturum.firmaId, erisim).then((l) => setProjeler(l.map((x) => x.proje)));
  }, [yukle, depo, oturum.firmaId, erisim]);

  const cevrim = useMemo(() => (form ? formdan(form) : null), [form]);
  const kayitli = useMemo(() => (ozet ? JSON.stringify(formaCevir(ozet.kredi)) : ''), [ozet]);
  if (ozet === undefined || (id && ozet && !form)) return <p>Yükleniyor…</p>;
  if (id && ozet === null) return <p className="hata">Kredi bulunamadı.</p>;
  if (!form || !cevrim) return null;
  const degisti = !id || JSON.stringify(form) !== kayitli;
  const yaz = <K extends keyof Form>(alan: K, d: Form[K]) => (setMesaj(null), setForm({ ...form, [alan]: d }));
  const taksitYaz = (i: number, d: Partial<TaksitFormu>) => yaz('taksitler', form.taksitler.map((t, j) => (j === i ? { ...t, ...d } : t)));
  const planToplami = cevrim.icerik.taksitler.reduce((t, x) => t + x.anapara, 0);
  const faizToplami = cevrim.icerik.taksitler.reduce((t, x) => t + x.faiz, 0);
  const durumlar = new Map((ozet?.taksitler ?? []).map((d) => [d.taksit.id, d]));

  function planOner() {
    const adet = Number(oneri.adet);
    const anapara = cevrim!.icerik.anapara;
    if (!Number.isInteger(adet) || adet < 1 || adet > 240 || anapara <= 0) return setMesaj('Kredi tutarını ve taksit sayısını yazın.');
    const ilk = oneri.ilkVade || birAySonra(form!.kullanimTarihi);
    const plan = esitTaksitPlani(anapara, cevrim!.icerik.faizOrani, adet, ilk, yeniId);
    yaz(
      'taksitler',
      plan.map((t) => ({ id: t.id, vadeTarihi: t.vadeTarihi, anapara: tutarMetni(t.anapara), faiz: t.faiz ? tutarMetni(t.faiz) : '' })),
    );
  }

  async function kaydet() {
    setHata([]);
    if (cevrim!.hatalar.length) return setHata(cevrim!.hatalar);
    const h = krediHatalari(cevrim!.icerik);
    if (h.length) return setHata(h);
    if (!id) {
      try {
        const k = await krediOlustur(depo, servis, cevrim!.icerik);
        git(`krediler/${k.id}`);
      } catch (e) {
        setHata([hataMetni(e)]);
      }
      return;
    }
    await gerekceli.degistir('Kredi değişikliği', async (gerekce) => {
      await krediKaydet(depo, servis, id, cevrim!.icerik, gerekce);
      await yukle();
      setMesaj('Kaydedildi.');
    });
  }

  return (
    <>
      <p>
        <a className="geri-baglanti" href="#/krediler">← Krediler</a>
      </p>
      <h1>{id ? ozet!.kredi.ad : 'Yeni kredi'}</h1>
      {ozet && (
        <section className="kart">
          <p className="ozet-tutar">
            <span>Kullanılan</span>
            <span>{tlYaz(ozet.kredi.anapara)}</span>
          </p>
          <p className="ozet-tutar">
            <span>Ödenen anapara · faiz</span>
            <span>
              {tlYaz(ozet.odenenAnapara)} · {tlYaz(ozet.odenenFaiz)}
            </span>
          </p>
          <p className="ozet-tutar ozet-toplam">
            <span>Kalan anapara</span>
            <strong>{tlYaz(ozet.kalanAnapara)}</strong>
          </p>
          <p className="soluk kucuk">
            Kalan faiz (plana göre) {tlYaz(ozet.kalanFaiz)} · toplam faiz {tlYaz(ozet.toplamFaiz)}
            {ozet.geciken > 0 && ` · vadesi geçmiş ${tlYaz(ozet.geciken)}`}
          </p>
        </section>
      )}

      {ozet && ozet.taksitler.length > 0 && <Taksitler ozet={ozet} hesaplar={hesaplar} onDegisti={yukle} />}

      <details className="kart" open={!id}>
        <summary>
          <h2>{id ? 'Kredi bilgileri ve plan' : 'Kredi bilgileri'}</h2>
        </summary>
        <div className="iki-sutun">
          <Alan etiket="Kredinin adı">
            <input value={form.ad} placeholder="örn. Ziraat proje kredisi" onChange={(e) => yaz('ad', e.target.value)} />
          </Alan>
          <Alan etiket="Paranın girdiği hesap" aciklama="Taksitler de varsayılan olarak buradan ödenir">
            <select value={form.hesapId} onChange={(e) => yaz('hesapId', e.target.value)}>
              <option value="">Seçin</option>
              {hesaplar.map(({ hesap }) => (
                <option key={hesap.id} value={hesap.id}>
                  {hesap.ad}
                </option>
              ))}
            </select>
          </Alan>
          <Alan etiket="Kredi tutarı (₺)">
            <TutarGirdisi value={form.anapara} placeholder="0" onChange={(v) => yaz('anapara', v)} />
          </Alan>
          <Alan etiket="Kullanım tarihi">
            <input type="date" value={form.kullanimTarihi} onChange={(e) => yaz('kullanimTarihi', e.target.value)} />
          </Alan>
          <Alan etiket="Aylık faiz oranı (%)" aciklama="Eşit taksit önerisi için; bankanın planı varsa taksitleri ondan yazın">
            <input inputMode="decimal" value={form.faizOrani} placeholder="örn. 2,79" onChange={(e) => yaz('faizOrani', e.target.value)} />
          </Alan>
          <Alan etiket="Proje" aciklama="Faiz gideri bu projenin maliyetine yazılır">
            <select value={form.projeId} onChange={(e) => yaz('projeId', e.target.value)}>
              <option value="">Firma geneli</option>
              {projeler.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.ad}
                </option>
              ))}
            </select>
          </Alan>
        </div>
        <div className="alan">
          <span className="alan-etiket">Krediyi veren banka (isteğe bağlı)</span>
          <CariSecici cariler={cariler} secili={form.bankaCariId} onSec={(c) => yaz('bankaCariId', c)} bosEtiket="Seçmeden" />
          <span className="soluk kucuk">Seçilirse kalan kredi borcu bankanın cari ekstresinde görünür.</span>
        </div>

        <h3>Geri ödeme planı</h3>
        <div className="satir-ici">
          <input className="kisa" inputMode="numeric" value={oneri.adet} placeholder="Taksit" aria-label="Taksit sayısı" onChange={(e) => setOneri({ ...oneri, adet: e.target.value })} />
          <input type="date" value={oneri.ilkVade} aria-label="İlk taksit vadesi" onChange={(e) => setOneri({ ...oneri, ilkVade: e.target.value })} />
          <button type="button" className="ikincil" onClick={planOner}>
            Eşit taksit öner
          </button>
        </div>
        <p className="soluk kucuk">İlk vade boşsa kullanımdan bir ay sonra. Faiz kalan anapara üzerinden hesaplanır; bankanın planındaki tutarlarla düzeltebilirsiniz.</p>
        {form.taksitler.length > 0 && (
          <div className="kredi-plani">
            <div className="kredi-plan-baslik soluk kucuk">
              <span>Vade</span>
              <span>Anapara</span>
              <span>Faiz + masraf</span>
              <span />
            </div>
            {form.taksitler.map((t, i) => {
              const d = durumlar.get(t.id);
              const odenmis = !!d && d.odenenAnapara + d.odenenFaiz > 0;
              return (
                <div key={t.id} className="kredi-plan-satiri">
                  <input type="date" value={t.vadeTarihi} aria-label={`${i + 1}. vade`} onChange={(e) => taksitYaz(i, { vadeTarihi: e.target.value })} />
                  <TutarGirdisi value={t.anapara} placeholder="Anapara" onChange={(v) => taksitYaz(i, { anapara: v })} />
                  <TutarGirdisi value={t.faiz} placeholder="Faiz" onChange={(v) => taksitYaz(i, { faiz: v })} />
                  <button
                    type="button"
                    className="ikincil"
                    disabled={odenmis}
                    title={odenmis ? 'Ödenmiş taksit çıkarılamaz' : undefined}
                    aria-label={`${i + 1}. taksiti çıkar`}
                    onClick={() => yaz('taksitler', form.taksitler.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        )}
        <button
          type="button"
          className="baglanti-dugmesi"
          onClick={() => yaz('taksitler', [...form.taksitler, { id: yeniId(), vadeTarihi: form.taksitler.at(-1)?.vadeTarihi ?? form.kullanimTarihi, anapara: '', faiz: '' }])}
        >
          + Taksit ekle
        </button>
        <p className="ara-toplam">
          <span>
            Plan anaparası{cevrim.icerik.anapara > 0 ? ` · kredi ${tlYaz(cevrim.icerik.anapara)}` : ''}
            {faizToplami > 0 && ` · faiz ${tlYaz(faizToplami)}`}
          </span>
          <span className={planToplami !== cevrim.icerik.anapara && form.taksitler.length ? 'bakiye-borc' : undefined}>{tlYaz(planToplami)}</span>
        </p>
        <Alan etiket="Not">
          <textarea rows={2} value={form.aciklama} onChange={(e) => yaz('aciklama', e.target.value)} />
        </Alan>
        {gerekceli.kutu}
        <Hatalar hatalar={[...hata, ...(gerekceli.hata ? [gerekceli.hata] : [])]} />
        {mesaj && !degisti && <p className="mesaj mesaj-basari">{mesaj}</p>}
        {degisti && (
          <div className="dugmeler">
            <button type="button" onClick={() => void kaydet()}>
              {id ? 'Kaydet' : 'Krediyi kaydet (para hesaba girer)'}
            </button>
            {id && (
              <button type="button" className="ikincil" onClick={() => setForm(formaCevir(ozet!.kredi))}>
                Vazgeç
              </button>
            )}
          </div>
        )}
      </details>

      {id && ozet && <KrediIptali id={id} odenmis={ozet.odenenAnapara + ozet.odenenFaiz > 0} />}
    </>
  );
}

function birAySonra(t: string): string {
  const [y, a, g] = t.split('-').map(Number) as [number, number, number];
  const yil = a === 12 ? y + 1 : y;
  const ay = a === 12 ? 1 : a + 1;
  const son = new Date(Date.UTC(yil, ay, 0)).getUTCDate();
  return `${yil}-${String(ay).padStart(2, '0')}-${String(Math.min(g, son)).padStart(2, '0')}`;
}

function Taksitler({ ozet, hesaplar, onDegisti }: { ozet: KrediOzeti; hesaplar: HesapOzeti[]; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const [acik, setAcik] = useState<string | null>(null);
  const [tarih, setTarih] = useState(yerelGun(new Date()));
  const [hesapId, setHesapId] = useState(ozet.kredi.hesapId);
  const [hata, setHata] = useState<string | null>(null);
  const [geriAl, setGeriAl] = useState<string | null>(null);
  const [gerekce, setGerekce] = useState('');
  /** Öde düğmesi yalnız sıradaki ve gecikmiş taksitte; erken ödeme için hepsi açılır. */
  const [tumu, setTumu] = useState(false);

  const ode = async (taksitId: string) => {
    setHata(null);
    try {
      await krediTaksitiOde(depo, servis, ozet.kredi.id, taksitId, { tarih, hesapId });
      setAcik(null);
      await onDegisti();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };
  const geriAlOnay = async (taksitId: string) => {
    setHata(null);
    if (!gerekce.trim()) return setHata('Geri alma nedenini yazın.');
    try {
      await krediTaksitOdemesiniGeriAl(depo, servis, ozet.kredi.id, taksitId, gerekce.trim());
      setGeriAl(null);
      setGerekce('');
      await onDegisti();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };

  return (
    <section className="kart">
      <h2>Taksitler</h2>
      <ul className="taksit-listesi">
        {ozet.taksitler.map((d, i) => {
          const kalan = d.kalanAnapara + d.kalanFaiz;
          return (
            <li key={d.taksit.id}>
              <div className="baslik-satiri">
                <span>
                  <strong>
                    {i + 1}. taksit · {tarihYaz(d.taksit.vadeTarihi)}
                  </strong>{' '}
                  <span className={`etiket-cip ${DURUM_SINIFI[d.durum]}`}>{TAKSIT_DURUMU_ADI[d.durum]}</span>
                </span>
                <strong>{tlYaz(d.taksit.anapara + d.taksit.faiz)}</strong>
              </div>
              <p className="soluk kucuk">
                Anapara {tlYaz(d.taksit.anapara)} · faiz {tlYaz(d.taksit.faiz)}
                {d.durum !== 'odendi' && d.odenenAnapara + d.odenenFaiz > 0 && ` · kalan ${tlYaz(kalan)}`}
              </p>
              <div className="dugmeler">
                {kalan > 0 && acik !== d.taksit.id && (d.durum === 'gecikti' || d.taksit.id === ozet.sonraki?.taksit.id || tumu) && (
                  <button type="button" className={d.durum === 'gecikti' || d.durum === 'yaklasan' ? '' : 'ikincil'} onClick={() => (setAcik(d.taksit.id), setHata(null))}>
                    Öde
                  </button>
                )}
                {d.odenenAnapara + d.odenenFaiz > 0 && geriAl !== d.taksit.id && (
                  <button type="button" className="baglanti-dugmesi" onClick={() => (setGeriAl(d.taksit.id), setHata(null))}>
                    Ödemeyi geri al
                  </button>
                )}
              </div>
              {acik === d.taksit.id && (
                <div className="islem-formu">
                  <div className="iki-sutun">
                    <Alan etiket="Ödeme tarihi">
                      <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
                    </Alan>
                    <Alan etiket="Hangi hesaptan">
                      <select value={hesapId} onChange={(e) => setHesapId(e.target.value)}>
                        {hesaplar.map(({ hesap, bakiye }) => (
                          <option key={hesap.id} value={hesap.id}>
                            {hesap.ad} · {tlYaz(bakiye)}
                          </option>
                        ))}
                      </select>
                    </Alan>
                  </div>
                  <p className="soluk kucuk">
                    Anapara {tlYaz(d.kalanAnapara)} bankaya ödeme, faiz {tlYaz(d.kalanFaiz)} gider (Kredi faizi ve banka masrafları) olarak yazılır.
                  </p>
                  <div className="dugmeler">
                    <button type="button" onClick={() => void ode(d.taksit.id)}>
                      {tlYaz(kalan)} öde
                    </button>
                    <button type="button" className="ikincil" onClick={() => setAcik(null)}>
                      Vazgeç
                    </button>
                  </div>
                </div>
              )}
              {geriAl === d.taksit.id && (
                <div className="islem-formu">
                  <Alan etiket="Neden geri alınıyor?">
                    <input value={gerekce} onChange={(e) => setGerekce(e.target.value)} placeholder="örn. yanlış tarih" />
                  </Alan>
                  <div className="dugmeler">
                    <button type="button" className="tehlikeli" onClick={() => void geriAlOnay(d.taksit.id)}>
                      Ödemeyi geri al
                    </button>
                    <button type="button" className="ikincil" onClick={() => setGeriAl(null)}>
                      Vazgeç
                    </button>
                  </div>
                </div>
              )}
              {(acik === d.taksit.id || geriAl === d.taksit.id) && hata && <Hatalar hatalar={[hata]} />}
            </li>
          );
        })}
      </ul>
      {!tumu && ozet.taksitler.filter((d) => d.durum !== 'odendi').length > 1 && (
        <button type="button" className="baglanti-dugmesi" onClick={() => setTumu(true)}>
          Sonraki taksitleri de erken öde
        </button>
      )}
    </section>
  );
}

function KrediIptali({ id, odenmis }: { id: string; odenmis: boolean }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  return (
    <details className="kart">
      <summary className="soluk">Krediyi iptal et</summary>
      {odenmis ? (
        <p className="soluk kucuk">Taksit ödenmiş kredi iptal edilemez; önce taksit ödemelerini geri alın.</p>
      ) : (
        <>
          <p className="soluk kucuk">Yanlış girilen kredi için: kullanım tahsilatı da iptal olur, para hesaptan düşer.</p>
          {kutu}
          {hata && <Hatalar hatalar={[hata]} />}
          <button
            type="button"
            className="tehlikeli"
            onClick={() =>
              void degistir(
                'Kredi iptali',
                async (gerekce) => {
                  await krediIptal(depo, servis, id, gerekce ?? '');
                  git('krediler');
                },
              )
            }
          >
            Krediyi iptal et
          </button>
        </>
      )}
    </details>
  );
}
