import { useEffect, useState } from 'react';
import { BOS_ODA_TIPI_AYARI, DUBLEKS_ADI, odaTipiEtiketi, odaTipiSecenekleri, type Dubleks } from '../hesap/odaTipi';
import { odaTipiEkle, odaTipiKullanimi } from '../servisler/odaTipi';
import { useUygulama } from './baglam';
import { Hatalar, hataMetni } from './bilesenler';

// Oda tipi düğmeleri: firmanın listesi, en çok kullanılan başta; en sonda "+ Ekle" ile yeni tip
// (örn. 4+2) firmanın listesine girer. Seçili düğmeye yeniden dokunmak seçimi kaldırır.
// Daire formunda ve krokideki toplu özellik formunda aynı bileşen kullanılır.

export function OdaTipiSecimi(props: { deger: string | null; onDegisti: (anahtar: string | null) => void; etiket?: string }) {
  const { depo, oturum, servis, firma, yenile } = useUygulama();
  const [kullanim, setKullanim] = useState<Map<string, number>>(new Map());
  const [ekle, setEkle] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    void odaTipiKullanimi(depo, oturum.firmaId).then(setKullanim);
  }, [depo, oturum.firmaId]);

  const secenekler = odaTipiSecenekleri(firma.ayarlar.odaTipleri ?? BOS_ODA_TIPI_AYARI, kullanim, props.deger);

  async function ekleKaydet() {
    if (ekle === null) return;
    try {
      const anahtar = await odaTipiEkle(servis, firma, ekle);
      await yenile();
      props.onDegisti(anahtar);
      setEkle(null);
      setHata(null);
    } catch (e) {
      setHata(hataMetni(e));
    }
  }

  return (
    <div className="alan">
      <span className="alan-etiket">{props.etiket ?? 'Oda tipi'}</span>
      <div className="filtreler secim-dugmeleri" role="group" aria-label={props.etiket ?? 'Oda tipi'}>
        {secenekler.map((t) => (
          <button key={t} type="button" aria-pressed={props.deger === t} onClick={() => props.onDegisti(props.deger === t ? null : t)}>
            {odaTipiEtiketi(t)}
          </button>
        ))}
        {ekle === null && (
          <button type="button" className="ekle-dugmesi" onClick={() => setEkle('')}>
            + Ekle
          </button>
        )}
      </div>
      {ekle !== null && (
        <div className="satir-ici">
          <input
            value={ekle}
            placeholder="4+2"
            aria-label="Yeni oda tipi"
            inputMode="text"
            autoFocus
            onChange={(e) => setEkle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void ekleKaydet()}
          />
          <button type="button" onClick={() => void ekleKaydet()}>
            Ekle
          </button>
          <button type="button" className="ikincil" onClick={() => (setEkle(null), setHata(null))}>
            Vazgeç
          </button>
        </div>
      )}
      {hata && <Hatalar hatalar={[hata]} />}
    </div>
  );
}

/**
 * Dubleks işareti. `degistirme` verilirse (toplu özellik) "Değiştirme" seçeneği de çıkar;
 * değer: undefined = değiştirme, null = dubleks değil.
 */
export function DubleksSecimi(props: { deger: Dubleks | null | undefined; onDegisti: (d: Dubleks | null | undefined) => void; degistirme?: boolean }) {
  const secenekler: [Dubleks | null | undefined, string][] = [
    ...(props.degistirme ? ([[undefined, 'Değiştirme']] as [undefined, string][]) : []),
    [null, 'Dubleks değil'],
    ['bahce', DUBLEKS_ADI.bahce],
    ['cati', DUBLEKS_ADI.cati],
  ];
  return (
    <div className="alan">
      <span className="alan-etiket">Dubleks</span>
      <div className="filtreler secim-dugmeleri" role="group" aria-label="Dubleks">
        {secenekler.map(([d, ad]) => (
          <button key={ad} type="button" aria-pressed={props.deger === d} onClick={() => props.onDegisti(d)}>
            {ad}
          </button>
        ))}
      </div>
    </div>
  );
}
