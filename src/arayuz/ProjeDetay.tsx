import { MalzemeSekmesi } from './Malzeme';
import { Simge } from './Simge';
import { GunlukSekmesi } from './Gunluk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FotograflarSekmesi, SonFotograflar } from './Fotograflar';
import { tamAdres } from '../servisler/adres';
import { bolumNo } from '../hesap/bolum';
import { bolumOdaTipi, odaTipiOku } from '../hesap/odaTipi';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { teslimDurumu, yerelGun } from '../hesap/tarih';
import type { ButceOzeti } from '../hesap/butce';
import { projeButcesiGetir } from '../servisler/kalem';
import { carileriListele, ortakEkle, ortakOraniDegistir, projeOrtaklari, type CariOzeti, type OrtakSatiri } from '../servisler/cari';
import { arsaSahibiDurumu, type ArsaSahibiDurumu } from '../servisler/arsaSahibi';
import { ALAN_TANIMLARI, projeYapisiGetir, toplamArsaAlani, type ProjeYapisi } from '../servisler/proje';
import type { BagimsizBolum, ProjeAlanlari, TakipBasligi } from '../veri/tipler';
import { DubleksSecimi, OdaTipiSecimi } from './OdaTipiSecimi';
import { KatKarsiligiKarti } from './KatKarsiligi';
import { ArsaSahipleriKarti, sahiplikRenkleri, TahsisIslemleri } from './ArsaSahipleri';
import { BelgelerKarti } from './Belgeler';
import { UstaSozlesmeleriKarti } from './UstaSozlesmesi';
import { BolumSatisBaglantisi, SatislarKarti } from './Satis';
import { useUygulama, useYetki } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { CariSecici } from './CariSecici';
import { ButceOzetiKarti } from './ButceEkrani';
import { IlerlemeKarti } from './Ilerleme';
import { PROJE_DURUM_ADI } from './ProjeDuzenle';
import { gorunurYap, Kroki, YonSecimi, type KrokiRenkleri } from './Kroki';
import { ARSA_TIPI_ADI } from './ProjelerEkrani';
import { KurulumUyarilari } from './HavuzSozlesme';

const TAKIP_ADI: Record<TakipBasligi['durum'], string> = {
  baslamadi: 'Başlamadı',
  devam: 'Devam ediyor',
  tamamlandi: 'Tamamlandı',
};
const TIP_ADI: Record<BagimsizBolum['tip'], string> = { daire: 'Daire', dukkan: 'Dükkan', ofis: 'Ofis', diger: 'Diğer' };
const SATIS_ADI: Record<BagimsizBolum['satisDurumu'], string> = {
  satisa_kapali: 'Satışa kapalı',
  satista: 'Satışta',
  rezerve: 'Rezerve',
  sozlesmeli: 'Sözleşmeli',
};
const SAHIPLIK_ADI: Record<BagimsizBolum['sahiplik'], string> = {
  muteahhit: 'Müteahhit',
  arsa_sahibi: 'Arsa sahibi',
  ortak: 'Ortak',
};
/** Krokide satış durumu renkleri. */
const SATIS_RENKLERI: KrokiRenkleri = {
  sinif: (b) => `cip-${b.satisDurumu}`,
  durum: (b) => SATIS_ADI[b.satisDurumu],
  lejant: (
    <ul className="lejant" aria-label="Renklerin anlamı">
      {Object.entries(SATIS_ADI).map(([k, ad]) => (
        <li key={k}>
          <span className={`cip cip-${k}`} aria-hidden="true" /> {ad}
        </li>
      ))}
    </ul>
  ),
};

const ORTAK_ALAN_TURLERI = ['Merdiven', 'Koridor', 'Asansör', 'Teknik oda', 'Otopark', 'Sığınak', 'Çatı arası', 'Diğer'];

const tarihYaz = (t: string | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '—');

/** Proje ekranının sekmeleri; adres `#/projeler/:id/:sekme` (sekmesiz = Özet). */
export const PROJE_SEKMELERI = ['ozet', 'bina', 'gunluk', 'malzeme', 'fotograflar', 'satislar', 'sozlesmeler', 'arsa', 'belgeler', 'bilgiler'] as const;
export type ProjeSekmesi = (typeof PROJE_SEKMELERI)[number];
export const projeSekmesiMi = (s: string | undefined): s is ProjeSekmesi => PROJE_SEKMELERI.includes(s as ProjeSekmesi);

export function ProjeDetay({ projeId, sekme = 'ozet' }: { projeId: string; sekme?: ProjeSekmesi }) {
  const { depo, oturum } = useUygulama();
  const yetki = useYetki();
  const [yapi, setYapi] = useState<ProjeYapisi | null | undefined>(undefined);
  const [arsa, setArsa] = useState<ArsaSahibiDurumu | null>(null);
  const [seciliBolumId, setSeciliBolumId] = useState<string | null>(null);

  const yenile = useCallback(async () => {
    const [y, a] = await Promise.all([projeYapisiGetir(depo, oturum.firmaId, projeId), arsaSahibiDurumu(depo, oturum.firmaId, projeId)]);
    setArsa(a);
    setYapi(y);
  }, [depo, oturum.firmaId, projeId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  if (yapi === undefined) return <p>Yükleniyor…</p>;
  if (yapi === null) return <p className="hata">Proje bulunamadı.</p>;

  const { proje } = yapi;
  const teslim = teslimDurumu(proje.planlananBitis, proje.gerceklesenBitis, yerelGun(new Date()));
  const tumBolumler = yapi.bloklar.flatMap((b) => b.katlar.flatMap((k) => k.bolumler.map((bolum) => ({ bolum, blok: b.blok, kat: k.kat }))));
  const secili = tumBolumler.find((x) => x.bolum.id === seciliBolumId);
  const katKarsiligi = proje.arsaTipi === 'kat_karsiligi';
  const sahipAdi = (b: BagimsizBolum) => arsa?.sahipler.find((s) => s.cari.id === arsa.tahsis.get(b.id))?.cari.ad;

  const sekmeler: { kod: ProjeSekmesi; ad: string; gorunur: boolean }[] = [
    { kod: 'ozet', ad: 'Özet', gorunur: true },
    { kod: 'bina', ad: 'Bina', gorunur: true },
    { kod: 'gunluk', ad: 'Günlük', gorunur: true },
    { kod: 'malzeme', ad: 'Malzeme', gorunur: true },
    { kod: 'fotograflar', ad: 'Fotoğraflar', gorunur: true },
    { kod: 'satislar', ad: 'Satışlar', gorunur: yetki('satis') },
    { kod: 'sozlesmeler', ad: 'Sözleşmeler', gorunur: yetki('sozlesme') },
    { kod: 'arsa', ad: 'Arsa sahipleri', gorunur: katKarsiligi },
    { kod: 'belgeler', ad: 'Belgeler', gorunur: true },
    { kod: 'bilgiler', ad: 'Bilgiler', gorunur: true },
  ];
  const acik = sekmeler.find((x) => x.kod === sekme && x.gorunur)?.kod ?? 'ozet';
  const yol = (k: ProjeSekmesi) => `#/projeler/${proje.id}${k === 'ozet' ? '' : `/${k}`}`;

  return (
    <>
      <p className="geri">
        <a className="geri-baglanti" href="#/projeler">← Projeler</a>
      </p>
      <div className="baslik-satiri proje-baslik">
        <h1>{proje.ad}</h1>
        {teslim && <span className={`teslim-rozeti teslim-${teslim.durum}`}>{teslim.metin}</span>}
      </div>
      <KurulumUyarilari />
      <nav className="sekmeler" aria-label="Proje bölümleri">
        {sekmeler
          .filter((x) => x.gorunur)
          .map((x) => (
            <a key={x.kod} href={yol(x.kod)} aria-current={acik === x.kod ? 'page' : undefined}>
              {x.ad}
            </a>
          ))}
      </nav>

      {acik === 'ozet' && (
        <>
          <div className="dugmeler proje-kisayollari">
            {yetki('gider') && (
              <a className="dugme" href={`#/giderler/yeni/${proje.id}`}>
                + Gider
              </a>
            )}
            {yetki('gider') && (
              <a className="dugme ikincil" href={`#/giderler/proje/${proje.id}`}>
                Giderler
              </a>
            )}
            {yetki('satis') && (
              <a className="dugme ikincil" href={`#/satislar/yeni/${proje.id}`}>
                + Satış
              </a>
            )}
            {yetki('rapor') && (
              <a className="dugme ikincil" href={`#/projeler/${proje.id}/rapor`}>
                Kâr / zarar
              </a>
            )}
            <a className="dugme ikincil" href={`#/maliyet/proje/${proje.id}`}>
              <Simge ad="hesap" /> Maliyet hesabı
            </a>
            {yetki('rapor') && (
              <a className="dugme ikincil" href={`#/projeler/${proje.id}/karsilastirma`}>
                <Simge ad="rapor" /> Plan / gerçek
              </a>
            )}
            {yetki('rapor') && (
              <a className="dugme ikincil" href={`#/projeler/${proje.id}/is-sonu`}>
                <Simge ad="hesap" /> İş sonu tahmini
              </a>
            )}
          </div>
          <div className="pano">
            <div className="pano-sutun">
              <IlerlemeKarti projeId={proje.id} />
              <ButceKarti projeId={proje.id} />
            </div>
            <div className="pano-sutun">
              <TakipBasliklari basliklar={yapi.takipBasliklari} onDegisti={yenile} />
              <SonFotograflar projeId={proje.id} />
            </div>
          </div>
        </>
      )}

      {acik === 'bina' && (
        <>
          <div className={secili ? 'bina-duzen bolum-acik' : 'bina-duzen'}>
            <div className="bina-kroki">
              <Kroki
                yapi={yapi}
                gorunumler={
                  katKarsiligi
                    ? [
                        { ad: 'Satış', renk: SATIS_RENKLERI },
                        { ad: 'Sahiplik', renk: sahiplikRenkleri(arsa) },
                      ]
                    : [{ ad: 'Satış', renk: SATIS_RENKLERI }]
                }
                acikBolumId={seciliBolumId}
                onBolumAc={setSeciliBolumId}
                onDegisti={yenile}
                ekIslemler={
                  katKarsiligi
                    ? (bolumler, bitir) => <TahsisIslemleri projeId={proje.id} durum={arsa} secili={bolumler} bitir={bitir} />
                    : undefined
                }
              />
            </div>
            {secili && (
              <div className="bina-yan">
                <BolumFormu
                  key={secili.bolum.id}
                  bolum={secili.bolum}
                  baslik={`${bolumNo(secili.blok.ad, secili.bolum.no)} · ${secili.kat.ad}`}
                  sahipAdi={sahipAdi(secili.bolum)}
                  onKapat={() => setSeciliBolumId(null)}
                  onKaydedildi={yenile}
                />
                <BelgelerKarti
                  key={`belge-${secili.bolum.id}`}
                  bagliTur="bagimsizBolum"
                  bagliId={secili.bolum.id}
                  varsayilanTur="fotograf"
                  baslik={`${bolumNo(secili.blok.ad, secili.bolum.no)} belgeleri`}
                />
              </div>
            )}
          </div>
          <OrtakAlanlar yapi={yapi} onDegisti={yenile} />
        </>
      )}

      {acik === 'satislar' && <SatislarKarti projeId={proje.id} />}

      {acik === 'sozlesmeler' && <UstaSozlesmeleriKarti projeId={proje.id} />}

      {acik === 'arsa' && (
        <div className="pano">
          <div className="pano-sutun">
            <ArsaSahipleriKarti projeId={proje.id} bolumler={tumBolumler.map((x) => x.bolum)} durum={arsa} onDegisti={yenile} />
          </div>
          <div className="pano-sutun">
            <KatKarsiligiKarti
              projeId={proje.id}
              arsa={arsa}
              bolumEtiketi={(id) => {
                const x = tumBolumler.find((b) => b.bolum.id === id);
                return x ? bolumNo(x.blok.ad, x.bolum.no) : '?';
              }}
            />
          </div>
        </div>
      )}

      {acik === 'gunluk' && <GunlukSekmesi projeId={proje.id} />}

      {acik === 'malzeme' && <MalzemeSekmesi projeId={proje.id} />}

      {acik === 'fotograflar' && <FotograflarSekmesi projeId={proje.id} />}

      {acik === 'belgeler' && <BelgelerKarti bagliTur="proje" bagliId={projeId} varsayilanTur="diger" baslik="Proje belgeleri" />}

      {acik === 'bilgiler' && (
        <div className="pano">
          <div className="pano-sutun">
            <ProjeBilgileri yapi={yapi} />
          </div>
          <div className="pano-sutun">
            <Ortaklar projeId={proje.id} />
          </div>
        </div>
      )}
    </>
  );
}

function ProjeBilgileri({ yapi }: { yapi: ProjeYapisi }) {
  const { proje } = yapi;
  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Proje bilgileri</h2>
        <a className="dugme ikincil" href={`#/projeler/${proje.id}/duzenle`}>
          Düzenle
        </a>
      </div>
      <dl className="bilgi">
        <dt>Adres</dt>
        <dd>{tamAdres(proje) || '—'}</dd>
        <dt>Ada / parsel</dt>
        <dd>
          {proje.parseller.length === 0
            ? '—'
            : proje.parseller.map((x, i) => (
                <span key={i} className="blok">
                  {x.ada || '—'} / {x.parsel || '—'}
                  {x.alanM2 !== null && <span className="soluk"> · {sayiYaz(x.alanM2)} m²</span>}
                </span>
              ))}
        </dd>
        <dt>Arsa alanı</dt>
        <dd>{toplamArsaAlani(proje.parseller) === null ? '—' : `${sayiYaz(toplamArsaAlani(proje.parseller))} m²`}</dd>
        <dt>Arsa tipi</dt>
        <dd>{ARSA_TIPI_ADI[proje.arsaTipi]}</dd>
        <dt>Başlangıç</dt>
        <dd>{tarihYaz(proje.baslangicTarihi)}</dd>
        <dt>Planlanan bitiş</dt>
        <dd>{tarihYaz(proje.planlananBitis)}</dd>
        {proje.gerceklesenBitis && (
          <div className="bilgi-satir">
            <dt>Gerçekleşen bitiş</dt>
            <dd>{tarihYaz(proje.gerceklesenBitis)}</dd>
          </div>
        )}
        <dt>Durum</dt>
        <dd>{PROJE_DURUM_ADI[proje.durum]}</dd>
        {(Object.keys(ALAN_TANIMLARI) as (keyof ProjeAlanlari)[]).map((ad) => (
          <div key={ad} className="bilgi-satir">
            <dt title={ALAN_TANIMLARI[ad].aciklama}>{ALAN_TANIMLARI[ad].etiket}</dt>
            <dd>{proje.alanlar[ad] === null ? '—' : sayiYaz(proje.alanlar[ad])}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// ─── Bütçe özeti ───────────────────────────────────────────────────

function ButceKarti({ projeId }: { projeId: string }) {
  const { depo, oturum, firma } = useUygulama();
  const [ozet, setOzet] = useState<ButceOzeti | null>(null);
  const kdvDahil = firma.ayarlar.kdvMaliyeteDahil;

  useEffect(() => {
    void projeButcesiGetir(depo, oturum.firmaId, projeId, kdvDahil).then(setOzet);
  }, [depo, oturum.firmaId, projeId, kdvDahil]);

  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Bütçe</h2>
        <a className="dugme ikincil" href={`#/projeler/${projeId}/butce`}>
          {ozet && ozet.dugumler.length === 0 ? 'Bütçe hazırla' : 'Kalemler'}
        </a>
      </div>
      {ozet && ozet.dugumler.length === 0 && <p className="soluk">Maliyet kalemleri ve bütçesi henüz girilmedi.</p>}
      {ozet && ozet.dugumler.length > 0 && <ButceOzetiKarti ozet={ozet} kdvDahil={kdvDahil} />}
    </section>
  );
}

// ─── Ortaklar ──────────────────────────────────────────────────────

const yuzde = (n: number) => `%${n.toLocaleString('tr-TR', { maximumFractionDigits: 2 })}`;

function Ortaklar({ projeId }: { projeId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [ortaklar, setOrtaklar] = useState<OrtakSatiri[]>([]);
  // Bütün cariler seçilebilir (ortaklar başta); rolü olmayana eklenirken ortak rolü verilir.
  const [adaylar, setAdaylar] = useState<CariOzeti[]>([]);
  const [form, setForm] = useState<{ cariId: string | null; oran: string }>({ cariId: null, oran: '' });
  const [ekleAcik, setEkleAcik] = useState(false);
  const [duzenlenen, setDuzenlenen] = useState<{ id: string; oran: string } | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);

  const yenile = useCallback(async () => {
    const [o, cariler] = await Promise.all([projeOrtaklari(depo, oturum.firmaId, projeId), carileriListele(depo, oturum.firmaId)]);
    setOrtaklar(o);
    setAdaylar(cariler.filter((c) => !c.cari.roller.includes('vergi_dairesi') && !o.some((x) => x.cari.id === c.cari.id)));
  }, [depo, oturum.firmaId, projeId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  const oranOku = (metin: string): number | null => {
    const oran = sayiOku(metin.replace('%', ''));
    if (oran === null) setHatalar(['Oranı sayı olarak yazın, örn. 25 ya da 33,33.']);
    return oran;
  };

  async function ekle() {
    setHatalar([]);
    if (!form.cariId) return setHatalar(['Ortak olacak cariyi seçin.']);
    const oran = oranOku(form.oran);
    if (oran === null) return;
    try {
      await ortakEkle(depo, servis, projeId, form.cariId, oran);
      setForm({ cariId: null, oran: '' });
      setEkleAcik(false);
      await yenile();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  function oranKaydet(o: OrtakSatiri, metin: string) {
    setHatalar([]);
    const oran = oranOku(metin);
    if (oran === null) return;
    void degistir(`${o.cari.ad} ortaklık oranı değişiyor`, async (g) => {
      await ortakOraniDegistir(depo, servis, o.ortaklik.id, oran, g);
      setDuzenlenen(null);
      await yenile();
    });
  }

  const toplam = ortaklar.reduce((t, o) => t + o.ortaklik.oran, 0);

  return (
    <section className="kart">
      <h2>Ortaklar</h2>
      <p className="soluk">
        {ortaklar.length === 0
          ? 'Ortak yoksa proje tamamen firmanındır.'
          : `Firmanın payı: ${yuzde(Math.max(100 - toplam, 0))}`}
      </p>
      {kutu}
      {ortaklar.length > 0 && (
        <ul className="liste">
          {ortaklar.map((o) => (
            <li key={o.ortaklik.id}>
              <a href={`#/cariler/${o.cari.id}`}>{o.cari.ad}</a>
              {duzenlenen?.id === o.ortaklik.id ? (
                <span className="satir-ici">
                  <input
                    value={duzenlenen.oran}
                    inputMode="decimal"
                    aria-label={`${o.cari.ad} yeni oran (%)`}
                    onChange={(e) => setDuzenlenen({ id: o.ortaklik.id, oran: e.target.value })}
                  />
                  <button type="button" onClick={() => oranKaydet(o, duzenlenen.oran)}>
                    Kaydet
                  </button>
                  <button type="button" className="ikincil" onClick={() => setDuzenlenen(null)}>
                    Vazgeç
                  </button>
                </span>
              ) : (
                <span className="satir-ici">
                  <strong>{yuzde(o.ortaklik.oran)}</strong>
                  <button
                    type="button"
                    className="ikincil"
                    onClick={() => setDuzenlenen({ id: o.ortaklik.id, oran: sayiYaz(o.ortaklik.oran) })}
                  >
                    Değiştir
                  </button>
                  <button
                    type="button"
                    className="ikincil"
                    onClick={() =>
                      void degistir(`${o.cari.ad} ortaklıktan çıkarılsın mı?`, async (g) => {
                        await servis.iptal('projeOrtagi', o.ortaklik.id, g);
                        await yenile();
                      })
                    }
                  >
                    Kaldır
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {!ekleAcik ? (
        <button type="button" className="ikincil" onClick={() => setEkleAcik(true)}>
          + Ortak ekle
        </button>
      ) : (
        <>
          <h3>Ortak ekle</h3>
          <div className="alan">
            <span className="alan-etiket">Ortak</span>
            <CariSecici
              cariler={adaylar}
              secili={form.cariId}
              onSec={(cariId) => setForm({ ...form, cariId })}
              oncelikli={['ortak']}
              hizliEkle={{ rol: 'ortak', onEklendi: (c) => setAdaylar((l) => [...l, { cari: c, bakiye: 0 }]) }}
            />
          </div>
          <Alan etiket="Oran (%)">
            <input value={form.oran} inputMode="decimal" placeholder="25" onChange={(e) => setForm({ ...form, oran: e.target.value })} />
          </Alan>
          <div className="dugmeler">
            <button type="button" onClick={() => void ekle()}>
              Ekle
            </button>
            <button type="button" className="ikincil" onClick={() => (setEkleAcik(false), setHatalar([]))}>
              Vazgeç
            </button>
          </div>
        </>
      )}
      <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
    </section>
  );
}

// ─── Takip başlıkları ──────────────────────────────────────────────

function TakipBasliklari({ basliklar, onDegisti }: { basliklar: TakipBasligi[]; onDegisti: () => Promise<void> }) {
  const { servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();

  function durumDegistir(t: TakipBasligi, durum: TakipBasligi['durum']) {
    const bugun = yerelGun(new Date());
    const degisiklik = {
      durum,
      baslangicTarihi: durum === 'baslamadi' ? t.baslangicTarihi : (t.baslangicTarihi ?? bugun),
      bitisTarihi: durum === 'tamamlandi' ? (t.bitisTarihi ?? bugun) : null,
    };
    void degistir(`${t.ad}: ${TAKIP_ADI[durum]}`, async (g) => {
      await servis.guncelle('takipBasligi', t.id, degisiklik, g);
      await onDegisti();
    });
  }

  return (
    <section className="kart">
      <h2>Takip başlıkları</h2>
      <p className="soluk">Sıralı değil, aynı anda yürüyebilir.</p>
      {kutu}
      <Hatalar hatalar={hata ? [hata] : []} />
      <ul className="liste">
        {basliklar.map((t) => (
          <li key={t.id}>
            <div>
              <strong>{t.ad}</strong>
              {t.baslangicTarihi && (
                <span className="soluk">
                  {' '}
                  · {tarihYaz(t.baslangicTarihi)}
                  {t.bitisTarihi && ` – ${tarihYaz(t.bitisTarihi)}`}
                </span>
              )}
            </div>
            <select
              value={t.durum}
              aria-label={`${t.ad} durumu`}
              className={`durum durum-${t.durum}`}
              onChange={(e) => durumDegistir(t, e.target.value as TakipBasligi['durum'])}
            >
              {Object.entries(TAKIP_ADI).map(([k, ad]) => (
                <option key={k} value={k}>
                  {ad}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Bağımsız bölüm formu ──────────────────────────────────────────

function BolumFormu(props: {
  bolum: BagimsizBolum;
  baslik: string;
  /** Arsa sahibine tahsisliyse adı. */
  sahipAdi?: string;
  onKapat: () => void;
  onKaydedildi: () => Promise<void>;
}) {
  const { bolum } = props;
  const { servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [form, setForm] = useState({
    tip: bolum.tip,
    odaTipi: bolumOdaTipi(bolum),
    dubleks: bolum.dubleks,
    brutM2: sayiYaz(bolum.brutM2),
    netM2: sayiYaz(bolum.netM2),
    cephe: bolum.cephe ?? '',
    balkon: bolum.balkon,
    otopark: bolum.otopark,
    depo: bolum.depo,
    ozellikler: bolum.ozellikler.join(', '),
    satisDurumu: bolum.satisDurumu,
    teslimDurumu: bolum.teslimDurumu,
  });
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [kaydedildi, setKaydedildi] = useState(false);
  const kutuRef = useRef<HTMLElement>(null);
  const satisModulunde = bolum.satisDurumu === 'rezerve' || bolum.satisDurumu === 'sozlesmeli';

  // Kroki uzun olduğundan açılan form ekranın altında kalmasın.
  useEffect(() => gorunurYap(kutuRef.current), []);

  const yaz = <K extends keyof typeof form>(alan: K, deger: (typeof form)[K]) => {
    setKaydedildi(false);
    setForm((f) => ({ ...f, [alan]: deger }));
  };

  function kaydet() {
    const yeniHatalar: string[] = [];
    const m2 = (metin: string, ad: string) => {
      if (!metin.trim()) return null;
      const s = sayiOku(metin);
      if (s === null || s <= 0) yeniHatalar.push(`${ad} geçerli bir sayı değil.`);
      return s;
    };
    const brutM2 = m2(form.brutM2, 'Brüt m²');
    const netM2 = m2(form.netM2, 'Net m²');
    if (brutM2 !== null && netM2 !== null && netM2 > brutM2) yeniHatalar.push('Net m² brüt m²\'den büyük olamaz.');
    setHatalar(yeniHatalar);
    if (yeniHatalar.length > 0) return;

    const oda = form.odaTipi ? odaTipiOku(form.odaTipi) : null;
    const degisiklik = {
      tip: form.tip,
      odaSayisi: oda?.oda ?? null,
      salonSayisi: oda?.salon ?? null,
      dubleks: form.dubleks,
      brutM2,
      netM2,
      cephe: form.cephe.trim() || null,
      balkon: form.balkon,
      otopark: form.otopark,
      depo: form.depo,
      ozellikler: form.ozellikler
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
      teslimDurumu: form.teslimDurumu,
      ...(satisModulunde ? {} : { satisDurumu: form.satisDurumu }),
    };
    void degistir(props.baslik, async (g) => {
      await servis.guncelle('bagimsizBolum', bolum.id, degisiklik, g);
      setKaydedildi(true);
      await props.onKaydedildi();
    });
  }

  return (
    <section ref={kutuRef} className="kart" aria-labelledby="bolum-baslik">
      <div className="baslik-satiri">
        <h2 id="bolum-baslik">{props.baslik}</h2>
        <button type="button" className="ikincil" onClick={props.onKapat}>
          Kapat
        </button>
      </div>
      <Alan etiket="Tip">
        <select value={form.tip} onChange={(e) => yaz('tip', e.target.value as BagimsizBolum['tip'])}>
          {Object.entries(TIP_ADI).map(([k, ad]) => (
            <option key={k} value={k}>
              {ad}
            </option>
          ))}
        </select>
      </Alan>
      <OdaTipiSecimi deger={form.odaTipi} onDegisti={(t) => yaz('odaTipi', t)} />
      <DubleksSecimi deger={form.dubleks} onDegisti={(d) => yaz('dubleks', d ?? null)} />
      <div className="iki-sutun">
        <Alan etiket="Brüt m²">
          <input value={form.brutM2} inputMode="decimal" onChange={(e) => yaz('brutM2', e.target.value)} />
        </Alan>
        <Alan etiket="Net m²">
          <input value={form.netM2} inputMode="decimal" onChange={(e) => yaz('netM2', e.target.value)} />
        </Alan>
      </div>
      <div className="alan">
        <span className="alan-etiket">Cephe</span>
        <YonSecimi deger={form.cephe} onDegisti={(v) => yaz('cephe', v)} />
      </div>
      <fieldset className="secenekler">
        <legend>Eklentiler</legend>
        {(['balkon', 'otopark', 'depo'] as const).map((alan) => (
          <label key={alan}>
            <input type="checkbox" checked={form[alan]} onChange={(e) => yaz(alan, e.target.checked)} />{' '}
            {alan === 'balkon' ? 'Balkon' : alan === 'otopark' ? 'Otopark' : 'Depo'}
          </label>
        ))}
      </fieldset>
      <Alan etiket="Diğer özellikler" aciklama="Virgülle ayırın: ebeveyn banyosu, ankastre mutfak">
        <input value={form.ozellikler} onChange={(e) => yaz('ozellikler', e.target.value)} />
      </Alan>
      <div className="iki-sutun">
        <Alan etiket="Satış durumu" aciklama={satisModulunde ? 'Satış kaydından değişir.' : undefined}>
          {satisModulunde ? (
            <input value={SATIS_ADI[bolum.satisDurumu]} readOnly />
          ) : (
            <select value={form.satisDurumu} onChange={(e) => yaz('satisDurumu', e.target.value as BagimsizBolum['satisDurumu'])}>
              <option value="satisa_kapali">{SATIS_ADI.satisa_kapali}</option>
              <option value="satista">{SATIS_ADI.satista}</option>
            </select>
          )}
        </Alan>
        <Alan etiket="Teslim">
          <select value={form.teslimDurumu} onChange={(e) => yaz('teslimDurumu', e.target.value as BagimsizBolum['teslimDurumu'])}>
            <option value="teslim_edilmedi">Teslim edilmedi</option>
            <option value="teslim_edildi">Teslim edildi</option>
          </select>
        </Alan>
      </div>
      <BolumSatisBaglantisi bolum={bolum} />
      <p className="soluk">
        Sahiplik: {props.sahipAdi ? `arsa sahibi ${props.sahipAdi}` : SAHIPLIK_ADI[bolum.sahiplik]}. Arsa sahibine vermek için krokide
        “Seç” ile bölümü seçip “Arsa sahibine ver”e dokunun.
      </p>
      {kutu}
      <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
      {kaydedildi && (
        <p className="mesaj mesaj-basari" role="status">
          Kaydedildi.
        </p>
      )}
      <button type="button" onClick={kaydet}>
        Kaydet
      </button>
    </section>
  );
}

// ─── Ortak alanlar ─────────────────────────────────────────────────

function OrtakAlanlar({ yapi, onDegisti }: { yapi: ProjeYapisi; onDegisti: () => Promise<void> }) {
  const { servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [form, setForm] = useState({ ad: '', tur: ORTAK_ALAN_TURLERI[0]!, blokId: '', alan: '' });
  const [hatalar, setHatalar] = useState<string[]>([]);
  const blokAdi = (id: string | null) => yapi.bloklar.find((b) => b.blok.id === id)?.blok.ad;

  async function ekle() {
    const alanM2 = form.alan.trim() ? sayiOku(form.alan) : null;
    const yeniHatalar = [
      ...(form.ad.trim() ? [] : ['Ortak alanın adını yazın.']),
      ...(form.alan.trim() && (alanM2 === null || alanM2 <= 0) ? ['Alan geçerli bir sayı değil.'] : []),
    ];
    setHatalar(yeniHatalar);
    if (yeniHatalar.length > 0) return;
    try {
      await servis.ekle('ortakAlan', {
        projeId: yapi.proje.id,
        blokId: form.blokId || null,
        katId: null,
        ad: form.ad.trim(),
        tur: form.tur,
        alanM2,
      });
      setForm((f) => ({ ...f, ad: '', alan: '' }));
      await onDegisti();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <section className="kart">
      <h2>Ortak alanlar</h2>
      <p className="soluk">Merdiven, koridor, teknik oda gibi alanlar satış envanterine girmez.</p>
      {kutu}
      {yapi.ortakAlanlar.length > 0 && (
        <ul className="liste">
          {yapi.ortakAlanlar.map((o) => (
            <li key={o.id}>
              <div>
                <strong>{o.ad}</strong>
                <span className="soluk">
                  {' '}
                  · {o.tur}
                  {o.blokId && ` · ${blokAdi(o.blokId)} Blok`}
                  {o.alanM2 !== null && ` · ${sayiYaz(o.alanM2)} m²`}
                </span>
              </div>
              <button
                type="button"
                className="ikincil"
                onClick={() =>
                  void degistir(`${o.ad} kaldırılsın mı?`, async (g) => {
                    await servis.iptal('ortakAlan', o.id, g);
                    await onDegisti();
                  })
                }
              >
                Kaldır
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3>Ortak alan ekle</h3>
      <div className="iki-sutun">
        <Alan etiket="Ad">
          <input value={form.ad} placeholder="A Blok merdiveni" onChange={(e) => setForm({ ...form, ad: e.target.value })} />
        </Alan>
        <Alan etiket="Tür">
          <select value={form.tur} onChange={(e) => setForm({ ...form, tur: e.target.value })}>
            {ORTAK_ALAN_TURLERI.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Blok">
          <select value={form.blokId} onChange={(e) => setForm({ ...form, blokId: e.target.value })}>
            <option value="">Bütün proje</option>
            {yapi.bloklar.map(({ blok }) => (
              <option key={blok.id} value={blok.id}>
                {blok.ad} Blok
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Alan (m²)">
          <input value={form.alan} inputMode="decimal" onChange={(e) => setForm({ ...form, alan: e.target.value })} />
        </Alan>
      </div>
      <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
      <button type="button" className="ikincil" onClick={() => void ekle()}>
        Ekle
      </button>
    </section>
  );
}
