import { useCallback, useEffect, useState } from 'react';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import {
  AyniAdliCariUyarisi,
  CARI_ROL_ADI,
  acilisBakiyesiAyarla,
  acilisBakiyesiGetir,
  cariGetir,
  cariGuncelle,
  cariIptal,
  cariOrtakliklari,
} from '../servisler/cari';
import { kayitGecmisiGetir, type GecmisSatiri } from '../servisler/gecmis';
import { cariBakiyesiGetir } from '../servisler/sorgular';
import type { AcilisBakiyesi, Cari, Kurus, Proje, ProjeOrtagi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import {
  AcilisAlanlari,
  AyniAdUyarisi,
  Bakiye,
  CariAlanlari,
  acilisFormu,
  acilisGirdisi,
  cariFormu,
  cariGirdisi,
  type AcilisFormu,
  type CariFormDurumu,
} from './CariFormu';
import { GecmisListesi, type AlanBicimi } from './GecmisListesi';
import { git } from './rota';

const CARI_BICIMI: AlanBicimi = {
  etiketler: { ad: 'Ad', roller: 'Roller', telefon: 'Telefon', vergiNo: 'Vergi / TC no', adres: 'Adres', not: 'Not' },
  degerYaz: (alan, d) =>
    alan === 'roller' && Array.isArray(d) ? d.map((r) => CARI_ROL_ADI[r as keyof typeof CARI_ROL_ADI]).join(', ') : undefined,
};

const ACILIS_BICIMI: AlanBicimi = {
  etiketler: { tutar: 'Tutar', tarih: 'Tarih' },
  degerYaz: (alan, d) => {
    if (alan !== 'tutar' || typeof d !== 'number') return undefined;
    return d >= 0 ? `Borcumuz ${tlYaz(d)}` : `Alacağımız ${tlYaz(-d)}`;
  },
};

interface CariBilgisi {
  cari: Cari;
  bakiye: Kurus;
  acilis: AcilisBakiyesi | null;
  ortakliklar: { ortaklik: ProjeOrtagi; proje: Proje }[];
  gecmis: GecmisSatiri[];
  acilisGecmisi: GecmisSatiri[];
}

export function CariDetay({ cariId, duzenle }: { cariId: string; duzenle: boolean }) {
  const { depo, oturum } = useUygulama();
  /** undefined: okunuyor, null: bulunamadı */
  const [bilgi, setBilgi] = useState<CariBilgisi | null | undefined>(undefined);

  const yenile = useCallback(async () => {
    const f = oturum.firmaId;
    const cari = await cariGetir(depo, f, cariId);
    if (!cari) return setBilgi(null);
    const [bakiye, acilis, ortakliklar, gecmis] = await Promise.all([
      cariBakiyesiGetir(depo, f, cariId),
      acilisBakiyesiGetir(depo, f, cariId),
      cariOrtakliklari(depo, f, cariId),
      kayitGecmisiGetir(depo, f, cariId),
    ]);
    const acilisGecmisi = acilis ? await kayitGecmisiGetir(depo, f, acilis.id) : [];
    setBilgi({
      cari,
      bakiye,
      acilis,
      ortakliklar,
      gecmis,
      acilisGecmisi,
    });
  }, [depo, oturum.firmaId, cariId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  if (bilgi === undefined) return <p>Yükleniyor…</p>;
  if (bilgi === null) return <p className="hata">Cari bulunamadı.</p>;
  if (duzenle) return <CariDuzenle cari={bilgi.cari} onKaydedildi={yenile} />;

  const { cari } = bilgi;
  return (
    <>
      <p>
        <a href="#/cariler">← Cariler</a>
      </p>
      <h1>{cari.ad}</h1>

      <section className="kart">
        <p className="bakiye-buyuk">
          <Bakiye tutar={bilgi.bakiye} />
        </p>
        <p className="soluk">Bakiye açılış bakiyesi, alışlar, hakedişler ve ödemelerden hesaplanır.</p>
      </section>

      <section className="kart">
        <div className="baslik-satiri">
          <h2>Kart bilgileri</h2>
          <a className="dugme ikincil" href={`#/cariler/${cari.id}/duzenle`}>
            Düzenle
          </a>
        </div>
        <dl className="bilgi">
          <dt>Roller</dt>
          <dd>{cari.roller.map((r) => CARI_ROL_ADI[r]).join(', ')}</dd>
          <dt>Telefon</dt>
          <dd>{cari.telefon ? <a href={`tel:${cari.telefon.replace(/[^\d+]/g, '')}`}>{cari.telefon}</a> : '—'}</dd>
          <dt>Vergi / TC no</dt>
          <dd>{cari.vergiNo ?? '—'}</dd>
          <dt>Adres</dt>
          <dd>{cari.adres ?? '—'}</dd>
          {cari.not && (
            <div className="bilgi-satir">
              <dt>Not</dt>
              <dd>{cari.not}</dd>
            </div>
          )}
        </dl>
      </section>

      <AcilisBakiyesiKarti cari={cari} acilis={bilgi.acilis} gecmis={bilgi.acilisGecmisi} onDegisti={yenile} />

      {bilgi.ortakliklar.length > 0 && (
        <section className="kart">
          <h2>Ortak olduğu projeler</h2>
          <ul className="liste">
            {bilgi.ortakliklar.map(({ ortaklik, proje }) => (
              <li key={ortaklik.id}>
                <a href={`#/projeler/${proje.id}`}>{proje.ad}</a>
                <span>%{ortaklik.oran.toLocaleString('tr-TR')}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="kart">
        <h2>Değişiklik geçmişi</h2>
        <GecmisListesi satirlar={bilgi.gecmis} bicim={CARI_BICIMI} />
      </section>

      <CariIptalKarti cari={cari} />
    </>
  );
}

// ─── Açılış bakiyesi ───────────────────────────────────────────────

function AcilisBakiyesiKarti(props: {
  cari: Cari;
  acilis: AcilisBakiyesi | null;
  gecmis: GecmisSatiri[];
  onDegisti: () => Promise<void>;
}) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [form, setForm] = useState<AcilisFormu | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);

  function kaydet(f: AcilisFormu) {
    const { acilis, hatalar } = acilisGirdisi(f);
    setHatalar(hatalar);
    if (hatalar.length > 0) return;
    const calistir = async (g?: string) => {
      await acilisBakiyesiAyarla(depo, servis, props.cari.id, acilis, g);
      setForm(null);
      await props.onDegisti();
    };
    // Yeni açılış bakiyesi girmek gerekçe istemez; var olanı değiştirmek kurala tabidir.
    if (props.acilis) void degistir(props.acilis, 'Açılış bakiyesi değişiyor', calistir);
    else void calistir().catch((e: unknown) => setHatalar([hataMetni(e)]));
  }

  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Açılış bakiyesi</h2>
        {!form && (
          <button type="button" className="ikincil" onClick={() => setForm(acilisFormu(props.acilis, yerelGun(new Date())))}>
            {props.acilis ? 'Değiştir' : 'Gir'}
          </button>
        )}
      </div>
      {!form && (
        <p>
          {props.acilis ? (
            <>
              <Bakiye tutar={props.acilis.tutar} />{' '}
              <span className="soluk">· {new Date(`${props.acilis.tarih}T00:00`).toLocaleDateString('tr-TR')}</span>
            </>
          ) : (
            <span className="soluk">Yok</span>
          )}
        </p>
      )}
      {form && (
        <>
          <AcilisAlanlari form={form} onDegisti={setForm} />
          {kutu}
          <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={() => kaydet(form)}>
              Kaydet
            </button>
            <button type="button" className="ikincil" onClick={() => setForm(null)}>
              Vazgeç
            </button>
          </div>
        </>
      )}
      {props.gecmis.length > 1 && (
        <details>
          <summary>Açılış bakiyesi geçmişi</summary>
          <GecmisListesi satirlar={props.gecmis} bicim={ACILIS_BICIMI} />
        </details>
      )}
    </section>
  );
}

// ─── İptal ─────────────────────────────────────────────────────────

function CariIptalKarti({ cari }: { cari: Cari }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [soruluyor, setSoruluyor] = useState(false);

  return (
    <section className="kart">
      <h2>Kartı iptal et</h2>
      <p className="soluk">Kayıtlar silinmez. Hareketi olmayan, yanlış açılmış kart iptal edilir; geçmişte görünmeye devam eder.</p>
      {kutu}
      <Hatalar hatalar={hata ? [hata] : []} />
      {soruluyor ? (
        <div className="mesaj mesaj-uyari" role="alertdialog" aria-labelledby="cari-iptal-baslik">
          <h3 id="cari-iptal-baslik">{cari.ad} iptal edilsin mi?</h3>
          <p>Kart listeden kalkar; açılış bakiyesi de iptal edilir.</p>
          <div className="dugmeler">
            <button
              type="button"
              className="tehlikeli"
              onClick={() => {
                setSoruluyor(false);
                void degistir(cari, `${cari.ad} iptal ediliyor`, async (g) => {
                  await cariIptal(depo, servis, cari.id, g);
                  git('cariler');
                });
              }}
            >
              Evet, iptal et
            </button>
            <button type="button" className="ikincil" onClick={() => setSoruluyor(false)}>
              Hayır
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ikincil" onClick={() => setSoruluyor(true)}>
          İptal et
        </button>
      )}
    </section>
  );
}

// ─── Düzenleme ─────────────────────────────────────────────────────

function CariDuzenle({ cari, onKaydedildi }: { cari: Cari; onKaydedildi: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [form, setForm] = useState<CariFormDurumu>(() => cariFormu(cari));
  /** Aynı adlı kart uyarısı; onaylanınca verilen gerekçeyle yeniden kaydedilir. */
  const [ayniAd, setAyniAd] = useState<{ mevcutlar: AyniAdliCariUyarisi['mevcutlar']; gerekce?: string } | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);

  async function yaz(g: string | undefined, ayniAdOnayli: boolean) {
    await cariGuncelle(depo, servis, cari.id, cariGirdisi(form), g, { ayniAdOnayli });
    await onKaydedildi();
    git(`cariler/${cari.id}`);
  }

  function kaydet() {
    setAyniAd(null);
    setHatalar([]);
    void degistir(cari, `${cari.ad} kartı değişiyor`, async (g) => {
      try {
        await yaz(g, false);
      } catch (e) {
        if (e instanceof AyniAdliCariUyarisi) setAyniAd({ mevcutlar: e.mevcutlar, gerekce: g });
        else throw e;
      }
    });
  }

  function onayla(gerekce: string | undefined) {
    setAyniAd(null);
    yaz(gerekce, true).catch((e: unknown) => setHatalar([hataMetni(e)]));
  }

  return (
    <>
      <p>
        <a href={`#/cariler/${cari.id}`}>← {cari.ad}</a>
      </p>
      <h1>Cari kartını düzenle</h1>
      <section className="kart">
        <CariAlanlari
          form={form}
          onDegisti={(f) => {
            setAyniAd(null);
            setForm(f);
          }}
        />
        {kutu}
        <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
        {ayniAd && (
          <AyniAdUyarisi mevcutlar={ayniAd.mevcutlar} onOnayla={() => onayla(ayniAd.gerekce)} onVazgec={() => setAyniAd(null)} />
        )}
        <div className="dugmeler">
          <button type="button" onClick={kaydet}>
            Kaydet
          </button>
          <button type="button" className="ikincil" onClick={() => git(`cariler/${cari.id}`)}>
            Vazgeç
          </button>
        </div>
      </section>
    </>
  );
}
