import { useCallback, useEffect, useState } from 'react';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { PERIYOT_ADI, sabitGiderHatalari, type SabitGiderIcerigi } from '../hesap/sabitGider';
import { yerelGun } from '../hesap/tarih';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import { projeleriListele, type ProjeOzeti } from '../servisler/proje';
import { sabitGiderIptal, sabitGiderKaydet, sabitGiderleriListele, type SabitGiderSatiri } from '../servisler/sabitGider';
import type { SabitGider, SabitGiderPeriyodu } from '../veri/tipler';
import { useUygulama, useYetki } from './baglam';
import { Alan, BosDurum, Hatalar, hataMetni } from './bilesenler';
import { CariSecici } from './CariSecici';
import { TutarGirdisi } from './Girdiler';

// Sabit giderler: kira, maaş, muhasebeci… Nakit tahmininde planlı çıkış; ödenince gider olarak girilir.

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');

interface Form {
  ad: string;
  tutar: string;
  periyot: SabitGiderPeriyodu;
  gun: string;
  baslangic: string;
  bitis: string;
  cariId: string | null;
  projeId: string;
  not: string;
}

const bosForm = (): Form => ({ ad: '', tutar: '', periyot: 'aylik', gun: '1', baslangic: `${yerelGun(new Date()).slice(0, 7)}-01`, bitis: '', cariId: null, projeId: '', not: '' });
const formdan = (s: SabitGider): Form => ({
  ad: s.ad,
  tutar: tutarMetni(s.tutar),
  periyot: s.periyot,
  gun: String(s.gun),
  baslangic: s.baslangic,
  bitis: s.bitis ?? '',
  cariId: s.cariId,
  projeId: s.projeId ?? '',
  not: s.not,
});
const icerige = (f: Form, kalemId: string | null): SabitGiderIcerigi => ({
  ad: f.ad,
  tutar: tlOku(f.tutar) ?? 0,
  periyot: f.periyot,
  gun: Number(f.gun),
  baslangic: f.baslangic,
  bitis: f.bitis || null,
  cariId: f.cariId,
  projeId: f.projeId || null,
  kalemId,
  not: f.not,
});

export function SabitGiderlerEkrani() {
  const { depo, oturum } = useUygulama();
  const yetki = useYetki();
  const [liste, setListe] = useState<SabitGiderSatiri[] | null>(null);
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [projeler, setProjeler] = useState<ProjeOzeti[]>([]);
  const [duzenlenen, setDuzenlenen] = useState<SabitGider | 'yeni' | null>(null);
  const yukle = useCallback(async () => {
    const [l, c, p] = await Promise.all([sabitGiderleriListele(depo, oturum.firmaId), carileriListele(depo, oturum.firmaId), projeleriListele(depo, oturum.firmaId)]);
    setCariler(c);
    setProjeler(p.filter((x) => !x.proje.iptal));
    setListe(l);
  }, [depo, oturum.firmaId]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  if (!yetki('kasa') && !yetki('odeme') && !yetki('gider')) return <p>Bu ekran için kasa, ödeme ya da gider yetkisi gerekir.</p>;
  if (!liste) return <p>Yükleniyor…</p>;
  const aylikToplam = liste.filter((x) => !x.sabit.bitis || x.sabit.bitis >= yerelGun(new Date())).reduce((t, x) => t + x.aylik, 0);

  return (
    <>
      <p className="geri">
        <a className="geri-baglanti" href="#/nakit">
          ← Nakit tahmini
        </a>
      </p>
      <div className="baslik-satiri">
        <h1>Sabit giderler</h1>
        {duzenlenen === null && (
          <button type="button" onClick={() => setDuzenlenen('yeni')}>
            + Sabit gider
          </button>
        )}
      </div>
      <p className="soluk">
        Kira, maaş, muhasebeci, sigorta gibi düzenli ödemeler. Borç doğurmaz; nakit tahmininde günü gelince çıkış olarak görünür. Ödediğinizde gider olarak
        girin: o ay aynı cariye gider girildiyse o ayın tekrarı tahminden düşer.
      </p>
      {duzenlenen !== null && (
        <SabitGiderFormu
          key={duzenlenen === 'yeni' ? 'yeni' : duzenlenen.id}
          sabit={duzenlenen === 'yeni' ? null : duzenlenen}
          cariler={cariler}
          projeler={projeler}
          onCariEklendi={(c) => setCariler((l) => [...l, { cari: c, bakiye: 0 }])}
          onBitti={async (k) => {
            setDuzenlenen(null);
            if (k) await yukle();
          }}
        />
      )}
      {liste.length === 0 ? (
        duzenlenen === null && <BosDurum metin="Sabit gider yok. Ekleyince nakit tahmini daha gerçekçi olur." />
      ) : (
        <section className="kart">
          <div className="baslik-satiri">
            <h2>Liste</h2>
            <span className="soluk">Aylık karşılığı {tlYaz(aylikToplam)}</span>
          </div>
          <ul className="liste">
            {liste.map((x) => (
              <li key={x.sabit.id}>
                <button type="button" className="liste-dugmesi" onClick={() => setDuzenlenen(x.sabit)}>
                  <span>
                    <strong>{x.sabit.ad}</strong>
                    <span className="blok soluk kucuk">
                      {PERIYOT_ADI[x.sabit.periyot]}, ayın {x.sabit.gun}. günü · {x.cariAdi ?? 'carisiz'} · {x.projeAdi ?? 'Genel'}
                      {x.sabit.bitis && ` · ${tarihYaz(x.sabit.bitis)} tarihine kadar`}
                    </span>
                  </span>
                  <strong>{tlYaz(x.sabit.tutar)}</strong>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function SabitGiderFormu(props: {
  sabit: SabitGider | null;
  cariler: CariOzeti[];
  projeler: ProjeOzeti[];
  onCariEklendi: (c: CariOzeti['cari']) => void;
  onBitti: (kaydedildi: boolean) => Promise<void>;
}) {
  const { depo, servis } = useUygulama();
  const [f, setF] = useState<Form>(props.sabit ? formdan(props.sabit) : bosForm());
  const [cariSec, setCariSec] = useState(false);
  const [hata, setHata] = useState<string | null>(null);
  const yaz = <K extends keyof Form>(k: K, v: Form[K]) => setF({ ...f, [k]: v });
  const kalemId = props.sabit?.kalemId ?? null;
  const hatalar = f.ad || f.tutar ? sabitGiderHatalari(icerige(f, kalemId)) : [];
  const cariAdi = props.cariler.find((c) => c.cari.id === f.cariId)?.cari.ad;

  const calistir = async (is: () => Promise<unknown>) => {
    setHata(null);
    try {
      await is();
      await props.onBitti(true);
    } catch (e) {
      setHata(hataMetni(e));
    }
  };

  return (
    <section className="kart">
      <h2>{props.sabit ? props.sabit.ad : 'Yeni sabit gider'}</h2>
      <div className="iki-sutun">
        <Alan etiket="Ad">
          <input value={f.ad} placeholder="Ofis kirası, şantiye şefi maaşı…" autoFocus={!props.sabit} onChange={(e) => yaz('ad', e.target.value)} />
        </Alan>
        <Alan etiket="Tutar (KDV dahil, tahmini)">
          <TutarGirdisi value={f.tutar} onChange={(v) => yaz('tutar', v)} />
        </Alan>
      </div>
      <div className="alan">
        <span className="alan-etiket">Ne sıklıkla</span>
        <div className="filtreler" role="group" aria-label="Ne sıklıkla">
          {(Object.keys(PERIYOT_ADI) as SabitGiderPeriyodu[]).map((p) => (
            <button key={p} type="button" aria-pressed={f.periyot === p} onClick={() => yaz('periyot', p)}>
              {PERIYOT_ADI[p]}
            </button>
          ))}
        </div>
      </div>
      <div className="iki-sutun">
        <Alan etiket="Ayın günü" aciklama="Kısa ayda ayın son günü.">
          <input className="kisa" inputMode="numeric" value={f.gun} onChange={(e) => yaz('gun', e.target.value.replace(/\D/g, '').slice(0, 2))} />
        </Alan>
        <Alan etiket={f.periyot === 'aylik' ? 'Başlangıç' : 'İlk ödeme ayı'}>
          <input type="date" value={f.baslangic} onChange={(e) => yaz('baslangic', e.target.value)} />
        </Alan>
        <Alan etiket="Bitiş (isteğe bağlı)" aciklama="Kira sözleşmesinin sonu gibi.">
          <input type="date" value={f.bitis} onChange={(e) => yaz('bitis', e.target.value)} />
        </Alan>
        <Alan etiket="Proje">
          <select value={f.projeId} onChange={(e) => yaz('projeId', e.target.value)}>
            <option value="">Genel (projesiz)</option>
            {props.projeler.map((p) => (
              <option key={p.proje.id} value={p.proje.id}>
                {p.proje.ad}
              </option>
            ))}
          </select>
        </Alan>
      </div>
      <div className="alan">
        <span className="alan-etiket">Kime ödenir</span>
        {cariSec ? (
          <CariSecici
            cariler={props.cariler}
            secili={f.cariId}
            bosEtiket="Carisiz"
            acikBasla
            onVazgec={() => setCariSec(false)}
            onSec={(c) => (yaz('cariId', c), setCariSec(false))}
            hizliEkle={{ rol: 'tedarikci', onEklendi: (c) => (props.onCariEklendi(c), yaz('cariId', c.id), setCariSec(false)), secenekler: ['tedarikci', 'usta'] }}
          />
        ) : (
          <button type="button" className="ikincil" onClick={() => setCariSec(true)}>
            {cariAdi ?? 'Cari seç'}
          </button>
        )}
        {!f.cariId && !kalemId && <small className="alan-aciklama">Cari seçilmezse gideri girildiği anlaşılmaz; her tekrarı tahmine girer.</small>}
      </div>
      <Alan etiket="Not">
        <input value={f.not} onChange={(e) => yaz('not', e.target.value)} />
      </Alan>
      {hatalar.length > 0 && <Hatalar hatalar={hatalar} />}
      {hata && <Hatalar hatalar={[hata]} />}
      <div className="dugmeler">
        <button type="button" disabled={!f.ad.trim() || hatalar.length > 0} onClick={() => void calistir(() => sabitGiderKaydet(depo, servis, icerige(f, kalemId), props.sabit?.id))}>
          Kaydet
        </button>
        <button type="button" className="ikincil" onClick={() => void props.onBitti(false)}>
          Vazgeç
        </button>
        {props.sabit && (
          <button type="button" className="baglanti-dugmesi tehlikeli-baglanti" onClick={() => void calistir(() => sabitGiderIptal(depo, servis, props.sabit!.id))}>
            Kaldır
          </button>
        )}
      </div>
    </section>
  );
}
