import { useEffect, useState } from 'react';
import {
  EN_KISA_SIFRE,
  onayDonusuOku,
  ozelSartlariDuzenle,
  yzCikis,
  yzGirisYap,
  yzKayitOl,
  yzOturumu,
  type DuzenlemeSonucu,
} from '../bulut/yapayZeka';
import { maskele } from '../hesap/maskele';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import { ustaTipleriListele } from '../servisler/ustaTipi';
import type { UstaTipi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';

// Yapay zekâ ile özel şartları düzenleme: e-posta + şifreyle giriş (kayıtta e-posta onayı) ve yan yana karşılaştırma.
// Yalnızca usta tipinin adı ve maskelenmiş özel şartlar gönderilir. İnternet yoksa şablonla devam edilir.

export function YapayZekaKarti() {
  const [eposta, setEposta] = useState<string | null | undefined>(undefined);
  const [mod, setMod] = useState<'giris' | 'kayit'>('giris');
  const [girilen, setGirilen] = useState('');
  const [sifre, setSifre] = useState('');
  const [sifreTekrar, setSifreTekrar] = useState('');
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    // E-postadaki onay bağlantısından dönüldüyse sonucu bildir.
    const donus = onayDonusuOku();
    if (donus === 'onaylandi') setBilgi('E-posta adresiniz onaylandı. Şimdi e-posta ve şifrenizle giriş yapın.');
    if (donus === 'hata') setHata('Onay bağlantısı geçersiz ya da süresi dolmuş. Yeniden kayıt olmayı deneyin.');
    void yzOturumu().then(setEposta, () => setEposta(null));
  }, []);

  const calistir = async (is: () => Promise<void>) => {
    setIslemde(true);
    setHata(null);
    setBilgi(null);
    try {
      await is();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  };

  const girisYap = () =>
    calistir(async () => {
      await yzGirisYap(girilen, sifre);
      setSifre('');
      setEposta(await yzOturumu());
    });

  const kayitOl = () =>
    calistir(async () => {
      if (sifre !== sifreTekrar) throw new IsKuraliHatasi('Şifreler aynı değil.');
      const sonuc = await yzKayitOl(girilen, sifre);
      setSifre('');
      setSifreTekrar('');
      if (sonuc === 'giris_yapildi') {
        setEposta(await yzOturumu());
        return;
      }
      setMod('giris');
      setBilgi(`Kaydınız alındı. ${girilen.trim()} adresine gelen e-postadaki onay bağlantısına tıklayın, sonra buradan giriş yapın.`);
    });

  const gecerli = girilen.includes('@') && sifre.length >= EN_KISA_SIFRE && (mod === 'giris' || sifreTekrar.length > 0);

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
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (gecerli && !islemde) void (mod === 'giris' ? girisYap() : kayitOl());
          }}
        >
          <div className="filtreler" role="group" aria-label="Giriş ya da kayıt">
            <button type="button" aria-pressed={mod === 'giris'} onClick={() => (setMod('giris'), setHata(null))}>
              Giriş yap
            </button>
            <button type="button" aria-pressed={mod === 'kayit'} onClick={() => (setMod('kayit'), setHata(null), setBilgi(null))}>
              Kayıt ol
            </button>
          </div>
          <Alan etiket="E-posta">
            <input type="email" inputMode="email" autoComplete="email" value={girilen} onChange={(e) => setGirilen(e.target.value)} />
          </Alan>
          <Alan etiket="Şifre" aciklama={mod === 'kayit' ? `En az ${EN_KISA_SIFRE} karakter.` : undefined}>
            <input
              type="password"
              autoComplete={mod === 'giris' ? 'current-password' : 'new-password'}
              value={sifre}
              onChange={(e) => setSifre(e.target.value)}
            />
          </Alan>
          {mod === 'kayit' && (
            <Alan etiket="Şifre (tekrar)">
              <input type="password" autoComplete="new-password" value={sifreTekrar} onChange={(e) => setSifreTekrar(e.target.value)} />
            </Alan>
          )}
          <div className="dugmeler">
            <button type="submit" disabled={islemde || !gecerli}>
              {islemde ? 'Bekleyin…' : mod === 'giris' ? 'Giriş yap' : 'Kayıt ol'}
            </button>
          </div>
        </form>
      )}
      {bilgi && (
        <p className="mesaj mesaj-basari" role="status">
          {bilgi}
        </p>
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
