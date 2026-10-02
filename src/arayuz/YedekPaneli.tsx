import { useCallback, useEffect, useState } from 'react';
import { cihaz } from '../cihaz';
import { zamanYaz } from '../hesap/tarih';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import {
  META_SON_YEDEK,
  elleYedekAl,
  geriYukle,
  yedegiCoz,
  yedekDosyaAdi,
  yedekOzeti,
  type YedekDosyasi,
  type YedekOzeti,
} from '../servisler/yedek';
import type { Depo } from '../veri/depo';
import type { ArsivOzeti, YedekArsivi } from '../veri/yedekArsivi';

interface Props {
  depo: Depo;
  arsiv: YedekArsivi;
  /** Geri yüklemeden sonra ekranın veriyi yeniden okuması için. */
  onDegisti: () => void;
}

interface Bekleyen {
  yedek: YedekDosyasi;
  ozet: YedekOzeti;
  kaynak: string;
}

type Mesaj = { tur: 'basari' | 'uyari'; metin: string };

const hataMetni = (e: unknown) =>
  e instanceof IsKuraliHatasi ? e.message : `Beklenmeyen bir hata oluştu: ${e instanceof Error ? e.message : String(e)}`;

const jsonDosyasi = (metin: string) => new Blob([metin], { type: 'application/json' });

export function YedekPaneli({ depo, arsiv, onDegisti }: Props) {
  const [islemde, setIslemde] = useState(false);
  const [mesaj, setMesaj] = useState<Mesaj | null>(null);
  const [bekleyen, setBekleyen] = useState<Bekleyen | null>(null);
  const [otomatikler, setOtomatikler] = useState<ArsivOzeti[]>([]);
  const [sonYedek, setSonYedek] = useState<string | null>(null);

  const yenile = useCallback(async () => {
    setOtomatikler(await arsiv.listele());
    setSonYedek((await depo.metaGetir<string>(META_SON_YEDEK)) ?? null);
  }, [depo, arsiv]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  async function calistir(is: () => Promise<void>) {
    setIslemde(true);
    setMesaj(null);
    try {
      await is();
    } catch (e) {
      setMesaj({ tur: 'uyari', metin: hataMetni(e) });
    } finally {
      setIslemde(false);
    }
  }

  const yedekAl = (belgeler: boolean) =>
    calistir(async () => {
      const { dosyaAdi, metin } = await elleYedekAl(depo, undefined, { belgeler });
      await cihaz.dosyaKaydet(jsonDosyasi(metin), dosyaAdi);
      const boyut = (metin.length / 1024 / 1024).toLocaleString('tr-TR', { maximumFractionDigits: 1 });
      setMesaj({
        tur: 'basari',
        metin: `Yedek indirildi: ${dosyaAdi} (${boyut} MB). ${belgeler ? '' : 'Fotoğraf ve PDF dosyaları bu yedekte yok. '}Dosyayı telefon dışında güvenli bir yere (Drive, e-posta…) de kaydedin.`,
      });
      await yenile();
    });

  const dosyadanSec = () =>
    calistir(async () => {
      const dosya = await cihaz.dosyaSec('.json,application/json');
      if (!dosya) return;
      const yedek = yedegiCoz(await dosya.text(), depo.semaSurumu);
      setBekleyen({ yedek, ozet: yedekOzeti(yedek), kaynak: dosya.name });
    });

  const otomatikSec = (id: string) =>
    calistir(async () => {
      const kayit = await arsiv.getir(id);
      if (!kayit) throw new IsKuraliHatasi('Bu otomatik yedek artık yok.');
      const yedek = yedegiCoz(kayit.icerik, depo.semaSurumu);
      setBekleyen({ yedek, ozet: yedekOzeti(yedek), kaynak: `Otomatik yedek (${kayit.neden})` });
    });

  const otomatikIndir = (id: string) =>
    calistir(async () => {
      const kayit = await arsiv.getir(id);
      if (!kayit) throw new IsKuraliHatasi('Bu otomatik yedek artık yok.');
      await cihaz.dosyaKaydet(jsonDosyasi(kayit.icerik), yedekDosyaAdi(yedegiCoz(kayit.icerik, depo.semaSurumu)));
    });

  const geriYukleOnayla = () =>
    calistir(async () => {
      if (!bekleyen) return;
      await geriYukle(depo, arsiv, bekleyen.yedek);
      setBekleyen(null);
      setMesaj({
        tur: 'basari',
        metin: 'Yedek geri yüklendi. Önceki verileriniz otomatik yedeklere eklendi; gerekirse oradan geri dönebilirsiniz.',
      });
      await yenile();
      onDegisti();
    });

  return (
    <section className="kart">
      <h2>Yedekleme</h2>
      <p className="soluk">Son yedek: {sonYedek ? zamanYaz(sonYedek) : 'henüz alınmadı'}</p>

      <p className="mesaj-not">
        "Sadece veri" küçüktür, sık alınabilir; fotoğraf ve PDF dosyalarını içermez. Belgelerin de korunması için arada bir
        "veri + belgeler" yedeği alın.
      </p>
      <div className="dugmeler">
        <button type="button" onClick={() => yedekAl(true)} disabled={islemde}>
          Yedek al (veri + belgeler)
        </button>
        <button type="button" className="ikincil" onClick={() => yedekAl(false)} disabled={islemde}>
          Sadece veri
        </button>
        <button type="button" className="ikincil" onClick={dosyadanSec} disabled={islemde}>
          Yedekten geri yükle
        </button>
      </div>

      {bekleyen && (
        <div className="mesaj mesaj-uyari" role="alertdialog" aria-labelledby="geri-yukle-baslik">
          <h3 id="geri-yukle-baslik">Bu yedek geri yüklensin mi?</h3>
          <ul className="ozet">
            <li>Kaynak: {bekleyen.kaynak}</li>
            <li>Yedek tarihi: {zamanYaz(bekleyen.ozet.olusturmaZamani)}</li>
            <li>Firma: {bekleyen.ozet.firmaAdi ?? '—'}</li>
            <li>Kayıt sayısı: {bekleyen.ozet.kayitSayisi.toLocaleString('tr-TR')}</li>
            <li>
              Belgeler:{' '}
              {bekleyen.ozet.belgelerDahil
                ? `${bekleyen.ozet.belgeSayisi} belge, dosyalarıyla`
                : `${bekleyen.ozet.belgeSayisi} belge, dosyasız (sadece veri yedeği; bu cihazda bulunan dosyalar korunur)`}
            </li>
          </ul>
          <p>
            Bu cihazdaki bütün veriler yedektekilerle <strong>değiştirilecek</strong>. Önce mevcut verilerin otomatik
            yedeği alınır.
          </p>
          <div className="dugmeler">
            <button type="button" onClick={geriYukleOnayla} disabled={islemde}>
              {islemde ? 'Geri yükleniyor…' : 'Geri yükle'}
            </button>
            <button type="button" className="ikincil" onClick={() => setBekleyen(null)} disabled={islemde}>
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {mesaj && (
        <p className={`mesaj mesaj-${mesaj.tur}`} role="status">
          {mesaj.metin}
        </p>
      )}

      <h3>Otomatik yedekler</h3>
      {otomatikler.length === 0 ? (
        <p className="soluk">Henüz yok. Geri yüklemeden ve veritabanı güncellemesinden önce otomatik alınır.</p>
      ) : (
        <ul className="liste">
          {otomatikler.map((y) => (
            <li key={y.id}>
              <div>
                <strong>{zamanYaz(y.zaman)}</strong>
                <span className="soluk"> · {y.neden}</span>
              </div>
              <div className="dugmeler">
                <button type="button" className="ikincil" onClick={() => otomatikIndir(y.id)} disabled={islemde}>
                  İndir
                </button>
                <button type="button" className="ikincil" onClick={() => otomatikSec(y.id)} disabled={islemde}>
                  Geri yükle
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
