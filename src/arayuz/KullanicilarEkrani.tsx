import { useCallback, useEffect, useId, useState } from 'react';
import {
  kullaniciEkle,
  kullaniciGuncelle,
  kullanicilariListele,
  rolDegistir,
  ROL_ACIKLAMASI,
  ROL_ADI,
  ROLLER,
  uyelikIptal,
  type KullaniciSatiri,
} from '../servisler/kullanici';
import { cihazKullanicisiniDegistir } from '../servisler/kurulum';
import type { Rol } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';

function RolSecimi({ rol, onSec }: { rol: Rol; onSec: (r: Rol) => void }) {
  // Aynı ekranda birden çok form açık olabilir; her grubun adı ayrı olmalı.
  const ad = useId();
  return (
    <fieldset className="secenekler secenekler-dikey">
      <legend>Rol</legend>
      {ROLLER.map((r) => (
        <label key={r} className="rol-secenegi">
          <input type="radio" name={ad} checked={rol === r} onChange={() => onSec(r)} />
          <span>
            <strong>{ROL_ADI[r]}</strong>
            <span className="soluk blok">{ROL_ACIKLAMASI[r]}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function KullaniciKarti({ satir, onDegisti }: { satir: KullaniciSatiri; onDegisti: () => Promise<void> }) {
  const { depo, oturum, servis, yenile } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const { kullanici, uyelik } = satir;
  const ben = kullanici.id === oturum.kullaniciId;
  const [acik, setAcik] = useState(false);
  const [form, setForm] = useState({ ad: kullanici.ad, eposta: kullanici.eposta ?? '', rol: uyelik.rol });
  const [soru, setSoru] = useState<'gec' | 'cikar' | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);

  function kaydet() {
    setHatalar([]);
    const bilgiDegisti = form.ad.trim() !== kullanici.ad || (form.eposta.trim() || null) !== kullanici.eposta;
    const rolDegisti = form.rol !== uyelik.rol;
    if (!bilgiDegisti && !rolDegisti) return setAcik(false);
    // Gerekçe kuralı üyelik kaydına göre sorulur; aynı gerekçe iki değişikliğe de yazılır.
    void degistir(`${kullanici.ad} değişiyor`, async (g) => {
      if (bilgiDegisti) await kullaniciGuncelle(depo, servis, kullanici.id, { ad: form.ad, eposta: form.eposta }, g);
      if (rolDegisti) await rolDegistir(depo, servis, uyelik.id, form.rol, g);
      setAcik(false);
      await onDegisti();
      if (ben) await yenile();
    });
  }

  async function bununlaDevamEt() {
    try {
      await cihazKullanicisiniDegistir(depo, oturum.firmaId, kullanici.id);
      await yenile();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <li className="kart">
      <div className="baslik-satiri">
        <div>
          <strong>{kullanici.ad}</strong>
          {ben && <span className="etiket-cip">bu cihazda</span>}
          <div className="soluk">
            {ROL_ADI[uyelik.rol]}
            {kullanici.eposta && ` · ${kullanici.eposta}`}
          </div>
        </div>
        {!acik && (
          <button type="button" className="ikincil" onClick={() => setAcik(true)}>
            Düzenle
          </button>
        )}
      </div>

      {acik && (
        <div className="kalem-formu">
          <Alan etiket="Ad soyad">
            <input value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} />
          </Alan>
          <Alan etiket="E-posta" aciklama="Bulut aşamasında giriş için kullanılacak.">
            <input type="email" value={form.eposta} onChange={(e) => setForm({ ...form, eposta: e.target.value })} />
          </Alan>
          <RolSecimi rol={form.rol} onSec={(rol) => setForm({ ...form, rol })} />
          {kutu}
          <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={kaydet}>
              Kaydet
            </button>
            <button type="button" className="ikincil" onClick={() => setAcik(false)}>
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {!acik && !ben && (
        <>
          <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
          {kutu}
          {soru === 'gec' && (
            <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="Kullanıcı değiştirme">
              <p>
                Bu cihazda bundan sonraki kayıtlar <strong>{kullanici.ad}</strong> adına yazılacak. Şifre yoktur; giriş bulut aşamasında
                gelecek.
              </p>
              <div className="dugmeler">
                <button type="button" onClick={() => void bununlaDevamEt()}>
                  {kullanici.ad} olarak devam et
                </button>
                <button type="button" className="ikincil" onClick={() => setSoru(null)}>
                  Vazgeç
                </button>
              </div>
            </div>
          )}
          {soru === 'cikar' && (
            <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="Kullanıcıyı çıkarma">
              <p>{kullanici.ad} firmadan çıkarılsın mı? Girdiği kayıtlar ve geçmişteki adı olduğu gibi kalır.</p>
              <div className="dugmeler">
                <button
                  type="button"
                  className="tehlikeli"
                  onClick={() => {
                    setSoru(null);
                    void degistir(`${kullanici.ad} çıkarılıyor`, async (g) => {
                      await uyelikIptal(depo, servis, uyelik.id, g);
                      await onDegisti();
                    });
                  }}
                >
                  Evet, çıkar
                </button>
                <button type="button" className="ikincil" onClick={() => setSoru(null)}>
                  Hayır
                </button>
              </div>
            </div>
          )}
          {soru === null && (
            <div className="dugmeler">
              <button type="button" className="ikincil" onClick={() => setSoru('gec')}>
                Bu cihazda bu kişi olarak devam et
              </button>
              <button type="button" className="baglanti-dugmesi" onClick={() => setSoru('cikar')}>
                Firmadan çıkar
              </button>
            </div>
          )}
        </>
      )}
    </li>
  );
}

export function KullanicilarEkrani() {
  const { depo, oturum, servis } = useUygulama();
  const [liste, setListe] = useState<KullaniciSatiri[] | null>(null);
  const [yeni, setYeni] = useState<{ ad: string; eposta: string; rol: Rol } | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);

  const yenileListe = useCallback(async () => setListe(await kullanicilariListele(depo, oturum.firmaId)), [depo, oturum.firmaId]);

  useEffect(() => {
    void yenileListe();
  }, [yenileListe]);

  async function ekle() {
    if (!yeni) return;
    setHatalar([]);
    try {
      await kullaniciEkle(depo, servis, { ad: yeni.ad, eposta: yeni.eposta }, yeni.rol);
      setYeni(null);
      await yenileListe();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <>
      <p>
        <a href="#/ayarlar">← Ayarlar</a>
      </p>
      <h1>Kullanıcılar ve roller</h1>
      <p className="mesaj mesaj-not">
        Veriler şimdilik yalnızca bu cihazda. Roller, işlem geçmişinde kimin ne yaptığını ayırt etmek içindir; kim neyi görebilir
        kısıtı bulut aşamasında girişle birlikte uygulanacak.
      </p>

      {liste === null && <p>Yükleniyor…</p>}
      <ul className="kart-listesi">
        {liste?.map((s) => <KullaniciKarti key={s.uyelik.id} satir={s} onDegisti={yenileListe} />)}
      </ul>

      <section className="kart liste-arasi">
        {yeni ? (
          <>
            <h2>Kullanıcı ekle</h2>
            <Alan etiket="Ad soyad">
              <input value={yeni.ad} onChange={(e) => setYeni({ ...yeni, ad: e.target.value })} autoFocus />
            </Alan>
            <Alan etiket="E-posta" aciklama="İsteğe bağlı.">
              <input type="email" value={yeni.eposta} onChange={(e) => setYeni({ ...yeni, eposta: e.target.value })} />
            </Alan>
            <RolSecimi rol={yeni.rol} onSec={(rol) => setYeni({ ...yeni, rol })} />
            <Hatalar hatalar={hatalar} />
            <div className="dugmeler">
              <button type="button" onClick={() => void ekle()}>
                Ekle
              </button>
              <button type="button" className="ikincil" onClick={() => setYeni(null)}>
                Vazgeç
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="ikincil genis" onClick={() => setYeni({ ad: '', eposta: '', rol: 'santiye' })}>
            + Kullanıcı ekle
          </button>
        )}
      </section>
    </>
  );
}
