import { useState, type ReactNode } from 'react';
import { gerekceGerekli, IsKuraliHatasi } from '../servisler/kayitServisi';
import type { TemelKayit } from '../veri/tipler';
import { useUygulama } from './baglam';

export const hataMetni = (e: unknown): string =>
  e instanceof IsKuraliHatasi ? e.message : `Beklenmeyen bir hata oluştu: ${e instanceof Error ? e.message : String(e)}`;

export function Alan({ etiket, aciklama, children }: { etiket: string; aciklama?: string; children: ReactNode }) {
  return (
    <label className="alan">
      <span className="alan-etiket">{etiket}</span>
      {children}
      {aciklama && <small className="alan-aciklama">{aciklama}</small>}
    </label>
  );
}

export function Hatalar({ hatalar }: { hatalar: string[] }) {
  if (hatalar.length === 0) return null;
  return (
    <div className="mesaj mesaj-uyari" role="alert">
      {hatalar.length === 1 ? (
        <p>{hatalar[0]}</p>
      ) : (
        <ul>
          {hatalar.map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GerekceKutusu(props: { baslik: string; onOnayla: (gerekce: string) => void; onVazgec: () => void }) {
  const [gerekce, setGerekce] = useState('');
  return (
    <div className="mesaj mesaj-uyari" role="dialog" aria-labelledby="gerekce-baslik">
      <h3 id="gerekce-baslik">{props.baslik}</h3>
      <p>Bu kayıt bugünden önce ya da başka biri tarafından girildi. Değişiklik için kısa bir gerekçe yazın; kayıt geçmişinde saklanır.</p>
      <Alan etiket="Gerekçe">
        <input value={gerekce} onChange={(e) => setGerekce(e.target.value)} autoFocus />
      </Alan>
      <div className="dugmeler">
        <button type="button" disabled={!gerekce.trim()} onClick={() => props.onOnayla(gerekce.trim())}>
          Kaydet
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

/**
 * Kayıt değiştirme/iptal akışı: kural gerekçe istiyorsa önce gerekçe sorulur.
 * `kutu` ekranda gösterilmeli; `hata` son işlemin hatasıdır.
 */
export function useGerekceliDegisiklik() {
  const { oturum } = useUygulama();
  const [istek, setIstek] = useState<{ baslik: string; calistir: (g?: string) => Promise<void> } | null>(null);
  const [hata, setHata] = useState<string | null>(null);

  async function dene(calistir: () => Promise<void>) {
    try {
      await calistir();
      return true;
    } catch (e) {
      setHata(hataMetni(e));
      return false;
    }
  }

  async function degistir(kayit: TemelKayit, baslik: string, calistir: (gerekce?: string) => Promise<void>) {
    setHata(null);
    if (gerekceGerekli(kayit, oturum.kullaniciId, new Date())) setIstek({ baslik, calistir });
    else await dene(() => calistir());
  }

  const kutu = istek && (
    <GerekceKutusu
      baslik={istek.baslik}
      onVazgec={() => setIstek(null)}
      onOnayla={(g) => void dene(() => istek.calistir(g)).then((tamam) => tamam && setIstek(null))}
    />
  );

  return { degistir, kutu, hata };
}
