import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { cihaz } from '../cihaz';
import { karekodCoz, tanimaToplami, tutarliMi, ublCoz } from '../hesap/eFatura';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { BELGE_TUR_ADI, belgeDosyasiGetir, type BelgeBagi } from '../servisler/belge';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import { giderleriListele, type GiderOzeti } from '../servisler/gider';
import {
  bekleyenler,
  bekleyenSayisi,
  HAVUZ_KABUL,
  havuzaEkle,
  havuzBagla,
  havuzdanKaldir,
  havuzNotu,
  havuzOnerisi,
  havuzSatiriGetir,
  xmlMi,
  type HavuzGirdisi,
  type HavuzOnerisi,
  type HavuzSatiri,
} from '../servisler/havuz';
import { katKarsiligiGetir } from '../servisler/arsaSahibi';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { projeSatislari } from '../servisler/satis';
import { projeSozlesmeleri } from '../servisler/ustaSozlesmesi';
import type { Depo } from '../veri/depo';
import type { Belge, HavuzTanima } from '../veri/tipler';
import { useUygulama, useProjeErisimi, useYetki } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { KucukResim } from './Belgeler';
import { CariSecici } from './CariSecici';
import { git } from './rota';

// Belge havuzu: her belge tek kapıdan yüklenir, onay bekler; onaylanınca ilgili kayda bağlanır.

const tarihYaz = (t: string) => new Date(`${t.slice(0, 10)}T00:00`).toLocaleDateString('tr-TR');

// ─── Yükleme: tanıma ve hazırlık (cihazda) ────────────────────────

const xmlDosyasi = (d: File) => xmlMi(d.type) || /\.xml$/i.test(d.name);

/** e-Fatura karekodu / XML cihazda okunur, fotoğraf küçültülür. Hiçbir şey internete gönderilmez. */
async function hazirla(dosyalar: File[]): Promise<HavuzGirdisi[]> {
  const sonuc: HavuzGirdisi[] = [];
  for (const d of dosyalar) {
    if (xmlDosyasi(d)) {
      const metin = await d.text();
      sonuc.push({ dosya: new Blob([metin], { type: 'application/xml' }), ad: d.name, tanima: ublCoz(metin) });
      continue;
    }
    let tanima: HavuzTanima | null = null;
    if (d.type.startsWith('image/') || d.type === 'application/pdf') {
      const { karekodlariOku } = await import('../cihaz/karekod');
      for (const k of await karekodlariOku(d)) {
        tanima = karekodCoz(k);
        if (tanima) break;
      }
    }
    sonuc.push({ dosya: await cihaz.resimKucult(d), ad: d.name, tanima });
  }
  return sonuc;
}

/** Ana ekrandan "Paylaş" ile gelen dosyalar (service worker önbelleğe yazar, burada alınıp silinir). */
async function paylasilanlariAl(): Promise<File[]> {
  if (!('caches' in window)) return [];
  const onbellek = await caches.open('paylasilan');
  const dosyalar: File[] = [];
  for (const istek of await onbellek.keys()) {
    const yanit = await onbellek.match(istek);
    if (yanit) {
      const ad = decodeURIComponent(yanit.headers.get('X-Dosya-Adi') ?? 'Paylaşılan dosya');
      dosyalar.push(new File([await yanit.blob()], ad, { type: yanit.headers.get('Content-Type') ?? '' }));
    }
    await onbellek.delete(istek);
  }
  return dosyalar;
}

function sonucMesaji(eklenen: number, tanınan: number, tekrar: string[]): string {
  const parcalar = [`${eklenen} belge onay havuzuna eklendi.`];
  if (tanınan > 0) parcalar.push(`${tanınan} fatura karekoddan ya da e-Fatura dosyasından okundu.`);
  if (tekrar.length > 0) parcalar.push(`Zaten havuzda olduğu için eklenmedi: ${tekrar.join(', ')}.`);
  return parcalar.join(' ');
}

/** Büyük yükleme alanı: kamera, çoklu dosya, bilgisayarda sürükle-bırak. */
export function BelgeYukleAlani(props: { onEklendi: () => Promise<void> | void; paylasim?: boolean }) {
  const { depo, servis } = useUygulama();
  const [durum, setDurum] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [surukleniyor, setSurukleniyor] = useState(false);
  const { onEklendi } = props;

  const yukle = useCallback(
    async (dosyalar: File[]) => {
      if (dosyalar.length === 0) return;
      setHata(null);
      setMesaj(null);
      setDurum(`${dosyalar.length} belge okunuyor…`);
      try {
        const girdiler = await hazirla(dosyalar);
        const { eklenen, tekrar } = await havuzaEkle(depo, servis, girdiler);
        setMesaj(sonucMesaji(eklenen.length, eklenen.filter((h) => h.tanima).length, tekrar));
        await onEklendi();
      } catch (e) {
        setHata(hataMetni(e));
      } finally {
        setDurum(null);
      }
    },
    [depo, servis, onEklendi],
  );

  // Paylaş menüsünden gelenler bir kez alınır.
  const { paylasim } = props;
  const paylasimAlindi = useRef(false);
  useEffect(() => {
    if (!paylasim || paylasimAlindi.current) return;
    paylasimAlindi.current = true;
    void paylasilanlariAl().then((d) => {
      void yukle(d);
      git('havuz');
    });
  }, [paylasim, yukle]);

  const birak = (e: DragEvent) => {
    e.preventDefault();
    setSurukleniyor(false);
    void yukle([...e.dataTransfer.files]);
  };

  return (
    <section
      className={`kart yukleme-alani${surukleniyor ? ' surukleniyor' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setSurukleniyor(true);
      }}
      onDragLeave={() => setSurukleniyor(false)}
      onDrop={birak}
    >
      <h2>Belge yükle</h2>
      <p className="soluk">
        Fatura, fiş, dekont, sözleşme, ruhsat, fotoğraf… Ne olduğunu düşünmeden yükleyin; onay havuzunda yerini seçersiniz. e-Fatura karekodu
        ve XML dosyası bu cihazda okunur.
      </p>
      <div className="dugmeler">
        <button
          type="button"
          disabled={!!durum}
          onClick={() =>
            void cihaz.fotografCek().then((f) => yukle(f ? [new File([f], `Fotoğraf ${new Date().toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}.jpg`, { type: f.type })] : []))
          }
        >
          📷 Fotoğraf çek
        </button>
        <button type="button" className="ikincil" disabled={!!durum} onClick={() => void cihaz.dosyalarSec(HAVUZ_KABUL).then(yukle)}>
          🗂 Dosya seç (birden çok)
        </button>
      </div>
      <p className="soluk kucuk surukle-notu">Bilgisayarda dosyaları bu kutuya sürükleyip bırakabilirsiniz. Telefonda WhatsApp ya da galeriden “Paylaş” › Müteahhit Defteri.</p>
      {durum && <p className="soluk">{durum}</p>}
      {mesaj && <p className="mesaj mesaj-basari">{mesaj}</p>}
      {hata && <Hatalar hatalar={[hata]} />}
    </section>
  );
}

/** Onay bekleyen belge sayısı (Kayıt ve Projeler ekranında gösterilir). */
export function useBekleyenBelgeSayisi(): number {
  const { depo, oturum } = useUygulama();
  const [sayi, setSayi] = useState(0);
  useEffect(() => {
    void bekleyenSayisi(depo, oturum.firmaId).then(setSayi);
  }, [depo, oturum.firmaId]);
  return sayi;
}

// ─── Liste ─────────────────────────────────────────────────────────

/** Tanınan faturanın tek satırlık özeti. */
export function tanimaOzeti(t: HavuzTanima): string {
  const parcalar = [t.iade ? 'İade faturası' : 'Fatura', t.satici.ad ?? (t.satici.vergiNo ? `VKN ${t.satici.vergiNo}` : null), t.faturaNo, t.tarih && tarihYaz(t.tarih), tlYaz(tanimaToplami(t))];
  return parcalar.filter(Boolean).join(' · ');
}

export function HavuzEkrani({ paylasim }: { paylasim?: boolean }) {
  const { depo, oturum } = useUygulama();
  const [liste, setListe] = useState<HavuzSatiri[] | null>(null);
  const [adlar, setAdlar] = useState<Map<string, string>>(new Map());

  const yenile = useCallback(async () => {
    const [l, kullanicilar] = await Promise.all([bekleyenler(depo, oturum.firmaId), depo.listele('kullanici')]);
    setAdlar(new Map(kullanicilar.map((k) => [k.id, k.ad])));
    setListe(l);
  }, [depo, oturum.firmaId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  return (
    <>
      <p>
        <a href="#/kayit">← Kayıt</a>
      </p>
      <h1>Belge havuzu</h1>
      <BelgeYukleAlani onEklendi={yenile} paylasim={paylasim} />
      <section className="kart">
        <h2>Onay bekleyenler{liste && liste.length > 0 ? ` (${liste.length})` : ''}</h2>
        {liste === null && <p>Yükleniyor…</p>}
        {liste?.length === 0 && <p className="soluk">Onay bekleyen belge yok.</p>}
        <ul className="havuz-listesi">
          {liste?.map(({ havuz, belge }) => (
            <li key={havuz.id}>
              <a className="havuz-satiri" href={`#/havuz/${havuz.id}`}>
                <KucukResim belge={belge} />
                <span className="havuz-bilgi">
                  <strong>{havuz.tanima ? tanimaOzeti(havuz.tanima) : belge.ad}</strong>
                  <span className="soluk">
                    {havuz.tanima ? (havuz.tanima.kaynak === 'xml' ? 'e-Fatura dosyasından okundu' : 'Karekoddan okundu') : 'Yerini siz seçeceksiniz'} ·{' '}
                    {adlar.get(havuz.olusturan) ?? '?'}, {new Date(havuz.olusturmaZamani).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}
                  </span>
                  {havuz.not && <span className="havuz-notu">{havuz.not}</span>}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

// ─── Detay ve onay ─────────────────────────────────────────────────

/** Formlarda: havuzdan gelen belgenin küçük gösterimi. */
export function HavuzBelgesiSeridi({ belge }: { belge: Belge }) {
  return (
    <div className="havuz-seridi">
      <KucukResim belge={belge} />
      <span>
        <strong>Onay havuzundan: {belge.ad}</strong>
        <span className="soluk"> Kaydedince bu belge kayda eklenir ve havuzdan çıkar.</span>
      </span>
    </div>
  );
}

/** Kayıt oluştuktan sonra havuz belgesini ona bağlar; olmazsa belge havuzda kalır (kayıt yine durur). */
export async function havuzaBagliKaydet(
  depo: Depo,
  servis: Parameters<typeof havuzBagla>[1],
  havuzId: string | undefined,
  bag: { tablo: BelgeBagi; id: string; tur?: Belge['tur'] },
): Promise<void> {
  if (!havuzId) return;
  try {
    await havuzBagla(depo, servis, havuzId, bag);
  } catch {
    // Belge havuzda bekler; kullanıcı oradan yeniden bağlar.
  }
}

type BagTuru = 'proje' | 'cari' | 'gider' | 'ustaSozlesmesi' | 'katKarsiligiSozlesme' | 'satis';
const BAG_ADI: Record<BagTuru, string> = {
  proje: 'Proje belgesi (ruhsat, iskân, tapu, çizim, şantiye fotoğrafı)',
  cari: 'Cari kartı (kimlik, vergi levhası, imza sirküleri…)',
  gider: 'Girilmiş bir gider (fatura sonradan geldi)',
  ustaSozlesmesi: 'Usta / taşeron sözleşmesi',
  katKarsiligiSozlesme: 'Kat karşılığı sözleşmesi',
  satis: 'Daire satışı (protokol, tapu)',
};
const BAG_BELGE_TURU: Record<BagTuru, Belge['tur']> = {
  proje: 'diger',
  cari: 'diger',
  gider: 'fatura',
  ustaSozlesmesi: 'sozlesme',
  katKarsiligiSozlesme: 'sozlesme',
  satis: 'sozlesme',
};

/** "Bir kayda bağla": tür → (proje/cari) → kayıt. */
function BaglaPaneli(props: { satir: HavuzSatiri; onBaglandi: (yol: string) => void; onVazgec: () => void }) {
  const { depo, oturum, servis } = useUygulama();
  const erisim = useProjeErisimi();
  const [tur, setTur] = useState<BagTuru | ''>('');
  const [projeler, setProjeler] = useState<ProjeOzeti[]>([]);
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [projeId, setProjeId] = useState('');
  const [cariId, setCariId] = useState<string | null>(null);
  const [secenekler, setSecenekler] = useState<{ id: string; ad: string }[] | null>(null);
  const [kayitId, setKayitId] = useState('');
  const [belgeTuru, setBelgeTuru] = useState<Belge['tur']>(props.satir.belge.tur);
  const [ad, setAd] = useState(props.satir.belge.ad);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    void projeleriListele(depo, oturum.firmaId, erisim).then(setProjeler);
    void carileriListele(depo, oturum.firmaId).then((l) => setCariler(l.filter((c) => !c.cari.roller.includes('vergi_dairesi'))));
  }, [depo, oturum.firmaId, erisim]);

  // Seçilen türe göre bağlanacak kayıtlar.
  useEffect(() => {
    setKayitId('');
    setSecenekler(null);
    const f = oturum.firmaId;
    const bugun = yerelGun(new Date());
    if (tur === 'proje' || tur === 'cari' || !tur) return;
    if (tur === 'gider') {
      if (!cariId) return;
      void giderleriListele(depo, f, { cariId }, bugun).then((l: GiderOzeti[]) =>
        setSecenekler(
          l
            .sort((a, b) => b.gider.tarih.localeCompare(a.gider.tarih))
            .slice(0, 50)
            .map((g) => ({ id: g.gider.id, ad: `${tarihYaz(g.gider.tarih)}${g.gider.faturaNo ? ` · ${g.gider.faturaNo}` : ''} · ${tlYaz(g.gider.toplam)}${g.projeAdi ? ` · ${g.projeAdi}` : ''}` })),
        ),
      );
      return;
    }
    if (!projeId) return;
    if (tur === 'ustaSozlesmesi') {
      void projeSozlesmeleri(depo, f, projeId).then((l) => setSecenekler(l.map((s) => ({ id: s.sozlesme.id, ad: `${s.cariAdi} · ${s.sozlesme.ustaTipiAdi}${s.sozlesme.onay ? '' : ' (taslak)'}` }))));
    } else if (tur === 'katKarsiligiSozlesme') {
      void katKarsiligiGetir(depo, f, projeId).then((k) => setSecenekler(k ? [{ id: k.id, ad: `Kat karşılığı sözleşmesi · arsa sahipleri %${k.arsaSahibiOrani}` }] : []));
    } else if (tur === 'satis') {
      void projeSatislari(depo, f, projeId, bugun).then((p) => setSecenekler(p.satirlar.map((s) => ({ id: s.satis.id, ad: `${s.bolumNo} · ${s.cari.ad}` }))));
    }
  }, [tur, projeId, cariId, depo, oturum.firmaId]);

  const hedef: { tablo: BelgeBagi; id: string } | null =
    tur === 'proje' ? (projeId ? { tablo: 'proje', id: projeId } : null) : tur === 'cari' ? (cariId ? { tablo: 'cari', id: cariId } : null) : tur && kayitId ? { tablo: tur, id: kayitId } : null;

  const yol = (h: { tablo: BelgeBagi; id: string }) =>
    h.tablo === 'proje' ? `projeler/${h.id}` : h.tablo === 'cari' ? `cariler/${h.id}` : h.tablo === 'gider' ? `giderler/${h.id}` : h.tablo === 'ustaSozlesmesi' ? `sozlesmeler/${h.id}` : h.tablo === 'satis' ? `satislar/${h.id}` : `projeler/${projeId}`;

  async function bagla() {
    if (!hedef) return;
    setHata(null);
    try {
      await havuzBagla(depo, servis, props.satir.havuz.id, { ...hedef, tur: belgeTuru, ad });
      props.onBaglandi(yol(hedef));
    } catch (e) {
      setHata(hataMetni(e));
    }
  }

  return (
    <div className="bagla-paneli">
      <h3>Bir kayda bağla</h3>
      <Alan etiket="Ne belgesi?">
        <select
          value={tur}
          onChange={(e) => {
            const t = e.target.value as BagTuru | '';
            setTur(t);
            if (t) setBelgeTuru(props.satir.belge.tur === 'fatura' && t === 'gider' ? 'fatura' : props.satir.havuz.tanima ? 'fatura' : BAG_BELGE_TURU[t]);
          }}
        >
          <option value="">Seçin</option>
          {(Object.keys(BAG_ADI) as BagTuru[]).map((t) => (
            <option key={t} value={t}>
              {BAG_ADI[t]}
            </option>
          ))}
        </select>
      </Alan>
      {(tur === 'proje' || tur === 'ustaSozlesmesi' || tur === 'katKarsiligiSozlesme' || tur === 'satis') && (
        <Alan etiket="Proje">
          <select value={projeId} onChange={(e) => setProjeId(e.target.value)}>
            <option value="">Seçin</option>
            {projeler.map((p) => (
              <option key={p.proje.id} value={p.proje.id}>
                {p.proje.ad}
              </option>
            ))}
          </select>
        </Alan>
      )}
      {(tur === 'cari' || tur === 'gider') && (
        <div className="alan">
          <span className="alan-etiket">Cari</span>
          <CariSecici cariler={cariler} secili={cariId} onSec={setCariId} />
        </div>
      )}
      {secenekler && (
        <Alan etiket="Kayıt">
          {secenekler.length === 0 ? (
            <p className="soluk">Bu seçimde kayıt yok.</p>
          ) : (
            <select value={kayitId} onChange={(e) => setKayitId(e.target.value)}>
              <option value="">Seçin</option>
              {secenekler.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.ad}
                </option>
              ))}
            </select>
          )}
        </Alan>
      )}
      {tur && (
        <div className="iki-sutun">
          <Alan etiket="Belge adı">
            <input value={ad} onChange={(e) => setAd(e.target.value)} />
          </Alan>
          <Alan etiket="Belge türü">
            <select value={belgeTuru} onChange={(e) => setBelgeTuru(e.target.value as Belge['tur'])}>
              {(Object.keys(BELGE_TUR_ADI) as Belge['tur'][]).map((t) => (
                <option key={t} value={t}>
                  {BELGE_TUR_ADI[t]}
                </option>
              ))}
            </select>
          </Alan>
        </div>
      )}
      {hata && <Hatalar hatalar={[hata]} />}
      <div className="dugmeler">
        <button type="button" disabled={!hedef} onClick={() => void bagla()}>
          Onayla ve bağla
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

function TanimaKarti({ t, oneri }: { t: HavuzTanima; oneri: HavuzOnerisi | null }) {
  const uyari = tutarliMi(t);
  return (
    <section className="kart">
      <h2>{t.kaynak === 'xml' ? 'e-Fatura dosyasından okunan' : 'Karekoddan okunan'}</h2>
      <dl className="bilgi">
        <dt>Satıcı</dt>
        <dd>
          {t.satici.ad ?? '—'}
          {t.satici.vergiNo && <span className="soluk"> · VKN/TCKN {t.satici.vergiNo}</span>}
        </dd>
        <dt>Fatura</dt>
        <dd>
          {t.iade ? 'İade · ' : ''}
          {t.faturaNo ?? '—'} · {t.tarih ? tarihYaz(t.tarih) : '—'}
        </dd>
        {t.kdvler.map((k) => (
          <FragmentSatir key={k.oran} sol={`KDV %${k.oran}`} sag={`${tlYaz(k.matrah)} + ${tlYaz(k.kdv)} KDV`} />
        ))}
        {t.tevkifat > 0 && <FragmentSatir sol="Tevkifat" sag={`− ${tlYaz(t.tevkifat)}`} />}
        <dt>Toplam</dt>
        <dd>
          <strong>{tlYaz(tanimaToplami(t))}</strong>
          {t.odenecek !== null && t.odenecek !== tanimaToplami(t) && <span className="soluk"> · ödenecek {tlYaz(t.odenecek)}</span>}
        </dd>
        {t.satirlar.length > 0 && (
          <>
            <dt>Satırlar</dt>
            <dd>{t.satirlar.map((s) => s.ad).filter(Boolean).slice(0, 4).join(', ') + (t.satirlar.length > 4 ? ` +${t.satirlar.length - 4}` : '')}</dd>
          </>
        )}
      </dl>
      {t.paraBirimi !== 'TRY' && <p className="mesaj mesaj-uyari">Fatura {t.paraBirimi} cinsinden; tutarları TL'ye çevirerek girin.</p>}
      {uyari && <p className="mesaj mesaj-uyari">{uyari}</p>}
      {oneri?.aliciUyarisi && <p className="mesaj mesaj-uyari">{oneri.aliciUyarisi}</p>}
      {oneri && (
        <p>
          Cari:{' '}
          {oneri.cari ? (
            <>
              <strong>{oneri.cari.ad}</strong> <span className="soluk">(vergi numarası eşleşti)</span>
            </>
          ) : (
            <span className="soluk">Bu vergi numarasıyla kayıtlı cari yok; gider formunda tek dokunuşla açılır.</span>
          )}
        </p>
      )}
    </section>
  );
}

function FragmentSatir({ sol, sag }: { sol: string; sag: string }) {
  return (
    <>
      <dt>{sol}</dt>
      <dd>{sag}</dd>
    </>
  );
}

export function HavuzDetay({ havuzId }: { havuzId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const yetki = useYetki();
  const [satir, setSatir] = useState<HavuzSatiri | null | undefined>(undefined);
  const [oneri, setOneri] = useState<HavuzOnerisi | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [bagla, setBagla] = useState(false);
  const [not, setNot] = useState<string | null>(null);
  const [kaldirSoruluyor, setKaldirSoruluyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  const yenile = useCallback(async () => {
    const s = await havuzSatiriGetir(depo, oturum.firmaId, havuzId);
    setSatir(s);
    if (s) setOneri(await havuzOnerisi(depo, oturum.firmaId, s.havuz));
  }, [depo, oturum.firmaId, havuzId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  const belgeId = satir?.belge.id;
  const mime = satir?.belge.mime ?? '';
  useEffect(() => {
    if (!belgeId || !mime.startsWith('image/')) return;
    let adres: string | null = null;
    void belgeDosyasiGetir(depo, oturum.firmaId, belgeId).then((d) => {
      if (!d) return;
      adres = URL.createObjectURL(d);
      setUrl(adres);
    });
    return () => {
      if (adres) URL.revokeObjectURL(adres);
    };
  }, [belgeId, mime, depo, oturum.firmaId]);

  if (satir === undefined) return <p>Yükleniyor…</p>;
  if (satir === null) {
    return (
      <section className="kart">
        <p>Bu belge havuzda değil (kayda bağlanmış ya da kaldırılmış olabilir).</p>
        <a className="dugme ikincil" href="#/havuz">
          Belge havuzuna dön
        </a>
      </section>
    );
  }
  const { havuz, belge } = satir;
  if (havuz.durum !== 'bekliyor') {
    return (
      <section className="kart">
        <p>Bu belge onaylanıp bir kayda bağlandı.</p>
        <a className="dugme ikincil" href={`#/belgeler/${belge.id}`}>
          Belgeyi aç
        </a>
      </section>
    );
  }
  const t = havuz.tanima;

  async function dosyayiAc() {
    const d = await belgeDosyasiGetir(depo, oturum.firmaId, belge.id);
    if (d) cihaz.dosyaAc(xmlMi(belge.mime) ? new Blob([d], { type: 'text/plain' }) : d, belge.ad);
  }

  return (
    <>
      <p>
        <a href="#/havuz">← Belge havuzu</a>
      </p>
      <h1>{t ? tanimaOzeti(t) : belge.ad}</h1>
      {url ? (
        <img className="belge-buyuk" src={url} alt={belge.ad} />
      ) : (
        <section className="kart">
          <p>
            {belge.ad} <span className="soluk">({belge.mime === 'application/pdf' ? 'PDF' : xmlMi(belge.mime) ? 'e-Fatura XML' : belge.mime})</span>
          </p>
          <button type="button" className="ikincil" onClick={() => void dosyayiAc()}>
            Aç
          </button>
        </section>
      )}

      {t && <TanimaKarti t={t} oneri={oneri} />}

      {oneri && oneri.mevcutGiderler.length > 0 && (
        <section className="kart mesaj-uyari">
          <h2>Bu fatura girilmiş görünüyor</h2>
          <p className="soluk">Yeni gider açmak yerine belgeyi girilmiş gidere ekleyin; aynı fatura iki kez maliyete yazılmasın.</p>
          <ul className="liste">
            {oneri.mevcutGiderler.map((g) => (
              <li key={g.id}>
                <span>
                  {tarihYaz(g.tarih)}
                  {g.faturaNo && ` · ${g.faturaNo}`} · {tlYaz(g.toplam)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void havuzBagla(depo, servis, havuz.id, { tablo: 'gider', id: g.id, tur: 'fatura' })
                      .then(() => git(`giderler/${g.id}`))
                      .catch((e: unknown) => setHata(hataMetni(e)))
                  }
                >
                  Bu gidere ekle
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="kart">
        <h2>Ne yapılsın?</h2>
        <div className="havuz-islemleri">
          {yetki('gider') && (
            <a className="dugme" href={`#/havuz/${havuz.id}/gider`}>
              🧾 {t?.iade ? 'İade faturası olarak gir' : 'Gider olarak gir (fatura / fiş)'}
            </a>
          )}
          {yetki('odeme') && (
            <a className="dugme ikincil" href={`#/havuz/${havuz.id}/odeme`}>
              ↗ Ödeme dekontu
            </a>
          )}
          {yetki('odeme') && (
            <a className="dugme ikincil" href={`#/havuz/${havuz.id}/tahsilat`}>
              ↙ Tahsilat dekontu
            </a>
          )}
          <button type="button" className="ikincil" onClick={() => setBagla(true)}>
            📎 Bir kayda bağla (sözleşme, proje, cari…)
          </button>
        </div>
        {bagla && <BaglaPaneli satir={satir} onBaglandi={git} onVazgec={() => setBagla(false)} />}
      </section>

      <section className="kart">
        <h2>Not</h2>
        {not === null ? (
          <p>
            {havuz.not || <span className="soluk">Not yok.</span>}{' '}
            <button type="button" className="baglanti-dugmesi" onClick={() => setNot(havuz.not)}>
              {havuz.not ? 'Değiştir' : 'Not ekle'}
            </button>
          </p>
        ) : (
          <>
            <textarea value={not} rows={2} placeholder="Örn. Ali Usta'nın fişi, projesi sorulacak" onChange={(e) => setNot(e.target.value)} />
            <div className="dugmeler">
              <button
                type="button"
                onClick={() =>
                  void havuzNotu(servis, havuz.id, not)
                    .then(() => (setNot(null), yenile()))
                    .catch((e: unknown) => setHata(hataMetni(e)))
                }
              >
                Kaydet
              </button>
              <button type="button" className="ikincil" onClick={() => setNot(null)}>
                Vazgeç
              </button>
            </div>
          </>
        )}
        {hata && <Hatalar hatalar={[hata]} />}
        {kaldirSoruluyor ? (
          <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="Kaldırma onayı">
            <p>Belge gereksiz mi? Havuzdan kalkar; dosyası geçmişte ve yedekte kalır.</p>
            <div className="dugmeler">
              <button
                type="button"
                className="tehlikeli"
                onClick={() =>
                  void havuzdanKaldir(servis, havuz.id)
                    .then(() => git('havuz'))
                    .catch((e: unknown) => setHata(hataMetni(e)))
                }
              >
                Evet, kaldır
              </button>
              <button type="button" className="ikincil" onClick={() => setKaldirSoruluyor(false)}>
                Vazgeç
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="ikincil" onClick={() => setKaldirSoruluyor(true)}>
            🗑 Gereksiz, havuzdan kaldır
          </button>
        )}
      </section>
    </>
  );
}
