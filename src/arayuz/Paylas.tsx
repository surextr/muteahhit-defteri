import { useEffect, useState } from 'react';
import { belgedenPdf, dosyaAdi, dosyaPaylas, whatsappAc } from '../cihaz/paylas';
import { useUygulama } from './baglam';
import { hataMetni } from './bilesenler';

// WhatsApp düğmeleri: hazır mesaj ve belge (sözleşme, hakediş, protokol) PDF'i.

/** Hazır mesajla WhatsApp'ı açar; carinin telefonu varsa doğrudan onun sohbeti. */
export function WhatsappDugmesi({ telefon, metin, etiket = 'WhatsApp ile gönder', ikincil = true }: { telefon: string | null; metin: () => string; etiket?: string; ikincil?: boolean }) {
  return (
    <button type="button" className={`${ikincil ? 'ikincil ' : ''}whatsapp-dugmesi`} onClick={() => whatsappAc(telefon, metin())}>
      <span aria-hidden="true">💬</span> {etiket}
    </button>
  );
}

/**
 * Sayfadaki `.sozlesme-belgesi`ni PDF yapar ve telefonun paylaş menüsünü açar (WhatsApp seçilir). Paylaşım olmayan
 * cihazda PDF indirilir ve carinin WhatsApp sohbeti açılabilir; dosyayı ataçla eklemek kullanıcıya kalır.
 */
export function PdfPaylasDugmesi({ ad, mesaj, cariId }: { ad: string; mesaj: string; cariId: string | null }) {
  const { depo } = useUygulama();
  const [telefon, setTelefon] = useState<string | null>(null);
  const [durum, setDurum] = useState<'hazir' | 'hazirlaniyor' | 'indirildi' | 'hata'>('hazir');
  const [hata, setHata] = useState('');
  useEffect(() => {
    if (cariId) void depo.getir('cari', cariId).then((c) => setTelefon(c?.telefon ?? null));
  }, [depo, cariId]);
  const paylas = async () => {
    const el = document.querySelector<HTMLElement>('.sozlesme-belgesi');
    if (!el) return;
    setDurum('hazirlaniyor');
    try {
      const pdf = await belgedenPdf(el);
      const sonuc = await dosyaPaylas(pdf, dosyaAdi(ad), mesaj);
      setDurum(sonuc === 'indirildi' ? 'indirildi' : 'hazir');
    } catch (e) {
      setHata(hataMetni(e));
      setDurum('hata');
    }
  };
  return (
    <>
      <button type="button" className="ikincil whatsapp-dugmesi" disabled={durum === 'hazirlaniyor'} onClick={() => void paylas()}>
        <span aria-hidden="true">📤</span> {durum === 'hazirlaniyor' ? 'PDF hazırlanıyor…' : 'PDF olarak paylaş (WhatsApp)'}
      </button>
      {durum === 'indirildi' && (
        <p className="mesaj mesaj-not">
          PDF indirildi. WhatsApp'ta sohbeti açıp ataçla (📎) ekleyin.{' '}
          <button type="button" className="baglanti-dugmesi" onClick={() => whatsappAc(telefon, mesaj)}>
            WhatsApp'ı aç
          </button>
        </p>
      )}
      {durum === 'hata' && <p className="hata">PDF hazırlanamadı: {hata}</p>}
    </>
  );
}
