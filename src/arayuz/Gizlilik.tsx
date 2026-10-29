import { useState } from 'react';
import { bulutBaglantisiniKes } from '../bulut/esitleme';
import { hesabiSil } from '../bulut/yapayZeka';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { useHesap } from './HesapGirisi';

/** Ayarlar › Gizlilik ve hesap: gizlilik politikası ve giriş hesabını silme. */
export function GizlilikKarti() {
  const { depo, bulut } = useUygulama();
  const [eposta, setEposta] = useHesap();
  const [soru, setSoru] = useState(false);
  const [sifre, setSifre] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [bilgi, setBilgi] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  async function sil() {
    setIslemde(true);
    setHata(null);
    try {
      await hesabiSil(sifre);
      if (bulut.durum.tur !== 'bagli_degil') {
        await bulutBaglantisiniKes(depo);
        bulut.yenidenBaslat();
      }
      setEposta(null);
      setSoru(false);
      setSifre('');
      setBilgi('Giriş hesabınız silindi. Bu cihazdaki kayıtlar yerinde duruyor.');
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  return (
    <section className="kart">
      <h2>Gizlilik ve hesap</h2>
      <p className="soluk">
        Kayıtlar bu cihazda saklanır; bulut eşitleme açılırsa muteahhit.surex.tr sunucusunda da durur. Reklam ve izleme yoktur.{' '}
        <a href="gizlilik.html" target="_blank" rel="noopener">
          Gizlilik politikası
        </a>
      </p>
      {eposta && !soru && (
        <button type="button" className="baglanti-dugmesi" onClick={() => setSoru(true)}>
          Giriş hesabımı sil ({eposta})
        </button>
      )}
      {eposta && soru && (
        <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="Hesabı silme">
          <p>
            Hesabınız ve oturumlarınız sunucudan silinir. Buluta açtığınız firmanın başka üyesi varsa firma ona devredilir; tek üyesi sizseniz firmanın
            buluttaki kopyası da silinir. Bu cihazdaki kayıtlar silinmez. Geri alınamaz.
          </p>
          <Alan etiket="Şifreniz">
            <input type="password" autoComplete="current-password" value={sifre} onChange={(e) => setSifre(e.target.value)} />
          </Alan>
          <div className="dugmeler">
            <button type="button" className="tehlikeli" disabled={!sifre || islemde} onClick={() => void sil()}>
              {islemde ? 'Siliniyor…' : 'Hesabımı sil'}
            </button>
            <button type="button" className="ikincil" onClick={() => setSoru(false)}>
              Vazgeç
            </button>
          </div>
        </div>
      )}
      {bilgi && (
        <p className="mesaj mesaj-basari" role="status">
          {bilgi}
        </p>
      )}
      <Hatalar hatalar={hata ? [hata] : []} />
    </section>
  );
}
