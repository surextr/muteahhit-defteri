import { useEffect, useRef, useState, type ReactNode } from 'react';
import { bekleyenSayisi } from '../servisler/havuz';
import { gizlemeyiTemizle, rozetSayisi, type GizlemeListesi } from '../hesap/yapilacaklar';
import { yerelGun } from '../hesap/tarih';
import { META_YAPILACAK_GIZLEME, yapilacaklariGetir } from '../servisler/yapilacaklar';
import { ROL_ADI } from '../servisler/kullanici';
import type { Yetki } from '../hesap/yetki';
import { useProjeErisimi, useUygulama, useYetki } from './baglam';
import { durumMetni } from './Bulut';
import { Simge, type SimgeAdi } from './Simge';
import { hedefDugme, KISAYOLLAR, kisayolBul, yaziAlaniMi } from './klavye';
import { geriGit, git, useRota } from './rota';

interface MenuOgesi {
  yol: string;
  ad: string;
  simge: SimgeAdi;
  yetki?: Yetki;
}

/** Bilgisayarda sol menü (hepsi), telefonda alt menü (en sık beşi; Ayarlar ve arama üst çubukta). */
const YAN_MENU: MenuOgesi[] = [
  { yol: 'bugun', ad: 'Bugün', simge: 'bugun' },
  { yol: 'yapilacaklar', ad: 'Yapılacaklar', simge: 'yapilacak' },
  { yol: 'projeler', ad: 'Projeler', simge: 'proje' },
  { yol: 'cariler', ad: 'Cariler', simge: 'cari', yetki: 'cari' },
  { yol: 'hesaplar', ad: 'Kasa / Banka', simge: 'kasa', yetki: 'kasa' },
  { yol: 'havuz', ad: 'Belge havuzu', simge: 'belge' },
  { yol: 'rapor', ad: 'Firma raporu', simge: 'rapor', yetki: 'rapor' },
  { yol: 'maliyet', ad: 'Maliyet hesabı', simge: 'hesap' },
  { yol: 'ayarlar', ad: 'Ayarlar', simge: 'ayar' },
];
const ALT_MENU: MenuOgesi[] = [
  { yol: 'bugun', ad: 'Bugün', simge: 'bugun' },
  { yol: 'projeler', ad: 'Projeler', simge: 'proje' },
  { yol: 'kayit', ad: 'Kayıt', simge: 'ekle' },
  { yol: 'cariler', ad: 'Cariler', simge: 'cari', yetki: 'cari' },
  { yol: 'hesaplar', ad: 'Kasa', simge: 'kasa', yetki: 'kasa' },
];

/**
 * Uygulama çerçevesi. Bilgisayarda (geniş ekran) solda sabit menü, arama ve "Yeni kayıt"; telefonda üst çubuk ve
 * başparmakla ulaşılan alt menü. `genis`: listeler ve panolar ekranı geniş kullanır, formlar okunur genişlikte kalır.
 */
export function Kabuk({ aktif, genis, children }: { aktif: string; genis?: boolean; children: ReactNode }) {
  const { depo, oturum, firma, kullanici, bulut } = useUygulama();
  const yetki = useYetki();
  const yol = useRota();
  const [bekleyen, setBekleyen] = useState(0);
  const [isSayisi, setIsSayisi] = useState(0);
  const erisim = useProjeErisimi();
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

  // Tamamlanacak işlerin acil + dikkat sayısı (eksik bilgi sayılmaz); ekran değiştikçe tazelenir (en sık 20 sn'de bir;
  // Yapılacaklar ve Bugün ekranında her zaman).
  const sonHesap = useRef(0);
  useEffect(() => {
    if (Date.now() - sonHesap.current < 20_000 && aktif !== 'yapilacaklar' && aktif !== 'bugun') return;
    sonHesap.current = Date.now();
    let iptal = false;
    void (async () => {
      const bugun = yerelGun(new Date());
      const g = gizlemeyiTemizle((await depo.metaGetir<GizlemeListesi>(META_YAPILACAK_GIZLEME)) ?? {}, bugun);
      const n = rozetSayisi(await yapilacaklariGetir(depo, firma, bugun, erisim, yetkiRef.current, g, { kullaniciId: oturum.kullaniciId, rol: kullanici.rol ?? 'santiye' }));
      if (!iptal) setIsSayisi(n);
    })().catch(() => undefined);
    return () => {
      iptal = true;
    };
  }, [depo, firma, erisim, aktif, oturum.kullaniciId, kullanici.rol]);

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
  const rozet = (yol: string) =>
    yol === 'havuz' && bekleyen > 0 ? (
      <span className="menu-rozet">{bekleyen}</span>
    ) : yol === 'yapilacaklar' && isSayisi > 0 ? (
      <span className="menu-rozet">{isSayisi}</span>
    ) : null;
  const bulutSimgesi = bulut.durum.tur !== 'bagli_degil' && (
    <a href="#/ayarlar" className={`bulut-simge bulut-${bulut.durum.tur}`} title={durumMetni(bulut.durum)} aria-label={durumMetni(bulut.durum)}>
      <Simge ad="bulut" boyut={18} />
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
          <Simge ad="ekle" boyut={18} /> Yeni kayıt
        </a>
        <nav>
          {YAN_MENU.filter(gorunen).map((m) => (
            <a key={m.yol} href={`#/${m.yol}`} aria-current={aktif === m.yol ? 'page' : undefined}>
              <Simge ad={m.simge} boyut={20} />
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
            <Simge ad="ara" boyut={22} />
          </a>
          {isSayisi > 0 && (
            <a href="#/yapilacaklar" className="ust-rozet" aria-label={`${isSayisi} iş tamamlanmayı bekliyor`} title="Tamamlanacak işler">
              <Simge ad="yapilacak" boyut={22} />
              <span>{isSayisi}</span>
            </a>
          )}
          {bekleyen > 0 && (
            <a href="#/havuz" className="ust-rozet" aria-label={`${bekleyen} belge onay bekliyor`} title="Onay bekleyen belgeler">
              <Simge ad="belge" boyut={22} />
              <span>{bekleyen}</span>
            </a>
          )}
          <a href="#/ayarlar" aria-label="Ayarlar" title="Ayarlar">
            <Simge ad="ayar" boyut={22} />
          </a>
        </span>
      </header>

      <main className={`sayfa${genis ? ' sayfa-genis' : ''}`}>
        {/* Kendi geri bağlantısı olmayan alt ekranlarda (ana menü ekranları hariç) genel "Geri"; uygulama penceresinde tarayıcı geri tuşu yok. */}
        {yol.length >= 2 && yol[0] !== 'ara' && !(yol[0] === 'maliyet' && yol[1] === 'fiyatlar') && (
          <button type="button" className="genel-geri baglanti-dugmesi" onClick={() => geriGit(yol[0] === 'projeler' && yol.length > 2 ? `projeler/${yol[1]}` : yol[0]!)}>
            ← Geri
          </button>
        )}
        {children}
      </main>

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
            <span aria-hidden="true">
              <Simge ad={m.simge} boyut={m.yol === 'kayit' ? 22 : 24} />
            </span>
            {m.ad}
          </a>
        ))}
      </nav>
    </div>
  );
}
