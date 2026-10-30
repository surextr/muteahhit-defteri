import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { Simge } from './Simge';
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
  takipBasliginiTamamla,
  xmlMi,
  type HavuzGirdisi,
  type HavuzOnerisi,
  type HavuzSatiri,
} from '../servisler/havuz';
import { katKarsiligiGetir } from '../servisler/arsaSahibi';
import { dekontYonu, YZ_TUR_ADI, yzOnerisi } from '../hesap/yzOkuma';
import { hesaplariListele } from '../servisler/hesap';
import { YZ_OKUNUR } from '../bulut/belgeOku';
import { havuzuYzIleOku, useYzBelgeAyari, YzRizaKutusu } from './YzBelge';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { projeSatislari } from '../servisler/satis';
import { projeSozlesmeleri } from '../servisler/ustaSozlesmesi';
import type { Depo } from '../veri/depo';
import type { Belge, HavuzBelgesi, HavuzCekim, HavuzTanima, YzOkuma } from '../veri/tipler';
import { cekimTarihiBul, exifOku, mesafeKm, type Konum } from '../hesap/fotograf';
import { konumluProjeler } from '../servisler/fotograf';
import { useUygulama, useProjeErisimi, useYetki } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { aramaAnahtari } from '../hesap/metin';
import { KucukResim } from './Belgeler';
import { CariSecici } from './CariSecici';
import { git } from './rota';

// Belge havuzu: her belge tek kapıdan yüklenir, onay bekler; onaylanınca ilgili kayda bağlanır.

const tarihYaz = (t: string) => new Date(`${t.slice(0, 10)}T00:00`).toLocaleDateString('tr-TR');

// ─── Yükleme: tanıma ve hazırlık (cihazda) ────────────────────────

const xmlDosyasi = (d: File) => xmlMi(d.type) || /\.xml$/i.test(d.name);

/** e-Fatura karekodu / XML cihazda okunur, fotoğraf küçültülür. Hiçbir şey internete gönderilmez. */
async function hazirla(dosyalar: File[], projeler: { id: string; konum: Konum | null }[]): Promise<HavuzGirdisi[]> {
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
    // Fotoğrafın çekim tarihi ve konumu küçültmeden önce okunur (küçültme siler); konumdan yalnız uzaklıklar tutulur.
    let cekim: HavuzCekim | null = null;
    if (d.type === 'image/jpeg' && !tanima) {
      const exif = exifOku(new Uint8Array(await d.slice(0, 512 * 1024).arrayBuffer()));
      const t = cekimTarihiBul(exif, d.name);
      const projeUzakliklari: Record<string, number> = {};
      if (exif.konum) for (const p of projeler) if (p.konum) projeUzakliklari[p.id] = Math.round(mesafeKm(exif.konum, p.konum) * 10) / 10;
      cekim = { tarih: t.tarih, zaman: t.zaman, kaynak: t.kaynak, projeUzakliklari };
    } else if (d.type.startsWith('image/') && !tanima) {
      const t = cekimTarihiBul({ tarih: null, zaman: null, konum: null }, d.name);
      cekim = { tarih: t.tarih, zaman: t.zaman, kaynak: t.kaynak, projeUzakliklari: {} };
    }
    sonuc.push({ dosya: await cihaz.resimKucult(d), ad: d.name, tanima, cekim });
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
  const { depo, servis, firma } = useUygulama();
  const [yzAyar] = useYzBelgeAyari();
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
        const girdiler = await hazirla(dosyalar, await konumluProjeler(depo, servis.oturum.firmaId, null));
        const { eklenen, tekrar } = await havuzaEkle(depo, servis, girdiler);
        setMesaj(sonucMesaji(eklenen.length, eklenen.filter((h) => h.tanima).length, tekrar));
        await onEklendi();
        // Rıza ve "kendiliğinden oku" açıksa: karekodu/XML'i olmayanlar yapay zekâya okutulur.
        if (yzAyar?.riza && yzAyar.otomatik && navigator.onLine) {
          const okunacak: HavuzBelgesi[] = [];
          for (const h of eklenen) if (!h.tanima && YZ_OKUNUR.has((await depo.getir('belge', h.belgeId))?.mime ?? '')) okunacak.push(h);
          let okunan = 0;
          const hatalar: string[] = [];
          for (const h of okunacak) {
            setDurum(`Yapay zekâ okuyor… ${okunan + 1}/${okunacak.length}`);
            try {
              await havuzuYzIleOku(depo, servis, firma, h.id, 'tani');
              okunan++;
            } catch (e) {
              hatalar.push(hataMetni(e));
              break;
            }
          }
          if (okunacak.length > 0) {
            setMesaj((m) => `${m ?? ''} Yapay zekâ ${okunan} belgeyi okudu.${hatalar.length ? ` ${hatalar[0]}` : ''}`.trim());
            await onEklendi();
          }
        }
      } catch (e) {
        setHata(hataMetni(e));
      } finally {
        setDurum(null);
      }
    },
    [depo, servis, firma, onEklendi, yzAyar],
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
          <Simge ad="kamera" /> Fotoğraf çek
        </button>
        <button type="button" className="ikincil" disabled={!!durum} onClick={() => void cihaz.dosyalarSec(HAVUZ_KABUL).then(yukle)}>
          <Simge ad="klasor" /> Dosya seç (birden çok)
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
export function tanimaOzeti(t: HavuzTanima, fis = false): string {
  const parcalar = [t.iade ? 'İade faturası' : fis ? 'Fiş' : 'Fatura', t.satici.ad ?? (t.satici.vergiNo ? `VKN ${t.satici.vergiNo}` : null), t.faturaNo, t.tarih && tarihYaz(t.tarih), tlYaz(tanimaToplami(t))];
  return parcalar.filter(Boolean).join(' · ');
}

/** Listede ve başlıkta: okunan bilgiye göre kısa ad. */
export function havuzBasligi(h: HavuzBelgesi, b: Belge): string {
  if (h.tanima) return tanimaOzeti(h.tanima, h.okuma?.tur === 'fis');
  if (h.okuma) return `${YZ_TUR_ADI[h.okuma.tur]} · ${h.okuma.ozet}`;
  return b.ad;
}

function okumaKaynagi(h: HavuzBelgesi): string {
  if (h.tanima?.kaynak === 'xml') return 'e-Fatura dosyasından okundu';
  if (h.tanima?.kaynak === 'karekod') return 'Karekoddan okundu';
  if (h.okuma) return `Yapay zekâ okudu${h.okuma.guven === 'dusuk' ? ' (emin değil)' : ''}`;
  return 'Yerini siz seçeceksiniz';
}

export function HavuzEkrani({ paylasim, seciliId }: { paylasim?: boolean; seciliId?: string }) {
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
        <a className="geri-baglanti" href="#/kayit">← Kayıt</a>
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
              <a className="havuz-satiri" href={`#/havuz/${havuz.id}`} aria-current={havuz.id === seciliId ? 'true' : undefined}>
                <KucukResim belge={belge} />
                <span className="havuz-bilgi">
                  <strong>{havuzBasligi(havuz, belge)}</strong>
                  <span className="soluk">
                    {okumaKaynagi(havuz)} ·{' '}
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
function BaglaPaneli(props: { satir: HavuzSatiri; onBaglandi: (yol: string) => void; onVazgec: () => void; ilkTur?: BagTuru }) {
  const { depo, oturum, servis } = useUygulama();
  const erisim = useProjeErisimi();
  const okuma = props.satir.havuz.okuma;
  const [tur, setTur] = useState<BagTuru | ''>(props.ilkTur ?? '');
  const [projeler, setProjeler] = useState<ProjeOzeti[]>([]);
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [projeId, setProjeId] = useState('');
  const [cariId, setCariId] = useState<string | null>(null);
  const [secenekler, setSecenekler] = useState<{ id: string; ad: string }[] | null>(null);
  const [kayitId, setKayitId] = useState('');
  const [belgeTuru, setBelgeTuru] = useState<Belge['tur']>(props.satir.belge.tur);
  const [ad, setAd] = useState(props.satir.belge.ad);
  const [hata, setHata] = useState<string | null>(null);
  // Ruhsat/iskân belgesi projeye bağlanınca takip başlığı belgenin tarihiyle tamamlanabilir.
  const takipTuru = okuma?.tur === 'ruhsat' || okuma?.tur === 'iskan' ? okuma.tur : null;
  const takipTarihi = okuma?.belge?.tarih ?? null;
  const [takipTamamla, setTakipTamamla] = useState(true);

  useEffect(() => {
    // Yapay zekânın okuduğu ada/parsel projeyle, kişi adı ya da TC/VKN cariyle eşleşirse önerili gelir.
    const b = okuma?.belge;
    void projeleriListele(depo, oturum.firmaId, erisim).then((l) => {
      setProjeler(l);
      const p = b?.ada && b.parsel ? l.find((x) => x.proje.parseller.some((pa) => pa.ada === b.ada && pa.parsel === b.parsel)) : undefined;
      if (p) setProjeId((x) => x || p.proje.id);
    });
    void carileriListele(depo, oturum.firmaId).then((l) => {
      const c = l.filter((x) => !x.cari.roller.includes('vergi_dairesi'));
      setCariler(c);
      const bulunan = b?.kisiNo ? c.find((x) => (x.cari.vergiNo ?? '').replace(/\D/g, '') === b.kisiNo) : b?.kisiAdi ? c.find((x) => aramaAnahtari(x.cari.ad) === aramaAnahtari(b.kisiAdi!)) : undefined;
      if (bulunan) setCariId((x) => x ?? bulunan.cari.id);
    });
  }, [depo, oturum.firmaId, erisim, okuma]);

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
      if (hedef.tablo === 'proje' && takipTuru && takipTarihi && takipTamamla) await takipBasliginiTamamla(depo, servis, hedef.id, takipTuru, takipTarihi);
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
      {tur === 'proje' && takipTuru && takipTarihi && (
        <label className="onay-kutusu">
          <input type="checkbox" checked={takipTamamla} onChange={(e) => setTakipTamamla(e.target.checked)} />
          "{takipTuru === 'ruhsat' ? 'Ruhsat' : 'İskan'}" takip başlığı {tarihYaz(takipTarihi)} tarihiyle tamamlandı olsun
        </label>
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

const GUVEN_ADI = { yuksek: 'emin', orta: 'büyük ölçüde emin', dusuk: 'emin değil, kontrol edin' } as const;

function OkumaKarti({ okuma, faturaGosterildi }: { okuma: YzOkuma; faturaGosterildi: boolean }) {
  const d = okuma.dekont;
  const c = okuma.cek;
  const b = okuma.belge;
  const satir = (sol: string, sag: string | null | undefined) =>
    sag ? (
      <FragmentSatir key={sol} sol={sol} sag={sag} />
    ) : null;
  return (
    <section className="kart">
      <h2><Simge ad="yz" /> {YZ_TUR_ADI[okuma.tur]}</h2>
      <p className="soluk">
        {okuma.ozet} · Yapay zekâ {GUVEN_ADI[okuma.guven]}
      </p>
      {d && okuma.tur === 'dekont' && (
        <dl className="bilgi">
          {satir('Tarih', d.tarih && tarihYaz(d.tarih))}
          {satir('Tutar', d.tutar !== null ? tlYaz(d.tutar) : null)}
          {satir('Gönderen', [d.gonderenAd, d.gonderenIban].filter(Boolean).join(' · '))}
          {satir('Alıcı', [d.aliciAd, d.aliciIban].filter(Boolean).join(' · '))}
          {satir('Açıklama', d.aciklama)}
        </dl>
      )}
      {c && (okuma.tur === 'cek' || okuma.tur === 'senet') && (
        <dl className="bilgi">
          {satir('Banka', [c.banka, c.sube].filter(Boolean).join(' · '))}
          {satir('Seri no', c.seriNo)}
          {satir('Vade', c.vade && tarihYaz(c.vade))}
          {satir('Tutar', c.tutar !== null ? tlYaz(c.tutar) : null)}
          {satir('Keşideci', c.kesideci)}
          {satir('Lehtar', c.lehtar)}
        </dl>
      )}
      {b && !faturaGosterildi && (
        <dl className="bilgi">
          {satir('Tarih', b.tarih && tarihYaz(b.tarih))}
          {satir('Ada / parsel', b.ada || b.parsel ? `${b.ada ?? '?'} / ${b.parsel ?? '?'}` : null)}
          {satir('Adres', b.adres)}
          {satir('Kişi', [b.kisiAdi, b.kisiNo].filter(Boolean).join(' · '))}
        </dl>
      )}
      {okuma.sozlesme && <p className="soluk kucuk">Sözleşme ayrıntıları da okundu.</p>}
    </section>
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
  const { firma } = useUygulama();
  const [yzAyar] = useYzBelgeAyari();
  const [rizaSoruluyor, setRizaSoruluyor] = useState(false);
  const [okunuyor, setOkunuyor] = useState<'tani' | 'sozlesme' | null>(null);
  const [yzHata, setYzHata] = useState<string | null>(null);
  const [ibanlar, setIbanlar] = useState<string[]>([]);
  useEffect(() => {
    void hesaplariListele(depo, oturum.firmaId).then((l) => setIbanlar(l.flatMap((h) => (h.hesap.iban ? [h.hesap.iban] : []))));
  }, [depo, oturum.firmaId]);

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
  const okuma = havuz.okuma ?? null;
  const oneriTuru = okuma ? yzOnerisi(okuma) : t ? 'gider' : null;
  const dekontYon = okuma?.dekont ? dekontYonu(okuma.dekont, firma.ad, ibanlar) : null;
  const onerilen = (is: 'gider' | 'odeme' | 'tahsilat' | 'cek' | 'sozlesme' | 'bagla') =>
    is === 'bagla' ? (oneriTuru === 'proje' && okuma?.tur !== 'santiye_fotografi') || oneriTuru === 'cari' : is === 'odeme' || is === 'tahsilat' ? oneriTuru === 'odeme' && (dekontYon ?? 'odeme') === is : oneriTuru === is;
  const sinif = (is: Parameters<typeof onerilen>[0]) => (onerilen(is) ? 'dugme onerilen-is' : !oneriTuru && is === 'gider' ? 'dugme' : 'dugme ikincil');
  const yzOkunur = YZ_OKUNUR.has(belge.mime);
  // Fotoğraf: yapay zekâ "şantiye fotoğrafı" dediyse ya da fatura/karekod bulunmayan, konumu bir şantiyeye düşen resim.
  const fotografOnerilen =
    okuma?.tur === 'santiye_fotografi' ||
    (!okuma && !t && belge.mime.startsWith('image/') && Object.values(havuz.cekim?.projeUzakliklari ?? {}).some((km) => km <= 1));

  async function yzOku(amac: 'tani' | 'sozlesme') {
    if (!yzAyar?.riza) return setRizaSoruluyor(true);
    setYzHata(null);
    setOkunuyor(amac);
    try {
      await havuzuYzIleOku(depo, servis, firma, havuz.id, amac);
      await yenile();
    } catch (e) {
      setYzHata(hataMetni(e));
    } finally {
      setOkunuyor(null);
    }
  }

  async function dosyayiAc() {
    const d = await belgeDosyasiGetir(depo, oturum.firmaId, belge.id);
    if (d) cihaz.dosyaAc(xmlMi(belge.mime) ? new Blob([d], { type: 'text/plain' }) : d, belge.ad);
  }

  return (
    <>
      <p>
        <a className="geri-baglanti" href="#/havuz">← Belge havuzu</a>
      </p>
      <h1>{havuzBasligi(havuz, belge)}</h1>
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
      {okuma && <OkumaKarti okuma={okuma} faturaGosterildi={!!t} />}
      {!okuma && yzOkunur && !(t && t.kaynak !== 'yz') && (
        <section className="kart">
          <h2><Simge ad="yz" /> Yapay zekâ ile oku</h2>
          <p className="soluk">Belgenin türünü tanır, fiş, fatura, dekont ya da çek bilgilerini okuyup formu doldurur; siz onaylarsınız.</p>
          {rizaSoruluyor ? (
            <YzRizaKutusu onVerildi={() => (setRizaSoruluyor(false), void yzOku('tani'))} onVazgec={() => setRizaSoruluyor(false)} />
          ) : (
            <button type="button" disabled={!!okunuyor} onClick={() => void yzOku('tani')}>
              {okunuyor ? 'Okunuyor…' : <><Simge ad="yz" /> Yapay zekâ ile oku</>}
            </button>
          )}
          {yzHata && <Hatalar hatalar={[yzHata]} />}
        </section>
      )}

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
        {oneriTuru && <p className="soluk kucuk">Önerilen işlem vurgulu; başkasını da seçebilirsiniz.</p>}
        <div className="havuz-islemleri">
          {yetki('gider') && (
            <a className={sinif('gider')} href={`#/havuz/${havuz.id}/gider`}>
              <Simge ad="fis" /> {t?.iade ? 'İade faturası olarak gir' : 'Gider olarak gir (fatura / fiş)'}
            </a>
          )}
          {yetki('odeme') && (
            <a className={sinif('odeme')} href={`#/havuz/${havuz.id}/odeme`}>
              <Simge ad="odeme" /> Ödeme dekontu
            </a>
          )}
          {yetki('odeme') && (
            <a className={sinif('tahsilat')} href={`#/havuz/${havuz.id}/tahsilat`}>
              <Simge ad="tahsilat" /> Tahsilat dekontu
            </a>
          )}
          {yetki('odeme') && (
            <a className={sinif('cek')} href={`#/havuz/${havuz.id}/cek-al`}>
              <Simge ad="cek" /> Alınan çek / senet
            </a>
          )}
          {yetki('odeme') && (
            <a className="dugme ikincil" href={`#/havuz/${havuz.id}/cek-ver`}>
              <Simge ad="cek" /> Verilen çek / senet
            </a>
          )}
          {belge.mime.startsWith('image/') && (yetki('belge') || yetki('ilerleme') || yetki('proje')) && (
            <a className={fotografOnerilen ? 'dugme onerilen-is' : 'dugme ikincil'} href={`#/havuz/${havuz.id}/fotograf`}>
              <Simge ad="kamera" /> Şantiye fotoğrafı olarak ekle{havuz.cekim?.tarih ? ` (${tarihYaz(havuz.cekim.tarih)})` : ''}
            </a>
          )}
          {(yetki('sozlesme') || yetki('proje') || yetki('satis')) && (
            <a className={sinif('sozlesme')} href={`#/havuz/${havuz.id}/sozlesme`}>
              <Simge ad="dosya" /> Eski sözleşmeyi programa kur (usta, kat karşılığı, satış)
            </a>
          )}
          <button type="button" className={onerilen('bagla') ? 'onerilen-is' : 'ikincil'} onClick={() => setBagla(true)}>
            <Simge ad="ek" /> Bir kayda bağla (proje, cari, sözleşme…)
          </button>
        </div>
        {bagla && (
          <BaglaPaneli satir={satir} onBaglandi={git} onVazgec={() => setBagla(false)} ilkTur={oneriTuru === 'proje' ? 'proje' : oneriTuru === 'cari' ? 'cari' : undefined} />
        )}
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
            <Simge ad="sil" /> Gereksiz, havuzdan kaldır
          </button>
        )}
      </section>
    </>
  );
}
