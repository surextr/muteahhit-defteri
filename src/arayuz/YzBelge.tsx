import { useCallback, useEffect, useState } from 'react';
import { belgeyiOkut } from '../bulut/belgeOku';
import { havuzuOkut, yzBelgeAyari, yzBelgeAyariYaz, type YzBelgeAyari } from '../servisler/havuz';
import type { Depo } from '../veri/depo';
import type { Firma, HavuzBelgesi } from '../veri/tipler';
import type { KayitServisi } from '../servisler/kayitServisi';
import { useUygulama } from './baglam';
import { useHesap } from './HesapGirisi';

// Yapay zekâ ile belge okuma: rıza (bu cihazda), Ayarlar kartı ve havuzdan okutma.

export function useYzBelgeAyari(): [YzBelgeAyari | null, (a: YzBelgeAyari) => Promise<void>] {
  const { depo } = useUygulama();
  const [ayar, setAyar] = useState<YzBelgeAyari | null>(null);
  useEffect(() => {
    void yzBelgeAyari(depo).then(setAyar);
  }, [depo]);
  const yaz = useCallback(
    async (a: YzBelgeAyari) => {
      await yzBelgeAyariYaz(depo, a);
      setAyar(a);
    },
    [depo],
  );
  return [ayar, yaz];
}

/** Belgeyi sunucu üzerinden okutur ve havuz kaydına yazar. */
export function havuzuYzIleOku(depo: Depo, servis: KayitServisi, firma: Firma, havuzId: string, amac: 'tani' | 'sozlesme'): Promise<HavuzBelgesi> {
  return havuzuOkut(depo, servis, havuzId, amac, async (dosya, a) => (await belgeyiOkut(dosya, a, { ad: firma.ad, vergiNo: firma.bilgiler?.vergiNo ?? '' })).sonuc);
}

export function RizaMetni() {
  return (
    <p className="soluk">
      Açtığınızda okuttuğunuz belgenin fotoğrafı ya da PDF'i, firma adınız ve vergi numaranızla birlikte sunucumuz üzerinden Anthropic'in Claude
      yapay zekâsına gönderilir. Belgede kişi adı, TC/vergi numarası, IBAN gibi bilgiler bulunabilir. Belge sunucumuzda saklanmaz; okunan bilgi
      yalnızca formu doldurur, kaydı siz onaylarsınız. Günlük okuma hakkı vardır. Karekodlu e-faturalar ve XML dosyaları yapay zekâya gönderilmeden
      bu cihazda okunur. Ayrıntı: <a href="./gizlilik.html">gizlilik politikası</a>.
    </p>
  );
}

/** Rıza yoksa: açıklama ve "Kabul ediyorum" düğmesi. */
export function YzRizaKutusu(props: { onVerildi: () => void; onVazgec?: () => void }) {
  const [ayar, yaz] = useYzBelgeAyari();
  return (
    <div className="mesaj mesaj-not yz-riza">
      <strong>Yapay zekâ ile belge okuma</strong>
      <RizaMetni />
      <div className="dugmeler">
        <button
          type="button"
          onClick={() =>
            void yaz({ riza: new Date().toISOString(), otomatik: ayar?.otomatik ?? false }).then(props.onVerildi)
          }
        >
          Kabul ediyorum, oku
        </button>
        {props.onVazgec && (
          <button type="button" className="ikincil" onClick={props.onVazgec}>
            Vazgeç
          </button>
        )}
      </div>
    </div>
  );
}

/** Ayarlar kartı. */
export function YzBelgeKarti() {
  const [ayar, yaz] = useYzBelgeAyari();
  const [eposta] = useHesap();
  if (!ayar) return null;
  return (
    <section className="kart">
      <h2>Yapay zekâ ile belge okuma</h2>
      <p className="soluk">
        Belge havuzundaki fiş, fatura, dekont, çek ve sözleşmeleri okur, türünü tanır ve formu doldurur; siz onaylarsınız.
      </p>
      <RizaMetni />
      {eposta === null && <p className="mesaj mesaj-uyari">Kullanmak için yukarıdaki "Yapay zekâ ile sözleşme düzenleme" kartından giriş yapın.</p>}
      <label className="onay-kutusu">
        <input type="checkbox" checked={!!ayar.riza} onChange={(e) => void yaz({ ...ayar, riza: e.target.checked ? new Date().toISOString() : null })} />
        Bu cihazda açık (yukarıdaki açıklamayı kabul ediyorum)
      </label>
      <label className="onay-kutusu">
        <input type="checkbox" disabled={!ayar.riza} checked={!!ayar.riza && ayar.otomatik} onChange={(e) => void yaz({ ...ayar, otomatik: e.target.checked })} />
        Yüklenen belgeler kendiliğinden okunsun (karekodu olmayanlar)
      </label>
    </section>
  );
}
