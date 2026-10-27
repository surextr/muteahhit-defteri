import { useState } from 'react';
import { AyniAdliCariUyarisi, CARI_ROL_ADI, cariOlustur, type CariOzeti } from '../servisler/cari';
import { aramaUyar, rakamlar } from '../hesap/metin';
import type { Cari, CariRol } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { Bakiye } from './CariFormu';
import { TelefonGirdisi } from './Girdiler';

/**
 * Ad ve nota Türkçe harfsiz de uyar ("sahin" → "Şahin"); telefon rakamlarla aranır ("0532 111").
 */
export function cariAramaUyar(cari: Pick<Cari, 'ad' | 'telefon' | 'not'>, arama: string): boolean {
  if (!arama.trim()) return true;
  if (aramaUyar(`${cari.ad} ${cari.not}`, arama)) return true;
  const r = rakamlar(arama);
  return r.length >= 3 && rakamlar(cari.telefon ?? '').includes(r);
}

/**
 * Aranabilir cari seçimi. `bosEtiket` verilirse "cari yok" seçeneği de çıkar (örn. carisiz peşin gider).
 * Öncelikli roldekiler (örn. tedarikçi, usta) önce listelenir.
 */
export function CariSecici(props: {
  cariler: CariOzeti[];
  secili: string | null;
  onSec: (cariId: string | null) => void;
  oncelikli?: CariRol[];
  bosEtiket?: string;
  /** Yeni cari açma bağlantısı (taslak saklandığı için form kaybolmaz). */
  yeniCariYolu?: string;
  /**
   * Verilirse "+ Yeni" ekrandan çıkmadan küçük bir form açar (ad, telefon); açılan cari bu rolle kaydedilir,
   * listeye eklenmesi ve seçilmesi için `onEklendi` çağrılır. `yeniCariYolu`nun yerine geçer.
   */
  hizliEkle?: { rol: CariRol; onEklendi: (cari: Cari) => void };
  /**
   * Tek dokunuşla seçilen öneriler (örn. son kullanılan cariler). Hiçbiri kendiliğinden seçilmez;
   * `vurgulu` olan (örn. seçilen kalemde en son kullanılan) başta ve belirgin gösterilir.
   */
  oneriler?: { id: string; vurgulu: boolean; not?: string }[];
  /**
   * Verilirse "cari yok" (`bosEtiket`) bilinçli seçilen bir düğme olur: `secili` null iken yalnızca bu true ise
   * seçili sayılır, değilse "Cari seçilmedi" görünür. Verilmezse null her zaman `bosEtiket` demektir.
   */
  bosSecili?: boolean;
}) {
  const [arama, setArama] = useState('');
  const [acik, setAcik] = useState(props.secili === null && !props.bosEtiket);
  const [ekleniyor, setEkleniyor] = useState(false);
  const secili = props.cariler.find((c) => c.cari.id === props.secili);
  const bosDugme = props.bosSecili !== undefined && !!props.bosEtiket;
  const secimYok = props.secili === null && props.bosSecili === false;
  const oneriler = (props.oneriler ?? [])
    .map((o) => ({ ...o, cari: props.cariler.find((c) => c.cari.id === o.id)?.cari }))
    .filter((o): o is typeof o & { cari: Cari } => !!o.cari);

  if (!acik) {
    return (
      <>
        {(oneriler.length > 0 || bosDugme) && (
          <div className="filtreler cari-onerileri" role="group" aria-label="Son kullanılan cariler">
            {oneriler.map((o) => (
              <button
                key={o.id}
                type="button"
                className={o.vurgulu ? 'onerilen' : undefined}
                aria-pressed={o.id === props.secili}
                aria-label={o.not ? `${o.cari.ad}, ${o.not}` : undefined}
                onClick={() => props.onSec(o.id)}
              >
                {o.vurgulu && <span aria-hidden="true">★ </span>}
                {o.cari.ad}
              </button>
            ))}
            {bosDugme && (
              <button type="button" aria-pressed={props.secili === null && props.bosSecili} onClick={() => props.onSec(null)}>
                {props.bosEtiket}
              </button>
            )}
          </div>
        )}
        <div className={`secili-cari${secimYok ? ' secim-yok' : ''}`}>
          <div>
            <strong>{secili ? secili.cari.ad : secimYok ? 'Cari seçilmedi' : (props.bosEtiket ?? 'Seçilmedi')}</strong>
            {secili && (
              <div className="soluk">
                <Bakiye tutar={secili.bakiye} />
              </div>
            )}
          </div>
          <button type="button" className="ikincil" onClick={() => setAcik(true)}>
            {oneriler.length > 0 || bosDugme ? 'Başka cari' : 'Değiştir'}
          </button>
        </div>
      </>
    );
  }

  const oncelik = (c: CariOzeti) => (props.oncelikli?.some((r) => c.cari.roller.includes(r)) ? 0 : 1);
  const bulunan = props.cariler
    .filter(({ cari }) => cariAramaUyar(cari, arama))
    .sort((a, b) => oncelik(a) - oncelik(b))
    .slice(0, 8);

  const sec = (id: string | null) => {
    props.onSec(id);
    setArama('');
    setAcik(false);
    setEkleniyor(false);
  };

  if (ekleniyor && props.hizliEkle) {
    const { rol, onEklendi } = props.hizliEkle;
    return (
      <HizliCariFormu
        rol={rol}
        ilkAd={arama}
        onEklendi={(c) => {
          onEklendi(c);
          sec(c.id);
        }}
        onMevcutuSec={sec}
        onVazgec={() => setEkleniyor(false)}
      />
    );
  }

  return (
    <div className="cari-secici">
      <input
        type="search"
        value={arama}
        placeholder="Cari ara: ad ya da telefon"
        aria-label="Cari ara"
        onChange={(e) => setArama(e.target.value)}
        autoFocus
      />
      <ul className="secim-listesi">
        {props.bosEtiket && (
          <li>
            <button type="button" onClick={() => sec(null)}>
              <span>{props.bosEtiket}</span>
            </button>
          </li>
        )}
        {bulunan.map(({ cari }) => (
          <li key={cari.id}>
            <button type="button" aria-pressed={cari.id === props.secili} onClick={() => sec(cari.id)}>
              <span>{cari.ad}</span>
              <span className="soluk">{cari.roller.map((r) => CARI_ROL_ADI[r]).join(', ')}</span>
            </button>
          </li>
        ))}
        {bulunan.length === 0 && <li className="soluk">Bulunamadı.</li>}
      </ul>
      <div className="dugmeler">
        {props.hizliEkle ? (
          <button type="button" className="ikincil" onClick={() => setEkleniyor(true)}>
            + Yeni {CARI_ROL_ADI[props.hizliEkle.rol].toLocaleLowerCase('tr')} ekle
          </button>
        ) : (
          props.yeniCariYolu && (
            <a className="dugme ikincil" href={`#/${props.yeniCariYolu}`}>
              + Yeni cari
            </a>
          )
        )}
        {(props.secili !== null || props.bosEtiket) && (
          <button type="button" className="ikincil" onClick={() => setAcik(false)}>
            Vazgeç
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Ekrandan çıkmadan cari açma: ad ve telefon yeter, diğer bilgiler sonra cari kartından girilir.
 * Aynı adlı cari varsa (Türkçe harfsiz yazım dahil) önce onu seçme imkânı verilir.
 */
function HizliCariFormu(props: {
  rol: CariRol;
  ilkAd: string;
  onEklendi: (cari: Cari) => void;
  onMevcutuSec: (cariId: string) => void;
  onVazgec: () => void;
}) {
  const { depo, servis } = useUygulama();
  const [ad, setAd] = useState(props.ilkAd);
  const [telefon, setTelefon] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [ayniAdlilar, setAyniAdlilar] = useState<AyniAdliCariUyarisi['mevcutlar'] | null>(null);
  const [islemde, setIslemde] = useState(false);
  const rolAdi = CARI_ROL_ADI[props.rol].toLocaleLowerCase('tr');

  async function kaydet(ayniAdOnayli = false) {
    setIslemde(true);
    setHata(null);
    try {
      const c = await cariOlustur(depo, servis, { ad, roller: [props.rol], telefon: telefon || null, vergiNo: null, adres: null, not: '' }, null, { ayniAdOnayli });
      props.onEklendi(c);
    } catch (e) {
      if (e instanceof AyniAdliCariUyarisi) setAyniAdlilar(e.mevcutlar);
      else setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  return (
    <div className="hizli-cari">
      <h3>Yeni {rolAdi}</h3>
      <Alan etiket="Ad / unvan">
        <input value={ad} autoFocus onChange={(e) => (setAd(e.target.value), setAyniAdlilar(null))} />
      </Alan>
      <Alan etiket="Telefon" aciklama="İsteğe bağlı. Adres ve TC/vergi no sonra Cariler'den eklenebilir.">
        <TelefonGirdisi value={telefon} onChange={setTelefon} />
      </Alan>
      {hata && <Hatalar hatalar={[hata]} />}
      {ayniAdlilar && (
        <div className="mesaj mesaj-uyari">
          <p>Bu adla kayıtlı cari var. Aynı kişiyse onu seçin:</p>
          <ul className="secim-listesi">
            {ayniAdlilar.map((m) => (
              <li key={m.id}>
                <button type="button" onClick={() => props.onMevcutuSec(m.id)}>
                  <span>{m.ad}</span>
                  <span className="soluk">{m.telefon ?? m.roller.map((r) => CARI_ROL_ADI[r]).join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="ikincil" disabled={islemde} onClick={() => void kaydet(true)}>
            Farklı kişi, yine de yeni aç
          </button>
        </div>
      )}
      <div className="dugmeler">
        <button type="button" disabled={!ad.trim() || islemde || !!ayniAdlilar} onClick={() => void kaydet()}>
          {islemde ? 'Kaydediliyor…' : 'Ekle ve seç'}
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}
