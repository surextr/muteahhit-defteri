import { useEffect, useMemo, useState } from 'react';
import type { ExcelSayfasi } from '../hesap/excel';
import { fiyatDegisimleri, oranYaz, pahaliAlimlar, SAPMA_ESIGI, type FiyatGrubu } from '../hesap/fiyatSapmasi';
import { aramaUyar } from '../hesap/metin';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { alisFiyatlari, type AlisFiyatlari } from '../servisler/fiyatSapmasi';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { AktarmaDugmeleri } from './Aktarma';
import { useProjeErisimi, useUygulama } from './baglam';
import { BosDurum } from './bilesenler';
import { MaliyetSekmeleri } from './Fiyatlar';

// Alış fiyatları: kalem kalem fiyat geçmişi, en çok artan / düşen, ortalamanın üstünde alımlar (fazla ödenen), tedarikçiler.

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const sayi = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 2 });
const gunEkle = (t: string, n: number) => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const DONEMLER = [
  ['180', 'Son 6 ay'],
  ['365', 'Son 1 yıl'],
  ['', 'Hepsi'],
] as const;

export function AlisFiyatlariEkrani() {
  const { depo, oturum } = useUygulama();
  const erisim = useProjeErisimi();
  const bugun = yerelGun(new Date());
  const [donem, setDonem] = useState<string>('365');
  const [projeId, setProjeId] = useState('');
  const [projeler, setProjeler] = useState<ProjeOzeti[]>([]);
  const [v, setV] = useState<AlisFiyatlari | null>(null);
  const [arama, setArama] = useState('');
  const [acik, setAcik] = useState<string | null>(null);
  useEffect(() => {
    void projeleriListele(depo, oturum.firmaId, erisim).then((p) => setProjeler(p.filter((x) => !x.proje.iptal)));
  }, [depo, oturum.firmaId, erisim]);
  useEffect(() => {
    setV(null);
    void alisFiyatlari(depo, oturum.firmaId, { bas: donem ? gunEkle(bugun, -Number(donem)) : null, projeId: projeId || null, erisim }).then(setV);
  }, [depo, oturum.firmaId, donem, projeId, erisim, bugun]);

  const d = useMemo(() => (v ? fiyatDegisimleri(v.gruplar) : null), [v]);
  const pahali = useMemo(() => (v ? pahaliAlimlar(v.gruplar) : []), [v]);
  const projeAdi = new Map(projeler.map((p) => [p.proje.id, p.proje.ad]));

  const kalem = (g: FiyatGrubu, ek?: string) => (
    <li key={g.anahtar}>
      <button type="button" className="liste-dugmesi" aria-expanded={acik === g.anahtar} onClick={() => setAcik(acik === g.anahtar ? null : g.anahtar)}>
        <span>
          <strong>{g.ad}</strong>
          <span className="blok soluk kucuk">
            {tlYaz(g.ilk.fiyat)} → {tlYaz(g.son.fiyat)} / {g.birim} · {g.alimlar.length} alım{ek ? ` · ${ek}` : ''}
          </span>
        </span>
        <strong className={g.degisim > 0 ? 'vade-cikis' : g.degisim < 0 ? 'vade-giris' : undefined}>{oranYaz(g.degisim)}</strong>
      </button>
      {acik === g.anahtar && <KalemAyrintisi g={g} projeAdi={projeAdi} />}
    </li>
  );

  const gorunen = v ? v.gruplar.filter((g) => !arama.trim() || aramaUyar(g.ad, arama)) : [];
  const toplamFazla = pahali.reduce((t, x) => t + x.alim.fazla, 0);

  return (
    <>
      <MaliyetSekmeleri aktif="alislar" />
      <p className="soluk">
        Alış faturalarının miktarlı satırlarından, KDV hariç birim fiyatlar. Fiyat listesindeki kaleme benzeyen satırlar o kalemin biriminde toplanır (kg →
        ton). Hakediş giderleri girmez.
      </p>
      <div className="filtreler" role="group" aria-label="Dönem">
        {DONEMLER.map(([k, ad]) => (
          <button key={k} type="button" aria-pressed={donem === k} onClick={() => setDonem(k)}>
            {ad}
          </button>
        ))}
      </div>
      <div className="dugmeler">
        <select value={projeId} aria-label="Proje" onChange={(e) => setProjeId(e.target.value)}>
          <option value="">Bütün projeler</option>
          {projeler.map((p) => (
            <option key={p.proje.id} value={p.proje.id}>
              {p.proje.ad}
            </option>
          ))}
        </select>
        {v && v.gruplar.length > 0 && <AktarmaDugmeleri dosyaAdi="Alış fiyatları" sayfalar={() => excelSayfalari(v, projeAdi)} yazdir={false} />}
      </div>

      {!v ? (
        <p>Yükleniyor…</p>
      ) : v.gruplar.length === 0 ? (
        <BosDurum metin="Bu dönemde miktarı ve birimi yazılmış alış satırı yok. Gider girerken miktar ve birim yazılırsa fiyat geçmişi burada görünür." />
      ) : (
        <div className="pano">
          <div className="pano-sutun">
            <section className="kart">
              <h2>En çok artanlar</h2>
              {d!.artanlar.length === 0 ? <p className="soluk">Fiyatı artan kalem yok (en az iki alım, aralarında 14 gün gerekir).</p> : <ul className="liste">{d!.artanlar.slice(0, 10).map((g) => kalem(g, `${g.gun} günde`))}</ul>}
            </section>
            {d!.azalanlar.length > 0 && (
              <section className="kart">
                <h2>Düşenler</h2>
                <ul className="liste">{d!.azalanlar.slice(0, 5).map((g) => kalem(g, `${g.gun} günde`))}</ul>
              </section>
            )}
          </div>
          <div className="pano-sutun">
            <section className="kart">
              <h2>Ortalamanın üstünde alımlar</h2>
              {pahali.length === 0 ? (
                <p className="soluk">Yakın dönemdeki diğer alımlardan %{Math.round(SAPMA_ESIGI * 100)}'ten pahalı alım yok.</p>
              ) : (
                <>
                  <p className="soluk">
                    ±90 gündeki diğer alımların ortancasından %{Math.round(SAPMA_ESIGI * 100)}'ten pahalı {pahali.length} alım; ortanca fiyattan alınsaydı{' '}
                    <strong>{tlYaz(toplamFazla)}</strong> daha az ödenirdi.
                  </p>
                  <ul className="liste">
                    {pahali.slice(0, 15).map(({ grup, alim }) => (
                      <li key={alim.satirId}>
                        <span>
                          <a href={`#/giderler/${alim.giderId}`}>{grup.ad}</a>
                          <span className="blok soluk kucuk">
                            {tarihYaz(alim.tarih)} · {alim.cariAdi ?? 'carisiz'} · {tlYaz(alim.fiyat)} (ortanca {tlYaz(alim.ortanca!)}) {oranYaz(alim.sapma!)}
                          </span>
                        </span>
                        <strong className="vade-cikis">{tlYaz(alim.fazla)}</strong>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </div>
        </div>
      )}

      {v && v.gruplar.length > 0 && (
        <section className="kart">
          <div className="baslik-satiri">
            <h2>Bütün kalemler ({v.gruplar.length})</h2>
            <input className="kisa-arama" value={arama} placeholder="Ara" aria-label="Kalem ara" onChange={(e) => setArama(e.target.value)} />
          </div>
          <ul className="liste">{gorunen.map((g) => kalem(g, `toplam ${tlYaz(g.toplamTutar)}`))}</ul>
          {v.miktarsiz > 0 && <p className="soluk kucuk">Miktarı ya da birimi yazılmamış {v.miktarsiz} alış satırı fiyat hesabına girmedi.</p>}
        </section>
      )}
    </>
  );
}

function KalemAyrintisi({ g, projeAdi }: { g: FiyatGrubu; projeAdi: Map<string, string> }) {
  return (
    <div className="kalem-ayrintisi">
      <p className="soluk kucuk">
        Ortalama {tlYaz(g.ortalama)} · en düşük {tlYaz(g.min)} · en yüksek {tlYaz(g.max)} / {g.birim} · toplam {sayi(g.toplamMiktar)} {g.birim}
      </p>
      {g.tedarikciler.length > 1 && (
        <p className="kucuk">
          Tedarikçiler (ucuzdan pahalıya):{' '}
          {g.tedarikciler.map((t) => `${t.ad} ${tlYaz(t.ortalama)} (${t.adet})`).join(' · ')}
        </p>
      )}
      <div className="tablo-kaydir">
        <table className="veri-tablosu">
          <thead>
            <tr>
              <th scope="col">Tarih</th>
              <th scope="col">Tedarikçi</th>
              <th scope="col">Miktar</th>
              <th scope="col">Fiyat ₺</th>
              <th scope="col">Sapma</th>
            </tr>
          </thead>
          <tbody>
            {[...g.alimlar].reverse().map((a) => (
              <tr key={a.satirId}>
                <td>
                  <a href={`#/giderler/${a.giderId}`}>{tarihYaz(a.tarih)}</a>
                </td>
                <td>
                  {a.cariAdi ?? '—'}
                  {a.projeId && <span className="blok soluk kucuk">{projeAdi.get(a.projeId) ?? ''}</span>}
                </td>
                <td>
                  {sayi(a.grupMiktari)} {g.birim}
                </td>
                <td>{(a.fiyat / 100).toLocaleString('tr-TR', { maximumFractionDigits: 2 })}</td>
                <td className={a.sapma !== null && a.sapma > SAPMA_ESIGI ? 'vade-cikis' : undefined}>{a.sapma === null ? '—' : oranYaz(a.sapma)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function excelSayfalari(v: AlisFiyatlari, projeAdi: Map<string, string>): ExcelSayfasi[] {
  return [
    {
      ad: 'Kalemler',
      basliklar: ['Kalem', 'Birim', 'Alım', 'İlk fiyat', 'Son fiyat', 'Değişim %', 'Ortalama', 'En düşük', 'En yüksek', 'Toplam miktar', 'Toplam tutar', 'Fazla ödenen'],
      satirlar: v.gruplar.map((g) => [g.ad, g.birim, g.alimlar.length, g.ilk.fiyat / 100, g.son.fiyat / 100, Math.round(g.degisim * 1000) / 10, g.ortalama / 100, g.min / 100, g.max / 100, g.toplamMiktar, g.toplamTutar / 100, g.fazla / 100]),
    },
    {
      ad: 'Alımlar',
      basliklar: ['Kalem', 'Tarih', 'Tedarikçi', 'Proje', 'Satır', 'Miktar', 'Birim', 'Birim fiyat', 'Ortanca', 'Sapma %'],
      satirlar: v.gruplar.flatMap((g) =>
        g.alimlar.map((a) => [g.ad, a.tarih, a.cariAdi ?? '', a.projeId ? (projeAdi.get(a.projeId) ?? '') : '', a.aciklama, a.grupMiktari, g.birim, a.fiyat / 100, a.ortanca === null ? '' : a.ortanca / 100, a.sapma === null ? '' : Math.round(a.sapma * 1000) / 10]),
      ),
    },
  ];
}
