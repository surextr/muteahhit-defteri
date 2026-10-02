import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { ButceDugumu, ButceOzeti } from '../hesap/butce';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import {
  hazirKalemleriEkle,
  kalemEkle,
  kalemGuncelle,
  kalemIptal,
  kalemTasi,
  projeButcesiGetir,
  type KalemGirdisi,
} from '../servisler/kalem';
import { projeGetir } from '../servisler/proje';
import type { Kalem, Proje } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';

// ─── Ortak parçalar ────────────────────────────────────────────────

const yuzde = (n: number) => `%${n.toLocaleString('tr-TR', { maximumFractionDigits: 0 })}`;

/** Bütçenin ne kadarı harcandı; %100'ü aşınca kırmızı. */
export function Ilerleme({ oran }: { oran: number | null }) {
  if (oran === null) return null;
  return (
    <div className={`ilerleme ${oran > 100 ? 'ilerleme-asim' : ''}`} role="img" aria-label={`Bütçenin ${yuzde(oran)} kadarı harcandı`}>
      <div style={{ width: `${Math.min(oran, 100)}%` }} />
    </div>
  );
}

/** Bütçe kartı (proje ekranında da gösterilir). */
export function ButceOzetiKarti({ ozet, kdvDahil }: { ozet: ButceOzeti; kdvDahil: boolean }) {
  const kalan = ozet.butce - ozet.gerceklesen;
  return (
    <>
      <dl className="bilgi">
        <dt>Bütçe</dt>
        <dd>{tlYaz(ozet.butce)}</dd>
        <dt>Gerçekleşen</dt>
        <dd>{tlYaz(ozet.gerceklesen)}</dd>
        <dt>Kalan</dt>
        <dd className={kalan < 0 ? 'bakiye-borc' : undefined}>
          <strong>{tlYaz(kalan)}</strong>
        </dd>
      </dl>
      <Ilerleme oran={ozet.butce > 0 ? (ozet.gerceklesen * 100) / ozet.butce : null} />
      <p className="mesaj-not">Tutarlar KDV {kdvDahil ? 'dahil' : 'hariç'} (firma ayarı).</p>
      {ozet.kalemsiz > 0 && <p className="mesaj-not">Kalemi seçilmemiş giderler: {tlYaz(ozet.kalemsiz)}</p>}
      {ozet.butcesizHarcama > 0 && <p className="mesaj-not">Bütçesi girilmemiş kalemlerde harcama: {tlYaz(ozet.butcesizHarcama)}</p>}
    </>
  );
}

// ─── Kalem formu ───────────────────────────────────────────────────

interface KalemFormDurumu {
  ad: string;
  birim: string;
  miktar: string;
  tutar: string;
}

const kalemFormu = (k?: Kalem): KalemFormDurumu => ({
  ad: k?.ad ?? '',
  birim: k?.birim ?? '',
  miktar: k?.butceMiktari === null || k?.butceMiktari === undefined ? '' : sayiYaz(k.butceMiktari),
  tutar: k?.butceTutari === null || k?.butceTutari === undefined ? '' : tutarMetni(k.butceTutari),
});

function kalemGirdisi(f: KalemFormDurumu, butceli: boolean): { girdi: KalemGirdisi; hatalar: string[] } {
  const hatalar: string[] = [];
  const miktar = butceli && f.miktar.trim() ? sayiOku(f.miktar) : null;
  const tutar = butceli && f.tutar.trim() ? tlOku(f.tutar) : null;
  if (butceli && f.miktar.trim() && miktar === null) hatalar.push('Miktar geçerli bir sayı değil.');
  if (butceli && f.tutar.trim() && tutar === null) hatalar.push('Bütçe tutarı geçerli değil (örn. 1.250.000 ya da 850,50).');
  return { girdi: { ad: f.ad, birim: butceli ? f.birim : null, butceMiktari: miktar, butceTutari: tutar }, hatalar };
}

function KalemFormu(props: {
  baslik: string;
  kalem?: Kalem;
  /** Alt kalemi olan kalemde bütçe alanları gösterilmez. */
  butceli: boolean;
  onKaydet: (girdi: KalemGirdisi) => Promise<void> | void;
  onVazgec: () => void;
  ekHatalar?: string[];
  children?: ReactNode;
}) {
  const [form, setForm] = useState<KalemFormDurumu>(() => kalemFormu(props.kalem));
  const [hatalar, setHatalar] = useState<string[]>([]);
  const yaz = (alan: keyof KalemFormDurumu, deger: string) => setForm((f) => ({ ...f, [alan]: deger }));
  const miktar = sayiOku(form.miktar);
  const tutar = tlOku(form.tutar);
  const birimFiyat = miktar && tutar ? Math.round(tutar / miktar) : null;

  async function kaydet() {
    const { girdi, hatalar } = kalemGirdisi(form, props.butceli);
    setHatalar(hatalar);
    if (hatalar.length === 0) await props.onKaydet(girdi);
  }

  return (
    <div className="kalem-formu">
      <h3>{props.baslik}</h3>
      <Alan etiket="Kalem adı">
        <input value={form.ad} onChange={(e) => yaz('ad', e.target.value)} autoFocus />
      </Alan>
      {props.butceli ? (
        <>
          <Alan etiket="Bütçe tutarı (₺)">
            <input value={form.tutar} inputMode="decimal" placeholder="Boş: bütçe yok" onChange={(e) => yaz('tutar', e.target.value)} />
          </Alan>
          <div className="iki-sutun">
            <Alan etiket="Miktar">
              <input value={form.miktar} inputMode="decimal" placeholder="İsteğe bağlı" onChange={(e) => yaz('miktar', e.target.value)} />
            </Alan>
            <Alan etiket="Birim">
              <input value={form.birim} placeholder="m³, ton, m²" onChange={(e) => yaz('birim', e.target.value)} />
            </Alan>
          </div>
          {birimFiyat !== null && (
            <p className="mesaj-not">
              Birim fiyat: {tlYaz(birimFiyat)}
              {form.birim.trim() && ` / ${form.birim.trim()}`}
            </p>
          )}
        </>
      ) : (
        <p className="mesaj-not">Bu kalemin bütçesi alt kalemlerinin toplamıdır.</p>
      )}
      <Hatalar hatalar={[...hatalar, ...(props.ekHatalar ?? [])]} />
      {props.children}
      <div className="dugmeler">
        <button type="button" onClick={() => void kaydet()}>
          Kaydet
        </button>
        <button type="button" className="ikincil" onClick={props.onVazgec}>
          Vazgeç
        </button>
      </div>
    </div>
  );
}

// ─── Kalem satırı ─────────────────────────────────────────────────

interface SatirBaglami {
  acik: Acik;
  setAcik: (a: Acik) => void;
  hatalar: string[];
  setHatalar: (h: string[]) => void;
  hata: string | null;
  kutu: ReactNode;
  ekle: (ustKalemId: string | null) => (girdi: KalemGirdisi) => Promise<void>;
  duzenle: (k: Kalem) => (girdi: KalemGirdisi) => Promise<void>;
  kaldir: (k: Kalem) => void;
  tasi: (k: Kalem, yon: -1 | 1) => void;
}

/** Ekranın dışında tanımlı: içeride tanımlansa her yenilemede açık form sıfırlanırdı. */
function Satir({ d, ilk, son, ctx }: { d: ButceDugumu; ilk: boolean; son: boolean; ctx: SatirBaglami }) {
  const { acik, setAcik, hatalar, setHatalar, hata, kutu, ekle, duzenle, kaldir, tasi } = ctx;
  const k = d.kalem;
  const ana = k.ustKalemId === null;
  const formAcik = acik?.tur === 'duzenle' && acik.kalemId === k.id;
  return (
    <li className={ana ? 'kalem-ana' : 'kalem-alt'}>
      <button
        type="button"
        className="kalem-satiri"
        aria-expanded={formAcik}
        onClick={() => {
          setHatalar([]);
          setAcik(formAcik ? null : { tur: 'duzenle', kalemId: k.id });
        }}
      >
        <span className="kalem-adi">{k.ad}</span>
        <span className="kalem-tutar">
          {d.butce === null ? <span className="soluk">bütçe yok</span> : tlYaz(d.butce)}
          {d.gerceklesen > 0 && <span className={`soluk ${d.kalan !== null && d.kalan < 0 ? 'bakiye-borc' : ''}`}>{tlYaz(d.gerceklesen)} harcandı</span>}
        </span>
      </button>
      <Ilerleme oran={d.gerceklesen > 0 ? d.oran : null} />
      {formAcik && (
        <KalemFormu
          baslik="Kalemi düzenle"
          kalem={k}
          butceli={d.altlar.length === 0}
          onKaydet={duzenle(k)}
          onVazgec={() => setAcik(null)}
          ekHatalar={hata ? [...hatalar, hata] : hatalar}
        >
          {kutu}
          <div className="dugmeler kalem-araclari">
            <button type="button" className="ikincil" disabled={ilk} onClick={() => tasi(k, -1)}>
              ↑ Yukarı
            </button>
            <button type="button" className="ikincil" disabled={son} onClick={() => tasi(k, 1)}>
              ↓ Aşağı
            </button>
            <button type="button" className="ikincil" onClick={() => kaldir(k)}>
              Kaldır
            </button>
          </div>
        </KalemFormu>
      )}
      {ana && (
        <ul className="kalem-listesi">
          {d.altlar.map((a, i) => (
            <Satir key={a.kalem.id} d={a} ilk={i === 0} son={i === d.altlar.length - 1} ctx={ctx} />
          ))}
          {acik?.tur === 'yeni' && acik.ustKalemId === k.id ? (
            <li className="kalem-alt">
              <KalemFormu
                baslik={`${k.ad} altına kalem`}
                butceli
                onKaydet={ekle(k.id)}
                onVazgec={() => setAcik(null)}
                ekHatalar={hatalar}
              />
            </li>
          ) : (
            <li className="kalem-alt">
              <button
                type="button"
                className="baglanti-dugmesi"
                onClick={() => {
                  setHatalar([]);
                  setAcik({ tur: 'yeni', ustKalemId: k.id });
                }}
              >
                + Alt kalem
              </button>
            </li>
          )}
        </ul>
      )}
    </li>
  );
}

// ─── Ekran ─────────────────────────────────────────────────────────

type Acik = { tur: 'duzenle'; kalemId: string } | { tur: 'yeni'; ustKalemId: string | null } | null;

export function ButceEkrani({ projeId }: { projeId: string }) {
  const { depo, oturum, servis, firma } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const kdvDahil = firma.ayarlar.kdvMaliyeteDahil;
  /** undefined: okunuyor, null: proje yok */
  const [proje, setProje] = useState<Proje | null | undefined>(undefined);
  const [ozet, setOzet] = useState<ButceOzeti | null>(null);
  const [acik, setAcik] = useState<Acik>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);

  const yenile = useCallback(async () => {
    const [p, o] = await Promise.all([
      projeGetir(depo, oturum.firmaId, projeId),
      projeButcesiGetir(depo, oturum.firmaId, projeId, kdvDahil),
    ]);
    setProje(p);
    setOzet(o);
  }, [depo, oturum.firmaId, projeId, kdvDahil]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  if (proje === undefined || ozet === null) return <p>Yükleniyor…</p>;
  if (proje === null) return <p className="hata">Proje bulunamadı.</p>;

  /** Hata gösterip yeniler; başarılıysa açık formu kapatır. */
  async function dene(is: () => Promise<unknown>) {
    setHatalar([]);
    try {
      await is();
      setAcik(null);
      await yenile();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  const ekle = (ustKalemId: string | null) => (girdi: KalemGirdisi) => dene(() => kalemEkle(depo, servis, projeId, ustKalemId, girdi));

  const duzenle = (k: Kalem) => (girdi: KalemGirdisi) => {
    setHatalar([]);
    return degistir(k, `${k.ad} değişiyor`, async (g) => {
      await kalemGuncelle(depo, servis, k.id, girdi, g);
      setAcik(null);
      await yenile();
    });
  };

  const kaldir = (k: Kalem) =>
    void degistir(k, `${k.ad} kaldırılsın mı?`, async (g) => {
      await kalemIptal(depo, servis, k.id, g);
      setAcik(null);
      await yenile();
    });

  const ctx: SatirBaglami = {
    acik,
    setAcik,
    hatalar,
    setHatalar,
    hata,
    kutu,
    ekle,
    duzenle,
    kaldir,
    tasi: (k, yon) => void dene(() => kalemTasi(depo, servis, k.id, yon)),
  };

  return (
    <>
      <p>
        <a href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <h1>Bütçe</h1>

      <section className="kart">
        <ButceOzetiKarti ozet={ozet} kdvDahil={kdvDahil} />
      </section>

      {ozet.dugumler.length === 0 ? (
        <section className="kart">
          <h2>Maliyet kalemleri</h2>
          <p>Bu projede henüz kalem yok.</p>
          <p className="soluk">
            Hazır liste kaba inşaattan ince işlere, tesisattan genel giderlere kadar kalemleri getirir
            {proje.arsaTipi === 'satin_alma' ? '; satın alma projesi olduğu için arsa kalemi de eklenir' : ''}. Sonra düzenleyebilirsiniz.
          </p>
          <Hatalar hatalar={hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={() => void dene(() => hazirKalemleriEkle(depo, servis, projeId))}>
              Hazır kalemleri ekle
            </button>
            <button type="button" className="ikincil" onClick={() => setAcik({ tur: 'yeni', ustKalemId: null })}>
              Boş başla
            </button>
          </div>
        </section>
      ) : (
        <section className="kart">
          <h2>Maliyet kalemleri</h2>
          <p className="soluk">Bir kaleme dokunarak bütçesini girin. Ana kalemin bütçesi alt kalemlerinin toplamıdır.</p>
          {!acik && <Hatalar hatalar={hatalar} />}
          <ul className="kalem-listesi">
            {ozet.dugumler.map((d, i) => (
              <Satir key={d.kalem.id} d={d} ilk={i === 0} son={i === ozet.dugumler.length - 1} ctx={ctx} />
            ))}
          </ul>
        </section>
      )}

      <section className="kart">
        {acik?.tur === 'yeni' && acik.ustKalemId === null ? (
          <KalemFormu baslik="Ana kalem ekle" butceli onKaydet={ekle(null)} onVazgec={() => setAcik(null)} ekHatalar={hatalar} />
        ) : (
          <button
            type="button"
            className="ikincil genis"
            onClick={() => {
              setHatalar([]);
              setAcik({ tur: 'yeni', ustKalemId: null });
            }}
          >
            + Ana kalem ekle
          </button>
        )}
      </section>
    </>
  );
}
