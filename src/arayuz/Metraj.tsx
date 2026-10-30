import { useEffect, useMemo, useState } from 'react';
import {
  basligiBul,
  kalemOnerileri,
  METRAJ_SUTUN_ADI,
  metrajAktarimi,
  metrajSatirlari,
  type MetrajSatiri,
  type MetrajSecimi,
  type MetrajSutunu,
  type SutunEslemesi,
} from '../hesap/metraj';
import { sayiYaz } from '../hesap/sayi';
import { csvOku, xlsxOku, type TabloSayfasi } from '../hesap/tabloOku';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import { hesabaProjedenYaz, katalogHaritasi, maliyetHesabiGetir } from '../servisler/maliyet';
import { FIYAT_KALEMI_TURU_ADI } from '../veri/sabit/hazirFiyatKalemleri';
import type { FiyatKalemi, MaliyetHesabi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { tlMetni } from './Fiyatlar';
import { git } from './rota';

// Mühendisin metraj tablosu (Excel/CSV): sütunlar bulunur, satırlar fiyat listesi kalemleriyle eşleştirilir, seçilenler
// maliyet hesabına "📐 projeden" olarak yazılır.

const harf = (n: number) => {
  let s = '';
  for (let i = n + 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
};

export function MetrajEkrani({ id }: { id: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [h, setH] = useState<MaliyetHesabi | null | undefined>(undefined);
  const [katalog, setKatalog] = useState<Map<string, FiyatKalemi>>(new Map());
  const [dosyaAdi, setDosyaAdi] = useState('');
  const [sayfalar, setSayfalar] = useState<TabloSayfasi[]>([]);
  const [sayfaNo, setSayfaNo] = useState(0);
  const [baslik, setBaslik] = useState<number>(-1);
  const [sutunlar, setSutunlar] = useState<SutunEslemesi>({});
  const [secimler, setSecimler] = useState<Map<number, MetrajSecimi>>(new Map());
  const [excelFiyati, setExcelFiyati] = useState(false);
  const [hata, setHata] = useState<string[]>([]);
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => {
    void maliyetHesabiGetir(depo, oturum.firmaId, id).then(setH);
    void katalogHaritasi(depo, oturum.firmaId).then(setKatalog);
  }, [depo, oturum.firmaId, id]);

  const sayfa = sayfalar[sayfaNo];
  const satirlar = useMemo(() => (sayfa && baslik >= 0 ? metrajSatirlari(sayfa.satirlar, baslik, sutunlar) : []), [sayfa, baslik, sutunlar]);
  const kalemler = useMemo(() => [...katalog.values()], [katalog]);
  const hesaptakiler = useMemo(() => new Set((h?.satirlar ?? []).flatMap((s) => (s.fiyatKalemiId ? [s.fiyatKalemiId] : []))), [h]);
  const oneriler = useMemo(() => new Map(satirlar.map((m) => [m.satirNo, kalemOnerileri(m, kalemler, hesaptakiler)])), [satirlar, kalemler, hesaptakiler]);

  // Satırlar değişince öneriden varsayılan seçim: önerisi olan ilk kalem, yoksa alınmaz.
  useEffect(() => {
    setSecimler(new Map(satirlar.map((m) => [m.satirNo, oneriler.get(m.satirNo)?.[0] ? { tur: 'kalem', kalemId: oneriler.get(m.satirNo)![0]!.id } : { tur: 'alma' }] as const)));
  }, [satirlar, oneriler]);

  if (h === undefined) return <p>Yükleniyor…</p>;
  if (h === null) return <p className="hata">Maliyet hesabı bulunamadı.</p>;

  const sayfaSec = (l: TabloSayfasi[], no: number) => {
    const b = basligiBul(l[no]?.satirlar ?? []);
    setSayfaNo(no);
    setBaslik(b?.satir ?? -1);
    setSutunlar(b?.sutunlar ?? {});
    if (!b) setHata(['Bu sayfada "Tanım" ve "Miktar" başlıklı sütunlar bulunamadı. Başlık satırını ve sütunları aşağıdan seçin.']);
  };

  const oku = async (f: File) => {
    setHata([]);
    setSayfalar([]);
    try {
      const uzanti = f.name.toLowerCase().split('.').pop();
      let l: TabloSayfasi[];
      if (uzanti === 'xlsx') l = xlsxOku(new Uint8Array(await f.arrayBuffer()));
      else if (uzanti === 'csv' || uzanti === 'txt') l = [csvOku(await f.text(), f.name)];
      else if (uzanti === 'xls') throw new IsKuraliHatasi('Eski Excel (.xls) biçimi okunmuyor. Excel\'de "Farklı kaydet → Excel Çalışma Kitabı (.xlsx)" ile kaydedip yükleyin.');
      else throw new IsKuraliHatasi('Metraj tablosu olarak .xlsx ya da .csv dosyası yükleyin.');
      const dolu = l.filter((x) => x.satirlar.some((r) => r.length));
      if (!dolu.length) throw new IsKuraliHatasi('Dosyada dolu sayfa bulunamadı.');
      setDosyaAdi(f.name);
      setSayfalar(dolu);
      // Başlığı bulunan ilk sayfa.
      const no = Math.max(0, dolu.findIndex((x) => basligiBul(x.satirlar)));
      sayfaSec(dolu, no);
    } catch (e) {
      setHata([hataMetni(e)]);
    }
  };

  const aktarim = metrajAktarimi(dosyaAdi, satirlar, secimler, katalog, h.satirlar, excelFiyati);
  const aktar = async () => {
    setHata([]);
    setMesgul(true);
    try {
      await hesabaProjedenYaz(depo, servis, h.id, aktarim);
      git(`maliyet/${h.id}`);
    } catch (e) {
      setHata([hataMetni(e)]);
      setMesgul(false);
    }
  };
  const sutunSayisi = Math.max(0, ...(sayfa?.satirlar.slice(0, 50).map((r) => r.length) ?? [0]));
  const secimDegeri = (s: MetrajSecimi | undefined) => (!s || s.tur === 'alma' ? 'alma' : s.tur === 'serbest' ? `serbest:${s.satirTuru}` : `kalem:${s.kalemId}`);
  const secimOku = (v: string): MetrajSecimi =>
    v.startsWith('kalem:') ? { tur: 'kalem', kalemId: v.slice(6) } : v.startsWith('serbest:') ? { tur: 'serbest', satirTuru: v.slice(8) as 'malzeme' } : { tur: 'alma' };
  const alinan = satirlar.filter((m) => secimler.get(m.satirNo)?.tur !== 'alma').length;

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/maliyet/${h.id}`}>← {h.ad}</a>
      </p>
      <h1>Metraj tablosundan al</h1>
      {h.onay ? (
        <p className="mesaj mesaj-uyari">Bu hesap onaylanmış; metraj almak için önce revizyon açın.</p>
      ) : (
        <section className="kart">
          <p className="soluk">
            Mühendisin metraj cetvelini (.xlsx ya da .csv) seçin. "Tanım", "Birim", "Miktar" (varsa "Birim fiyat") sütunları bulunur; her satır fiyat listesindeki bir
            kalemle eşleştirilir. Dosya bu cihazda okunur.
          </p>
          <label className="dugme dosya-dugmesi">
            📊 Metraj dosyası seç
            <input
              type="file"
              accept=".xlsx,.csv,.txt,.xls"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void oku(f);
              }}
            />
          </label>
          <Hatalar hatalar={hata} />
        </section>
      )}

      {sayfa && !h.onay && (
        <>
          <section className="kart">
            <h2>Sütunlar</h2>
            <div className="satir-alanlar">
              {sayfalar.length > 1 && (
                <Alan etiket="Sayfa">
                  <select value={sayfaNo} onChange={(e) => sayfaSec(sayfalar, Number(e.target.value))}>
                    {sayfalar.map((x, i) => (
                      <option key={x.ad + i} value={i}>
                        {x.ad}
                      </option>
                    ))}
                  </select>
                </Alan>
              )}
              <Alan etiket="Başlık satırı">
                <select value={baslik} onChange={(e) => setBaslik(Number(e.target.value))}>
                  <option value={-1}>—</option>
                  {sayfa.satirlar.slice(0, 40).map((r, i) => (
                    <option key={i} value={i}>
                      {i + 1}. satır: {r.filter((x) => x !== null).slice(0, 4).join(' | ').slice(0, 60)}
                    </option>
                  ))}
                </select>
              </Alan>
            </div>
            <div className="girdi-izgarasi">
              {(Object.keys(METRAJ_SUTUN_ADI) as MetrajSutunu[]).map((k) => (
                <Alan key={k} etiket={METRAJ_SUTUN_ADI[k]}>
                  <select
                    value={sutunlar[k] ?? -1}
                    onChange={(e) =>
                      setSutunlar((s) => {
                        const y = { ...s };
                        if (Number(e.target.value) < 0) delete y[k];
                        else y[k] = Number(e.target.value);
                        return y;
                      })
                    }
                  >
                    <option value={-1}>—</option>
                    {Array.from({ length: sutunSayisi }, (_, j) => (
                      <option key={j} value={j}>
                        {harf(j)} sütunu{baslik >= 0 && sayfa.satirlar[baslik]?.[j] !== null && sayfa.satirlar[baslik]?.[j] !== undefined ? `: ${String(sayfa.satirlar[baslik]![j]).slice(0, 30)}` : ''}
                      </option>
                    ))}
                  </select>
                </Alan>
              ))}
            </div>
          </section>

          <section className="kart">
            <h2>
              Satırlar <span className="soluk">({satirlar.length} satır, {alinan} alınacak)</span>
            </h2>
            {satirlar.length === 0 && <p className="soluk">Bu sütunlarla miktarlı satır bulunamadı.</p>}
            <ul className="metraj-listesi">
              {satirlar.map((m, i) => {
                const grupBasi = i === 0 || satirlar[i - 1]!.grup !== m.grup;
                return (
                  <li key={m.satirNo}>
                    {grupBasi && m.grup && <h3>{m.grup}</h3>}
                    <MetrajSatirGorunumu
                      m={m}
                      oneriler={oneriler.get(m.satirNo) ?? []}
                      kalemler={kalemler}
                      deger={secimDegeri(secimler.get(m.satirNo))}
                      onSec={(v) => setSecimler((s) => new Map(s).set(m.satirNo, secimOku(v)))}
                    />
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="kart">
            <h2>Hesaba aktar</h2>
            <p>
              {aktarim.guncellenecek.size} satırın miktarı değişecek, {aktarim.eklenecek.length} yeni satır eklenecek. Satırlar "📐 Projeden" işaretlenir; dayanakta dosya
              ve satır numaraları yazar.
            </p>
            {aktarim.uyarilar.map((u) => (
              <p key={u} className="mesaj mesaj-uyari">
                {u}
              </p>
            ))}
            {satirlar.some((m) => m.birimFiyat !== null) && (
              <label className="onay-kutusu">
                <input type="checkbox" checked={excelFiyati} onChange={(e) => setExcelFiyati(e.target.checked)} />
                <span>Tablodaki birim fiyatları bu hesaba özel fiyat olarak kullan (fiyat listesi değişmez)</span>
              </label>
            )}
            <Hatalar hatalar={hata} />
            <div className="dugmeler">
              <button type="button" disabled={mesgul || alinan === 0} onClick={() => void aktar()}>
                Hesaba aktar
              </button>
            </div>
          </section>
        </>
      )}
    </>
  );
}

function MetrajSatirGorunumu({ m, oneriler, kalemler, deger, onSec }: { m: MetrajSatiri; oneriler: FiyatKalemi[]; kalemler: FiyatKalemi[]; deger: string; onSec: (v: string) => void }) {
  const digerleri = kalemler.filter((k) => !oneriler.includes(k)).sort((a, b) => a.ad.localeCompare(b.ad, 'tr'));
  return (
    <div className={`metraj-satiri ${deger === 'alma' ? 'alinmayacak' : ''}`}>
      <div className="ms-ust">
        <span>
          {m.poz && <span className="soluk">{m.poz} · </span>}
          {m.tanim}
        </span>
        <strong>
          {sayiYaz(m.miktar)} {m.birim}
        </strong>
      </div>
      {m.birimFiyat !== null && <p className="kucuk-bilgi soluk">Birim fiyat {tlMetni(m.birimFiyat)} ₺</p>}
      <select value={deger} onChange={(e) => onSec(e.target.value)} aria-label={`${m.tanim} eşleşmesi`}>
        <option value="alma">— Alma</option>
        {oneriler.length > 0 && (
          <optgroup label="Önerilen kalemler">
            {oneriler.map((k) => (
              <option key={k.id} value={`kalem:${k.id}`}>
                {k.ad} ({k.birim})
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="Listede yok">
          {(['malzeme', 'iscilik', 'makine'] as const).map((t) => (
            <option key={t} value={`serbest:${t}`}>
              Serbest satır olarak ekle ({FIYAT_KALEMI_TURU_ADI[t].toLocaleLowerCase('tr-TR')})
            </option>
          ))}
        </optgroup>
        <optgroup label="Bütün kalemler">
          {digerleri.map((k) => (
            <option key={k.id} value={`kalem:${k.id}`}>
              {k.ad} ({k.birim})
            </option>
          ))}
        </optgroup>
      </select>
    </div>
  );
}
