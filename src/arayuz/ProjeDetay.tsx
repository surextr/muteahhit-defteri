import { useCallback, useEffect, useState } from 'react';
import { tamAdres } from '../servisler/adres';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { teslimDurumu, yerelGun } from '../hesap/tarih';
import type { ButceOzeti } from '../hesap/butce';
import { projeButcesiGetir } from '../servisler/kalem';
import { carileriListele, ortakEkle, ortakOraniDegistir, projeOrtaklari, type OrtakSatiri } from '../servisler/cari';
import { ALAN_TANIMLARI, projeYapisiGetir, toplamArsaAlani, type ProjeYapisi } from '../servisler/proje';
import type { BagimsizBolum, Cari, ProjeAlanlari, TakipBasligi } from '../veri/tipler';
import { BelgelerKarti } from './Belgeler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { ButceOzetiKarti } from './ButceEkrani';
import { PROJE_DURUM_ADI } from './ProjeDuzenle';
import { ARSA_TIPI_ADI } from './ProjelerEkrani';

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
const ORTAK_ALAN_TURLERI = ['Merdiven', 'Koridor', 'Asansör', 'Teknik oda', 'Otopark', 'Sığınak', 'Çatı arası', 'Diğer'];

const tarihYaz = (t: string | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '—');

export function ProjeDetay({ projeId }: { projeId: string }) {
  const { depo, oturum } = useUygulama();
  const [yapi, setYapi] = useState<ProjeYapisi | null | undefined>(undefined);
  const [seciliBolumId, setSeciliBolumId] = useState<string | null>(null);

  const yenile = useCallback(async () => {
    setYapi(await projeYapisiGetir(depo, oturum.firmaId, projeId));
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

  return (
    <>
      <p>
        <a href="#/projeler">← Projeler</a>
      </p>
      <h1>{proje.ad}</h1>
      {teslim && <p className={`teslim-rozeti teslim-${teslim.durum}`}>{teslim.metin}</p>}

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

      <div className="dugmeler proje-kisayollari">
        <a className="dugme" href={`#/giderler/yeni/${proje.id}`}>
          + Gider
        </a>
        <a className="dugme ikincil" href={`#/giderler/proje/${proje.id}`}>
          Giderler
        </a>
      </div>

      <ButceKarti projeId={proje.id} />

      <Ortaklar projeId={proje.id} />

      <TakipBasliklari basliklar={yapi.takipBasliklari} onDegisti={yenile} />

      <section className="kart">
        <h2>Bina</h2>
        <p className="soluk">Bir bölüme dokunarak bilgilerini girin.</p>
        <ul className="lejant" aria-label="Renklerin anlamı">
          {Object.entries(SATIS_ADI).map(([k, ad]) => (
            <li key={k}>
              <span className={`cip cip-${k}`} aria-hidden="true" /> {ad}
            </li>
          ))}
        </ul>
        {yapi.bloklar.map(({ blok, katlar }) => (
          <div key={blok.id} className="blok">
            <h3>{blok.ad} Blok</h3>
            <ul className="kat-listesi">
              {katlar.map(({ kat, bolumler }) => (
                <li key={kat.id}>
                  <span className="kat-adi">{kat.ad}</span>
                  <span className="cipler">
                    {bolumler.length === 0 && <em className="soluk">bölüm yok</em>}
                    {bolumler.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        className={`cip cip-${b.satisDurumu}`}
                        aria-pressed={b.id === seciliBolumId}
                        aria-label={`${blok.ad} Blok ${b.no} no'lu ${TIP_ADI[b.tip].toLocaleLowerCase('tr-TR')}, ${SATIS_ADI[b.satisDurumu]}`}
                        onClick={() => setSeciliBolumId(b.id === seciliBolumId ? null : b.id)}
                      >
                        {b.no}
                      </button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      {secili && (
        <BolumFormu
          key={secili.bolum.id}
          bolum={secili.bolum}
          baslik={`${secili.blok.ad} Blok · ${secili.kat.ad} · No ${secili.bolum.no}`}
          onKapat={() => setSeciliBolumId(null)}
          onKaydedildi={yenile}
        />
      )}
      {secili && (
        <BelgelerKarti
          key={`belge-${secili.bolum.id}`}
          bagliTur="bagimsizBolum"
          bagliId={secili.bolum.id}
          varsayilanTur="fotograf"
          baslik={`No ${secili.bolum.no} belgeleri`}
        />
      )}

      <OrtakAlanlar yapi={yapi} onDegisti={yenile} />

      <BelgelerKarti bagliTur="proje" bagliId={projeId} varsayilanTur="diger" baslik="Proje belgeleri" />
    </>
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
  const [adaylar, setAdaylar] = useState<Cari[]>([]);
  const [form, setForm] = useState({ cariId: '', oran: '' });
  const [duzenlenen, setDuzenlenen] = useState<{ id: string; oran: string } | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);

  const yenile = useCallback(async () => {
    const [o, cariler] = await Promise.all([projeOrtaklari(depo, oturum.firmaId, projeId), carileriListele(depo, oturum.firmaId)]);
    setOrtaklar(o);
    setAdaylar(cariler.map((c) => c.cari).filter((c) => c.roller.includes('ortak') && !o.some((x) => x.cari.id === c.id)));
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
      setForm({ cariId: '', oran: '' });
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
      <h3>Ortak ekle</h3>
      {adaylar.length === 0 ? (
        <p className="soluk">
          Listede “Ortak” rolündeki cariler çıkar. <a href="#/cariler/yeni/ortak">Yeni ortak kartı aç</a>
        </p>
      ) : (
        <div className="iki-sutun">
          <Alan etiket="Ortak">
            <select value={form.cariId} onChange={(e) => setForm({ ...form, cariId: e.target.value })}>
              <option value="">Seçin</option>
              {adaylar.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.ad}
                </option>
              ))}
            </select>
          </Alan>
          <Alan etiket="Oran (%)">
            <input value={form.oran} inputMode="decimal" placeholder="25" onChange={(e) => setForm({ ...form, oran: e.target.value })} />
          </Alan>
        </div>
      )}
      <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
      {adaylar.length > 0 && (
        <button type="button" className="ikincil" onClick={() => void ekle()}>
          Ekle
        </button>
      )}
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
  onKapat: () => void;
  onKaydedildi: () => Promise<void>;
}) {
  const { bolum } = props;
  const { servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [form, setForm] = useState({
    tip: bolum.tip,
    odaTipi: bolum.odaTipi ?? '',
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
  const satisModulunde = bolum.satisDurumu === 'rezerve' || bolum.satisDurumu === 'sozlesmeli';

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

    const degisiklik = {
      tip: form.tip,
      odaTipi: form.odaTipi.trim() || null,
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
    <section className="kart" aria-labelledby="bolum-baslik">
      <div className="baslik-satiri">
        <h2 id="bolum-baslik">{props.baslik}</h2>
        <button type="button" className="ikincil" onClick={props.onKapat}>
          Kapat
        </button>
      </div>
      <div className="iki-sutun">
        <Alan etiket="Tip">
          <select value={form.tip} onChange={(e) => yaz('tip', e.target.value as BagimsizBolum['tip'])}>
            {Object.entries(TIP_ADI).map(([k, ad]) => (
              <option key={k} value={k}>
                {ad}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Oda tipi">
          <input value={form.odaTipi} placeholder="3+1" onChange={(e) => yaz('odaTipi', e.target.value)} />
        </Alan>
        <Alan etiket="Brüt m²">
          <input value={form.brutM2} inputMode="decimal" onChange={(e) => yaz('brutM2', e.target.value)} />
        </Alan>
        <Alan etiket="Net m²">
          <input value={form.netM2} inputMode="decimal" onChange={(e) => yaz('netM2', e.target.value)} />
        </Alan>
      </div>
      <Alan etiket="Cephe">
        <input value={form.cephe} placeholder="Güney, doğu" onChange={(e) => yaz('cephe', e.target.value)} />
      </Alan>
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
      <p className="soluk">
        Sahiplik: {SAHIPLIK_ADI[bolum.sahiplik]}. Arsa sahibine ayrılan daireler kat karşılığı sözleşmesinden işaretlenecek.
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
