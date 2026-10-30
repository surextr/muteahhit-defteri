import { useState } from 'react';
import { bransKisaAdi } from '../hesap/brans';
import { AyniAdliCariUyarisi, CARI_ROL_ADI, cariOlustur, type CariOzeti } from '../servisler/cari';
import { aramaUyar, rakamlar } from '../hesap/metin';
import type { Cari, CariRol } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { Bakiye, cariRolMetni } from './CariFormu';
import { TelefonGirdisi } from './Girdiler';
import { useBranslar } from './useBranslar';

/**
 * Ad, not ve (verilirse) branş metnine Türkçe harfsiz de uyar ("sahin" → "Şahin", "siva" → "Sıvacı");
 * telefon rakamlarla aranır ("0532 111").
 */
export function cariAramaUyar(cari: Pick<Cari, 'ad' | 'telefon' | 'not'>, arama: string, ek = ''): boolean {
  if (!arama.trim()) return true;
  if (aramaUyar(`${cari.ad} ${cari.not} ${ek}`, arama)) return true;
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
  /** Bu branştaki (usta tipi) kartlar en başa gelir; ana branşı bu olanlar önce. Örn. sözleşmenin usta tipi. */
  oncelikliBrans?: string | null;
  bosEtiket?: string;
  /** Liste açık gelsin (seçim boşken bile "bosEtiket" seçili görünmesin). */
  acikBasla?: boolean;
  /** Verilirse listede "Vazgeç" bunu çağırır (seçici bir "+ Ekle" düğmesinin yerine açıldıysa). */
  onVazgec?: () => void;
  /** Yeni cari açma bağlantısı (taslak saklandığı için form kaybolmaz). */
  yeniCariYolu?: string;
  /**
   * Verilirse "+ Yeni" ekrandan çıkmadan küçük bir form açar (ad, telefon); açılan cari bu rolle kaydedilir,
   * listeye eklenmesi ve seçilmesi için `onEklendi` çağrılır. `yeniCariYolu`nun yerine geçer.
   */
  hizliEkle?: {
    rol: CariRol;
    onEklendi: (cari: Cari) => void;
    /** Usta/taşeron açılırken kartına yazılacak branş (usta tipi). */
    ustaTipiId?: string | null;
    /** Formda seçilebilecek roller (ilki `rol` olmalı). Verilmezse usta için usta/taşeron, diğerinde yalnız `rol`. */
    secenekler?: CariRol[];
  };
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
  const [acik, setAcik] = useState(props.acikBasla ?? (props.secili === null && !props.bosEtiket));
  const [ekleniyor, setEkleniyor] = useState(false);
  const { adlar } = useBranslar();
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
                {secili.cari.ustaTipiIdleri.length > 0 && <>{cariRolMetni(secili.cari, adlar)} · </>}
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

  const oncelik = (c: CariOzeti) => {
    const b = props.oncelikliBrans ? c.cari.ustaTipiIdleri.indexOf(props.oncelikliBrans) : -1;
    if (b === 0) return 0;
    if (b > 0) return 1;
    return props.oncelikli?.some((r) => c.cari.roller.includes(r)) ? 2 : 3;
  };
  const bulunan = props.cariler
    .filter(({ cari }) => cariAramaUyar(cari, arama, cariRolMetni(cari, adlar)))
    .sort((a, b) => oncelik(a) - oncelik(b))
    .slice(0, 8);

  const sec = (id: string | null) => {
    props.onSec(id);
    setArama('');
    setAcik(false);
    setEkleniyor(false);
  };

  if (ekleniyor && props.hizliEkle) {
    const { rol, onEklendi, ustaTipiId, secenekler } = props.hizliEkle;
    return (
      <HizliCariFormu
        rol={rol}
        secenekler={secenekler ?? (rol === 'usta' ? ['usta', 'taseron'] : [rol])}
        ustaTipiId={ustaTipiId ?? null}
        bransAdi={ustaTipiId && adlar.get(ustaTipiId) ? bransKisaAdi(adlar.get(ustaTipiId)!) : null}
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
        placeholder="Cari ara: ad, branş ya da telefon"
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
              <span className="soluk">{cariRolMetni(cari, adlar)}</span>
            </button>
          </li>
        ))}
        {bulunan.length === 0 && <li className="soluk">Bulunamadı.</li>}
      </ul>
      <div className="dugmeler">
        {props.hizliEkle ? (
          <button type="button" className="ikincil" onClick={() => setEkleniyor(true)}>
            + Yeni {hizliRolAdi(props.hizliEkle.rol, props.hizliEkle.secenekler)} ekle
          </button>
        ) : (
          props.yeniCariYolu && (
            <a className="dugme ikincil" href={`#/${props.yeniCariYolu}`}>
              + Yeni cari
            </a>
          )
        )}
        {(props.secili !== null || props.bosEtiket || props.onVazgec) && (
          <button type="button" className="ikincil" onClick={() => (props.onVazgec ? props.onVazgec() : setAcik(false))}>
            Vazgeç
          </button>
        )}
      </div>
    </div>
  );
}

const hizliRolAdi = (rol: CariRol, secenekler?: CariRol[]) =>
  secenekler && secenekler.length > 1 ? 'cari' : (rol === 'usta' && !secenekler ? 'usta / taşeron' : CARI_ROL_ADI[rol]).toLocaleLowerCase('tr');

/**
 * Ekrandan çıkmadan cari açma: ad ve telefon yeter, diğer bilgiler sonra cari kartından girilir.
 * Aynı adlı cari varsa (Türkçe harfsiz yazım dahil) önce onu seçme imkânı verilir.
 */
function HizliCariFormu(props: {
  rol: CariRol;
  secenekler: CariRol[];
  /** Usta/taşeron için kartına yazılacak branş ve adı. */
  ustaTipiId: string | null;
  bransAdi: string | null;
  ilkAd: string;
  onEklendi: (cari: Cari) => void;
  onMevcutuSec: (cariId: string) => void;
  onVazgec: () => void;
}) {
  const { depo, servis } = useUygulama();
  const [ad, setAd] = useState(props.ilkAd);
  const [telefon, setTelefon] = useState('');
  // Usta istenen yerde taşeron da seçilebilir (sözleşme bir taşeronla da yapılır); alışta tedarikçi/usta/taşeron.
  const [rol, setRol] = useState<CariRol>(props.rol);
  const [yetkili, setYetkili] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [ayniAdlilar, setAyniAdlilar] = useState<AyniAdliCariUyarisi['mevcutlar'] | null>(null);
  const [islemde, setIslemde] = useState(false);
  const rolAdi = props.secenekler.length > 1 ? 'cari' : CARI_ROL_ADI[props.rol].toLocaleLowerCase('tr');

  async function kaydet(ayniAdOnayli = false) {
    setIslemde(true);
    setHata(null);
    try {
      const c = await cariOlustur(
        depo,
        servis,
        {
          ad,
          roller: [rol],
          ustaTipiIdleri: props.ustaTipiId && (rol === 'usta' || rol === 'taseron') ? [props.ustaTipiId] : [],
          yetkili: rol === 'taseron' ? yetkili : null,
          telefon: telefon || null,
          vergiNo: null,
          adres: null,
          not: '',
        },
        null,
        { ayniAdOnayli },
      );
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
      {props.secenekler.length > 1 && (
        <div className="filtreler" role="group" aria-label="Cari türü">
          {props.secenekler.map((r) => (
            <button key={r} type="button" aria-pressed={rol === r} onClick={() => setRol(r)}>
              {CARI_ROL_ADI[r]}
            </button>
          ))}
        </div>
      )}
      <Alan
        etiket={rol === 'taseron' ? 'Ad soyad ya da firma unvanı' : 'Ad soyad / unvan'}
        aciklama={props.bransAdi ? `Mesleği yazmayın; branşı "${props.bransAdi}" olarak kaydedilir.` : undefined}
      >
        <input value={ad} autoFocus onChange={(e) => (setAd(e.target.value), setAyniAdlilar(null))} />
      </Alan>
      {rol === 'taseron' && (
        <Alan etiket="Yetkili" aciklama="Firma adına sözleşmeyi imzalayan kişi (isteğe bağlı).">
          <input value={yetkili} onChange={(e) => setYetkili(e.target.value)} />
        </Alan>
      )}
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
