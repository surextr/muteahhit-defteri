import { useCallback, useEffect, useState } from 'react';
import { YAPRAK_KALEM_KODLARI } from '../veri/sabit/hazirKalemKodlari';
import { HAKEDIS_SEKLI_ADI, SORUMLULUK_ADI } from '../veri/sabit/hazirUstaTipleri';
import {
  hazirUstaTipleriniEkle,
  ortakMaddeleriKaydet,
  ortakMaddeler,
  ustaTipiGetir,
  ustaTipiGizle,
  ustaTipiKaydet,
  ustaTipiKopyasi,
  ustaTipleriListele,
  type UstaTipiGirdisi,
} from '../servisler/ustaTipi';
import type { HakedisSekli, SorumlulukCevabi, UstaTipi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { git } from './rota';

// Ayarlar › Usta tipleri ve sözleşme maddeleri. Hazır 21 tip ilk açılışta eklenir; firma kendi yöresine göre
// kalemleri, sorumluluk sorularını, hakediş şeklini ve şartları değiştirir. Her kayıt şablon sürümünü artırır.

/** Yalnız gider yazılabilen kalemler (alt kalemler ve alt kalemi olmayan ana kalemler). */
const BUTCE_KALEMLERI = YAPRAK_KALEM_KODLARI;

export function UstaTipleriEkrani() {
  const { depo, oturum, servis } = useUygulama();
  const [tipler, setTipler] = useState<UstaTipi[] | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  const yenile = useCallback(async () => {
    setTipler(await ustaTipleriListele(depo, oturum.firmaId));
  }, [depo, oturum.firmaId]);

  useEffect(() => {
    void hazirUstaTipleriniEkle(depo, servis)
      .catch((e) => setHata(hataMetni(e)))
      .then(yenile);
  }, [depo, servis, yenile]);

  if (!tipler) return <p>Yükleniyor…</p>;
  const gorunen = tipler.filter((t) => !t.gizli);
  const gizli = tipler.filter((t) => t.gizli);

  const satir = (t: UstaTipi) => (
    <li key={t.id}>
      <a href={`#/ayarlar/usta-tipleri/${t.id}`} className="genis-satir">
        <strong>{t.ad}</strong>
        <span className="soluk blok kucuk">
          {t.fiyatlamaBirimi} · {t.kalemler.length} kalem · {HAKEDIS_SEKLI_ADI[t.hakedisSekli]} · sürüm {t.sablonSurumu}
        </span>
      </a>
      {t.gizli && (
        <button
          type="button"
          className="ikincil"
          onClick={() => void ustaTipiGizle(depo, servis, t.id, false).then(yenile, (e) => setHata(hataMetni(e)))}
        >
          Göster
        </button>
      )}
    </li>
  );

  return (
    <>
      <p>
        <a href="#/ayarlar">← Ayarlar</a>
      </p>
      <h1>Usta tipleri</h1>
      {hata && <Hatalar hatalar={[hata]} />}
      <section className="kart">
        <div className="baslik-satiri">
          <h2>{gorunen.length} tip</h2>
          <a className="dugme" href="#/ayarlar/usta-tipleri/yeni">
            + Yeni tip
          </a>
        </div>
        <p className="soluk">Sözleşme kurarken tip seçilir; kalemler, sorular ve şartlar sözleşmeye kopyalanır. Şablonu değiştirmek imzalı sözleşmeyi değiştirmez.</p>
        <ul className="liste">{gorunen.map(satir)}</ul>
        {gizli.length > 0 && (
          <details>
            <summary>Gizlenenler ({gizli.length})</summary>
            <ul className="liste">{gizli.map(satir)}</ul>
          </details>
        )}
      </section>
      <OrtakMaddelerKarti />
    </>
  );
}

function OrtakMaddelerKarti() {
  const { servis, firma, yenile } = useUygulama();
  const [maddeler, setMaddeler] = useState<{ id: string | null; metin: string }[]>(() => ortakMaddeler(firma).map((m) => ({ ...m })));
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [mesaj, setMesaj] = useState<string | null>(null);

  async function kaydet() {
    try {
      const f = await ortakMaddeleriKaydet(servis, firma, maddeler);
      setMaddeler(f.ayarlar.ortakMaddeler.map((m) => ({ ...m })));
      await yenile();
      setHatalar([]);
      setMesaj('Kaydedildi.');
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <section className="kart">
      <h2>Ortak sözleşme maddeleri</h2>
      <p className="soluk">Bütün usta sözleşmelerinde sorulur; bir tipte geçerli olmayanı o tipin ekranında kapatın.</p>
      {maddeler.map((m, i) => (
        <div key={m.id ?? `yeni-${i}`} className="satir-ici madde-satiri">
          <input
            value={m.metin}
            aria-label={`${i + 1}. madde`}
            onChange={(e) => setMaddeler(maddeler.map((x, j) => (j === i ? { ...x, metin: e.target.value } : x)))}
          />
          <button type="button" className="ikincil" aria-label={`${i + 1}. maddeyi çıkar`} onClick={() => setMaddeler(maddeler.filter((_, j) => j !== i))}>
            ✕
          </button>
        </div>
      ))}
      <button type="button" className="baglanti-dugmesi" onClick={() => setMaddeler([...maddeler, { id: null, metin: '' }])}>
        + Madde ekle
      </button>
      <Hatalar hatalar={hatalar} />
      {mesaj && <p className="mesaj mesaj-basari">{mesaj}</p>}
      <div className="dugmeler">
        <button type="button" onClick={() => void kaydet()}>
          Maddeleri kaydet
        </button>
      </div>
    </section>
  );
}

const BOS_GIRDI: UstaTipiGirdisi = {
  ad: '',
  fiyatlamaBirimi: 'm²',
  butceKalemiKodu: null,
  hakedisSekli: 'is_bitimi',
  kalemler: [{ ad: '', birim: 'm²', aciklama: '', butceKalemiKodu: null }],
  sorular: [],
  ozelSartlar: [],
  kapaliOrtakMaddeler: [],
};

export function UstaTipiDuzenle({ id }: { id: string | null }) {
  const { depo, oturum, servis, firma } = useUygulama();
  const [tip, setTip] = useState<UstaTipi | null | undefined>(id ? undefined : null);
  const [tipler, setTipler] = useState<UstaTipi[]>([]);
  const [g, setG] = useState<UstaTipiGirdisi>(BOS_GIRDI);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    void ustaTipleriListele(depo, oturum.firmaId).then(setTipler);
    if (!id) return;
    void ustaTipiGetir(depo, oturum.firmaId, id).then((u) => {
      setTip(u);
      if (u) setG(ustaTipiKopyasi(u, u.ad));
    });
  }, [depo, oturum.firmaId, id]);

  if (tip === undefined) return <p>Yükleniyor…</p>;
  if (id && tip === null) return <p className="hata">Usta tipi bulunamadı.</p>;
  const yaz = <K extends keyof UstaTipiGirdisi>(k: K, v: UstaTipiGirdisi[K]) => setG((x) => ({ ...x, [k]: v }));
  const maddeler = ortakMaddeler(firma);

  async function kaydet() {
    setIslemde(true);
    try {
      await ustaTipiKaydet(depo, servis, id, g);
      git('ayarlar/usta-tipleri');
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  return (
    <>
      <p>
        <a href="#/ayarlar/usta-tipleri">← Usta tipleri</a>
      </p>
      <h1>{tip ? tip.ad : 'Yeni usta tipi'}</h1>
      {tip && (
        <p className="soluk">
          Şablon sürümü {tip.sablonSurumu}; kaydedince {tip.sablonSurumu + 1} olur. {tip.sistemKodu ? 'Hazır tip.' : 'Firmanın eklediği tip.'}
        </p>
      )}

      <section className="kart">
        {!tip && tipler.length > 0 && (
          <Alan etiket="Şu tipten kopyala" aciklama="İsteğe bağlı; kalemler, sorular ve şartlar kopyalanır.">
            <select
              value=""
              onChange={(e) => {
                const k = tipler.find((t) => t.id === e.target.value);
                if (k) setG(ustaTipiKopyasi(k, g.ad));
              }}
            >
              <option value="">Seçin</option>
              {tipler.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ad}
                </option>
              ))}
            </select>
          </Alan>
        )}
        <Alan etiket="Ad">
          <input value={g.ad} onChange={(e) => yaz('ad', e.target.value)} />
        </Alan>
        <div className="iki-sutun">
          <Alan etiket="Fiyatlama birimi">
            <input value={g.fiyatlamaBirimi} placeholder="m², daire, götürü" onChange={(e) => yaz('fiyatlamaBirimi', e.target.value)} />
          </Alan>
          <Alan etiket="Hakediş şekli">
            <select value={g.hakedisSekli} onChange={(e) => yaz('hakedisSekli', e.target.value as HakedisSekli)}>
              {Object.entries(HAKEDIS_SEKLI_ADI).map(([k, ad]) => (
                <option key={k} value={k}>
                  {ad}
                </option>
              ))}
            </select>
          </Alan>
        </div>
        <Alan etiket="Varsayılan bütçe kalemi" aciklama="Sözleşmede, kalem satırı başına değiştirilebilir.">
          <select value={g.butceKalemiKodu ?? ''} onChange={(e) => yaz('butceKalemiKodu', e.target.value || null)}>
            <option value="">Seçilmedi</option>
            {BUTCE_KALEMLERI.map((k) => (
              <option key={k.kod} value={k.kod}>
                {k.ad}
              </option>
            ))}
          </select>
        </Alan>
      </section>

      <section className="kart">
        <h2>Kalemler</h2>
        {g.kalemler.map((k, i) => (
          <div key={i} className="sablon-kalemi">
            <input
              value={k.ad}
              placeholder="Kalem"
              aria-label={`${i + 1}. kalemin adı`}
              onChange={(e) => yaz('kalemler', g.kalemler.map((x, j) => (j === i ? { ...x, ad: e.target.value } : x)))}
            />
            <input
              value={k.birim}
              placeholder="Birim"
              aria-label={`${i + 1}. kalemin birimi`}
              onChange={(e) => yaz('kalemler', g.kalemler.map((x, j) => (j === i ? { ...x, birim: e.target.value } : x)))}
            />
            <button type="button" className="ikincil" aria-label={`${i + 1}. kalemi çıkar`} onClick={() => yaz('kalemler', g.kalemler.filter((_, j) => j !== i))}>
              ✕
            </button>
            <input
              className="sablon-aciklama"
              value={k.aciklama}
              placeholder="Açıklama (isteğe bağlı)"
              aria-label={`${i + 1}. kalemin açıklaması`}
              onChange={(e) => yaz('kalemler', g.kalemler.map((x, j) => (j === i ? { ...x, aciklama: e.target.value } : x)))}
            />
            <select
              className="sablon-aciklama"
              value={k.butceKalemiKodu ?? ''}
              aria-label={`${i + 1}. kalemin bütçe kalemi`}
              onChange={(e) => yaz('kalemler', g.kalemler.map((x, j) => (j === i ? { ...x, butceKalemiKodu: e.target.value || null } : x)))}
            >
              <option value="">Bütçe kalemi: tipin varsayılanı</option>
              {BUTCE_KALEMLERI.map((b) => (
                <option key={b.kod} value={b.kod}>
                  {b.ad}
                </option>
              ))}
            </select>
          </div>
        ))}
        <button
          type="button"
          className="baglanti-dugmesi"
          onClick={() => yaz('kalemler', [...g.kalemler, { ad: '', birim: g.fiyatlamaBirimi, aciklama: '', butceKalemiKodu: null }])}
        >
          + Kalem ekle
        </button>
      </section>

      <section className="kart">
        <h2>Sorumluluk soruları</h2>
        <p className="soluk">Sözleşmede sorulur. Varsayılan cevap boşsa her sözleşmede ayrıca cevaplanır.</p>
        {g.sorular.map((s, i) => (
          <div key={i} className="sablon-sorusu">
            <input
              value={s.soru}
              aria-label={`${i + 1}. soru`}
              onChange={(e) => yaz('sorular', g.sorular.map((x, j) => (j === i ? { ...x, soru: e.target.value } : x)))}
            />
            <select
              value={s.varsayilan ?? ''}
              aria-label={`${i + 1}. sorunun varsayılan cevabı`}
              onChange={(e) =>
                yaz('sorular', g.sorular.map((x, j) => (j === i ? { ...x, varsayilan: (e.target.value || null) as SorumlulukCevabi | null } : x)))
              }
            >
              <option value="">Her sözleşmede sorulsun</option>
              {Object.entries(SORUMLULUK_ADI).map(([k, ad]) => (
                <option key={k} value={k}>
                  {ad}
                </option>
              ))}
            </select>
            <button type="button" className="ikincil" aria-label={`${i + 1}. soruyu çıkar`} onClick={() => yaz('sorular', g.sorular.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="baglanti-dugmesi" onClick={() => yaz('sorular', [...g.sorular, { soru: '', varsayilan: null }])}>
          + Soru ekle
        </button>
      </section>

      <section className="kart">
        <h2>Sözleşme maddeleri</h2>
        <fieldset className="secenekler secenekler-dikey">
          <legend>Bu tipte geçerli ortak maddeler</legend>
          {maddeler.map((m) => (
            <label key={m.id}>
              <input
                type="checkbox"
                checked={!g.kapaliOrtakMaddeler.includes(m.id)}
                onChange={(e) =>
                  yaz('kapaliOrtakMaddeler', e.target.checked ? g.kapaliOrtakMaddeler.filter((x) => x !== m.id) : [...g.kapaliOrtakMaddeler, m.id])
                }
              />{' '}
              {m.metin}
            </label>
          ))}
        </fieldset>
        <h3>Bu tipe özel şartlar</h3>
        {g.ozelSartlar.map((s, i) => (
          <div key={i} className="satir-ici madde-satiri">
            <textarea
              value={s}
              rows={2}
              aria-label={`${i + 1}. şart`}
              onChange={(e) => yaz('ozelSartlar', g.ozelSartlar.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button type="button" className="ikincil" aria-label={`${i + 1}. şartı çıkar`} onClick={() => yaz('ozelSartlar', g.ozelSartlar.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="baglanti-dugmesi" onClick={() => yaz('ozelSartlar', [...g.ozelSartlar, ''])}>
          + Şart ekle
        </button>
      </section>

      <Hatalar hatalar={hatalar} />
      <div className="kaydet-cubugu">
        <button type="button" className="kaydet-dugmesi" onClick={() => void kaydet()} disabled={islemde}>
          {islemde ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
        {tip && (
          <button
            type="button"
            className="ikincil"
            onClick={() => void ustaTipiGizle(depo, servis, tip.id, !tip.gizli).then(() => git('ayarlar/usta-tipleri'), (e) => setHatalar([hataMetni(e)]))}
          >
            {tip.gizli ? 'Göster' : 'Gizle'}
          </button>
        )}
      </div>
    </>
  );
}
