import { yazdir } from '../cihaz/paylas';
import { Simge } from './Simge';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cihaz } from '../cihaz';
import { aylaraGore, cekimTarihiBul, exifOku, konumdanProje, konumMetniCoz, mesafeKm, SANTIYE_YARICAPI_KM, type ExifBilgisi, type Konum, type TarihKaynagi } from '../hesap/fotograf';
import { ayAdi } from '../hesap/karZarar';
import { yerelGun } from '../hesap/tarih';
import {
  fotografDosyasi,
  fotografEkle,
  fotografGuncelle,
  fotografIptal,
  fotografSecenekleri,
  havuzdanFotograf,
  projeFotograflari,
  type FotografBilgisi,
  type FotografSatiri,
  type FotografSecenekleri,
} from '../servisler/fotograf';
import { havuzSatiriGetir } from '../servisler/havuz';
import { projeKonumuKaydet, projeleriListele } from '../servisler/proje';
import type { Proje } from '../veri/tipler';
import { useProjeErisimi, useUygulama, useYetki } from './baglam';
import { Alan, BosDurum, Hatalar, hataMetni } from './bilesenler';
import { git } from './rota';

// Şantiye fotoğrafları: yükleme (çekim tarihi fotoğraftan / dosya adından / elle, konumdan proje), proje sekmesi
// (aylara göre ızgara, süzgeç, tam ekran), şantiye konumu, fotoğraflı ilerleme raporu.

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const KAYNAK_METNI: Record<TarihKaynagi, string> = { exif: 'fotoğraftan alındı', dosyaAdi: 'dosya adından alındı', elle: 'elle girildi' };

const dataUrl = (b: Blob) =>
  new Promise<string>((coz, red) => {
    const r = new FileReader();
    r.onload = () => coz(String(r.result));
    r.onerror = () => red(new Error('Dosya okunamadı.'));
    r.readAsDataURL(b);
  });

/** Varsayılan aşama: süren ilk aşama, yoksa başlamamış ilk aşama (tamamlananlardan sonraki). */
const varsayilanAsama = (s: FotografSecenekleri) => (s.asamalar.find((a) => a.durum === 'devam') ?? s.asamalar.find((a) => a.durum === 'baslamadi'))?.id ?? '';

export const fotografYazabilir = (yetki: (y: 'belge' | 'ilerleme' | 'proje') => boolean) => yetki('belge') || yetki('ilerleme') || yetki('proje');

// ─── Yükleme ──────────────────────────────────────────────────────

interface Taslak {
  anahtar: string;
  dosyaAdi: string;
  dosya: Blob;
  kucukResim: string;
  exif: ExifBilgisi;
  tarih: string;
  zaman: string | null;
  kaynak: TarihKaynagi;
  projeId: string;
  /** Konumdan önerilen proje (kullanıcı değiştirdiyse farklı olabilir). */
  oneriProjeId: string | null;
  aciklama: string;
}

/** EXIF küçültmeden önce okunur (küçültme siler); fotoğraf 1600 px'e, küçük resim 360 px'e indirilir. */
async function taslakHazirla(dosya: File): Promise<Omit<Taslak, 'projeId' | 'oneriProjeId'>> {
  const exif = exifOku(new Uint8Array(await dosya.slice(0, 512 * 1024).arrayBuffer()));
  const t = cekimTarihiBul(exif, dosya.name);
  const buyuk = await cihaz.resimKucult(dosya, 1600, 0.8);
  const kucuk = await cihaz.resimKucult(dosya, 360, 0.7);
  // Tarayıcının açamadığı biçimde (HEIC) küçük resim üretilemez; liste yer tutucu gösterir.
  const kucukResim = kucuk.type === 'image/jpeg' && kucuk.size < 150_000 ? await dataUrl(kucuk) : '';
  return {
    anahtar: `${dosya.name}-${dosya.size}-${Math.random()}`,
    dosyaAdi: dosya.name,
    dosya: buyuk,
    kucukResim,
    exif,
    tarih: t.tarih ?? '',
    zaman: t.zaman,
    kaynak: t.kaynak,
    aciklama: '',
  };
}

interface Ortak {
  takipBasligiId: string;
  kalemId: string;
  blokId: string;
  katId: string;
  aciklama: string;
}

export function FotografYukle({ projeId: ilkProje }: { projeId?: string }) {
  const { depo, servis, oturum } = useUygulama();
  const erisim = useProjeErisimi();
  const [projeler, setProjeler] = useState<Pick<Proje, 'id' | 'ad' | 'konum'>[] | null>(null);
  const [anaProje, setAnaProje] = useState(ilkProje ?? '');
  const [secenek, setSecenek] = useState<FotografSecenekleri | null>(null);
  const [taslaklar, setTaslaklar] = useState<Taslak[]>([]);
  const [hazirlaniyor, setHazirlaniyor] = useState(0);
  const [ortak, setOrtak] = useState<Ortak>({ takipBasligiId: '', kalemId: '', blokId: '', katId: '', aciklama: '' });
  const [kalemAcik, setKalemAcik] = useState(false);
  const [topluTarih, setTopluTarih] = useState('');
  const [kayit, setKayit] = useState<{ yapilan: number; toplam: number } | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const kamera = useRef<HTMLInputElement>(null);
  const galeri = useRef<HTMLInputElement>(null);
  const bugun = yerelGun(new Date());

  useEffect(() => {
    void Promise.all([projeleriListele(depo, oturum.firmaId, erisim), depo.listele('proje', { firmaId: oturum.firmaId })]).then(([ozet, hepsi]) => {
      const konum = new Map(hepsi.map((p) => [p.id, p.konum ?? null]));
      const liste = ozet.filter((o) => o.proje.durum === 'aktif' || o.proje.id === ilkProje).map((o) => ({ id: o.proje.id, ad: o.proje.ad, konum: konum.get(o.proje.id) ?? null }));
      setProjeler(liste);
      setAnaProje((a) => a || (liste.length === 1 ? liste[0]!.id : ''));
    });
  }, [depo, oturum.firmaId, erisim, ilkProje]);

  // Projenin aşamaları; varsayılan aşama devam eden ilk takip başlığı.
  useEffect(() => {
    if (!anaProje) return setSecenek(null);
    void fotografSecenekleri(depo, oturum.firmaId, anaProje).then((s) => {
      setSecenek(s);
      setOrtak((o) => ({ ...o, takipBasligiId: varsayilanAsama(s) ?? '', kalemId: '', blokId: s.bloklar.length === 1 ? s.bloklar[0]!.id : '', katId: '' }));
    });
  }, [depo, oturum.firmaId, anaProje]);

  async function dosyalarSecildi(liste: FileList | null) {
    const dosyalar = [...(liste ?? [])].filter((d) => d.type.startsWith('image/') || /\.(heic|heif)$/i.test(d.name));
    if (!dosyalar.length || !projeler) return;
    setHazirlaniyor((n) => n + dosyalar.length);
    const yeni: Taslak[] = [];
    for (const d of dosyalar) {
      try {
        const t = await taslakHazirla(d);
        const oneri = konumdanProje(t.exif.konum, projeler)?.id ?? null;
        yeni.push({ ...t, oneriProjeId: oneri, projeId: oneri ?? anaProje });
      } catch (e) {
        setHatalar((h) => [...h, `${d.name}: ${hataMetni(e)}`]);
      } finally {
        setHazirlaniyor((n) => n - 1);
      }
    }
    // Proje seçilmemişse konumların çoğunun gösterdiği proje ana proje olur.
    if (!anaProje) {
      const sayi = new Map<string, number>();
      for (const t of yeni) if (t.oneriProjeId) sayi.set(t.oneriProjeId, (sayi.get(t.oneriProjeId) ?? 0) + 1);
      const en = [...sayi].sort((a, b) => b[1] - a[1])[0]?.[0];
      if (en) {
        setAnaProje(en);
        for (const t of yeni) if (!t.projeId) t.projeId = en;
      }
    }
    setTaslaklar((l) => [...l, ...yeni]);
  }

  const degistir = (anahtar: string, d: Partial<Taslak>) => setTaslaklar((l) => l.map((t) => (t.anahtar === anahtar ? { ...t, ...d } : t)));
  const projeAdi = (id: string) => projeler?.find((p) => p.id === id)?.ad ?? '';
  const uzaklik = (t: Taslak) => {
    const p = projeler?.find((x) => x.id === t.projeId);
    return p?.konum && t.exif.konum ? mesafeKm(p.konum, t.exif.konum) : null;
  };
  const tarihsiz = taslaklar.filter((t) => !t.tarih).length;

  async function kaydet() {
    setHatalar([]);
    const eksik: string[] = [];
    if (!taslaklar.length) eksik.push('Önce fotoğraf seçin.');
    if (taslaklar.some((t) => !t.projeId)) eksik.push('Her fotoğrafın projesini seçin.');
    if (tarihsiz) eksik.push(`${tarihsiz} fotoğrafın çekim tarihi yok; tarihi girin.`);
    if (taslaklar.some((t) => t.tarih > bugun)) eksik.push('Çekim tarihi bugünden sonra olamaz.');
    if (eksik.length) return setHatalar(eksik);
    setKayit({ yapilan: 0, toplam: taslaklar.length });
    const kalan: Taslak[] = [];
    const hata: string[] = [];
    for (const [i, t] of taslaklar.entries()) {
      // Aşama ve yer yalnız ana projenin fotoğraflarına yazılır (başka projenin aşamaları farklıdır).
      const ana = t.projeId === anaProje;
      try {
        await fotografEkle(
          depo,
          servis,
          {
            projeId: t.projeId,
            cekimTarihi: t.tarih,
            cekimZamani: t.zaman,
            tarihKaynagi: t.kaynak,
            takipBasligiId: ana ? ortak.takipBasligiId || null : null,
            kalemId: ana ? ortak.kalemId || null : null,
            blokId: ana ? ortak.blokId || null : null,
            katId: ana ? ortak.katId || null : null,
            aciklama: t.aciklama || ortak.aciklama,
            dosya: t.dosya,
            dosyaAdi: t.dosyaAdi,
            kucukResim: t.kucukResim,
            konum: t.exif.konum,
          },
          bugun,
        );
      } catch (e) {
        kalan.push(t);
        hata.push(`${t.dosyaAdi}: ${hataMetni(e)}`);
      }
      setKayit({ yapilan: i + 1, toplam: taslaklar.length });
    }
    setKayit(null);
    if (kalan.length) {
      setTaslaklar(kalan);
      setHatalar(hata);
      return;
    }
    git(`projeler/${anaProje}/fotograflar`);
  }

  const blok = secenek?.bloklar.find((b) => b.id === ortak.blokId);

  return (
    <>
      <p>
        <a className="geri-baglanti" href={ilkProje ? `#/projeler/${ilkProje}/fotograflar` : '#/kayit'}>
          ← {ilkProje ? 'Fotoğraflar' : 'Kayıt'}
        </a>
      </p>
      <h1>Şantiye fotoğrafı ekle</h1>
      <div className="form-duzeni">
        <div className="form-ana">
          <section className="kart">
            <div className="dugmeler fotograf-sec">
              <button type="button" onClick={() => kamera.current?.click()}>
                <Simge ad="kamera" /> Fotoğraf çek
              </button>
              <button type="button" className="ikincil" onClick={() => galeri.current?.click()}>
                <Simge ad="resim" /> Galeriden seç (birden çok)
              </button>
            </div>
            <input ref={kamera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => (void dosyalarSecildi(e.target.files), (e.target.value = ''))} />
            <input ref={galeri} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => (void dosyalarSecildi(e.target.files), (e.target.value = ''))} />
            <p className="soluk kucuk">
              Çekim tarihi fotoğrafın içindeki bilgiden, yoksa dosya adından alınır (WhatsApp fotoğrafları gibi); ikisi de yoksa sizin girmeniz istenir.
              Şantiye konumu girilmiş projelerde fotoğraf çekildiği yere göre projesine ayrılır.
            </p>
            {hazirlaniyor > 0 && <p role="status">{hazirlaniyor} fotoğraf hazırlanıyor…</p>}
          </section>

          {taslaklar.length > 0 && (
            <section className="kart">
              <div className="baslik-satiri">
                <h2>{taslaklar.length} fotoğraf</h2>
                <span className="topluca">
                  <input type="date" value={topluTarih} max={bugun} aria-label="Hepsine verilecek tarih" onChange={(e) => setTopluTarih(e.target.value)} />
                  <button
                    type="button"
                    className="ikincil"
                    disabled={!topluTarih}
                    onClick={() => setTaslaklar((l) => l.map((t) => ({ ...t, tarih: topluTarih, zaman: null, kaynak: 'elle' })))}
                  >
                    Hepsine bu tarih
                  </button>
                </span>
              </div>
              {tarihsiz > 0 && <p className="mesaj mesaj-uyari">{tarihsiz} fotoğrafta çekim tarihi bulunamadı; tarihi girin.</p>}
              <ul className="taslak-listesi">
                {taslaklar.map((t) => {
                  const d = uzaklik(t);
                  return (
                    <li key={t.anahtar} className={!t.tarih ? 'eksik' : undefined}>
                      {t.kucukResim ? <img src={t.kucukResim} alt="" /> : <span className="resim-yok"><Simge ad="kamera" boyut={28} /></span>}
                      <div className="taslak-bilgi">
                        <label className="taslak-tarih">
                          <input
                            type="date"
                            value={t.tarih}
                            max={bugun}
                            aria-label={`${t.dosyaAdi} çekim tarihi`}
                            onChange={(e) => degistir(t.anahtar, { tarih: e.target.value, zaman: null, kaynak: 'elle' })}
                          />
                          <span className={t.tarih ? 'soluk kucuk' : 'hata kucuk'}>{t.tarih ? `${t.zaman ? `${t.zaman} · ` : ''}${KAYNAK_METNI[t.kaynak]}` : 'tarihi girin'}</span>
                        </label>
                        {projeler && projeler.length > 1 && (
                          <select value={t.projeId} aria-label={`${t.dosyaAdi} projesi`} onChange={(e) => degistir(t.anahtar, { projeId: e.target.value })}>
                            <option value="">Proje seçin</option>
                            {projeler.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.ad}
                                {p.id === t.oneriProjeId ? ' (konumdan)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        {d !== null && d > SANTIYE_YARICAPI_KM && (
                          <span className="hata kucuk">
                            <Simge ad="uyari" /> {projeAdi(t.projeId)} şantiyesinden {d < 10 ? d.toFixed(1).replace('.', ',') : Math.round(d)} km uzakta çekilmiş
                          </span>
                        )}
                        <input value={t.aciklama} placeholder="Açıklama (isteğe bağlı)" aria-label={`${t.dosyaAdi} açıklaması`} onChange={(e) => degistir(t.anahtar, { aciklama: e.target.value })} />
                      </div>
                      <button type="button" className="baglanti-dugmesi" aria-label={`${t.dosyaAdi} çıkar`} onClick={() => setTaslaklar((l) => l.filter((x) => x.anahtar !== t.anahtar))}>
                        Çıkar
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </div>

        <div className="form-yan">
          <section className="kart">
            <h2>Hepsi için</h2>
            {projeler && projeler.length === 0 && <BosDurum metin="Önce bir proje kurun." eylemler={[{ yol: 'projeler/yeni', ad: '+ Yeni proje' }]} />}
            {projeler && projeler.length > 1 && (
              <Alan etiket="Proje">
                <select value={anaProje} onChange={(e) => setAnaProje(e.target.value)}>
                  <option value="">Seçin</option>
                  {projeler.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.ad}
                    </option>
                  ))}
                </select>
              </Alan>
            )}
            {secenek && (
              <>
                <Alan etiket="Aşama">
                  <select value={ortak.takipBasligiId} onChange={(e) => setOrtak({ ...ortak, takipBasligiId: e.target.value })}>
                    <option value="">Aşama seçilmedi</option>
                    {secenek.asamalar.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.ad}
                        {a.durum === 'devam' ? ' (sürüyor)' : ''}
                      </option>
                    ))}
                  </select>
                </Alan>
                {secenek.kalemler.length > 0 &&
                  (kalemAcik || ortak.kalemId ? (
                    <Alan etiket="Bütçe kalemi">
                      <select value={ortak.kalemId} onChange={(e) => setOrtak({ ...ortak, kalemId: e.target.value })}>
                        <option value="">Seçilmedi</option>
                        {secenek.kalemler.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.ad}
                          </option>
                        ))}
                      </select>
                    </Alan>
                  ) : (
                    <button type="button" className="baglanti-dugmesi" onClick={() => setKalemAcik(true)}>
                      + Bütçe kalemi seç
                    </button>
                  ))}
                {secenek.bloklar.length > 0 && (
                  <div className="iki-sutun">
                    <Alan etiket="Blok">
                      <select value={ortak.blokId} onChange={(e) => setOrtak({ ...ortak, blokId: e.target.value, katId: '' })}>
                        <option value="">Seçilmedi</option>
                        {secenek.bloklar.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.ad}
                          </option>
                        ))}
                      </select>
                    </Alan>
                    <Alan etiket="Kat">
                      <select value={ortak.katId} disabled={!blok} onChange={(e) => setOrtak({ ...ortak, katId: e.target.value })}>
                        <option value="">Seçilmedi</option>
                        {blok?.katlar.map((k) => (
                          <option key={k.id} value={k.id}>
                            {k.ad}
                          </option>
                        ))}
                      </select>
                    </Alan>
                  </div>
                )}
                <Alan etiket="Açıklama" aciklama="Kendi açıklaması olmayan fotoğraflara yazılır.">
                  <input value={ortak.aciklama} placeholder="ör. 3. kat döşeme betonu" onChange={(e) => setOrtak({ ...ortak, aciklama: e.target.value })} />
                </Alan>
                {taslaklar.some((t) => t.projeId && t.projeId !== anaProje) && (
                  <p className="mesaj-not">Aşama ve yer yalnız {projeAdi(anaProje)} fotoğraflarına yazılır; diğer projelerin fotoğraflarına sonra eklenebilir.</p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
      <Hatalar hatalar={hatalar} />
      <div className="kaydet-cubugu">
        <button type="button" className="kaydet-dugmesi" disabled={!!kayit || hazirlaniyor > 0 || !taslaklar.length} onClick={() => void kaydet()}>
          {kayit ? `Kaydediliyor… ${kayit.yapilan}/${kayit.toplam}` : taslaklar.length ? `${taslaklar.length} fotoğrafı kaydet` : 'Kaydet'}
        </button>
        <button type="button" className="ikincil" disabled={!!kayit} onClick={() => history.back()}>
          Vazgeç
        </button>
      </div>
    </>
  );
}

// ─── Proje sekmesi ────────────────────────────────────────────────

interface Suzgec {
  asama: string; // '' hepsi, '-' aşamasız, id
  kalem: string;
  blok: string;
  bas: string;
  son: string;
}
const BOS_SUZGEC: Suzgec = { asama: '', kalem: '', blok: '', bas: '', son: '' };

export function suz(liste: FotografSatiri[], s: Suzgec): FotografSatiri[] {
  return liste.filter(({ fotograf: f }) => {
    if (s.asama === '-' ? f.takipBasligiId !== null : s.asama && f.takipBasligiId !== s.asama) return false;
    if (s.kalem && f.kalemId !== s.kalem) return false;
    if (s.blok && f.blokId !== s.blok) return false;
    if (s.bas && f.cekimTarihi < s.bas) return false;
    if (s.son && f.cekimTarihi > s.son) return false;
    return true;
  });
}

function useFotograflar(projeId: string) {
  const { depo, oturum } = useUygulama();
  const [liste, setListe] = useState<FotografSatiri[] | null>(null);
  const [secenek, setSecenek] = useState<FotografSecenekleri | null>(null);
  const [proje, setProje] = useState<Proje | null>(null);
  const yenile = useCallback(async () => {
    const [l, s, p] = await Promise.all([projeFotograflari(depo, oturum.firmaId, projeId), fotografSecenekleri(depo, oturum.firmaId, projeId), depo.getir('proje', projeId)]);
    setListe(l);
    setSecenek(s);
    setProje(p ?? null);
  }, [depo, oturum.firmaId, projeId]);
  useEffect(() => {
    void yenile();
  }, [yenile]);
  return { liste, secenek, proje, yenile };
}

function SuzgecAlanlari({ s, set, secenek, liste }: { s: Suzgec; set: (s: Suzgec) => void; secenek: FotografSecenekleri; liste: FotografSatiri[] }) {
  const kullanilanKalem = new Set(liste.map((x) => x.fotograf.kalemId).filter(Boolean));
  return (
    <div className="fotograf-suzgec">
      <select value={s.asama} aria-label="Aşama" onChange={(e) => set({ ...s, asama: e.target.value })}>
        <option value="">Bütün aşamalar</option>
        {secenek.asamalar.map((a) => (
          <option key={a.id} value={a.id}>
            {a.ad}
          </option>
        ))}
        <option value="-">Aşaması seçilmemiş</option>
      </select>
      {kullanilanKalem.size > 0 && (
        <select value={s.kalem} aria-label="Bütçe kalemi" onChange={(e) => set({ ...s, kalem: e.target.value })}>
          <option value="">Bütün kalemler</option>
          {secenek.kalemler
            .filter((k) => kullanilanKalem.has(k.id))
            .map((k) => (
              <option key={k.id} value={k.id}>
                {k.ad}
              </option>
            ))}
        </select>
      )}
      {secenek.bloklar.length > 1 && (
        <select value={s.blok} aria-label="Blok" onChange={(e) => set({ ...s, blok: e.target.value })}>
          <option value="">Bütün bloklar</option>
          {secenek.bloklar.map((b) => (
            <option key={b.id} value={b.id}>
              {b.ad}
            </option>
          ))}
        </select>
      )}
      <span className="tarih-araligi">
        <input type="date" value={s.bas} aria-label="Başlangıç tarihi" onChange={(e) => set({ ...s, bas: e.target.value })} />
        <span aria-hidden="true">–</span>
        <input type="date" value={s.son} aria-label="Bitiş tarihi" onChange={(e) => set({ ...s, son: e.target.value })} />
      </span>
      {JSON.stringify(s) !== JSON.stringify(BOS_SUZGEC) && (
        <button type="button" className="baglanti-dugmesi" onClick={() => set(BOS_SUZGEC)}>
          Süzgeci temizle
        </button>
      )}
    </div>
  );
}

export function FotograflarSekmesi({ projeId }: { projeId: string }) {
  const yetki = useYetki();
  const { liste, secenek, proje, yenile } = useFotograflar(projeId);
  const [s, setS] = useState<Suzgec>(BOS_SUZGEC);
  const [acik, setAcik] = useState<string | null>(null);
  const gorunen = useMemo(() => (liste ? suz(liste, s) : []), [liste, s]);
  const gruplar = useMemo(() => aylaraGore(gorunen.map((x) => ({ ...x, ...x.fotograf }))), [gorunen]);
  const sira = useMemo(() => gruplar.flatMap((g) => g.fotograflar.map((x) => x.fotograf.id)), [gruplar]);
  const yazabilir = fotografYazabilir(yetki);

  if (!liste || !secenek || !proje) return <p>Yükleniyor…</p>;
  return (
    <>
      <div className="dugmeler proje-kisayollari">
        {yazabilir && (
          <a className="dugme" href={`#/fotograflar/yeni/${projeId}`}>
            <Simge ad="kamera" /> Fotoğraf ekle
          </a>
        )}
        {liste.length > 0 && (
          <a className="dugme ikincil" href={`#/projeler/${projeId}/fotograf-raporu`}>
            <Simge ad="dosya" /> Fotoğraflı rapor
          </a>
        )}
      </div>
      <SantiyeKonumu proje={proje} onDegisti={yenile} yazabilir={yetki('proje')} />
      {liste.length === 0 ? (
        <BosDurum
          metin="Henüz şantiye fotoğrafı yok. İnşaatın aşamalarını fotoğraflayıp tarih sırasıyla burada saklayın."
          eylemler={yazabilir ? [{ yol: `fotograflar/yeni/${projeId}`, ad: 'Fotoğraf ekle' }] : []}
        />
      ) : (
        <>
          <SuzgecAlanlari s={s} set={setS} secenek={secenek} liste={liste} />
          <p className="soluk kucuk">
            {gorunen.length} fotoğraf{gorunen.length !== liste.length ? ` (toplam ${liste.length})` : ''}
          </p>
          {gruplar.map((g) => (
            <section key={g.ay} className="fotograf-ayi">
              <h2>{ayAdi(g.ay)}</h2>
              <ul className="fotograf-izgarasi">
                {g.fotograflar.map((x) => (
                  <li key={x.fotograf.id}>
                    <button type="button" onClick={() => setAcik(x.fotograf.id)} aria-label={`${tarihYaz(x.fotograf.cekimTarihi)} ${x.fotograf.aciklama}`}>
                      {x.fotograf.kucukResim ? <img src={x.fotograf.kucukResim} alt="" loading="lazy" /> : <span className="resim-yok"><Simge ad="kamera" boyut={28} /></span>}
                      <span className="fotograf-etiketi">
                        {tarihYaz(x.fotograf.cekimTarihi)}
                        {x.asamaAdi && ` · ${x.asamaAdi}`}
                      </span>
                      {x.fotograf.uzaklikKm !== null && x.fotograf.uzaklikKm > SANTIYE_YARICAPI_KM && (
                        <span className="fotograf-uyari" title="Şantiyeden uzakta çekilmiş" role="img" aria-label="Şantiyeden uzakta çekilmiş">
                          <Simge ad="uyari" boyut={16} />
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {gorunen.length === 0 && <BosDurum metin="Bu süzgece uyan fotoğraf yok." />}
        </>
      )}
      {acik && (
        <Galeri
          liste={liste}
          sira={sira}
          acikId={acik}
          secenek={secenek}
          yazabilir={yazabilir}
          onGit={setAcik}
          onKapat={() => setAcik(null)}
          onDegisti={async () => {
            await yenile();
          }}
        />
      )}
    </>
  );
}

/** Proje Özet sekmesinde son fotoğraflar şeridi. */
export function SonFotograflar({ projeId }: { projeId: string }) {
  const { depo, oturum } = useUygulama();
  const [liste, setListe] = useState<FotografSatiri[] | null>(null);
  useEffect(() => {
    void projeFotograflari(depo, oturum.firmaId, projeId).then(setListe);
  }, [depo, oturum.firmaId, projeId]);
  if (!liste?.length) return null;
  const son = aylaraGore(liste.map((x) => ({ ...x, ...x.fotograf })))
    .flatMap((g) => g.fotograflar)
    .slice(0, 6);
  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Son fotoğraflar</h2>
        <a href={`#/projeler/${projeId}/fotograflar`}>Hepsi ({liste.length})</a>
      </div>
      <ul className="fotograf-seridi">
        {son.map((x) => (
          <li key={x.fotograf.id}>
            <a href={`#/projeler/${projeId}/fotograflar`} title={`${tarihYaz(x.fotograf.cekimTarihi)}${x.asamaAdi ? ` · ${x.asamaAdi}` : ''}`}>
              {x.fotograf.kucukResim ? <img src={x.fotograf.kucukResim} alt="" loading="lazy" /> : <span className="resim-yok"><Simge ad="kamera" boyut={28} /></span>}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── Tam ekran galeri ─────────────────────────────────────────────

function useFotografAdresi(belgeId: string | null) {
  const { depo, oturum } = useUygulama();
  const [adres, setAdres] = useState<string | null>(null);
  useEffect(() => {
    setAdres(null);
    if (!belgeId) return;
    let url: string | null = null;
    let iptal = false;
    void fotografDosyasi(depo, oturum.firmaId, belgeId).then((b) => {
      if (!b || iptal) return;
      url = URL.createObjectURL(b);
      setAdres(url);
    });
    return () => {
      iptal = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [depo, oturum.firmaId, belgeId]);
  return adres;
}

function Galeri(props: {
  liste: FotografSatiri[];
  sira: string[];
  acikId: string;
  secenek: FotografSecenekleri;
  yazabilir: boolean;
  onGit: (id: string) => void;
  onKapat: () => void;
  onDegisti: () => Promise<void>;
}) {
  const { depo, servis } = useUygulama();
  const satir = props.liste.find((x) => x.fotograf.id === props.acikId);
  const i = props.sira.indexOf(props.acikId);
  const adres = useFotografAdresi(satir?.belgeId ?? null);
  const [duzenle, setDuzenle] = useState(false);
  const [iptalSoru, setIptalSoru] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const dokunma = useRef<number | null>(null);
  const onceki = i > 0 ? props.sira[i - 1] : undefined;
  const sonraki = i >= 0 && i < props.sira.length - 1 ? props.sira[i + 1] : undefined;

  useEffect(() => {
    setDuzenle(false);
    setIptalSoru(false);
    setHata(null);
  }, [props.acikId]);

  useEffect(() => {
    const tus = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
      if (e.key === 'ArrowLeft' && onceki) props.onGit(onceki);
      else if (e.key === 'ArrowRight' && sonraki) props.onGit(sonraki);
      else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        props.onKapat();
      }
    };
    window.addEventListener('keydown', tus, true);
    return () => window.removeEventListener('keydown', tus, true);
  }, [onceki, sonraki, props]);

  if (!satir) return null;
  const f = satir.fotograf;
  return (
    <div className="galeri" role="dialog" aria-modal="true" aria-label="Fotoğraf">
      <div
        className="galeri-resim"
        onTouchStart={(e) => (dokunma.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const bas = dokunma.current;
          const son = e.changedTouches[0]?.clientX;
          dokunma.current = null;
          if (bas === null || son === undefined || Math.abs(son - bas) < 50) return;
          if (son < bas && sonraki) props.onGit(sonraki);
          if (son > bas && onceki) props.onGit(onceki);
        }}
      >
        {adres ? <img src={adres} alt={f.aciklama || 'Şantiye fotoğrafı'} /> : f.kucukResim ? <img src={f.kucukResim} alt="" className="bulanik" /> : <p>Yükleniyor…</p>}
        <button type="button" className="galeri-kapat" aria-label="Kapat" onClick={props.onKapat}>
          ✕
        </button>
        {onceki && (
          <button type="button" className="galeri-ok sol" aria-label="Önceki fotoğraf" onClick={() => props.onGit(onceki)}>
            ‹
          </button>
        )}
        {sonraki && (
          <button type="button" className="galeri-ok sag" aria-label="Sonraki fotoğraf" onClick={() => props.onGit(sonraki)}>
            ›
          </button>
        )}
      </div>
      <div className="galeri-bilgi">
        {duzenle ? (
          <FotografDuzenle
            satir={satir}
            secenek={props.secenek}
            onBitti={async (g) => {
              if (g) {
                try {
                  await fotografGuncelle(depo, servis, f.id, g, yerelGun(new Date()));
                  await props.onDegisti();
                } catch (e) {
                  setHata(hataMetni(e));
                  return;
                }
              }
              setDuzenle(false);
            }}
          />
        ) : (
          <>
            <p>
              <strong>{tarihYaz(f.cekimTarihi)}</strong>
              {f.cekimZamani && ` ${f.cekimZamani}`} <span className="soluk kucuk">({KAYNAK_METNI[f.tarihKaynagi]})</span>
              <span className="soluk kucuk">
                {' '}
                · {i + 1}/{props.sira.length}
              </span>
            </p>
            {(satir.asamaAdi || satir.kalemAdi || satir.yerAdi) && <p>{[satir.asamaAdi, satir.kalemAdi, satir.yerAdi].filter(Boolean).join(' · ')}</p>}
            {f.aciklama && <p>{f.aciklama}</p>}
            {f.uzaklikKm !== null && f.uzaklikKm > SANTIYE_YARICAPI_KM && (
              <p className="hata kucuk"><Simge ad="uyari" /> Şantiyeden {f.uzaklikKm.toLocaleString('tr-TR')} km uzakta çekilmiş.</p>
            )}
            {props.yazabilir && !iptalSoru && (
              <div className="dugmeler">
                <button type="button" className="ikincil" onClick={() => setDuzenle(true)}>
                  Düzenle
                </button>
                <button type="button" className="baglanti-dugmesi" onClick={() => setIptalSoru(true)}>
                  İptal et
                </button>
              </div>
            )}
            {iptalSoru && (
              <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="İptal onayı">
                <p>Fotoğraf iptal edilsin mi? Silinmez; geçmişte ve yedekte kalır.</p>
                <div className="dugmeler">
                  <button
                    type="button"
                    className="tehlikeli"
                    onClick={() =>
                      void (async () => {
                        try {
                          await fotografIptal(depo, servis, f.id);
                          const sonra = sonraki ?? onceki;
                          await props.onDegisti();
                          if (sonra) props.onGit(sonra);
                          else props.onKapat();
                        } catch (e) {
                          setHata(hataMetni(e));
                        }
                      })()
                    }
                  >
                    İptal et
                  </button>
                  <button type="button" className="ikincil" onClick={() => setIptalSoru(false)}>
                    Vazgeç
                  </button>
                </div>
              </div>
            )}
          </>
        )}
        <Hatalar hatalar={hata ? [hata] : []} />
      </div>
    </div>
  );
}

function FotografDuzenle({ satir, secenek, onBitti }: { satir: FotografSatiri; secenek: FotografSecenekleri; onBitti: (g: FotografBilgisi | null) => Promise<void> }) {
  const f = satir.fotograf;
  return (
    <BilgiFormu
      ilk={{
        cekimTarihi: f.cekimTarihi,
        cekimZamani: f.cekimZamani,
        tarihKaynagi: f.tarihKaynagi,
        takipBasligiId: f.takipBasligiId,
        kalemId: f.kalemId,
        blokId: f.blokId,
        katId: f.katId,
        aciklama: f.aciklama,
      }}
      secenek={secenek}
      onKaydet={onBitti}
      onVazgec={() => void onBitti(null)}
    />
  );
}

/** Çekim tarihi, aşama, bütçe kalemi, blok/kat, açıklama. Tarih değişirse kaynağı "elle" olur. */
function BilgiFormu(props: { ilk: FotografBilgisi; secenek: FotografSecenekleri; onKaydet: (g: FotografBilgisi) => Promise<void>; onVazgec?: () => void; kaydetMetni?: string; mesgul?: boolean }) {
  const { ilk, secenek } = props;
  const [g, setG] = useState<FotografBilgisi>(ilk);
  const blok = secenek.bloklar.find((b) => b.id === g.blokId);
  return (
    <div className="fotograf-duzenle">
      <div className="iki-sutun">
        <Alan etiket="Çekim tarihi" aciklama={g.cekimTarihi ? KAYNAK_METNI[g.tarihKaynagi] : 'Fotoğrafta tarih bulunamadı; girin.'}>
          <input
            type="date"
            value={g.cekimTarihi}
            max={yerelGun(new Date())}
            onChange={(e) =>
              setG({
                ...g,
                cekimTarihi: e.target.value,
                cekimZamani: e.target.value === ilk.cekimTarihi ? ilk.cekimZamani : null,
                tarihKaynagi: e.target.value === ilk.cekimTarihi ? ilk.tarihKaynagi : 'elle',
              })
            }
          />
        </Alan>
        <Alan etiket="Aşama">
          <select value={g.takipBasligiId ?? ''} onChange={(e) => setG({ ...g, takipBasligiId: e.target.value || null })}>
            <option value="">Seçilmedi</option>
            {secenek.asamalar.map((a) => (
              <option key={a.id} value={a.id}>
                {a.ad}
                {a.durum === 'devam' ? ' (sürüyor)' : ''}
              </option>
            ))}
          </select>
        </Alan>
      </div>
      {secenek.kalemler.length > 0 && (
        <Alan etiket="Bütçe kalemi">
          <select value={g.kalemId ?? ''} onChange={(e) => setG({ ...g, kalemId: e.target.value || null })}>
            <option value="">Seçilmedi</option>
            {secenek.kalemler.map((k) => (
              <option key={k.id} value={k.id}>
                {k.ad}
              </option>
            ))}
          </select>
        </Alan>
      )}
      {secenek.bloklar.length > 0 && (
        <div className="iki-sutun">
          <Alan etiket="Blok">
            <select value={g.blokId ?? ''} onChange={(e) => setG({ ...g, blokId: e.target.value || null, katId: null })}>
              <option value="">Seçilmedi</option>
              {secenek.bloklar.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.ad}
                </option>
              ))}
            </select>
          </Alan>
          <Alan etiket="Kat">
            <select value={g.katId ?? ''} disabled={!blok} onChange={(e) => setG({ ...g, katId: e.target.value || null })}>
              <option value="">Seçilmedi</option>
              {blok?.katlar.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.ad}
                </option>
              ))}
            </select>
          </Alan>
        </div>
      )}
      <Alan etiket="Açıklama">
        <input value={g.aciklama} onChange={(e) => setG({ ...g, aciklama: e.target.value })} />
      </Alan>
      <div className="dugmeler">
        <button type="button" disabled={props.mesgul} onClick={() => void props.onKaydet(g)}>
          {props.kaydetMetni ?? 'Kaydet'}
        </button>
        {props.onVazgec && (
          <button type="button" className="ikincil" onClick={props.onVazgec}>
            Vazgeç
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Belge havuzundan ─────────────────────────────────────────────

/** Havuzdaki fotoğrafı bir projenin şantiye fotoğrafı yapar (`#/havuz/:id/fotograf`). */
export function HavuzFotograf({ havuzId }: { havuzId: string }) {
  const { depo, servis, oturum } = useUygulama();
  const erisim = useProjeErisimi();
  const [satir, setSatir] = useState<Awaited<ReturnType<typeof havuzSatiriGetir>> | undefined>(undefined);
  const [projeler, setProjeler] = useState<{ id: string; ad: string }[]>([]);
  const [projeId, setProjeId] = useState('');
  const [secenek, setSecenek] = useState<FotografSecenekleri | null>(null);
  const [kucukResim, setKucukResim] = useState('');
  const [adres, setAdres] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    void (async () => {
      const [s, ozet] = await Promise.all([havuzSatiriGetir(depo, oturum.firmaId, havuzId), projeleriListele(depo, oturum.firmaId, erisim)]);
      setSatir(s);
      const liste = ozet.filter((o) => o.proje.durum === 'aktif').map((o) => ({ id: o.proje.id, ad: o.proje.ad }));
      setProjeler(liste);
      // Proje: konumu yarıçap içinde olan en yakın şantiye; tek proje varsa o.
      const uz = Object.entries(s?.havuz.cekim?.projeUzakliklari ?? {})
        .filter(([id, km]) => km <= SANTIYE_YARICAPI_KM && liste.some((p) => p.id === id))
        .sort((a, b) => a[1] - b[1]);
      setProjeId(uz[0]?.[0] ?? (liste.length === 1 ? liste[0]!.id : ''));
      const d = s ? await fotografDosyasi(depo, oturum.firmaId, s.belge.id) : null;
      if (d) {
        url = URL.createObjectURL(d);
        setAdres(url);
        const k = await cihaz.resimKucult(d, 360, 0.7);
        if (k.type === 'image/jpeg' && k.size < 150_000) setKucukResim(await dataUrl(k));
      }
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [depo, oturum.firmaId, havuzId, erisim]);

  useEffect(() => {
    setSecenek(null);
    if (projeId) void fotografSecenekleri(depo, oturum.firmaId, projeId).then(setSecenek);
  }, [depo, oturum.firmaId, projeId]);

  if (satir === undefined) return <p>Yükleniyor…</p>;
  if (!satir || satir.havuz.durum !== 'bekliyor') return <p className="hata">Belge havuzda bulunamadı ya da zaten bağlanmış.</p>;
  const c = satir.havuz.cekim;
  const uzaklik = projeId ? (c?.projeUzakliklari[projeId] ?? null) : null;

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/havuz/${havuzId}`}>
          ← Belge
        </a>
      </p>
      <h1>Şantiye fotoğrafı olarak ekle</h1>
      <div className="form-duzeni">
        <div className="form-ana">{adres && <img className="belge-buyuk" src={adres} alt={satir.belge.ad} />}</div>
        <div className="form-yan">
          <section className="kart">
            <Alan etiket="Proje">
              <select value={projeId} onChange={(e) => setProjeId(e.target.value)}>
                <option value="">Seçin</option>
                {projeler.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.ad}
                    {(c?.projeUzakliklari[p.id] ?? Infinity) <= SANTIYE_YARICAPI_KM ? ' (konumdan)' : ''}
                  </option>
                ))}
              </select>
            </Alan>
            {uzaklik !== null && uzaklik > SANTIYE_YARICAPI_KM && (
              <p className="hata kucuk"><Simge ad="uyari" /> Bu şantiyeden {uzaklik.toLocaleString('tr-TR')} km uzakta çekilmiş.</p>
            )}
            {secenek && (
              <BilgiFormu
                key={projeId}
                ilk={{
                  cekimTarihi: c?.tarih ?? '',
                  cekimZamani: c?.zaman ?? null,
                  tarihKaynagi: c?.tarih ? c.kaynak : 'elle',
                  takipBasligiId: varsayilanAsama(secenek) || null,
                  kalemId: null,
                  blokId: secenek.bloklar.length === 1 ? secenek.bloklar[0]!.id : null,
                  katId: null,
                  aciklama: '',
                }}
                secenek={secenek}
                kaydetMetni="Fotoğrafı ekle"
                mesgul={mesgul}
                onKaydet={async (g) => {
                  setMesgul(true);
                  setHata(null);
                  try {
                    await havuzdanFotograf(depo, servis, havuzId, { ...g, projeId, kucukResim }, yerelGun(new Date()));
                    git(`projeler/${projeId}/fotograflar`);
                  } catch (e) {
                    setHata(hataMetni(e));
                  } finally {
                    setMesgul(false);
                  }
                }}
              />
            )}
            <Hatalar hatalar={hata ? [hata] : []} />
          </section>
        </div>
      </div>
    </>
  );
}

// ─── Şantiye konumu ───────────────────────────────────────────────

function SantiyeKonumu({ proje, onDegisti, yazabilir }: { proje: Proje; onDegisti: () => Promise<void>; yazabilir: boolean }) {
  const { depo, servis } = useUygulama();
  const [acik, setAcik] = useState(false);
  const [metin, setMetin] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState(false);

  async function kaydet(k: Konum | null) {
    setMesgul(true);
    setHata(null);
    try {
      await projeKonumuKaydet(depo, servis, proje.id, k);
      setAcik(false);
      setMetin('');
      await onDegisti();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setMesgul(false);
    }
  }

  function buradayim() {
    if (!navigator.geolocation) return setHata('Bu cihaz konum vermiyor; Google Haritalar bağlantısını yapıştırın.');
    setMesgul(true);
    navigator.geolocation.getCurrentPosition(
      (p) => void kaydet({ enlem: p.coords.latitude, boylam: p.coords.longitude }),
      () => {
        setMesgul(false);
        setHata('Konum alınamadı. Telefonun ayarlarından bu siteye konum izni verin ya da Google Haritalar bağlantısını yapıştırın.');
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  const k = proje.konum;
  if (!k && !yazabilir) return null;
  return (
    <section className="kart santiye-konumu">
      {k && !acik ? (
        <p>
          <Simge ad="konum" /> Şantiye konumu kayıtlı.{' '}
          <a href={`https://www.google.com/maps?q=${k.enlem},${k.boylam}`} target="_blank" rel="noreferrer">
            Haritada aç
          </a>
          {yazabilir && (
            <>
              {' · '}
              <button type="button" className="baglanti-dugmesi" onClick={() => setAcik(true)}>
                Değiştir
              </button>
            </>
          )}
          <br />
          <span className="soluk kucuk">Fotoğraflar çekildiği yere göre bu projeye ayrılır; {SANTIYE_YARICAPI_KM} km'den uzakta çekilenler işaretlenir.</span>
        </p>
      ) : !acik ? (
        <p>
          <strong>Şantiye konumu girilmemiş.</strong> Girerseniz fotoğraflar çekildiği yere göre projesine kendiliğinden ayrılır, uzakta çekilenler işaretlenir.{' '}
          <button type="button" className="baglanti-dugmesi" onClick={() => setAcik(true)}>
            Konumu gir
          </button>
        </p>
      ) : (
        <>
          <h2>Şantiye konumu</h2>
          <div className="dugmeler">
            <button type="button" disabled={mesgul} onClick={buradayim}>
              <Simge ad="konum" /> Şantiyedeyim, konumumu kaydet
            </button>
          </div>
          <Alan etiket="ya da Google Haritalar bağlantısı / enlem, boylam" aciklama="Haritada şantiyeye basılı tutup çıkan konumu ya da paylaş bağlantısını yapıştırın.">
            <input value={metin} placeholder="36.8969, 30.7133" onChange={(e) => setMetin(e.target.value)} />
          </Alan>
          <div className="dugmeler">
            <button
              type="button"
              className="ikincil"
              disabled={mesgul || !metin.trim()}
              onClick={() => {
                const c = konumMetniCoz(metin);
                if (!c) return setHata('Konum okunamadı. "36.8969, 30.7133" gibi yazın ya da haritadaki konum bağlantısını yapıştırın (kısa goo.gl bağlantıları okunamaz).');
                void kaydet(c);
              }}
            >
              Kaydet
            </button>
            {k && (
              <button type="button" className="baglanti-dugmesi" disabled={mesgul} onClick={() => void kaydet(null)}>
                Konumu kaldır
              </button>
            )}
            <button type="button" className="baglanti-dugmesi" onClick={() => (setAcik(false), setHata(null))}>
              Vazgeç
            </button>
          </div>
        </>
      )}
      <Hatalar hatalar={hata ? [hata] : []} />
    </section>
  );
}

// ─── Fotoğraflı ilerleme raporu ───────────────────────────────────

function RaporResmi({ satir }: { satir: FotografSatiri }) {
  const adres = useFotografAdresi(satir.belgeId);
  const f = satir.fotograf;
  return (
    <figure className="rapor-fotografi">
      {adres ? <img src={adres} alt="" /> : f.kucukResim ? <img src={f.kucukResim} alt="" /> : <span className="resim-yok"><Simge ad="kamera" boyut={28} /></span>}
      <figcaption>
        <strong>{tarihYaz(f.cekimTarihi)}</strong>
        {[satir.yerAdi, satir.kalemAdi, f.aciklama].filter(Boolean).length > 0 && ` · ${[satir.yerAdi, satir.kalemAdi, f.aciklama].filter(Boolean).join(' · ')}`}
      </figcaption>
    </figure>
  );
}

export function FotografRaporu({ projeId }: { projeId: string }) {
  const { firma } = useUygulama();
  const { liste, secenek, proje } = useFotograflar(projeId);
  const [s, setS] = useState<Suzgec>(BOS_SUZGEC);
  const [enCok, setEnCok] = useState(6);
  const gorunen = useMemo(() => (liste ? suz(liste, s) : []), [liste, s]);

  if (!liste || !secenek || !proje) return <p>Yükleniyor…</p>;
  // Aşama sırasıyla bölümler; her bölümde tarih sırası (eskiden yeniye), en çok `enCok` fotoğraf (eşit aralıkla seçilir).
  const bolumler = [...secenek.asamalar.map((a) => ({ id: a.id, ad: a.ad })), { id: '', ad: 'Diğer fotoğraflar' }]
    .map((a) => {
      const hepsi = gorunen.filter((x) => (x.fotograf.takipBasligiId ?? '') === a.id).sort((p, q) => p.fotograf.cekimTarihi.localeCompare(q.fotograf.cekimTarihi));
      const secilen = hepsi.length <= enCok ? hepsi : Array.from({ length: enCok }, (_, k) => hepsi[Math.round((k * (hepsi.length - 1)) / (enCok - 1))]!);
      return { ...a, hepsi, secilen };
    })
    .filter((b) => b.hepsi.length > 0);
  const tarihler = gorunen.map((x) => x.fotograf.cekimTarihi).sort();
  const aralik = tarihler.length ? `${tarihYaz(tarihler[0]!)} – ${tarihYaz(tarihler.at(-1)!)}` : '';

  return (
    <>
      <div className="yazdirma-gizle">
        <p>
          <a className="geri-baglanti" href={`#/projeler/${projeId}/fotograflar`}>
            ← Fotoğraflar
          </a>
        </p>
        <h1>Fotoğraflı ilerleme raporu</h1>
        <section className="kart">
          <SuzgecAlanlari s={s} set={setS} secenek={secenek} liste={liste} />
          <Alan etiket="Aşama başına en çok">
            <select value={enCok} onChange={(e) => setEnCok(Number(e.target.value))}>
              {[2, 4, 6, 8, 12, 1000].map((n) => (
                <option key={n} value={n}>
                  {n === 1000 ? 'Hepsi' : `${n} fotoğraf`}
                </option>
              ))}
            </select>
          </Alan>
          <div className="dugmeler">
            <button type="button" onClick={() => void yazdir()} disabled={!bolumler.length}>
              <Simge ad="yazdir" /> PDF / Yazdır
            </button>
          </div>
        </section>
      </div>
      {bolumler.length === 0 ? (
        <BosDurum metin="Bu süzgece uyan fotoğraf yok." />
      ) : (
        <article className="sozlesme-belgesi fotograf-raporu">
          <header className="fr-baslik">
            {firma.logo && <img src={firma.logo} alt="" className="sb-logo" />}
            <div>
              <h2>{proje.ad} · İnşaat ilerleme raporu</h2>
              <p>
                {firma.ad} · {aralik} · {gorunen.length} fotoğraf · Rapor tarihi {tarihYaz(yerelGun(new Date()))}
              </p>
            </div>
          </header>
          {bolumler.map((b) => (
            <section key={b.id || 'diger'} className="fr-bolum">
              <h3>
                {b.ad} <span className="soluk">({b.hepsi.length} fotoğraf{b.secilen.length < b.hepsi.length ? `, ${b.secilen.length} gösteriliyor` : ''})</span>
              </h3>
              <div className="fr-izgara">
                {b.secilen.map((x) => (
                  <RaporResmi key={x.fotograf.id} satir={x} />
                ))}
              </div>
            </section>
          ))}
        </article>
      )}
    </>
  );
}
