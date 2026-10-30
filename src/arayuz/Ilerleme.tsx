import { useCallback, useEffect, useState } from 'react';
import { Simge } from './Simge';
import { kalemGecmisi, uyariEsigi, yuzdeYaz, type KalemIlerlemeSatiri } from '../hesap/ilerleme';
import { tlYaz } from '../hesap/para';
import { sayiOku } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import { ilerlemeIptal, ilerlemeKaydet, projeIlerlemesiGetir, type ProjeIlerlemeDetayi, type ProjeIlerlemeOzeti } from '../servisler/ilerleme';
import { projeGetir } from '../servisler/proje';
import type { HakedisOnerisi } from '../hesap/ilerleme';
import type { KalemIlerlemesi, Proje } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';

// ─── Ortak parçalar ────────────────────────────────────────────────

const tarihYaz = (t: string | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '—');

/** İlerleme ve harcama yüzdesi iki çubuk; harcama ilerlemenin eşikten fazla önündeyse uyarı rengi. */
export function IlerlemeCubuklari({ ilerleme, harcama, uyari }: { ilerleme: number | null; harcama: number | null; uyari: boolean }) {
  return (
    <div className="ilerleme-cubuklari">
      <div className="ic-satir">
        <span className="ic-etiket">İlerleme</span>
        <div className="ic-cubuk ic-ilerleme" role="img" aria-label={`İlerleme ${yuzdeYaz(ilerleme)}`}>
          <div style={{ width: `${Math.min(ilerleme ?? 0, 100)}%` }} />
        </div>
        <strong className="ic-deger">{ilerleme === null ? '—' : yuzdeYaz(ilerleme)}</strong>
      </div>
      <div className="ic-satir">
        <span className="ic-etiket">Harcama</span>
        <div className={`ic-cubuk ic-harcama ${uyari ? 'ic-uyari' : ''}`} role="img" aria-label={`Bütçe harcaması ${yuzdeYaz(harcama)}`}>
          <div style={{ width: `${Math.min(harcama ?? 0, 100)}%` }} />
        </div>
        <strong className="ic-deger">{harcama === null ? '—' : yuzdeYaz(harcama)}</strong>
      </div>
    </div>
  );
}

const uyariMetni = (fark: number) => `Harcama ilerlemenin ${Math.round(fark)} puan önünde.`;

/** Projeler listesindeki satır: ilerleme, harcama, devam eden aşama, uyarı. */
export function ProjeIlerlemeSatiri({ ozet }: { ozet: ProjeIlerlemeOzeti | undefined }) {
  if (!ozet) return null;
  const bilgi = [ozet.devamEden && `Devam eden: ${ozet.devamEden}`].filter(Boolean);
  if (ozet.harcamaYuzdesi === null && ozet.ilerleme === null)
    return ozet.harcanan > 0 || bilgi.length > 0 ? (
      <span className="soluk">{[...bilgi, ozet.harcanan > 0 && `Harcanan ${tlYaz(ozet.harcanan)}`].filter(Boolean).join(' · ')}</span>
    ) : null;
  return (
    <>
      <IlerlemeCubuklari ilerleme={ozet.ilerleme} harcama={ozet.harcamaYuzdesi} uyari={ozet.uyari} />
      {ozet.uyari && <span className="rozet-gecikti"><Simge ad="uyari" /> Harcama ilerlemenin önünde</span>}
      {bilgi.length > 0 && <span className="soluk">{bilgi.join(' · ')}</span>}
    </>
  );
}

// ─── Proje ekranındaki kart ────────────────────────────────────────

export function IlerlemeKarti({ projeId }: { projeId: string }) {
  const { depo, oturum, firma } = useUygulama();
  const [d, setD] = useState<ProjeIlerlemeDetayi | null>(null);
  useEffect(() => {
    void projeIlerlemesiGetir(depo, oturum.firmaId, projeId, firma.ayarlar.kdvMaliyeteDahil, uyariEsigi(firma.ayarlar)).then(setD);
  }, [depo, oturum.firmaId, projeId, firma.ayarlar]);
  if (!d) return null;
  const i = d.ilerleme;
  const uyarili = i.kalemler.filter((k) => k.uyari);
  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>İlerleme</h2>
        <a className="dugme ikincil" href={`#/projeler/${projeId}/ilerleme`}>
          {i.girildi ? 'Güncelle' : 'Yüzde gir'}
        </a>
      </div>
      {d.devamEden && <p className="kucuk-bilgi">Devam eden: {d.devamEden}</p>}
      {i.kalemler.length === 0 ? (
        <p className="soluk">Önce bütçe kalemlerini hazırlayın; ilerleme ana kalemlerde girilir.</p>
      ) : (
        <>
          {i.harcamaYuzdesi === null && <p className="soluk">Bütçe girilmediği için yüzdeler hesaplanmaz. Harcanan: {tlYaz(i.harcanan)}</p>}
          {i.harcamaYuzdesi !== null && <IlerlemeCubuklari ilerleme={i.ilerleme} harcama={i.harcamaYuzdesi} uyari={i.uyari} />}
          {!i.girildi && i.harcamaYuzdesi !== null && <p className="soluk">Ana kalemlerin tamamlanma yüzdesini girin; harcamayla karşılaştırılır.</p>}
          {i.uyari && i.fark !== null && (
            <p className="mesaj mesaj-uyari">
              {uyariMetni(i.fark)}
              {uyarili.length > 0 && ` Kalemler: ${uyarili.map((k) => k.kalem.ad).join(', ')}.`}
            </p>
          )}
          {!i.uyari && uyarili.length > 0 && <p className="mesaj-not">Harcaması önde giden kalem: {uyarili.map((k) => k.kalem.ad).join(', ')}</p>}
          {d.celismeler.length > 0 && (
            <p className="mesaj-not">
              {d.celismeler.join(' ')} <a href={`#/projeler/${projeId}`}>Takip başlıklarını güncelleyin.</a>
            </p>
          )}
          {d.oneriler.size > 0 && <p className="mesaj-not">Hakedişlerden {d.oneriler.size} kalem için yüzde önerisi var.</p>}
        </>
      )}
    </section>
  );
}

// ─── İlerleme ekranı ───────────────────────────────────────────────

export function IlerlemeEkrani({ projeId }: { projeId: string }) {
  const { depo, oturum, firma } = useUygulama();
  const [proje, setProje] = useState<Proje | null | undefined>(undefined);
  const [d, setD] = useState<ProjeIlerlemeDetayi | null>(null);
  const kdvDahil = firma.ayarlar.kdvMaliyeteDahil;
  const esik = uyariEsigi(firma.ayarlar);

  const yenile = useCallback(async () => {
    const [p, x] = await Promise.all([projeGetir(depo, oturum.firmaId, projeId), projeIlerlemesiGetir(depo, oturum.firmaId, projeId, kdvDahil, esik)]);
    setProje(p ?? null);
    setD(x);
  }, [depo, oturum.firmaId, projeId, kdvDahil, esik]);
  useEffect(() => {
    void yenile();
  }, [yenile]);

  if (proje === undefined || !d) return <p>Yükleniyor…</p>;
  if (proje === null) return <p className="hata">Proje bulunamadı.</p>;
  const i = d.ilerleme;

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <div className="baslik-satiri">
        <h1>İlerleme</h1>
        <span className="dugmeler">
          <a className="dugme ikincil" href={`#/projeler/${projeId}/fotograflar`}>
            <Simge ad="kamera" /> Fotoğraflar
          </a>
          <a className="dugme ikincil" href={`#/fotograflar/yeni/${projeId}`}>
            + Fotoğraf
          </a>
        </span>
      </div>
      <section className="kart">
        {d.devamEden && <p className="kucuk-bilgi">Devam eden: {d.devamEden}</p>}
        {i.harcamaYuzdesi === null ? (
          <p className="soluk">Bütçe girilmediği için yüzdeler hesaplanmaz. Harcanan: {tlYaz(i.harcanan)}</p>
        ) : (
          <>
            <IlerlemeCubuklari ilerleme={i.ilerleme} harcama={i.harcamaYuzdesi} uyari={i.uyari} />
            <p className="soluk">
              {tlYaz(i.harcanan)} / {tlYaz(i.butce)} bütçe ({kdvDahil ? 'KDV dahil' : 'KDV hariç'})
            </p>
          </>
        )}
        {i.uyari && i.fark !== null && <p className="mesaj mesaj-uyari">{uyariMetni(i.fark)}</p>}
        <p className="mesaj-not">
          Genel ilerleme, ana kalemlerin yüzdesinin bütçeleriyle ağırlıklı ortalamasıdır. Harcama ilerlemeyi {esik} puandan fazla geçince uyarı verilir. Yüzdesi
          girilmemiş kalem %0 sayılır.
        </p>
      </section>

      {i.kalemler.length === 0 && (
        <section className="kart">
          <p>Projede bütçe kalemi yok.</p>
          <a className="dugme" href={`#/projeler/${projeId}/butce`}>
            Bütçe hazırla
          </a>
        </section>
      )}
      <ul className="kart-listesi">
        {i.kalemler.map((k) => (
          <li key={k.kalem.id}>
            <KalemIlerlemeKarti
              projeId={projeId}
              satir={k}
              oneri={d.oneriler.get(k.kalem.id)}
              gecmis={kalemGecmisi(d.kayitlar, k.kalem.id)}
              onDegisti={yenile}
            />
          </li>
        ))}
      </ul>
    </>
  );
}

function KalemIlerlemeKarti(props: {
  projeId: string;
  satir: KalemIlerlemeSatiri;
  oneri: HakedisOnerisi | undefined;
  gecmis: KalemIlerlemesi[];
  onDegisti: () => Promise<void>;
}) {
  const { depo, servis } = useUygulama();
  const { satir: k, oneri } = props;
  const [acik, setAcik] = useState(false);
  const [yuzde, setYuzde] = useState('');
  const [tarih, setTarih] = useState(yerelGun(new Date()));
  const [not, setNot] = useState('');
  const [hatalar, setHatalar] = useState<string[]>([]);
  const { degistir, kutu, hata } = useGerekceliDegisiklik();

  async function kaydet(deger: number | null, kaynak: 'elle' | 'hakedis', aciklama: string) {
    setHatalar([]);
    try {
      await ilerlemeKaydet(depo, servis, {
        projeId: props.projeId,
        kalemId: k.kalem.id,
        tarih,
        yuzde: deger ?? Number.NaN,
        kaynak,
        hakedisId: kaynak === 'hakedis' ? (oneri?.sonHakedisId ?? null) : null,
        not: aciklama,
      });
      setAcik(false);
      setYuzde('');
      setNot('');
      await props.onDegisti();
    } catch (e) {
      setHatalar([hataMetni(e)]);
    }
  }

  return (
    <section className={`kart ${k.uyari ? 'kart-uyari' : ''}`}>
      <div className="baslik-satiri">
        <h2 className="kalem-ilerleme-adi">{k.kalem.ad}</h2>
        <strong className="buyuk-yuzde">{k.yuzde === null ? '—' : yuzdeYaz(k.yuzde)}</strong>
      </div>
      {k.butce !== null ? (
        <IlerlemeCubuklari ilerleme={k.yuzde} harcama={k.harcamaYuzdesi} uyari={k.uyari} />
      ) : (
        <p className="soluk">Bütçesi yok; genel ilerlemeye girmez.</p>
      )}
      <p className="soluk">
        {k.butce !== null && `Bütçe ${tlYaz(k.butce)} · `}Harcanan {tlYaz(k.harcanan)}
        {k.tarih && ` · son giriş ${tarihYaz(k.tarih)}`}
      </p>
      {k.uyari && k.fark !== null && <p className="rozet-gecikti"><Simge ad="uyari" /> {uyariMetni(k.fark)}</p>}

      {oneri && (
        <div className="oneri-kutusu">
          <p>
            Hakedişlere göre <strong>{yuzdeYaz(oneri.yuzde)}</strong>
            <span className="soluk">
              {' '}
              ({oneri.sozlesmeSayisi} sözleşme: {tlYaz(oneri.sozlesmeTutari)} işin {tlYaz(oneri.yapilan)} kadarı yapıldı)
            </span>
          </p>
          <button type="button" className="ikincil" onClick={() => void kaydet(oneri.yuzde, 'hakedis', '')}>
            Öneriyi kaydet
          </button>
        </div>
      )}

      {!acik ? (
        <div className="dugmeler">
          <button type="button" onClick={() => setAcik(true)}>
            {k.yuzde === null ? 'Yüzde gir' : 'Güncelle'}
          </button>
        </div>
      ) : (
        <div className="ilerleme-formu">
          <div className="iki-sutun">
            <Alan etiket="Tamamlanan (%)">
              <input
                inputMode="decimal"
                value={yuzde}
                onChange={(e) => setYuzde(e.target.value)}
                placeholder={k.yuzde === null ? '0–100' : String(k.yuzde)}
                autoFocus
              />
            </Alan>
            <Alan etiket="Tarih">
              <input type="date" value={tarih} max={yerelGun(new Date())} onChange={(e) => setTarih(e.target.value)} />
            </Alan>
          </div>
          <Alan etiket="Not (isteğe bağlı)">
            <input value={not} onChange={(e) => setNot(e.target.value)} placeholder="örn. 4. kat betonu döküldü" />
          </Alan>
          <Hatalar hatalar={hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={() => void kaydet(yuzde.trim() ? sayiOku(yuzde.replace('%', '')) : null, 'elle', not)}>
              Kaydet
            </button>
            <button type="button" className="ikincil" onClick={() => setAcik(false)}>
              Vazgeç
            </button>
          </div>
        </div>
      )}

      {props.gecmis.length > 0 && (
        <details className="ilerleme-gecmisi">
          <summary>Geçmiş ({props.gecmis.length})</summary>
          {kutu}
          <Hatalar hatalar={hata ? [hata] : []} />
          <ul className="liste">
            {props.gecmis.map((g) => (
              <li key={g.id} className={g.iptal ? 'iptal-satiri' : undefined}>
                <div>
                  <strong>{yuzdeYaz(g.yuzde)}</strong> <span className="soluk">· {tarihYaz(g.tarih)}</span>
                  {g.kaynak === 'hakedis' && <span className="soluk"> · hakedişten</span>}
                  {g.not && <span className="blok soluk">{g.not}</span>}
                  {g.iptal && <span className="blok soluk">İptal: {g.iptal.gerekce || '—'}</span>}
                </div>
                {!g.iptal && (
                  <button
                    type="button"
                    className="ikincil kucuk"
                    onClick={() =>
                      void degistir(`${yuzdeYaz(g.yuzde)} girişini iptal et`, async (gerekce) => {
                        await ilerlemeIptal(servis, g.id, gerekce);
                        await props.onDegisti();
                      })
                    }
                  >
                    İptal
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
