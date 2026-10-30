import { useEffect, useState } from 'react';
import {
  bildirimAboneligiBirak,
  bildirimAboneligiVar,
  bildirimDestegi,
  bildirimeAboneOl,
  hatirlatmaAyariGetir,
  hatirlatmaAyariKaydet,
  hatirlatmaDene,
  hatirlatmaListesiGonder,
  kalemleriHazirla,
  type HatirlatmaAyari,
} from '../bulut/hatirlatma';
import { bulutBaglantisi } from '../bulut/esitleme';
import { yerelGun } from '../hesap/tarih';
import { bugunOzeti } from '../servisler/bugun';
import { useProjeErisimi, useUygulama, useYetki } from './baglam';
import { Hatalar, hataMetni } from './bilesenler';
import { vadeGorunur } from './Bugun';

/** Cihazda: hatırlatma açık mı, en son ne gönderildi (aynı liste her eşitlemede yeniden gitmesin). */
const META = 'hatirlatma';
interface HatirlatmaMeta {
  acik: boolean;
  ozet?: string;
  gun?: string;
}

/** Hatırlatma için sunucuya giden pencere: uygulama birkaç hafta açılmasa da yaklaşan vadeler listede olsun. */
const PENCERE_GUN = 45;

/**
 * Görünmez: bulut eşitlemesi bitince, hatırlatma açıksa kişinin görebildiği açık vadeleri sunucuya yükler. Liste
 * değişmediyse ve bugün zaten gönderildiyse gitmez.
 */
export function HatirlatmaYukleyici() {
  const { depo, oturum, firma, bulut } = useUygulama();
  const yetki = useYetki();
  const erisim = useProjeErisimi();
  const zaman = bulut.durum.tur === 'tamam' ? bulut.durum.zaman : null;

  useEffect(() => {
    if (!zaman) return;
    let iptal = false;
    void (async () => {
      const m = await depo.metaGetir<HatirlatmaMeta>(META);
      const baglanti = await bulutBaglantisi(depo);
      if (!m?.acik || !baglanti) return;
      const bugun = yerelGun(new Date());
      const o = await bugunOzeti(depo, oturum.firmaId, bugun, erisim, PENCERE_GUN);
      const kalemler = kalemleriHazirla([...o.vadeler.gecikmis, ...o.vadeler.yaklasan].filter((k) => vadeGorunur(yetki, k)));
      const ozet = JSON.stringify(kalemler);
      if (iptal || (m.ozet === ozet && m.gun === bugun)) return;
      try {
        await hatirlatmaListesiGonder(baglanti.firmaId, firma.ad, kalemler);
        await depo.metaYaz(META, { ...m, ozet, gun: bugun } satisfies HatirlatmaMeta);
      } catch {
        // İnternet ya da oturum yoksa bir sonraki eşitlemede yeniden denenir.
      }
    })();
    return () => {
      iptal = true;
    };
  }, [zaman, depo, oturum.firmaId, firma.ad, erisim, yetki]);
  return null;
}

/** Ayarlar › Vade hatırlatmaları. */
export function HatirlatmaKarti() {
  const { depo, bulut } = useUygulama();
  const bagli = bulut.durum.tur !== 'bagli_degil';
  const [ayar, setAyar] = useState<HatirlatmaAyari | null>(null);
  const [cihazAbone, setCihazAbone] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);
  const destek = bildirimDestegi();

  useEffect(() => {
    if (!bagli) return;
    hatirlatmaAyariGetir()
      .then(setAyar)
      .catch((e: unknown) => setHata(hataMetni(e)));
    void bildirimAboneligiVar().then(setCihazAbone);
  }, [bagli]);

  async function degistir(yeni: Partial<Pick<HatirlatmaAyari, 'eposta' | 'bildirim' | 'gunOnce'>>, bildirimAc = false) {
    if (!ayar) return;
    setIslemde(true);
    setHata(null);
    setMesaj(null);
    try {
      if (bildirimAc) {
        await bildirimeAboneOl(ayar.vapid);
        setCihazAbone(true);
      }
      const s = await hatirlatmaAyariKaydet({ eposta: ayar.eposta, bildirim: ayar.bildirim, gunOnce: ayar.gunOnce, ...yeni });
      setAyar(s);
      const acik = s.eposta || s.bildirim;
      const m = await depo.metaGetir<HatirlatmaMeta>(META);
      // Açılınca liste hemen gitsin diye özet sıfırlanır; eşitleme bitince yüklenir.
      await depo.metaYaz(META, { acik, ...(acik && !m?.acik ? {} : { ozet: m?.ozet, gun: m?.gun }) } satisfies HatirlatmaMeta);
      if (acik) void bulut.simdi();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  async function cihaziBirak() {
    setIslemde(true);
    try {
      await bildirimAboneligiBirak();
      setCihazAbone(false);
      setAyar(await hatirlatmaAyariGetir());
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  async function dene() {
    setIslemde(true);
    setHata(null);
    setMesaj(null);
    try {
      await bulut.simdi();
      const r = await hatirlatmaDene();
      const parca = [
        r.eposta === true && 'e-posta gönderildi',
        r.eposta === false && 'e-posta gönderilemedi',
        r.bildirim !== null && (r.bildirim > 0 ? `${r.bildirim} cihaza bildirim gönderildi` : 'bildirim gönderilecek cihaz yok'),
      ].filter(Boolean);
      setMesaj(`${parca.join(', ')}${r.kalem ? ` (${r.kalem} kalem)` : ''}.`);
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  return (
    <section className="kart">
      <h2>Vade hatırlatmaları</h2>
      <p className="soluk">
        Her sabah vadesi geçen, bugün ve yakında dolacak ödeme, tahsilat ve çekleri e-postayla ya da telefona bildirimle hatırlatır. Yalnız görme yetkiniz olan
        kayıtlar gelir.
      </p>
      {!bagli && <p className="mesaj-not">Hatırlatmalar sunucudan gönderilir; önce yukarıdan bulut eşitlemeyi açın ve giriş yapın.</p>}
      {bagli && !ayar && !hata && <p>Yükleniyor…</p>}
      {ayar && (
        <>
          <label className="onay-kutusu">
            <input type="checkbox" checked={ayar.eposta} disabled={islemde} onChange={(e) => void degistir({ eposta: e.target.checked })} />
            <span>Her sabah e-posta özeti</span>
          </label>
          <label className="onay-kutusu">
            <input
              type="checkbox"
              checked={ayar.bildirim && cihazAbone}
              disabled={islemde || destek !== 'destekleniyor'}
              onChange={(e) => void (e.target.checked ? degistir({ bildirim: true }, true) : cihaziBirak())}
            />
            <span>Bu cihaza anlık bildirim</span>
          </label>
          {destek === 'ana_ekran_gerekli' && (
            <p className="mesaj-not">
              iPhone'da bildirim için programı ana ekrana ekleyin (Safari › Paylaş › Ana Ekrana Ekle) ve oradan açın. Kilitleme Modu açıkken bildirim alınamaz;
              e-posta özeti çalışır.
            </p>
          )}
          {destek === 'desteklenmiyor' && <p className="mesaj-not">Bu tarayıcı anlık bildirimi desteklemiyor; e-posta özetini kullanın.</p>}
          {ayar.bildirim && !cihazAbone && ayar.abonelik > 0 && <p className="soluk kucuk">Bildirim {ayar.abonelik} başka cihazda açık.</p>}
          <label className="alan">
            <span className="alan-etiket">Kaç gün önceden</span>
            <select value={ayar.gunOnce} disabled={islemde} onChange={(e) => void degistir({ gunOnce: Number(e.target.value) })}>
              <option value={0}>Yalnız bugün ve vadesi geçenler</option>
              <option value={1}>1 gün önceden</option>
              <option value={3}>3 gün önceden</option>
              <option value={7}>7 gün önceden</option>
            </select>
          </label>
          {(ayar.eposta || ayar.bildirim) && (
            <div className="dugmeler">
              <button type="button" className="ikincil" disabled={islemde} onClick={() => void dene()}>
                Şimdi deneme gönder
              </button>
            </div>
          )}
        </>
      )}
      {mesaj && (
        <p className="mesaj mesaj-not" role="status">
          {mesaj.charAt(0).toUpperCase() + mesaj.slice(1)}
        </p>
      )}
      <Hatalar hatalar={hata ? [hata] : []} />
    </section>
  );
}
