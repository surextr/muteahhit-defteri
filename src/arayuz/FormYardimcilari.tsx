import { useState, type ReactNode } from 'react';
import { Simge } from './Simge';

// Uzun formlarda ortak parçalar: katlanır bölüm (asıl işi öne çıkarır, ayrıntıyı katlar), ekranın altında sabit kaydet
// çubuğu (kaydırmadan kaydedilir) ve kayıttan sonra "sonraki adım" kartı (ekrandan ayrılmadan aynı işi tekrar girmeye
// ya da kaydı görmeye yarar). Gider formunda denendi, başka uzun formlara da uygulanır.

/** Katlanır bölüm: kapalıyken başlığın yanında içindeki seçimin özeti görünür. */
export function Katlanir(props: { baslik: string; ozet: string; acik: boolean; children: ReactNode }) {
  const [acik, setAcik] = useState(props.acik);
  return (
    <details className="kart katlanir" open={acik} onToggle={(e) => setAcik(e.currentTarget.open)}>
      <summary>
        <span className="katlanir-baslik">{props.baslik}</span>
        {props.ozet && <span className="katlanir-ozet">{props.ozet}</span>}
      </summary>
      <div className="katlanir-icerik">{props.children}</div>
    </details>
  );
}

/** Ekranın altında sabit: kaydırmadan kaydedilir, uzun formda Kaydet her an elin altındadır. */
export function KaydetCubugu(props: { etiket: ReactNode; onKaydet: () => void; disabled?: boolean; vazgecEtiket?: string; onVazgec?: () => void; vazgecDisabled?: boolean }) {
  return (
    <div className="kaydet-cubugu">
      <button type="button" className="kaydet-dugmesi" onClick={props.onKaydet} disabled={props.disabled}>
        {props.etiket}
      </button>
      {props.onVazgec && (
        <button type="button" className="ikincil" onClick={props.onVazgec} disabled={props.vazgecDisabled ?? props.disabled}>
          {props.vazgecEtiket ?? 'Vazgeç'}
        </button>
      )}
    </div>
  );
}

export interface SonrakiAdim {
  etiket: string;
  /** Verilirse bağlantı (ekrandan çıkar); yoksa onClick (ekranda kalır, örn. formu sıfırlayıp yeni kayda geçer). */
  href?: string;
  onClick?: () => void;
  birincil?: boolean;
}

/**
 * Kayıt tamamlandığında gösterilir: "Kaydedildi" onayı + aynı ekranda kalarak devam edilecek işler (art arda birçok
 * gider/ödeme girilirken her birinde listeye dönüp yeniden açmak gerekmesin diye).
 */
export function SonrakiAdimKarti(props: { mesaj: string; adimlar: SonrakiAdim[] }) {
  return (
    <section className="kart sonraki-adim" role="status">
      <p className="sonraki-adim-basarili">
        <Simge ad="basarili" /> {props.mesaj}
      </p>
      <div className="dugmeler">
        {props.adimlar.map((a, i) =>
          a.href ? (
            <a key={i} className={a.birincil ? 'dugme' : 'dugme ikincil'} href={a.href}>
              {a.etiket}
            </a>
          ) : (
            <button key={i} type="button" className={a.birincil ? undefined : 'ikincil'} onClick={a.onClick}>
              {a.etiket}
            </button>
          ),
        )}
      </div>
    </section>
  );
}
