import { useEffect, useRef, useState, type ReactNode } from 'react';
import { bekleyenSayisi } from '../servisler/havuz';
import { ROL_ADI } from '../servisler/kullanici';
import type { Yetki } from '../hesap/yetki';
import { useUygulama, useYetki } from './baglam';
import { durumMetni } from './Bulut';
import { hedefDugme, KISAYOLLAR, kisayolBul, yaziAlaniMi } from './klavye';
import { git } from './rota';

interface MenuOgesi {
  yol: string;
  ad: string;
  simge: string;
  yetki?: Yetki;
}

/** Bilgisayarda sol menü (hepsi), telefonda alt menü (en sık beşi; Ayarlar ve arama üst çubukta). */
const YAN_MENU: MenuOgesi[] = [
  { yol: 'bugun', ad: 'Bugün', simge: '🏠' },
  { yol: 'projeler', ad: 'Projeler', simge: '🏗️' },
  { yol: 'cariler', ad: 'Cariler', simge: '👥', yetki: 'cari' },
  { yol: 'hesaplar', ad: 'Kasa / Banka', simge: '🏦', yetki: 'kasa' },
  { yol: 'havuz', ad: 'Belge havuzu', simge: '📥' },
  { yol: 'rapor', ad: 'Firma raporu', simge: '📊', yetki: 'rapor' },
  { yol: 'maliyet', ad: 'Maliyet hesabı', simge: '🧮' },
  { yol: 'ayarlar', ad: 'Ayarlar', simge: '⚙️' },
];
const ALT_MENU: MenuOgesi[] = [
  { yol: 'bugun', ad: 'Bugün', simge: '🏠' },
  { yol: 'projeler', ad: 'Projeler', simge: '🏗️' },
  { yol: 'kayit', ad: 'Kayıt', simge: '＋' },
  { yol: 'cariler', ad: 'Cariler', simge: '👥', yetki: 'cari' },
  { yol: 'hesaplar', ad: 'Kasa', simge: '🏦', yetki: 'kasa' },
];

/**
 * Uygulama çerçevesi. Bilgisayarda (geniş ekran) solda sabit menü, arama ve "Yeni kayıt"; telefonda üst çubuk ve
 * başparmakla ulaşılan alt menü. `genis`: listeler ve panolar ekranı geniş kullanır, formlar okunur genişlikte kalır.
 */
export function Kabuk({ aktif, genis, children }: { aktif: string; genis?: boolean; children: ReactNode }) {
  const { depo, oturum, firma, kullanici, bulut } = useUygulama();
  const yetki = useYetki();
  const [bekleyen, setBekleyen] = useState(0);
  const [arama, setArama] = useState('');
  const [yardim, setYardim] = useState(false);
  const yardimRef = useRef(yardim);
  yardimRef.current = yardim;
  const yetkiRef = useRef(yetki);
  yetkiRef.current = yetki;

  // Onay bekleyen belge sayısı ekran değiştikçe tazelenir.
  useEffect(() => {
    void bekleyenSayisi(depo, oturum.firmaId).then(setBekleyen);
  }, [depo, oturum.firmaId, aktif]);

  // Klavye: Ctrl+K (⌘K) ya da "/" arama; Ctrl+Enter / Ctrl+S kaydet; Esc vazgeç; yazı alanı dışında harf kısayolları
  // (klavye.ts) ve "?" kısayol listesi.
  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const yaziAlani = yaziAlaniMi(e.target);
      const ctrl = e.ctrlKey || e.metaKey;
      if ((ctrl && e.key.toLowerCase() === 'k') || (e.key === '/' && !yaziAlani)) {
        e.preventDefault();
        const kutu = document.querySelector<HTMLInputElement>('.yan-arama input');
        if (kutu && kutu.offsetParent) kutu.focus();
        else git('ara');
        return;
      }
      if (ctrl && !e.altKey && (e.key === 'Enter' || e.key.toLowerCase() === 's')) {
        e.preventDefault(); // Ctrl+S tarayıcının "sayfayı kaydet"ini açmasın.
        hedefDugme('kaydet')?.click();
        return;
      }
      if (e.key === 'Escape') {
        if (yardimRef.current) {
          setYardim(false);
          return;
        }
        const d = hedefDugme('vazgec');
        if (d) {
          e.preventDefault();
          d.click();
        }
        return;
      }
      if (yaziAlani || ctrl || e.altKey) return;
      if (e.key === '?') {
        setYardim((y) => !y);
        return;
      }
      const k = kisayolBul(e.key);
      if (k && (!k.yetki || yetkiRef.current(k.yetki))) {
        e.preventDefault();
        setYardim(false);
        git(k.yol);
      }
    };
    window.addEventListener('keydown', tus);
    return () => window.removeEventListener('keydown', tus);
  }, []);

  const gorunen = (m: MenuOgesi) => !m.yetki || yetki(m.yetki);
  const rozet = (yol: string) => (yol === 'havuz' && bekleyen > 0 ? <span className="menu-rozet">{bekleyen}</span> : null);
  const bulutSimgesi = bulut.durum.tur !== 'bagli_degil' && (
    <a href="#/ayarlar" className={`bulut-simge bulut-${bulut.durum.tur}`} title={durumMetni(bulut.durum)} aria-label={durumMetni(bulut.durum)}>
      ☁
    </a>
  );

  return (
    <div className="kabuk">
      <aside className="yan-menu" aria-label="Ana menü">
        <div className="yan-firma">
          <span>{firma.ad}</span>
          {bulutSimgesi}
        </div>
        <form
          className="yan-arama"
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            git(`ara/${encodeURIComponent(arama.trim())}`);
          }}
        >
          <input type="search" value={arama} placeholder="Ara… (Ctrl+K)" aria-label="Ara: cari, proje, fatura, belge" onChange={(e) => setArama(e.target.value)} />
        </form>
        <a className="yan-yeni" href="#/kayit">
          ＋ Yeni kayıt
        </a>
        <nav>
          {YAN_MENU.filter(gorunen).map((m) => (
            <a key={m.yol} href={`#/${m.yol}`} aria-current={aktif === m.yol ? 'page' : undefined}>
              <span aria-hidden="true">{m.simge}</span>
              <span className="yan-ad">{m.ad}</span>
              {rozet(m.yol)}
            </a>
          ))}
        </nav>
        <button type="button" className="yan-kisayol" onClick={() => setYardim(true)}>
          ⌨ Klavye kısayolları <kbd>?</kbd>
        </button>
        <a className="yan-kullanici" href="#/ayarlar/kullanicilar" title="Bu cihazı kullanan kişi">
          {kullanici.ad}
          {kullanici.rol && <span className="soluk-acik"> · {ROL_ADI[kullanici.rol]}</span>}
        </a>
      </aside>

      <header className="ust">
        <span className="ust-firma">
          {firma.ad}
          {bulutSimgesi}
        </span>
        <span className="ust-araclar">
          <a href="#/ara" aria-label="Ara" title="Ara">
            🔍
          </a>
          {bekleyen > 0 && (
            <a href="#/havuz" className="ust-rozet" aria-label={`${bekleyen} belge onay bekliyor`} title="Onay bekleyen belgeler">
              📥<span>{bekleyen}</span>
            </a>
          )}
          <a href="#/ayarlar" aria-label="Ayarlar" title="Ayarlar">
            ⚙️
          </a>
        </span>
      </header>

      <main className={`sayfa${genis ? ' sayfa-genis' : ''}`}>{children}</main>

      {yardim && (
        <div className="kisayol-perdesi" onClick={() => setYardim(false)}>
          <section className="kart kisayol-listesi" role="dialog" aria-labelledby="kisayol-baslik" onClick={(e) => e.stopPropagation()}>
            <h2 id="kisayol-baslik">Klavye kısayolları</h2>
            <dl>
              {KISAYOLLAR.filter((k) => !k.yetki || yetki(k.yetki)).map((k) => (
                <div key={k.tus}>
                  <dt>
                    <kbd>{k.ad}</kbd>
                  </dt>
                  <dd>{k.aciklama}</dd>
                </div>
              ))}
              <div>
                <dt>
                  <kbd>Ctrl</kbd> + <kbd>K</kbd> ya da <kbd>/</kbd>
                </dt>
                <dd>Ara</dd>
              </div>
              <div>
                <dt>
                  <kbd>Ctrl</kbd> + <kbd>Enter</kbd> ya da <kbd>Ctrl</kbd> + <kbd>S</kbd>
                </dt>
                <dd>Formu kaydet</dd>
              </div>
              <div>
                <dt>
                  <kbd>Esc</kbd>
                </dt>
                <dd>Vazgeç / soruyu kapat</dd>
              </div>
            </dl>
            <p className="soluk">Harf kısayolları yazı alanının dışındayken çalışır.</p>
            <div className="dugmeler">
              <button type="button" className="ikincil" onClick={() => setYardim(false)}>
                Kapat
              </button>
            </div>
          </section>
        </div>
      )}

      <nav className="alt-menu" aria-label="Ana menü">
        {ALT_MENU.filter(gorunen).map((m) => (
          <a key={m.yol} href={`#/${m.yol}`} aria-current={aktif === m.yol ? 'page' : undefined}>
            <span aria-hidden="true">{m.simge}</span>
            {m.ad}
          </a>
        ))}
      </nav>
    </div>
  );
}
