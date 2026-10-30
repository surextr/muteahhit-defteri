import { useCallback, useEffect, useMemo, useState } from 'react';
import { TALEP_DURUMU_ADI, teklifKarsilastir, type StokSatiri, type TalepDurumu } from '../hesap/malzeme';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import { fiyatKalemleri } from '../servisler/fiyat';
import {
  projeStogu,
  projeStokHareketleri,
  projeTalepleri,
  stokHareketiEkle,
  stokHareketiIptal,
  talepIptal,
  talepKapat,
  talepKaydet,
  talepOlustur,
  talepOzetiGetir,
  teklifCikar,
  teklifKaydet,
  teklifSec,
  teslimAl,
  type TalepOzeti,
} from '../servisler/malzeme';
import { yeniId } from '../veri/kimlik';
import type { Cari, MalzemeHareketi, MalzemeTeklifi } from '../veri/tipler';
import { AktarmaDugmeleri } from './Aktarma';
import { useUygulama } from './baglam';
import { Alan, BosDurum, Hatalar, hataMetni } from './bilesenler';
import { CariSecici } from './CariSecici';
import { TutarGirdisi } from './Girdiler';
import { git } from './rota';

// Malzeme: proje sekmesi (talepler, stok özeti), talep ekranı (malzemeler, teklifler ve karşılaştırma, sipariş, teslim),
// stok ekranı (giriş/çıkış/kalan, kullanım girişi, hareketler).

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const miktarYaz = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 3 });
const DURUM_SINIFI: Record<TalepDurumu, string> = { acik: 'rozet-taslak', teklif: 'rozet-taslak', siparis: '', kismen: 'rozet-taslak', teslim: 'rozet-tamam', kapandi: '' };

export function MalzemeSekmesi({ projeId }: { projeId: string }) {
  const { depo, oturum } = useUygulama();
  const [talepler, setTalepler] = useState<TalepOzeti[] | null>(null);
  const [stok, setStok] = useState<StokSatiri[]>([]);
  useEffect(() => {
    void projeTalepleri(depo, oturum.firmaId, projeId).then(setTalepler);
    void projeStogu(depo, oturum.firmaId, projeId).then(setStok);
  }, [depo, oturum.firmaId, projeId]);
  const acik = (talepler ?? []).filter((t) => t.durum !== 'teslim' && t.durum !== 'kapandi');
  const biten = (talepler ?? []).filter((t) => t.durum === 'teslim' || t.durum === 'kapandi');
  const satir = (o: TalepOzeti) => (
    <li key={o.talep.id}>
      <a className="kart kart-baglanti" href={`#/talepler/${o.talep.id}`}>
        <span className="baslik-satiri">
          <strong>{o.talep.satirlar.map((s) => s.ad).join(', ')}</strong>
          <span className={`etiket-cip ${DURUM_SINIFI[o.durum]}`}>{TALEP_DURUMU_ADI[o.durum]}</span>
        </span>
        <span className="soluk">
          {tarihYaz(o.talep.tarih)}
          {o.talep.gerekenTarih && ` · gerekli ${tarihYaz(o.talep.gerekenTarih)}`}
          {o.talep.teklifler.length > 0 && ` · ${o.talep.teklifler.length} teklif`}
        </span>
      </a>
    </li>
  );
  return (
    <div className="pano">
      <div className="pano-sutun">
        <div className="dugmeler">
          <a className="dugme" href={`#/talepler/yeni/${projeId}`}>
            + Malzeme talebi
          </a>
        </div>
        {talepler === null && <p>Yükleniyor…</p>}
        {talepler?.length === 0 && <BosDurum metin="Talep yok. Şantiye ihtiyacı yazar, teklifler karşılaştırılır, sipariş verilir, teslim alınan malzeme stoğa girer." />}
        {acik.length > 0 && (
          <>
            <h2>Açık talepler</h2>
            <ul className="kart-listesi liste-arasi">{acik.map(satir)}</ul>
          </>
        )}
        {biten.length > 0 && (
          <details>
            <summary>Tamamlananlar ({biten.length})</summary>
            <ul className="kart-listesi liste-arasi">{biten.map(satir)}</ul>
          </details>
        )}
      </div>
      <div className="pano-sutun">
        <section className="kart">
          <div className="baslik-satiri">
            <h2>Şantiye stoku</h2>
            <a href={`#/projeler/${projeId}/stok`}>Stok ve hareketler</a>
          </div>
          {stok.length === 0 ? (
            <p className="soluk">Teslim alınan malzeme burada görünür; kullanılanı "Stok ve hareketler"den düşün.</p>
          ) : (
            <ul className="liste">
              {stok.slice(0, 10).map((s) => (
                <li key={s.anahtar}>
                  <span>{s.ad}</span>
                  <strong>
                    {miktarYaz(s.kalan)} {s.birim}
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

interface SatirFormu {
  id: string;
  ad: string;
  miktar: string;
  birim: string;
  not: string;
}

/** Yeni talep (`talepId` yok, `projeId` var) ya da var olan talep. */
export function TalepEkrani({ talepId, projeId: yeniProjeId }: { talepId?: string; projeId?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [o, setO] = useState<TalepOzeti | null | undefined>(talepId ? undefined : null);
  const [tarih, setTarih] = useState(yerelGun(new Date()));
  const [gereken, setGereken] = useState('');
  const [aciklama, setAciklama] = useState('');
  const [satirlar, setSatirlar] = useState<SatirFormu[]>([{ id: yeniId(), ad: '', miktar: '', birim: '', not: '' }]);
  const [adlar, setAdlar] = useState<{ ad: string; birim: string }[]>([]);
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [projeAdi, setProjeAdi] = useState('');
  const [hata, setHata] = useState<string[]>([]);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [teslimMesaji, setTeslimMesaji] = useState<string | null>(null);

  const formaCevir = (x: TalepOzeti) => {
    setTarih(x.talep.tarih);
    setGereken(x.talep.gerekenTarih ?? '');
    setAciklama(x.talep.aciklama);
    setSatirlar(x.talep.satirlar.map((s) => ({ id: s.id, ad: s.ad, miktar: sayiYaz(s.miktar), birim: s.birim, not: s.not })));
  };
  const yukle = useCallback(async () => {
    if (!talepId) return;
    const x = await talepOzetiGetir(depo, oturum.firmaId, talepId);
    setO(x);
    if (x) formaCevir(x);
  }, [depo, oturum.firmaId, talepId]);
  const projeId = o?.talep.projeId ?? yeniProjeId ?? '';
  useEffect(() => {
    void yukle();
    void carileriListele(depo, oturum.firmaId).then(setCariler);
    void fiyatKalemleri(depo, oturum.firmaId).then((l) => setAdlar(l.filter((k) => k.tur === 'malzeme').map((k) => ({ ad: k.ad, birim: k.birim }))));
  }, [yukle, depo, oturum.firmaId]);
  useEffect(() => {
    if (projeId) void depo.getir('proje', projeId).then((p) => setProjeAdi(p?.ad ?? ''));
  }, [depo, projeId]);

  if (o === undefined) return <p>Yükleniyor…</p>;
  if (talepId && o === null) return <p className="hata">Talep bulunamadı.</p>;

  const icerik = () => {
    const h: string[] = [];
    const l = satirlar
      .filter((s) => s.ad.trim() || s.miktar.trim())
      .map((s) => {
        const m = sayiOku(s.miktar);
        if (m === null) h.push(`${s.ad || 'Malzeme'}: miktar okunamadı.`);
        return { id: s.id, ad: s.ad, miktar: m ?? 0, birim: s.birim, not: s.not };
      });
    return { icerik: { tarih, gerekenTarih: gereken || null, aciklama, satirlar: l }, hatalar: h };
  };
  const kaydet = async () => {
    setHata([]);
    setMesaj(null);
    const c = icerik();
    if (c.hatalar.length) return setHata(c.hatalar);
    try {
      if (!talepId) {
        const t = await talepOlustur(depo, servis, projeId, c.icerik);
        git(`talepler/${t.id}`);
      } else {
        await talepKaydet(depo, servis, talepId, c.icerik);
        await yukle();
        setMesaj('Kaydedildi.');
      }
    } catch (e) {
      setHata([hataMetni(e)]);
    }
  };
  const satirYaz = (i: number, d: Partial<SatirFormu>) => setSatirlar((l) => l.map((s, j) => (j === i ? { ...s, ...d } : s)));
  const adSecildi = (i: number, ad: string) => {
    const k = adlar.find((x) => x.ad === ad);
    satirYaz(i, k && !satirlar[i]!.birim ? { ad, birim: k.birim } : { ad });
  };

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}/malzeme`}>← {projeAdi || 'Proje'} · Malzeme</a>
      </p>
      <div className="baslik-satiri">
        <h1>{talepId ? 'Malzeme talebi' : 'Yeni malzeme talebi'}</h1>
        {o && <span className={`etiket-cip ${DURUM_SINIFI[o.durum]}`}>{TALEP_DURUMU_ADI[o.durum]}</span>}
      </div>

      <section className="kart">
        <h2>Malzemeler</h2>
        <datalist id="malzeme-adlari">
          {adlar.map((a) => (
            <option key={a.ad} value={a.ad} />
          ))}
        </datalist>
        {satirlar.map((s, i) => (
          <div key={s.id} className="talep-satiri">
            <input list="malzeme-adlari" value={s.ad} placeholder="Malzeme (örn. çimento)" aria-label={`${i + 1}. malzeme`} onChange={(e) => adSecildi(i, e.target.value)} />
            <input inputMode="decimal" value={s.miktar} placeholder="Miktar" aria-label={`${i + 1}. miktar`} onChange={(e) => satirYaz(i, { miktar: e.target.value })} />
            <input value={s.birim} placeholder="Birim" aria-label={`${i + 1}. birim`} onChange={(e) => satirYaz(i, { birim: e.target.value })} />
            <button type="button" className="ikincil" aria-label={`${i + 1}. satırı çıkar`} onClick={() => setSatirlar((l) => l.filter((_, j) => j !== i))}>
              ✕
            </button>
            {o && (o.teslim.get(s.id) ?? 0) > 0 && (
              <span className="soluk kucuk talep-teslim">
                Teslim alınan {miktarYaz(o.teslim.get(s.id)!)} {s.birim}
              </span>
            )}
          </div>
        ))}
        <button type="button" className="baglanti-dugmesi" onClick={() => setSatirlar((l) => [...l, { id: yeniId(), ad: '', miktar: '', birim: '', not: '' }])}>
          + Malzeme ekle
        </button>
        <div className="iki-sutun">
          <Alan etiket="Talep tarihi">
            <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
          </Alan>
          <Alan etiket="Şantiyede gereken gün">
            <input type="date" value={gereken} onChange={(e) => setGereken(e.target.value)} />
          </Alan>
        </div>
        <Alan etiket="Not">
          <textarea rows={2} value={aciklama} placeholder="örn. 3. kat döşeme için, vinçle indirilecek" onChange={(e) => setAciklama(e.target.value)} />
        </Alan>
        <Hatalar hatalar={hata} />
        {mesaj && <p className="mesaj mesaj-basari">{mesaj}</p>}
        <div className="dugmeler">
          <button type="button" onClick={() => void kaydet()}>
            {talepId ? 'Kaydet' : 'Talebi oluştur'}
          </button>
        </div>
      </section>

      {o && (
        <>
          <Teklifler o={o} cariler={cariler} onCariEklendi={(c) => setCariler((l) => [...l, { cari: c, bakiye: 0 }])} onDegisti={yukle} />
          {teslimMesaji && <p className="mesaj mesaj-basari">{teslimMesaji}</p>}
          {o.talep.seciliTeklifId && o.durum !== 'teslim' && (
            <TeslimFormu
              key={[...o.teslim].join()}
              o={o}
              onDegisti={async () => {
                await yukle();
                setTeslimMesaji('Teslim alındı; malzeme stoğa girdi.');
              }}
            />
          )}
          <TalepSonu o={o} cariler={cariler} onDegisti={yukle} />
        </>
      )}
    </>
  );
}

function Teklifler({ o, cariler, onCariEklendi, onDegisti }: { o: TalepOzeti; cariler: CariOzeti[]; onCariEklendi: (c: Cari) => void; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const [duzenle, setDuzenle] = useState<MalzemeTeklifi | 'yeni' | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const k = useMemo(() => teklifKarsilastir(o.talep), [o.talep]);
  const cariAdi = new Map(cariler.map((c) => [c.cari.id, c.cari.ad]));
  const teslimBasladi = [...o.teslim.values()].some((x) => x > 0);
  const calistir = async (is: () => Promise<unknown>) => {
    setHata(null);
    try {
      await is();
      await onDegisti();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };
  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Teklifler</h2>
        {!duzenle && !teslimBasladi && (
          <button type="button" className="ikincil" onClick={() => setDuzenle('yeni')}>
            + Teklif ekle
          </button>
        )}
      </div>
      {o.talep.teklifler.length === 0 && !duzenle && <p className="soluk">Tedarikçilerden fiyat alıp girin; en ucuzu işaretlenir.</p>}
      {o.talep.teklifler.length > 0 && (
        <div className="tablo-kaydir">
          <table className="veri-tablosu teklif-tablosu">
            <thead>
              <tr>
                <th>Malzeme</th>
                {k.toplamlar.map((t) => (
                  <th key={t.teklif.id} className={o.talep.seciliTeklifId === t.teklif.id ? 'teklif-secili' : undefined}>
                    {cariAdi.get(t.teklif.cariId) ?? '?'}
                    {t.teklif.teslimGun !== null && <span className="soluk kucuk"> · {t.teklif.teslimGun} gün</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {o.talep.satirlar.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.ad}{' '}
                    <span className="soluk kucuk">
                      {miktarYaz(s.miktar)} {s.birim}
                    </span>
                  </td>
                  {k.toplamlar.map((t) => {
                    const f = t.teklif.fiyatlar[s.id];
                    return (
                      <td key={t.teklif.id} className={`sayi ${k.enUcuz.get(s.id) === t.teklif.id ? 'teklif-ucuz' : ''}`}>
                        {f === null || f === undefined ? <span className="soluk">—</span> : tlYaz(f)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="teklif-toplam">
                <th>Toplam (KDV dahil)</th>
                {k.toplamlar.map((t) => (
                  <td key={t.teklif.id} className={`sayi ${k.enIyi === t.teklif.id ? 'teklif-ucuz' : ''}`}>
                    <strong>{tlYaz(t.tutar + t.kdv)}</strong>
                    {t.eksik > 0 && <div className="soluk kucuk">{t.eksik} malzeme fiyatsız</div>}
                  </td>
                ))}
              </tr>
              <tr>
                <td />
                {k.toplamlar.map((t) => (
                  <td key={t.teklif.id} className="teklif-islem">
                    {o.talep.seciliTeklifId === t.teklif.id ? (
                      <span className="rozet-tamam">✓ Sipariş</span>
                    ) : (
                      !teslimBasladi && (
                        <button type="button" className={k.enIyi === t.teklif.id ? '' : 'ikincil'} onClick={() => void calistir(() => teklifSec(depo, servis, o.talep.id, t.teklif.id))}>
                          Seç
                        </button>
                      )
                    )}
                    {!teslimBasladi && (
                      <button type="button" className="baglanti-dugmesi" onClick={() => setDuzenle(t.teklif)}>
                        Düzenle
                      </button>
                    )}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
      {o.talep.seciliTeklifId && !teslimBasladi && (
        <p>
          <button type="button" className="baglanti-dugmesi" onClick={() => void calistir(() => teklifSec(depo, servis, o.talep.id, null))}>
            Siparişi geri al
          </button>
        </p>
      )}
      {hata && <Hatalar hatalar={[hata]} />}
      {duzenle && (
        <TeklifFormu
          o={o}
          teklif={duzenle === 'yeni' ? null : duzenle}
          cariler={cariler}
          onCariEklendi={onCariEklendi}
          onBitti={async () => {
            setDuzenle(null);
            await onDegisti();
          }}
          onVazgec={() => setDuzenle(null)}
        />
      )}
    </section>
  );
}

function TeklifFormu(p: {
  o: TalepOzeti;
  teklif: MalzemeTeklifi | null;
  cariler: CariOzeti[];
  onCariEklendi: (c: Cari) => void;
  onBitti: () => Promise<void>;
  onVazgec: () => void;
}) {
  const { depo, servis } = useUygulama();
  const [cariId, setCariId] = useState<string | null>(p.teklif?.cariId ?? null);
  const [tarih, setTarih] = useState(p.teklif?.tarih ?? yerelGun(new Date()));
  const [kdv, setKdv] = useState(p.teklif?.kdvOrani ?? 20);
  const [gun, setGun] = useState(p.teklif?.teslimGun !== null && p.teklif?.teslimGun !== undefined ? String(p.teklif.teslimGun) : '');
  const [not, setNot] = useState(p.teklif?.not ?? '');
  const [fiyatlar, setFiyatlar] = useState<Record<string, string>>(
    Object.fromEntries(p.o.talep.satirlar.map((s) => [s.id, p.teklif?.fiyatlar[s.id] ? tutarMetni(p.teklif.fiyatlar[s.id]!) : ''])),
  );
  const [hata, setHata] = useState<string | null>(null);
  const kaydet = async () => {
    setHata(null);
    if (!cariId) return setHata('Teklifi veren tedarikçiyi seçin.');
    const f: Record<string, number | null> = {};
    for (const s of p.o.talep.satirlar) {
      const m = fiyatlar[s.id]?.trim() ?? '';
      const v = m ? tlOku(m) : null;
      if (m && v === null) return setHata(`${s.ad}: fiyat okunamadı.`);
      f[s.id] = v;
    }
    try {
      await teklifKaydet(depo, servis, p.o.talep.id, { ...(p.teklif ? { id: p.teklif.id } : {}), cariId, tarih, fiyatlar: f, kdvOrani: kdv, teslimGun: gun ? Number(gun) : null, not });
      await p.onBitti();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };
  return (
    <div className="islem-formu">
      <h3>{p.teklif ? 'Teklifi düzenle' : 'Yeni teklif'}</h3>
      <div className="alan">
        <span className="alan-etiket">Tedarikçi</span>
        <CariSecici
          cariler={p.cariler}
          secili={cariId}
          onSec={setCariId}
          oncelikli={['tedarikci']}
          hizliEkle={{ rol: 'tedarikci', onEklendi: (c) => (p.onCariEklendi(c), setCariId(c.id)) }}
        />
      </div>
      {p.o.talep.satirlar.map((s) => (
        <Alan key={s.id} etiket={`${s.ad} · birim fiyat (KDV hariç, ₺ / ${s.birim})`}>
          <TutarGirdisi value={fiyatlar[s.id] ?? ''} placeholder="Fiyat vermediyse boş" onChange={(v) => setFiyatlar((x) => ({ ...x, [s.id]: v }))} />
        </Alan>
      ))}
      <div className="iki-sutun">
        <Alan etiket="KDV">
          <select value={kdv} onChange={(e) => setKdv(Number(e.target.value))}>
            {[0, 1, 10, 20].map((x) => (
              <option key={x} value={x}>
                %{x}
              </option>
            ))}
          </select>
        </Alan>
        <Alan etiket="Teslim süresi (gün)">
          <input inputMode="numeric" value={gun} onChange={(e) => setGun(e.target.value.replace(/\D/g, ''))} />
        </Alan>
        <Alan etiket="Teklif tarihi">
          <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
        </Alan>
        <Alan etiket="Not">
          <input value={not} placeholder="örn. nakliye dahil" onChange={(e) => setNot(e.target.value)} />
        </Alan>
      </div>
      {hata && <Hatalar hatalar={[hata]} />}
      <div className="dugmeler">
        <button type="button" onClick={() => void kaydet()}>
          Kaydet
        </button>
        <button type="button" className="ikincil" onClick={p.onVazgec}>
          Vazgeç
        </button>
        {p.teklif && (
          <button
            type="button"
            className="baglanti-dugmesi"
            onClick={() =>
              void teklifCikar(depo, servis, p.o.talep.id, p.teklif!.id)
                .then(p.onBitti)
                .catch((e: unknown) => setHata(hataMetni(e)))
            }
          >
            Teklifi çıkar
          </button>
        )}
      </div>
    </div>
  );
}

function TeslimFormu({ o, onDegisti }: { o: TalepOzeti; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const kalan = (sid: string, m: number) => Math.max(0, m - (o.teslim.get(sid) ?? 0));
  const [miktarlar, setMiktarlar] = useState<Record<string, string>>(Object.fromEntries(o.talep.satirlar.map((s) => [s.id, sayiYaz(kalan(s.id, s.miktar)) || ''])));
  const [tarih, setTarih] = useState(yerelGun(new Date()));
  const [irsaliye, setIrsaliye] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const kaydet = async () => {
    setHata(null);
    const m = new Map<string, number>();
    for (const s of o.talep.satirlar) {
      const v = miktarlar[s.id]?.trim() ? sayiOku(miktarlar[s.id]!) : 0;
      if (v === null) return setHata(`${s.ad}: miktar okunamadı.`);
      m.set(s.id, v);
    }
    try {
      await teslimAl(depo, servis, o.talep.id, { tarih, irsaliyeNo: irsaliye, miktarlar: m, not: '' });
      await onDegisti();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };
  return (
    <section className="kart">
      <h2>Teslim al</h2>
      <p className="soluk kucuk">Gelen miktarı yazın (eksik geldiyse gelen kadarını); kalanı sonra teslim alırsınız.</p>
      {o.talep.satirlar.map((s) => (
        <Alan key={s.id} etiket={`${s.ad} (${s.birim})`} aciklama={`Talep ${miktarYaz(s.miktar)} · kalan ${miktarYaz(kalan(s.id, s.miktar))}`}>
          <input inputMode="decimal" value={miktarlar[s.id] ?? ''} onChange={(e) => setMiktarlar((x) => ({ ...x, [s.id]: e.target.value }))} />
        </Alan>
      ))}
      <div className="iki-sutun">
        <Alan etiket="Teslim tarihi">
          <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
        </Alan>
        <Alan etiket="İrsaliye no">
          <input value={irsaliye} onChange={(e) => setIrsaliye(e.target.value)} />
        </Alan>
      </div>
      {hata && <Hatalar hatalar={[hata]} />}
      <div className="dugmeler">
        <button type="button" onClick={() => void kaydet()}>
          Teslim alındı
        </button>
      </div>
    </section>
  );
}

function TalepSonu({ o, cariler, onDegisti }: { o: TalepOzeti; cariler: CariOzeti[]; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const [hata, setHata] = useState<string | null>(null);
  const secili = o.talep.teklifler.find((x) => x.id === o.talep.seciliTeklifId);
  const teslimVar = [...o.teslim.values()].some((x) => x > 0);
  return (
    <section className="kart">
      {secili && teslimVar && (
        <p className="mesaj mesaj-not">
          Faturası gelince gider olarak girin:{' '}
          <a href={`#/giderler/yeni/${o.talep.projeId}/${secili.cariId}`}>{cariler.find((c) => c.cari.id === secili.cariId)?.cari.ad ?? 'Tedarikçi'} için gider gir</a>
        </p>
      )}
      <div className="dugmeler">
        {o.durum !== 'teslim' &&
          (o.talep.kapandi ? (
            <button type="button" className="ikincil" onClick={() => void talepKapat(depo, servis, o.talep.id, false).then(onDegisti)}>
              Talebi yeniden aç
            </button>
          ) : (
            teslimVar && (
              <button type="button" className="ikincil" onClick={() => void talepKapat(depo, servis, o.talep.id, true).then(onDegisti)}>
                Eksikle kapat
              </button>
            )
          ))}
        {!teslimVar && (
          <button
            type="button"
            className="tehlikeli"
            onClick={() =>
              void talepIptal(depo, servis, o.talep.id)
                .then(() => git(`projeler/${o.talep.projeId}/malzeme`))
                .catch((e: unknown) => setHata(hataMetni(e)))
            }
          >
            Talebi iptal et
          </button>
        )}
      </div>
      {hata && <Hatalar hatalar={[hata]} />}
    </section>
  );
}

// ─── Stok ─────────────────────────────────────────────────────────

export function StokEkrani({ projeId }: { projeId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [stok, setStok] = useState<StokSatiri[] | null>(null);
  const [hareketler, setHareketler] = useState<MalzemeHareketi[]>([]);
  const [projeAdi, setProjeAdi] = useState('');
  const [form, setForm] = useState<{ tur: 'giris' | 'cikis'; ad: string; birim: string; miktar: string; tarih: string; not: string } | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const yukle = useCallback(async () => {
    setStok(await projeStogu(depo, oturum.firmaId, projeId));
    setHareketler(await projeStokHareketleri(depo, oturum.firmaId, projeId));
  }, [depo, oturum.firmaId, projeId]);
  useEffect(() => {
    void yukle();
    void depo.getir('proje', projeId).then((p) => setProjeAdi(p?.ad ?? ''));
  }, [yukle, depo, projeId]);

  const kaydet = async () => {
    if (!form) return;
    setHata(null);
    const m = sayiOku(form.miktar);
    if (m === null) return setHata('Miktarı yazın.');
    try {
      await stokHareketiEkle(depo, servis, projeId, { tarih: form.tarih, tur: form.tur, ad: form.ad, birim: form.birim, miktar: m, not: form.not });
      setForm(null);
      await yukle();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };
  const yeniForm = (tur: 'giris' | 'cikis', s?: StokSatiri) => setForm({ tur, ad: s?.ad ?? '', birim: s?.birim ?? '', miktar: '', tarih: yerelGun(new Date()), not: '' });

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}/malzeme`}>← {projeAdi || 'Proje'} · Malzeme</a>
      </p>
      <div className="baslik-satiri">
        <h1>Şantiye stoku</h1>
        {stok && stok.length > 0 && (
          <AktarmaDugmeleri
            dosyaAdi={`Stok ${projeAdi}`}
            sayfalar={() => [
              { ad: 'Stok', ust: [`${projeAdi} şantiye stoku`], basliklar: ['Malzeme', 'Birim', 'Giren', 'Kullanılan', 'Kalan', 'Son hareket'], satirlar: stok.map((s) => [s.ad, s.birim, s.giris, s.cikis, s.kalan, { tarih: s.sonTarih }]) },
            ]}
          />
        )}
      </div>
      <div className="dugmeler">
        <button type="button" onClick={() => yeniForm('cikis')}>
          − Kullanım gir
        </button>
        <button type="button" className="ikincil" onClick={() => yeniForm('giris')}>
          + Elle giriş
        </button>
      </div>
      {form && (
        <section className="kart islem-formu">
          <h2>{form.tur === 'cikis' ? 'Şantiyede kullanılan' : 'Stoğa giriş (talepsiz)'}</h2>
          <datalist id="stok-adlari">
            {(stok ?? []).map((s) => (
              <option key={s.anahtar} value={s.ad} />
            ))}
          </datalist>
          <div className="iki-sutun">
            <Alan etiket="Malzeme">
              <input
                list="stok-adlari"
                value={form.ad}
                onChange={(e) => {
                  const s = stok?.find((x) => x.ad === e.target.value);
                  setForm({ ...form, ad: e.target.value, birim: s && !form.birim ? s.birim : form.birim });
                }}
              />
            </Alan>
            <Alan etiket="Birim">
              <input value={form.birim} onChange={(e) => setForm({ ...form, birim: e.target.value })} />
            </Alan>
            <Alan etiket="Miktar" aciklama={form.tur === 'cikis' ? `Stokta ${miktarYaz(stok?.find((x) => x.ad === form.ad)?.kalan ?? 0)}` : undefined}>
              <input inputMode="decimal" value={form.miktar} onChange={(e) => setForm({ ...form, miktar: e.target.value })} />
            </Alan>
            <Alan etiket="Tarih">
              <input type="date" value={form.tarih} onChange={(e) => setForm({ ...form, tarih: e.target.value })} />
            </Alan>
          </div>
          <Alan etiket="Not">
            <input value={form.not} placeholder={form.tur === 'cikis' ? 'örn. 3. kat döşeme' : 'örn. başka şantiyeden geldi'} onChange={(e) => setForm({ ...form, not: e.target.value })} />
          </Alan>
          {hata && <Hatalar hatalar={[hata]} />}
          <div className="dugmeler">
            <button type="button" onClick={() => void kaydet()}>
              Kaydet
            </button>
            <button type="button" className="ikincil" onClick={() => setForm(null)}>
              Vazgeç
            </button>
          </div>
        </section>
      )}
      {stok === null && <p>Yükleniyor…</p>}
      {stok?.length === 0 && <BosDurum metin="Stokta malzeme yok. Teslim alınan talepler ve elle girişler burada görünür." />}
      {stok && stok.length > 0 && (
        <section className="kart">
          <table className="veri-tablosu stok-tablosu">
            <thead>
              <tr>
                <th>Malzeme</th>
                <th className="sayi">Giren</th>
                <th className="sayi">Kullanılan</th>
                <th className="sayi">Kalan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {stok.map((s) => (
                <tr key={s.anahtar}>
                  <td>
                    {s.ad} <span className="soluk kucuk">{s.birim}</span>
                  </td>
                  <td className="sayi">{miktarYaz(s.giris)}</td>
                  <td className="sayi">{miktarYaz(s.cikis)}</td>
                  <td className="sayi">
                    <strong>{miktarYaz(s.kalan)}</strong>
                  </td>
                  <td>
                    {s.kalan > 0 && (
                      <button type="button" className="baglanti-dugmesi" onClick={() => yeniForm('cikis', s)}>
                        Kullan
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {hareketler.length > 0 && (
        <section className="kart">
          <h2>Hareketler</h2>
          <ul className="liste">
            {hareketler.slice(0, 100).map((h) => (
              <li key={h.id}>
                <span>
                  <span className={h.tur === 'giris' ? 'bh-giris' : 'bakiye-borc'}>{h.tur === 'giris' ? '+' : '−'}</span> {miktarYaz(h.miktar)} {h.birim} {h.ad}
                  <span className="soluk kucuk">
                    {' '}
                    · {tarihYaz(h.tarih)}
                    {h.irsaliyeNo && ` · irsaliye ${h.irsaliyeNo}`}
                    {h.not && ` · ${h.not}`}
                    {h.talepId && (
                      <>
                        {' · '}
                        <a href={`#/talepler/${h.talepId}`}>talep</a>
                      </>
                    )}
                  </span>
                </span>
                <button type="button" className="baglanti-dugmesi" onClick={() => void stokHareketiIptal(depo, servis, h.id).then(yukle)}>
                  İptal
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
