import { useCallback, useEffect, useMemo, useState } from 'react';
import { Simge } from './Simge';
import { gunlukOzeti, HAVA, PUANTAJ_DURUMU, puantajTutari, type GunlukIcerigi, type PuantajKisiOzeti } from '../hesap/gunluk';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { yerelGun } from '../hesap/tarih';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import { gunlukGetir, gunlukKaydet, oncekiGunluk, projeGunlukleri, projePuantaji, puantajGideriYaz } from '../servisler/gunluk';
import { projeButcesiGetir, sistemKalemiHazirla } from '../servisler/kalem';
import { yeniId } from '../veri/kimlik';
import type { Cari, Hava, PuantajDurumu, SantiyeGunlugu } from '../veri/tipler';
import { AktarmaDugmeleri } from './Aktarma';
import { useUygulama, useYetki } from './baglam';
import { Alan, BosDurum, Hatalar, hataMetni } from './bilesenler';
import { CariSecici } from './CariSecici';
import { TutarGirdisi } from './Girdiler';
import { KalemSecici, type KalemSecenegi } from './KalemSecici';
import { git } from './rota';

// Şantiye günlüğü: proje sekmesi (son günler), gün ekranı (hava, işler, ekipler, puantaj, sorunlar) ve aylık puantaj
// (işçi × gün, tutar, gidere yazma).

const uzunTarih = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' });
const kisaTarih = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', weekday: 'short' });
const gunKaydir = (t: string, n: number) => {
  const d = new Date(`${t}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function GunlukSekmesi({ projeId }: { projeId: string }) {
  const { depo, oturum } = useUygulama();
  const [liste, setListe] = useState<SantiyeGunlugu[] | null>(null);
  useEffect(() => {
    void projeGunlukleri(depo, oturum.firmaId, projeId).then(setListe);
  }, [depo, oturum.firmaId, projeId]);
  const bugun = yerelGun(new Date());
  const bugunVar = liste?.some((g) => g.tarih === bugun);
  return (
    <>
      <div className="dugmeler">
        <a className="dugme" href={`#/gunluk/${projeId}/${bugun}`}>
          <Simge ad="gunluk" /> {bugunVar ? 'Bugünün günlüğü' : 'Bugünün günlüğünü yaz'}
        </a>
        <a className="dugme ikincil" href={`#/projeler/${projeId}/puantaj`}>
          <Simge ad="usta" /> Puantaj
        </a>
      </div>
      {liste === null && <p>Yükleniyor…</p>}
      {liste?.length === 0 && <BosDurum metin="Henüz günlük yok. Her gün hava, yapılan işler, ekipler ve yevmiyeli işçilerin puantajı yazılır." />}
      {liste && liste.length > 0 && (
        <ul className="kart-listesi liste-arasi">
          {liste.slice(0, 60).map((g) => (
            <li key={g.id}>
              <a className="kart kart-baglanti" href={`#/gunluk/${projeId}/${g.tarih}`}>
                <span className="baslik-satiri">
                  <strong>{kisaTarih(g.tarih)}</strong>
                  <span className="soluk">{gunlukOzeti(g)}</span>
                </span>
                {(g.yapilanIsler || g.sorunlar) && (
                  <span className="soluk gunluk-satir-ozeti">
                    {g.yapilanIsler.split('\n')[0]}
                    {g.sorunlar && <span className="hata"> · <Simge ad="uyari" /> {g.sorunlar.split('\n')[0]}</span>}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

interface PuantajFormu {
  id: string;
  cariId: string;
  durum: PuantajDurumu;
  yevmiye: string;
  mesaiSaat: string;
  giderId: string | null;
}
interface EkipFormu {
  id: string;
  cariId: string | null;
  ad: string;
  kisi: string;
  is: string;
}
interface Form {
  hava: Hava | null;
  sicaklik: string;
  calisilmadi: boolean;
  yapilanIsler: string;
  ekipler: EkipFormu[];
  puantaj: PuantajFormu[];
  sorunlar: string;
  not: string;
}

const BOS: Form = { hava: null, sicaklik: '', calisilmadi: false, yapilanIsler: '', ekipler: [], puantaj: [], sorunlar: '', not: '' };

const formaCevir = (g: SantiyeGunlugu): Form => ({
  hava: g.hava,
  sicaklik: sayiYaz(g.sicaklik),
  calisilmadi: g.calisilmadi,
  yapilanIsler: g.yapilanIsler,
  ekipler: g.ekipler.map((e) => ({ ...e, kisi: String(e.kisi) })),
  puantaj: g.puantaj.map((p) => ({ id: p.id, cariId: p.cariId, durum: p.durum, yevmiye: tutarMetni(p.yevmiye), mesaiSaat: p.mesaiSaat ? sayiYaz(p.mesaiSaat) : '', giderId: p.giderId })),
  sorunlar: g.sorunlar,
  not: g.not,
});

function formdan(f: Form): { icerik: GunlukIcerigi; hatalar: string[] } {
  const hatalar: string[] = [];
  const sicaklik = f.sicaklik.trim() ? sayiOku(f.sicaklik) : null;
  if (f.sicaklik.trim() && sicaklik === null) hatalar.push('Sıcaklık okunamadı.');
  return {
    icerik: {
      hava: f.hava,
      sicaklik,
      calisilmadi: f.calisilmadi,
      yapilanIsler: f.yapilanIsler,
      ekipler: f.ekipler.map((e) => ({ id: e.id, cariId: e.cariId, ad: e.ad, kisi: Number(e.kisi || '0'), is: e.is })),
      puantaj: f.puantaj.map((p) => {
        const y = p.yevmiye.trim() ? tlOku(p.yevmiye) : 0;
        if (y === null) hatalar.push('Yevmiye okunamadı (örn. 1.600).');
        const m = p.mesaiSaat.trim() ? sayiOku(p.mesaiSaat) : 0;
        if (m === null) hatalar.push('Mesai saati okunamadı.');
        return { id: p.id, cariId: p.cariId, durum: p.durum, yevmiye: y ?? 0, mesaiSaat: m ?? 0, mesaiUcreti: null, giderId: p.giderId };
      }),
      sorunlar: f.sorunlar,
      not: f.not,
    },
    hatalar: [...new Set(hatalar)],
  };
}

export function GunlukEkrani({ projeId, tarih }: { projeId: string; tarih: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [kayit, setKayit] = useState<SantiyeGunlugu | null | undefined>(undefined);
  const [form, setForm] = useState<Form | null>(null);
  const [projeAdi, setProjeAdi] = useState('');
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [isciEkle, setIsciEkle] = useState(false);
  const [ekipEkle, setEkipEkle] = useState(false);
  const [hata, setHata] = useState<string[]>([]);
  const [mesaj, setMesaj] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    const g = await gunlukGetir(depo, oturum.firmaId, projeId, tarih);
    setKayit(g);
    setForm(g ? formaCevir(g) : { ...BOS, puantaj: [], ekipler: [] });
  }, [depo, oturum.firmaId, projeId, tarih]);
  useEffect(() => {
    void yukle();
    void depo.getir('proje', projeId).then((p) => setProjeAdi(p?.ad ?? ''));
    void carileriListele(depo, oturum.firmaId).then(setCariler);
  }, [yukle, depo, oturum.firmaId, projeId]);

  const kayitli = useMemo(() => JSON.stringify(kayit ? formaCevir(kayit) : BOS), [kayit]);
  if (kayit === undefined || !form) return <p>Yükleniyor…</p>;
  const cevrim = formdan(form);
  const degisti = JSON.stringify(form) !== kayitli;
  const cariAdi = new Map(cariler.map((c) => [c.cari.id, c.cari.ad]));
  const yaz = <K extends keyof Form>(k: K, v: Form[K]) => (setMesaj(null), setForm({ ...form, [k]: v }));
  const puantajYaz = (i: number, d: Partial<PuantajFormu>) => yaz('puantaj', form.puantaj.map((p, j) => (j === i ? { ...p, ...d } : p)));
  const ekipYaz = (i: number, d: Partial<EkipFormu>) => yaz('ekipler', form.ekipler.map((p, j) => (j === i ? { ...p, ...d } : p)));
  const gunToplami = cevrim.icerik.puantaj.reduce((t, p) => t + puantajTutari(p), 0);

  async function dunkunuGetir() {
    const o = await oncekiGunluk(depo, oturum.firmaId, projeId, tarih);
    if (!o) return setMesaj('Önceki günlük yok.');
    setForm({
      ...form!,
      ekipler: o.ekipler.map((e) => ({ ...e, id: yeniId(), kisi: String(e.kisi) })),
      puantaj: o.puantaj.map((p) => ({ id: yeniId(), cariId: p.cariId, durum: 'tam', yevmiye: tutarMetni(p.yevmiye), mesaiSaat: '', giderId: null })),
    });
    setMesaj(`${kisaTarih(o.tarih)} günlüğündeki ekipler ve işçiler getirildi; durumlarını düzeltin.`);
  }

  async function kaydet() {
    setHata([]);
    if (cevrim.hatalar.length) return setHata(cevrim.hatalar);
    try {
      await gunlukKaydet(depo, servis, projeId, tarih, cevrim.icerik);
      await yukle();
      setMesaj('Kaydedildi.');
    } catch (e) {
      setHata([hataMetni(e)]);
    }
  }

  const sonYevmiye = (cariId: string) => form.puantaj.find((p) => p.cariId === cariId)?.yevmiye ?? '';
  const isciSec = (cariId: string | null) => {
    setIsciEkle(false);
    if (!cariId || form.puantaj.some((p) => p.cariId === cariId)) return;
    yaz('puantaj', [...form.puantaj, { id: yeniId(), cariId, durum: 'tam', yevmiye: sonYevmiye(cariId), mesaiSaat: '', giderId: null }]);
  };
  const cariEklendi = (c: Cari) => setCariler((l) => [...l, { cari: c, bakiye: 0 }]);

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}/gunluk`}>← {projeAdi || 'Proje'} · Şantiye günlüğü</a>
      </p>
      <div className="gunluk-gezinme">
        <button type="button" className="ikincil" aria-label="Önceki gün" onClick={() => git(`gunluk/${projeId}/${gunKaydir(tarih, -1)}`)}>
          ‹
        </button>
        <h1>{uzunTarih(tarih)}</h1>
        <button type="button" className="ikincil" aria-label="Sonraki gün" onClick={() => git(`gunluk/${projeId}/${gunKaydir(tarih, 1)}`)}>
          ›
        </button>
      </div>
      {!kayit && <p className="soluk">Bu gün için günlük yok; doldurup kaydedin.</p>}

      <section className="kart">
        <h2>Hava</h2>
        <div className="hava-secimi" role="group" aria-label="Hava">
          {(Object.keys(HAVA) as Hava[]).map((h) => (
            <button key={h} type="button" aria-pressed={form.hava === h} title={HAVA[h].ad} onClick={() => yaz('hava', form.hava === h ? null : h)}>
              <span aria-hidden="true">{HAVA[h].simge}</span>
              <span className="kucuk">{HAVA[h].ad}</span>
            </button>
          ))}
        </div>
        <div className="iki-sutun">
          <Alan etiket="Sıcaklık (°C)">
            <input inputMode="decimal" value={form.sicaklik} onChange={(e) => yaz('sicaklik', e.target.value)} />
          </Alan>
          <label className="onay-kutusu">
            <input type="checkbox" checked={form.calisilmadi} onChange={(e) => yaz('calisilmadi', e.target.checked)} />
            <span>Hava yüzünden çalışılmadı</span>
          </label>
        </div>
      </section>

      <section className="kart">
        <h2>Yapılan işler</h2>
        <textarea rows={4} value={form.yapilanIsler} placeholder="örn. 3. kat kolon kalıbı, B blok tesisat boruları" onChange={(e) => yaz('yapilanIsler', e.target.value)} />
        <p>
          <a className="baglanti-dugmesi" href={`#/fotograflar/yeni/${projeId}`}>
            <Simge ad="kamera" /> Fotoğraf ekle
          </a>
        </p>
      </section>

      <section className="kart">
        <div className="baslik-satiri">
          <h2>Ekipler</h2>
          <button type="button" className="baglanti-dugmesi" onClick={() => void dunkunuGetir()}>
            Önceki günü getir
          </button>
        </div>
        <p className="soluk kucuk">Taşeron ve usta ekipleri: kaç kişi, ne yaptı.</p>
        {form.ekipler.map((e, i) => (
          <div key={e.id} className="ekip-satiri">
            <span className="ekip-adi">{e.cariId ? (cariAdi.get(e.cariId) ?? '?') : <input value={e.ad} placeholder="Ekip" aria-label={`${i + 1}. ekibin adı`} onChange={(x) => ekipYaz(i, { ad: x.target.value })} />}</span>
            <input className="kisa" inputMode="numeric" value={e.kisi} aria-label={`${i + 1}. ekip kişi sayısı`} placeholder="Kişi" onChange={(x) => ekipYaz(i, { kisi: x.target.value.replace(/\D/g, '') })} />
            <input value={e.is} placeholder="Yaptığı iş" aria-label={`${i + 1}. ekibin işi`} onChange={(x) => ekipYaz(i, { is: x.target.value })} />
            <button type="button" className="ikincil" aria-label={`${i + 1}. ekibi çıkar`} onClick={() => yaz('ekipler', form.ekipler.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        {ekipEkle ? (
          <CariSecici
            cariler={cariler.filter((c) => c.cari.roller.some((r) => r === 'usta' || r === 'taseron'))}
            secili={null}
            oncelikli={['taseron', 'usta']}
            bosEtiket="Carisiz (yalnız ad)"
            acikBasla
            onVazgec={() => setEkipEkle(false)}
            onSec={(c) => {
              setEkipEkle(false);
              yaz('ekipler', [...form.ekipler, { id: yeniId(), cariId: c, ad: '', kisi: '', is: '' }]);
            }}
            hizliEkle={{ rol: 'taseron', onEklendi: cariEklendi, secenekler: ['taseron', 'usta'] }}
          />
        ) : (
          <button type="button" className="baglanti-dugmesi" onClick={() => setEkipEkle(true)}>
            + Ekip ekle
          </button>
        )}
      </section>

      <section className="kart">
        <h2>Puantaj (yevmiyeli işçiler)</h2>
        {form.puantaj.length > 0 && <p className="soluk kucuk">Her işçi için durum, yevmiye (₺) ve varsa mesai saati.</p>}
        {form.puantaj.length === 0 && <p className="soluk kucuk">Günlük yevmiyeyle çalışan işçiler. Yevmiyeler sonra Puantaj ekranından işçinin carisine borç yazılır.</p>}
        {form.puantaj.map((p, i) => {
          const yazildi = !!p.giderId;
          return (
            <div key={p.id} className="puantaj-satiri">
              <strong className="puantaj-adi">{cariAdi.get(p.cariId) ?? '?'}</strong>
              <div className="filtreler" role="group" aria-label={`${cariAdi.get(p.cariId) ?? ''} durumu`}>
                {(Object.keys(PUANTAJ_DURUMU) as PuantajDurumu[]).map((d) => (
                  <button key={d} type="button" disabled={yazildi} aria-pressed={p.durum === d} onClick={() => puantajYaz(i, { durum: d })}>
                    {PUANTAJ_DURUMU[d].ad}
                  </button>
                ))}
              </div>
              <TutarGirdisi value={p.yevmiye} placeholder="Yevmiye ₺" onChange={(v) => puantajYaz(i, { yevmiye: v })} />
              <input className="kisa" inputMode="decimal" value={p.mesaiSaat} placeholder="Mesai sa." aria-label="Mesai saati" disabled={yazildi} onChange={(e) => puantajYaz(i, { mesaiSaat: e.target.value })} />
              {yazildi ? (
                <span className="etiket-cip" title="Yevmiyesi gidere yazıldı">gidere yazıldı</span>
              ) : (
                <button type="button" className="ikincil" aria-label="İşçiyi çıkar" onClick={() => yaz('puantaj', form.puantaj.filter((_, j) => j !== i))}>
                  ✕
                </button>
              )}
            </div>
          );
        })}
        {isciEkle ? (
          <CariSecici
            cariler={cariler.filter((c) => c.cari.roller.includes('usta'))}
            secili={null}
            oncelikli={['usta']}
            acikBasla
            onVazgec={() => setIsciEkle(false)}
            onSec={isciSec}
            hizliEkle={{ rol: 'usta', onEklendi: (c) => (cariEklendi(c), isciSec(c.id)), secenekler: ['usta'] }}
          />
        ) : (
          <button type="button" className="baglanti-dugmesi" onClick={() => setIsciEkle(true)}>
            + İşçi ekle
          </button>
        )}
        {gunToplami > 0 && (
          <p className="ara-toplam">
            <span>Günün yevmiyeleri</span>
            <span>{tlYaz(gunToplami)}</span>
          </p>
        )}
      </section>

      <section className="kart">
        <Alan etiket="Sorunlar / gecikmeler">
          <textarea rows={2} value={form.sorunlar} placeholder="örn. beton 2 saat geç geldi" onChange={(e) => yaz('sorunlar', e.target.value)} />
        </Alan>
        <Alan etiket="Not (ziyaretçi, denetim, gelen malzeme)">
          <textarea rows={2} value={form.not} onChange={(e) => yaz('not', e.target.value)} />
        </Alan>
      </section>

      <div className="kaydet-cubugu">
        <Hatalar hatalar={hata} />
        {mesaj && <p className={degisti ? 'mesaj mesaj-not' : 'mesaj mesaj-basari'}>{mesaj}</p>}
        <div className="dugmeler">
          <button type="button" disabled={!degisti} onClick={() => void kaydet()}>
            Kaydet
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Aylık puantaj ────────────────────────────────────────────────

export function PuantajEkrani({ projeId }: { projeId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const yetki = useYetki();
  const [ay, setAy] = useState(yerelGun(new Date()).slice(0, 7));
  const [ozet, setOzet] = useState<PuantajKisiOzeti[] | null>(null);
  const [cariler, setCariler] = useState<Map<string, string>>(new Map());
  const [projeAdi, setProjeAdi] = useState('');
  const [kalemler, setKalemler] = useState<KalemSecenegi[]>([]);
  const [kalemId, setKalemId] = useState('');
  const [hata, setHata] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);

  const yukle = useCallback(async () => setOzet(await projePuantaji(depo, oturum.firmaId, projeId, ay)), [depo, oturum.firmaId, projeId, ay]);
  useEffect(() => {
    void yukle();
  }, [yukle]);
  useEffect(() => {
    void depo.getir('proje', projeId).then((p) => setProjeAdi(p?.ad ?? ''));
    void carileriListele(depo, oturum.firmaId).then((l) => setCariler(new Map(l.map((c) => [c.cari.id, c.cari.ad]))));
    void projeButcesiGetir(depo, oturum.firmaId, projeId, true).then((o) => {
      const l = o.dugumler.flatMap((d): KalemSecenegi[] =>
        d.altlar.length > 0 ? d.altlar.map((a) => ({ id: a.kalem.id, ad: a.kalem.ad, ustAd: d.kalem.ad })) : [{ id: d.kalem.id, ad: d.kalem.ad, ustAd: null }],
      );
      setKalemler(l);
      // Varsayılan: "Genel giderler › Şantiye giderleri".
      const santiye = o.dugumler.flatMap((d) => [d, ...d.altlar]).find((d) => d.kalem.sistemKodu === 'santiye_giderleri');
      if (santiye) setKalemId(santiye.kalem.id);
    });
  }, [depo, oturum.firmaId, projeId]);

  const [y, m] = ay.split('-').map(Number) as [number, number];
  const gunSayisi = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const gunler = Array.from({ length: gunSayisi }, (_, i) => `${ay}-${String(i + 1).padStart(2, '0')}`);
  const ayKaydir = (n: number) => {
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setAy(d.toISOString().slice(0, 7));
  };
  const ayAdi = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });
  const satirlar = [...(ozet ?? [])].sort((a, b) => (cariler.get(a.cariId) ?? '').localeCompare(cariler.get(b.cariId) ?? '', 'tr'));

  async function yaz(cariId: string) {
    setHata(null);
    setMesaj(null);
    try {
      let kalem = kalemId || null;
      if (!kalem) kalem = (await sistemKalemiHazirla(depo, servis, projeId, 'santiye_giderleri')).id;
      await puantajGideriYaz(depo, servis, { projeId, cariId, ay, kalemId: kalem, tarih: yerelGun(new Date()) });
      await yukle();
      setMesaj(`${cariler.get(cariId) ?? 'İşçi'} için yevmiyeler gider olarak yazıldı; carisine borç oldu.`);
    } catch (e) {
      setHata(hataMetni(e));
    }
  }

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}/gunluk`}>← {projeAdi || 'Proje'} · Şantiye günlüğü</a>
      </p>
      <div className="gunluk-gezinme">
        <button type="button" className="ikincil" aria-label="Önceki ay" onClick={() => ayKaydir(-1)}>
          ‹
        </button>
        <h1>Puantaj · {ayAdi}</h1>
        <button type="button" className="ikincil" aria-label="Sonraki ay" onClick={() => ayKaydir(1)}>
          ›
        </button>
      </div>
      {ozet === null && <p>Yükleniyor…</p>}
      {ozet?.length === 0 && <BosDurum metin="Bu ay puantaj yok. Günlüğe yevmiyeli işçi ekleyince burada görünür." />}
      {satirlar.length > 0 && (
        <>
          <section className="kart puantaj-cizelgesi">
            <div className="tablo-kaydir">
              <table className="veri-tablosu">
                <thead>
                  <tr>
                    <th>İşçi</th>
                    {gunler.map((g) => (
                      <th key={g} className={`gun ${[0, 6].includes(new Date(`${g}T12:00:00Z`).getUTCDay()) ? 'hafta-sonu' : ''}`}>
                        <a href={`#/gunluk/${projeId}/${g}`}>{Number(g.slice(8))}</a>
                      </th>
                    ))}
                    <th>Gün</th>
                    <th>Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {satirlar.map((k) => (
                    <tr key={k.cariId}>
                      <th>{cariler.get(k.cariId) ?? '?'}</th>
                      {gunler.map((g) => {
                        const d = k.gunler.get(g);
                        return (
                          <td key={g} className={`gun ${d ? `puantaj-${d}` : ''}`}>
                            {d ? PUANTAJ_DURUMU[d].kisa : ''}
                          </td>
                        );
                      })}
                      <td className="sayi">{k.gun.toLocaleString('tr-TR')}</td>
                      <td className="sayi">{tlYaz(k.tutar)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AktarmaDugmeleri
              dosyaAdi={`Puantaj ${projeAdi} ${ay}`}
              sayfalar={() => [
                {
                  ad: 'Puantaj',
                  ust: [`${projeAdi} · ${ayAdi} puantajı`],
                  basliklar: ['İşçi', ...gunler.map((g) => g.slice(8)), 'Gün', 'Mesai (saat)', 'Tutar', 'Gidere yazılmamış'],
                  satirlar: satirlar.map((k) => [
                    cariler.get(k.cariId) ?? '?',
                    ...gunler.map((g) => (k.gunler.get(g) ? PUANTAJ_DURUMU[k.gunler.get(g)!].kisa : '')),
                    k.gun,
                    k.mesaiSaat,
                    { tl: k.tutar },
                    { tl: k.yazilmamisTutar },
                  ]),
                },
              ]}
            />
          </section>

          <section className="kart">
            <h2>Yevmiyeleri gidere yaz</h2>
            <p className="soluk kucuk">
              Seçilen işçinin bu aydaki yazılmamış yevmiyeleri tek gider olarak carisine borç yazılır (KDV'siz). Ödemesi Ödeme ekranından yapılır.
            </p>
            {yetki('gider') && (
              <div className="alan">
                <span className="alan-etiket">Bütçe kalemi</span>
                <KalemSecici secenekler={kalemler} son={[]} secili={kalemId} onSec={setKalemId} projeVar />
              </div>
            )}
            <ul className="liste">
              {satirlar.map((k) => (
                <li key={k.cariId}>
                  <span>
                    {cariler.get(k.cariId) ?? '?'}
                    <span className="soluk"> · {tlYaz(k.tutar)} toplam</span>
                  </span>
                  {k.yazilmamisTutar > 0 ? (
                    yetki('gider') ? (
                      <button type="button" onClick={() => void yaz(k.cariId)}>
                        {tlYaz(k.yazilmamisTutar)} gidere yaz
                      </button>
                    ) : (
                      <span className="soluk">{tlYaz(k.yazilmamisTutar)} yazılmadı</span>
                    )
                  ) : (
                    <span className="rozet-tamam">Yazıldı</span>
                  )}
                </li>
              ))}
            </ul>
            {hata && <Hatalar hatalar={[hata]} />}
            {mesaj && <p className="mesaj mesaj-basari">{mesaj}</p>}
          </section>
        </>
      )}
    </>
  );
}
