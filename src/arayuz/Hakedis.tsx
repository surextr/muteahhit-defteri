import { useCallback, useEffect, useMemo, useState } from 'react';
import { bransKisaAdi } from '../hesap/brans';
import { KDV_ORANLARI, TEVKIFAT_ORANLARI, tevkifatYaz } from '../hesap/gider';
import {
  asamaSatiri,
  hakedisTutarlari,
  hakedisUyarilari,
  metrajSatiri,
  tutarSatiri,
  type HakedisGirdisi,
} from '../hesap/hakedis';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import {
  hakedisBaglami,
  hakedisGetir,
  hakedisGuncelle,
  hakedisIptal,
  hakedisOlustur,
  hakedisOnayla,
  hakedisOzeti,
  sozlesmeHakedisleri,
  sozlesmeTeminati,
  teminatSerbestBirak,
  type HakedisBaglami,
} from '../servisler/hakedis';
import type { Hakedis, Tevkifat, UstaSozlesmesi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, useGerekceliDegisiklik } from './bilesenler';
import { TutarGirdisi } from './Girdiler';
import { git } from './rota';

// Hakediş: imzalı sözleşmenin ekranındaki liste ve hakediş formu. Her iş sözleşmedeki takip yöntemiyle girilir:
// metrajda kalem başına bu dönem yapılan miktar, aşamada tamamlanan aşamalar, tutarda doğrudan tutar.
// Onaylanınca gider kaydı oluşur; borç, maliyet ve avans mahsubu oradan yürür.

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');

export function HakedisDurumu({ h }: { h: Pick<Hakedis, 'onay'> }) {
  return h.onay ? <span className="rozet-tamam">Onaylı</span> : <span className="rozet-taslak">Taslak</span>;
}

// ─── Sözleşme ekranındaki kart ─────────────────────────────────────

export function HakedislerKarti({ sozlesme }: { sozlesme: UstaSozlesmesi }) {
  const { depo, oturum } = useUygulama();
  const [liste, setListe] = useState<Hakedis[] | null>(null);
  const [teminat, setTeminat] = useState<Awaited<ReturnType<typeof sozlesmeTeminati>> | null>(null);

  const yukle = useCallback(async () => {
    const [l, t] = await Promise.all([sozlesmeHakedisleri(depo, oturum.firmaId, sozlesme.id), sozlesmeTeminati(depo, oturum.firmaId, sozlesme.id)]);
    setListe(l);
    setTeminat(t);
  }, [depo, oturum.firmaId, sozlesme.id]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  const ozet = liste ? hakedisOzeti(liste) : null;
  return (
    <>
      <section className="kart">
        <div className="baslik-satiri">
          <h2>Hakedişler</h2>
          {sozlesme.onay && (
            <a className="dugme" href={`#/hakedisler/yeni/${sozlesme.id}`}>
              + Hakediş
            </a>
          )}
        </div>
        {!sozlesme.onay && <p className="soluk">Hakediş, sözleşme imzalandı olarak işaretlendikten sonra çıkarılır.</p>}
        {liste === null && sozlesme.onay && <p>Yükleniyor…</p>}
        {liste && liste.length === 0 && sozlesme.onay && <p className="soluk">Henüz hakediş yok.</p>}
        {liste && liste.length > 0 && (
          <>
            <ul className="liste">
              {liste.map((h) => (
                <li key={h.id}>
                  <a href={`#/hakedisler/${h.id}`} className="genis-satir">
                    <strong>
                      Hakediş {h.no}
                      {h.donemAsama && ` · ${h.donemAsama}`}
                    </strong>{' '}
                    <HakedisDurumu h={h} />
                    <span className="soluk blok kucuk">
                      {tarihYaz(h.tarih)} · {tlYaz(h.brutTutar - h.kesintiToplam)}
                      {h.netTutar !== h.borcTutari && ` · ödenecek ${tlYaz(h.netTutar)}`}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
            {ozet && ozet.onayli > 0 && (
              <p className="ozet-satiri">
                <span>
                  Onaylı hakediş <strong>{tlYaz(ozet.brut)}</strong>
                </span>
                {sozlesme.toplamTutar > 0 && (
                  <span>
                    Sözleşmenin <strong>%{Math.round((ozet.brut / sozlesme.toplamTutar) * 100)}</strong>'i
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </section>
      {teminat && teminat.tutulan > 0 && <TeminatKarti sozlesme={sozlesme} teminat={teminat} onDegisti={yukle} />}
    </>
  );
}

function TeminatKarti(props: { sozlesme: UstaSozlesmesi; teminat: Awaited<ReturnType<typeof sozlesmeTeminati>>; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const { teminat: t, sozlesme } = props;
  const [acik, setAcik] = useState(false);
  const [tarih, setTarih] = useState(yerelGun(new Date()));
  const [tutar, setTutar] = useState(tutarMetni(t.bekleyen));
  const [aciklama, setAciklama] = useState('');
  const [mesaj, setMesaj] = useState<string | null>(null);

  async function birak() {
    const okunan = tlOku(tutar);
    if (okunan === null) return setMesaj('Tutar okunamadı.');
    await degistir('Teminat serbest bırakma', async () => {
      await teminatSerbestBirak(depo, servis, sozlesme.id, { tarih, tutar: okunan, aciklama });
      setAcik(false);
      setMesaj(null);
      await props.onDegisti();
    });
  }

  return (
    <section className="kart">
      <h2>Teminat</h2>
      <p className="ozet-tutar">
        <span>Hakedişlerden tutulan</span>
        <span>{tlYaz(t.tutulan)}</span>
      </p>
      {t.serbest > 0 && (
        <p className="ozet-tutar">
          <span>Serbest bırakılan</span>
          <span>−{tlYaz(t.serbest)}</span>
        </p>
      )}
      <p className="ozet-tutar ozet-ara">
        <span>Bekleyen teminat</span>
        <span>{tlYaz(t.bekleyen)}</span>
      </p>
      <p className="soluk kucuk">Teminat ustanın borcunun içindedir. İş teslim alınınca serbest bırakın; ödemesi ödeme ekranından yapılır.</p>
      {t.iadeler.length > 0 && (
        <ul className="liste kucuk">
          {t.iadeler.map((x) => (
            <li key={x.id}>
              {tarihYaz(x.tarih)} · {tlYaz(x.tutar)}
              {x.aciklama && ` · ${x.aciklama}`}
            </li>
          ))}
        </ul>
      )}
      {kutu}
      {(hata || mesaj) && <Hatalar hatalar={[hata ?? mesaj!]} />}
      {t.bekleyen > 0 && !acik && (
        <div className="dugmeler">
          <button type="button" className="ikincil" onClick={() => (setTutar(tutarMetni(t.bekleyen)), setAcik(true))}>
            Teminatı serbest bırak
          </button>
          {t.serbest > 0 && (
            <a className="dugme ikincil" href={`#/odemeler/yeni/${sozlesme.cariId}`}>
              Ödeme yap
            </a>
          )}
        </div>
      )}
      {acik && (
        <>
          <div className="iki-sutun">
            <Alan etiket="Tarih">
              <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
            </Alan>
            <Alan etiket="Tutar (₺)">
              <TutarGirdisi value={tutar} onChange={setTutar} />
            </Alan>
          </div>
          <Alan etiket="Açıklama">
            <input value={aciklama} placeholder="örn. İş teslim alındı" onChange={(e) => setAciklama(e.target.value)} />
          </Alan>
          <div className="dugmeler">
            <button type="button" onClick={() => void birak()}>
              Serbest bırak
            </button>
            <button type="button" className="ikincil" onClick={() => setAcik(false)}>
              Vazgeç
            </button>
          </div>
        </>
      )}
      {t.serbest > 0 && acik === false && t.bekleyen === 0 && (
        <div className="dugmeler">
          <a className="dugme ikincil" href={`#/odemeler/yeni/${sozlesme.cariId}`}>
            Ödeme yap
          </a>
        </div>
      )}
    </section>
  );
}

// ─── Hakediş formu ─────────────────────────────────────────────────

interface Form {
  tarih: string;
  donemAsama: string;
  /** Sözleşme kalemi → bu hakedişte yapılan miktar (yazıldığı gibi). */
  metraj: Record<string, string>;
  /** Bu hakedişte tamamlanan aşamalar. */
  asamalar: string[];
  /** İş → tutar ve açıklama (tutar yönteminde). */
  tutarlar: Record<string, { tutar: string; aciklama: string }>;
  kesintiler: { aciklama: string; tutar: string }[];
  kdvOrani: number;
  /** '' ya da "4/10". */
  tevkifat: string;
  teminatOrani: string;
  avans: string;
  not: string;
}

const tevkifatOku = (m: string): Tevkifat | null => {
  const [pay, payda] = m.split('/').map(Number);
  return pay && payda ? { pay, payda } : null;
};

function bosForm(b: HakedisBaglami): Form {
  // KDV ve tevkifat önceki hakedişten gelir (faturalı taşeron her ay aynı keser); yoksa KDV'siz.
  const son = b.hakedisler.at(-1);
  return {
    tarih: yerelGun(new Date()),
    donemAsama: '',
    metraj: {},
    asamalar: [],
    tutarlar: {},
    kesintiler: [],
    kdvOrani: son?.kdvOrani ?? 0,
    tevkifat: son?.tevkifat ? tevkifatYaz(son.tevkifat) : '',
    teminatOrani: b.sozlesme.teminatOrani > 0 ? sayiYaz(b.sozlesme.teminatOrani) : '',
    avans: '',
    not: '',
  };
}

function kayittanForm(h: Hakedis): Form {
  const f: Form = {
    tarih: h.tarih,
    donemAsama: h.donemAsama,
    metraj: {},
    asamalar: [],
    tutarlar: {},
    kesintiler: h.kesintiler.map((k) => ({ aciklama: k.aciklama, tutar: tutarMetni(k.tutar) })),
    kdvOrani: h.kdvOrani,
    tevkifat: h.tevkifat ? tevkifatYaz(h.tevkifat) : '',
    teminatOrani: h.teminatOrani > 0 ? sayiYaz(h.teminatOrani) : '',
    avans: h.avansMahsubu > 0 ? tutarMetni(h.avansMahsubu) : '',
    not: h.not,
  };
  for (const s of h.satirlar) {
    if (s.tur === 'metraj' && s.kaynakId) f.metraj[s.kaynakId] = sayiYaz(s.miktar);
    if (s.tur === 'asama' && s.kaynakId) f.asamalar.push(s.kaynakId);
    if (s.tur === 'tutar') f.tutarlar[s.ustaTipiId] = { tutar: tutarMetni(s.tutar), aciklama: s.aciklama };
  }
  return f;
}

/** Formdan servis girdisi; okunamayan sayılar ayrıca hata olarak döner. */
function formdanGirdi(f: Form, s: UstaSozlesmesi): { girdi: HakedisGirdisi; hatalar: string[] } {
  const hatalar: string[] = [];
  const satirlar: HakedisGirdisi['satirlar'] = [];
  for (const b of s.bolumler) {
    const ad = bransKisaAdi(b.ustaTipiAdi);
    if (b.takipYontemi === 'metraj') {
      for (const k of s.kalemler.filter((x) => x.ustaTipiId === b.ustaTipiId)) {
        const yazilan = f.metraj[k.id]?.trim();
        if (!yazilan) continue;
        const miktar = sayiOku(yazilan);
        if (miktar === null) hatalar.push(`"${k.ad}" miktarı okunamadı (örn. 1.250,5).`);
        else if (miktar !== 0) satirlar.push(metrajSatiri(k, miktar));
      }
    } else if (b.takipYontemi === 'asama') {
      for (const a of b.asamalar) if (f.asamalar.includes(a.id)) satirlar.push(asamaSatiri(b.ustaTipiId, a, null));
    } else {
      const t = f.tutarlar[b.ustaTipiId];
      if (t?.tutar.trim()) {
        const tutar = tlOku(t.tutar);
        if (tutar === null) hatalar.push(`${ad} tutarı okunamadı.`);
        else if (tutar !== 0) satirlar.push(tutarSatiri(b.ustaTipiId, tutar, t.aciklama.trim() || `${ad} işleri`, null));
      }
    }
  }
  const kesintiler = f.kesintiler
    .filter((k) => k.aciklama.trim() || k.tutar.trim())
    .map((k) => {
      const tutar = tlOku(k.tutar);
      if (tutar === null) hatalar.push(`"${k.aciklama || 'Kesinti'}" tutarı okunamadı.`);
      return { aciklama: k.aciklama, tutar: tutar ?? 0 };
    });
  const teminat = f.teminatOrani.trim() ? sayiOku(f.teminatOrani) : 0;
  if (teminat === null) hatalar.push('Teminat oranı okunamadı (örn. 5).');
  const avans = f.avans.trim() ? tlOku(f.avans) : 0;
  if (avans === null) hatalar.push('Avans mahsubu okunamadı.');
  return {
    girdi: {
      tarih: f.tarih,
      donemAsama: f.donemAsama,
      satirlar,
      kesintiler,
      kdvOrani: f.kdvOrani,
      tevkifat: f.kdvOrani > 0 ? tevkifatOku(f.tevkifat) : null,
      teminatOrani: teminat ?? 0,
      avansMahsubu: avans ?? 0,
      sgkPrimiDahil: false,
      not: f.not,
    },
    hatalar,
  };
}

/** `#/hakedisler/yeni/:sozlesmeId` ya da `#/hakedisler/:id`. */
export function HakedisEkrani(props: { id?: string; sozlesmeId?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [hakedis, setHakedis] = useState<Hakedis | null>(null);
  const [b, setB] = useState<HakedisBaglami | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [kayitliForm, setKayitliForm] = useState('');
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);
  const { degistir, kutu, hata } = useGerekceliDegisiklik();

  const yukle = useCallback(async () => {
    const h = props.id ? await hakedisGetir(depo, oturum.firmaId, props.id) : null;
    if (props.id && !h) return setB(null);
    const baglam = await hakedisBaglami(depo, oturum.firmaId, h?.sozlesmeId ?? props.sozlesmeId ?? '', h?.id ?? null);
    setHakedis(h);
    setB(baglam);
    if (!baglam) return;
    const f = h ? kayittanForm(h) : bosForm(baglam);
    setForm(f);
    setKayitliForm(h ? JSON.stringify(f) : '');
  }, [depo, oturum.firmaId, props.id, props.sozlesmeId]);

  useEffect(() => {
    void yukle();
  }, [yukle]);

  const cevrim = useMemo(() => (form && b ? formdanGirdi(form, b.sozlesme) : null), [form, b]);

  if (b === undefined || (b && !form)) return <p>Yükleniyor…</p>;
  if (b === null || !form || !cevrim) return <p className="hata">Hakediş bulunamadı.</p>;

  const { sozlesme, cari } = b;
  const onayli = !!hakedis?.onay;
  const isAdi = (tipId: string) => bransKisaAdi(sozlesme.bolumler.find((x) => x.ustaTipiId === tipId)?.ustaTipiAdi ?? '');
  const t = hakedisTutarlari(cevrim.girdi, isAdi);
  const uyarilar = hakedisUyarilari(cevrim.girdi, sozlesme, b.onceki);
  const degisti = JSON.stringify(form) !== kayitliForm;
  const yaz = <K extends keyof Form>(alan: K, deger: Form[K]) => {
    setMesaj(null);
    setForm({ ...form, [alan]: deger });
  };
  const avansOnerisi = Math.max(0, Math.min(b.acikAvans, t.borcTutari - t.teminatTutari));

  async function kaydet(): Promise<Hakedis | null> {
    if (!cevrim || cevrim.hatalar.length > 0) return null;
    let sonuc: Hakedis | null = null;
    await degistir('Hakediş değişikliği', async (gerekce) => {
      sonuc = hakedis ? await hakedisGuncelle(depo, servis, hakedis.id, cevrim.girdi, gerekce) : await hakedisOlustur(depo, servis, sozlesme.id, cevrim.girdi);
      if (!hakedis) {
        git(`hakedisler/${sonuc.id}`);
        return;
      }
      setHakedis(sonuc);
      const f = kayittanForm(sonuc);
      setForm(f);
      setKayitliForm(JSON.stringify(f));
      setMesaj('Kaydedildi.');
    });
    return sonuc;
  }

  async function onayla() {
    if (!hakedis) return;
    setIslemde(true);
    await degistir('Hakediş onayı', async () => {
      await hakedisOnayla(depo, servis, hakedis.id);
      await yukle();
      setMesaj('Onaylandı; borç ve maliyet gider kaydı olarak yazıldı.');
    });
    setIslemde(false);
  }

  const satir = (etiket: string, tutar: number, sinif?: string) =>
    tutar !== 0 && (
      <p className={`ozet-tutar ${sinif ?? ''}`}>
        <span>{etiket}</span>
        <span>{tlYaz(tutar)}</span>
      </p>
    );

  return (
    <>
      <p>
        <a href={`#/sozlesmeler/${sozlesme.id}`}>← {cari.ad} sözleşmesi</a>
      </p>
      <div className="baslik-satiri">
        <h1>{hakedis ? `Hakediş ${hakedis.no}` : 'Yeni hakediş'}</h1>
        {hakedis && <HakedisDurumu h={hakedis} />}
      </div>
      <p className="soluk">
        {cari.ad} · {sozlesme.ustaTipiAdi}
      </p>
      {onayli && (
        <p className="mesaj mesaj-not">
          Bu hakediş onaylandı; borç ve maliyet gider kaydı olarak yazıldı. Değiştirmek için iptal edip yeniden çıkarın.
          {hakedis?.giderId && (
            <>
              {' '}
              <a href={`#/giderler/${hakedis.giderId}`}>Gider kaydını gör</a>
            </>
          )}
        </p>
      )}

      <fieldset disabled={onayli} className="hakedis-formu">
        <section className="kart">
          <div className="iki-sutun">
            <Alan etiket="Tarih">
              <input type="date" value={form.tarih} onChange={(e) => yaz('tarih', e.target.value)} />
            </Alan>
            <Alan etiket="Dönem / açıklama">
              <input value={form.donemAsama} placeholder="örn. Kasım ya da 3. kat" onChange={(e) => yaz('donemAsama', e.target.value)} />
            </Alan>
          </div>
        </section>

        {sozlesme.bolumler.map((bol) => {
          const ad = bransKisaAdi(bol.ustaTipiAdi);
          const kalemler = sozlesme.kalemler.filter((k) => k.ustaTipiId === bol.ustaTipiId);
          const isToplami = cevrim.girdi.satirlar.filter((x) => x.ustaTipiId === bol.ustaTipiId).reduce((s, x) => s + x.tutar, 0);
          return (
            <section key={bol.ustaTipiId} className="kart">
              <div className="baslik-satiri">
                <h2>{ad}</h2>
                <span className="soluk kucuk">
                  {bol.takipYontemi === 'metraj' ? 'Metraj' : bol.takipYontemi === 'asama' ? 'Aşama' : 'Tutar'}
                </span>
              </div>
              {bol.takipYontemi === 'metraj' &&
                kalemler.map((k) => {
                  const onceki = b.onceki.kalemMiktari.get(k.id) ?? 0;
                  const bu = sayiOku(form.metraj[k.id] ?? '') ?? 0;
                  return (
                    <div key={k.id} className="metraj-satiri">
                      <div>
                        <strong>{k.ad}</strong>
                        <span className="soluk kucuk blok">
                          {tlYaz(k.birimFiyat)} / {k.birim}
                          {k.miktar !== null && ` · sözleşme ${sayiYaz(k.miktar)} ${k.birim}`}
                          {onceki > 0 && ` · önceki ${sayiYaz(onceki)}`}
                          {(onceki > 0 || bu > 0) && k.miktar !== null && ` · kalan ${sayiYaz(Math.max(0, k.miktar - onceki - bu))}`}
                        </span>
                      </div>
                      <label>
                        <span className="soluk kucuk">Bu hakediş ({k.birim})</span>
                        <input
                          inputMode="decimal"
                          value={form.metraj[k.id] ?? ''}
                          placeholder="—"
                          aria-label={`${k.ad}: bu hakedişteki miktar`}
                          onChange={(e) => yaz('metraj', { ...form.metraj, [k.id]: e.target.value })}
                        />
                      </label>
                      <span className="metraj-tutar">{bu > 0 ? tlYaz(Math.round(bu * k.birimFiyat)) : ''}</span>
                    </div>
                  );
                })}
              {bol.takipYontemi === 'asama' && (
                <>
                  {bol.asamalar.length === 0 && <p className="soluk">Sözleşmede aşama tanımlı değil. Sözleşmeyi açıp aşamaları yazın.</p>}
                  <div className="asama-secimi">
                    {bol.asamalar.map((a) => {
                      const odendi = b.onceki.asamalar.has(a.id);
                      return (
                        <label key={a.id} className={odendi ? 'soluk' : undefined}>
                          <input
                            type="checkbox"
                            disabled={odendi}
                            checked={odendi || form.asamalar.includes(a.id)}
                            onChange={(e) => yaz('asamalar', e.target.checked ? [...form.asamalar, a.id] : form.asamalar.filter((x) => x !== a.id))}
                          />{' '}
                          {a.ad} · {tlYaz(a.tutar)}
                          {odendi && ' · önceki hakedişte'}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
              {bol.takipYontemi === 'tutar' && (
                <div className="iki-sutun">
                  <Alan etiket="Tutar (₺)" aciklama={(b.onceki.isTutari.get(bol.ustaTipiId) ?? 0) > 0 ? `Önceki hakedişler: ${tlYaz(b.onceki.isTutari.get(bol.ustaTipiId)!)}` : undefined}>
                    <TutarGirdisi
                      value={form.tutarlar[bol.ustaTipiId]?.tutar ?? ''}
                      placeholder="0,00"
                      onChange={(v) => yaz('tutarlar', { ...form.tutarlar, [bol.ustaTipiId]: { aciklama: form.tutarlar[bol.ustaTipiId]?.aciklama ?? '', tutar: v } })}
                    />
                  </Alan>
                  <Alan etiket="Açıklama">
                    <input
                      value={form.tutarlar[bol.ustaTipiId]?.aciklama ?? ''}
                      placeholder={`${ad} işleri`}
                      onChange={(e) => yaz('tutarlar', { ...form.tutarlar, [bol.ustaTipiId]: { tutar: form.tutarlar[bol.ustaTipiId]?.tutar ?? '', aciklama: e.target.value } })}
                    />
                  </Alan>
                </div>
              )}
              {sozlesme.bolumler.length > 1 && isToplami > 0 && (
                <p className="ara-toplam">
                  <span>{ad} bu hakediş</span>
                  <span>{tlYaz(isToplami)}</span>
                </p>
              )}
            </section>
          );
        })}

        <section className="kart">
          <h2>Kesintiler, KDV, teminat ve avans</h2>
          {form.kesintiler.map((k, i) => (
            <div key={i} className="asama-satiri">
              <input
                value={k.aciklama}
                placeholder="Kesinti, örn. Gecikme cezası"
                aria-label={`${i + 1}. kesintinin açıklaması`}
                onChange={(e) => yaz('kesintiler', form.kesintiler.map((x, j) => (j === i ? { ...x, aciklama: e.target.value } : x)))}
              />
              <TutarGirdisi value={k.tutar} placeholder="Tutar (₺)" onChange={(v) => yaz('kesintiler', form.kesintiler.map((x, j) => (j === i ? { ...x, tutar: v } : x)))} />
              <button type="button" className="ikincil" aria-label={`${i + 1}. kesintiyi çıkar`} onClick={() => yaz('kesintiler', form.kesintiler.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button type="button" className="baglanti-dugmesi" onClick={() => yaz('kesintiler', [...form.kesintiler, { aciklama: '', tutar: '' }])}>
            + Kesinti ekle
          </button>
          <p className="soluk kucuk">Kesinti (ceza, usta adına alınan malzeme…) hakedişten ve maliyetten düşer.</p>

          <div className="iki-sutun">
            <Alan etiket="KDV" aciklama="Faturasız ustada %0 bırakın.">
              <select value={form.kdvOrani} onChange={(e) => setForm({ ...form, kdvOrani: Number(e.target.value), tevkifat: Number(e.target.value) === 0 ? '' : form.tevkifat })}>
                {KDV_ORANLARI.map((o) => (
                  <option key={o} value={o}>
                    %{o}
                  </option>
                ))}
              </select>
            </Alan>
            <Alan etiket="Tevkifat">
              <select value={form.tevkifat} disabled={form.kdvOrani === 0} onChange={(e) => yaz('tevkifat', e.target.value)}>
                <option value="">Yok</option>
                {TEVKIFAT_ORANLARI.map(tevkifatYaz).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Alan>
            <Alan etiket="Teminat (%)" aciklama={sozlesme.teminatOrani > 0 ? `Sözleşmede %${sayiYaz(sozlesme.teminatOrani)}` : 'Sözleşmede teminat yok.'}>
              <input inputMode="decimal" value={form.teminatOrani} placeholder="Yok" onChange={(e) => yaz('teminatOrani', e.target.value)} />
            </Alan>
            <Alan etiket="Avans mahsubu (₺)" aciklama={b.acikAvans > 0 ? `Açık avans: ${tlYaz(b.acikAvans)}` : 'Açık avans yok.'}>
              <TutarGirdisi value={form.avans} placeholder="0,00" onChange={(v) => yaz('avans', v)} />
            </Alan>
          </div>
          {!onayli && avansOnerisi > 0 && (sayiOku(form.avans) ?? 0) === 0 && (
            <button type="button" className="baglanti-dugmesi" onClick={() => yaz('avans', tutarMetni(avansOnerisi))}>
              Avanstan {tlYaz(avansOnerisi)} mahsup et
            </button>
          )}
          <Alan etiket="Not">
            <input value={form.not} onChange={(e) => yaz('not', e.target.value)} />
          </Alan>
        </section>
      </fieldset>

      <section className="kart hakedis-ozeti">
        <h2>Özet</h2>
        {satir('Hakediş tutarı', t.brutTutar)}
        {satir('Kesintiler', -t.kesintiToplam)}
        {satir('KDV', t.kdvTutari)}
        {satir('Tevkifat (vergi dairesine)', -t.tevkifatTutari)}
        <p className="ozet-tutar ozet-ara">
          <span>Ustaya borç</span>
          <span>{tlYaz(t.borcTutari)}</span>
        </p>
        {satir(`Teminat (iş bitiminde ödenir)`, -t.teminatTutari)}
        {satir('Avans mahsubu', -cevrim.girdi.avansMahsubu)}
        <p className="ozet-tutar ozet-toplam">
          <span>Şimdi ödenecek</span>
          <strong>{tlYaz(t.netTutar)}</strong>
        </p>
      </section>

      {uyarilar.length > 0 && (
        <div className="mesaj mesaj-not">
          <ul>
            {uyarilar.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      {!onayli && (
        <div className="kaydet-cubugu">
          {kutu}
          {cevrim.hatalar.length > 0 && <Hatalar hatalar={cevrim.hatalar} />}
          {hata && <Hatalar hatalar={[hata]} />}
          {mesaj && !degisti && <p className="mesaj mesaj-basari">{mesaj}</p>}
          <div className="dugmeler">
            <button type="button" disabled={(!degisti && !!hakedis) || cevrim.hatalar.length > 0} onClick={() => void kaydet()}>
              {hakedis ? 'Kaydet' : 'Taslak olarak kaydet'}
            </button>
            {hakedis && (
              <button type="button" className="ikincil" disabled={degisti || islemde} onClick={() => void onayla()}>
                Onayla
              </button>
            )}
          </div>
          {hakedis && degisti && <p className="soluk kucuk">Onaylamadan önce değişiklikleri kaydedin.</p>}
          {hakedis && !degisti && <p className="soluk kucuk">Onaylayınca tutar ustanın borcuna ve proje maliyetine yazılır.</p>}
        </div>
      )}

      {onayli && mesaj && <p className="mesaj mesaj-basari">{mesaj}</p>}

      {hakedis && <HakedisIptalKarti hakedis={hakedis} />}
    </>
  );
}

function HakedisIptalKarti({ hakedis }: { hakedis: Hakedis }) {
  const { servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  return (
    <section className="kart">
      <details>
        <summary className="soluk">Hakedişi iptal et</summary>
        <p className="soluk kucuk">
          {hakedis.onay
            ? 'Oluşturduğu gider kaydı da iptal olur; mahsup edilen avans yeniden açık kalır. Numara yeniden kullanılmaz.'
            : 'Taslak listeden kalkar, kayıt geçmişinde kalır.'}
        </p>
        {kutu}
        {hata && <Hatalar hatalar={[hata]} />}
        <button
          type="button"
          className="tehlikeli"
          onClick={() =>
            void degistir('Hakediş iptali', async (gerekce) => {
              await hakedisIptal(servis, hakedis.id, gerekce);
              git(`sozlesmeler/${hakedis.sozlesmeId}`);
            })
          }
        >
          İptal et
        </button>
      </details>
    </section>
  );
}
