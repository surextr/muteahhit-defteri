import { useCallback, useEffect, useMemo, useState } from 'react';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import { eksikBilgiler, kalemTutari, sozlesmeToplami, sozlesmeUyarilari, type SozlesmeIcerigi, type SozlesmeMetni } from '../hesap/ustaSozlesmesi';
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
import { hazirUstaTipleriniEkle, ustaTipleriListele } from '../servisler/ustaTipi';
import { projeGetir } from '../servisler/proje';
import { YAPRAK_KALEM_KODLARI } from '../veri/sabit/hazirKalemKodlari';
import { HAKEDIS_SEKLI_ADI } from '../veri/sabit/hazirUstaTipleri';
import type { Cari, HakedisSekli, Proje, SorumlulukCevabi, UstaSozlesmesi, UstaTipi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { BelgelerKarti } from './Belgeler';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { CariSecici } from './CariSecici';
import { TutarGirdisi } from './Girdiler';
import { git } from './rota';
import { OzelSartDuzenleyici } from './YapayZeka';

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
      {liste === null ? (
        <p>Yükleniyor…</p>
      ) : liste.length === 0 ? (
        <p className="soluk">Henüz sözleşme yok. Usta tipini seçin; kalemler, sorumluluk soruları ve şartlar hazır gelir.</p>
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
  const [tipId, setTipId] = useState('');
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
      const s = await ustaSozlesmesiOlustur(depo, servis, firma, { projeId, ustaTipiId: tipId, cariId: cariId ?? '' });
      git(`sozlesmeler/${s.id}`);
    } catch (e) {
      setHata(hataMetni(e));
      setIslemde(false);
    }
  }

  if (proje === undefined) return <p>Yükleniyor…</p>;
  if (proje === null) return <p className="hata">Proje bulunamadı.</p>;
  const tip = tipler.find((t) => t.id === tipId);

  return (
    <>
      <p>
        <a href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <h1>Yeni usta sözleşmesi</h1>
      <section className="kart">
        <Alan etiket="Usta tipi" aciklama="Kalemler, sorumluluk soruları ve şartlar bu tipten kopyalanır. Tipleri Ayarlar › Usta tipleri'nden düzenleyebilirsiniz.">
          <select value={tipId} onChange={(e) => setTipId(e.target.value)}>
            <option value="">Seçin</option>
            {tipler.map((t) => (
              <option key={t.id} value={t.id}>
                {t.ad}
              </option>
            ))}
          </select>
        </Alan>
        {tip && (
          <p className="soluk kucuk">
            {tip.kalemler.length} kalem · {tip.sorular.length} sorumluluk sorusu · {HAKEDIS_SEKLI_ADI[tip.hakedisSekli]}
          </p>
        )}
        <div className="alan">
          <span className="alan-etiket">Usta (cari)</span>
          <CariSecici
            cariler={cariler}
            secili={cariId}
            onSec={setCariId}
            oncelikli={['usta']}
            hizliEkle={{ rol: 'usta', onEklendi: (c) => setCariler((l) => [...l, { cari: c, bakiye: 0 }]) }}
          />
        </div>
        {hata && <Hatalar hatalar={[hata]} />}
        <div className="dugmeler">
          <button type="button" disabled={!tipId || !cariId || islemde} onClick={() => void olustur()}>
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
  ad: string;
  birim: string;
  aciklama: string;
  miktar: string;
  fiyat: string;
  butceKalemiKodu: string | null;
}
type Form = Omit<SozlesmeIcerigi, 'kalemler'> & { kalemler: FormKalemi[] };

const formaCevir = (g: SozlesmeIcerigi): Form => ({
  ...g,
  kalemler: g.kalemler.map((k) => ({
    ad: k.ad,
    birim: k.birim,
    aciklama: k.aciklama,
    miktar: sayiYaz(k.miktar),
    fiyat: k.birimFiyat > 0 ? tutarMetni(k.birimFiyat) : '',
    butceKalemiKodu: k.butceKalemiKodu,
  })),
});

/** Formdan içerik; okunamayan sayılar ayrıca hata olarak döner. */
function formdanIcerik(f: Form): { icerik: SozlesmeIcerigi; hatalar: string[] } {
  const hatalar: string[] = [];
  const kalemler = f.kalemler.map((k) => {
    const miktar = k.miktar.trim() ? sayiOku(k.miktar) : null;
    const fiyat = k.fiyat.trim() ? tlOku(k.fiyat) : 0;
    if (k.miktar.trim() && miktar === null) hatalar.push(`"${k.ad || 'Adsız'}" kaleminin miktarı okunamadı (örn. 1.250,5).`);
    if (k.fiyat.trim() && fiyat === null) hatalar.push(`"${k.ad || 'Adsız'}" kaleminin birim fiyatı okunamadı.`);
    return { ad: k.ad, birim: k.birim, aciklama: k.aciklama, miktar, birimFiyat: fiyat ?? 0, butceKalemiKodu: k.butceKalemiKodu };
  });
  return { icerik: { ...f, kalemler }, hatalar };
}

export function UstaSozlesmesiEkrani({ id }: { id: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [s, setS] = useState<UstaSozlesmesi | null | undefined>(undefined);
  const [proje, setProje] = useState<Proje | null>(null);
  const [cari, setCari] = useState<Cari | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
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
        <a href={`#/projeler/${s.projeId}`}>← {proje?.ad ?? 'Proje'}</a>
      </p>
      <div className="baslik-satiri">
        <h1>{cari?.ad ?? 'Usta'}</h1>
        <SozlesmeDurumu s={s} />
      </div>
      <p className="soluk">
        {s.ustaTipiAdi} · şablon sürümü {s.sablonSurumu}
      </p>
      {s.onay && <p className="mesaj mesaj-not">Bu sözleşme imzalandı ({tarihYaz(yerelGun(new Date(s.onay.zaman)))}). Değişiklik gerekçe ister ve sürüm numarası artar.</p>}

      <EksikBilgiler eksik={eksik} uyarilar={uyarilar} />

      <section className="kart">
        <h2>Tarihler ve ödeme</h2>
        <div className="iki-sutun">
          <Alan etiket="Sözleşme tarihi">
            <input type="date" value={form.sozlesmeTarihi ?? ''} onChange={(e) => yaz('sozlesmeTarihi', e.target.value || null)} />
          </Alan>
          <Alan etiket="Hakediş şekli">
            <select value={form.hakedisSekli} onChange={(e) => yaz('hakedisSekli', e.target.value as HakedisSekli)}>
              {Object.entries(HAKEDIS_SEKLI_ADI).map(([k, ad]) => (
                <option key={k} value={k}>
                  {ad}
                </option>
              ))}
            </select>
          </Alan>
          <Alan etiket="İşe başlama">
            <input type="date" value={form.baslamaTarihi ?? ''} onChange={(e) => yaz('baslamaTarihi', e.target.value || null)} />
          </Alan>
          <Alan etiket="Bitiş (teslim)">
            <input type="date" value={form.bitisTarihi ?? ''} onChange={(e) => yaz('bitisTarihi', e.target.value || null)} />
          </Alan>
        </div>
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
        {form.kalemler.map((k, i) => {
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
                  {YAPRAK_KALEM_KODLARI.map((b) => (
                    <option key={b.kod} value={b.kod}>
                      {b.ad}
                    </option>
                  ))}
                </select>
              </details>
            </div>
          );
        })}
        <button
          type="button"
          className="baglanti-dugmesi"
          onClick={() => yaz('kalemler', [...form.kalemler, { ad: '', birim: form.fiyatlamaBirimi, aciklama: '', miktar: '', fiyat: '', butceKalemiKodu: form.kalemler[0]?.butceKalemiKodu ?? null }])}
        >
          + Kalem ekle
        </button>
        <p className="toplam-satiri">
          <span>{eksikMiktar ? 'Miktarı yazılı kalemlerin toplamı' : 'Tahmini toplam'}</span>
          <strong>{tlYaz(toplam)}</strong>
        </p>
      </section>

      {form.sorumluluklar.length > 0 && (
        <section className="kart">
          <h2>Malzeme ve sorumluluklar</h2>
          {form.sorumluluklar.map((r, i) => (
            <fieldset key={i} className={`sorumluluk${r.cevap === null ? ' cevapsiz' : ''}`}>
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
        <OzelSartDuzenleyici ustaTipi={s.ustaTipiAdi} metin={form.ozelSartlar} onDegisti={(m) => yaz('ozelSartlar', m)} />
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

      <OnayVeIptal s={s} degisti={degisti} eksikVar={eksik.length > 0} onDegisti={yukle} />

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

function OnayVeIptal(props: { s: UstaSozlesmesi; degisti: boolean; eksikVar: boolean; onDegisti: () => Promise<void> }) {
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
          {onayHatasi && <Hatalar hatalar={[onayHatasi]} />}
          <div className="dugmeler">
            <button type="button" disabled={props.eksikVar || props.degisti} onClick={() => void onayla()}>
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
              await ustaSozlesmesiIptal(servis, s.id, gerekce);
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
          <a href={`#/sozlesmeler/${id}`}>← Sözleşmeyi düzenle</a>
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

export function SozlesmeBelgesiGorunumu(props: { metin: SozlesmeMetni; logo: string | null; taslak: boolean; surum: number }) {
  const { metin: m } = props;
  return (
    <article className="sozlesme-belgesi">
      <header className="sb-baslik">
        {props.logo && <img src={props.logo} alt="" className="sb-logo" />}
        <div>
          <h1>{m.baslik}</h1>
          <p className="sb-alt-baslik">{m.altBaslik}</p>
        </div>
        {props.taslak ? <span className="sb-damga">TASLAK</span> : props.surum > 1 && <span className="sb-surum">Sürüm {props.surum}</span>}
      </header>

      <section className="sb-taraflar">
        {m.taraflar.map((t) => (
          <div key={t.rol}>
            <h2>{t.rol}</h2>
            <p>
              <strong>{t.ad}</strong>
            </p>
            {t.satirlar.map((x) => (
              <p key={x}>{x}</p>
            ))}
          </div>
        ))}
      </section>

      <ol className="sb-maddeler">
        {m.maddeler.map((md) => (
          <li key={md.baslik}>
            <h2>{md.baslik}</h2>
            {md.paragraflar.map((p) => (
              <p key={p}>{p}</p>
            ))}
            {md.tablo && (
              <table className="sb-tablo">
                <thead>
                  <tr>
                    {md.tablo.basliklar.map((b) => (
                      <th key={b}>{b}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {md.tablo.satirlar.map((r, i) => (
                    <tr key={i}>
                      {r.map((h, j) => (
                        <td key={j}>{h}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                {md.tablo.alt && (
                  <tfoot>
                    <tr>
                      <td colSpan={md.tablo.basliklar.length - 1}>{md.tablo.alt[0]}</td>
                      <td>{md.tablo.alt[md.tablo.alt.length - 1]}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            )}
            {md.liste && (
              <ol className="sb-alt-liste">
                {md.liste.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ol>

      <section className="sb-imzalar">
        {m.imzalar.map((i) => (
          <div key={i.rol}>
            <h2>{i.rol}</h2>
            <p>{i.ad}</p>
            <p className="sb-imza-cizgisi">İmza</p>
          </div>
        ))}
      </section>
      <p className="sb-tarih">Tarih: {m.imzaTarihi}</p>
    </article>
  );
}
