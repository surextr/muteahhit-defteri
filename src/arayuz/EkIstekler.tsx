import { useEffect, useMemo, useState } from 'react';
import { bolumNo, kutucukOzeti } from '../hesap/bolum';
import { ekIstekMiktari, type MaliyetOzeti } from '../hesap/maliyet';
import { aramaUyar } from '../hesap/metin';
import { tlOku, tlYaz } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { elleSatir, projeBinasi, type ProjeBinasi } from '../servisler/maliyet';
import { FIYAT_KALEMI_TURU_ADI } from '../veri/sabit/hazirFiyatKalemleri';
import type { FiyatKalemi, MaliyetHesabi, MaliyetSatiri } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar } from './bilesenler';
import { grupAdi, tlMetni } from './Fiyatlar';
import { TutarGirdisi } from './Girdiler';

// Daire bazında ek istekler: projenin kat krokisinde bölümler seçilir, seçilenlere bölüm başı miktarla satır eklenir
// (parke, ankastre set, jakuzi…). Satır miktarı = bölüm başı × bölüm sayısı; bölümün ek maliyeti krokide görünür.

const TURLER = ['malzeme', 'iscilik', 'makine'] as const;

export function EkIstekler(p: {
  h: MaliyetHesabi;
  ozet: MaliyetOzeti;
  katalog: Map<string, FiyatKalemi>;
  kilitli: boolean;
  onKaydet: (satirlar: MaliyetSatiri[], basari: string) => Promise<boolean>;
}) {
  const { depo, oturum } = useUygulama();
  const [bina, setBina] = useState<ProjeBinasi | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [form, setForm] = useState(false);
  const projeId = p.h.projeId;
  useEffect(() => {
    if (projeId) void projeBinasi(depo, oturum.firmaId, projeId).then(setBina);
  }, [depo, oturum.firmaId, projeId]);

  const adlar = useMemo(() => {
    const blok = new Map(bina?.bloklar.map((b) => [b.id, b.ad]) ?? []);
    const tekBlok = (bina?.bloklar.length ?? 0) <= 1;
    return new Map(bina?.bolumler.map((b) => [b.id, bolumNo(tekBlok ? null : blok.get(b.blokId), b.no)]) ?? []);
  }, [bina]);
  const bolumMetni = (l: string[]) => {
    const a = l.map((id) => adlar.get(id) ?? '?');
    return a.length > 6 ? `${a.slice(0, 6).join(', ')} ve ${a.length - 6} bölüm daha` : a.join(', ');
  };
  const dayanak = (bolumIdleri: string[], birimMiktar: number, birim: string, not: string) =>
    `Ek istek: ${bolumMetni(bolumIdleri)} · bölüm başı ${sayiYaz(birimMiktar)} ${birim}${not.trim() ? ` · ${not.trim()}` : ''}`;

  if (!projeId) return null;
  const istekler = p.ozet.satirlar.filter((x) => x.satir.ekIstek);
  const toggle = (ids: string[]) =>
    setSecili((s) => {
      const y = new Set(s);
      const hepsi = ids.every((i) => y.has(i));
      for (const i of ids) (hepsi ? y.delete(i) : y.add(i));
      return y;
    });

  const bolumleriDegistir = (s: MaliyetSatiri) => {
    const l = [...secili];
    const e = { ...s.ekIstek!, bolumIdleri: l };
    void p.onKaydet(
      p.h.satirlar.map((x) => (x.id === s.id ? { ...s, ekIstek: e, miktar: ekIstekMiktari(e), dayanak: dayanak(l, e.birimMiktar, s.birim, e.not) } : x)),
      'Ek isteğin bölümleri değişti.',
    );
  };

  return (
    <details className="kart ek-istekler" open={istekler.length > 0 || undefined}>
      <summary>
        <h2>Daire bazında ek istekler</h2>
        <span className="soluk">
          {istekler.length ? `${istekler.length} istek · ${tlYaz(p.ozet.ekIstekler.tutar)} (toplamın içinde)` : 'Parke, ankastre, jakuzi gibi bazı dairelere özel işler'}
        </span>
      </summary>
      {!bina ? (
        <p>Yükleniyor…</p>
      ) : bina.bolumler.length === 0 ? (
        <p className="soluk">
          Projede bağımsız bölüm yok. Önce <a href={`#/projeler/${projeId}/bina`}>bina krokisini</a> kurun.
        </p>
      ) : (
        <>
          <p className="soluk">Krokiden bölümleri seçin (kat adına basınca bütün kat seçilir). Rakam, bölümün ek maliyetidir.</p>
          {bina.bloklar.map((blok) => {
            const katlar = bina.katlar.filter((k) => k.blokId === blok.id);
            return (
              <div key={blok.id} className="ek-kroki">
                {bina.bloklar.length > 1 && <h3>{blok.ad} Blok</h3>}
                {katlar.map((kat) => {
                  const bl = bina.bolumler.filter((b) => b.katId === kat.id);
                  if (!bl.length) return null;
                  return (
                    <div key={kat.id} className="ek-kat">
                      <button type="button" className="ek-kat-adi" disabled={p.kilitli} onClick={() => toggle(bl.map((b) => b.id))}>
                        {kat.ad}
                      </button>
                      <div className="ek-bolumler">
                        {bl.map((b) => {
                          const ek = p.ozet.bolumEkleri.get(b.id);
                          return (
                            <button
                              key={b.id}
                              type="button"
                              className={`ek-bolum ${ek ? 'var' : ''}`}
                              aria-pressed={secili.has(b.id)}
                              disabled={p.kilitli}
                              onClick={() => toggle([b.id])}
                              title={kutucukOzeti(b).replace(/ /g, ' ')}
                            >
                              <strong>{b.no}</strong>
                              <span>{ek ? `+${tlYaz(ek)}` : kutucukOzeti(b)}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
          {!p.kilitli && (
            <p className="dugmeler">
              <span className="soluk">{secili.size ? `Seçili: ${bolumMetni([...secili])}` : 'Seçili bölüm yok'}</span>
              {secili.size > 0 && (
                <>
                  <button type="button" onClick={() => setForm(true)}>
                    + Seçili {secili.size} bölüme ek istek
                  </button>
                  <button type="button" className="ikincil" onClick={() => setSecili(new Set())}>
                    Seçimi temizle
                  </button>
                </>
              )}
            </p>
          )}
          {form && secili.size > 0 && (
            <EkIstekFormu
              katalog={p.katalog}
              bolumSayisi={secili.size}
              onVazgec={() => setForm(false)}
              onEkle={async (s, e) => {
                const l = [...secili];
                const ek = { ...e, bolumIdleri: l };
                if (await p.onKaydet([...p.h.satirlar, { ...s, ekIstek: ek, miktar: ekIstekMiktari(ek), dayanak: dayanak(l, e.birimMiktar, s.birim, e.not) }], 'Ek istek eklendi.')) {
                  setForm(false);
                  setSecili(new Set());
                }
              }}
            />
          )}
          {istekler.length > 0 && (
            <ul className="ek-liste">
              {istekler.map((x) => {
                const e = x.satir.ekIstek!;
                const ilgili = e.bolumIdleri.some((b) => secili.has(b));
                return (
                  <li key={x.satir.id} className={ilgili ? 'ilgili' : ''}>
                    <div>
                      <strong>{x.satir.ad}</strong>
                      {e.not && <span className="soluk"> · {e.not}</span>}
                      <br />
                      <span className="soluk">
                        {sayiYaz(e.birimMiktar)} {x.satir.birim} × {e.bolumIdleri.length} bölüm ({bolumMetni(e.bolumIdleri)})
                      </span>
                    </div>
                    <div className="ek-tutar">
                      {x.tutar === null ? <span className="ms-yok">fiyat yok</span> : <strong>{tlYaz(x.tutar)}</strong>}
                      {!p.kilitli && (
                        <span className="dugmeler">
                          {secili.size > 0 && (
                            <button type="button" className="baglanti-dugmesi" onClick={() => bolumleriDegistir(x.satir)}>
                              Seçili bölümlere uygula
                            </button>
                          )}
                          <button
                            type="button"
                            className="baglanti-dugmesi"
                            onClick={() => void p.onKaydet(p.h.satirlar.filter((y) => y.id !== x.satir.id), 'Ek istek çıkarıldı.')}
                          >
                            Çıkar
                          </button>
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </details>
  );
}

function EkIstekFormu(p: {
  katalog: Map<string, FiyatKalemi>;
  bolumSayisi: number;
  onEkle: (s: MaliyetSatiri, e: { birimMiktar: number; not: string }) => Promise<void>;
  onVazgec: () => void;
}) {
  const [tur, setTur] = useState<MaliyetSatiri['tur']>('malzeme');
  const [arama, setArama] = useState('');
  const [kalem, setKalem] = useState<FiyatKalemi | null>(null);
  const [serbest, setSerbest] = useState(false);
  const [ad, setAd] = useState('');
  const [birim, setBirim] = useState('');
  const [miktar, setMiktar] = useState('1');
  const [not, setNot] = useState('');
  const [fiyat, setFiyat] = useState('');
  const [hata, setHata] = useState<string[]>([]);
  const adaylar = [...p.katalog.values()].filter((k) => k.tur === tur && (!arama.trim() || aramaUyar(`${k.ad} ${grupAdi(k.butceKalemiKodu)}`, arama))).slice(0, 8);
  const m = sayiOku(miktar);

  const ekle = () => {
    setHata([]);
    if (!kalem && !serbest) return setHata(['Listeden bir kalem seçin ya da "Listede yok" deyin.']);
    if (serbest && (!ad.trim() || !birim.trim())) return setHata(['İsteğin adını ve birimini yazın.']);
    if (m === null || m <= 0) return setHata(['Bölüm başı miktarı yazın.']);
    const f = fiyat.trim() ? tlOku(fiyat) : null;
    if (fiyat.trim() && f === null) return setHata(['Fiyat geçersiz.']);
    if (!kalem && f === null) return setHata(['Listede olmayan istek için birim fiyat yazın.']);
    const s = elleSatir({ kalem, tur, ad, birim, butceKalemiKodu: null, miktar: null, dayanak: 'Ek istek' });
    void p.onEkle({ ...s, ozelFiyat: f }, { birimMiktar: m, not });
  };

  return (
    <section className="kart fs-form">
      <h3>Ek istek ({p.bolumSayisi} bölüm)</h3>
      <div className="filtreler" role="group" aria-label="Tür">
        {TURLER.map((t) => (
          <button key={t} type="button" aria-pressed={tur === t} onClick={() => (setTur(t), setKalem(null))}>
            {FIYAT_KALEMI_TURU_ADI[t]}
          </button>
        ))}
      </div>
      {!serbest ? (
        <>
          <Alan etiket="Fiyat listesinden">
            <input type="search" value={kalem ? kalem.ad : arama} onChange={(e) => (setKalem(null), setArama(e.target.value))} placeholder="Ara: parke, ankastre, jakuzi…" />
          </Alan>
          {!kalem && (
            <ul className="secim-listesi">
              {adaylar.map((k) => (
                <li key={k.id}>
                  <button type="button" onClick={() => setKalem(k)}>
                    <span>{k.ad}</span>
                    <span className="soluk">
                      {k.birim}
                      {k.fiyat !== null && ` · ${tlMetni(k.fiyat)} ₺`}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <button type="button" onClick={() => setSerbest(true)}>
                  <span>Listede yok: serbest istek</span>
                </button>
              </li>
            </ul>
          )}
        </>
      ) : (
        <div className="satir-alanlar">
          <Alan etiket="İstek">
            <input value={ad} onChange={(e) => setAd(e.target.value)} placeholder="Örn. ankastre set" />
          </Alan>
          <Alan etiket="Birim">
            <input value={birim} onChange={(e) => setBirim(e.target.value)} placeholder="adet, m², takım…" />
          </Alan>
        </div>
      )}
      <div className="satir-alanlar">
        <Alan etiket={`Bölüm başı miktar${kalem ? ` (${kalem.birim})` : birim ? ` (${birim})` : ''}`} aciklama={m !== null && m > 0 ? `Toplam ${sayiYaz(Math.round(m * p.bolumSayisi * 100) / 100)}` : undefined}>
          <input inputMode="decimal" value={miktar} onChange={(e) => setMiktar(e.target.value)} />
        </Alan>
        <Alan etiket="Açıklama (isteğe bağlı)">
          <input value={not} onChange={(e) => setNot(e.target.value)} placeholder="Örn. müşteri isteği, satışta fiyatlanacak" />
        </Alan>
      </div>
      <Alan etiket="Birim fiyat (KDV hariç)" aciklama={kalem ? (kalem.fiyat !== null ? `Boşsa listedeki ${tlMetni(kalem.fiyat)} ₺` : 'Listede fiyatı yok') : 'Zorunlu'}>
        <TutarGirdisi value={fiyat} onChange={setFiyat} placeholder="0,00" />
      </Alan>
      <Hatalar hatalar={hata} />
      <div className="dugmeler">
        <button type="button" onClick={ekle}>
          Ekle
        </button>
        <button type="button" className="ikincil" onClick={p.onVazgec}>
          Vazgeç
        </button>
      </div>
    </section>
  );
}
