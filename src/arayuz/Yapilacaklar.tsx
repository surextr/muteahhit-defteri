import { useCallback, useEffect, useState } from 'react';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import {
  gizlemeyiTemizle,
  ONEM_ADI,
  type GizlemeListesi,
  type Onem,
  type YapilacakGrubu,
  type YapilacakOge,
} from '../hesap/yapilacaklar';
import { META_YAPILACAK_GIZLEME, yapilacaklariGetir } from '../servisler/yapilacaklar';
import { useProjeErisimi, useUygulama, useYetki } from './baglam';
import { BosDurum, Hatalar, hataMetni } from './bilesenler';
import { ata, atamalar, atamaKaldir } from '../servisler/atama';
import { kullanicilariListele } from '../servisler/kullanici';
import type { YapilacakAtama } from '../veri/tipler';

// Tamamlanacak işler: kayıtlardaki eksik, geciken ve riskli işler tek listede (hesap/yapilacaklar.ts). Her madde ilgili
// kayda götürür; düzeltilince listeden kendiliğinden düşer. Erteleme ve gizleme bu cihazda tutulur.

const ERTELEME_GUN = 7;
const gunSonra = (t: string, n: number) => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Grupları yükler; erteleme/gizleme işlemleriyle. Ekran ve Bugün kartı ortak kullanır. */
export function useYapilacaklar() {
  const { depo, firma, oturum, kullanici, servis } = useUygulama();
  const erisim = useProjeErisimi();
  const yetki = useYetki();
  const bugun = yerelGun(new Date());
  const [gruplar, setGruplar] = useState<YapilacakGrubu[] | null>(null);
  const [gizleme, setGizleme] = useState<GizlemeListesi>({});
  const [surum, setSurum] = useState(0);
  const [atamaListesi, setAtamaListesi] = useState<Map<string, YapilacakAtama>>(new Map());
  const [kisiler, setKisiler] = useState<{ id: string; ad: string }[]>([]);

  useEffect(() => {
    void Promise.all([atamalar(depo, oturum.firmaId), kullanicilariListele(depo, oturum.firmaId)]).then(([a, k]) => {
      setAtamaListesi(a);
      setKisiler(k.map((x) => ({ id: x.kullanici.id, ad: x.kullanici.ad })));
    });
  }, [depo, oturum.firmaId, surum]);

  useEffect(() => {
    let iptal = false;
    void (async () => {
      const g = gizlemeyiTemizle((await depo.metaGetir<GizlemeListesi>(META_YAPILACAK_GIZLEME)) ?? {}, bugun);
      const l = await yapilacaklariGetir(depo, firma, bugun, erisim, yetki, g, { kullaniciId: oturum.kullaniciId, rol: kullanici.rol ?? 'santiye' });
      if (!iptal) {
        setGizleme(g);
        setGruplar(l);
      }
    })();
    return () => {
      iptal = true;
    };
    // yetki her çizimde yeni işlev; değişimi rol/firma ile gelir.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depo, firma, bugun, erisim, surum, oturum.kullaniciId, kullanici.rol]);

  const gizle = useCallback(
    async (anahtarlar: string[], sure: 'hep' | number) => {
      const yeni = { ...gizleme };
      for (const a of anahtarlar) yeni[a] = sure === 'hep' ? 'hep' : gunSonra(bugun, sure);
      await depo.metaYaz(META_YAPILACAK_GIZLEME, yeni);
      setSurum((s) => s + 1);
    },
    [depo, gizleme, bugun],
  );
  const hepsiniGeriGetir = useCallback(async () => {
    await depo.metaYaz(META_YAPILACAK_GIZLEME, {});
    setSurum((s) => s + 1);
  }, [depo]);

  const atama: AtamaIslemleri = {
    atamalar: atamaListesi,
    kisiler,
    benim: oturum.kullaniciId,
    ata: async (g) => {
      await ata(depo, servis, g);
      setSurum((x) => x + 1);
    },
    kaldir: async (id) => {
      await atamaKaldir(depo, servis, id);
      setSurum((x) => x + 1);
    },
  };

  return { gruplar, gizlenen: Object.keys(gizleme).length, gizle, hepsiniGeriGetir, atama };
}

interface AtamaIslemleri {
  atamalar: Map<string, YapilacakAtama>;
  /** Firmanın kullanıcıları; tek kişilik firmada atama gösterilmez. */
  kisiler: { id: string; ad: string }[];
  benim: string;
  ata: (g: { anahtar: string; kullaniciId: string; not: string; sonTarih: string | null }) => Promise<void>;
  kaldir: (id: string) => Promise<void>;
}

const ONEM_SIMGE: Record<Onem, string> = { acil: '!', uyari: '▲', bilgi: 'i' };

export function OnemEtiketi({ onem }: { onem: Onem }) {
  return (
    <span className={`onem-etiketi onem-${onem}`}>
      <span aria-hidden="true">{ONEM_SIMGE[onem]}</span> {ONEM_ADI[onem]}
    </span>
  );
}

const ILK_GORUNEN = 5;

function Grup({ grup, gizle, atama }: { grup: YapilacakGrubu; gizle: (a: string[], s: 'hep' | number) => Promise<void>; atama: AtamaIslemleri }) {
  const [hepsi, setHepsi] = useState(false);
  const gorunen = hepsi ? grup.ogeler : grup.ogeler.slice(0, ILK_GORUNEN);
  const toplam = grup.ogeler.reduce((t, o) => t + (o.tutar ?? 0), 0);
  return (
    <section className={`kart yapilacak-grubu onem-kenar-${grup.onem}`} id={`yapilacak-${grup.kod}`}>
      <div className="yapilacak-baslik">
        <OnemEtiketi onem={grup.onem} />
        <h2>{grup.baslik}</h2>
        {toplam > 0 && grup.ogeler.length > 1 && <span className="yapilacak-toplam">{tlYaz(toplam)}</span>}
      </div>
      <p className="soluk">{grup.aciklama}</p>
      <ul className="yapilacak-listesi">
        {gorunen.map((o) => (
          <Madde key={o.anahtar} oge={o} eylem={grup.eylem} kalici={grup.onem === 'bilgi'} gizle={gizle} atama={atama} />
        ))}
      </ul>
      {grup.ogeler.length > ILK_GORUNEN && (
        <button type="button" className="baglanti-dugmesi" onClick={() => setHepsi(!hepsi)}>
          {hepsi ? 'Daha az göster' : `+${grup.ogeler.length - ILK_GORUNEN} madde daha`}
        </button>
      )}
    </section>
  );
}

function Madde({
  oge,
  eylem,
  kalici,
  gizle,
  atama,
}: {
  oge: YapilacakOge;
  eylem: string;
  kalici: boolean;
  gizle: (a: string[], s: 'hep' | number) => Promise<void>;
  atama: AtamaIslemleri;
}) {
  const a = atama.atamalar.get(oge.anahtar);
  const [form, setForm] = useState<{ kullaniciId: string; not: string; sonTarih: string } | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const kisiAdi = (id: string) => (id === atama.benim ? 'size' : (atama.kisiler.find((k) => k.id === id)?.ad ?? '?'));
  const kaydet = async () => {
    if (!form) return;
    setHata(null);
    try {
      await atama.ata({ anahtar: oge.anahtar, kullaniciId: form.kullaniciId, not: form.not, sonTarih: form.sonTarih || null });
      setForm(null);
    } catch (e) {
      setHata(hataMetni(e));
    }
  };
  return (
    <li>
      <a className="yapilacak-bilgi" href={`#/${oge.yol}`}>
        <strong>{oge.baslik}</strong>
        <span className="soluk">{oge.ayrinti}</span>
        {a && (
          <span className={`atama-etiketi${a.sonTarih && a.sonTarih < yerelGun(new Date()) ? ' gecikti' : ''}`}>
            {kisiAdi(a.kullaniciId)} atandı
            {a.sonTarih ? ` · son ${new Date(`${a.sonTarih}T00:00`).toLocaleDateString('tr-TR')}` : ''}
            {a.not ? ` · ${a.not}` : ''}
          </span>
        )}
      </a>
      {oge.tutar !== undefined && oge.tutar !== 0 && <strong className="yapilacak-tutar">{tlYaz(oge.tutar)}</strong>}
      <span className="yapilacak-eylemler">
        <a className="dugme kucuk-dugme" href={`#/${oge.yol}`}>
          {eylem}
        </a>
        <button type="button" className="ikincil kucuk-dugme" title={`${ERTELEME_GUN} gün sonra yeniden göster`} onClick={() => void gizle([oge.anahtar], ERTELEME_GUN)}>
          Ertele
        </button>
        {kalici && (
          <button type="button" className="ikincil kucuk-dugme" title="Bu madde bir daha gösterilmez (örn. belgesi hiç olmayacak)" onClick={() => void gizle([oge.anahtar], 'hep')}>
            Gizle
          </button>
        )}
        {atama.kisiler.length > 1 && !form && (
          <button
            type="button"
            className="ikincil kucuk-dugme"
            onClick={() => setForm({ kullaniciId: a?.kullaniciId ?? '', not: a?.not ?? '', sonTarih: a?.sonTarih ?? '' })}
          >
            {a ? 'Atamayı değiştir' : 'Ata'}
          </button>
        )}
      </span>
      {form && (
        <div className="atama-formu">
          <select value={form.kullaniciId} aria-label="Kime" onChange={(e) => setForm({ ...form, kullaniciId: e.target.value })}>
            <option value="">Kime…</option>
            {atama.kisiler.map((k) => (
              <option key={k.id} value={k.id}>
                {k.ad}
                {k.id === atama.benim ? ' (siz)' : ''}
              </option>
            ))}
          </select>
          <input type="date" value={form.sonTarih} aria-label="Son tarih" onChange={(e) => setForm({ ...form, sonTarih: e.target.value })} />
          <input value={form.not} placeholder="Not (isteğe bağlı)" aria-label="Not" onChange={(e) => setForm({ ...form, not: e.target.value })} />
          <div className="dugmeler">
            <button type="button" className="kucuk-dugme" disabled={!form.kullaniciId} onClick={() => void kaydet()}>
              Ata
            </button>
            {a && (
              <button type="button" className="ikincil kucuk-dugme" onClick={() => void atama.kaldir(a.id).then(() => setForm(null))}>
                Atamayı kaldır
              </button>
            )}
            <button type="button" className="ikincil kucuk-dugme" onClick={() => setForm(null)}>
              Vazgeç
            </button>
          </div>
          {hata && <Hatalar hatalar={[hata]} />}
        </div>
      )}
    </li>
  );
}

export function YapilacaklarEkrani({ odak }: { odak?: string }) {
  const { gruplar: tumGruplar, gizlenen, gizle, hepsiniGeriGetir, atama } = useYapilacaklar();
  const [suzgec, setSuzgec] = useState<Onem | null>(null);
  const [banaAtanan, setBanaAtanan] = useState(false);
  const benimMi = (o: YapilacakOge) => atama.atamalar.get(o.anahtar)?.kullaniciId === atama.benim;
  const banaSayisi = (tumGruplar ?? []).reduce((t, g) => t + g.ogeler.filter(benimMi).length, 0);
  const gruplar =
    tumGruplar && banaAtanan
      ? tumGruplar.map((g) => ({ ...g, ogeler: g.ogeler.filter(benimMi) })).filter((g) => g.ogeler.length > 0)
      : tumGruplar;
  // Bugün kartından gelinince o gruba kaydırılır.
  const yuklendi = gruplar !== null;
  useEffect(() => {
    if (yuklendi && odak) document.getElementById(`yapilacak-${odak}`)?.scrollIntoView({ block: 'start' });
  }, [yuklendi, odak]);
  if (!gruplar) return <p>Yükleniyor…</p>;
  const sayi = (o: Onem) => gruplar.filter((g) => g.onem === o).reduce((s, g) => s + g.ogeler.length, 0);
  const gorunen = gruplar.filter((g) => !suzgec || g.onem === suzgec);
  return (
    <>
      <h1>Tamamlanacak işler</h1>
      <p className="soluk">Kayıtlardan kendiliğinden çıkar; düzelttikçe listeden düşer. Ertelenen madde {ERTELEME_GUN} gün sonra yeniden görünür.</p>
      {gruplar.length === 0 && !banaAtanan ? (
        <BosDurum metin="Her şey yolunda: geciken, eksik ya da onay bekleyen bir iş yok." eylemler={[{ yol: 'bugun', ad: 'Bugün ekranına dön' }]} />
      ) : (
        <>
          <div className="filtreler" role="group" aria-label="Öneme göre süz">
            <button type="button" aria-pressed={suzgec === null} onClick={() => setSuzgec(null)}>
              Tümü {gruplar.reduce((s, g) => s + g.ogeler.length, 0)}
            </button>
            {(['acil', 'uyari', 'bilgi'] as Onem[])
              .filter((o) => sayi(o) > 0)
              .map((o) => (
                <button key={o} type="button" aria-pressed={suzgec === o} onClick={() => setSuzgec(o)}>
                  {ONEM_ADI[o]} {sayi(o)}
                </button>
              ))}
            {(banaSayisi > 0 || banaAtanan) && (
              <button type="button" aria-pressed={banaAtanan} onClick={() => setBanaAtanan(!banaAtanan)}>
                Bana atananlar {banaSayisi}
              </button>
            )}
          </div>
          {gorunen.map((g) => (
            <Grup key={g.kod} grup={g} gizle={gizle} atama={atama} />
          ))}
        </>
      )}
      {gizlenen > 0 && (
        <p className="soluk kucuk">
          {gizlenen} madde ertelendi ya da gizlendi.{' '}
          <button type="button" className="baglanti-dugmesi" onClick={() => void hepsiniGeriGetir()}>
            Hepsini geri getir
          </button>
        </p>
      )}
    </>
  );
}

/** Bugün ekranında özet: en önemli gruplar, tümüne bağlantı. Hiç iş yoksa görünmez. */
export function YapilacaklarKarti() {
  const { gruplar } = useYapilacaklar();
  if (!gruplar || gruplar.length === 0) return null;
  const adet = gruplar.reduce((s, g) => s + g.ogeler.length, 0);
  return (
    <section className="kart yapilacak-ozeti">
      <div className="baslik-satiri">
        <h2>Tamamlanacak işler</h2>
        <a href="#/yapilacaklar">Tümü ({adet})</a>
      </div>
      <ul>
        {gruplar.slice(0, 5).map((g) => (
          <li key={g.kod}>
            <a href={`#/yapilacaklar/${g.kod}`}>
              <OnemEtiketi onem={g.onem} />
              <span>{g.baslik}</span>
              {g.kod === 'nakit_acigi' && g.ogeler[0]?.tutar ? <strong className="hata">{tlYaz(g.ogeler[0].tutar)}</strong> : null}
            </a>
          </li>
        ))}
      </ul>
      {gruplar.length > 5 && <p className="soluk kucuk">+{gruplar.length - 5} başlık daha</p>}
    </section>
  );
}
