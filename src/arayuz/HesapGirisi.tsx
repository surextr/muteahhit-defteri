import { useEffect, useState } from 'react';
import { EN_KISA_SIFRE, onayDonusuOku, yzCikis, yzGirisYap, yzKayitOl, yzOturumu } from '../bulut/yapayZeka';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import { Alan, Hatalar, hataMetni } from './bilesenler';

// Giriş hesabı (e-posta + şifre; kayıtta e-posta onayı). Yapay zekâ ve bulut eşitleme aynı hesabı kullanır.

/** Giriş yapılmış e-posta (undefined: okunuyor, null: giriş yok). */
export function useHesap(): [string | null | undefined, (e: string | null) => void] {
  const [eposta, setEposta] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    void yzOturumu().then(setEposta, () => setEposta(null));
  }, []);
  return [eposta, setEposta];
}

/** Giriş yapılmışsa e-posta ve "Çıkış"; yapılmamışsa giriş / kayıt formu. */
export function HesapGirisi({ eposta, onDegisti }: { eposta: string | null | undefined; onDegisti: (e: string | null) => void }) {
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
      onDegisti(await yzOturumu());
    });

  const kayitOl = () =>
    calistir(async () => {
      if (sifre !== sifreTekrar) throw new IsKuraliHatasi('Şifreler aynı değil.');
      const sonuc = await yzKayitOl(girilen, sifre);
      setSifre('');
      setSifreTekrar('');
      if (sonuc === 'giris_yapildi') {
        onDegisti(await yzOturumu());
        return;
      }
      setMod('giris');
      setBilgi(`Kaydınız alındı. ${girilen.trim()} adresine gelen e-postadaki onay bağlantısına tıklayın, sonra buradan giriş yapın.`);
    });

  const gecerli = girilen.includes('@') && sifre.length >= EN_KISA_SIFRE && (mod === 'giris' || sifreTekrar.length > 0);

  return (
    <>
      {eposta === undefined && <p>Yükleniyor…</p>}
      {eposta && (
        <div className="baslik-satiri">
          <span>
            Giriş yapıldı: <strong>{eposta}</strong>
          </span>
          <button type="button" className="ikincil" disabled={islemde} onClick={() => void calistir(async () => (await yzCikis(), onDegisti(null)))}>
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
    </>
  );
}
