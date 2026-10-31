import { useCallback, useEffect, useMemo, useState } from 'react';
import { yazdir } from '../cihaz/paylas';
import {
  EKSIK_KAYNAGI_ADI,
  eksikIsDurumu,
  eksikListesiMesaji,
  MADDE_DURUMU_ADI,
  maddeGruplari,
  SAYAC_ADI,
  tamamlamaEksikleri,
  teslimHatalari,
  teslimSayimi,
} from '../hesap/teslim';
import { yerelGun } from '../hesap/tarih';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import {
  eksikIsEkle,
  eksikIsIptal,
  eksikIsKaydet,
  eksikIsYapildi,
  projeTeslimOzeti,
  teslimAyrintisi,
  teslimBaslat,
  teslimGeriAl,
  teslimIptal,
  teslimKaydet,
  teslimMaddeleriniVarsayilanYap,
  teslimTamamla,
  type BolumTeslimDurumu,
  type EksikIsSatiri,
  type ProjeTeslimOzeti,
  type TeslimAyrintisi,
  type TeslimIcerigi,
} from '../servisler/teslim';
import { yeniId } from '../veri/kimlik';
import type { TeslimMaddesi } from '../veri/tipler';
import { useUygulama, useYetki } from './baglam';
import { BelgelerKarti } from './Belgeler';
import { SozlesmeBelgesiGorunumu } from './BelgeGorunumu';
import { Alan, BosDurum, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { CariSecici } from './CariSecici';
import { PdfPaylasDugmesi, WhatsappDugmesi } from './Paylas';
import { git } from './rota';
import { Simge } from './Simge';

// Daire teslimi: proje sekmesi (bölümlerin teslim durumu, eksik işler), teslim kontrol listesi, tutanak.

const tarihYaz = (t: string) => new Date(`${t.slice(0, 10)}T00:00`).toLocaleDateString('tr-TR');
const bugun = () => yerelGun(new Date());

const DURUM_ADI: Record<BolumTeslimDurumu, string> = { bekliyor: 'Teslim edilmedi', kontrolde: 'Kontrol sürüyor', teslim_edildi: 'Teslim edildi' };
const DURUM_SINIFI: Record<BolumTeslimDurumu, string> = { bekliyor: 'rozet-taslak', kontrolde: 'rozet-gecikti', teslim_edildi: 'rozet-tamam' };

// ─── Proje sekmesi ──────────────────────────────────────────────────

type BolumSuzgeci = 'edilecek' | 'edildi' | 'hepsi';

export function TeslimSekmesi({ projeId }: { projeId: string }) {
  const { depo, oturum } = useUygulama();
  const [o, setO] = useState<ProjeTeslimOzeti | null>(null);
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [suzgec, setSuzgec] = useState<BolumSuzgeci>('edilecek');
  const yukle = useCallback(async () => {
    const [x, c] = await Promise.all([projeTeslimOzeti(depo, oturum.firmaId, projeId, bugun()), carileriListele(depo, oturum.firmaId)]);
    setCariler(c);
    setO(x);
  }, [depo, oturum.firmaId, projeId]);
  useEffect(() => {
    void yukle();
  }, [yukle]);
  if (!o) return <p>Yükleniyor…</p>;

  const bolumler = o.bolumler.filter((b) =>
    suzgec === 'hepsi' ? true : suzgec === 'edildi' ? b.durum === 'teslim_edildi' : b.durum !== 'teslim_edildi' && (b.teslimEdilecek || b.durum === 'kontrolde'),
  );
  return (
    <div className="pano">
      <div className="pano-sutun">
        <section className="kart">
          <h2>
            <Simge ad="anahtar" /> Daire teslimi
          </h2>
          <p className="soluk">
            {o.sayilar.teslimEdildi} / {o.sayilar.teslimEdilecek} bölüm teslim edildi
            {o.sayilar.kontrolde > 0 && ` · ${o.sayilar.kontrolde} bölümde kontrol sürüyor`}. Satılan ve arsa sahibine tahsisli bölümler teslim edilecek
            sayılır.
          </p>
          <div className="filtreler" role="group" aria-label="Bölüm süzgeci">
            {(
              [
                ['edilecek', 'Teslim edilecek'],
                ['edildi', 'Teslim edildi'],
                ['hepsi', 'Bütün bölümler'],
              ] as const
            ).map(([k, ad]) => (
              <button key={k} type="button" aria-pressed={suzgec === k} onClick={() => setSuzgec(k)}>
                {ad}
              </button>
            ))}
          </div>
          {bolumler.length === 0 ? (
            <BosDurum metin={suzgec === 'edilecek' ? 'Teslim bekleyen bölüm yok. Satılan ya da arsa sahibine tahsis edilen bölümler burada görünür.' : 'Bu süzgeçte bölüm yok.'} />
          ) : (
            <ul className="teslim-listesi">
              {bolumler.map((b) => (
                <li key={b.bolum.id}>
                  <a className="kart kart-baglanti" href={b.teslim ? `#/teslim/${b.teslim.id}` : `#/teslim/yeni/${b.bolum.id}`}>
                    <span className="baslik-satiri">
                      <strong>
                        {b.no} <span className="soluk">· {b.katAdi}</span>
                      </strong>
                      <span className={`etiket-cip ${DURUM_SINIFI[b.durum]}`}>{DURUM_ADI[b.durum]}</span>
                    </span>
                    <span className="soluk">
                      {b.cariAdi ? `${b.cariAdi} (${b.sifat?.toLocaleLowerCase('tr')})` : 'Satılmadı'}
                      {b.taahhut && ` · taahhüt ${tarihYaz(b.taahhut)}`}
                      {b.teslim?.tamamlandi && ` · teslim ${tarihYaz(b.teslim.tamamlandi)}`}
                    </span>
                    {b.acikEksik > 0 && (
                      <span className={b.gecikenEksik ? 'hata kucuk' : 'kucuk'}>
                        {b.acikEksik} açık eksik{b.gecikenEksik ? `, ${b.gecikenEksik} gecikti` : ''}
                      </span>
                    )}
                    {!b.teslim && b.durum !== 'teslim_edildi' && <span className="baglanti-dugmesi">Kontrolü başlat →</span>}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="pano-sutun">
        <EksikIsler projeId={projeId} ozet={o} cariler={cariler} onDegisti={yukle} onCariEklendi={(c) => setCariler((l) => [...l, { cari: c, bakiye: 0 }])} />
      </div>
    </div>
  );
}

type EksikSuzgeci = 'acik' | 'gecikti' | 'yapildi' | 'hepsi';

function EksikIsler(props: { projeId: string; ozet: ProjeTeslimOzeti; cariler: CariOzeti[]; onDegisti: () => Promise<void>; onCariEklendi: (c: CariOzeti['cari']) => void }) {
  const { firma } = useUygulama();
  const [suzgec, setSuzgec] = useState<EksikSuzgeci>('acik');
  const [acikId, setAcikId] = useState<string | null>(null);
  const [yeni, setYeni] = useState(false);
  const b = bugun();
  const durum = (x: EksikIsSatiri) => eksikIsDurumu(x.is, b);
  const liste = props.ozet.eksikler.filter((x) => (suzgec === 'hepsi' ? true : suzgec === 'acik' ? durum(x) !== 'yapildi' : durum(x) === suzgec));

  // Sorumluya göre açık işler (WhatsApp ile liste gönderme).
  const sorumlular = useMemo(() => {
    const m = new Map<string, EksikIsSatiri[]>();
    for (const x of props.ozet.eksikler) if (!x.is.yapildi && x.is.sorumluCariId) m.set(x.is.sorumluCariId, [...(m.get(x.is.sorumluCariId) ?? []), x]);
    return [...m];
  }, [props.ozet.eksikler]);
  const cari = (id: string) => props.cariler.find((c) => c.cari.id === id)?.cari;
  const projeAdi = useProjeAdi(props.projeId);

  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Eksik işler</h2>
        {!yeni && (
          <button type="button" className="ikincil" onClick={() => setYeni(true)}>
            + Eksik iş
          </button>
        )}
      </div>
      <p className="soluk kucuk">
        Teslim kontrolünde "Eksik" işaretlenenler kendiliğinden gelir; şantiye kontrolünde ya da teslimden sonra müşterinin bildirdiği eksikleri de buraya
        yazın.
      </p>
      {yeni && <EksikIsFormu projeId={props.projeId} ozet={props.ozet} cariler={props.cariler} onCariEklendi={props.onCariEklendi} onBitti={async (k) => {
            setYeni(false);
            if (k) await props.onDegisti();
          }} />}
      <div className="filtreler" role="group" aria-label="Eksik iş süzgeci">
        {(
          [
            ['acik', `Açık (${props.ozet.sayilar.acikEksik})`],
            ['gecikti', `Geciken (${props.ozet.sayilar.gecikenEksik})`],
            ['yapildi', 'Yapılan'],
            ['hepsi', 'Hepsi'],
          ] as const
        ).map(([k, ad]) => (
          <button key={k} type="button" aria-pressed={suzgec === k} onClick={() => setSuzgec(k)}>
            {ad}
          </button>
        ))}
      </div>
      {liste.length === 0 ? (
        <p className="soluk">{suzgec === 'acik' ? 'Açık eksik iş yok.' : 'Bu süzgeçte eksik iş yok.'}</p>
      ) : (
        <ul className="eksik-listesi">
          {liste.map((x) => (
            <EksikIsOgesi
              key={x.is.id}
              x={x}
              acik={acikId === x.is.id}
              onAc={() => setAcikId(acikId === x.is.id ? null : x.is.id)}
              cariler={props.cariler}
              onCariEklendi={props.onCariEklendi}
              onDegisti={props.onDegisti}
            />
          ))}
        </ul>
      )}
      {sorumlular.length > 0 && (
        <details className="sorumlu-listesi">
          <summary>Sorumlulara eksik listesi gönder ({sorumlular.length})</summary>
          <ul className="liste">
            {sorumlular.map(([id, isler]) => (
              <li key={id}>
                <span>
                  {cari(id)?.ad ?? '?'} <span className="soluk">· {isler.length} iş</span>
                </span>
                <WhatsappDugmesi
                  telefon={cari(id)?.telefon ?? null}
                  etiket="Gönder"
                  metin={() =>
                    eksikListesiMesaji({
                      firmaAdi: firma.ad,
                      projeAdi,
                      isler: isler.map((e) => ({ bolum: e.bolumAdi, baslik: e.is.baslik, aciklama: e.is.aciklama, sonTarih: e.is.sonTarih })),
                    })
                  }
                />
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function useProjeAdi(projeId: string) {
  const { depo } = useUygulama();
  const [ad, setAd] = useState('');
  useEffect(() => {
    void depo.getir('proje', projeId).then((p) => setAd(p?.ad ?? ''));
  }, [depo, projeId]);
  return ad;
}

function EksikIsOgesi(props: {
  x: EksikIsSatiri;
  acik: boolean;
  onAc: () => void;
  cariler: CariOzeti[];
  onCariEklendi: (c: CariOzeti['cari']) => void;
  onDegisti: () => Promise<void>;
}) {
  const { depo, servis } = useUygulama();
  const e = props.x.is;
  const d = eksikIsDurumu(e, bugun());
  const [form, setForm] = useState({ baslik: e.baslik, aciklama: e.aciklama, sorumluCariId: e.sorumluCariId, sonTarih: e.sonTarih ?? '' });
  const [yapildi, setYapildi] = useState({ tarih: bugun(), not: '' });
  const [sorumluSec, setSorumluSec] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const degisti = form.baslik !== e.baslik || form.aciklama !== e.aciklama || form.sorumluCariId !== e.sorumluCariId || (form.sonTarih || null) !== e.sonTarih;
  const calistir = async (is: () => Promise<unknown>) => {
    setHata(null);
    try {
      await is();
      await props.onDegisti();
    } catch (x) {
      setHata(hataMetni(x));
    }
  };
  const sorumluAdi = props.cariler.find((c) => c.cari.id === form.sorumluCariId)?.cari.ad;
  return (
    <li className={`eksik-ogesi eksik-${d}`}>
      <button type="button" className="eksik-ozet" aria-expanded={props.acik} onClick={props.onAc}>
        <span className="baslik-satiri">
          <strong>{e.baslik}</strong>
          <span className={`etiket-cip ${d === 'yapildi' ? 'rozet-tamam' : d === 'gecikti' ? 'rozet-gecikti' : 'rozet-taslak'}`}>
            {d === 'yapildi' ? `Yapıldı ${tarihYaz(e.yapildi!)}` : d === 'gecikti' ? 'Gecikti' : 'Açık'}
          </span>
        </span>
        <span className="soluk kucuk">
          {props.x.bolumAdi ?? 'Ortak alan'} · {props.x.sorumluAdi ?? 'sorumlu yok'}
          {e.sonTarih && ` · son gün ${tarihYaz(e.sonTarih)}`} · {EKSIK_KAYNAGI_ADI[e.kaynak]}
        </span>
        {e.aciklama && <span className="kucuk">{e.aciklama}</span>}
      </button>
      {props.acik && (
        <div className="eksik-ayrinti">
          {!e.teslimMaddesiId && (
            <Alan etiket="Eksik">
              <input value={form.baslik} onChange={(x) => setForm({ ...form, baslik: x.target.value })} />
            </Alan>
          )}
          {e.teslimMaddesiId && <p className="soluk kucuk">Adı ve notu teslim kontrolündeki maddeden gelir; orada değiştirin.</p>}
          {!e.teslimMaddesiId && (
            <Alan etiket="Açıklama">
              <textarea rows={2} value={form.aciklama} onChange={(x) => setForm({ ...form, aciklama: x.target.value })} />
            </Alan>
          )}
          <div className="iki-sutun">
            <div className="alan">
              <span className="alan-etiket">Sorumlu</span>
              {sorumluSec ? (
                <CariSecici
                  cariler={props.cariler.filter((c) => c.cari.roller.some((r) => r === 'usta' || r === 'taseron' || r === 'tedarikci'))}
                  secili={form.sorumluCariId}
                  oncelikli={['usta', 'taseron']}
                  bosEtiket="Sorumlu yok"
                  acikBasla
                  onVazgec={() => setSorumluSec(false)}
                  onSec={(c) => (setForm({ ...form, sorumluCariId: c }), setSorumluSec(false))}
                  hizliEkle={{ rol: 'usta', onEklendi: (c) => (props.onCariEklendi(c), setForm({ ...form, sorumluCariId: c.id }), setSorumluSec(false)) }}
                />
              ) : (
                <button type="button" className="ikincil" onClick={() => setSorumluSec(true)}>
                  {sorumluAdi ?? 'Sorumlu seç'}
                </button>
              )}
            </div>
            <Alan etiket="Son gün">
              <input type="date" value={form.sonTarih} onChange={(x) => setForm({ ...form, sonTarih: x.target.value })} />
            </Alan>
          </div>
          {degisti && (
            <div className="dugmeler">
              <button
                type="button"
                onClick={() =>
                  void calistir(() =>
                    eksikIsKaydet(depo, servis, e.id, {
                      baslik: e.teslimMaddesiId ? e.baslik : form.baslik,
                      aciklama: e.teslimMaddesiId ? e.aciklama : form.aciklama,
                      sorumluCariId: form.sorumluCariId,
                      sonTarih: form.sonTarih || null,
                    }),
                  )
                }
              >
                Kaydet
              </button>
            </div>
          )}
          {e.yapildi ? (
            <div className="satir-ici">
              <span>
                Yapıldı: {tarihYaz(e.yapildi)}
                {e.yapildiNot && ` · ${e.yapildiNot}`}
              </span>
              <button type="button" className="baglanti-dugmesi" onClick={() => void calistir(() => eksikIsYapildi(depo, servis, e.id, null))}>
                Geri al
              </button>
            </div>
          ) : (
            <div className="satir-ici yapildi-satiri">
              <input type="date" className="kisa-tarih" value={yapildi.tarih} aria-label="Yapıldığı gün" onChange={(x) => setYapildi({ ...yapildi, tarih: x.target.value })} />
              <input value={yapildi.not} placeholder="Not (isteğe bağlı)" aria-label="Yapıldı notu" onChange={(x) => setYapildi({ ...yapildi, not: x.target.value })} />
              <button type="button" onClick={() => void calistir(() => eksikIsYapildi(depo, servis, e.id, yapildi.tarih, yapildi.not))}>
                Yapıldı
              </button>
            </div>
          )}
          <BelgelerKarti bagliTur="eksikIs" bagliId={e.id} varsayilanTur="fotograf" baslik="Fotoğraflar (önce / sonra)" />
          <div className="dugmeler">
            {e.teslimId && (
              <a className="baglanti-dugmesi" href={`#/teslim/${e.teslimId}`}>
                Teslim kontrolüne git
              </a>
            )}
            {(!e.teslimMaddesiId || e.yapildi) && (
              <button type="button" className="baglanti-dugmesi tehlikeli-baglanti" onClick={() => void calistir(() => eksikIsIptal(depo, servis, e.id))}>
                Eksik işi kaldır
              </button>
            )}
          </div>
          {hata && <Hatalar hatalar={[hata]} />}
        </div>
      )}
    </li>
  );
}

function EksikIsFormu(props: { projeId: string; ozet: ProjeTeslimOzeti; cariler: CariOzeti[]; onCariEklendi: (c: CariOzeti['cari']) => void; onBitti: (kaydedildi: boolean) => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const [f, setF] = useState<{ bolumId: string; kaynak: 'kontrol' | 'musteri'; baslik: string; aciklama: string; sorumluCariId: string | null; sonTarih: string }>({
    bolumId: '',
    kaynak: 'kontrol',
    baslik: '',
    aciklama: '',
    sorumluCariId: null,
    sonTarih: '',
  });
  const [sorumluSec, setSorumluSec] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const kaydet = async () => {
    setHata(null);
    try {
      await eksikIsEkle(depo, servis, {
        projeId: props.projeId,
        bolumId: f.bolumId || null,
        kaynak: f.kaynak,
        baslik: f.baslik,
        aciklama: f.aciklama,
        sorumluCariId: f.sorumluCariId,
        sonTarih: f.sonTarih || null,
      });
      await props.onBitti(true);
    } catch (e) {
      setHata(hataMetni(e));
    }
  };
  const sorumluAdi = props.cariler.find((c) => c.cari.id === f.sorumluCariId)?.cari.ad;
  return (
    <div className="kart ic-kart">
      <div className="iki-sutun">
        <Alan etiket="Yer">
          <select value={f.bolumId} onChange={(e) => setF({ ...f, bolumId: e.target.value })}>
            <option value="">Ortak alan / genel</option>
            {props.ozet.bolumler.map((b) => (
              <option key={b.bolum.id} value={b.bolum.id}>
                {b.no}
                {b.cariAdi ? ` · ${b.cariAdi}` : ''}
              </option>
            ))}
          </select>
        </Alan>
        <div className="alan">
          <span className="alan-etiket">Kim buldu</span>
          <div className="filtreler" role="group" aria-label="Kaynak">
            {(['kontrol', 'musteri'] as const).map((k) => (
              <button key={k} type="button" aria-pressed={f.kaynak === k} onClick={() => setF({ ...f, kaynak: k })}>
                {EKSIK_KAYNAGI_ADI[k]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <Alan etiket="Eksik">
        <input value={f.baslik} placeholder="Örn. banyo silikonu, salon prizi çalışmıyor" autoFocus onChange={(e) => setF({ ...f, baslik: e.target.value })} />
      </Alan>
      <Alan etiket="Açıklama">
        <textarea rows={2} value={f.aciklama} onChange={(e) => setF({ ...f, aciklama: e.target.value })} />
      </Alan>
      <div className="iki-sutun">
        <div className="alan">
              <span className="alan-etiket">Sorumlu</span>
          {sorumluSec ? (
            <CariSecici
              cariler={props.cariler.filter((c) => c.cari.roller.some((r) => r === 'usta' || r === 'taseron' || r === 'tedarikci'))}
              secili={f.sorumluCariId}
              oncelikli={['usta', 'taseron']}
              bosEtiket="Sorumlu yok"
              acikBasla
              onVazgec={() => setSorumluSec(false)}
              onSec={(c) => (setF({ ...f, sorumluCariId: c }), setSorumluSec(false))}
              hizliEkle={{ rol: 'usta', onEklendi: (c) => (props.onCariEklendi(c), setF({ ...f, sorumluCariId: c.id }), setSorumluSec(false)) }}
            />
          ) : (
            <button type="button" className="ikincil" onClick={() => setSorumluSec(true)}>
              {sorumluAdi ?? 'Sorumlu seç'}
            </button>
          )}
        </div>
        <Alan etiket="Son gün">
          <input type="date" value={f.sonTarih} onChange={(e) => setF({ ...f, sonTarih: e.target.value })} />
        </Alan>
      </div>
      {hata && <Hatalar hatalar={[hata]} />}
      <div className="dugmeler">
        <button type="button" disabled={!f.baslik.trim()} onClick={() => void kaydet()}>
          Kaydet
        </button>
        <button type="button" className="ikincil" onClick={() => void props.onBitti(false)}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

// ─── Teslim kontrolü ────────────────────────────────────────────────

/** `#/teslim/yeni/:bolumId`: bölümün kontrolünü açar (varsa olanına gider). */
export function TeslimBaslatEkrani({ bolumId }: { bolumId: string }) {
  const { depo, servis, firma } = useUygulama();
  const [hata, setHata] = useState<string | null>(null);
  useEffect(() => {
    let iptal = false;
    teslimBaslat(depo, servis, firma, bolumId, bugun())
      .then((t) => {
        // Adres değişsin ama geri tuşu bu ara ekrana dönmesin.
        if (!iptal) window.location.replace(`#/teslim/${t.id}`);
      })
      .catch((e) => !iptal && setHata(hataMetni(e)));
    return () => {
      iptal = true;
    };
  }, [depo, servis, firma, bolumId]);
  return hata ? <Hatalar hatalar={[hata]} /> : <p>Teslim kontrolü açılıyor…</p>;
}

interface Form {
  teslimAlan: string;
  tarih: string;
  maddeler: TeslimMaddesi[];
  sayaclar: TeslimIcerigi['sayaclar'];
  anahtarSayisi: string;
  eksikSonTarih: string;
  not: string;
}

const formdan = (t: TeslimAyrintisi['teslim']): Form => ({
  teslimAlan: t.teslimAlan,
  tarih: t.tarih,
  maddeler: t.maddeler,
  sayaclar: t.sayaclar,
  anahtarSayisi: t.anahtarSayisi === null ? '' : String(t.anahtarSayisi),
  eksikSonTarih: t.eksikSonTarih ?? '',
  not: t.not,
});

const icerige = (f: Form): TeslimIcerigi => ({
  teslimAlan: f.teslimAlan,
  tarih: f.tarih,
  maddeler: f.maddeler,
  sayaclar: f.sayaclar,
  anahtarSayisi: f.anahtarSayisi.trim() === '' ? null : Number(f.anahtarSayisi),
  eksikSonTarih: f.eksikSonTarih || null,
  not: f.not,
});

export function TeslimEkrani({ id }: { id: string }) {
  const { depo, servis, firma, yenile: firmaYenile } = useUygulama();
  const yetki = useYetki();
  const [a, setA] = useState<TeslimAyrintisi | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [duzenle, setDuzenle] = useState(false);
  const [yeniMadde, setYeniMadde] = useState({ grup: '', ad: '' });
  const [hata, setHata] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const yukle = useCallback(async () => {
    const x = await teslimAyrintisi(depo, firma, id);
    setA(x);
    if (x) setForm(formdan(x.teslim));
  }, [depo, firma, id]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  const kayitli = useMemo(() => (a ? JSON.stringify(icerige(formdan(a.teslim))) : ''), [a]);
  if (a === undefined || (a && !form)) return <p>Yükleniyor…</p>;
  if (a === null || !form) return <p className="hata">Teslim kaydı bulunamadı.</p>;
  const t = a.teslim;
  const degisti = JSON.stringify(icerige(form)) !== kayitli;
  const hatalar = teslimHatalari(icerige(form));
  const sayim = teslimSayimi(form.maddeler);
  const eksikIs = new Map(a.eksikler.map((e) => [e.id, e]));

  const yaz = <K extends keyof Form>(k: K, v: Form[K]) => setForm({ ...form, [k]: v });
  const madde = (mid: string, d: Partial<TeslimMaddesi>) => yaz('maddeler', form.maddeler.map((m) => (m.id === mid ? { ...m, ...d } : m)));

  const kaydet = async (sonra?: () => void) => {
    setHata(null);
    setMesaj(null);
    try {
      await teslimKaydet(depo, servis, id, icerige(form));
      await yukle();
      setMesaj('Kaydedildi.');
      sonra?.();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };

  return (
    <>
      <p className="geri">
        <a className="geri-baglanti" href={`#/projeler/${t.projeId}/teslim`}>
          ← {a.projeAdi} · Teslim
        </a>
      </p>
      <div className="baslik-satiri">
        <h1>
          {a.bolumAdi} teslimi <span className="soluk">· {a.katAdi}</span>
        </h1>
        <span className={`etiket-cip ${t.tamamlandi ? 'rozet-tamam' : 'rozet-gecikti'}`}>{t.tamamlandi ? `Teslim edildi ${tarihYaz(t.tamamlandi)}` : 'Kontrol sürüyor'}</span>
      </div>
      {a.satisImzali === false && <p className="mesaj mesaj-uyari">Satış protokolü imzalanmadı; imzalanmadan teslim tamamlanmaz.</p>}

      <div className="form-duzeni">
        <div className="form-ana">
          <section className="kart">
            <div className="iki-sutun">
              <div className="alan">
                <span className="alan-etiket">{a.sifat}</span>
                <p>
                  <strong>{a.cariAdi ?? 'Seçilmedi'}</strong>
                  {!a.cariAdi && <span className="blok soluk kucuk">Bölüm satılmamış ve arsa sahibine tahsisli değil.</span>}
                </p>
              </div>
              <Alan etiket="Teslim alan kişi" aciklama="Vekil, eş… Boşsa kendisi.">
                <input value={form.teslimAlan} onChange={(e) => yaz('teslimAlan', e.target.value)} />
              </Alan>
              <Alan etiket="Kontrol günü">
                <input type="date" value={form.tarih} onChange={(e) => yaz('tarih', e.target.value)} />
              </Alan>
            </div>
          </section>

          <section className="kart">
            <div className="baslik-satiri">
              <h2>Kontrol listesi</h2>
              <span className="soluk kucuk">
                {sayim.uygun} uygun · {sayim.eksik} eksik · {sayim.bakilmadi} bakılmadı
              </span>
            </div>
            <p className="soluk kucuk">Daireyi alıcıyla birlikte gezin; her madde için Uygun, Eksik ya da Yok seçin. Eksik maddeler eksik iş olarak takip edilir.</p>
            {maddeGruplari(form.maddeler).map((g) => (
              <div key={g.grup} className="teslim-grubu">
                <div className="baslik-satiri">
                  <h3>{g.grup}</h3>
                  {g.maddeler.some((m) => m.durum === null) && (
                    <button
                      type="button"
                      className="baglanti-dugmesi"
                      onClick={() => yaz('maddeler', form.maddeler.map((m) => ((m.grup.trim() || 'Diğer') === g.grup && m.durum === null ? { ...m, durum: 'uygun' } : m)))}
                    >
                      Kalanlar uygun
                    </button>
                  )}
                </div>
                {g.maddeler.map((m) => {
                  const e = m.eksikIsId ? eksikIs.get(m.eksikIsId) : undefined;
                  return (
                    <div key={m.id} className={`teslim-maddesi${m.durum ? ` madde-${m.durum}` : ''}`}>
                      <div className="teslim-maddesi-ust">
                        {duzenle ? (
                          <input value={m.ad} aria-label="Madde adı" onChange={(x) => madde(m.id, { ad: x.target.value })} />
                        ) : (
                          <span className="teslim-maddesi-adi">{m.ad}</span>
                        )}
                        <div className="filtreler durum-secimi" role="group" aria-label={`${m.ad} durumu`}>
                          {(['uygun', 'eksik', 'yok'] as const).map((d) => (
                            <button key={d} type="button" aria-pressed={m.durum === d} onClick={() => madde(m.id, { durum: m.durum === d ? null : d })}>
                              {d === 'yok' ? 'Yok' : MADDE_DURUMU_ADI[d]}
                            </button>
                          ))}
                          {duzenle && (
                            <button type="button" aria-label={`${m.ad} maddesini çıkar`} onClick={() => yaz('maddeler', form.maddeler.filter((x) => x.id !== m.id))}>
                              ✕
                            </button>
                          )}
                        </div>
                      </div>
                      {m.durum === 'eksik' && (
                        <input className="teslim-notu" value={m.not} placeholder="Ne eksik? (tutanağa ve eksik işe yazılır)" aria-label={`${m.ad} notu`} onChange={(x) => madde(m.id, { not: x.target.value })} />
                      )}
                      {e && (
                        <span className="soluk kucuk">
                          Eksik iş: {e.yapildi ? `yapıldı ${tarihYaz(e.yapildi)}` : eksikIsDurumu(e, bugun()) === 'gecikti' ? 'gecikti' : 'açık'}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {duzenle ? (
              <div className="kart ic-kart">
                <div className="iki-sutun">
                  <Alan etiket="Grup">
                    <input list="teslim-gruplari" value={yeniMadde.grup} placeholder="Genel" onChange={(e) => setYeniMadde({ ...yeniMadde, grup: e.target.value })} />
                    <datalist id="teslim-gruplari">
                      {maddeGruplari(form.maddeler).map((g) => (
                        <option key={g.grup} value={g.grup} />
                      ))}
                    </datalist>
                  </Alan>
                  <Alan etiket="Madde">
                    <input value={yeniMadde.ad} onChange={(e) => setYeniMadde({ ...yeniMadde, ad: e.target.value })} />
                  </Alan>
                </div>
                <div className="dugmeler">
                  <button
                    type="button"
                    className="ikincil"
                    disabled={!yeniMadde.ad.trim()}
                    onClick={() => {
                      yaz('maddeler', [...form.maddeler, { id: yeniId(), grup: yeniMadde.grup.trim() || 'Genel', ad: yeniMadde.ad.trim(), durum: null, not: '', eksikIsId: null }]);
                      setYeniMadde({ ...yeniMadde, ad: '' });
                    }}
                  >
                    + Madde ekle
                  </button>
                  <button type="button" className="ikincil" onClick={() => setDuzenle(false)}>
                    Düzenlemeyi bitir
                  </button>
                  {yetki('ayar') && (
                    <button
                      type="button"
                      className="baglanti-dugmesi"
                      onClick={() =>
                        void teslimMaddeleriniVarsayilanYap(servis, firma, form.maddeler)
                          .then(firmaYenile)
                          .then(() => setMesaj('Liste sonraki teslimlerde de kullanılacak.'))
                          .catch((e) => setHata(hataMetni(e)))
                      }
                    >
                      Bu listeyi sonraki teslimlerde de kullan
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <button type="button" className="baglanti-dugmesi" onClick={() => setDuzenle(true)}>
                Listeyi düzenle (madde ekle / çıkar)
              </button>
            )}
          </section>
        </div>

        <div className="form-yan">
          <section className="kart">
            <h2>Sayaçlar ve anahtar</h2>
            {form.sayaclar.map((s, i) => (
              <div key={s.tur} className="iki-sutun">
                <Alan etiket={`${SAYAC_ADI[s.tur]} sayaç no`}>
                  <input value={s.no} inputMode="numeric" onChange={(e) => yaz('sayaclar', form.sayaclar.map((x, j) => (j === i ? { ...x, no: e.target.value } : x)))} />
                </Alan>
                <Alan etiket="Endeks">
                  <input value={s.endeks} inputMode="decimal" onChange={(e) => yaz('sayaclar', form.sayaclar.map((x, j) => (j === i ? { ...x, endeks: e.target.value } : x)))} />
                </Alan>
              </div>
            ))}
            <Alan etiket="Teslim edilen anahtar (adet)">
              <input className="kisa" inputMode="numeric" value={form.anahtarSayisi} onChange={(e) => yaz('anahtarSayisi', e.target.value)} />
            </Alan>
          </section>
          <section className="kart">
            <Alan etiket="Eksiklerin giderileceği gün" aciklama="Tutanağa yazılır; eksik işlerin son günü olur.">
              <input type="date" value={form.eksikSonTarih} onChange={(e) => yaz('eksikSonTarih', e.target.value)} />
            </Alan>
            <Alan etiket="Not" aciklama="Tutanağa yazılır.">
              <textarea rows={3} value={form.not} onChange={(e) => yaz('not', e.target.value)} />
            </Alan>
          </section>
        </div>
      </div>

      <div className="kaydet-cubugu">
        {hatalar.length > 0 && <Hatalar hatalar={hatalar} />}
        {hata && <Hatalar hatalar={[hata]} />}
        {mesaj && !degisti && <p className="mesaj mesaj-basari">{mesaj}</p>}
        <div className="dugmeler">
          <button type="button" disabled={!degisti || hatalar.length > 0} onClick={() => void kaydet()}>
            Kaydet
          </button>
          <button type="button" className="ikincil" onClick={() => (degisti ? void kaydet(() => git(`teslim/${id}/tutanak`)) : git(`teslim/${id}/tutanak`))}>
            {degisti ? 'Kaydet ve tutanağı gör' : 'Tutanağı gör / yazdır'}
          </button>
        </div>
      </div>

      <TamamlamaKarti a={a} degisti={degisti} onDegisti={yukle} />

      <BelgelerKarti bagliTur="daireTeslimi" bagliId={t.id} varsayilanTur="sozlesme" baslik="İmzalı tutanak ve fotoğraflar" />
    </>
  );
}

function TamamlamaKarti({ a, degisti, onDegisti }: { a: TeslimAyrintisi; degisti: boolean; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const t = a.teslim;
  const [tarih, setTarih] = useState(bugun() < t.tarih ? t.tarih : bugun());
  const [arsaNotu, setArsaNotu] = useState(false);
  const eksikler = tamamlamaEksikleri(t);
  const [iptalHata, setIptalHata] = useState<string | null>(null);
  return (
    <section className="kart">
      <h2>Teslim</h2>
      {t.tamamlandi ? (
        <>
          <p className="mesaj mesaj-basari">
            Bölüm {tarihYaz(t.tamamlandi)} tarihinde teslim edildi
            {a.satisImzali ? '; satışa anahtar teslimi yazıldı' : ''}.
          </p>
          {arsaNotu && (
            <p className="mesaj mesaj-not">
              Arsa sahibinin bütün daireleri teslim edildi. Kira yardımı ve gecikme cezasının durması için kat karşılığı sözleşmesinde teslim alma gününü yazın:{' '}
              <a href={`#/projeler/${t.projeId}/arsa`}>Arsa sahipleri</a>
            </p>
          )}
          <button type="button" className="baglanti-dugmesi" onClick={() => void degistir('Teslimi geri al', async (g) => (await teslimGeriAl(depo, servis, t.id, g), await onDegisti()))}>
            Teslimi geri al
          </button>
        </>
      ) : (
        <>
          {eksikler.length > 0 && <Hatalar hatalar={eksikler} />}
          {degisti && <p className="soluk kucuk">Önce değişiklikleri kaydedin.</p>}
          <div className="satir-ici">
            <input type="date" className="kisa-tarih" value={tarih} aria-label="Teslim günü" onChange={(e) => setTarih(e.target.value)} />
            <button
              type="button"
              disabled={degisti || eksikler.length > 0 || a.satisImzali === false}
              onClick={() =>
                void degistir('Teslim', async (g) => {
                  const r = await teslimTamamla(depo, servis, t.id, tarih, g);
                  setArsaNotu(r.arsaSahibiTamam);
                  await onDegisti();
                })
              }
            >
              <Simge ad="anahtar" /> Teslimi tamamla
            </button>
          </div>
          <p className="soluk kucuk">Bölüm "teslim edildi" olur{a.satisImzali ? ', satışa anahtar teslimi yazılır' : ''}. Eksikler eksik iş olarak takip edilmeye devam eder.</p>
          <button
            type="button"
            className="baglanti-dugmesi tehlikeli-baglanti"
            onClick={() =>
              void teslimIptal(depo, servis, t.id)
                .then(() => git(`projeler/${t.projeId}/teslim`))
                .catch((e) => setIptalHata(hataMetni(e)))
            }
          >
            Kontrolü sil
          </button>
          {iptalHata && <Hatalar hatalar={[iptalHata]} />}
        </>
      )}
      {kutu}
      {hata && <Hatalar hatalar={[hata]} />}
    </section>
  );
}

export function TeslimTutanagiEkrani({ id }: { id: string }) {
  const { depo, firma } = useUygulama();
  const [a, setA] = useState<TeslimAyrintisi | null | undefined>(undefined);
  useEffect(() => {
    void teslimAyrintisi(depo, firma, id).then(setA);
  }, [depo, firma, id]);
  if (a === undefined) return <p>Yükleniyor…</p>;
  if (a === null) return <p className="hata">Teslim kaydı bulunamadı.</p>;
  const eksik = tamamlamaEksikleri(a.teslim);
  return (
    <>
      <div className="yazdirma-gizle">
        <p>
          <a className="geri-baglanti" href={`#/teslim/${id}`}>
            ← Teslim kontrolüne dön
          </a>
        </p>
        {eksik.length > 0 && <p className="mesaj mesaj-not">{eksik.join(' ')} Metinde "…" olarak görünür.</p>}
        <div className="dugmeler">
          <button type="button" onClick={() => void yazdir()}>
            <Simge ad="yazdir" /> Yazdır / PDF olarak kaydet
          </button>
          <PdfPaylasDugmesi ad={`Teslim tutanağı ${a.tutanak.altBaslik}`} mesaj={`Merhaba, ${a.tutanak.altBaslik} teslim tutanağı ekte. ${firma.ad}`} cariId={a.teslim.cariId} />
        </div>
      </div>
      <SozlesmeBelgesiGorunumu metin={a.tutanak} logo={firma.logo} taslak={!a.teslim.tamamlandi} surum={1} />
    </>
  );
}

