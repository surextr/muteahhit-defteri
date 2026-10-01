import { useState, type FormEvent } from 'react';
import { ilkKurulum } from '../servisler/kurulum';
import type { Depo } from '../veri/depo';
import { Alan, Hatalar, hataMetni } from './bilesenler';

/** İlk açılış: firma ve yönetici kullanıcı oluşturulur. */
export function KurulumEkrani({ depo, onKuruldu }: { depo: Depo; onKuruldu: () => void }) {
  const [firmaAdi, setFirmaAdi] = useState('');
  const [kullaniciAdi, setKullaniciAdi] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  async function gonder(e: FormEvent) {
    e.preventDefault();
    setIslemde(true);
    setHata(null);
    try {
      await ilkKurulum(depo, { firmaAdi, kullaniciAdi });
      onKuruldu();
    } catch (err) {
      setHata(hataMetni(err));
    } finally {
      setIslemde(false);
    }
  }

  return (
    <form className="kart" onSubmit={gonder}>
      <h2>Hoş geldiniz</h2>
      <p className="soluk">Başlamak için firmanızı tanıtın. Veriler bu cihazda saklanır.</p>
      <Alan etiket="Firma adı">
        <input value={firmaAdi} onChange={(e) => setFirmaAdi(e.target.value)} autoComplete="organization" required />
      </Alan>
      <Alan etiket="Adınız" aciklama="Kayıt geçmişinde değişikliği yapan kişi olarak görünür.">
        <input value={kullaniciAdi} onChange={(e) => setKullaniciAdi(e.target.value)} autoComplete="name" required />
      </Alan>
      <Hatalar hatalar={hata ? [hata] : []} />
      <button type="submit" disabled={islemde}>
        {islemde ? 'Hazırlanıyor…' : 'Başla'}
      </button>
    </form>
  );
}
