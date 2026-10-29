import { useCallback, useEffect, useState } from 'react';
import { YZ_OKUNUR } from '../bulut/belgeOku';
import { tlYaz } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import { katKarsiligiGetir } from '../servisler/arsaSahibi';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import { havuzSatiriGetir, type HavuzSatiri } from '../servisler/havuz';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { satisaAcikBolumler } from '../servisler/satis';
import { cariEslestir, hisseleriTamamla, katKarsiligiKur, okunanCariyiAc, satisKur, tipEslestir, ustaSozlesmesiKur } from '../servisler/sozlesmeKur';
import { hazirUstaTipleriniEkle, ustaTipleriListele } from '../servisler/ustaTipi';
import type { CariRol, UstaTipi, YzSozlesme, YzTaraf } from '../veri/tipler';
import { useUygulama, useProjeErisimi, useYetki } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { CariSecici } from './CariSecici';
import { HavuzBelgesiSeridi } from './Havuz';
import { git } from './rota';
import { havuzuYzIleOku, useYzBelgeAyari, YzRizaKutusu } from './YzBelge';

// Program dışında imzalanmış eski sözleşmeyi programa kurma: belge yapay zekâyla ayrıntılı okunur, kullanıcı proje,
// karşı taraf ve işleri seçer/onaylar; sözleşme taslak kurulur, eksikler sözleşme ekranında tamamlanıp imzalanır.

const tarihYaz = (t: string | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '—');
const TUR_ADI = { usta: 'Usta / taşeron', kat_karsiligi: 'Kat karşılığı', satis: 'Daire satışı' } as const;
type KurTuru = keyof typeof TUR_ADI;

/** Karşı taraf: kayıtlı cari önerisi, seçici ve "okunan bilgilerle kart aç". */
function KarsiTaraf(props: { cariler: CariOzeti[]; taraf: YzTaraf; rol: CariRol; secili: string | null; onSec: (id: string | null) => void; onAcildi: (c: CariOzeti) => void }) {
  const { depo, servis } = useUygulama();
  const [hata, setHata] = useState<string | null>(null);
  const eslesen = cariEslestir(props.cariler, props.taraf);
  return (
    <div className="alan">
      <span className="alan-etiket">{props.rol === 'musteri' ? 'Müşteri' : 'Yüklenici (usta / taşeron)'}</span>
      {props.taraf.ad && (
        <p className="soluk kucuk">
          Sözleşmede: {props.taraf.ad}
          {props.taraf.no && ` · ${props.taraf.no}`}
          {props.taraf.telefon && ` · ${props.taraf.telefon}`}
        </p>
      )}
      {eslesen && !props.secili && (
        <p className="mesaj mesaj-not">
          Kayıtlı cari: <strong>{eslesen.ad}</strong>{' '}
          <button type="button" className="ikincil" onClick={() => props.onSec(eslesen.id)}>
            ★ Bu cariyi seç
          </button>
        </p>
      )}
      {!eslesen && !props.secili && props.taraf.ad && (
        <p className="mesaj mesaj-not">
          Bu kişi kayıtlı değil.{' '}
          <button
            type="button"
            className="ikincil"
            onClick={() =>
              void okunanCariyiAc(depo, servis, props.taraf, props.rol)
                .then((c) => props.onAcildi({ cari: c, bakiye: 0 }))
                .catch((e: unknown) => setHata(hataMetni(e)))
            }
          >
            Okunan bilgilerle kart aç
          </button>
        </p>
      )}
      <CariSecici key={props.secili ?? ''} cariler={props.cariler} secili={props.secili} onSec={props.onSec} oncelikli={[props.rol]} />
      {hata && <Hatalar hatalar={[hata]} />}
    </div>
  );
}

function OkunanOzet({ o }: { o: YzSozlesme }) {
  return (
    <section className="kart">
      <h2>🤖 Okunanlar</h2>
      <dl className="bilgi">
        <dt>Sözleşme tarihi</dt>
        <dd>{tarihYaz(o.tarih)}</dd>
        {o.karsiTaraf.ad && (
          <>
            <dt>Karşı taraf</dt>
            <dd>{[o.karsiTaraf.ad, o.karsiTaraf.no, o.karsiTaraf.telefon].filter(Boolean).join(' · ')}</dd>
          </>
        )}
        {o.usta && (
          <>
            <dt>İşler</dt>
            <dd>{o.usta.isler.join(', ') || '—'}</dd>
            <dt>Kalemler</dt>
            <dd>
              {o.usta.kalemler.length === 0
                ? '—'
                : o.usta.kalemler.map((k) => `${k.ad} ${k.miktar !== null ? `${sayiYaz(k.miktar)} ${k.birim ?? ''}` : ''} ${k.birimFiyat !== null ? `× ${tlYaz(k.birimFiyat)}` : '(fiyat yok)'}`).join('; ')}
            </dd>
            <dt>Şartlar</dt>
            <dd>{o.usta.ozelSartlar.length} madde</dd>
            {o.usta.odemePlani.length > 0 && (
              <>
                <dt>Ödeme planı</dt>
                <dd>{o.usta.odemePlani.length} satır</dd>
              </>
            )}
          </>
        )}
        {o.katKarsiligi && (
          <>
            <dt>Arsa sahipleri</dt>
            <dd>{o.katKarsiligi.arsaSahipleri.map((a) => `${a.ad}${a.hisse !== null ? ` %${sayiYaz(a.hisse)}` : ''}`).join(', ') || '—'}</dd>
            <dt>Paylaşım</dt>
            <dd>{o.katKarsiligi.arsaSahibiOrani !== null ? `arsa sahipleri %${sayiYaz(o.katKarsiligi.arsaSahibiOrani)}` : '—'}</dd>
            <dt>Teslim</dt>
            <dd>{o.katKarsiligi.teslimSuresiAy ? `ruhsattan ${o.katKarsiligi.teslimSuresiAy} ay` : tarihYaz(o.katKarsiligi.teslimTarihi)}</dd>
          </>
        )}
        {o.satis && (
          <>
            <dt>Bölüm</dt>
            <dd>{[o.satis.blok, o.satis.daireNo].filter(Boolean).join('-') || '—'}</dd>
            <dt>Fiyat</dt>
            <dd>{o.satis.fiyat !== null ? `${tlYaz(o.satis.fiyat)}${o.satis.paraBirimi !== 'TRY' ? ` (${o.satis.paraBirimi})` : ''}` : '—'}</dd>
            <dt>Ödeme planı</dt>
            <dd>{o.satis.plan.length} satır</dd>
          </>
        )}
      </dl>
      {o.eksikler.length > 0 && (
        <div className="mesaj mesaj-uyari">
          <strong>Sözleşmede okunamayan ya da belirsiz:</strong>
          <ul>
            {o.eksikler.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

const UYARI_ANAHTARI = 'sozlesmeKurUyarilari';
function uyarilariSakla(u: string[]) {
  try {
    sessionStorage.setItem(UYARI_ANAHTARI, JSON.stringify(u));
  } catch {
    // Uyarılar gösterilemez; kayıt yine kuruldu.
  }
}

/** Kurulan sözleşmenin ekranında bir kez: okunamayan bilgiler, tamamlanacaklar. */
export function KurulumUyarilari() {
  const [u] = useState<string[] | null>(() => {
    try {
      const s = sessionStorage.getItem(UYARI_ANAHTARI);
      if (!s) return null;
      sessionStorage.removeItem(UYARI_ANAHTARI);
      const l: unknown = JSON.parse(s);
      return Array.isArray(l) ? l.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return null;
    }
  });
  const [gorunur, setGorunur] = useState(true);
  if (!gorunur || u === null) return null;
  return (
    <div className="mesaj mesaj-basari" role="status">
      <strong>Eski sözleşme programa kuruldu (taslak).</strong> Eksikleri tamamlayıp "imzalandı" olarak onaylayın.
      {u.length > 0 && (
        <ul>
          {u.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )}
      <button type="button" className="baglanti-dugmesi" onClick={() => setGorunur(false)}>
        Kapat
      </button>
    </div>
  );
}

export function HavuzSozlesme({ havuzId }: { havuzId: string }) {
  const { depo, oturum, servis, firma } = useUygulama();
  const yetki = useYetki();
  const erisim = useProjeErisimi();
  const [satir, setSatir] = useState<HavuzSatiri | null | undefined>(undefined);
  const [yzAyar] = useYzBelgeAyari();
  const [rizaSoruluyor, setRizaSoruluyor] = useState(false);
  const [okunuyor, setOkunuyor] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [uyarilar, setUyarilar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);

  const [tur, setTur] = useState<KurTuru>('usta');
  const [projeler, setProjeler] = useState<ProjeOzeti[]>([]);
  const [projeId, setProjeId] = useState('');
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [cariId, setCariId] = useState<string | null>(null);
  const [tipler, setTipler] = useState<UstaTipi[]>([]);
  const [tipIdleri, setTipIdleri] = useState<string[]>([]);
  const [bolumler, setBolumler] = useState<{ bolum: { id: string; no: string }; no: string }[]>([]);
  const [bolumId, setBolumId] = useState('');
  const [oran, setOran] = useState('');
  const [sahipler, setSahipler] = useState<{ ad: string; no: string | null; cariId: string | null; hisse: string }[]>([]);
  const [katVar, setKatVar] = useState(false);

  const yenile = useCallback(async () => {
    const s = await havuzSatiriGetir(depo, oturum.firmaId, havuzId);
    setSatir(s);
    const o = s?.havuz.okuma?.sozlesme;
    if (o) {
      if (o.tur !== 'diger') setTur(o.tur);
      setOran(o.katKarsiligi?.arsaSahibiOrani !== null && o.katKarsiligi?.arsaSahibiOrani !== undefined ? sayiYaz(o.katKarsiligi.arsaSahibiOrani) : '');
    }
  }, [depo, oturum.firmaId, havuzId]);

  useEffect(() => {
    void yenile();
    void projeleriListele(depo, oturum.firmaId, erisim).then(setProjeler);
    void carileriListele(depo, oturum.firmaId).then((l) => setCariler(l.filter((c) => !c.cari.roller.includes('vergi_dairesi'))));
    void hazirUstaTipleriniEkle(depo, servis)
      .catch(() => 0)
      .then(() => ustaTipleriListele(depo, oturum.firmaId))
      .then((t) => setTipler(t.filter((x) => !x.gizli)));
  }, [yenile, depo, servis, oturum.firmaId, erisim]);

  const okuma = satir?.havuz.okuma?.sozlesme ?? null;

  // Okunan işlere uyan tipler önerili gelir.
  useEffect(() => {
    if (okuma?.usta && tipler.length > 0) setTipIdleri((x) => (x.length > 0 ? x : tipEslestir(tipler, okuma.usta!.isler)));
  }, [okuma, tipler]);

  // Kat karşılığında arsa sahipleri kayıtlı cariyle eşleştirilir; hisse yoksa eşit bölünür.
  useEffect(() => {
    const k = okuma?.katKarsiligi;
    if (!k || cariler.length === 0) return;
    setSahipler((x) => {
      if (x.length > 0) return x;
      const h = hisseleriTamamla(k.arsaSahipleri.map((a) => a.hisse));
      return k.arsaSahipleri.map((a, i) => ({ ad: a.ad, no: a.no, cariId: cariEslestir(cariler, a)?.id ?? null, hisse: sayiYaz(h[i]!) }));
    });
  }, [okuma, cariler]);

  // Satışta: projenin satışa açık bölümleri, okunan daire no'su önerili.
  useEffect(() => {
    setBolumler([]);
    setKatVar(false);
    if (!projeId) return;
    if (tur === 'satis') {
      void satisaAcikBolumler(depo, oturum.firmaId, projeId).then((l) => {
        setBolumler(l);
        const s = okuma?.satis;
        const aranan = s?.daireNo ? (s.blok ? `${s.blok}-${s.daireNo}` : s.daireNo) : null;
        const b = aranan ? l.find((x) => x.no.toLocaleUpperCase('tr') === aranan.toLocaleUpperCase('tr') || x.bolum.no === s?.daireNo) : undefined;
        setBolumId(b?.bolum.id ?? '');
      });
    }
    if (tur === 'kat_karsiligi') void katKarsiligiGetir(depo, oturum.firmaId, projeId).then((k) => setKatVar(!!k));
  }, [projeId, tur, depo, oturum.firmaId, okuma]);

  if (satir === undefined) return <p>Yükleniyor…</p>;
  if (!satir || satir.havuz.durum !== 'bekliyor') {
    return (
      <section className="kart">
        <p>Belge havuzda bulunamadı; bağlanmış ya da kaldırılmış olabilir.</p>
        <a className="dugme ikincil" href="#/havuz">
          Belge havuzuna dön
        </a>
      </section>
    );
  }

  async function oku() {
    if (!yzAyar?.riza) return setRizaSoruluyor(true);
    setHata(null);
    setOkunuyor(true);
    try {
      await havuzuYzIleOku(depo, servis, firma, havuzId, 'sozlesme');
      await yenile();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setOkunuyor(false);
    }
  }

  async function kur() {
    if (!okuma) return;
    setHata(null);
    setUyarilar([]);
    setIslemde(true);
    try {
      if (tur === 'usta') {
        if (!projeId || !cariId || tipIdleri.length === 0) throw new Error('Projeyi, yükleniciyi ve en az bir işi seçin.');
        const { sozlesme, uyarilar } = await ustaSozlesmesiKur(depo, servis, firma, { havuzId, projeId, cariId, ustaTipiIdleri: tipIdleri, okuma });
        uyarilariSakla(uyarilar);
        git(`sozlesmeler/${sozlesme.id}`);
      } else if (tur === 'satis') {
        if (!bolumId || !cariId) throw new Error('Bölümü ve müşteriyi seçin.');
        const { satis, uyarilar } = await satisKur(depo, servis, firma, { havuzId, bolumId, cariId, okuma, bugun: yerelGun(new Date()) });
        uyarilariSakla(uyarilar);
        git(`satislar/${satis.id}`);
      } else {
        const o = sayiOku(oran.replace('%', ''));
        if (!projeId) throw new Error('Projeyi seçin.');
        if (o === null) throw new Error('Arsa sahiplerinin payını yazın.');
        if (sahipler.length === 0 || sahipler.some((s) => !s.cariId)) throw new Error('Her arsa sahibi için cari seçin ya da kart açın.');
        const liste = sahipler.map((s) => ({ cariId: s.cariId!, hisse: sayiOku(s.hisse.replace('%', '')) ?? 0 }));
        const { uyarilar } = await katKarsiligiKur(depo, servis, { havuzId, projeId, oran: o, sahipler: liste, okuma });
        uyarilariSakla(uyarilar);
        git(`projeler/${projeId}`);
      }
    } catch (e) {
      setHata(hataMetni(e));
      setIslemde(false);
    }
  }

  const turYetkisi: Record<KurTuru, boolean> = { usta: yetki('sozlesme'), kat_karsiligi: yetki('proje'), satis: yetki('satis') };
  const uygunProjeler = tur === 'kat_karsiligi' ? projeler.filter((p) => p.proje.arsaTipi === 'kat_karsiligi') : projeler;
  const cariEkle = (c: CariOzeti) => setCariler((l) => [...l, c]);

  return (
    <>
      <p>
        <a href={`#/havuz/${havuzId}`}>← Belge</a>
      </p>
      <h1>Eski sözleşmeyi programa kur</h1>
      <section className="kart">
        <HavuzBelgesiSeridi belge={satir.belge} />
        <p className="soluk">
          Program dışında imzalanmış sözleşme okunur; siz projeyi, karşı tarafı ve işleri onaylarsınız. Sözleşme taslak kurulur, okunamayan bilgiler boş
          kalır; sözleşme ekranında tamamlayıp "imzalandı" olarak onaylarsınız. Taranmış asıl nüsha sözleşmeye eklenir.
        </p>
        {!okuma &&
          (YZ_OKUNUR.has(satir.belge.mime) ? (
            rizaSoruluyor ? (
              <YzRizaKutusu onVerildi={() => (setRizaSoruluyor(false), void oku())} onVazgec={() => setRizaSoruluyor(false)} />
            ) : (
              <button type="button" disabled={okunuyor} onClick={() => void oku()}>
                {okunuyor ? 'Sözleşme okunuyor… (bir dakika sürebilir)' : '🤖 Sözleşmeyi yapay zekâ ile oku'}
              </button>
            )
          ) : (
            <p className="mesaj mesaj-uyari">Bu dosya okunamaz; sözleşmeyi elle kurup belgeyi "Bir kayda bağla" ile ekleyin.</p>
          ))}
        {hata && !okuma && <Hatalar hatalar={[hata]} />}
      </section>

      {okuma && <OkunanOzet o={okuma} />}

      {okuma && (
        <section className="kart">
          <h2>Kurulacak kayıt</h2>
          <div className="filtreler" role="group" aria-label="Sözleşme türü">
            {(Object.keys(TUR_ADI) as KurTuru[]).map((t) => (
              <button key={t} type="button" aria-pressed={tur === t} disabled={!turYetkisi[t]} onClick={() => (setTur(t), setCariId(null))}>
                {TUR_ADI[t]}
              </button>
            ))}
          </div>
          <Alan etiket="Proje">
            <select value={projeId} onChange={(e) => setProjeId(e.target.value)}>
              <option value="">Seçin</option>
              {uygunProjeler.map((p) => (
                <option key={p.proje.id} value={p.proje.id}>
                  {p.proje.ad}
                </option>
              ))}
            </select>
          </Alan>

          {tur === 'usta' && (
            <>
              <KarsiTaraf cariler={cariler} taraf={okuma.karsiTaraf} rol="usta" secili={cariId} onSec={setCariId} onAcildi={(c) => (cariEkle(c), setCariId(c.cari.id))} />
              <fieldset className="secenekler">
                <legend>İşler (usta tipleri)</legend>
                {tipler.map((t) => (
                  <label key={t.id}>
                    <input
                      type="checkbox"
                      checked={tipIdleri.includes(t.id)}
                      onChange={(e) => setTipIdleri((x) => (e.target.checked ? [...x, t.id] : x.filter((id) => id !== t.id)))}
                    />{' '}
                    {t.ad}
                  </label>
                ))}
              </fieldset>
            </>
          )}

          {tur === 'satis' && (
            <>
              {projeId && (
                <Alan etiket="Bağımsız bölüm" aciklama={okuma.satis?.daireNo ? `Sözleşmede: ${[okuma.satis.blok, okuma.satis.daireNo].filter(Boolean).join('-')}` : undefined}>
                  <select value={bolumId} onChange={(e) => setBolumId(e.target.value)}>
                    <option value="">Seçin</option>
                    {bolumler.map((b) => (
                      <option key={b.bolum.id} value={b.bolum.id}>
                        {b.no}
                      </option>
                    ))}
                  </select>
                </Alan>
              )}
              <KarsiTaraf cariler={cariler} taraf={okuma.karsiTaraf} rol="musteri" secili={cariId} onSec={setCariId} onAcildi={(c) => (cariEkle(c), setCariId(c.cari.id))} />
            </>
          )}

          {tur === 'kat_karsiligi' && (
            <>
              {katVar && <p className="mesaj mesaj-uyari">Bu projede kat karşılığı sözleşmesi zaten var; belgeyi "Bir kayda bağla" ile ona ekleyin.</p>}
              <Alan etiket="Arsa sahiplerinin payı (%)">
                <input value={oran} inputMode="decimal" placeholder="45" onChange={(e) => setOran(e.target.value)} />
              </Alan>
              <h3>Arsa sahipleri</h3>
              {sahipler.length === 0 && <p className="soluk">Sözleşmede arsa sahibi okunamadı.</p>}
              {sahipler.map((s, i) => (
                <div key={i} className="arsa-sahibi-satiri">
                  <p>
                    <strong>{s.ad}</strong>
                    {s.no && <span className="soluk"> · {s.no}</span>}
                  </p>
                  {!s.cariId && (
                    <button
                      type="button"
                      className="ikincil"
                      onClick={() =>
                        void okunanCariyiAc(depo, servis, { ad: s.ad, no: s.no, telefon: null, adres: null, yetkili: null }, 'arsa_sahibi')
                          .then((c) => (cariEkle({ cari: c, bakiye: 0 }), setSahipler((x) => x.map((y, j) => (j === i ? { ...y, cariId: c.id } : y)))))
                          .catch((e: unknown) => setHata(hataMetni(e)))
                      }
                    >
                      Kart aç
                    </button>
                  )}
                  <CariSecici
                    key={s.cariId ?? `bos-${i}`}
                    cariler={cariler}
                    secili={s.cariId}
                    onSec={(id) => setSahipler((x) => x.map((y, j) => (j === i ? { ...y, cariId: id } : y)))}
                    oncelikli={['arsa_sahibi']}
                  />
                  <div className="arsa-sahibi-hisse">
                    <label>
                      Hisse %
                      <input value={s.hisse} inputMode="decimal" onChange={(e) => setSahipler((x) => x.map((y, j) => (j === i ? { ...y, hisse: e.target.value } : y)))} />
                    </label>
                  </div>
                </div>
              ))}
            </>
          )}

          {hata && <Hatalar hatalar={[hata]} />}
          {uyarilar.length > 0 && <Hatalar hatalar={uyarilar} />}
          <div className="dugmeler">
            <button type="button" disabled={islemde || !turYetkisi[tur] || (tur === 'kat_karsiligi' && katVar)} onClick={() => void kur()}>
              {islemde ? 'Kuruluyor…' : 'Taslak olarak kur'}
            </button>
            <button type="button" className="ikincil" disabled={okunuyor} onClick={() => void oku()}>
              {okunuyor ? 'Okunuyor…' : 'Yeniden oku'}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
