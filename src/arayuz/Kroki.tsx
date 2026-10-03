import { useEffect, useRef, useState, type ReactNode } from 'react';
import { bolumNo, kutucukOzeti } from '../hesap/bolum';
import { odaTipiOku, type Dubleks } from '../hesap/odaTipi';
import { sayiOku } from '../hesap/sayi';
import {
  blokOzellikleriniDegistir,
  blokOzellikleriniKopyala,
  farkliAlanlar,
  topluOzellikVer,
  YONLER,
  type BolumOzellikleri,
} from '../servisler/bina';
import type { BlokYapisi, ProjeYapisi } from '../servisler/proje';
import type { BagimsizBolum, Blok } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { BlokEkleFormu, KatEkleFormu } from './BinaEkleme';
import { DubleksSecimi, OdaTipiSecimi } from './OdaTipiSecimi';
import { BinaOzellikleriAlanlari, type OzellikFormu } from './BlokFormu';
import { useSurukleSecim, type HucreKonumu } from './surukleSecim';

// Bina krokisi: her blokta katlar satır (üstteki kat yukarıda), dikey hatlar sütun.
// Kutucuğa dokununca bölüm açılır. "Seç" ile kutucuk, hat başlığı (H1…) ya da kat adıyla
// çoklu seçim yapılır ve seçilenlere toplu özellik verilir.

export interface KrokiRenkleri {
  /** Kutucuğun sınıfı (renk). */
  sinif: (b: BagimsizBolum) => string;
  /** Erişilebilir ad için durum metni. */
  durum: (b: BagimsizBolum) => string;
  lejant: ReactNode;
}

/** Yeni açılan kutuyu ekrana getirir (hareket azaltma tercihine uyar). */
export function gorunurYap(el: HTMLElement | null) {
  const azalt = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  el?.scrollIntoView({ behavior: azalt ? 'auto' : 'smooth', block: 'start' });
}

/** Cephe: sekiz yönden bir ya da birkaçı; "Kuzeybatı" ya da "Güney, Doğu" olarak saklanır. */
export function YonSecimi({ deger, onDegisti }: { deger: string; onDegisti: (d: string) => void }) {
  const secili = new Set(deger.split(',').map((y) => y.trim()).filter(Boolean));
  return (
    <div className="filtreler yonler" role="group" aria-label="Cephe">
      {YONLER.map((y) => (
        <button
          key={y}
          type="button"
          aria-pressed={secili.has(y)}
          onClick={() => {
            const yeni = new Set(secili);
            if (yeni.has(y)) yeni.delete(y);
            else yeni.add(y);
            onDegisti(YONLER.filter((x) => yeni.has(x)).join(', '));
          }}
        >
          {y}
        </button>
      ))}
    </div>
  );
}

// ─── Toplu özellik ─────────────────────────────────────────────────

type UcDurum = '' | 'var' | 'yok';

interface TopluForm {
  /** null: değiştirme */
  odaTipi: string | null;
  /** undefined: değiştirme, null: dubleks değil */
  dubleks: Dubleks | null | undefined;
  brutM2: string;
  netM2: string;
  cephe: string;
  balkon: UcDurum;
  otopark: UcDurum;
  depo: UcDurum;
  ozellikler: string;
}

const BOS_TOPLU: TopluForm = { odaTipi: null, dubleks: undefined, brutM2: '', netM2: '', cephe: '', balkon: '', otopark: '', depo: '', ozellikler: '' };

const ALAN_ADI: Record<keyof BolumOzellikleri, string> = {
  odaSayisi: 'oda tipi',
  salonSayisi: 'oda tipi',
  dubleks: 'dubleks',
  brutM2: 'brüt m²',
  netM2: 'net m²',
  cephe: 'cephe',
  balkon: 'balkon',
  otopark: 'otopark',
  depo: 'depo',
  ozellikler: 'özellikler',
};

/** Boş, "yok" ya da boş liste olan değerin üzerine yazmak uyarı gerektirmez. */
const doluMu = (d: unknown) => d !== null && d !== false && d !== '' && !(Array.isArray(d) && d.length === 0);

/** Yalnızca doldurulan alanlar değişiklik olur. */
function degisiklikOku(f: TopluForm): { degisiklik: Partial<BolumOzellikleri>; hatalar: string[] } {
  const d: Partial<BolumOzellikleri> = {};
  const hatalar: string[] = [];
  const oda = f.odaTipi ? odaTipiOku(f.odaTipi) : null;
  if (oda) {
    d.odaSayisi = oda.oda;
    d.salonSayisi = oda.salon;
  }
  if (f.dubleks !== undefined) d.dubleks = f.dubleks;
  for (const a of ['brutM2', 'netM2'] as const) {
    if (!f[a].trim()) continue;
    const s = sayiOku(f[a]);
    if (s === null) hatalar.push(`${a === 'brutM2' ? 'Brüt' : 'Net'} m² sayı olarak yazılmalı.`);
    else d[a] = s;
  }
  if (f.cephe) d.cephe = f.cephe;
  for (const a of ['balkon', 'otopark', 'depo'] as const) if (f[a]) d[a] = f[a] === 'var';
  if (f.ozellikler.trim()) d.ozellikler = f.ozellikler.split(',').map((o) => o.trim()).filter(Boolean);
  return { degisiklik: d, hatalar };
}

function TopluOzellikFormu(props: { bolumler: { bolum: BagimsizBolum; etiket: string }[]; onBitti: (mesaj: string) => Promise<void>; onVazgec: () => void }) {
  const { depo, servis } = useUygulama();
  const [form, setForm] = useState<TopluForm>(BOS_TOPLU);
  const [haric, setHaric] = useState<Set<string>>(new Set());
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);
  const kutuRef = useRef<HTMLElement>(null);
  useEffect(() => gorunurYap(kutuRef.current), []);
  const yaz = <K extends keyof TopluForm>(a: K, v: TopluForm[K]) => setForm((f) => ({ ...f, [a]: v }));
  const { degisiklik } = degisiklikOku(form);
  const doluVar = Object.keys(degisiklik).length > 0;

  async function uygula() {
    const { degisiklik, hatalar } = degisiklikOku(form);
    if (Object.keys(degisiklik).length === 0) hatalar.push('Değiştirilecek en az bir özellik girin.');
    setHatalar(hatalar);
    if (hatalar.length > 0) return;
    setIslemde(true);
    try {
      const ids = props.bolumler.map((x) => x.bolum.id).filter((id) => !haric.has(id));
      const sayi = await topluOzellikVer(depo, servis, ids, degisiklik);
      await props.onBitti(`${sayi} bölüm güncellendi.`);
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  const ucDurum = (a: 'balkon' | 'otopark' | 'depo', etiket: string) => (
    <Alan etiket={etiket}>
      <select value={form[a]} onChange={(e) => yaz(a, e.target.value as UcDurum)}>
        <option value="">Değiştirme</option>
        <option value="var">Var</option>
        <option value="yok">Yok</option>
      </select>
    </Alan>
  );

  return (
    <section ref={kutuRef} className="kart toplu-form" aria-labelledby="toplu-baslik">
      <h2 id="toplu-baslik">{props.bolumler.length} bölüme özellik ver</h2>
      <p className="soluk">Yalnızca doldurduğunuz alanlar uygulanır; boş bırakılanlar değişmez.</p>
      <OdaTipiSecimi etiket="Oda tipi (seçilmezse değişmez)" deger={form.odaTipi} onDegisti={(t) => yaz('odaTipi', t)} />
      <DubleksSecimi degistirme deger={form.dubleks} onDegisti={(d) => yaz('dubleks', d)} />
      <div className="iki-sutun">
        <Alan etiket="Brüt m²">
          <input value={form.brutM2} inputMode="decimal" onChange={(e) => yaz('brutM2', e.target.value)} />
        </Alan>
        <Alan etiket="Net m²">
          <input value={form.netM2} inputMode="decimal" onChange={(e) => yaz('netM2', e.target.value)} />
        </Alan>
        {ucDurum('balkon', 'Balkon')}
        {ucDurum('otopark', 'Otopark')}
        {ucDurum('depo', 'Depo')}
      </div>
      <div className="alan">
        <span className="alan-etiket">Cephe</span>
        <YonSecimi deger={form.cephe} onDegisti={(v) => yaz('cephe', v)} />
      </div>
      <Alan etiket="Diğer özellikler" aciklama="Virgülle ayırın; doldurulursa mevcut listenin yerine geçer.">
        <input value={form.ozellikler} onChange={(e) => yaz('ozellikler', e.target.value)} />
      </Alan>

      {doluVar && (
        <>
          <h3>Uygulanacak bölümler</h3>
          <ul className="liste onizleme">
            {props.bolumler.map(({ bolum, etiket }) => {
              const farkli = farkliAlanlar(bolum, degisiklik).filter((a) => doluMu(bolum[a]));
              return (
                <li key={bolum.id}>
                  <label className="onay-kutusu">
                    <input
                      type="checkbox"
                      checked={!haric.has(bolum.id)}
                      onChange={(e) => {
                        const h = new Set(haric);
                        if (e.target.checked) h.delete(bolum.id);
                        else h.add(bolum.id);
                        setHaric(h);
                      }}
                    />
                    <span>
                      {etiket}
                      {farkli.length > 0 && (
                        <span className="uzerine-yaz"> · üzerine yazılacak: {[...new Set(farkli.map((a) => ALAN_ADI[a]))].join(', ')}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Hatalar hatalar={hatalar} />
      <div className="dugmeler">
        <button type="button" onClick={() => void uygula()} disabled={islemde || !doluVar}>
          {islemde ? 'Uygulanıyor…' : `${props.bolumler.length - haric.size} bölüme uygula`}
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec} disabled={islemde}>
          Vazgeç
        </button>
      </div>
    </section>
  );
}

// ─── Blok başlığı: özellikler ve kopyalama ─────────────────────────

const ozellikOzeti = (b: Blok) =>
  [
    b.asansorSayisi > 0 ? `${b.asansorSayisi} asansör` : 'asansörsüz',
    b.kapaliOtopark && 'kapalı otopark',
    b.siginak && 'sığınak',
    b.jenerator && 'jeneratör',
  ]
    .filter(Boolean)
    .join(' · ');

function BlokBasligi(props: { blok: Blok; digerBloklar: Blok[]; onDegisti: () => Promise<void>; onMesaj: (m: string) => void }) {
  const { depo, servis } = useUygulama();
  const { blok } = props;
  const [ozellik, setOzellik] = useState<OzellikFormu | null>(null);
  const [kopya, setKopya] = useState(false);
  const [katFormu, setKatFormu] = useState(false);
  const [hatalar, setHatalar] = useState<string[]>([]);

  async function ozellikKaydet(o: OzellikFormu) {
    try {
      const asansor = o.asansorSayisi.trim() ? Number(o.asansorSayisi) : 0;
      await blokOzellikleriniDegistir(servis, blok.id, { ...o, asansorSayisi: asansor });
      setOzellik(null);
      await props.onDegisti();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  async function kopyala(kaynakId: string) {
    try {
      const { kopyalanan, eslesmeyen } = await blokOzellikleriniKopyala(depo, servis, kaynakId, blok.id);
      setKopya(false);
      props.onMesaj(`${kopyalanan} bölüme özellik kopyalandı${eslesmeyen ? `; ${eslesmeyen} bölümün karşılığı yok, değişmedi` : ''}.`);
      await props.onDegisti();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <div className="blok-basligi">
      <div className="baslik-satiri">
        <h3>{blok.ad} Blok</h3>
        <span className="soluk kucuk">{ozellikOzeti(blok)}</span>
      </div>
      {!ozellik && !kopya && !katFormu && (
        <div className="dugmeler">
          <button
            type="button"
            className="baglanti-dugmesi"
            onClick={() =>
              setOzellik({ asansorSayisi: String(blok.asansorSayisi), kapaliOtopark: blok.kapaliOtopark, siginak: blok.siginak, jenerator: blok.jenerator })
            }
          >
            Bina özellikleri
          </button>
          {props.digerBloklar.length > 0 && (
            <button type="button" className="baglanti-dugmesi" onClick={() => setKopya(true)}>
              Daire özelliklerini başka bloktan al
            </button>
          )}
          <button type="button" className="baglanti-dugmesi" onClick={() => setKatFormu(true)}>
            + Kat ekle
          </button>
        </div>
      )}
      {katFormu && (
        <KatEkleFormu
          blok={blok}
          onVazgec={() => setKatFormu(false)}
          onEklendi={async (m) => {
            setKatFormu(false);
            props.onMesaj(m);
            await props.onDegisti();
          }}
        />
      )}
      {ozellik && (
        <div className="kalem-formu">
          <BinaOzellikleriAlanlari deger={ozellik} onDegisti={setOzellik} />
          <div className="dugmeler">
            <button type="button" onClick={() => void ozellikKaydet(ozellik)}>
              Kaydet
            </button>
            <button type="button" className="ikincil" onClick={() => setOzellik(null)}>
              Vazgeç
            </button>
          </div>
        </div>
      )}
      {kopya && (
        <div className="kalem-formu">
          <p>Kat ve hat sırası aynı olan dairelere oda tipi, m², cephe ve eklentiler kopyalanır.</p>
          <div className="dugmeler">
            {props.digerBloklar.map((d) => (
              <button key={d.id} type="button" className="ikincil" onClick={() => void kopyala(d.id)}>
                {d.ad} Blok'tan al
              </button>
            ))}
            <button type="button" className="baglanti-dugmesi" onClick={() => setKopya(false)}>
              Vazgeç
            </button>
          </div>
        </div>
      )}
      <Hatalar hatalar={hatalar} />
    </div>
  );
}

// ─── Kroki ─────────────────────────────────────────────────────────

function BlokIzgarasi(props: {
  yapi: BlokYapisi;
  renk: KrokiRenkleri;
  secimModu: boolean;
  secili: Set<string>;
  acikBolumId: string | null;
  onDokun: (b: BagimsizBolum) => void;
  onTopluSec: (bolumler: BagimsizBolum[]) => void;
}) {
  const { blok, katlar } = props.yapi;
  const tum = katlar.flatMap((k) => k.bolumler);
  const hatSayisi = Math.max(1, ...tum.map((b) => b.hat));
  const hatlar = Array.from({ length: hatSayisi }, (_, i) => i + 1);

  return (
    <div className="kroki" style={{ gridTemplateColumns: `minmax(64px, auto) repeat(${hatSayisi}, minmax(48px, 1fr))` }} role="grid" aria-label={`${blok.ad} Blok krokisi`}>
      <span />
      {hatlar.map((h) => (
        <button
          key={h}
          type="button"
          className="kroki-hat"
          aria-label={`${blok.ad} Blok ${h}. hattaki bütün bölümleri seç`}
          onClick={() => props.onTopluSec(tum.filter((b) => b.hat === h))}
        >
          H{h}
        </button>
      ))}
      {katlar.map(({ kat, bolumler }, satir) => (
        <div key={kat.id} className="kroki-satir" role="row">
          <button
            type="button"
            className="kroki-kat"
            aria-label={`${blok.ad} Blok ${kat.ad}: bütün bölümleri seç`}
            onClick={() => bolumler.length && props.onTopluSec(bolumler)}
          >
            {kat.ad}
          </button>
          {hatlar.map((h) => {
            const b = bolumler.find((x) => x.hat === h);
            if (!b) return <span key={h} className="kroki-bos" aria-hidden="true" />;
            const secili = props.secimModu ? props.secili.has(b.id) : props.acikBolumId === b.id;
            const ozet = kutucukOzeti(b);
            return (
              <button
                key={h}
                type="button"
                role="gridcell"
                className={`kroki-hucre ${props.renk.sinif(b)} ${secili ? 'kroki-secili' : ''}`}
                aria-pressed={secili}
                aria-label={`${blok.ad} Blok ${kat.ad} no ${b.no}${ozet ? `, ${ozet}` : ''}, ${props.renk.durum(b)}`}
                data-bolum={b.id}
                data-blok={blok.id}
                data-satir={satir}
                data-hat={b.hat}
                onClick={() => props.onDokun(b)}
              >
                <strong>{b.no}</strong>
                {ozet && <small className="kroki-ozet">{ozet}</small>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function Kroki(props: {
  yapi: ProjeYapisi;
  /** Renk görünümleri (örn. Satış, Sahiplik); birden çoksa başlıkta seçilir. */
  gorunumler: { ad: string; renk: KrokiRenkleri }[];
  /** Seçim modu dışında dokunulan bölüm (formu açık). */
  acikBolumId: string | null;
  onBolumAc: (id: string | null) => void;
  onDegisti: () => Promise<void>;
  /** Seçili bölümler için ek işlemler (örn. arsa sahibine tahsis). */
  ekIslemler?: (secili: BagimsizBolum[], bitir: (mesaj: string) => Promise<void>) => ReactNode;
}) {
  const [secimModu, setSecimModu] = useState(false);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [toplu, setToplu] = useState(false);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [gorunum, setGorunum] = useState(0);
  const [blokFormuAcik, setBlokFormuAcik] = useState(false);
  const renk = (props.gorunumler[gorunum] ?? props.gorunumler[0]!).renk;
  const surukle = useSurukleSecim({
    etkin: secimModu,
    secili,
    setSecili,
    aralik: (blokId: string, a: HucreKonumu, b: HucreKonumu) => {
      const katlar = props.yapi.bloklar.find((x) => x.blok.id === blokId)?.katlar ?? [];
      const [s1, s2] = [Math.min(a.satir, b.satir), Math.max(a.satir, b.satir)];
      const [h1, h2] = [Math.min(a.hat, b.hat), Math.max(a.hat, b.hat)];
      return katlar
        .slice(s1, s2 + 1)
        .flatMap((k) => k.bolumler)
        .filter((x) => x.hat >= h1 && x.hat <= h2)
        .map((x) => x.id);
    },
  });

  const tum = props.yapi.bloklar.flatMap(({ blok, katlar }) =>
    katlar.flatMap(({ kat, bolumler }) => bolumler.map((bolum) => ({ bolum, etiket: `${bolumNo(blok.ad, bolum.no)} · ${kat.ad}` }))),
  );
  const seciliListe = tum.filter((x) => secili.has(x.bolum.id));

  const secimiBitir = () => {
    setSecili(new Set());
    setSecimModu(false);
    setToplu(false);
  };
  const bitir = async (m: string) => {
    secimiBitir();
    setMesaj(m);
    await props.onDegisti();
  };
  /** Hat ya da kat başlığı: hepsi seçiliyse kaldırır, değilse ekler; seçim modunu açar. */
  const topluSec = (bolumler: BagimsizBolum[]) => {
    props.onBolumAc(null);
    setMesaj(null);
    setSecimModu(true);
    setSecili((s) => {
      const yeni = new Set(s);
      const hepsi = bolumler.every((b) => yeni.has(b.id));
      for (const b of bolumler) {
        if (hepsi) yeni.delete(b.id);
        else yeni.add(b.id);
      }
      return yeni;
    });
  };

  return (
    <section ref={surukle.ref} className="kart" {...surukle.olaylar}>
      <div className="baslik-satiri">
        <h2>Bina krokisi</h2>
        <button
          type="button"
          className={secimModu ? '' : 'ikincil'}
          aria-pressed={secimModu}
          onClick={() => (secimModu ? secimiBitir() : (props.onBolumAc(null), setMesaj(null), setSecimModu(true)))}
        >
          {secimModu ? 'Seçimi bitir' : 'Seç'}
        </button>
      </div>
      <p className="soluk">
        {secimModu
          ? 'Kutucuklara, hat başlığına (H1…) ya da kat adına dokunun; birden çok kutu için sürükleyin (telefonda basılı tutup kaydırın).'
          : 'Bölüme dokunarak açın. Hat başlığı (H1…) o hattaki bütün katları seçer.'}
      </p>
      {props.gorunumler.length > 1 && (
        <div className="filtreler" role="group" aria-label="Renk görünümü">
          {props.gorunumler.map((g, i) => (
            <button key={g.ad} type="button" aria-pressed={i === gorunum} onClick={() => setGorunum(i)}>
              {g.ad}
            </button>
          ))}
        </div>
      )}
      {renk.lejant}
      {mesaj && (
        <p className="mesaj mesaj-basari" role="status">
          {mesaj}
        </p>
      )}
      {props.yapi.bloklar.map((b) => (
        <div key={b.blok.id} className="blok">
          <BlokBasligi
            blok={b.blok}
            digerBloklar={props.yapi.bloklar.filter((x) => x.blok.id !== b.blok.id).map((x) => x.blok)}
            onDegisti={props.onDegisti}
            onMesaj={setMesaj}
          />
          <div className="kroki-kaydirma">
            <BlokIzgarasi
              yapi={b}
              renk={renk}
              secimModu={secimModu}
              secili={secili}
              acikBolumId={props.acikBolumId}
              onTopluSec={topluSec}
              onDokun={(bolum) => {
                if (surukle.tiklamaYutulsun()) return;
                setMesaj(null);
                if (!secimModu) return props.onBolumAc(bolum.id === props.acikBolumId ? null : bolum.id);
                setSecili((s) => {
                  const yeni = new Set(s);
                  if (yeni.has(bolum.id)) yeni.delete(bolum.id);
                  else yeni.add(bolum.id);
                  return yeni;
                });
              }}
            />
          </div>
        </div>
      ))}

      {!secimModu &&
        (blokFormuAcik ? (
          <BlokEkleFormu
            yapi={props.yapi}
            onVazgec={() => setBlokFormuAcik(false)}
            onEklendi={async (m) => {
              setBlokFormuAcik(false);
              setMesaj(m);
              await props.onDegisti();
            }}
          />
        ) : (
          <button type="button" className="baglanti-dugmesi blok-ekle-dugmesi" onClick={() => setBlokFormuAcik(true)}>
            + Blok ekle
          </button>
        ))}

      {secimModu && secili.size > 0 && !toplu && (
        <div className="secim-cubugu" role="region" aria-label="Seçim işlemleri">
          <strong>{secili.size} bölüm seçili</strong>
          <div className="dugmeler">
            <button type="button" onClick={() => setToplu(true)}>
              Özellik ver
            </button>
            <button type="button" className="ikincil" onClick={() => setSecili(new Set())}>
              Seçimi temizle
            </button>
          </div>
          {props.ekIslemler?.(seciliListe.map((x) => x.bolum), bitir)}
        </div>
      )}
      {toplu && seciliListe.length > 0 && <TopluOzellikFormu bolumler={seciliListe} onBitti={bitir} onVazgec={() => setToplu(false)} />}
    </section>
  );
}
