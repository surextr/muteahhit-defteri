import { useCallback, useEffect, useState } from 'react';
import { yazdir } from '../cihaz/paylas';
import { bakiyeMetni, hareketAdi, farkYorumu, MUTABAKAT_DURUMU_ADI, mutabakatDurumu, mutabakatMesaji, type MutabakatDurumu } from '../hesap/mutabakat';
import { tlOku, tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import {
  cariMutabakatlari,
  mutabakatAyrintisi,
  mutabakatCozuldu,
  mutabakatGonderildi,
  mutabakatHazirla,
  mutabakatIptal,
  mutabakatListesi,
  mutabakatYaniti,
  type MutabakatAyrintisi,
  type MutabakatListeSatiri,
} from '../servisler/mutabakat';
import type { Mutabakat } from '../veri/tipler';
import { useUygulama } from './baglam';
import { BelgelerKarti } from './Belgeler';
import { SozlesmeBelgesiGorunumu } from './BelgeGorunumu';
import { Alan, BosDurum, Hatalar, hataMetni } from './bilesenler';
import { TutarGirdisi } from './Girdiler';
import { PdfPaylasDugmesi, WhatsappDugmesi } from './Paylas';
import { git } from './rota';
import { Simge } from './Simge';

// Cari mutabakatı: toplu hazırlama listesi, mutabakat ekranı (mektup, gönderim, yanıt, fark), cari kartındaki özet.

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const bugun = () => yerelGun(new Date());
/** Geçen ayın son günü (dönem sonu mutabakatı için varsayılan). */
const gecenAySonu = () => {
  const d = new Date(`${bugun().slice(0, 7)}-01T00:00:00Z`);
  return new Date(d.getTime() - 86_400_000).toISOString().slice(0, 10);
};
const DURUM_SINIFI: Record<MutabakatDurumu, string> = { hazir: 'rozet-taslak', gonderildi: 'rozet-taslak', mutabik: 'rozet-tamam', farkli: 'rozet-gecikti', cozuldu: 'rozet-tamam' };

function DurumCipi({ d }: { d: MutabakatDurumu }) {
  return <span className={`etiket-cip ${DURUM_SINIFI[d]}`}>{MUTABAKAT_DURUMU_ADI[d]}</span>;
}

// ─── Toplu liste ────────────────────────────────────────────────────

export function MutabakatlarEkrani() {
  const { depo, oturum, servis } = useUygulama();
  const [tarih, setTarih] = useState(gecenAySonu());
  const [liste, setListe] = useState<MutabakatListeSatiri[] | null>(null);
  const [secili, setSecili] = useState<Set<string>>(new Set());
  const [hata, setHata] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const yukle = useCallback(async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tarih)) return;
    setListe(null);
    setListe(await mutabakatListesi(depo, oturum.firmaId, tarih));
  }, [depo, oturum.firmaId, tarih]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  const hazirla = async () => {
    setHata(null);
    setMesaj(null);
    const hatalar: string[] = [];
    let n = 0;
    for (const id of secili) {
      try {
        await mutabakatHazirla(depo, servis, id, tarih);
        n++;
      } catch (e) {
        hatalar.push(`${liste?.find((x) => x.cari.id === id)?.cari.ad ?? '?'}: ${hataMetni(e)}`);
      }
    }
    setSecili(new Set());
    if (n) setMesaj(`${n} mutabakat hazırlandı. Her birini açıp PDF ya da WhatsApp ile gönderin.`);
    if (hatalar.length) setHata(hatalar.join(' '));
    await yukle();
  };

  const bekleyen = (liste ?? []).filter((x) => x.son && x.son.tarih === tarih);
  return (
    <>
      <p className="geri">
        <a className="geri-baglanti" href="#/cariler">
          ← Cariler
        </a>
      </p>
      <h1>Cari mutabakatı</h1>
      <p className="soluk">
        Seçtiğiniz tarih itibarıyla bakiyeyi carilere mektupla sorun; yanıtı girin, fark çıkarsa eksik fatura ya da ödemeyi bulun. Genellikle ay ya da yıl sonu
        yapılır.
      </p>
      <section className="kart">
        <div className="satir-ici">
          <Alan etiket="Tarih itibarıyla">
            <input type="date" value={tarih} onChange={(e) => setTarih(e.target.value)} />
          </Alan>
        </div>
        {liste === null ? (
          <p>Yükleniyor…</p>
        ) : liste.length === 0 ? (
          <BosDurum metin="Bu tarihte bakiyesi olan cari yok." />
        ) : (
          <>
            <div className="dugmeler">
              <button type="button" className="baglanti-dugmesi" onClick={() => setSecili(new Set(liste.filter((x) => x.bakiye !== 0 && x.son?.tarih !== tarih).map((x) => x.cari.id)))}>
                Bakiyesi olanların hepsini seç
              </button>
            </div>
            <ul className="mutabakat-listesi">
              {liste.map((x) => {
                const buTarihte = x.son?.tarih === tarih;
                return (
                  <li key={x.cari.id}>
                    <label className="onay-kutusu">
                      <input
                        type="checkbox"
                        disabled={buTarihte}
                        checked={secili.has(x.cari.id)}
                        onChange={(e) => {
                          const s = new Set(secili);
                          if (e.target.checked) s.add(x.cari.id);
                          else s.delete(x.cari.id);
                          setSecili(s);
                        }}
                      />
                      <span>
                        <strong>{x.cari.ad}</strong>
                        <span className="blok soluk kucuk">{bakiyeMetni(x.bakiye, 'onlar')}</span>
                      </span>
                    </label>
                    {x.son && (
                      <a href={`#/mutabakat/${x.son.id}`} className="mutabakat-son">
                        <span className="soluk kucuk">{tarihYaz(x.son.tarih)}</span> <DurumCipi d={x.sonDurum!} />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
            {mesaj && <p className="mesaj mesaj-basari">{mesaj}</p>}
            {hata && <Hatalar hatalar={[hata]} />}
            <div className="dugmeler">
              <button type="button" disabled={secili.size === 0} onClick={() => void hazirla()}>
                Seçilen {secili.size || ''} cariye mutabakat hazırla
              </button>
            </div>
          </>
        )}
      </section>
      {bekleyen.length > 0 && (
        <section className="kart">
          <h2>{tarihYaz(tarih)} mutabakatları</h2>
          <ul className="liste">
            {bekleyen.map((x) => (
              <li key={x.son!.id}>
                <a href={`#/mutabakat/${x.son!.id}`}>{x.cari.ad}</a>
                <DurumCipi d={x.sonDurum!} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** `#/mutabakat/yeni/:cariId`: bugünkü tarihle hazırlar (bugün için varsa onu açar). */
export function MutabakatYeniEkrani({ cariId }: { cariId: string }) {
  const { depo, servis, oturum } = useUygulama();
  const [hata, setHata] = useState<string | null>(null);
  useEffect(() => {
    let iptal = false;
    void (async () => {
      try {
        const var_ = (await cariMutabakatlari(depo, oturum.firmaId, cariId)).find((m) => m.tarih === bugun());
        const m = var_ ?? (await mutabakatHazirla(depo, servis, cariId, bugun()));
        if (!iptal) window.location.replace(`#/mutabakat/${m.id}`);
      } catch (e) {
        if (!iptal) setHata(hataMetni(e));
      }
    })();
    return () => {
      iptal = true;
    };
  }, [depo, servis, oturum.firmaId, cariId]);
  return hata ? <Hatalar hatalar={[hata]} /> : <p>Mutabakat hazırlanıyor…</p>;
}

// ─── Mutabakat ekranı ───────────────────────────────────────────────

export function MutabakatEkrani({ id }: { id: string }) {
  const { depo, servis, firma } = useUygulama();
  const [a, setA] = useState<MutabakatAyrintisi | null | undefined>(undefined);
  const [hata, setHata] = useState<string | null>(null);
  const yukle = useCallback(async () => setA(await mutabakatAyrintisi(depo, firma, id)), [depo, firma, id]);
  useEffect(() => {
    void yukle();
  }, [yukle]);
  if (a === undefined) return <p>Yükleniyor…</p>;
  if (a === null) return <p className="hata">Mutabakat bulunamadı.</p>;
  const m = a.mutabakat;
  const calistir = async (is: () => Promise<unknown>) => {
    setHata(null);
    try {
      await is();
      await yukle();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };

  return (
    <>
      <div className="yazdirma-gizle">
        <p className="geri">
          <a className="geri-baglanti" href={`#/cariler/${m.cariId}`}>
            ← {a.cari.ad}
          </a>
        </p>
        <div className="baslik-satiri">
          <h1>Mutabakat · {tarihYaz(m.tarih)}</h1>
          <DurumCipi d={a.durum} />
        </div>
        <p>
          Kayıtlarımıza göre <strong>{bakiyeMetni(m.bakiye, 'onlar')}</strong>.
        </p>
        {a.guncelBakiye !== m.bakiye && (
          <p className="mesaj mesaj-uyari">
            Mektuptan sonra bu tarihten önceye kayıt girildi ya da silindi: bugünkü kayıtlarla aynı tarihteki bakiye {tlYaz(a.guncelBakiye)}. Gerekirse bu
            mutabakatı kaldırıp yeniden hazırlayın.
          </p>
        )}
        {hata && <Hatalar hatalar={[hata]} />}

        <section className="kart">
          <h2>1. Gönder</h2>
          <div className="dugmeler">
            <button type="button" onClick={() => void yazdir()}>
              <Simge ad="yazdir" /> Yazdır / PDF
            </button>
            <PdfPaylasDugmesi ad={`Mutabakat ${a.cari.ad} ${m.tarih}`} mesaj={mutabakatMesaji({ cariAdi: a.cari.ad, firmaAdi: firma.ad, tarih: m.tarih, bakiye: m.bakiye })} cariId={m.cariId} />
            <WhatsappDugmesi telefon={a.cari.telefon} etiket="Kısa mesaj" metin={() => mutabakatMesaji({ cariAdi: a.cari.ad, firmaAdi: firma.ad, tarih: m.tarih, bakiye: m.bakiye })} />
          </div>
          {m.gonderildi ? (
            <p className="soluk">
              {tarihYaz(m.gonderildi)} tarihinde gönderildi.{' '}
              {!m.yanit && (
                <button type="button" className="baglanti-dugmesi" onClick={() => void calistir(() => mutabakatGonderildi(depo, servis, id, null))}>
                  Geri al
                </button>
              )}
            </p>
          ) : (
            <button type="button" className="ikincil" onClick={() => void calistir(() => mutabakatGonderildi(depo, servis, id, bugun() < m.tarih ? m.tarih : bugun()))}>
              Gönderildi olarak işaretle
            </button>
          )}
        </section>

        <YanitKarti m={m} onDegisti={yukle} />

        {(a.durum === 'farkli' || a.durum === 'cozuldu') && <FarkKarti a={a} onDegisti={yukle} />}

        <BelgelerKarti bagliTur="mutabakat" bagliId={m.id} varsayilanTur="diger" baslik="İmzalı mutabakat ve karşı tarafın ekstresi" />

        <p>
          <button type="button" className="baglanti-dugmesi tehlikeli-baglanti" onClick={() => void calistir(async () => (await mutabakatIptal(depo, servis, id), git(`cariler/${m.cariId}`)))}>
            Mutabakatı kaldır
          </button>
        </p>
        <h2>Mektup</h2>
      </div>
      <SozlesmeBelgesiGorunumu metin={a.mektup} logo={firma.logo} taslak={false} surum={1} />
    </>
  );
}

function YanitKarti({ m, onDegisti }: { m: Mutabakat; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const [f, setF] = useState({ tarih: bugun() < m.tarih ? m.tarih : bugun(), tutar: '', yon: 'borcumuz' as 'borcumuz' | 'alacagimiz', not: '' });
  const [farkli, setFarkli] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const gonder = async (mutabik: boolean) => {
    setHata(null);
    const t = tlOku(f.tutar);
    try {
      await mutabakatYaniti(depo, servis, m.id, {
        tarih: f.tarih,
        mutabik,
        karsiBakiye: mutabik || t === null ? null : f.yon === 'borcumuz' ? t : -t,
        not: f.not,
      });
      setFarkli(false);
      await onDegisti();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };
  if (m.yanit)
    return (
      <section className="kart">
        <h2>2. Yanıt</h2>
        <p>
          {tarihYaz(m.yanit.tarih)}: {m.yanit.mutabik ? <strong>Mutabık</strong> : <>Mutabık değil; onların kayıtlarına göre {bakiyeMetni(m.yanit.karsiBakiye ?? 0, 'onlar')}.</>}
          {m.yanit.not && <span className="blok soluk">{m.yanit.not}</span>}
        </p>
        <button type="button" className="baglanti-dugmesi" onClick={() => void mutabakatYaniti(depo, servis, m.id, null).then(onDegisti)}>
          Yanıtı kaldır
        </button>
      </section>
    );
  return (
    <section className="kart">
      <h2>2. Yanıt</h2>
      <Alan etiket="Yanıt günü">
        <input type="date" className="kisa-tarih" value={f.tarih} onChange={(e) => setF({ ...f, tarih: e.target.value })} />
      </Alan>
      {farkli ? (
        <>
          <div className="iki-sutun">
            <Alan etiket="Onların kayıtlarındaki bakiye">
              <TutarGirdisi value={f.tutar} onChange={(v) => setF({ ...f, tutar: v })} />
            </Alan>
            <div className="alan">
              <span className="alan-etiket">Kimin borcu</span>
              <div className="filtreler" role="group" aria-label="Kimin borcu">
                <button type="button" aria-pressed={f.yon === 'borcumuz'} onClick={() => setF({ ...f, yon: 'borcumuz' })}>
                  Bizim onlara
                </button>
                <button type="button" aria-pressed={f.yon === 'alacagimiz'} onClick={() => setF({ ...f, yon: 'alacagimiz' })}>
                  Onların bize
                </button>
              </div>
            </div>
          </div>
          <Alan etiket="Not">
            <input value={f.not} placeholder="Örn. ekstrelerini gönderdiler" onChange={(e) => setF({ ...f, not: e.target.value })} />
          </Alan>
          <div className="dugmeler">
            <button type="button" onClick={() => void gonder(false)}>
              Kaydet
            </button>
            <button type="button" className="ikincil" onClick={() => setFarkli(false)}>
              Vazgeç
            </button>
          </div>
        </>
      ) : (
        <div className="dugmeler">
          <button type="button" onClick={() => void gonder(true)}>
            ✓ Mutabık
          </button>
          <button type="button" className="ikincil" onClick={() => setFarkli(true)}>
            Mutabık değil
          </button>
        </div>
      )}
      {hata && <Hatalar hatalar={[hata]} />}
    </section>
  );
}

function FarkKarti({ a, onDegisti }: { a: MutabakatAyrintisi; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const [not, setNot] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const m = a.mutabakat;
  return (
    <section className="kart">
      <h2>3. Fark: {tlYaz(Math.abs(a.fark))}</h2>
      <p>{farkYorumu(a.fark)}</p>
      {a.adaylar.length > 0 ? (
        <>
          <h3>Bu tutardaki kayıtlarımız</h3>
          <ul className="liste">
            {a.adaylar.map((x) => (
              <li key={`${x.hareket.kayitTur}-${x.hareket.kayitId}-${x.hareket.tur}`}>
                <span>
                  <a href={`#/${x.hareket.kayitTur === 'gider' ? 'giderler' : x.hareket.kayitTur === 'odeme' ? 'odemeler' : `cariler/${m.cariId}`}${x.hareket.kayitTur === 'gider' || x.hareket.kayitTur === 'odeme' ? `/${x.hareket.kayitId}` : ''}`}>
                    {tarihYaz(x.hareket.tarih)} · {hareketAdi(x.hareket)}
                  </a>
                  <span className="blok soluk kucuk">{x.neden}</span>
                </span>
                <strong>{tlYaz(Math.abs(x.hareket.tutar))}</strong>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="soluk">Farka eşit tutarda kaydımız yok; fark birden çok kayıttan ya da tutarı farklı girilmiş bir kayıttan olabilir. Karşı tarafın ekstresiyle satır satır karşılaştırın.</p>
      )}
      <details>
        <summary>Dönem hareketleri ({a.hareketler.length})</summary>
        <ul className="liste">
          {a.hareketler.map((h) => (
            <li key={`${h.kayitTur}-${h.kayitId}-${h.tur}`}>
              <span>
                {tarihYaz(h.tarih)} · {hareketAdi(h)}
              </span>
              <span className={h.tutar < 0 ? 'vade-giris' : 'vade-cikis'}>{tlYaz(h.tutar)}</span>
            </li>
          ))}
        </ul>
      </details>
      {m.cozuldu ? (
        <p className="mesaj mesaj-basari">
          {tarihYaz(m.cozuldu.tarih)}: {m.cozuldu.not}
        </p>
      ) : (
        <>
          <Alan etiket="Fark nasıl çözüldü">
            <input value={not} placeholder="Örn. eksik fatura girildi; dekont gönderildi" onChange={(e) => setNot(e.target.value)} />
          </Alan>
          <button
            type="button"
            disabled={!not.trim()}
            onClick={() =>
              void mutabakatCozuldu(depo, servis, m.id, bugun(), not)
                .then(onDegisti)
                .catch((e) => setHata(hataMetni(e)))
            }
          >
            Fark çözüldü
          </button>
          <p className="soluk kucuk">Eksik kaydı girdikten sonra yeni bir mutabakat hazırlayıp göndermek en temizidir.</p>
        </>
      )}
      {hata && <Hatalar hatalar={[hata]} />}
    </section>
  );
}

// ─── Cari kartı ─────────────────────────────────────────────────────

export function CariMutabakatKarti({ cariId }: { cariId: string }) {
  const { depo, oturum } = useUygulama();
  const [l, setL] = useState<Mutabakat[] | null>(null);
  useEffect(() => {
    void cariMutabakatlari(depo, oturum.firmaId, cariId).then(setL);
  }, [depo, oturum.firmaId, cariId]);
  if (!l) return null;
  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Mutabakat</h2>
        <a className="dugme ikincil" href={`#/mutabakat/yeni/${cariId}`}>
          Mutabakat gönder
        </a>
      </div>
      {l.length === 0 ? (
        <p className="soluk">Bu cariyle henüz mutabakat yapılmadı. Bugünkü bakiye için mektup hazırlanır; dönem sonu için Cariler › Mutabakat.</p>
      ) : (
        <ul className="liste">
          {l.slice(0, 5).map((m) => (
            <li key={m.id}>
              <a href={`#/mutabakat/${m.id}`}>
                {tarihYaz(m.tarih)} · {tlYaz(Math.abs(m.bakiye))}
              </a>
              <DurumCipi d={mutabakatDurumu(m)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
