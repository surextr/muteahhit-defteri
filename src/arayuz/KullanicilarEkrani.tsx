import { tlOku, tutarMetni } from '../hesap/para';
import { TutarGirdisi } from './Girdiler';
import { VARSAYILAN_ONAY_AKISI } from '../hesap/onay';
import { onayAkisiKaydet } from '../servisler/onay';
import type { OnayAkisiAyari } from '../veri/tipler';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  kullaniciEkle,
  kullaniciGuncelle,
  kullanicilariListele,
  ekKisitlariKaydet,
  projeleriDegistir,
  rolDegistir,
  rolYetkileriniKaydet,
  ROL_ACIKLAMASI,
  ROL_ADI,
  ROLLER,
  uyelikIptal,
  type KullaniciSatiri,
} from '../servisler/kullanici';
import { cihazKullanicisiniDegistir } from '../servisler/kurulum';
import { projeleriListele } from '../servisler/proje';
import type { Rol } from '../veri/tipler';
import { rolYetkileri, YETKILER, type AyarlanabilirRol, type Yetki } from '../hesap/yetki';
import { useUygulama, useYetki } from './baglam';
import { DavetAlani, useBagliHesaplar } from './Bulut';
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

/** Kişinin girebileceği projeler: hepsi ya da seçilenler (isteğe bağlı kısıt). */
function ProjeSecimi(props: { projeler: { id: string; ad: string }[]; secili: string[] | null; onDegisti: (p: string[] | null) => void }) {
  const ad = useId();
  const hepsi = props.secili === null;
  return (
    <fieldset className="secenekler secenekler-dikey">
      <legend>Projeler</legend>
      <label>
        <input type="radio" name={ad} checked={hepsi} onChange={() => props.onDegisti(null)} /> Bütün projeler
      </label>
      <label>
        <input type="radio" name={ad} checked={!hepsi} onChange={() => props.onDegisti(props.projeler.slice(0, 1).map((p) => p.id))} /> Yalnız
        seçilen projeler
      </label>
      {!hepsi &&
        props.projeler.map((p) => (
          <label key={p.id} className="alt-secenek">
            <input
              type="checkbox"
              checked={props.secili!.includes(p.id)}
              onChange={(e) => props.onDegisti(e.target.checked ? [...props.secili!, p.id] : props.secili!.filter((x) => x !== p.id))}
            />{' '}
            {p.ad}
          </label>
        ))}
      {!hepsi && <small className="soluk">Seçilmeyen projeleri göremez ve kayıt giremez.</small>}
    </fieldset>
  );
}

function KullaniciKarti({
  satir,
  onDegisti,
  hesap,
  onHesapDegisti,
  projeler,
}: {
  satir: KullaniciSatiri;
  onDegisti: () => Promise<void>;
  /** Bulut bağlıyken (yöneticide) kişinin bağlı giriş hesabı: undefined: gösterilmez. */
  hesap: string | null | undefined;
  onHesapDegisti: () => void;
  projeler: { id: string; ad: string }[];
}) {
  const { depo, oturum, servis, yenile, bulut } = useUygulama();
  const yetki = useYetki();
  const bagli = bulut.durum.tur !== 'bagli_degil';
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const { kullanici, uyelik } = satir;
  const ben = kullanici.id === oturum.kullaniciId;
  const [acik, setAcik] = useState(false);
  const [form, setForm] = useState({ ad: kullanici.ad, eposta: kullanici.eposta ?? '', rol: uyelik.rol, projeIdleri: uyelik.projeIdleri });
  const [soru, setSoru] = useState<'gec' | 'cikar' | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);

  function kaydet() {
    setHatalar([]);
    const bilgiDegisti = form.ad.trim() !== kullanici.ad || (form.eposta.trim() || null) !== kullanici.eposta;
    const rolDegisti = form.rol !== uyelik.rol;
    const projeDegisti = JSON.stringify(form.projeIdleri) !== JSON.stringify(uyelik.projeIdleri);
    if (!bilgiDegisti && !rolDegisti && !projeDegisti) return setAcik(false);
    // Gerekçe kuralı üyelik kaydına göre sorulur; aynı gerekçe iki değişikliğe de yazılır.
    void degistir(`${kullanici.ad} değişiyor`, async (g) => {
      if (bilgiDegisti) await kullaniciGuncelle(depo, servis, kullanici.id, { ad: form.ad, eposta: form.eposta }, g);
      if (rolDegisti) await rolDegistir(depo, servis, uyelik.id, form.rol, g);
      if (projeDegisti) await projeleriDegistir(depo, servis, uyelik.id, form.projeIdleri);
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
            {uyelik.rol !== 'yonetici' && uyelik.projeIdleri && ` · ${uyelik.projeIdleri.length} proje`}
            {kullanici.eposta && ` · ${kullanici.eposta}`}
          </div>
        </div>
        {!acik && yetki('yonetici') && (
          <button type="button" className="ikincil" onClick={() => setAcik(true)}>
            Düzenle
          </button>
        )}
      </div>
      {hesap !== undefined && <DavetAlani kullaniciId={kullanici.id} ben={ben} hesap={hesap} onDegisti={onHesapDegisti} />}

      {acik && (
        <div className="kalem-formu">
          <Alan etiket="Ad soyad">
            <input value={form.ad} onChange={(e) => setForm({ ...form, ad: e.target.value })} />
          </Alan>
          <Alan etiket="E-posta" aciklama="Bulut aşamasında giriş için kullanılacak.">
            <input type="email" value={form.eposta} onChange={(e) => setForm({ ...form, eposta: e.target.value })} />
          </Alan>
          <RolSecimi rol={form.rol} onSec={(rol) => setForm({ ...form, rol })} />
          {form.rol !== 'yonetici' && (
            <ProjeSecimi projeler={projeler} secili={form.projeIdleri} onDegisti={(projeIdleri) => setForm({ ...form, projeIdleri })} />
          )}
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

      {!acik && !ben && yetki('yonetici') && (
        <>
          <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
          {kutu}
          {soru === 'gec' && (
            <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="Kullanıcı değiştirme">
              <p>
                Bu cihazda bundan sonraki kayıtlar <strong>{kullanici.ad}</strong> adına yazılacak. Şifre yoktur; giriş bulut aşamasında gelecek.
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
              {!bagli && (
                <button type="button" className="ikincil" onClick={() => setSoru('gec')}>
                  Bu cihazda bu kişi olarak devam et
                </button>
              )}
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
  const yetki = useYetki();
  const [hesaplar, hesaplariYenile] = useBagliHesaplar();
  const [projeler, setProjeler] = useState<{ id: string; ad: string }[]>([]);
  useEffect(() => {
    void projeleriListele(depo, oturum.firmaId).then((l) => setProjeler(l.map((x) => ({ id: x.proje.id, ad: x.proje.ad }))));
  }, [depo, oturum.firmaId]);
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
        <a className="geri-baglanti" href="#/ayarlar">← Ayarlar</a>
      </p>
      <h1>Kullanıcılar ve roller</h1>
      <p className="mesaj mesaj-not">
        Yönetici her şeyi yapar. Muhasebe ve şantiyenin neleri görüp girebileceğini aşağıdaki "Rol yetkileri"nden seçin. Bulut eşitlemesinde sunucu da aynı
        yetkilerle denetler.
      </p>

      {liste === null && <p>Yükleniyor…</p>}
      <ul className="kart-listesi">
        {liste?.map((s) => (
          <KullaniciKarti
            key={s.uyelik.id}
            satir={s}
            onDegisti={yenileListe}
            hesap={hesaplar ? (hesaplar.get(s.kullanici.id) ?? null) : undefined}
            onHesapDegisti={hesaplariYenile}
            projeler={projeler}
          />
        ))}
      </ul>

      <RolYetkileriKarti />

      <EkKisitlarKarti />

      <OnayAkisiKarti />

      {yetki('yonetici') && (
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
      )}
    </>
  );
}

/** Muhasebe ve şantiye rollerinin yetkileri; yalnız yönetici değiştirir. */
function RolYetkileriKarti() {
  const { firma, servis, yenile } = useUygulama();
  const yetki = useYetki();
  const yonetici = yetki('yonetici');
  const [hata, setHata] = useState<string | null>(null);

  async function degistir(rol: AyarlanabilirRol, kod: Yetki, acik: boolean) {
    setHata(null);
    const simdiki = [...rolYetkileri(firma.ayarlar, rol)];
    try {
      await rolYetkileriniKaydet(servis, firma, rol, acik ? [...simdiki, kod] : simdiki.filter((k) => k !== kod));
      await yenile();
    } catch (e) {
      setHata(hataMetni(e));
    }
  }

  const roller: AyarlanabilirRol[] = ['muhasebe', 'santiye'];
  return (
    <section className="kart liste-arasi">
      <h2>Rol yetkileri</h2>
      <p className="soluk">{yonetici ? 'İşaretli olanları o roldeki herkes görür ve girer.' : 'Yalnız yönetici değiştirebilir.'}</p>
      <table className="yetki-tablosu">
        <thead>
          <tr>
            <th>Yetki</th>
            {roller.map((r) => (
              <th key={r}>{ROL_ADI[r]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {YETKILER.map((y) => (
            <tr key={y.kod}>
              <td>
                {y.ad}
                <small className="blok soluk">{y.aciklama}</small>
              </td>
              {roller.map((r) => (
                <td key={r}>
                  <input
                    type="checkbox"
                    aria-label={`${ROL_ADI[r]}: ${y.ad}`}
                    checked={rolYetkileri(firma.ayarlar, r).has(y.kod)}
                    disabled={!yonetici}
                    onChange={(e) => void degistir(r, y.kod, e.target.checked)}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mesaj-not">Kullanıcı ekleme, roller ve firma ayarları yalnız yöneticidedir.</p>
      <Hatalar hatalar={hata ? [hata] : []} />
    </section>
  );
}

/** İsteğe bağlı ek kısıtlar: varsayılan kapalı; yalnız yönetici değiştirir, yöneticiye uygulanmaz. */
function EkKisitlarKarti() {
  const { firma, servis, yenile } = useUygulama();
  const yetki = useYetki();
  const yonetici = yetki('yonetici');
  const k = firma.ayarlar.kisitlar ?? {};
  const [hata, setHata] = useState<string | null>(null);

  async function degistir(alan: 'gorme' | 'sunucuKurallari', acik: boolean) {
    setHata(null);
    try {
      await ekKisitlariKaydet(servis, firma, { [alan]: acik });
      await yenile();
    } catch (e) {
      setHata(hataMetni(e));
    }
  }

  return (
    <section className="kart liste-arasi">
      <h2>Ek kısıtlar (isteğe bağlı)</h2>
      <p className="soluk">Kapalıyken yetkiler yalnız ekranda ve kayıt girişinde uygulanır. Yöneticiye hiçbiri uygulanmaz.</p>
      <label className="kisit-secenegi">
        <input type="checkbox" checked={!!k.gorme} disabled={!yonetici} onChange={(e) => void degistir('gorme', e.target.checked)} />
        <span>
          <strong>Yetkisiz kayıtlar cihaza inmesin</strong>
          <span className="soluk blok">
            Bulutta kişinin yetkisi olmayan kayıtlar (örn. şantiyede satışlar, transferler, çekler) ve kısıtlı projeler dışındaki kayıtlar onun telefonuna
            hiç gönderilmez. Önceden inmiş kayıtlar telefonda kalır.
          </span>
        </span>
      </label>
      <label className="kisit-secenegi">
        <input type="checkbox" checked={!!k.sunucuKurallari} disabled={!yonetici} onChange={(e) => void degistir('sunucuKurallari', e.target.checked)} />
        <span>
          <strong>Sunucu iş kurallarını da denetlesin</strong>
          <span className="soluk blok">
            Uygulama dışından gelen isteklere karşı: kaydı oluşturan değiştirilemez, kayıt yalnız yazanın adıyla girilir, onay kaldırılamaz, hakedişten oluşan
            gidere yalnız sözleşme yetkisi olan dokunur.
          </span>
        </span>
      </label>
      <p className="mesaj-not">Kişi başı proje kısıtı her kullanıcının "Düzenle" ekranından seçilir; sunucu da denetler.</p>
      <Hatalar hatalar={hata ? [hata] : []} />
    </section>
  );
}

/** Ödeme ve hakediş onay akışı (isteğe bağlı, tutar eşiğiyle). */
function OnayAkisiKarti() {
  const { firma, depo, servis, yenile } = useUygulama();
  const yetki = useYetki();
  const yonetici = yetki('yonetici');
  const ilk = firma.ayarlar.onayAkisi ?? VARSAYILAN_ONAY_AKISI;
  const [a, setA] = useState<OnayAkisiAyari>(ilk);
  const [esik, setEsik] = useState(tutarMetni(ilk.esik));
  const [hata, setHata] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const degisti = JSON.stringify({ ...a, esik: tlOku(esik) }) !== JSON.stringify(ilk);

  async function kaydet() {
    setHata(null);
    setMesaj(null);
    const e = tlOku(esik);
    if (e === null) return setHata('Tutar eşiğini yazın.');
    try {
      await onayAkisiKaydet(depo, servis, { ...a, esik: e });
      await yenile();
      setMesaj('Kaydedildi.');
    } catch (x) {
      setHata(hataMetni(x));
    }
  }

  return (
    <section className="kart liste-arasi">
      <h2>Onay akışı (isteğe bağlı)</h2>
      <p className="soluk">
        Açıksa eşik ve üstündeki ödemeyi yönetici dışındaki kişi doğrudan yapamaz: talimat olarak gönderir, yönetici onaylayınca ödeme yapılır. Eşik üstü
        hakedişi yalnız yönetici onaylar. Yöneticinin kendi ödemeleri doğrudan geçer; dekonttan, banka dosyasından ve çekle yapılan ödemeler akışa girmez.
      </p>
      <label className="kisit-secenegi">
        <input type="checkbox" checked={a.acik} disabled={!yonetici} onChange={(e) => setA({ ...a, acik: e.target.checked })} />
        <span>
          <strong>Onay akışını aç</strong>
        </span>
      </label>
      {a.acik && (
        <>
          <Alan etiket="Tutar eşiği (KDV dahil)" aciklama="Bu tutar ve üstü onaydan geçer; 0 yazılırsa her tutar.">
            <TutarGirdisi value={esik} disabled={!yonetici} onChange={setEsik} />
          </Alan>
          <label className="kisit-secenegi">
            <input type="checkbox" checked={a.odeme} disabled={!yonetici} onChange={(e) => setA({ ...a, odeme: e.target.checked })} />
            <span>
              <strong>Ödemeler</strong>
              <span className="soluk blok">Cariye ödeme ve carili peşin gider.</span>
            </span>
          </label>
          <label className="kisit-secenegi">
            <input type="checkbox" checked={a.hakedis} disabled={!yonetici} onChange={(e) => setA({ ...a, hakedis: e.target.checked })} />
            <span>
              <strong>Hakedişler</strong>
              <span className="soluk blok">Şantiye hazırlar, yönetici onaylar (onayla borç ve maliyet yazılır).</span>
            </span>
          </label>
          <label className="kisit-secenegi">
            <input type="checkbox" checked={a.kontrol} disabled={!yonetici} onChange={(e) => setA({ ...a, kontrol: e.target.checked })} />
            <span>
              <strong>Önce muhasebe kontrol etsin</strong>
              <span className="soluk blok">Yönetici, muhasebe rolünden biri "Kontrol ettim" demeden onaylayamaz. Hazırlayan kendi kaydını kontrol edemez.</span>
            </span>
          </label>
        </>
      )}
      {yonetici && (
        <div className="dugmeler">
          <button type="button" disabled={!degisti} onClick={() => void kaydet()}>
            Kaydet
          </button>
          <a className="dugme ikincil" href="#/onaylar">
            Onaylar ekranı
          </a>
        </div>
      )}
      {mesaj && <p className="mesaj mesaj-basari">{mesaj}</p>}
      <Hatalar hatalar={hata ? [hata] : []} />
    </section>
  );
}
