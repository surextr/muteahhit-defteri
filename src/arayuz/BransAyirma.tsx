import { useCallback, useEffect, useState } from 'react';
import { bransKisaAdi } from '../hesap/brans';
import { bransAyirmaOnerileri, bransAyirmaUygula, type KartBransOnerisi } from '../servisler/cari';
import { useUygulama } from './baglam';
import { Hatalar, hataMetni } from './bilesenler';

// Eski kartlarda adın içine yazılmış meslek ("Ahmet Demir Tuğlası") için toplu düzeltme: her öneri tek tek
// işaretlenir; soyadı meslek gibi görünen kart (örn. "Ahmet Boyacı") işaret kaldırılarak atlanır.

/** Cariler ekranının üstündeki uyarı; öneri yoksa görünmez. */
export function BransAyirmaUyarisi() {
  const { depo, oturum } = useUygulama();
  const [sayi, setSayi] = useState(0);
  useEffect(() => {
    void bransAyirmaOnerileri(depo, oturum.firmaId).then((l) => setSayi(l.length));
  }, [depo, oturum.firmaId]);
  if (sayi === 0) return null;
  return (
    <a className="mesaj mesaj-not blok-baglanti" href="#/cariler/brans-ayir">
      <strong>{sayi} usta kartında meslek adın içinde yazılı.</strong> Adı ve branşı ayırmak için dokunun.
    </a>
  );
}

export function BransAyirmaEkrani() {
  const { depo, oturum, servis } = useUygulama();
  const [oneriler, setOneriler] = useState<KartBransOnerisi[] | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [sonuc, setSonuc] = useState<{ duzeltilen: number; atlanan: string[] } | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  const yukle = useCallback(async () => {
    const l = await bransAyirmaOnerileri(depo, oturum.firmaId);
    setOneriler(l);
    setSecili(new Set(l.map((o) => o.cari.id)));
  }, [depo, oturum.firmaId]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  async function uygula() {
    if (!oneriler) return;
    setIslemde(true);
    setHata(null);
    try {
      const s = await bransAyirmaUygula(
        depo,
        servis,
        oneriler.filter((o) => secili.has(o.cari.id)).map((o) => ({ cariId: o.cari.id, yeniAd: o.yeniAd, ustaTipiId: o.ustaTipiId })),
      );
      setSonuc(s);
      await yukle();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  return (
    <>
      <p>
        <a className="geri-baglanti" href="#/cariler">← Cariler</a>
      </p>
      <h1>Ad ve branşı ayır</h1>
      <p className="soluk">
        Bu kartlarda meslek adın içine yazılmış. Ad kısaltılır, meslek karta branş olarak eklenir; sözleşmede "Ahmet Demir · Sıfatı: Duvarcı" olarak
        yazılır. Soyadı meslek gibi görünen (örn. "Ahmet Boyacı") kartın işaretini kaldırın.
      </p>
      {sonuc && (
        <div className="mesaj mesaj-basari">
          <p>{sonuc.duzeltilen} kart düzeltildi.</p>
          {sonuc.atlanan.length > 0 && (
            <p>
              Kısalan adla aynı adda başka kart olduğu için atlananlar: {sonuc.atlanan.join(', ')}. Aynı kişiyse kartları elle düzenleyin.
            </p>
          )}
        </div>
      )}
      {oneriler === null && <p>Yükleniyor…</p>}
      {oneriler?.length === 0 && <p className="soluk">Düzeltilecek kart kalmadı.</p>}
      {oneriler && oneriler.length > 0 && (
        <section className="kart">
          <ul className="liste">
            {oneriler.map((o) => (
              <li key={o.cari.id}>
                <label className="onay-kutusu">
                  <input
                    type="checkbox"
                    checked={secili.has(o.cari.id)}
                    onChange={(e) => {
                      const s = new Set(secili);
                      if (e.target.checked) s.add(o.cari.id);
                      else s.delete(o.cari.id);
                      setSecili(s);
                    }}
                  />
                  <span>
                    <del className="soluk">{o.cari.ad}</del>
                    <br />
                    <strong>{o.yeniAd}</strong> · {bransKisaAdi(o.tipAdi)}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {hata && <Hatalar hatalar={[hata]} />}
          <div className="dugmeler">
            <button type="button" disabled={secili.size === 0 || islemde} onClick={() => void uygula()}>
              {islemde ? 'Düzeltiliyor…' : `Seçilen ${secili.size} kartı düzelt`}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
