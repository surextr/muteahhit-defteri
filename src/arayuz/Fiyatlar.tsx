import { useCallback, useEffect, useMemo, useState } from 'react';
import { ARASTIRMA_PAKETI, fiyatlariArastir } from '../bulut/fiyatArastir';
import { FIYAT_KAYNAGI_ADI, fiyatDurumu, gunFarki, type FiyatOnerisi } from '../hesap/fiyat';
import { KDV_ORANLARI } from '../hesap/gider';
import { aramaUyar } from '../hesap/metin';
import { tlOku, tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import {
  arastirilacakIsaretle,
  arastirmaKaydet,
  fiyatGir,
  fiyatiKaldir,
  fiyatKalemiEkle,
  fiyatKalemiGuncelle,
  fiyatKalemiIptal,
  fiyatKalemleri,
  fiyatOnerileri,
  hazirFiyatKalemleriniEkle,
  type FiyatKalemiGirdisi,
} from '../servisler/fiyat';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import { projeleriListele } from '../servisler/proje';
import { FIYAT_KALEMI_TURU_ADI, HAZIR_FIYAT_KALEMLERI, type FiyatKalemiTuru } from '../veri/sabit/hazirFiyatKalemleri';
import { HAZIR_KALEM_KODU } from '../veri/sabit/hazirKalemKodlari';
import type { FiyatKaynagi, FiyatKalemi, Tarih } from '../veri/tipler';
import { AktarmaDugmeleri } from './Aktarma';
import { useUygulama } from './baglam';
import { Alan, BosDurum, Hatalar, hataMetni } from './bilesenler';
import { TutarGirdisi } from './Girdiler';
import { HesapGirisi, useHesap } from './HesapGirisi';

// Maliyet hesabı: malzeme / işçilik / makine fiyat kataloğu. Her kalem ayrı fiyatlanır; fiyatın kaynağı ve tarihi görünür.

const tarihYaz = (t: string | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '—');
const tlMetni = (k: number) => tlYaz(k).replace(/\s*₺\s*/g, '');
const KAYNAK_SIMGESI: Record<FiyatKaynagi, string> = { elle: '✍️', arastirma: '🔎', yz: '🤖', sonAlis: '🧾', sonSozlesme: '🧾' };

/** Bütçe kalemi kodu → ad ("Kaba inşaat › Beton" → "Beton"). */
const BUTCE_KALEMI_ADI = new Map(Object.entries(HAZIR_KALEM_KODU).map(([ad, kod]) => [kod, ad.split(' › ').at(-1)!]));
const BUTCE_SIRASI = new Map(Object.values(HAZIR_KALEM_KODU).map((kod, i) => [kod, i]));
/** Grup içinde hazır listenin sırası; firmanın eklediği kalemler sonda, ada göre. */
const HAZIR_SIRA = new Map(HAZIR_FIYAT_KALEMLERI.map((h, i) => [h.kod, i]));
const kalemSirasi = (a: FiyatKalemi, b: FiyatKalemi) =>
  (HAZIR_SIRA.get(a.sistemKodu ?? '') ?? 1e6) - (HAZIR_SIRA.get(b.sistemKodu ?? '') ?? 1e6) || a.ad.localeCompare(b.ad, 'tr');
const grupAdi = (kod: string | null) => (kod ? (BUTCE_KALEMI_ADI.get(kod) ?? 'Diğer') : 'Diğer');

type Durum = 'hepsi' | 'yok' | 'eski' | 'arastirilacak' | 'oneri';
const DURUMLAR: { kod: Durum; ad: string }[] = [
  { kod: 'hepsi', ad: 'Tümü' },
  { kod: 'yok', ad: 'Fiyatsız' },
  { kod: 'eski', ad: '3 aydan eski' },
  { kod: 'arastirilacak', ad: 'Araştırılacaklar' },
  { kod: 'oneri', ad: 'Önerisi var' },
];

interface Katalog {
  kalemler: FiyatKalemi[];
  oneriler: Map<string, FiyatOnerisi>;
}

function useKatalog(): [Katalog | null, () => Promise<void>, string | null] {
  const { depo, oturum, servis } = useUygulama();
  const [k, setK] = useState<Katalog | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const yenile = useCallback(async () => {
    try {
      const kalemler = await fiyatKalemleri(depo, oturum.firmaId);
      setK({ kalemler, oneriler: await fiyatOnerileri(depo, oturum.firmaId, kalemler) });
    } catch (e) {
      setHata(hataMetni(e));
    }
  }, [depo, oturum.firmaId]);
  useEffect(() => {
    void hazirFiyatKalemleriniEkle(depo, servis)
      .catch(() => 0)
      .then(yenile);
  }, [depo, servis, yenile]);
  return [k, yenile, hata];
}

// ─── Maliyet giriş ekranı ──────────────────────────────────────────

export function MaliyetEkrani() {
  const [k] = useKatalog();
  const bugun = yerelGun(new Date());
  const sayi = (f: (x: FiyatKalemi) => boolean) => k?.kalemler.filter(f).length ?? 0;
  return (
    <>
      <h1>Maliyet hesabı</h1>
      <section className="kart">
        <div className="baslik-satiri">
          <h2>Malzeme ve işçilik fiyatları</h2>
          <a className="dugme" href="#/maliyet/fiyatlar">
            Fiyatları aç
          </a>
        </div>
        <p className="soluk">Malzeme, işçilik ve makine kalemleri ayrı ayrı fiyatlanır; her fiyatın kaynağı ve tarihi yazılır.</p>
        {k ? (
          <div className="ozet-satiri">
            <span>{k.kalemler.length} kalem</span>
            <span>✔ {sayi((x) => fiyatDurumu(x, bugun) === 'guncel')} fiyatlı</span>
            <span>⚠ {sayi((x) => fiyatDurumu(x, bugun) === 'eski')} eski</span>
            <span>— {sayi((x) => x.fiyat === null)} fiyatsız</span>
            <span>🔎 {sayi((x) => x.arastirilacak)} araştırılacak</span>
          </div>
        ) : (
          <p>Yükleniyor…</p>
        )}
      </section>
      <section className="kart">
        <h2>Maliyet hesapları</h2>
        <p className="soluk">
          Sıradaki adım: binanın bilgilerinden malzeme ve işçilik miktarları çıkarılacak, elle eklenen satırlar dayanağıyla işaretlenecek ve bu fiyatlarla
          malzeme, işçilik ve makine toplamları ayrı ayrı hesaplanacak.
        </p>
      </section>
    </>
  );
}

// ─── Fiyat kataloğu ────────────────────────────────────────────────

export function FiyatlarEkrani() {
  const { depo, oturum, servis } = useUygulama();
  const [katalog, yenile, yuklemeHatasi] = useKatalog();
  const [tur, setTur] = useState<FiyatKalemiTuru>('malzeme');
  const [durum, setDurum] = useState<Durum>('hepsi');
  const [arama, setArama] = useState('');
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [acik, setAcik] = useState<string | null>(null);
  const [yeni, setYeni] = useState(false);
  const [yazabilir, setYazabilir] = useState(true);
  const [eposta, setEposta] = useHesap();
  const [yz, setYz] = useState<{ durum: string; hata: string | null; calisiyor: boolean } | null>(null);
  const [il, setIl] = useState<string | null>(null);
  const bugun = yerelGun(new Date());

  useEffect(() => {
    void servis.yazabilir('fiyatKalemi').then(setYazabilir);
    // Araştırmada il: en son projenin ili.
    void projeleriListele(depo, oturum.firmaId).then((l) => setIl(l.map((p) => p.proje).filter((p) => p.il).sort((a, b) => b.olusturmaZamani.localeCompare(a.olusturmaZamani))[0]?.il ?? null));
  }, [depo, oturum.firmaId, servis]);

  const gorunen = useMemo(() => {
    if (!katalog) return [];
    return katalog.kalemler
      .filter((k) => k.tur === tur)
      .filter((k) => {
        if (durum === 'yok') return k.fiyat === null;
        if (durum === 'eski') return fiyatDurumu(k, bugun) === 'eski';
        if (durum === 'arastirilacak') return k.arastirilacak;
        if (durum === 'oneri') return katalog.oneriler.has(k.id) || !!k.arastirma?.onerilen;
        return true;
      })
      .filter((k) => !arama.trim() || aramaUyar(`${k.ad} ${k.aciklama} ${grupAdi(k.butceKalemiKodu)}`, arama))
      .sort(kalemSirasi);
  }, [katalog, tur, durum, arama, bugun]);

  const gruplar = useMemo(() => {
    const m = new Map<string, FiyatKalemi[]>();
    for (const k of gorunen) {
      const ad = grupAdi(k.butceKalemiKodu);
      m.set(ad, [...(m.get(ad) ?? []), k]);
    }
    const sira = (l: FiyatKalemi[]) => BUTCE_SIRASI.get(l[0]!.butceKalemiKodu ?? '') ?? 9999;
    return [...m.entries()].sort((a, b) => sira(a[1]) - sira(b[1]));
  }, [gorunen]);

  if (yuklemeHatasi) return <p className="hata">{yuklemeHatasi}</p>;
  if (!katalog) return <p>Yükleniyor…</p>;

  const turSayisi = (t: FiyatKalemiTuru) => katalog.kalemler.filter((k) => k.tur === t).length;
  const seciliKalemler = katalog.kalemler.filter((k) => secili.has(k.id));
  const sec = (id: string, d: boolean) =>
    setSecili((s) => {
      const y = new Set(s);
      if (d) y.add(id);
      else y.delete(id);
      return y;
    });

  const yzArastir = async () => {
    const liste = seciliKalemler;
    setYz({ durum: 'Araştırılıyor…', hata: null, calisiyor: true });
    let biten = 0;
    let kalanHak: number | null = null;
    try {
      for (let i = 0; i < liste.length; i += ARASTIRMA_PAKETI) {
        const paket = liste.slice(i, i + ARASTIRMA_PAKETI);
        setYz({ durum: `Araştırılıyor: ${biten + 1}–${biten + paket.length} / ${liste.length} (her paket birkaç dakika sürebilir)`, hata: null, calisiyor: true });
        const y = await fiyatlariArastir(paket, il, bugun);
        await arastirmaKaydet(depo, servis, y.sonuclar);
        kalanHak = y.kalanHak;
        biten += paket.length;
        await yenile();
      }
      setSecili(new Set());
      setDurum('oneri');
      setYz({ durum: `${biten} kalem araştırıldı. Önerilen fiyatı kaynaklarına bakarak onaylayın.${kalanHak !== null ? ` Bugün kalan hak: ${kalanHak}.` : ''}`, hata: null, calisiyor: false });
    } catch (e) {
      setYz({ durum: biten ? `${biten} kalem araştırıldı.` : '', hata: hataMetni(e), calisiyor: false });
    }
  };

  return (
    <>
      <p>
        <a className="geri-baglanti" href="#/maliyet">← Maliyet hesabı</a>
      </p>
      <h1>Malzeme ve işçilik fiyatları</h1>
      <div className="dugmeler fiyat-ust-dugmeler">
        {yazabilir && (
          <button type="button" className="ikincil" onClick={() => setYeni((x) => !x)}>
            + Kalem ekle
          </button>
        )}
        <AktarmaDugmeleri dosyaAdi="Fiyat listesi" sayfalar={() => excelSayfalari(katalog, bugun)} yazdir={false} />
      </div>
      <p className="mesaj-not">
        Fiyatlar KDV hariç ve kalemin birimi başınadır. ✍️ bildiğiniz fiyat, 🔎 kendi araştırmanız, 🤖 yapay zekânın araştırdığı, 🧾 programdaki son alış ya da imzalı
        sözleşme. 3 aydan eski fiyatlar ⚠ ile işaretlenir.
      </p>

      {yeni && (
        <KalemFormu
          baslik="Yeni kalem"
          ilk={{ tur, ad: '', birim: '', butceKalemiKodu: null, aciklama: '', kdvOrani: tur === 'iscilik' ? 0 : 20 }}
          onKaydet={async (g) => {
            await fiyatKalemiEkle(depo, servis, g);
            setYeni(false);
            setTur(g.tur);
            await yenile();
          }}
          onVazgec={() => setYeni(false)}
        />
      )}

      <div className="filtreler" role="group" aria-label="Kalem türü">
        {(['malzeme', 'iscilik', 'makine'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={tur === t} onClick={() => setTur(t)}>
            {FIYAT_KALEMI_TURU_ADI[t]} ({turSayisi(t)})
          </button>
        ))}
      </div>
      <div className="filtreler" role="group" aria-label="Fiyat durumu">
        {DURUMLAR.map((d) => (
          <button key={d.kod} type="button" aria-pressed={durum === d.kod} onClick={() => setDurum(d.kod)}>
            {d.ad}
          </button>
        ))}
      </div>
      <input className="fiyat-ara" type="search" placeholder="Kalem ara…" value={arama} onChange={(e) => setArama(e.target.value)} aria-label="Kalem ara" />

      {yazabilir && (
        <section className="kart fiyat-arac-cubugu">
          <div className="dugmeler">
            <button type="button" className="ikincil" disabled={!gorunen.length} onClick={() => setSecili(new Set(gorunen.filter((k) => k.fiyat === null || k.arastirilacak || fiyatDurumu(k, bugun) === 'eski').map((k) => k.id)))}>
              Fiyatsız / eski olanları seç
            </button>
            {secili.size > 0 && (
              <>
                <button type="button" className="ikincil" onClick={() => void arastirilacakIsaretle(depo, servis, [...secili], true).then(yenile)}>
                  🔎 Araştırılacak yap ({secili.size})
                </button>
                <button type="button" className="ikincil" onClick={() => setSecili(new Set())}>
                  Seçimi kaldır
                </button>
              </>
            )}
          </div>
          {secili.size > 0 && eposta !== undefined && (
            <div className="yz-arastirma">
              {eposta ? (
                <button type="button" disabled={yz?.calisiyor} onClick={() => void yzArastir()}>
                  🤖 Seçilen {secili.size} kalemi yapay zekâya araştırt
                </button>
              ) : (
                <>
                  <p className="kucuk-bilgi">Yapay zekâ ile araştırma için giriş yapın:</p>
                  <HesapGirisi eposta={eposta} onDegisti={setEposta} />
                </>
              )}
              <p className="mesaj-not">
                Yapay zekâ internette güncel fiyatları arar; yalnız kalem adı, birimi ve il ({il ?? 'belirtilmedi'}) gönderilir. Fiyat siz onaylayınca yazılır.
              </p>
            </div>
          )}
          {yz?.durum && <p className="kucuk-bilgi" role="status">{yz.durum}</p>}
          {yz?.hata && <Hatalar hatalar={[yz.hata]} />}
        </section>
      )}

      {gruplar.length === 0 && <BosDurum metin={arama || durum !== 'hepsi' ? 'Bu süzgece uyan kalem yok.' : 'Bu türde kalem yok.'} />}
      {gruplar.map(([ad, liste]) => (
        <section key={ad} className="kart fiyat-grubu">
          <h2>{ad}</h2>
          <ul className="fiyat-listesi">
            {liste.map((k) => (
              <li key={k.id}>
                <FiyatSatiri
                  kalem={k}
                  oneri={katalog.oneriler.get(k.id)}
                  bugun={bugun}
                  acik={acik === k.id}
                  onAc={() => setAcik((x) => (x === k.id ? null : k.id))}
                  secili={secili.has(k.id)}
                  onSec={yazabilir ? (d) => sec(k.id, d) : undefined}
                  yazabilir={yazabilir}
                  onDegisti={yenile}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function FiyatSatiri(p: {
  kalem: FiyatKalemi;
  oneri: FiyatOnerisi | undefined;
  bugun: Tarih;
  acik: boolean;
  onAc: () => void;
  secili: boolean;
  onSec?: (d: boolean) => void;
  yazabilir: boolean;
  onDegisti: () => Promise<void>;
}) {
  const k = p.kalem;
  const d = fiyatDurumu(k, p.bugun);
  const oneriVar = !!p.oneri || !!k.arastirma?.onerilen;
  return (
    <div className={`fiyat-satiri ${p.acik ? 'acik' : ''}`}>
      <div className="fs-ust">
        {p.onSec && <input type="checkbox" checked={p.secili} onChange={(e) => p.onSec!(e.target.checked)} aria-label={`${k.ad} seç`} />}
        <button type="button" className="fs-ad" onClick={p.onAc} aria-expanded={p.acik}>
          <span>
            {k.ad}
            {k.arastirilacak && <span className="etiket-cip">🔎 araştırılacak</span>}
            {!k.fiyat && oneriVar && <span className="etiket-cip">öneri var</span>}
          </span>
          <span className={`fs-fiyat fs-${d}`}>
            {k.fiyat === null ? (
              <span className="soluk">fiyat yok</span>
            ) : (
              <>
                <strong>{tlMetni(k.fiyat)} ₺</strong>
                <span className="soluk"> / {k.birim}</span>
              </>
            )}
          </span>
        </button>
      </div>
      {k.fiyat !== null && (
        <p className="fs-kaynak">
          {k.fiyatKaynagi && `${KAYNAK_SIMGESI[k.fiyatKaynagi]} ${FIYAT_KAYNAGI_ADI[k.fiyatKaynagi]}`} · {tarihYaz(k.fiyatTarihi)}
          {d === 'eski' && k.fiyatTarihi && <span className="rozet-gecikti">⚠ {Math.floor(gunFarki(k.fiyatTarihi, p.bugun) / 30)} ay önce</span>}
          {k.kaynakNotu && <span className="soluk"> · {k.kaynakNotu}</span>}
        </p>
      )}
      {p.acik && <FiyatAyrintisi {...p} />}
    </div>
  );
}

function FiyatAyrintisi({ kalem: k, oneri, bugun, yazabilir, onDegisti, onAc }: Parameters<typeof FiyatSatiri>[0]) {
  const { depo, servis } = useUygulama();
  const [tutar, setTutar] = useState(k.fiyat === null ? '' : tlMetni(k.fiyat));
  const [kaynak, setKaynak] = useState<FiyatKaynagi>(k.fiyatKaynagi === 'arastirma' ? 'arastirma' : 'elle');
  const [not, setNot] = useState(k.fiyatKaynagi === 'elle' || k.fiyatKaynagi === 'arastirma' ? k.kaynakNotu : '');
  const [tarih, setTarih] = useState<string>(bugun);
  const [hata, setHata] = useState<string[]>([]);
  const [duzenle, setDuzenle] = useState(false);

  const calistir = async (is: () => Promise<unknown>) => {
    setHata([]);
    try {
      await is();
      await onDegisti();
    } catch (e) {
      setHata([hataMetni(e)]);
    }
  };
  const kaydet = (fiyat: number | null, kaynakTuru: FiyatKaynagi, aciklama: string, t: Tarih) =>
    calistir(async () => {
      if (fiyat === null) throw new IsKuraliHatasi('Fiyatı yazın.');
      await fiyatGir(depo, servis, k.id, { fiyat, kaynak: kaynakTuru, not: aciklama, tarih: t }, bugun);
      onAc();
    });

  const a = k.arastirma;
  return (
    <div className="fs-ayrinti">
      <p className="soluk">
        Birim: {k.birim} · KDV %{k.kdvOrani}
        {k.aciklama && ` · ${k.aciklama}`}
      </p>

      {oneri && (
        <div className="fs-oneri">
          <span>
            🧾 {FIYAT_KAYNAGI_ADI[oneri.kaynak]}: <strong>{tlMetni(oneri.fiyat)} ₺</strong> / {k.birim} · {tarihYaz(oneri.tarih)}
            <br />
            <span className="soluk">{oneri.aciklama}</span>
          </span>
          {yazabilir && (
            <button type="button" className="ikincil" onClick={() => void kaydet(oneri.fiyat, oneri.kaynak, oneri.aciklama, oneri.tarih)}>
              Bu fiyatı kullan
            </button>
          )}
        </div>
      )}

      {a && (
        <div className="fs-oneri fs-yz">
          <span>
            🤖 Yapay zekâ araştırması ({tarihYaz(a.tarih)}):{' '}
            {a.onerilen === null ? (
              <span className="soluk">fiyat bulunamadı</span>
            ) : (
              <>
                <strong>{tlMetni(a.onerilen)} ₺</strong>
                {a.enDusuk !== null && a.enYuksek !== null && (
                  <span className="soluk">
                    {' '}
                    (aralık {tlMetni(a.enDusuk)} – {tlMetni(a.enYuksek)} ₺)
                  </span>
                )}
              </>
            )}
            {a.not && (
              <>
                <br />
                <span className="soluk">{a.not}</span>
              </>
            )}
          </span>
          {a.kaynaklar.length > 0 && (
            <ul className="fs-kaynaklar">
              {a.kaynaklar.map((x) => (
                <li key={x.url}>
                  <a href={x.url} target="_blank" rel="noopener noreferrer">
                    {x.baslik || new URL(x.url).hostname}
                  </a>
                  {x.fiyat !== null && <span className="soluk"> · {tlMetni(x.fiyat)} ₺</span>}
                </li>
              ))}
            </ul>
          )}
          {yazabilir && a.onerilen !== null && (
            <button
              type="button"
              className="ikincil"
              onClick={() => void kaydet(a.onerilen, 'yz', a.kaynaklar.map((x) => new URL(x.url).hostname.replace(/^www\./, '')).filter((x, i, l) => l.indexOf(x) === i).join(', '), bugun)}
            >
              Önerileni kullan
            </button>
          )}
        </div>
      )}

      {yazabilir && (
        <form
          className="fs-giris"
          onSubmit={(e) => {
            e.preventDefault();
            void kaydet(tlOku(tutar), kaynak, not, tarih);
          }}
        >
          <div className="satir-alanlar">
            <Alan etiket={`Fiyat (KDV hariç, ₺ / ${k.birim})`}>
              <TutarGirdisi value={tutar} onChange={setTutar} placeholder="0,00" />
            </Alan>
            <Alan etiket="Tarih">
              <input type="date" value={tarih} max={bugun} onChange={(e) => setTarih(e.target.value)} />
            </Alan>
          </div>
          <div className="filtreler" role="group" aria-label="Fiyatın kaynağı">
            <button type="button" aria-pressed={kaynak === 'elle'} onClick={() => setKaynak('elle')}>
              ✍️ Bildiğim fiyat
            </button>
            <button type="button" aria-pressed={kaynak === 'arastirma'} onClick={() => setKaynak('arastirma')}>
              🔎 Araştırdım
            </button>
          </div>
          <Alan etiket="Kaynak notu" aciklama={kaynak === 'arastirma' ? 'Firma, teklif no ya da bağlantı' : 'İsteğe bağlı'}>
            <input value={not} onChange={(e) => setNot(e.target.value)} placeholder={kaynak === 'arastirma' ? 'Örn. Akdeniz Yapı teklifi 12.10' : ''} />
          </Alan>
          <Hatalar hatalar={hata} />
          <div className="dugmeler">
            <button type="submit">Kaydet</button>
            <button type="button" className="ikincil" onClick={() => void calistir(() => arastirilacakIsaretle(depo, servis, [k.id], !k.arastirilacak))}>
              {k.arastirilacak ? 'Araştırılacaklardan çıkar' : '🔎 Araştırılacak'}
            </button>
            {k.fiyat !== null && (
              <button type="button" className="ikincil" onClick={() => void calistir(() => fiyatiKaldir(depo, servis, k.id))}>
                Fiyatı sil
              </button>
            )}
            <button type="button" className="ikincil" onClick={() => setDuzenle((x) => !x)}>
              Kalemi düzenle
            </button>
          </div>
        </form>
      )}
      {duzenle && (
        <KalemFormu
          baslik="Kalemi düzenle"
          ilk={{ tur: k.tur, ad: k.ad, birim: k.birim, butceKalemiKodu: k.butceKalemiKodu, aciklama: k.aciklama, kdvOrani: k.kdvOrani }}
          onKaydet={async (g) => {
            await fiyatKalemiGuncelle(depo, servis, k.id, g);
            setDuzenle(false);
            await onDegisti();
          }}
          onVazgec={() => setDuzenle(false)}
          onIptal={async () => {
            await fiyatKalemiIptal(depo, servis, k.id);
            await onDegisti();
          }}
        />
      )}
    </div>
  );
}

/** Ana ve alt bütçe kalemleri (gruplama için). */
const BUTCE_SECENEKLERI = Object.entries(HAZIR_KALEM_KODU).map(([ad, kod]) => ({ ad, kod }));

function KalemFormu(p: {
  baslik: string;
  ilk: FiyatKalemiGirdisi;
  onKaydet: (g: FiyatKalemiGirdisi) => Promise<void>;
  onVazgec: () => void;
  onIptal?: () => Promise<void>;
}) {
  const [f, setF] = useState(p.ilk);
  const [hata, setHata] = useState<string[]>([]);
  const [soru, setSoru] = useState(false);
  const yaz = <K extends keyof FiyatKalemiGirdisi>(a: K, d: FiyatKalemiGirdisi[K]) => setF((x) => ({ ...x, [a]: d }));
  const calistir = async (is: () => Promise<void>) => {
    setHata([]);
    try {
      await is();
    } catch (e) {
      setHata([hataMetni(e)]);
    }
  };
  return (
    <form
      className="kart fs-form"
      onSubmit={(e) => {
        e.preventDefault();
        void calistir(() => p.onKaydet(f));
      }}
    >
      <h3>{p.baslik}</h3>
      <div className="filtreler" role="group" aria-label="Tür">
        {(['malzeme', 'iscilik', 'makine'] as const).map((t) => (
          <button key={t} type="button" aria-pressed={f.tur === t} onClick={() => yaz('tur', t)}>
            {FIYAT_KALEMI_TURU_ADI[t]}
          </button>
        ))}
      </div>
      <Alan etiket="Ad">
        <input value={f.ad} onChange={(e) => yaz('ad', e.target.value)} placeholder="Örn. Bims briket 19 cm" />
      </Alan>
      <div className="satir-alanlar">
        <Alan etiket="Birim">
          <input value={f.birim} onChange={(e) => yaz('birim', e.target.value)} placeholder="m³, ton, adet…" list="fiyat-birimleri" />
        </Alan>
        <Alan etiket="KDV %">
          <select value={f.kdvOrani} onChange={(e) => yaz('kdvOrani', Number(e.target.value))}>
            {KDV_ORANLARI.map((o) => (
              <option key={o} value={o}>
                %{o}
              </option>
            ))}
          </select>
        </Alan>
      </div>
      <datalist id="fiyat-birimleri">
        {['m³', 'm²', 'metre', 'ton', 'kg', 'adet', 'torba', 'litre', 'saat', 'gün', 'ay', 'sefer', 'daire', 'götürü'].map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <Alan etiket="Bütçe kalemi" aciklama="Listede gruplanır; maliyet hesabında bu kaleme yazılır">
        <select value={f.butceKalemiKodu ?? ''} onChange={(e) => yaz('butceKalemiKodu', e.target.value || null)}>
          <option value="">— Diğer —</option>
          {BUTCE_SECENEKLERI.map((b) => (
            <option key={b.kod} value={b.kod}>
              {b.ad}
            </option>
          ))}
        </select>
      </Alan>
      <Alan etiket="Açıklama">
        <input value={f.aciklama} onChange={(e) => yaz('aciklama', e.target.value)} placeholder="Ölçü, marka, kalite…" />
      </Alan>
      <Hatalar hatalar={hata} />
      <div className="dugmeler">
        <button type="submit">Kaydet</button>
        <button type="button" className="ikincil" onClick={p.onVazgec}>
          Vazgeç
        </button>
        {p.onIptal &&
          (soru ? (
            <button type="button" className="tehlikeli" onClick={() => void calistir(p.onIptal!)}>
              Evet, listeden kaldır
            </button>
          ) : (
            <button type="button" className="ikincil" onClick={() => setSoru(true)}>
              Listeden kaldır
            </button>
          ))}
      </div>
    </form>
  );
}

function excelSayfalari(k: Katalog, bugun: Tarih) {
  return (['malzeme', 'iscilik', 'makine'] as const).map((t) => ({
    ad: FIYAT_KALEMI_TURU_ADI[t],
    ust: [`${FIYAT_KALEMI_TURU_ADI[t]} fiyatları (KDV hariç) · ${tarihYaz(bugun)}`],
    basliklar: ['Grup', 'Kalem', 'Birim', 'Fiyat', 'KDV %', 'Fiyat tarihi', 'Kaynak', 'Kaynak notu', 'Durum'],
    satirlar: k.kalemler
      .filter((x) => x.tur === t)
      .sort((a, b) => (BUTCE_SIRASI.get(a.butceKalemiKodu ?? '') ?? 9999) - (BUTCE_SIRASI.get(b.butceKalemiKodu ?? '') ?? 9999) || kalemSirasi(a, b))
      .map((x) => {
        const d = fiyatDurumu(x, bugun);
        return [
          grupAdi(x.butceKalemiKodu),
          x.ad,
          x.birim,
          x.fiyat === null ? null : { tl: x.fiyat },
          x.kdvOrani,
          x.fiyatTarihi ? { tarih: x.fiyatTarihi } : null,
          x.fiyatKaynagi ? FIYAT_KAYNAGI_ADI[x.fiyatKaynagi] : null,
          x.kaynakNotu || null,
          x.arastirilacak ? 'Araştırılacak' : d === 'yok' ? 'Fiyatsız' : d === 'eski' ? '3 aydan eski' : 'Güncel',
        ];
      }),
  }));
}
