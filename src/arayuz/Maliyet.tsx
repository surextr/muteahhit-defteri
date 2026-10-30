import { useCallback, useEffect, useMemo, useState } from 'react';
import { FIYAT_KAYNAGI_ADI } from '../hesap/fiyat';
import { BOS_GIRDILER, GIRDI_ADI, maliyetOzeti, type HesaplananSatir, type MaliyetOzeti } from '../hesap/maliyet';
import { aramaUyar } from '../hesap/metin';
import { tlOku, tlYaz } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import { fiyatGir, fiyatKalemleri, hazirFiyatKalemleriniEkle } from '../servisler/fiyat';
import {
  elleSatir,
  formulSatiri,
  katalogHaritasi,
  maliyetHesabiGetir,
  maliyetHesabiIptal,
  maliyetHesabiKaydet,
  maliyetHesabiOlustur,
  maliyetHesabiOnayla,
  maliyetHesaplari,
  projedenGirdiler,
  revizyonAc,
} from '../servisler/maliyet';
import { projeleriListele } from '../servisler/proje';
import { FIYAT_KALEMI_TURU_ADI } from '../veri/sabit/hazirFiyatKalemleri';
import { MALIYET_FORMULLERI } from '../veri/sabit/maliyetFormulleri';
import type { BinaGirdileri, FiyatKalemi, MaliyetHesabi, MaliyetSatiri, Proje } from '../veri/tipler';
import { AktarmaDugmeleri } from './Aktarma';
import { useProjeErisimi, useUygulama } from './baglam';
import { Alan, BosDurum, Hatalar, hataMetni } from './bilesenler';
import { BUTCE_SIRASI, fiyatListesiOzeti, grupAdi, KAYNAK_SIMGESI, MaliyetSekmeleri, tarihYaz, tlMetni } from './Fiyatlar';
import { TutarGirdisi } from './Girdiler';
import { git } from './rota';

// Maliyet hesapları: liste, yeni hesap (projeli / projesiz), hesap ekranı (girdiler, satırlar, toplamlar, onay, revizyon).

const TURLER = ['malzeme', 'iscilik', 'makine'] as const;
const KAYNAK_ISARETI: Record<MaliyetSatiri['miktarKaynagi'], { simge: string; ad: string }> = {
  formul: { simge: '🧮', ad: 'Formülle' },
  elle: { simge: '✍️', ad: 'Elle' },
  proje: { simge: '📐', ad: 'Projeden' },
};
const miktarYaz = (m: number | null) => (m === null ? '—' : sayiYaz(Math.round(m * 100) / 100));
const yuzde = (a: number, b: number) => (b ? `%${Math.round((a / b) * 100)}` : '');

// ─── Liste ve yeni hesap ───────────────────────────────────────────

interface ListeSatiri {
  hesap: MaliyetHesabi;
  ozet: MaliyetOzeti;
  projeAdi: string | null;
}

export function MaliyetEkrani({ projeId }: { projeId?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const erisim = useProjeErisimi();
  const [liste, setListe] = useState<ListeSatiri[] | null>(null);
  const [projeler, setProjeler] = useState<Proje[]>([]);
  const [katalog, setKatalog] = useState<FiyatKalemi[]>([]);
  const [yeni, setYeni] = useState(!!projeId);
  const [yazabilir, setYazabilir] = useState(true);
  const bugun = yerelGun(new Date());

  const yenile = useCallback(async () => {
    await hazirFiyatKalemleriniEkle(depo, servis).catch(() => 0);
    const [hesaplar, p, k] = await Promise.all([maliyetHesaplari(depo, oturum.firmaId, projeId), projeleriListele(depo, oturum.firmaId, erisim), fiyatKalemleri(depo, oturum.firmaId)]);
    const harita = new Map(k.map((x) => [x.id, x]));
    const projeAdi = new Map(p.map((x) => [x.proje.id, x.proje.ad]));
    setProjeler(p.map((x) => x.proje));
    setKatalog(k);
    setListe(
      hesaplar
        .filter((h) => !h.projeId || !erisim || erisim.has(h.projeId))
        .map((h) => ({ hesap: h, ozet: maliyetOzeti(h, harita), projeAdi: h.projeId ? (projeAdi.get(h.projeId) ?? '?') : null })),
    );
  }, [depo, oturum.firmaId, servis, projeId, erisim]);
  useEffect(() => {
    void yenile();
    void servis.yazabilir('maliyetHesabi').then(setYazabilir);
  }, [yenile, servis]);

  const f = fiyatListesiOzeti(katalog, bugun);
  const proje = projeId ? projeler.find((p) => p.id === projeId) : undefined;
  return (
    <>
      {projeId && (
        <p>
          <a className="geri-baglanti" href={`#/projeler/${projeId}`}>← {proje?.ad ?? 'Proje'}</a>
        </p>
      )}
      <MaliyetSekmeleri aktif="hesaplar" />
      {katalog.length > 0 && (
        <p className="kucuk-bilgi">
          Fiyat listesi: {f.guncel} güncel, {f.eski} eski, {f.yok} fiyatsız kalem ·{' '}
          <a href="#/maliyet/fiyatlar">Fiyat listesini aç</a>
        </p>
      )}
      {yazabilir && !yeni && (
        <p>
          <button type="button" onClick={() => setYeni(true)}>
            + Yeni maliyet hesabı
          </button>
        </p>
      )}
      {yeni && <YeniHesap projeler={projeler} projeId={projeId ?? null} onVazgec={() => setYeni(false)} />}
      {liste === null && <p>Yükleniyor…</p>}
      {liste?.length === 0 && !yeni && (
        <BosDurum metin={projeId ? 'Bu projenin maliyet hesabı yok.' : 'Henüz maliyet hesabı yok. Projeli ya da projesiz bir hesap açın; miktarlar binanın bilgilerinden formülle gelir.'} />
      )}
      <ul className="kart-listesi">
        {liste?.map(({ hesap: h, ozet: o, projeAdi }) => (
          <li key={h.id}>
            <a className="kart maliyet-karti" href={`#/maliyet/${h.id}`}>
              <span className="mk-ust">
                <strong>{h.ad}</strong>
                <span className="etiket-cip">Rev. {h.revizyon}</span>
                {h.onay ? <span className="rozet-tamam">✔ Başlangıç maliyeti</span> : <span className="rozet-taslak">Taslak</span>}
              </span>
              <span className="soluk">
                {projeAdi ?? 'Projesiz'} · {tarihYaz(h.olusturmaZamani.slice(0, 10))}
              </span>
              <span className="mk-tutar">
                <strong>{tlYaz(o.toplam)}</strong> <span className="soluk">KDV hariç</span>
                {o.m2Basina !== null && <span className="soluk"> · {tlYaz(o.m2Basina)}/m²</span>}
              </span>
              {(o.fiyatsiz.length > 0 || o.miktarsiz.length > 0) && (
                <span className="rozet-gecikti">
                  ⚠ {[o.fiyatsiz.length && `${o.fiyatsiz.length} fiyatsız`, o.miktarsiz.length && `${o.miktarsiz.length} miktarsız`].filter(Boolean).join(', ')}
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function YeniHesap({ projeler, projeId, onVazgec }: { projeler: Proje[]; projeId: string | null; onVazgec: () => void }) {
  const { depo, oturum, servis } = useUygulama();
  const [ad, setAd] = useState('');
  const [proje, setProje] = useState<string>(projeId ?? '');
  const [girdiler, setGirdiler] = useState<BinaGirdileri>(BOS_GIRDILER);
  const [notlar, setNotlar] = useState<string[]>([]);
  const [hata, setHata] = useState<string[]>([]);
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => {
    setNotlar([]);
    if (!proje) return;
    const p = projeler.find((x) => x.id === proje);
    if (p) setAd((a) => a || `${p.ad} maliyet hesabı`);
    void projedenGirdiler(depo, oturum.firmaId, proje).then(
      (r) => {
        setGirdiler((g) => ({ ...g, ...r.girdiler }));
        setNotlar(r.notlar);
      },
      () => undefined,
    );
  }, [proje, projeler, depo, oturum.firmaId]);

  const olustur = async () => {
    setHata([]);
    setMesgul(true);
    try {
      const h = await maliyetHesabiOlustur(depo, servis, { ad, projeId: proje || null, girdiler, aciklama: '' });
      git(`maliyet/${h.id}`);
    } catch (e) {
      setHata([hataMetni(e)]);
      setMesgul(false);
    }
  };

  return (
    <form
      className="kart"
      onSubmit={(e) => {
        e.preventDefault();
        void olustur();
      }}
    >
      <h2>Yeni maliyet hesabı</h2>
      <Alan etiket="Proje" aciklama="Projesiz hesapta bina bilgilerini elle girersiniz">
        <select value={proje} onChange={(e) => setProje(e.target.value)}>
          <option value="">Projesiz</option>
          {projeler.map((p) => (
            <option key={p.id} value={p.id}>
              {p.ad}
            </option>
          ))}
        </select>
      </Alan>
      <Alan etiket="Hesabın adı">
        <input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Örn. Güneş Apt. ön maliyet" />
      </Alan>
      {notlar.length > 0 && <p className="mesaj-not">Projeden dolduruldu: {notlar.join(' · ')}. Diğerlerini siz girin.</p>}
      <GirdiAlanlari girdiler={girdiler} onDegisti={setGirdiler} />
      <p className="mesaj-not">Miktarlar bu bilgilerden hazır formüllerle hesaplanır. Boş bıraktığınız bilgiye dayanan satırın miktarı çıkmaz; sonra tamamlayabilirsiniz.</p>
      <Hatalar hatalar={hata} />
      <div className="dugmeler">
        <button type="submit" disabled={mesgul}>
          Hesabı oluştur
        </button>
        <button type="button" className="ikincil" onClick={onVazgec}>
          Vazgeç
        </button>
      </div>
    </form>
  );
}

/** Bina bilgileri; her alan sayı (Türkçe ondalık). */
function GirdiAlanlari({ girdiler, onDegisti, kilitli }: { girdiler: BinaGirdileri; onDegisti: (g: BinaGirdileri) => void; kilitli?: boolean }) {
  const [metin, setMetin] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(girdiler).map(([k, v]) => [k, sayiYaz(v)])));
  useEffect(() => {
    setMetin((m) => {
      const y = { ...m };
      for (const [k, v] of Object.entries(girdiler)) if (sayiOku(m[k] ?? '') !== v) y[k] = sayiYaz(v);
      return y;
    });
  }, [girdiler]);
  return (
    <div className="girdi-izgarasi">
      {(Object.keys(GIRDI_ADI) as (keyof BinaGirdileri)[]).map((k) => (
        <Alan key={k} etiket={`${GIRDI_ADI[k].ad} (${GIRDI_ADI[k].birim})`} aciklama={k === 'disCevre' ? 'Boşsa taban alanından yaklaşık' : undefined}>
          <input
            inputMode="decimal"
            disabled={kilitli}
            value={metin[k] ?? ''}
            onChange={(e) => {
              setMetin((m) => ({ ...m, [k]: e.target.value }));
              const v = e.target.value.trim() === '' ? null : sayiOku(e.target.value);
              if (v !== null || e.target.value.trim() === '') onDegisti({ ...girdiler, [k]: v });
            }}
          />
        </Alan>
      ))}
    </div>
  );
}

// ─── Hesap ekranı ──────────────────────────────────────────────────

type Suzgec = 'hepsi' | 'fiyatsiz' | 'elle' | 'miktarsiz';

export function MaliyetHesabiEkrani({ id }: { id: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [h, setH] = useState<MaliyetHesabi | null | undefined>(undefined);
  const [katalog, setKatalog] = useState<Map<string, FiyatKalemi>>(new Map());
  const [projeAdi, setProjeAdi] = useState<string | null>(null);
  const [revizyonu, setRevizyonu] = useState<MaliyetHesabi | null>(null);
  const [tur, setTur] = useState<MaliyetSatiri['tur']>('malzeme');
  const [suzgec, setSuzgec] = useState<Suzgec>('hepsi');
  const [acik, setAcik] = useState<string | null>(null);
  const [girdiAcik, setGirdiAcik] = useState(false);
  const [ekle, setEkle] = useState(false);
  const [hata, setHata] = useState<string[]>([]);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [kaldirSoru, setKaldirSoru] = useState(false);
  const [yazabilir, setYazabilir] = useState(true);

  const yenile = useCallback(async () => {
    const x = await maliyetHesabiGetir(depo, oturum.firmaId, id);
    setH(x);
    setKatalog(await katalogHaritasi(depo, oturum.firmaId));
    if (x?.projeId) setProjeAdi((await depo.getir('proje', x.projeId))?.ad ?? null);
    setRevizyonu((await maliyetHesaplari(depo, oturum.firmaId)).find((y) => y.oncekiHesapId === id) ?? null);
  }, [depo, oturum.firmaId, id]);
  useEffect(() => {
    void yenile();
    void servis.yazabilir('maliyetHesabi').then(setYazabilir);
  }, [yenile, servis]);

  const ozet = useMemo(() => (h ? maliyetOzeti(h, katalog) : null), [h, katalog]);
  if (h === undefined) return <p>Yükleniyor…</p>;
  if (h === null || !ozet) return <p className="hata">Maliyet hesabı bulunamadı.</p>;
  const kilitli = !!h.onay || !yazabilir;

  const calistir = async (is: () => Promise<unknown>, basari?: string) => {
    setHata([]);
    setBilgi(null);
    try {
      await is();
      await yenile();
      if (basari) setBilgi(basari);
      return true;
    } catch (e) {
      setHata([hataMetni(e)]);
      return false;
    }
  };
  const kaydet = (d: Partial<{ girdiler: BinaGirdileri; satirlar: MaliyetSatiri[]; ad: string }>, basari?: string) =>
    calistir(() => maliyetHesabiKaydet(depo, servis, h.id, { ad: d.ad ?? h.ad, aciklama: h.aciklama, girdiler: d.girdiler ?? h.girdiler, satirlar: d.satirlar ?? h.satirlar }), basari);
  const satirDegistir = (s: MaliyetSatiri) => kaydet({ satirlar: h.satirlar.map((x) => (x.id === s.id ? s : x)) });
  const satirCikar = (sid: string) => kaydet({ satirlar: h.satirlar.filter((x) => x.id !== sid) });

  const gorunen = ozet.satirlar
    .filter((x) => x.satir.tur === tur)
    .filter((x) =>
      suzgec === 'fiyatsiz' ? ozet.fiyatsiz.includes(x) : suzgec === 'miktarsiz' ? x.satir.miktar === null : suzgec === 'elle' ? x.satir.miktarKaynagi !== 'formul' : true,
    );
  const gruplar = new Map<string, HesaplananSatir[]>();
  for (const x of gorunen) gruplar.set(grupAdi(x.satir.butceKalemiKodu), [...(gruplar.get(grupAdi(x.satir.butceKalemiKodu)) ?? []), x]);
  const grupSirasi = [...gruplar.entries()].sort((a, b) => (BUTCE_SIRASI.get(a[1][0]!.satir.butceKalemiKodu ?? '') ?? 9999) - (BUTCE_SIRASI.get(b[1][0]!.satir.butceKalemiKodu ?? '') ?? 9999));
  const eksikFormuller = MALIYET_FORMULLERI.filter((f) => !h.satirlar.some((s) => s.formulKodu === f.kod));

  return (
    <>
      <p>
        <a className="geri-baglanti" href={h.projeId ? `#/maliyet/proje/${h.projeId}` : '#/maliyet'}>← Maliyet hesapları</a>
      </p>
      <div className="baslik-satiri">
        <h1>
          {h.ad} <span className="etiket-cip">Rev. {h.revizyon}</span>
        </h1>
        {h.onay ? <span className="rozet-tamam">✔ Başlangıç maliyeti</span> : <span className="rozet-taslak">Taslak</span>}
      </div>
      <p className="soluk">
        {h.projeId ? <a href={`#/projeler/${h.projeId}`}>{projeAdi ?? 'Proje'}</a> : 'Projesiz'}
        {h.onay && ` · ${tarihYaz(h.onay.zaman.slice(0, 10))} tarihinde onaylandı; fiyatlar o günkü hâliyle donduruldu`}
        {h.oncekiHesapId && (
          <>
            {' · '}
            <a href={`#/maliyet/${h.oncekiHesapId}`}>Önceki revizyon</a>
          </>
        )}
      </p>

      <section className="kart maliyet-ozeti">
        <div className="mo-toplam">
          <span className="soluk">Toplam (KDV hariç)</span>
          <strong>{tlYaz(ozet.toplam)}</strong>
          <span className="soluk">
            KDV {tlYaz(ozet.kdv)} · KDV dahil {tlYaz(ozet.toplam + ozet.kdv)}
            {ozet.m2Basina !== null && ` · ${tlYaz(ozet.m2Basina)}/m²`}
          </span>
        </div>
        <div className="mo-turler">
          {TURLER.map((t) => (
            <button key={t} type="button" className={`mo-tur ${tur === t ? 'secili' : ''}`} onClick={() => setTur(t)}>
              <span>{FIYAT_KALEMI_TURU_ADI[t]}</span>
              <strong>{tlYaz(ozet.turler[t].tutar)}</strong>
              <span className="soluk">
                {[yuzde(ozet.turler[t].tutar, ozet.toplam), `${ozet.turler[t].satir} satır`].filter(Boolean).join(' · ')}
              </span>
            </button>
          ))}
        </div>
        {ozet.miktarsiz.length > 0 && (
          <p className="mesaj mesaj-uyari">
            {ozet.miktarsiz.length} satırın miktarı çıkmıyor (bina bilgisi eksik).{' '}
            <button type="button" className="baglanti-dugmesi" onClick={() => setGirdiAcik(true)}>
              Bina bilgilerini tamamla
            </button>
          </p>
        )}
        {ozet.fiyatsiz.length > 0 && (
          <p className="mesaj mesaj-uyari">
            {ozet.fiyatsiz.length} satırın fiyatı yok; toplama girmedi.{' '}
            <button
              type="button"
              className="baglanti-dugmesi"
              onClick={() => {
                setSuzgec('fiyatsiz');
                setTur(ozet.fiyatsiz[0]!.satir.tur);
              }}
            >
              Fiyatsızları göster
            </button>
          </p>
        )}
        <Hatalar hatalar={hata} />
        {bilgi && <p className="mesaj">{bilgi}</p>}
        <div className="dugmeler maliyet-dugmeleri">
          {!h.onay && yazabilir && (
            <button type="button" onClick={() => void calistir(() => maliyetHesabiOnayla(depo, servis, h.id), 'Hesap onaylandı: başlangıç maliyeti olarak donduruldu.')}>
              Onayla (başlangıç maliyeti)
            </button>
          )}
          {h.onay && yazabilir && !revizyonu && (
            <button type="button" onClick={() => void calistir(async () => git(`maliyet/${(await revizyonAc(depo, servis, h.id)).id}`))}>
              Revizyon aç
            </button>
          )}
          {h.onay && h.projeId && (
            <a className="dugme ikincil" href={`#/projeler/${h.projeId}/karsilastirma`}>
              📊 Gerçekleşenle karşılaştır
            </a>
          )}
          {revizyonu && (
            <a className="dugme ikincil" href={`#/maliyet/${revizyonu.id}`}>
              Rev. {revizyonu.revizyon}'e git
            </a>
          )}
          <AktarmaDugmeleri dosyaAdi={`${h.ad} Rev ${h.revizyon}`} sayfalar={() => excelSayfalari(h, ozet, projeAdi)} />
          {!h.onay &&
            yazabilir &&
            (kaldirSoru ? (
              <button type="button" className="tehlikeli" onClick={() => void calistir(async () => { await maliyetHesabiIptal(depo, servis, h.id); git('maliyet'); })}>
                Evet, hesabı kaldır
              </button>
            ) : (
              <button type="button" className="ikincil" onClick={() => setKaldirSoru(true)}>
                Hesabı kaldır
              </button>
            ))}
        </div>
      </section>

      <details className="kart" open={girdiAcik} onToggle={(e) => setGirdiAcik((e.target as HTMLDetailsElement).open)}>
        <summary>
          <h2>Bina bilgileri</h2>
        </summary>
        <GirdiFormu h={h} kilitli={kilitli} onKaydet={(g) => kaydet({ girdiler: g }, 'Bina bilgileri kaydedildi; formül satırları yeniden hesaplandı.')} />
      </details>

      <div className="filtreler" role="group" aria-label="Satır süzgeci">
        {(
          [
            ['hepsi', 'Tümü'],
            ['fiyatsiz', 'Fiyatsız'],
            ['miktarsiz', 'Miktarı çıkmayan'],
            ['elle', 'Elle / projeden'],
          ] as const
        ).map(([k, ad]) => (
          <button key={k} type="button" aria-pressed={suzgec === k} onClick={() => setSuzgec(k)}>
            {ad}
          </button>
        ))}
      </div>

      {!kilitli && (
        <p className="dugmeler">
          <button type="button" className="ikincil" onClick={() => setEkle((x) => !x)}>
            + Satır ekle
          </button>
          <a className="dugme ikincil" href={`#/maliyet/${h.id}/proje`}>
            📐 Projeden oku
          </a>
        </p>
      )}
      {ekle && (
        <SatirEkle
          tur={tur}
          katalog={katalog}
          eksikFormuller={eksikFormuller}
          onEkle={async (s) => {
            if (await kaydet({ satirlar: [...h.satirlar, s] })) {
              setEkle(false);
              setTur(s.tur);
            }
          }}
          onVazgec={() => setEkle(false)}
        />
      )}

      {grupSirasi.length === 0 && <BosDurum metin="Bu süzgece uyan satır yok." />}
      {grupSirasi.map(([ad, l]) => (
        <section key={ad} className="kart fiyat-grubu">
          <div className="baslik-satiri">
            <h2>{ad}</h2>
            <span className="soluk">{tlYaz(l.reduce((a, x) => a + (x.tutar ?? 0), 0))}</span>
          </div>
          <ul className="fiyat-listesi">
            {l.map((x) => (
              <li key={x.satir.id}>
                <SatirGorunumu
                  x={x}
                  katalog={x.satir.fiyatKalemiId ? katalog.get(x.satir.fiyatKalemiId) : undefined}
                  acik={acik === x.satir.id}
                  onAc={() => setAcik((a) => (a === x.satir.id ? null : x.satir.id))}
                  kilitli={kilitli}
                  onDegistir={async (s, listeFiyati) => {
                    if (listeFiyati && s.fiyatKalemiId) {
                      const bugun = yerelGun(new Date());
                      const ok = await calistir(() => fiyatGir(depo, servis, s.fiyatKalemiId!, { fiyat: listeFiyati, kaynak: 'elle', not: `${h.ad} hesabından`, tarih: bugun }, bugun));
                      if (!ok) return;
                    }
                    if (await satirDegistir(s)) setAcik(null);
                  }}
                  onCikar={() => void satirCikar(x.satir.id)}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function GirdiFormu({ h, kilitli, onKaydet }: { h: MaliyetHesabi; kilitli: boolean; onKaydet: (g: BinaGirdileri) => Promise<boolean> }) {
  const { depo, oturum } = useUygulama();
  const [g, setG] = useState(h.girdiler);
  const [notlar, setNotlar] = useState<string[]>([]);
  useEffect(() => setG(h.girdiler), [h.girdiler]);
  const degisti = JSON.stringify(g) !== JSON.stringify(h.girdiler);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onKaydet(g);
      }}
    >
      <GirdiAlanlari girdiler={g} onDegisti={setG} kilitli={kilitli} />
      {notlar.length > 0 && <p className="mesaj-not">Projeden dolduruldu: {notlar.join(' · ')}. Kaydetmeyi unutmayın.</p>}
      {!kilitli && (
        <div className="dugmeler">
          <button type="submit" disabled={!degisti}>
            Kaydet ve yeniden hesapla
          </button>
          {h.projeId && (
            <button
              type="button"
              className="ikincil"
              onClick={() =>
                void projedenGirdiler(depo, oturum.firmaId, h.projeId!).then((r) => {
                  setG((x) => ({ ...x, ...r.girdiler }));
                  setNotlar(r.notlar);
                })
              }
            >
              Projeden doldur
            </button>
          )}
        </div>
      )}
    </form>
  );
}

function SatirGorunumu(p: {
  x: HesaplananSatir;
  katalog: FiyatKalemi | undefined;
  acik: boolean;
  onAc: () => void;
  kilitli: boolean;
  onDegistir: (s: MaliyetSatiri, listeFiyati: number | null) => Promise<void>;
  onCikar: () => void;
}) {
  const { satir: s, fiyat, tutar } = p.x;
  const k = KAYNAK_ISARETI[s.miktarKaynagi];
  const fiyatMetni =
    fiyat.kaynak === 'ozel' ? 'hesaba özel fiyat' : fiyat.kaynak ? `${KAYNAK_SIMGESI[fiyat.kaynak]} ${FIYAT_KAYNAGI_ADI[fiyat.kaynak]}${fiyat.tarih ? ` · ${tarihYaz(fiyat.tarih)}` : ''}` : null;
  return (
    <div className={`fiyat-satiri maliyet-satiri ${p.acik ? 'acik' : ''}`}>
      <button type="button" className="fs-ad" onClick={p.onAc} aria-expanded={p.acik}>
        <span>
          {s.ad}
          <span className="ms-miktar">
            {miktarYaz(s.miktar)} {s.birim} × {fiyat.fiyat === null ? <span className="ms-yok">fiyat yok</span> : `${tlMetni(fiyat.fiyat)} ₺`}
          </span>
        </span>
        <span className="fs-fiyat">{tutar === null ? <span className="soluk">—</span> : <strong>{tlYaz(tutar)}</strong>}</span>
      </button>
      <p className={`ms-dayanak ms-${s.miktarKaynagi}`}>
        <span title={k.ad}>{k.simge}</span> {s.dayanak || (s.miktarKaynagi === 'formul' ? 'Formül' : '')}
        {fiyatMetni && <span className="soluk"> · fiyat: {fiyatMetni}</span>}
      </p>
      {p.acik && !p.kilitli && <SatirDuzenle {...p} />}
    </div>
  );
}

function SatirDuzenle({ x, katalog, onDegistir, onCikar }: Parameters<typeof SatirGorunumu>[0]) {
  const s = x.satir;
  const formul = s.formulKodu ? MALIYET_FORMULLERI.find((f) => f.kod === s.formulKodu) : undefined;
  const [elle, setElle] = useState(s.miktarKaynagi !== 'formul');
  const [katsayi, setKatsayi] = useState(sayiYaz(s.katsayi ?? formul?.katsayi ?? null));
  const [miktar, setMiktar] = useState(sayiYaz(s.miktar));
  const [dayanak, setDayanak] = useState(s.miktarKaynagi === 'formul' ? '' : s.dayanak);
  const listeFiyati = katalog?.fiyat ?? null;
  const [fiyat, setFiyat] = useState(s.ozelFiyat !== null ? tlMetni(s.ozelFiyat) : '');
  const [listeyeYaz, setListeyeYaz] = useState(listeFiyati === null && !!s.fiyatKalemiId);
  const [hata, setHata] = useState<string[]>([]);

  const kaydet = () => {
    setHata([]);
    const f = fiyat.trim() ? tlOku(fiyat) : null;
    if (fiyat.trim() && f === null) return setHata(['Fiyat geçersiz.']);
    const k = katsayi.trim() ? sayiOku(katsayi) : null;
    if (!elle && katsayi.trim() && k === null) return setHata(['Katsayı geçersiz.']);
    const m = miktar.trim() ? sayiOku(miktar) : null;
    if (elle && (m === null || !dayanak.trim())) return setHata(['Elle girilen miktarı ve dayanağını yazın (ölçü, teklif, usta tahmini…).']);
    const yeni: MaliyetSatiri = elle
      ? { ...s, miktarKaynagi: s.miktarKaynagi === 'proje' ? 'proje' : 'elle', miktar: m, dayanak }
      : { ...s, miktarKaynagi: 'formul', katsayi: k !== null && formul && k === formul.katsayi ? null : k };
    // Listeye yazılan fiyat hesaba özel tutulmaz (listeden okunur).
    void onDegistir({ ...yeni, ozelFiyat: listeyeYaz ? null : f }, listeyeYaz ? f : null);
  };

  return (
    <div className="fs-ayrinti">
      {formul && (
        <div className="filtreler" role="group" aria-label="Miktar">
          <button type="button" aria-pressed={!elle} onClick={() => setElle(false)}>
            🧮 Formülle
          </button>
          <button type="button" aria-pressed={elle} onClick={() => setElle(true)}>
            ✍️ Elle gir
          </button>
        </div>
      )}
      {!elle && formul ? (
        <>
          <Alan etiket={`Katsayı (${formul.katsayiBirimi})`} aciklama={`Varsayılan ${sayiYaz(formul.katsayi)}${formul.not ? ` · ${formul.not}` : ''}`}>
            <input inputMode="decimal" value={katsayi} onChange={(e) => setKatsayi(e.target.value)} />
          </Alan>
        </>
      ) : (
        <div className="satir-alanlar">
          <Alan etiket={`Miktar (${s.birim})`}>
            <input inputMode="decimal" value={miktar} onChange={(e) => setMiktar(e.target.value)} />
          </Alan>
          <Alan etiket="Dayanağı" aciklama="Zorunlu: ölçü, teklif, usta tahmini…">
            <input value={dayanak} onChange={(e) => setDayanak(e.target.value)} placeholder="Örn. mimari projeden ölçüldü" />
          </Alan>
        </div>
      )}
      <Alan
        etiket={`Birim fiyat (KDV hariç, ₺ / ${s.birim})`}
        aciklama={listeFiyati !== null ? `Listede ${tlMetni(listeFiyati)} ₺; boş bırakırsanız listeden okunur` : s.fiyatKalemiId ? 'Listede fiyatı yok' : 'Listede olmayan satır: fiyat bu hesaba özel'}
      >
        <TutarGirdisi value={fiyat} onChange={setFiyat} placeholder={listeFiyati !== null ? tlMetni(listeFiyati) : '0,00'} />
      </Alan>
      {s.fiyatKalemiId && (
        <label className="onay-kutusu">
          <input type="checkbox" checked={listeyeYaz} onChange={(e) => setListeyeYaz(e.target.checked)} />
          <span>Bu fiyatı fiyat listesine de yaz (bütün hesaplar kullanır); işaretsizse yalnız bu hesaba özel</span>
        </label>
      )}
      <Hatalar hatalar={hata} />
      <div className="dugmeler">
        <button type="button" onClick={kaydet}>
          Kaydet
        </button>
        <button type="button" className="ikincil" onClick={onCikar}>
          Satırı çıkar
        </button>
      </div>
    </div>
  );
}

function SatirEkle(p: {
  tur: MaliyetSatiri['tur'];
  katalog: Map<string, FiyatKalemi>;
  eksikFormuller: typeof MALIYET_FORMULLERI;
  onEkle: (s: MaliyetSatiri) => Promise<void>;
  onVazgec: () => void;
}) {
  const [tur, setTur] = useState(p.tur);
  const [arama, setArama] = useState('');
  const [kalem, setKalem] = useState<FiyatKalemi | null>(null);
  const [serbest, setSerbest] = useState(false);
  const [ad, setAd] = useState('');
  const [birim, setBirim] = useState('');
  const [miktar, setMiktar] = useState('');
  const [dayanak, setDayanak] = useState('');
  const [fiyat, setFiyat] = useState('');
  const [hata, setHata] = useState<string[]>([]);
  const kodla = new Map([...p.katalog.values()].filter((k) => k.sistemKodu).map((k) => [k.sistemKodu!, k]));
  const adaylar = [...p.katalog.values()].filter((k) => k.tur === tur && (!arama.trim() || aramaUyar(`${k.ad} ${grupAdi(k.butceKalemiKodu)}`, arama))).slice(0, 8);
  const formuller = p.eksikFormuller.filter((f) => kodla.get(f.fiyatKalemiKodu)?.tur === tur);

  const ekle = () => {
    setHata([]);
    if (!kalem && !serbest) return setHata(['Listeden bir kalem seçin ya da "Listede yok" deyin.']);
    const f = fiyat.trim() ? tlOku(fiyat) : null;
    if (fiyat.trim() && f === null) return setHata(['Fiyat geçersiz.']);
    if (serbest && (!ad.trim() || !birim.trim())) return setHata(['Satırın adını ve birimini yazın.']);
    if (!miktar.trim() || sayiOku(miktar) === null) return setHata(['Miktarı yazın.']);
    if (!dayanak.trim()) return setHata(['Miktarın dayanağını yazın (ölçü, teklif, usta tahmini…).']);
    const s = elleSatir({ kalem, tur, ad, birim, butceKalemiKodu: null, miktar: miktar.trim() ? sayiOku(miktar) : null, dayanak });
    void p.onEkle({ ...s, ozelFiyat: f });
  };

  return (
    <section className="kart fs-form">
      <h3>Satır ekle</h3>
      <div className="filtreler" role="group" aria-label="Tür">
        {TURLER.map((t) => (
          <button key={t} type="button" aria-pressed={tur === t} onClick={() => (setTur(t), setKalem(null))}>
            {FIYAT_KALEMI_TURU_ADI[t]}
          </button>
        ))}
      </div>
      {formuller.length > 0 && (
        <details>
          <summary>Çıkarılmış hazır formüller ({formuller.length})</summary>
          <ul className="secim-listesi">
            {formuller.map((f) => (
              <li key={f.kod}>
                <button type="button" onClick={() => void p.onEkle(formulSatiri(f, kodla.get(f.fiyatKalemiKodu)!))}>
                  <span>🧮 {f.ad ?? kodla.get(f.fiyatKalemiKodu)!.ad}</span>
                  <span className="soluk">ekle</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {!serbest && (
        <>
          <Alan etiket="Fiyat listesinden kalem">
            <input type="search" value={kalem ? kalem.ad : arama} onChange={(e) => (setKalem(null), setArama(e.target.value))} placeholder="Ara: bims, pompa, sıva…" />
          </Alan>
          {!kalem && (
            <ul className="secim-listesi">
              {adaylar.map((k) => (
                <li key={k.id}>
                  <button type="button" onClick={() => setKalem(k)}>
                    <span>{k.ad}</span>
                    <span className="soluk">
                      {k.birim}
                      {k.fiyat !== null && ` · ${tlMetni(k.fiyat)} ₺`}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={() => setSerbest(true)}>
                  <span>Listede yok: serbest satır</span>
                </button>
              </li>
            </ul>
          )}
        </>
      )}
      {serbest && (
        <div className="satir-alanlar">
          <Alan etiket="Ad">
            <input value={ad} onChange={(e) => setAd(e.target.value)} />
          </Alan>
          <Alan etiket="Birim">
            <input value={birim} onChange={(e) => setBirim(e.target.value)} placeholder="m², adet, gün…" />
          </Alan>
        </div>
      )}
      <div className="satir-alanlar">
        <Alan etiket={`Miktar${kalem ? ` (${kalem.birim})` : ''}`}>
          <input inputMode="decimal" value={miktar} onChange={(e) => setMiktar(e.target.value)} />
        </Alan>
        <Alan etiket="Dayanağı" aciklama="Zorunlu: ölçü, teklif, usta tahmini…">
          <input value={dayanak} onChange={(e) => setDayanak(e.target.value)} />
        </Alan>
      </div>
      <Alan etiket="Bu hesaba özel birim fiyat (isteğe bağlı, KDV hariç)" aciklama={kalem ? 'Boşsa fiyat listesinden okunur' : undefined}>
        <TutarGirdisi value={fiyat} onChange={setFiyat} placeholder="0,00" />
      </Alan>
      <Hatalar hatalar={hata} />
      <div className="dugmeler">
        <button type="button" onClick={ekle}>
          Ekle
        </button>
        <button type="button" className="ikincil" onClick={p.onVazgec}>
          Vazgeç
        </button>
      </div>
    </section>
  );
}

function excelSayfalari(h: MaliyetHesabi, o: MaliyetOzeti, projeAdi: string | null) {
  const baslik = `${h.ad} · Rev. ${h.revizyon} · ${projeAdi ?? 'Projesiz'}${h.onay ? ` · onaylı ${tarihYaz(h.onay.zaman.slice(0, 10))}` : ' · taslak'}`;
  return [
    {
      ad: 'Özet',
      ust: [baslik],
      basliklar: ['Tür', 'Tutar (KDV hariç)', 'KDV', 'Oran'],
      satirlar: [
        ...TURLER.map((t) => [FIYAT_KALEMI_TURU_ADI[t], { tl: o.turler[t].tutar }, { tl: o.turler[t].kdv }, yuzde(o.turler[t].tutar, o.toplam)]),
        [{ kalin: 'Toplam' }, { tl: o.toplam }, { tl: o.kdv }, ''],
        ['KDV dahil', { tl: o.toplam + o.kdv }, null, ''],
        ...(o.m2Basina !== null ? [['m² başına', { tl: o.m2Basina }, null, '']] : []),
        ...(Object.keys(GIRDI_ADI) as (keyof BinaGirdileri)[]).map((k) => [`${GIRDI_ADI[k].ad} (${GIRDI_ADI[k].birim})`, h.girdiler[k], null, '']),
      ],
    },
    {
      ad: 'Satırlar',
      ust: [baslik],
      basliklar: ['Tür', 'Grup', 'Kalem', 'Miktar', 'Birim', 'Miktarın kaynağı', 'Dayanak', 'Birim fiyat', 'Fiyat kaynağı', 'Tutar (KDV hariç)', 'KDV'],
      satirlar: o.satirlar.map((x) => [
        FIYAT_KALEMI_TURU_ADI[x.satir.tur],
        grupAdi(x.satir.butceKalemiKodu),
        x.satir.ad,
        x.satir.miktar,
        x.satir.birim,
        KAYNAK_ISARETI[x.satir.miktarKaynagi].ad,
        x.satir.dayanak,
        x.fiyat.fiyat === null ? null : { tl: x.fiyat.fiyat },
        x.fiyat.kaynak === 'ozel' ? 'Hesaba özel' : x.fiyat.kaynak ? FIYAT_KAYNAGI_ADI[x.fiyat.kaynak] : 'Fiyat yok',
        x.tutar === null ? null : { tl: x.tutar },
        { tl: x.kdv },
      ]),
    },
  ];
}
