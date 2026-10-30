import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { bransKisaAdi } from '../hesap/brans';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import {
  TAKIP_YONTEMI_ADI,
  bolumCikar,
  bolumEkle,
  eksikBilgiler,
  kalemTutari,
  sozlesmeToplami,
  sozlesmeUyarilari,
  type SozlesmeIcerigi,
} from '../hesap/ustaSozlesmesi';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import {
  projeSozlesmeleri,
  sozlesmeBelgesiGetir,
  sozlesmeIcerigi,
  ustaSozlesmesiGetir,
  ustaSozlesmesiIptal,
  ustaSozlesmesiKaydet,
  ustaSozlesmesiOlustur,
  ustaSozlesmesiOnayla,
  type SozlesmeBelgesi,
  type SozlesmeOzeti,
} from '../servisler/ustaSozlesmesi';
import { hazirUstaTipleriniEkle, ortakMaddeler, ustaTipleriListele } from '../servisler/ustaTipi';
import { katAsamaOnerisi } from '../servisler/hakedis';
import { projeGetir } from '../servisler/proje';
import { YAPRAK_KALEM_KODLARI } from '../veri/sabit/hazirKalemKodlari';
import { HAKEDIS_SEKLI_ADI } from '../veri/sabit/hazirUstaTipleri';
import { yeniId } from '../veri/kimlik';
import type { Cari, HakedisSekli, Proje, SorumlulukCevabi, SozlesmeBolumu, SozlesmeKalemi, TakipYontemi, UstaSozlesmesi, UstaTipi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { BelgelerKarti } from './Belgeler';
import { HakedislerKarti } from './Hakedis';
import { OdemePlaniKarti, TaahhutBaglantisi } from './Taahhut';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { BransSecimi } from './CariFormu';
import { CariSecici } from './CariSecici';
import { TutarGirdisi } from './Girdiler';
import { git } from './rota';
import { useBranslar } from './useBranslar';
import { OzelSartDuzenleyici } from './YapayZeka';
import { SozlesmeBelgesiGorunumu } from './BelgeGorunumu';
import { KurulumUyarilari } from './HavuzSozlesme';

export { SozlesmeBelgesiGorunumu };

// Usta sözleşmesi: proje sayfasındaki liste, tipten yeni sözleşme, düzenleme formu (eksik bilgiler canlı görünür),
// yapay zekâ ile özel şartlar ve yazdırılabilir sözleşme (tarayıcının "PDF olarak kaydet"i ile PDF).

const tarihYaz = (t: string | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '—');

/** Sorumluluk cevapları sözleşme diliyle: müteahhit = İşveren, usta = Yüklenici. */
const CEVAP_ADI: Record<SorumlulukCevabi, string> = {
  muteahhit: 'İşveren (biz)',
  usta: 'Yüklenici (usta)',
  sozlesmede: 'Sözleşmeye yazacağım',
};

export function SozlesmeDurumu({ s }: { s: Pick<UstaSozlesmesi, 'onay' | 'sozlesmeSurumu'> }) {
  return s.onay ? <span className="rozet-tamam">İmzalandı{s.sozlesmeSurumu > 1 ? ` · sürüm ${s.sozlesmeSurumu}` : ''}</span> : <span className="rozet-taslak">Taslak</span>;
}

// ─── Proje sayfasındaki kart ───────────────────────────────────────

export function UstaSozlesmeleriKarti({ projeId }: { projeId: string }) {
  const { depo, oturum } = useUygulama();
  const [liste, setListe] = useState<SozlesmeOzeti[] | null>(null);

  useEffect(() => {
    void projeSozlesmeleri(depo, oturum.firmaId, projeId).then(setListe);
  }, [depo, oturum.firmaId, projeId]);

  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Usta sözleşmeleri</h2>
        <a className="dugme" href={`#/sozlesmeler/yeni/${projeId}`}>
          + Sözleşme
        </a>
      </div>
      {liste && liste.some((x) => x.sozlesme.onay) && (
        <p className="satir-ici">
          <TaahhutBaglantisi projeId={projeId} />
          <a className="baglanti-dugmesi" href={`#/projeler/${projeId}/sgk`}>
            SGK takibi
          </a>
        </p>
      )}
      {liste === null ? (
        <p>Yükleniyor…</p>
      ) : liste.length === 0 ? (
        <p className="soluk">Henüz sözleşme yok. Usta tipini (birden çok iş için hepsini) seçin; kalemler, sorumluluk soruları ve şartlar hazır gelir.</p>
      ) : (
        <ul className="liste">
          {liste.map(({ sozlesme: s, cariAdi, eksikSayisi }) => (
            <li key={s.id}>
              <a href={`#/sozlesmeler/${s.id}`} className="genis-satir">
                <strong>{cariAdi}</strong> <SozlesmeDurumu s={s} />
                <span className="soluk blok kucuk">
                  {s.ustaTipiAdi}
                  {s.toplamTutar > 0 && ` · ${tlYaz(s.toplamTutar)}`}
                  {!s.onay && eksikSayisi > 0 && ` · ${eksikSayisi} eksik bilgi`}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Yeni sözleşme ─────────────────────────────────────────────────

export function UstaSozlesmesiYeni({ projeId }: { projeId: string }) {
  const { depo, oturum, servis, firma } = useUygulama();
  const [proje, setProje] = useState<Proje | null | undefined>(undefined);
  const [tipler, setTipler] = useState<UstaTipi[]>([]);
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  /** Sözleşmedeki işler; ilki ana iş. Birden çoksa toplu sözleşme. */
  const [tipIdleri, setTipIdleri] = useState<string[]>([]);
  const [cariId, setCariId] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    void (async () => {
      // Usta tipleri ekranı hiç açılmadıysa hazır tipler burada eklenir.
      await hazirUstaTipleriniEkle(depo, servis).catch(() => 0);
      const [p, t, c] = await Promise.all([projeGetir(depo, oturum.firmaId, projeId), ustaTipleriListele(depo, oturum.firmaId), carileriListele(depo, oturum.firmaId)]);
      setProje(p);
      setTipler(t.filter((x) => !x.gizli));
      setCariler(c.filter((x) => !x.cari.roller.includes('vergi_dairesi')));
    })();
  }, [depo, oturum.firmaId, projeId, servis]);

  async function olustur() {
    setIslemde(true);
    setHata(null);
    try {
      const s = await ustaSozlesmesiOlustur(depo, servis, firma, { projeId, ustaTipiIdleri: tipIdleri, cariId: cariId ?? '' });
      git(`sozlesmeler/${s.id}`);
    } catch (e) {
      setHata(hataMetni(e));
      setIslemde(false);
    }
  }

  /**
   * Önce usta seçilirse işler kartından dolar: ustada ana branşı, taşeronda bütün branşları (toplu sözleşme olarak).
   * Seçilebilir (gizli olmayan) tiplerle sınırlıdır.
   */
  function ustaSec(id: string | null) {
    setCariId(id);
    if (tipIdleri.length > 0 || !id) return;
    const c = cariler.find((x) => x.cari.id === id)?.cari;
    const branslar = (c?.ustaTipiIdleri ?? []).filter((b) => tipler.some((t) => t.id === b));
    setTipIdleri(c?.roller.includes('taseron') ? branslar : branslar.slice(0, 1));
  }

  if (proje === undefined) return <p>Yükleniyor…</p>;
  if (proje === null) return <p className="hata">Proje bulunamadı.</p>;
  const secilenler = tipIdleri.map((id) => tipler.find((t) => t.id === id)).filter((t): t is UstaTipi => !!t);
  const secilenUsta = cariler.find((x) => x.cari.id === cariId)?.cari;
  const kartaEklenecek = secilenUsta ? secilenler.filter((t) => !secilenUsta.ustaTipiIdleri.includes(t.id)) : [];

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <h1>Yeni usta sözleşmesi</h1>
      <section className="kart">
        <BransSecimi tipler={tipler} secili={tipIdleri} onDegisti={setTipIdleri} baslik="İş (usta tipi)" birim="iş" />
        {secilenler.length === 1 && (
          <p className="soluk kucuk">
            {secilenler[0]!.kalemler.length} kalem · {secilenler[0]!.sorular.length} sorumluluk sorusu · {HAKEDIS_SEKLI_ADI[secilenler[0]!.hakedisSekli]}
          </p>
        )}
        {secilenler.length > 1 && (
          <p className="soluk kucuk">
            Toplu sözleşme: {secilenler.length} iş tek sözleşmede. Her işin kalemleri, sorumlulukları ve hakediş şekli ayrı gelir; sonra iş eklenip
            çıkarılabilir.
          </p>
        )}
        <div className="alan">
          <span className="alan-etiket">Usta / taşeron</span>
          <CariSecici
            cariler={cariler}
            secili={cariId}
            onSec={ustaSec}
            oncelikli={['usta', 'taseron']}
            oncelikliBrans={tipIdleri[0] ?? null}
            hizliEkle={{ rol: 'usta', ustaTipiId: tipIdleri[0] ?? null, onEklendi: (c) => setCariler((l) => [...l, { cari: c, bakiye: 0 }]) }}
          />
          {kartaEklenecek.length > 0 && (
            <small className="alan-aciklama">
              {kartaEklenecek.map((t) => `"${bransKisaAdi(t.ad)}"`).join(', ')} branş{kartaEklenecek.length > 1 ? 'ları' : 'ı'} bu karta da eklenecek.
            </small>
          )}
        </div>
        {hata && <Hatalar hatalar={[hata]} />}
        <div className="dugmeler">
          <button type="button" disabled={tipIdleri.length === 0 || !cariId || islemde} onClick={() => void olustur()}>
            {islemde ? 'Hazırlanıyor…' : 'Taslağı hazırla'}
          </button>
        </div>
      </section>
    </>
  );
}

// ─── Düzenleme formu ───────────────────────────────────────────────

/** Formda miktar ve fiyat yazıldığı gibi tutulur ("12," yazarken bozulmasın); kayıtta sayıya çevrilir. */
interface FormKalemi {
  id: string;
  ustaTipiId: string;
  ad: string;
  birim: string;
  aciklama: string;
  miktar: string;
  fiyat: string;
  butceKalemiKodu: string | null;
}
interface FormAsamasi {
  id: string;
  ad: string;
  tutar: string;
}
type FormBolumu = Omit<SozlesmeBolumu, 'asamalar'> & { asamalar: FormAsamasi[] };
type Form = Omit<SozlesmeIcerigi, 'kalemler' | 'bolumler' | 'teminatOrani'> & { kalemler: FormKalemi[]; bolumler: FormBolumu[]; teminatOrani: string };

const formKalemi = (k: SozlesmeKalemi): FormKalemi => ({
  id: k.id,
  ustaTipiId: k.ustaTipiId,
  ad: k.ad,
  birim: k.birim,
  aciklama: k.aciklama,
  miktar: sayiYaz(k.miktar),
  fiyat: k.birimFiyat > 0 ? tutarMetni(k.birimFiyat) : '',
  butceKalemiKodu: k.butceKalemiKodu,
});
const formBolumu = (b: SozlesmeBolumu): FormBolumu => ({
  ...b,
  asamalar: b.asamalar.map((a) => ({ id: a.id, ad: a.ad, tutar: a.tutar > 0 ? tutarMetni(a.tutar) : '' })),
});

const formaCevir = (g: SozlesmeIcerigi): Form => ({
  ...g,
  bolumler: g.bolumler.map(formBolumu),
  kalemler: g.kalemler.map(formKalemi),
  teminatOrani: g.teminatOrani > 0 ? sayiYaz(g.teminatOrani) : '',
});

/** Formdan içerik; okunamayan sayılar ayrıca hata olarak döner. */
function formdanIcerik(f: Form): { icerik: SozlesmeIcerigi; hatalar: string[] } {
  const hatalar: string[] = [];
  const kalemler = f.kalemler.map((k) => {
    const miktar = k.miktar.trim() ? sayiOku(k.miktar) : null;
    const fiyat = k.fiyat.trim() ? tlOku(k.fiyat) : 0;
    if (k.miktar.trim() && miktar === null) hatalar.push(`"${k.ad || 'Adsız'}" kaleminin miktarı okunamadı (örn. 1.250,5).`);
    if (k.fiyat.trim() && fiyat === null) hatalar.push(`"${k.ad || 'Adsız'}" kaleminin birim fiyatı okunamadı.`);
    return { id: k.id, ustaTipiId: k.ustaTipiId, ad: k.ad, birim: k.birim, aciklama: k.aciklama, miktar, birimFiyat: fiyat ?? 0, butceKalemiKodu: k.butceKalemiKodu };
  });
  const bolumler = f.bolumler.map((b) => ({
    ...b,
    asamalar: b.asamalar.map((a) => {
      const tutar = a.tutar.trim() ? tlOku(a.tutar) : 0;
      if (tutar === null) hatalar.push(`"${a.ad || 'Adsız'}" aşamasının tutarı okunamadı.`);
      return { id: a.id, ad: a.ad, tutar: tutar ?? 0 };
    }),
  }));
  const teminat = f.teminatOrani.trim() ? sayiOku(f.teminatOrani) : 0;
  if (teminat === null) hatalar.push('Teminat oranı okunamadı (örn. 5).');
  return { icerik: { ...f, bolumler, kalemler, teminatOrani: teminat ?? 0 }, hatalar };
}

export function UstaSozlesmesiEkrani({ id }: { id: string }) {
  const { depo, oturum, servis, firma } = useUygulama();
  const { tipler } = useBranslar();
  const [s, setS] = useState<UstaSozlesmesi | null | undefined>(undefined);
  const [proje, setProje] = useState<Proje | null>(null);
  const [cari, setCari] = useState<Cari | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [planDegisti, setPlanDegisti] = useState(false);
  const { degistir, kutu, hata } = useGerekceliDegisiklik();

  const yukle = useCallback(async () => {
    const x = await ustaSozlesmesiGetir(depo, oturum.firmaId, id);
    setS(x);
    if (!x) return;
    setForm(formaCevir(sozlesmeIcerigi(x)));
    const [p, c] = await Promise.all([depo.getir('proje', x.projeId), depo.getir('cari', x.cariId)]);
    setProje(p ?? null);
    setCari(c ?? null);
  }, [depo, oturum.firmaId, id]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const cevrim = useMemo(() => (form ? formdanIcerik(form) : null), [form]);
  const kayitli = useMemo(() => (s ? JSON.stringify(formaCevir(sozlesmeIcerigi(s))) : ''), [s]);

  if (s === undefined || (s && !form)) return <p>Yükleniyor…</p>;
  if (s === null || !form || !cevrim) return <p className="hata">Sözleşme bulunamadı.</p>;

  const degisti = JSON.stringify(form) !== kayitli;
  const eksik = eksikBilgiler(cevrim.icerik);
  const uyarilar = sozlesmeUyarilari(cevrim.icerik);
  const { toplam, eksikMiktar } = sozlesmeToplami(cevrim.icerik.kalemler);
  const yaz = <K extends keyof Form>(alan: K, deger: Form[K]) => {
    setMesaj(null);
    setForm({ ...form, [alan]: deger });
  };
  const kalemYaz = (i: number, d: Partial<FormKalemi>) => yaz('kalemler', form.kalemler.map((k, j) => (j === i ? { ...k, ...d } : k)));
  const toplu = form.bolumler.length > 1;
  const isAdi = (tipId: string) => bransKisaAdi(form.bolumler.find((b) => b.ustaTipiId === tipId)?.ustaTipiAdi ?? '');

  /** İş ekleme/çıkarma saf fonksiyonlarla yapılır; formdaki kalem ve aşamalar yazıldığı gibi korunur. */
  function isEkle(tipId: string) {
    const tip = tipler.find((t) => t.id === tipId);
    if (!tip || !form || !cevrim) return;
    const ic = bolumEkle({ ...cevrim.icerik, kalemler: [] }, tip, ortakMaddeler(firma));
    setMesaj(null);
    setForm({
      ...form,
      fiyatlamaBirimi: ic.fiyatlamaBirimi,
      ortakMaddeler: ic.ortakMaddeler,
      ozelSartlar: ic.ozelSartlar,
      sorumluluklar: ic.sorumluluklar,
      bolumler: [...form.bolumler, formBolumu(ic.bolumler.at(-1)!)],
      kalemler: [...form.kalemler, ...ic.kalemler.map(formKalemi)],
    });
  }
  function isCikar(tipId: string) {
    if (!form || !cevrim) return;
    const fiyatli = form.kalemler.some((k) => k.ustaTipiId === tipId && (k.fiyat.trim() || k.miktar.trim()));
    if (fiyatli && !window.confirm(`${isAdi(tipId)} işi, yazılan fiyat ve miktarlarıyla sözleşmeden çıkarılsın mı?`)) return;
    const ic = bolumCikar({ ...cevrim.icerik, kalemler: [] }, tipId);
    setMesaj(null);
    setForm({
      ...form,
      sorumluluklar: ic.sorumluluklar,
      bolumler: form.bolumler.filter((b) => b.ustaTipiId !== tipId),
      kalemler: form.kalemler.filter((k) => k.ustaTipiId !== tipId),
    });
  }
  const bolumYaz = (tipId: string, d: Partial<FormBolumu>) => yaz('bolumler', form.bolumler.map((x) => (x.ustaTipiId === tipId ? { ...x, ...d } : x)));
  async function katlardanOner(tipId: string) {
    const adlar = await katAsamaOnerisi(depo, oturum.firmaId, s!.projeId);
    const b = form!.bolumler.find((x) => x.ustaTipiId === tipId);
    if (!b) return;
    const mevcut = new Set(b.asamalar.map((a) => a.ad));
    bolumYaz(tipId, { asamalar: [...b.asamalar.filter((a) => a.ad || a.tutar), ...adlar.filter((a) => !mevcut.has(a)).map((ad) => ({ id: yeniId(), ad, tutar: '' }))] });
  }
  const eklenebilir = tipler.filter((t) => !t.gizli && !form.bolumler.some((b) => b.ustaTipiId === t.id));

  async function kaydet(sonra?: () => void) {
    if (!cevrim || cevrim.hatalar.length > 0) return;
    await degistir('İmzalı sözleşmede değişiklik', async (gerekce) => {
      const k = await ustaSozlesmesiKaydet(depo, servis, id, cevrim.icerik, gerekce);
      setS(k);
      setForm(formaCevir(sozlesmeIcerigi(k)));
      setMesaj('Kaydedildi.');
      sonra?.();
    }, 'İmzalı sözleşmede yapılan değişiklik kayıt geçmişine gerekçesiyle yazılır ve sözleşmenin sürüm numarası artar. Kısa bir gerekçe yazın (örn. "Usta ile fiyat yeniden anlaşıldı").');
  }

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${s.projeId}`}>← {proje?.ad ?? 'Proje'}</a>
      </p>
      <div className="baslik-satiri">
        <h1>{cari?.ad ?? 'Usta'}</h1>
        <SozlesmeDurumu s={s} />
      </div>
      <KurulumUyarilari />
      <p className="soluk">
        {toplu ? `Toplu sözleşme · ${form.bolumler.length} iş` : `${s.ustaTipiAdi} · şablon sürümü ${s.sablonSurumu}`}
      </p>
      {s.onay && <p className="mesaj mesaj-not">Bu sözleşme imzalandı ({tarihYaz(yerelGun(new Date(s.onay.zaman)))}). Değişiklik gerekçe ister ve sürüm numarası artar.</p>}

      <EksikBilgiler eksik={eksik} uyarilar={uyarilar} />

      <section className="kart">
        <h2>{toplu ? 'İşler' : 'İş ve hakediş'}</h2>
        <ul className="is-listesi">
          {form.bolumler.map((b, i) => (
            <li key={b.ustaTipiId}>
              <div className="is-adi">
                <strong>{b.ustaTipiAdi}</strong>
                <span className="soluk kucuk">
                  {toplu && i === 0 ? 'ana iş · ' : ''}şablon sürümü {b.sablonSurumu}
                </span>
              </div>
              <label className="is-hakedis">
                <span className="soluk kucuk">Hakediş şekli</span>
                <select value={b.hakedisSekli} onChange={(e) => bolumYaz(b.ustaTipiId, { hakedisSekli: e.target.value as HakedisSekli })}>
                  {Object.entries(HAKEDIS_SEKLI_ADI).map(([k, ad]) => (
                    <option key={k} value={k}>
                      {ad}
                    </option>
                  ))}
                </select>
              </label>
              {toplu && (
                <button type="button" className="ikincil is-cikar" onClick={() => isCikar(b.ustaTipiId)}>
                  Çıkar
                </button>
              )}
              <label className="is-hakedis is-takip">
                <span className="soluk kucuk">Hakediş nasıl hesaplanır</span>
                <select value={b.takipYontemi} onChange={(e) => bolumYaz(b.ustaTipiId, { takipYontemi: e.target.value as TakipYontemi })}>
                  {(Object.keys(TAKIP_YONTEMI_ADI) as TakipYontemi[]).map((k) => (
                    <option key={k} value={k}>
                      {TAKIP_YONTEMI_ADI[k]}
                    </option>
                  ))}
                </select>
              </label>
              {b.takipYontemi === 'asama' && (
                <div className="asamalar">
                  {b.asamalar.length === 0 && <p className="soluk kucuk">Aşama yok. Her aşamanın adını ve tamamlanınca ödenecek tutarı yazın.</p>}
                  {b.asamalar.map((a, j) => (
                    <div key={a.id} className="asama-satiri">
                      <input
                        value={a.ad}
                        placeholder="Aşama, örn. 1. kat betonu"
                        aria-label={`${j + 1}. aşamanın adı`}
                        onChange={(e) => bolumYaz(b.ustaTipiId, { asamalar: b.asamalar.map((x) => (x.id === a.id ? { ...x, ad: e.target.value } : x)) })}
                      />
                      <TutarGirdisi
                        value={a.tutar}
                        placeholder="Tutar (₺)"
                        onChange={(v) => bolumYaz(b.ustaTipiId, { asamalar: b.asamalar.map((x) => (x.id === a.id ? { ...x, tutar: v } : x)) })}
                      />
                      <button
                        type="button"
                        className="ikincil"
                        aria-label={`${j + 1}. aşamayı çıkar`}
                        onClick={() => bolumYaz(b.ustaTipiId, { asamalar: b.asamalar.filter((x) => x.id !== a.id) })}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <div className="dugmeler">
                    <button
                      type="button"
                      className="baglanti-dugmesi"
                      onClick={() => bolumYaz(b.ustaTipiId, { asamalar: [...b.asamalar, { id: yeniId(), ad: '', tutar: '' }] })}
                    >
                      + Aşama ekle
                    </button>
                    <button type="button" className="baglanti-dugmesi" onClick={() => void katlardanOner(b.ustaTipiId)}>
                      Binanın katlarından öner
                    </button>
                  </div>
                  {b.asamalar.length > 0 && (
                    <p className="ara-toplam">
                      <span>Aşamaların toplamı</span>
                      <span>{tlYaz(cevrim.icerik.bolumler.find((x) => x.ustaTipiId === b.ustaTipiId)!.asamalar.reduce((t, x) => t + x.tutar, 0))}</span>
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
        {eklenebilir.length > 0 && (
          <Alan etiket="İş ekle" aciklama="Aynı ustaya/taşerona başka bir iş de verdiyseniz ekleyin; kalemleri, soruları ve şartlarıyla gelir.">
            <select value="" onChange={(e) => e.target.value && isEkle(e.target.value)}>
              <option value="">+ İş (usta tipi) ekle…</option>
              {eklenebilir.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ad}
                </option>
              ))}
            </select>
          </Alan>
        )}
      </section>

      <section className="kart">
        <h2>Tarihler ve ödeme</h2>
        <div className="iki-sutun">
          <Alan etiket="Sözleşme tarihi">
            <input type="date" value={form.sozlesmeTarihi ?? ''} onChange={(e) => yaz('sozlesmeTarihi', e.target.value || null)} />
          </Alan>
          <Alan etiket="İşe başlama">
            <input type="date" value={form.baslamaTarihi ?? ''} onChange={(e) => yaz('baslamaTarihi', e.target.value || null)} />
          </Alan>
          <Alan etiket="Bitiş (teslim)">
            <input type="date" value={form.bitisTarihi ?? ''} onChange={(e) => yaz('bitisTarihi', e.target.value || null)} />
          </Alan>
        </div>
        <Alan etiket="Teminat (%)" aciklama="Her hakedişten tutulur, iş teslim edilip kabul edilince ödenir. Teminat yoksa boş bırakın.">
          <input inputMode="decimal" value={form.teminatOrani} placeholder="Yok" onChange={(e) => yaz('teminatOrani', e.target.value)} />
        </Alan>
        <Alan etiket="Ödeme koşulu" aciklama="İsteğe bağlı; örn. Hakediş onayından sonra 7 gün içinde.">
          <input value={form.odemeKosulu} onChange={(e) => yaz('odemeKosulu', e.target.value)} />
        </Alan>
        <Alan etiket="SGK" aciklama="İsteğe bağlı; örn. Yüklenici çalıştırdığı işçilerin SGK bildirimini yapar, bordroları her ay verir.">
          <input value={form.sgkTaahhudu ?? ''} onChange={(e) => yaz('sgkTaahhudu', e.target.value || null)} />
        </Alan>
      </section>

      <section className="kart">
        <h2>Kalemler ve fiyatlar</h2>
        <p className="soluk kucuk">Miktar boş bırakılabilir; o zaman yalnız birim fiyat anlaşılmış olur, ödeme ölçülen miktara göre yapılır.</p>
        {form.bolumler.map((b) => {
          const satirlar = form.kalemler.map((k, i) => ({ k, i })).filter((x) => x.k.ustaTipiId === b.ustaTipiId);
          const ara = sozlesmeToplami(cevrim.icerik.kalemler.filter((x) => x.ustaTipiId === b.ustaTipiId));
          const yeniKalem = (): FormKalemi => {
            const son = satirlar.at(-1)?.k;
            return { id: yeniId(), ustaTipiId: b.ustaTipiId, ad: '', birim: son?.birim ?? form.fiyatlamaBirimi, aciklama: '', miktar: '', fiyat: '', butceKalemiKodu: son?.butceKalemiKodu ?? null };
          };
          return (
            <div key={b.ustaTipiId} className={toplu ? 'is-kalemleri' : undefined}>
              {toplu && <h3>{bransKisaAdi(b.ustaTipiAdi)}</h3>}
              {satirlar.map(({ k, i }) => {
                const tutar = kalemTutari(cevrim.icerik.kalemler[i]!);
                return (
                  <div key={i} className="sozlesme-kalemi">
                    <input className="sk-ad" value={k.ad} placeholder="Kalem" aria-label={`${i + 1}. kalemin adı`} onChange={(e) => kalemYaz(i, { ad: e.target.value })} />
                    <input className="sk-birim" value={k.birim} placeholder="Birim" aria-label={`${i + 1}. kalemin birimi`} onChange={(e) => kalemYaz(i, { birim: e.target.value })} />
                    <button type="button" className="ikincil sk-sil" aria-label={`${i + 1}. kalemi çıkar`} onClick={() => yaz('kalemler', form.kalemler.filter((_, j) => j !== i))}>
                      ✕
                    </button>
                    <label className="sk-miktar">
                      <span className="soluk kucuk">Miktar</span>
                      <input inputMode="decimal" value={k.miktar} placeholder="—" onChange={(e) => kalemYaz(i, { miktar: e.target.value })} />
                    </label>
                    <label className="sk-fiyat">
                      <span className="soluk kucuk">Birim fiyat (₺)</span>
                      <TutarGirdisi value={k.fiyat} placeholder="0,00" onChange={(v) => kalemYaz(i, { fiyat: v })} />
                    </label>
                    <span className="sk-tutar">{tutar === null ? '' : tlYaz(tutar)}</span>
                    <details className="sk-ayrinti">
                      <summary className="soluk kucuk">Açıklama ve bütçe kalemi</summary>
                      <input value={k.aciklama} placeholder="Açıklama (isteğe bağlı)" aria-label={`${i + 1}. kalemin açıklaması`} onChange={(e) => kalemYaz(i, { aciklama: e.target.value })} />
                      <select value={k.butceKalemiKodu ?? ''} aria-label={`${i + 1}. kalemin bütçe kalemi`} onChange={(e) => kalemYaz(i, { butceKalemiKodu: e.target.value || null })}>
                        <option value="">Bütçe kalemi yok</option>
                        {YAPRAK_KALEM_KODLARI.map((bk) => (
                          <option key={bk.kod} value={bk.kod}>
                            {bk.ad}
                          </option>
                        ))}
                      </select>
                    </details>
                  </div>
                );
              })}
              <button type="button" className="baglanti-dugmesi" onClick={() => yaz('kalemler', [...form.kalemler, yeniKalem()])}>
                + {toplu ? `${bransKisaAdi(b.ustaTipiAdi)} kalemi` : 'Kalem'} ekle
              </button>
              {toplu && (
                <p className="ara-toplam">
                  <span>{bransKisaAdi(b.ustaTipiAdi)} {ara.eksikMiktar ? 'miktarı yazılı kalemleri' : 'toplamı'}</span>
                  <span>{tlYaz(ara.toplam)}</span>
                </p>
              )}
            </div>
          );
        })}
        <p className="toplam-satiri">
          <span>{eksikMiktar ? 'Miktarı yazılı kalemlerin toplamı' : toplu ? 'Genel toplam (tahmini)' : 'Tahmini toplam'}</span>
          <strong>{tlYaz(toplam)}</strong>
        </p>
      </section>

      {form.sorumluluklar.length > 0 && (
        <section className="kart">
          <h2>Malzeme ve sorumluluklar</h2>
          {form.sorumluluklar.map((r, i) => (
            <Fragment key={i}>
              {toplu && form.sorumluluklar[i - 1]?.ustaTipiId !== r.ustaTipiId && <h3 className="sorumluluk-isi">{isAdi(r.ustaTipiId)}</h3>}
              <fieldset className={`sorumluluk${r.cevap === null ? ' cevapsiz' : ''}`}>
                <legend>{r.soru}</legend>
                <div className="filtreler" role="group">
                  {(Object.keys(CEVAP_ADI) as SorumlulukCevabi[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={r.cevap === c}
                      onClick={() => yaz('sorumluluklar', form.sorumluluklar.map((x, j) => (j === i ? { ...x, cevap: c } : x)))}
                    >
                      {CEVAP_ADI[c]}
                    </button>
                  ))}
                </div>
                {r.cevap === 'sozlesmede' && (
                  <textarea
                    rows={2}
                    value={r.aciklama}
                    placeholder="Sözleşmeye yazılacak hüküm, örn. Çivi ve tel İşveren'e, iskele Yüklenici'ye aittir."
                    aria-label={`${r.soru}: sözleşmeye yazılacak hüküm`}
                    onChange={(e) => yaz('sorumluluklar', form.sorumluluklar.map((x, j) => (j === i ? { ...x, aciklama: e.target.value } : x)))}
                  />
                )}
              </fieldset>
            </Fragment>
          ))}
        </section>
      )}

      {form.ortakMaddeler.length > 0 && (
        <section className="kart">
          <h2>Genel hükümler</h2>
          <p className="soluk kucuk">Her madde için bu işte nasıl olacağını kısaca yazın. Liste Ayarlar › Usta tipleri › Ortak sözleşme maddeleri'nden gelir.</p>
          {form.ortakMaddeler.map((m, i) => (
            <Alan key={m.id} etiket={m.baslik}>
              <textarea
                rows={2}
                className={m.cevap.trim() ? undefined : 'bos-alan'}
                value={m.cevap}
                onChange={(e) => yaz('ortakMaddeler', form.ortakMaddeler.map((x, j) => (j === i ? { ...x, cevap: e.target.value } : x)))}
              />
            </Alan>
          ))}
        </section>
      )}

      <section className="kart">
        <h2>Özel şartlar</h2>
        <p className="soluk kucuk">Her satır ayrı madde olur. Yapay zekâ yalnızca dili düzeltir; eksik tutar, tarih ya da sorumluluğu kendisi yazmaz, size sorar.</p>
        <OzelSartDuzenleyici ustaTipi={form.bolumler.map((b) => b.ustaTipiAdi).join(' + ')} metin={form.ozelSartlar} onDegisti={(m) => yaz('ozelSartlar', m)} />
      </section>

      <section className="kart">
        <Alan etiket="Not" aciklama="Yalnızca sizin için; sözleşmeye yazılmaz.">
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
          <button type="button" className="ikincil" onClick={() => (degisti ? void kaydet(() => git(`sozlesmeler/${id}/metin`)) : git(`sozlesmeler/${id}/metin`))}>
            {degisti ? 'Kaydet ve sözleşmeyi gör' : 'Sözleşmeyi gör / yazdır'}
          </button>
        </div>
      </div>

      <HakedislerKarti sozlesme={s} />
      <OdemePlaniKarti sozlesme={s} onKaydedilmemis={setPlanDegisti} />

      <OnayVeIptal s={s} degisti={degisti} planDegisti={planDegisti} eksikVar={eksik.length > 0} onDegisti={yukle} />

      <BelgelerKarti bagliTur="ustaSozlesmesi" bagliId={s.id} varsayilanTur="sozlesme" baslik="İmzalı sözleşme ve belgeler" />
    </>
  );
}

function EksikBilgiler({ eksik, uyarilar }: { eksik: string[]; uyarilar: string[] }) {
  if (eksik.length === 0 && uyarilar.length === 0) return <p className="mesaj mesaj-basari">Eksik bilgi yok; sözleşme yazdırılıp imzalatılabilir.</p>;
  return (
    <section className={`mesaj ${eksik.length > 0 ? 'mesaj-uyari' : 'mesaj-not'}`} aria-live="polite">
      {eksik.length > 0 && (
        <>
          <strong>İmzadan önce tamamlanacak ({eksik.length})</strong>
          <ul>
            {eksik.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </>
      )}
      {uyarilar.length > 0 && (
        <>
          <strong>Kontrol edin</strong>
          <ul>
            {uyarilar.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function OnayVeIptal(props: { s: UstaSozlesmesi; degisti: boolean; planDegisti: boolean; eksikVar: boolean; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [onayHatasi, setOnayHatasi] = useState<string | null>(null);
  const { s } = props;

  async function onayla() {
    setOnayHatasi(null);
    try {
      await ustaSozlesmesiOnayla(depo, servis, s.id);
      await props.onDegisti();
    } catch (e) {
      setOnayHatasi(hataMetni(e));
    }
  }

  return (
    <section className="kart">
      {!s.onay && (
        <>
          <h2>İmza</h2>
          <p className="soluk">Sözleşmeyi yazdırıp usta ile imzaladıktan sonra işaretleyin. İmzalı sözleşmede değişiklik gerekçe ister.</p>
          {props.eksikVar && <p className="soluk kucuk">Eksik bilgiler tamamlanınca işaretlenebilir.</p>}
          {props.degisti && <p className="soluk kucuk">Önce değişiklikleri kaydedin.</p>}
          {props.planDegisti && <p className="soluk kucuk">Ödeme planında kaydedilmemiş değişiklik var: önce "Planı kaydet" ya da "Vazgeç".</p>}
          {onayHatasi && <Hatalar hatalar={[onayHatasi]} />}
          <div className="dugmeler">
            <button type="button" disabled={props.eksikVar || props.degisti || props.planDegisti} onClick={() => void onayla()}>
              İmzalandı olarak işaretle
            </button>
          </div>
        </>
      )}
      <details>
        <summary className="soluk">Sözleşmeyi iptal et</summary>
        <p className="soluk kucuk">İptal edilen sözleşme listeden kalkar, kayıt geçmişinde kalır.</p>
        {kutu}
        {hata && <Hatalar hatalar={[hata]} />}
        <button
          type="button"
          className="tehlikeli"
          onClick={() =>
            void degistir('Sözleşme iptali', async (gerekce) => {
              await ustaSozlesmesiIptal(depo, servis, s.id, gerekce);
              git(`projeler/${s.projeId}`);
            })
          }
        >
          İptal et
        </button>
      </details>
    </section>
  );
}

// ─── Yazdırılabilir sözleşme ───────────────────────────────────────

export function SozlesmeMetniEkrani({ id }: { id: string }) {
  const { depo, firma } = useUygulama();
  const [belge, setBelge] = useState<SozlesmeBelgesi | null | undefined>(undefined);

  useEffect(() => {
    void sozlesmeBelgesiGetir(depo, firma, id).then(setBelge);
  }, [depo, firma, id]);

  if (belge === undefined) return <p>Yükleniyor…</p>;
  if (belge === null) return <p className="hata">Sözleşme bulunamadı.</p>;
  const eksik = eksikBilgiler(belge.sozlesme);

  return (
    <>
      <div className="yazdirma-gizle">
        <p>
          <a className="geri-baglanti" href={`#/sozlesmeler/${id}`}>← Sözleşmeye dön</a>
        </p>
        <div className="mesaj mesaj-not">
          <p>
            <strong>İmzalamadan önce kontrol edin.</strong> Bu metin girdiğiniz bilgilerle program tarafından hazırlanan bir taslaktır; hukuki danışmanlık yerine geçmez.
          </p>
          {eksik.length > 0 && <p>{eksik.length} eksik bilgi var; metinde "…" olarak görünür.</p>}
        </div>
        <div className="dugmeler">
          <button type="button" onClick={() => window.print()}>
            Yazdır / PDF olarak kaydet
          </button>
        </div>
        <p className="soluk kucuk">PDF için yazdırma penceresinde yazıcı olarak "PDF olarak kaydet"i seçin.</p>
      </div>
      <SozlesmeBelgesiGorunumu metin={belge.metin} logo={firma.logo} taslak={!belge.sozlesme.onay} surum={belge.sozlesme.sozlesmeSurumu} />
    </>
  );
}
