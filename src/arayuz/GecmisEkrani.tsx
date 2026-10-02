import { useEffect, useState } from 'react';
import { firmaGecmisiGetir, type GecmisSayfasi, type GecmisSuzgeci } from '../servisler/gecmis';
import { kullanicilariListele, type KullaniciSatiri } from '../servisler/kullanici';
import type { IslemTuru } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan } from './bilesenler';
import { farklar, GENEL_BICIM, genelDeger, ISLEM_ADI } from './GecmisListesi';

const SAYFA = 50;

type Gorunum = 'hepsi' | 'iptal' | 'guncelle' | 'olustur';

const GORUNUM: Record<Gorunum, { ad: string; islemler?: IslemTuru[] }> = {
  hepsi: { ad: 'Tümü' },
  iptal: { ad: 'İptaller', islemler: ['iptal'] },
  guncelle: { ad: 'Değişiklikler', islemler: ['guncelle', 'onayla'] },
  olustur: { ad: 'Yeni kayıtlar', islemler: ['olustur'] },
};

const yaz = (alan: string, d: unknown) => GENEL_BICIM.degerYaz?.(alan, d) ?? genelDeger(d);

/**
 * Firmanın bütün işlem geçmişi: kim, ne zaman, hangi kaydı, neden değiştirdi ya da iptal etti.
 * Kayıtlar silinmez; iptal edilenler de burada izlenir.
 */
export function GecmisEkrani() {
  const { depo, oturum } = useUygulama();
  const [kullanicilar, setKullanicilar] = useState<KullaniciSatiri[]>([]);
  const [gorunum, setGorunum] = useState<Gorunum>('hepsi');
  const [suzgec, setSuzgec] = useState<Omit<GecmisSuzgeci, 'islemler'>>({ yalnizcaAnaKayitlar: true });
  const [sinir, setSinir] = useState(SAYFA);
  const [sayfa, setSayfa] = useState<GecmisSayfasi | null>(null);

  useEffect(() => {
    void kullanicilariListele(depo, oturum.firmaId).then(setKullanicilar);
  }, [depo, oturum.firmaId]);

  useEffect(() => {
    let iptal = false;
    void firmaGecmisiGetir(depo, oturum.firmaId, { ...suzgec, islemler: GORUNUM[gorunum].islemler }, sinir).then((s) => {
      if (!iptal) setSayfa(s);
    });
    return () => {
      iptal = true;
    };
  }, [depo, oturum.firmaId, gorunum, suzgec, sinir]);

  const degistir = (ek: Partial<GecmisSuzgeci>) => {
    setSinir(SAYFA);
    setSuzgec((s) => ({ ...s, ...ek }));
  };

  return (
    <>
      <p>
        <a href="#/ayarlar">← Ayarlar</a>
      </p>
      <h1>İşlem geçmişi</h1>
      <p className="soluk">Kayıtlar silinmez. Her ekleme, değişiklik ve iptal; kimin yaptığı, ne zaman ve gerekçesiyle burada durur.</p>

      <div className="filtreler" role="group" aria-label="İşlem türü">
        {(Object.keys(GORUNUM) as Gorunum[]).map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={gorunum === g}
            onClick={() => {
              setSinir(SAYFA);
              setGorunum(g);
            }}
          >
            {GORUNUM[g].ad}
          </button>
        ))}
      </div>

      <details className="kart suzgec-karti">
        <summary>Süzgeç</summary>
        <Alan etiket="Kim yaptı">
          <select value={suzgec.kullaniciId ?? ''} onChange={(e) => degistir({ kullaniciId: e.target.value || undefined })}>
            <option value="">Herkes</option>
            {kullanicilar.map(({ kullanici }) => (
              <option key={kullanici.id} value={kullanici.id}>
                {kullanici.ad}
              </option>
            ))}
          </select>
        </Alan>
        <div className="iki-sutun">
          <Alan etiket="Başlangıç">
            <input type="date" value={suzgec.baslangic ?? ''} onChange={(e) => degistir({ baslangic: e.target.value || undefined })} />
          </Alan>
          <Alan etiket="Bitiş">
            <input type="date" value={suzgec.bitis ?? ''} onChange={(e) => degistir({ bitis: e.target.value || undefined })} />
          </Alan>
        </div>
        <label className="onay-kutusu">
          <input type="checkbox" checked={!!suzgec.yalnizcaGerekceli} onChange={(e) => degistir({ yalnizcaGerekceli: e.target.checked })} />
          Yalnızca gerekçe yazılanlar
        </label>
        <label className="onay-kutusu">
          <input
            type="checkbox"
            checked={!suzgec.yalnizcaAnaKayitlar}
            onChange={(e) => degistir({ yalnizcaAnaKayitlar: !e.target.checked })}
          />
          Bağlı kayıtları da göster (gider satırı, eşleştirme, çek hareketi…)
        </label>
      </details>

      {sayfa === null && <p>Yükleniyor…</p>}
      {sayfa && (
        <p className="mesaj-not">
          {sayfa.toplam === 0 ? 'Süzgece uyan kayıt yok.' : `${sayfa.toplam} işlem${sayfa.toplam > sayfa.satirlar.length ? `, en yeni ${sayfa.satirlar.length} tanesi` : ''}`}
        </p>
      )}

      <ol className="kart-listesi gecmis-akisi">
        {sayfa?.satirlar.map(({ islem, kullaniciAdi, etiket }) => {
          const degisen = islem.islem === 'guncelle' ? farklar(islem.eski ?? {}, islem.yeni ?? {}) : [];
          return (
            <li key={islem.id} className={`kart gecmis-${islem.islem}`}>
              <div className="baslik-satiri">
                <strong>
                  {etiket.turAdi} · {ISLEM_ADI[islem.islem]}
                </strong>
                <span className="soluk kucuk">{new Date(islem.zaman).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div>
                {etiket.yol ? <a href={`#/${etiket.yol}`}>{etiket.ozet ?? 'Kaydı aç'}</a> : (etiket.ozet ?? <span className="soluk">—</span>)}
                {etiket.iptalEdildi && <span className="etiket-cip etiket-iptal">iptal edilmiş kayıt</span>}
              </div>
              {degisen.length > 0 && (
                <ul className="degisenler">
                  {degisen.map(([alan, e, y]) => (
                    <li key={alan}>
                      {GENEL_BICIM.etiketler[alan] ?? alan}: <del>{yaz(alan, e)}</del> → <ins>{yaz(alan, y)}</ins>
                    </li>
                  ))}
                </ul>
              )}
              {islem.gerekce && <p className="gerekce">Gerekçe: {islem.gerekce}</p>}
              <p className="soluk kucuk">{kullaniciAdi}</p>
            </li>
          );
        })}
      </ol>
      {sayfa && sayfa.toplam > sayfa.satirlar.length && (
        <button type="button" className="ikincil genis" onClick={() => setSinir((s) => s + SAYFA)}>
          Daha eski {Math.min(SAYFA, sayfa.toplam - sayfa.satirlar.length)} işlemi göster
        </button>
      )}
    </>
  );
}
