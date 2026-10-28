import { useEffect, useState } from 'react';
import { ozelSartlariDuzenle, type DuzenlemeSonucu } from '../bulut/yapayZeka';
import { maskele } from '../hesap/maskele';
import { hazirUstaTipleriniEkle, ustaTipleriListele } from '../servisler/ustaTipi';
import type { UstaTipi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { HesapGirisi, useHesap } from './HesapGirisi';
import { Alan, hataMetni } from './bilesenler';

// Yapay zekâ ile özel şartları düzenleme: e-posta + şifreyle giriş (kayıtta e-posta onayı) ve yan yana karşılaştırma.
// Yalnızca usta tipinin adı ve maskelenmiş özel şartlar gönderilir. İnternet yoksa şablonla devam edilir.

export function YapayZekaKarti() {
  const [eposta, setEposta] = useHesap();
  return (
    <section className="kart">
      <h2>Yapay zekâ ile sözleşme düzenleme</h2>
      <p className="soluk">
        Usta sözleşmesinin özel şartlarını düzenler; eksik bilgiyi kendisi doldurmaz, size sorar. Gönderilen yalnızca usta tipi ve özel şartlar
        metnidir; telefon, TC/VKN, IBAN ve e-posta gönderilmeden önce gizlenir. İnternet yoksa sözleşme şablonla hazırlanır. Giriş hesabı bulut
        eşitlemeyle ortaktır.
      </p>
      <HesapGirisi eposta={eposta} onDegisti={setEposta} />
      {eposta && <DenemeAlani />}
    </section>
  );
}

/** Ayarlar'da deneme: usta tipi seçilir, özel şartlar düzenletilir. Sözleşme formu da `OzelSartDuzenleyici`yi kullanır. */
function DenemeAlani() {
  const { depo, oturum, servis } = useUygulama();
  const [tipler, setTipler] = useState<UstaTipi[]>([]);
  const [tip, setTip] = useState('');
  const [metin, setMetin] = useState('');
  useEffect(() => {
    // Yeni kurulumda hazır tipler henüz eklenmemiş olabilir (Usta tipleri ekranı hiç açılmadıysa); önce tamamlanır.
    void hazirUstaTipleriniEkle(depo, servis)
      .catch(() => 0)
      .then(() => ustaTipleriListele(depo, oturum.firmaId))
      .then((t) => {
      const gorunen = t.filter((x) => !x.gizli);
      setTipler(gorunen);
      setTip((x) => x || gorunen[0]?.ad || '');
      });
  }, [depo, servis, oturum.firmaId]);
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
  // Sorular, metin seçildikten sonra da görünür kalır (cevaplanıp metne eklensin diye); kullanıcı kapatır.
  const [sorular, setSorular] = useState<string[]>([]);
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);
  const gizlenen = maskele(props.metin).maskelenen;

  async function duzenle() {
    setIslemde(true);
    setHata(null);
    setSonuc(null);
    try {
      const r = await ozelSartlariDuzenle(props.ustaTipi, props.metin);
      setSonuc(r);
      setSorular(r.sorular);
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
      {!sonuc && sorular.length > 0 && (
        <div className="mesaj mesaj-uyari">
          <strong>Yapay zekânın soruları (cevapları özel şartlara ekleyin):</strong>
          <ul>
            {sorular.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          <button type="button" className="ikincil" onClick={() => setSorular([])}>
            Soruları kapat
          </button>
        </div>
      )}
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
