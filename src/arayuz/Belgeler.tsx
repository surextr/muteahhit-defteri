import { useCallback, useEffect, useState } from 'react';
import { cihaz } from '../cihaz';
import { yerelGun } from '../hesap/tarih';
import {
  BELGE_KABUL,
  BELGE_TUR_ADI,
  belgeDetayiGetir,
  belgeDosyasiGetir,
  belgeEkle,
  belgeGuncelle,
  belgeIptal,
  belgeleriListele,
  tumBelgeler,
  type BelgeBagi,
  type BelgeOzeti,
} from '../servisler/belge';
import type { Belge } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { git } from './rota';

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const boyutYaz = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} MB`);

/** Seçilen dosya: fotoğraf küçültülmüş, eklenmeye hazır. */
export interface HazirDosya {
  dosya: Blob;
  ad: string;
}

/** Fotoğrafları cihazda küçültür; PDF olduğu gibi kalır. */
async function hazirla(dosyalar: File[]): Promise<HazirDosya[]> {
  return Promise.all(dosyalar.map(async (d) => ({ dosya: await cihaz.resimKucult(d), ad: d.name })));
}

const fotografAdi = () => `Fotoğraf ${new Date().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}`;

/** "Fotoğraf çek" ve "Dosya ekle" düğmeleri; seçilenleri küçültüp verir. */
export function BelgeSecici(props: { onSecildi: (d: HazirDosya[]) => Promise<void> | void; mesgul?: boolean }) {
  const [hazirlaniyor, setHazirlaniyor] = useState(false);
  async function al(kaynak: () => Promise<File[]>) {
    const dosyalar = await kaynak();
    if (dosyalar.length === 0) return;
    setHazirlaniyor(true);
    try {
      await props.onSecildi(await hazirla(dosyalar));
    } finally {
      setHazirlaniyor(false);
    }
  }
  const mesgul = hazirlaniyor || props.mesgul;
  // Kameradan gelen dosyanın adı çoğu zaman "image.jpg"dir; okunur bir ad verilir.
  const fotograf = async () => {
    const f = await cihaz.fotografCek();
    return f ? [new File([f], `${fotografAdi()}.jpg`, { type: f.type })] : [];
  };
  return (
    <div className="dugmeler">
      <button type="button" className="ikincil" disabled={mesgul} onClick={() => void al(fotograf)}>
        📷 Fotoğraf çek
      </button>
      <button type="button" className="ikincil" disabled={mesgul} onClick={() => void al(() => cihaz.dosyalarSec(BELGE_KABUL))}>
        Dosya ekle
      </button>
      {hazirlaniyor && <span className="soluk">Hazırlanıyor…</span>}
    </div>
  );
}

/** Belgenin küçük resmi; PDF için simge. */
function KucukResim({ belge }: { belge: Belge }) {
  const { depo, oturum } = useUygulama();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!belge.mime.startsWith('image/')) return;
    let adres: string | null = null;
    let iptal = false;
    void belgeDosyasiGetir(depo, oturum.firmaId, belge.id).then((d) => {
      if (!d || iptal) return;
      adres = URL.createObjectURL(d);
      setUrl(adres);
    });
    return () => {
      iptal = true;
      if (adres) URL.revokeObjectURL(adres);
    };
  }, [belge.id, belge.mime, depo, oturum.firmaId]);
  if (url) return <img className="belge-kucuk" src={url} alt="" />;
  return <span className="belge-kucuk belge-simge">{belge.mime === 'application/pdf' ? 'PDF' : '…'}</span>;
}

/** Kayda bağlı belgeler: küçük resimler ve ekleme. */
export function BelgelerKarti(props: { bagliTur: BelgeBagi; bagliId: string; varsayilanTur: Belge['tur']; baslik?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [belgeler, setBelgeler] = useState<Belge[] | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [ekleniyor, setEkleniyor] = useState(false);

  const yenile = useCallback(async () => {
    setBelgeler(await belgeleriListele(depo, oturum.firmaId, props.bagliTur, props.bagliId));
  }, [depo, oturum.firmaId, props.bagliTur, props.bagliId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  async function ekle(dosyalar: HazirDosya[]) {
    setHatalar([]);
    setEkleniyor(true);
    const yeni: string[] = [];
    for (const d of dosyalar) {
      try {
        await belgeEkle(depo, servis, {
          bagliTur: props.bagliTur,
          bagliId: props.bagliId,
          tur: d.dosya.type === 'application/pdf' && props.varsayilanTur === 'fotograf' ? 'diger' : props.varsayilanTur,
          tarih: yerelGun(new Date()),
          ad: d.ad,
          dosya: d.dosya,
        });
      } catch (e) {
        yeni.push(`${d.ad}: ${hataMetni(e)}`);
      }
    }
    setHatalar(yeni);
    setEkleniyor(false);
    await yenile();
  }

  return (
    <section className="kart">
      <h2>{props.baslik ?? 'Belgeler'}</h2>
      {belgeler && belgeler.length === 0 && <p className="soluk">Henüz belge yok. Fiş, fatura ya da dekontun fotoğrafını ekleyin.</p>}
      {belgeler && belgeler.length > 0 && (
        <ul className="belge-izgarasi">
          {belgeler.map((b) => (
            <li key={b.id}>
              <a href={`#/belgeler/${b.id}`}>
                <KucukResim belge={b} />
                <span className="belge-adi">{b.ad}</span>
                <span className="soluk">{BELGE_TUR_ADI[b.tur]}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <Hatalar hatalar={hatalar} />
      <BelgeSecici onSecildi={ekle} mesgul={ekleniyor} />
      {ekleniyor && <p className="soluk">Kaydediliyor…</p>}
    </section>
  );
}

/** Kaydı henüz oluşmamış form için: seçilen dosyalar bekletilir, kayıttan sonra eklenir. */
export function BekleyenBelgeler(props: { dosyalar: HazirDosya[]; onDegisti: (d: HazirDosya[]) => void }) {
  return (
    <div className="alan">
      <span className="alan-etiket">Fiş / fatura fotoğrafı</span>
      {props.dosyalar.length > 0 && (
        <ul className="liste">
          {props.dosyalar.map((d, i) => (
            <li key={`${d.ad}-${i}`}>
              <span>
                {d.ad} <span className="soluk">· {boyutYaz(d.dosya.size)}</span>
              </span>
              <button type="button" className="baglanti-dugmesi" onClick={() => props.onDegisti(props.dosyalar.filter((_, j) => j !== i))}>
                Çıkar
              </button>
            </li>
          ))}
        </ul>
      )}
      <BelgeSecici onSecildi={(yeni) => props.onDegisti([...props.dosyalar, ...yeni])} />
      {props.dosyalar.length > 0 && <p className="mesaj-not">Gider kaydedilince eklenir; o zamana kadar taslakla birlikte bu cihazda saklanır.</p>}
    </div>
  );
}

// ─── Belge gösterici ───────────────────────────────────────────────

export function BelgeGoster({ belgeId }: { belgeId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  /** undefined: okunuyor, null: bulunamadı */
  const [ozet, setOzet] = useState<BelgeOzeti | null | undefined>(undefined);
  const [dosya, setDosya] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [form, setForm] = useState<{ ad: string; tur: Belge['tur'] } | null>(null);
  const [iptalSoruluyor, setIptalSoruluyor] = useState(false);

  const yenile = useCallback(async () => {
    const o = await belgeDetayiGetir(depo, oturum.firmaId, belgeId);
    setOzet(o);
    setForm(null);
    if (o) setDosya(await belgeDosyasiGetir(depo, oturum.firmaId, belgeId));
  }, [depo, oturum.firmaId, belgeId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  useEffect(() => {
    if (!dosya || !dosya.type.startsWith('image/')) return setUrl(null);
    const adres = URL.createObjectURL(dosya);
    setUrl(adres);
    return () => URL.revokeObjectURL(adres);
  }, [dosya]);

  if (ozet === undefined) return <p>Yükleniyor…</p>;
  if (ozet === null) return <p className="hata">Belge bulunamadı ya da iptal edilmiş.</p>;
  const { belge } = ozet;
  const uzanti = belge.mime === 'application/pdf' ? '.pdf' : belge.mime === 'image/png' ? '.png' : '.jpg';
  const dosyaAdi = /\.[a-z0-9]{2,4}$/i.test(belge.ad) ? belge.ad : `${belge.ad}${uzanti}`;

  return (
    <>
      <p>{ozet.yol ? <a href={`#/${ozet.yol}`}>← {ozet.bagliAdi}</a> : <a href="#/belgeler">← Belgeler</a>}</p>
      <h1>{belge.ad}</h1>
      <p className="soluk">
        {BELGE_TUR_ADI[belge.tur]} · {tarihYaz(belge.tarih)} · {boyutYaz(belge.boyut)}
      </p>
      {url && <img className="belge-buyuk" src={url} alt={belge.ad} />}
      {dosya && !url && (
        <section className="kart">
          <p>Bu belge {belge.mime === 'application/pdf' ? 'PDF' : 'resim'} dosyası; cihazın göstericisinde açılır.</p>
        </section>
      )}
      {!dosya && <p className="hata">Dosya bu cihazda bulunamadı.</p>}
      <div className="dugmeler">
        {dosya && (
          <>
            <button type="button" onClick={() => cihaz.dosyaAc(dosya, dosyaAdi)}>
              Aç
            </button>
            <button type="button" className="ikincil" onClick={() => void cihaz.dosyaKaydet(dosya, dosyaAdi)}>
              İndir
            </button>
          </>
        )}
      </div>

      <section className="kart">
        <div className="baslik-satiri">
          <h2>Belge bilgisi</h2>
          {!form && (
            <button type="button" className="ikincil" onClick={() => setForm({ ad: belge.ad, tur: belge.tur })}>
              Düzenle
            </button>
          )}
        </div>
        <p>
          Bağlı kayıt: {ozet.yol ? <a href={`#/${ozet.yol}`}>{ozet.bagliAdi}</a> : ozet.bagliAdi}
        </p>
        {form && (
          <>
            <div className="iki-sutun">
              <Alan etiket="Ad">
                <input value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} />
              </Alan>
              <Alan etiket="Tür">
                <select value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value as Belge['tur'] })}>
                  {(Object.keys(BELGE_TUR_ADI) as Belge['tur'][]).map((t) => (
                    <option key={t} value={t}>
                      {BELGE_TUR_ADI[t]}
                    </option>
                  ))}
                </select>
              </Alan>
            </div>
            <div className="dugmeler">
              <button
                type="button"
                onClick={() =>
                  void degistir(belge, 'Belge değişiyor', async (g) => {
                    await belgeGuncelle(servis, belge.id, form, g);
                    await yenile();
                  })
                }
              >
                Kaydet
              </button>
              <button type="button" className="ikincil" onClick={() => setForm(null)}>
                Vazgeç
              </button>
            </div>
          </>
        )}
        {kutu}
        <Hatalar hatalar={hata ? [hata] : []} />
        {iptalSoruluyor ? (
          <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="İptal onayı">
            <p>Belge iptal edilsin mi? Listeden kalkar; kayıt ve dosyası geçmişte (yedekte) kalır.</p>
            <div className="dugmeler">
              <button
                type="button"
                className="tehlikeli"
                onClick={() => {
                  setIptalSoruluyor(false);
                  void degistir(belge, 'Belge iptal ediliyor', async (g) => {
                    await belgeIptal(servis, belge.id, g);
                    git(ozet.yol ?? 'belgeler');
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
            Belgeyi iptal et
          </button>
        )}
      </section>
    </>
  );
}

// ─── Bütün belgeler ────────────────────────────────────────────────

export function BelgelerEkrani() {
  const { depo, oturum } = useUygulama();
  const [tur, setTur] = useState<Belge['tur'] | null>(null);
  const [belgeler, setBelgeler] = useState<BelgeOzeti[] | null>(null);

  useEffect(() => {
    setBelgeler(null);
    void tumBelgeler(depo, oturum.firmaId, tur ?? undefined).then(setBelgeler);
  }, [depo, oturum.firmaId, tur]);

  return (
    <>
      <h1>Belgeler</h1>
      <p className="soluk">Belgeler kaydın kendi ekranından eklenir: gider, ödeme, çek, proje, daire, cari.</p>
      <div className="filtreler" role="group" aria-label="Türe göre süz">
        <button type="button" aria-pressed={tur === null} onClick={() => setTur(null)}>
          Tümü
        </button>
        {(Object.keys(BELGE_TUR_ADI) as Belge['tur'][]).map((t) => (
          <button key={t} type="button" aria-pressed={tur === t} onClick={() => setTur(t)}>
            {BELGE_TUR_ADI[t]}
          </button>
        ))}
      </div>
      {belgeler === null && <p>Yükleniyor…</p>}
      {belgeler?.length === 0 && <p className="soluk">Belge yok.</p>}
      <ul className="kart-listesi">
        {belgeler?.map(({ belge, bagliAdi }) => (
          <li key={belge.id}>
            <a className="kart kart-baglanti belge-satiri" href={`#/belgeler/${belge.id}`}>
              <KucukResim belge={belge} />
              <span>
                <strong>{belge.ad}</strong>
                <span className="soluk blok">
                  {BELGE_TUR_ADI[belge.tur]} · {tarihYaz(belge.tarih)}
                </span>
                <span className="soluk blok">{bagliAdi}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}
