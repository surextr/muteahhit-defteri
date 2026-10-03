import { useEffect, useState } from 'react';
import { girisKoduDogrula, girisKoduGonder, ozelSartlariDuzenle, yzCikis, yzOturumu, type DuzenlemeSonucu } from '../bulut/yapayZeka';
import { maskele } from '../hesap/maskele';
import { ustaTipleriListele } from '../servisler/ustaTipi';
import type { UstaTipi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';

// Yapay zekâ ile özel şartları düzenleme: bir kerelik e-posta kodu girişi ve yan yana karşılaştırma.
// Yalnızca usta tipinin adı ve maskelenmiş özel şartlar gönderilir. İnternet yoksa şablonla devam edilir.

export function YapayZekaKarti() {
  const [eposta, setEposta] = useState<string | null | undefined>(undefined);
  const [girilen, setGirilen] = useState('');
  const [kod, setKod] = useState('');
  const [kodGonderildi, setKodGonderildi] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    void yzOturumu().then(setEposta, () => setEposta(null));
  }, []);

  const calistir = async (is: () => Promise<void>) => {
    setIslemde(true);
    setHata(null);
    try {
      await is();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  };

  return (
    <section className="kart">
      <h2>Yapay zekâ ile sözleşme düzenleme</h2>
      <p className="soluk">
        Usta sözleşmesinin özel şartlarını düzenler; eksik bilgiyi kendisi doldurmaz, size sorar. Gönderilen yalnızca usta tipi ve özel şartlar
        metnidir; telefon, TC/VKN, IBAN ve e-posta gönderilmeden önce gizlenir. İnternet yoksa sözleşme şablonla hazırlanır.
      </p>
      {eposta === undefined && <p>Yükleniyor…</p>}
      {eposta && (
        <div className="baslik-satiri">
          <span>
            Giriş yapıldı: <strong>{eposta}</strong>
          </span>
          <button type="button" className="ikincil" disabled={islemde} onClick={() => void calistir(async () => (await yzCikis(), setEposta(null)))}>
            Çıkış
          </button>
        </div>
      )}
      {eposta === null && (
        <>
          <Alan etiket="E-posta" aciklama="Bu özellik için bir kerelik giriş; adresinize kod gönderilir.">
            <input type="email" inputMode="email" value={girilen} disabled={kodGonderildi} onChange={(e) => setGirilen(e.target.value)} />
          </Alan>
          {kodGonderildi && (
            <Alan etiket="E-postadaki kod">
              <input inputMode="numeric" autoComplete="one-time-code" value={kod} onChange={(e) => setKod(e.target.value)} />
            </Alan>
          )}
          <div className="dugmeler">
            {!kodGonderildi ? (
              <button type="button" disabled={islemde || !girilen.includes('@')} onClick={() => void calistir(async () => (await girisKoduGonder(girilen), setKodGonderildi(true)))}>
                Kod gönder
              </button>
            ) : (
              <>
                <button
                  type="button"
                  disabled={islemde || kod.trim().length < 6}
                  onClick={() => void calistir(async () => (await girisKoduDogrula(girilen, kod), setEposta(await yzOturumu())))}
                >
                  Giriş yap
                </button>
                <button type="button" className="ikincil" disabled={islemde} onClick={() => (setKodGonderildi(false), setKod(''))}>
                  Başka adres
                </button>
              </>
            )}
          </div>
        </>
      )}
      {hata && <Hatalar hatalar={[hata]} />}
      {eposta && <DenemeAlani />}
    </section>
  );
}

/** Ayarlar'da deneme: usta tipi seçilir, özel şartlar düzenletilir. Sözleşme formu da `OzelSartDuzenleyici`yi kullanır. */
function DenemeAlani() {
  const { depo, oturum } = useUygulama();
  const [tipler, setTipler] = useState<UstaTipi[]>([]);
  const [tip, setTip] = useState('');
  const [metin, setMetin] = useState('');
  useEffect(() => {
    void ustaTipleriListele(depo, oturum.firmaId).then((t) => {
      const gorunen = t.filter((x) => !x.gizli);
      setTipler(gorunen);
      setTip((x) => x || gorunen[0]?.ad || '');
    });
  }, [depo, oturum.firmaId]);
  return (
    <details className="deneme">
      <summary>Dene</summary>
      <Alan etiket="Usta tipi">
        <select value={tip} onChange={(e) => setTip(e.target.value)}>
          {tipler.map((t) => (
            <option key={t.id}>{t.ad}</option>
          ))}
        </select>
      </Alan>
      <OzelSartDuzenleyici ustaTipi={tip} metin={metin} onDegisti={setMetin} />
    </details>
  );
}

/** Özel şartlar alanı + "Yapay zekâyla düzenle": orijinal ve düzenlenmiş metin yan yana, kullanıcı seçer. */
export function OzelSartDuzenleyici(props: { ustaTipi: string; metin: string; onDegisti: (m: string) => void }) {
  const [sonuc, setSonuc] = useState<DuzenlemeSonucu | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);
  const gizlenen = maskele(props.metin).maskelenen;

  async function duzenle() {
    setIslemde(true);
    setHata(null);
    setSonuc(null);
    try {
      setSonuc(await ozelSartlariDuzenle(props.ustaTipi, props.metin));
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  return (
    <div className="ozel-sartlar">
      <Alan etiket="Özel şartlar">
        <textarea rows={6} value={props.metin} onChange={(e) => (props.onDegisti(e.target.value), setSonuc(null))} />
      </Alan>
      {gizlenen.length > 0 && (
        <p className="soluk kucuk">Gönderilmeden gizlenecek: {gizlenen.map((g) => `${g.tur} (${g.deger})`).join(', ')}</p>
      )}
      <button type="button" className="ikincil" disabled={islemde || !props.metin.trim() || !props.ustaTipi} onClick={() => void duzenle()}>
        {islemde ? 'Düzenleniyor…' : 'Yapay zekâyla düzenle'}
      </button>
      {hata && <p className="mesaj mesaj-not">{hata}</p>}
      {sonuc && (
        <div className="karsilastirma">
          <div>
            <h3>Orijinal</h3>
            <p className="cok-satir">{props.metin}</p>
            <button type="button" className="ikincil" onClick={() => setSonuc(null)}>
              Orijinali kullan
            </button>
          </div>
          <div>
            <h3>Düzenlenmiş</h3>
            <p className="cok-satir">{sonuc.duzenlenmis}</p>
            <button type="button" onClick={() => (props.onDegisti(sonuc.duzenlenmis), setSonuc(null))}>
              Düzenlenmişi kullan
            </button>
          </div>
          {sonuc.sorular.length > 0 && (
            <div className="mesaj mesaj-uyari tam-genislik">
              <strong>Eksik ya da belirsiz noktalar (metne eklenmedi, siz karar verin):</strong>
              <ul>
                {sonuc.sorular.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="soluk kucuk tam-genislik">Bugün kalan düzenleme hakkı: {sonuc.kalanHak}</p>
        </div>
      )}
    </div>
  );
}
