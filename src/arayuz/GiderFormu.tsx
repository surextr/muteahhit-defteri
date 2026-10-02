import { useEffect, useMemo, useRef, useState } from 'react';
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
  type GiderOzeti,
  type GiderDetayi,
  type GiderGirdisi,
  type PesinOdeme,
  type SatirFormGirdisi,
} from '../servisler/gider';
import { hesaplariListele, type HesapOzeti } from '../servisler/hesap';
import { projeButcesiGetir } from '../servisler/kalem';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { taslakGetir, taslakSil, taslakYaz } from '../servisler/taslak';
import type { Tevkifat } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { CariSecici } from './CariSecici';
import { EksiBakiyeUyarisi, hesapBakiyeMetni } from './HesaplarEkrani';
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

const TASLAK_BICIMI = 2;

/** Fiş ve faturada en alttaki tutar KDV dahildir; hızlı girişte varsayılan odur. */
const bosSatir = (): SatirFormu => ({ kalemId: '', aciklama: '', miktar: '', birim: '', tutar: '', kdvDahil: true, kdvOrani: '20', tevkifat: '' });

const bosForm = (projeId = '', hesapId = ''): GiderFormDurumu => ({
  tarih: yerelGun(new Date()),
  projeId,
  cariId: null,
  faturaNo: '',
  vadeTarihi: '',
  aciklama: '',
  satirlar: [bosSatir()],
  odemeDurumu: 'veresiye',
  hesapId,
  odenen: '',
  iadeEdilenGiderId: '',
});

/** Asıl faturanın satırları iade formuna (KDV hariç, tevkifatsız) kopyalanır; kullanıcı iade edileni düzeltir. */
const iadeSatirlari = (d: GiderDetayi): SatirFormu[] =>
  d.satirlar.map((s) => ({
    kalemId: s.kalemId ?? '',
    aciklama: s.aciklama,
    miktar: s.miktar === null ? '' : sayiYaz(s.miktar),
    birim: s.birim ?? '',
    tutar: tutarMetni(s.kdvHaricTutar),
    kdvDahil: false,
    kdvOrani: String(s.kdvOrani),
    tevkifat: '',
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
type KalemSecenegi = { ad: string; id: string } | { ad: string; altlar: { id: string; ad: string }[] };

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
  /** İadede: seçili carinin alışları (asıl fatura seçimi için). */
  const [alislar, setAlislar] = useState<GiderOzeti[]>([]);
  const [kaynak, setKaynak] = useState<Kaynaklar | null>(null);
  const [form, setForm] = useState<GiderFormDurumu | null>(props.duzenlenen ? detaydanForm(props.duzenlenen) : null);
  const [taslakZamani, setTaslakZamani] = useState<string | null>(null);
  const [kalemler, setKalemler] = useState<KalemSecenegi[]>([]);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);
  const [mukerrer, setMukerrer] = useState<MukerrerFaturaUyarisi['mevcut'] | null>(null);
  const [ayrinti, setAyrinti] = useState(!!props.duzenlenen && (!!props.duzenlenen.gider.faturaNo || !!props.duzenlenen.gider.vadeTarihi));
  const kaydedildi = useRef(false);

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
          iadeEdilenGiderId: asil.gider.id,
          satirlar: iadeSatirlari(asil),
        });
        return;
      }
      const taslak = await taslakGetir<GiderFormDurumu>(depo, f, taslakAdi, TASLAK_BICIMI);
      const varsayilan = await taslakGetir<{ projeId: string; hesapId: string }>(depo, f, 'giderVarsayilanlari', 1);
      if (iptal) return;
      if (taslak) {
        setForm(taslak.veri);
        setTaslakZamani(taslak.zaman);
      } else {
        const projeId = props.projeId ?? varsayilan?.veri.projeId ?? '';
        setForm(bosForm(projeler.some((p) => p.proje.id === projeId) ? projeId : '', varsayilan?.veri.hesapId ?? ''));
      }
    })();
    return () => {
      iptal = true;
    };
  }, [depo, oturum.firmaId, yeni, props.projeId, props.asilGiderId, taslakAdi]);

  // İadede carinin alışları: asıl fatura seçimi ve kalan borcu.
  const cariId = form?.cariId ?? null;
  useEffect(() => {
    if (!iade || !cariId) return setAlislar([]);
    void giderleriListele(depo, oturum.firmaId, { cariId }, yerelGun(new Date())).then((l) => setAlislar(l.filter((g) => g.gider.tur === 'alis')));
  }, [iade, cariId, depo, oturum.firmaId]);

  // Seçili projenin kalemleri.
  const projeId = form?.projeId ?? '';
  useEffect(() => {
    if (!projeId) return setKalemler([]);
    void projeButcesiGetir(depo, oturum.firmaId, projeId, true).then((o) =>
      setKalemler(
        o.dugumler.map((d) =>
          d.altlar.length > 0
            ? { ad: d.kalem.ad, altlar: d.altlar.map((a) => ({ id: a.kalem.id, ad: a.kalem.ad })) }
            : { ad: d.kalem.ad, id: d.kalem.id },
        ),
      ),
    );
  }, [depo, oturum.firmaId, projeId]);

  // Yeni giderde her değişiklik taslak olarak saklanır.
  useEffect(() => {
    if (!yeni || !form || kaydedildi.current) return;
    void taslakYaz(depo, oturum.firmaId, taslakAdi, TASLAK_BICIMI, form);
  }, [yeni, form, depo, oturum.firmaId, taslakAdi]);

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
  const carisiz = form.cariId === null;
  // İade: önce asıl faturanın kalan borcundan düşer, artanı alacak kalır ya da geri alınır.
  const asil = alislar.find((g) => g.gider.id === form.iadeEdilenGiderId);
  const mahsup = iade && asil ? Math.min(t.toplam, asil.kalan) : 0;
  const serbest = t.toplam - mahsup;
  // Carisiz alış yalnızca peşin olabilir.
  const odemeDurumu: OdemeDurumu = carisiz ? 'pesin' : form.odemeDurumu;
  const secenekGrubu = (s: SatirFormu, i: number) => (
    <select value={s.kalemId} onChange={(e) => satirYaz(i, 'kalemId', e.target.value)} aria-label="Kalem">
      <option value="">{form.projeId ? 'Kalemsiz' : 'Kalem için proje seçin'}</option>
      {kalemler.map((k) =>
        'altlar' in k ? (
          <optgroup key={k.ad} label={k.ad}>
            {k.altlar.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ad}
              </option>
            ))}
          </optgroup>
        ) : (
          <option key={k.id} value={k.id}>
            {k.ad}
          </option>
        ),
      )}
    </select>
  );

  async function kaydet(mukerrerOnayli = false) {
    if (!form) return;
    setMukerrer(null);
    const { girdi, hatalar } = girdiyeCevir(form);
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
      if (yeni) {
        await taslakSil(depo, oturum.firmaId, taslakAdi);
        if (!iade) await taslakYaz(depo, oturum.firmaId, 'giderVarsayilanlari', 1, { projeId: form.projeId, hesapId: form.hesapId });
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
      void degistir(eski, 'Gider değişiyor', async (g) => {
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
    if (yeni) await taslakSil(depo, oturum.firmaId, taslakAdi);
    if (props.asilGiderId) return git(`giderler/${props.asilGiderId}`);
    git(yeni ? (props.projeId ? `projeler/${props.projeId}` : 'kayit') : `giderler/${props.duzenlenen!.gider.id}`);
  }

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

      <section className="kart">
        <div className="iki-sutun">
          <Alan etiket="Tarih">
            <input type="date" value={form.tarih} onChange={(e) => yaz('tarih', e.target.value)} />
          </Alan>
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
        </div>

        <div className="alan">
          <span className="alan-etiket">{iade ? 'Cari (kime iade edildi)' : 'Cari (kimden alındı)'}</span>
          <CariSecici
            cariler={kaynak.cariler}
            secili={form.cariId}
            onSec={(id) => setForm((f) => f && { ...f, cariId: id, iadeEdilenGiderId: '' })}
            oncelikli={['tedarikci', 'usta']}
            bosEtiket={iade ? 'Carisiz (para hemen geri alındı)' : 'Carisiz (peşin alış, fiş)'}
            yeniCariYolu={yeni && !iade ? 'cariler/yeni/tedarikci' : undefined}
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
      </section>

      {form.satirlar.map((s, i) => {
        const h = hesaplanan.satirlar[i];
        return (
          <section className="kart" key={s.id ?? i}>
            {form.satirlar.length > 1 && (
              <div className="baslik-satiri">
                <h2>{i + 1}. satır</h2>
                <button
                  type="button"
                  className="ikincil"
                  onClick={() => setForm((f) => f && { ...f, satirlar: f.satirlar.filter((_, j) => j !== i) })}
                >
                  Satırı çıkar
                </button>
              </div>
            )}
            <Alan etiket="Kalem">{secenekGrubu(s, i)}</Alan>
            {form.projeId && kalemler.length === 0 && (
              <p className="mesaj-not">
                Bu projede kalem yok. <a href={`#/projeler/${form.projeId}/butce`}>Bütçe ekranından kalem ekleyin.</a>
              </p>
            )}
            <div className="iki-sutun">
              <Alan etiket="Tutar (₺)">
                <input value={s.tutar} inputMode="decimal" placeholder="0" onChange={(e) => satirYaz(i, 'tutar', e.target.value)} />
              </Alan>
              <Alan etiket="KDV">
                <select value={s.kdvOrani} onChange={(e) => satirYaz(i, 'kdvOrani', e.target.value)}>
                  {KDV_ORANLARI.map((o) => (
                    <option key={o} value={o}>
                      %{o}
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
            <div className="iki-sutun">
              {!iade && (
                <Alan etiket="Tevkifat">
                  <select value={s.tevkifat} onChange={(e) => satirYaz(i, 'tevkifat', e.target.value)} disabled={s.kdvOrani === '0'}>
                    <option value="">Yok</option>
                    {TEVKIFAT_ORANLARI.map((o) => (
                      <option key={tevkifatYaz(o)} value={tevkifatYaz(o)}>
                        {tevkifatYaz(o)}
                      </option>
                    ))}
                  </select>
                </Alan>
              )}
              <Alan etiket="Açıklama">
                <input value={s.aciklama} placeholder="C30 beton" onChange={(e) => satirYaz(i, 'aciklama', e.target.value)} />
              </Alan>
              <Alan etiket="Miktar">
                <input value={s.miktar} inputMode="decimal" placeholder="İsteğe bağlı" onChange={(e) => satirYaz(i, 'miktar', e.target.value)} />
              </Alan>
              <Alan etiket="Birim">
                <input value={s.birim} placeholder="m³, ton, adet" onChange={(e) => satirYaz(i, 'birim', e.target.value)} />
              </Alan>
            </div>
            {h && (
              <p className="mesaj-not">
                KDV hariç {tlYaz(h.kdvHaricTutar)} · KDV {tlYaz(h.kdvTutari)}
                {h.tevkifatTutari > 0 && ` · tevkif edilen ${tlYaz(h.tevkifatTutari)}`}
                {sayiOku(s.miktar) ? ` · birim fiyat ${tlYaz(Math.round(h.kdvHaricTutar / sayiOku(s.miktar)!))}` : ''}
              </p>
            )}
          </section>
        );
      })}

      <button type="button" className="ikincil genis" onClick={() => setForm((f) => f && { ...f, satirlar: [...f.satirlar, bosSatir()] })}>
        + Satır ekle
      </button>

      <section className="kart">
        <dl className="bilgi">
          <dt>KDV hariç</dt>
          <dd>{tlYaz(t.kdvHaricToplam)}</dd>
          <dt>KDV</dt>
          <dd>{tlYaz(t.kdvToplam)}</dd>
          <dt>{iade ? 'İade toplamı' : 'Fatura toplamı'}</dt>
          <dd>
            <strong>{tlYaz(t.toplam)}</strong>
          </dd>
          {t.tevkifatToplam > 0 && (
            <div className="bilgi-satir">
              <dt>Tevkif edilen KDV</dt>
              <dd>
                {tlYaz(t.tevkifatToplam)} <span className="soluk">(vergi dairesine)</span>
              </dd>
            </div>
          )}
          {t.tevkifatToplam > 0 && (
            <div className="bilgi-satir">
              <dt>Cariye ödenecek</dt>
              <dd>
                <strong>{tlYaz(t.odenecek)}</strong>
              </dd>
            </div>
          )}
        </dl>

        {yeni && iade && (
          <>
            <h3>İade karşılığı</h3>
            {mahsup > 0 && <p className="mesaj-not">{tlYaz(mahsup)} seçilen faturanın kalan borcundan düşer.</p>}
            {serbest > 0 && (
              <>
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
                      <button key={k} type="button" aria-pressed={odemeDurumu === k} onClick={() => yaz('odemeDurumu', k)}>
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
              </>
            )}
          </>
        )}

        {yeni && !iade && (
          <>
            <h3>Ödeme</h3>
            {carisiz ? (
              <p className="mesaj-not">Carisiz alış peşin ödenmiş sayılır.</p>
            ) : (
              <div className="filtreler" role="group" aria-label="Ödeme durumu">
                {(
                  [
                    ['veresiye', 'Veresiye'],
                    ['pesin', 'Peşin ödendi'],
                    ['kismi', 'Kısmen ödendi'],
                  ] as const
                ).map(([k, ad]) => (
                  <button key={k} type="button" aria-pressed={form.odemeDurumu === k} onClick={() => yaz('odemeDurumu', k)}>
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
                {odemeDurumu === 'kismi' ? (
                  <Alan etiket="Ödenen (₺)">
                    <input value={form.odenen} inputMode="decimal" onChange={(e) => yaz('odenen', e.target.value)} />
                  </Alan>
                ) : (
                  <Alan etiket="Ödenen (₺)">
                    <input value={tutarMetni(t.odenecek)} readOnly />
                  </Alan>
                )}
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
          </>
        )}

        <button type="button" className="baglanti-dugmesi" onClick={() => setAyrinti(!ayrinti)} aria-expanded={ayrinti}>
          {ayrinti ? 'Diğer bilgileri gizle' : 'Fatura no, vade, açıklama'}
        </button>
        {ayrinti && (
          <>
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
          </>
        )}

        {kutu}
        <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
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
        <div className="dugmeler">
          <button type="button" onClick={() => void kaydet()} disabled={islemde}>
            {islemde ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <button type="button" className="ikincil" onClick={() => void vazgec()} disabled={islemde}>
            Vazgeç
          </button>
        </div>
        {yeni && <p className="mesaj-not">Yazdıklarınız bu cihazda taslak olarak saklanır; başka ekrana geçip dönebilirsiniz.</p>}
      </section>
    </>
  );
}
