import { useEffect, useMemo, useState } from 'react';
import { Simge } from './Simge';
import {
  BANKA_SUTUN_ADI,
  bankaBasligiBul,
  bankaHareketleri,
  HAREKET_TURU_ADI,
  type BankaSutunlari,
  type BankaSutunu,
  type HareketTuru,
} from '../hesap/bankaHareketi';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { csvOku, htmlTabloOku, metinCoz, xlsxOku, type TabloSayfasi } from '../hesap/tabloOku';
import { bankaAktarimiHazirla, bankaHareketiKaydet, type AktarimSatiri, type HareketSecimi } from '../servisler/bankaAktar';
import { carileriListele, type CariOzeti } from '../servisler/cari';
import { hesaplariListele, type HesapOzeti } from '../servisler/hesap';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';

// Banka hareketlerini dosyadan alma: bankanın hesap hareketleri dosyası (.xlsx, .csv ya da bankanın ".xls" HTML'i)
// cihazda okunur; programda olan hareketler işaretlenir, olmayanlar için tür ve cari önerilir, onaylanınca kaydedilir.

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const KAYIT_ADI: Record<string, string> = { odeme: 'Ödeme/tahsilat', transfer: 'Transfer', cekHareketi: 'Çek' };

export function BankaAktarEkrani({ hesapId }: { hesapId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [hesaplar, setHesaplar] = useState<HesapOzeti[]>([]);
  const [cariler, setCariler] = useState<CariOzeti[]>([]);
  const [dosyaAdi, setDosyaAdi] = useState('');
  const [sayfalar, setSayfalar] = useState<TabloSayfasi[]>([]);
  const [sayfaNo, setSayfaNo] = useState(0);
  const [baslik, setBaslik] = useState(-1);
  const [sutunlar, setSutunlar] = useState<BankaSutunlari>({});
  const [aktarim, setAktarim] = useState<{ satirlar: AktarimSatiri[]; bakiye: number } | null>(null);
  const [secimler, setSecimler] = useState<Map<number, HareketSecimi>>(new Map());
  const [kayitliGoster, setKayitliGoster] = useState(false);
  const [hata, setHata] = useState<string[]>([]);
  const [mesaj, setMesaj] = useState<string | null>(null);
  const [mesgul, setMesgul] = useState(false);

  useEffect(() => {
    void hesaplariListele(depo, oturum.firmaId).then(setHesaplar);
    void carileriListele(depo, oturum.firmaId).then((l) => setCariler(l.filter((c) => !c.cari.roller.includes('vergi_dairesi')).sort((a, b) => a.cari.ad.localeCompare(b.cari.ad, 'tr'))));
  }, [depo, oturum.firmaId]);

  const hesap = hesaplar.find((h) => h.hesap.id === hesapId)?.hesap;
  const sayfa = sayfalar[sayfaNo];
  const hareketler = useMemo(() => (sayfa && baslik >= 0 ? bankaHareketleri(sayfa.satirlar, baslik, sutunlar) : []), [sayfa, baslik, sutunlar]);

  const hazirla = async () => {
    const a = await bankaAktarimiHazirla(depo, oturum.firmaId, hesapId, hareketler, yerelGun(new Date()));
    setAktarim(a);
    setSecimler(new Map(a.satirlar.filter((x) => !x.kayitli).map((x) => [x.hareket.satirNo, { tur: x.tur, cariId: x.cariId, karsiHesapId: null, kredi: x.kredi }])));
  };
  useEffect(() => {
    if (!hareketler.length) return setAktarim(null);
    void hazirla().catch((e: unknown) => setHata([hataMetni(e)]));
  }, [hareketler]);

  const sayfaSec = (l: TabloSayfasi[], no: number) => {
    const b = bankaBasligiBul(l[no]?.satirlar ?? []);
    setSayfaNo(no);
    setBaslik(b?.satir ?? -1);
    setSutunlar(b?.sutunlar ?? {});
    if (!b) setHata(['"Tarih" ve "Tutar" (ya da "Borç" ve "Alacak") başlıklı sütunlar bulunamadı. Başlık satırını ve sütunları aşağıdan seçin.']);
  };

  const oku = async (f: File) => {
    setHata([]);
    setMesaj(null);
    setSayfalar([]);
    setAktarim(null);
    try {
      const baytlar = new Uint8Array(await f.arrayBuffer());
      const uzanti = f.name.toLowerCase().split('.').pop();
      const zip = baytlar[0] === 0x50 && baytlar[1] === 0x4b;
      const ole = baytlar[0] === 0xd0 && baytlar[1] === 0xcf;
      let l: TabloSayfasi[];
      if (zip) l = xlsxOku(baytlar);
      else if (ole) throw new IsKuraliHatasi('Eski Excel (.xls) biçimi okunmuyor. Bankadan .xlsx ya da .csv indirin, ya da Excel\'de "Farklı kaydet → .xlsx" yapın.');
      else {
        const metin = metinCoz(baytlar);
        if (/<table/i.test(metin.slice(0, 20000)) || /<html/i.test(metin.slice(0, 2000))) l = htmlTabloOku(metin, f.name);
        else if (uzanti === 'csv' || uzanti === 'txt' || uzanti === 'xls') l = [csvOku(metin, f.name)];
        else throw new IsKuraliHatasi('Hesap hareketleri dosyası olarak .xlsx ya da .csv yükleyin.');
      }
      const dolu = l.filter((x) => x.satirlar.some((r) => r.length));
      if (!dolu.length) throw new IsKuraliHatasi('Dosyada dolu sayfa bulunamadı.');
      setDosyaAdi(f.name);
      setSayfalar(dolu);
      sayfaSec(dolu, Math.max(0, dolu.findIndex((x) => bankaBasligiBul(x.satirlar))));
    } catch (e) {
      setHata([hataMetni(e)]);
    }
  };

  const secimYaz = (satirNo: number, d: Partial<HareketSecimi>) => setSecimler((m) => new Map(m).set(satirNo, { ...m.get(satirNo)!, ...d }));
  const hazirMi = (x: AktarimSatiri, s: HareketSecimi | undefined) =>
    !!s && s.tur !== 'atla' && (s.tur === 'odeme' || s.tur === 'tahsilat' ? !!s.cariId : s.tur === 'transfer' ? !!s.karsiHesapId : s.tur === 'kredi' ? !!s.kredi : true) && !x.kayitli;
  const yeniler = aktarim?.satirlar.filter((x) => !x.kayitli) ?? [];
  const hazirlar = yeniler.filter((x) => hazirMi(x, secimler.get(x.hareket.satirNo)));

  async function kaydet(liste: AktarimSatiri[]) {
    setHata([]);
    setMesaj(null);
    setMesgul(true);
    const bugun = yerelGun(new Date());
    let tamam = 0;
    const hatalar: string[] = [];
    for (const x of liste) {
      try {
        await bankaHareketiKaydet(depo, servis, hesapId, x.hareket, secimler.get(x.hareket.satirNo)!, bugun);
        tamam++;
      } catch (e) {
        hatalar.push(`Satır ${x.hareket.satirNo} (${tarihYaz(x.hareket.tarih)}): ${hataMetni(e)}`);
      }
    }
    await hazirla();
    setHata(hatalar);
    if (tamam) setMesaj(`${tamam} hareket kaydedildi.`);
    setMesgul(false);
  }

  const sutunSayisi = Math.max(0, ...(sayfa?.satirlar.slice(0, 50).map((r) => r.length) ?? [0]));
  const sonBakiye = [...hareketler].reverse().find((x) => x.bakiye !== null);
  const gorunen = (aktarim?.satirlar ?? []).filter((x) => kayitliGoster || !x.kayitli);
  const turSecenekleri = (x: AktarimSatiri): HareketTuru[] =>
    x.hareket.tutar < 0 ? ['odeme', 'masraf', 'transfer', ...(x.kredi ? (['kredi'] as const) : []), 'atla'] : ['tahsilat', 'transfer', 'atla'];

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/hesaplar/${hesapId}`}>← {hesap?.ad ?? 'Hesap'}</a>
      </p>
      <h1>Banka hareketlerini al</h1>
      <section className="kart">
        <p className="soluk">
          Bankanızın internet şubesinden bu hesabın hareketlerini Excel (.xlsx) ya da .csv olarak indirip seçin. Programda zaten olan hareketler işaretlenir; olmayanlar
          için cari ve tür önerilir, siz onaylayınca kaydedilir. Dosya bu cihazda okunur, hiçbir yere gönderilmez.
        </p>
        <label className="dugme dosya-dugmesi">
          <Simge ad="belge" /> Hareket dosyası seç
          <input
            type="file"
            accept=".xlsx,.csv,.txt,.xls,.html,.htm"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void oku(f);
            }}
          />
        </label>
        {dosyaAdi && <p className="soluk kucuk">{dosyaAdi}</p>}
      </section>

      {sayfa && (
        <details className="kart" open={baslik < 0}>
          <summary>
            <h2>Sütunlar</h2>
          </summary>
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
            {(Object.keys(BANKA_SUTUN_ADI) as BankaSutunu[]).map((k) => (
              <Alan key={k} etiket={BANKA_SUTUN_ADI[k]}>
                <select
                  value={sutunlar[k] ?? ''}
                  onChange={(e) => {
                    const y = { ...sutunlar };
                    if (e.target.value === '') delete y[k];
                    else y[k] = Number(e.target.value);
                    setSutunlar(y);
                  }}
                >
                  <option value="">—</option>
                  {Array.from({ length: sutunSayisi }, (_, j) => (
                    <option key={j} value={j}>
                      {String.fromCharCode(65 + (j % 26))} sütunu{baslik >= 0 && sayfa.satirlar[baslik]?.[j] ? `: ${String(sayfa.satirlar[baslik]![j]).slice(0, 30)}` : ''}
                    </option>
                  ))}
                </select>
              </Alan>
            ))}
          </div>
          <p className="soluk kucuk">Tek tutar sütunu varsa çıkışlar eksi olmalı; ayrı Borç (çıkan) ve Alacak (giren) sütunları da olur.</p>
        </details>
      )}

      {aktarim && (
        <>
          <section className="kart">
            <p className="ozet-tutar">
              <span>Dosyadaki hareket</span>
              <span>{aktarim.satirlar.length}</span>
            </p>
            <p className="ozet-tutar">
              <span>Programda zaten olan</span>
              <span>{aktarim.satirlar.length - yeniler.length}</span>
            </p>
            <p className="ozet-tutar ozet-toplam">
              <span>Kaydedilecek yeni</span>
              <strong>{yeniler.length}</strong>
            </p>
            {sonBakiye && (
              <p className={sonBakiye.bakiye === aktarim.bakiye ? 'mesaj mesaj-basari' : 'mesaj mesaj-not'}>
                Dosyadaki son bakiye {tlYaz(sonBakiye.bakiye!)} ({tarihYaz(sonBakiye.tarih)}) · programdaki bakiye {tlYaz(aktarim.bakiye)}
                {sonBakiye.bakiye === aktarim.bakiye ? ' — tutuyor.' : ` — fark ${tlYaz(sonBakiye.bakiye! - aktarim.bakiye)}.`}
              </p>
            )}
            <label className="onay-kutusu">
              <input type="checkbox" checked={kayitliGoster} onChange={(e) => setKayitliGoster(e.target.checked)} />
              <span>Programda olanları da göster</span>
            </label>
            <Hatalar hatalar={hata} />
            {mesaj && <p className="mesaj mesaj-basari">{mesaj}</p>}
            {hazirlar.length > 0 && (
              <div className="dugmeler">
                <button type="button" disabled={mesgul} onClick={() => void kaydet(hazirlar)}>
                  Hazır olan {hazirlar.length} hareketi kaydet
                </button>
              </div>
            )}
          </section>

          <ul className="banka-hareketleri">
            {gorunen.map((x) => {
              const s = secimler.get(x.hareket.satirNo);
              const cikis = x.hareket.tutar < 0;
              return (
                <li key={x.hareket.satirNo} className={`kart ${x.kayitli ? 'bh-kayitli' : ''}`}>
                  <div className="baslik-satiri">
                    <span className="soluk">
                      {tarihYaz(x.hareket.tarih)} · satır {x.hareket.satirNo}
                    </span>
                    <strong className={cikis ? 'bakiye-borc' : 'bh-giris'}>
                      {cikis ? '−' : '+'}
                      {tlYaz(Math.abs(x.hareket.tutar))}
                    </strong>
                  </div>
                  <p className="bh-aciklama">{x.hareket.aciklama || <span className="soluk">Açıklama yok</span>}</p>
                  {x.kayitli ? (
                    <p className="soluk kucuk">
                      ✓ Programda var ({KAYIT_ADI[x.kayitli.kayitTur] ?? x.kayitli.kayitTur}
                      {x.kayitli.aciklama ? `: ${x.kayitli.aciklama}` : ''})
                    </p>
                  ) : (
                    s && (
                      <div className="bh-secim">
                        <select value={s.tur} aria-label="Ne olarak kaydedilsin" onChange={(e) => secimYaz(x.hareket.satirNo, { tur: e.target.value as HareketTuru })}>
                          {turSecenekleri(x).map((t) => (
                            <option key={t} value={t}>
                              {HAREKET_TURU_ADI[t]}
                            </option>
                          ))}
                        </select>
                        {(s.tur === 'odeme' || s.tur === 'tahsilat') && (
                          <select value={s.cariId ?? ''} aria-label="Cari" onChange={(e) => secimYaz(x.hareket.satirNo, { cariId: e.target.value || null })}>
                            <option value="">Cari seçin</option>
                            {x.cariId && <option value={x.cariId}>★ {cariler.find((c) => c.cari.id === x.cariId)?.cari.ad}</option>}
                            {cariler
                              .filter((c) => c.cari.id !== x.cariId)
                              .map((c) => (
                                <option key={c.cari.id} value={c.cari.id}>
                                  {c.cari.ad}
                                </option>
                              ))}
                          </select>
                        )}
                        {s.tur === 'transfer' && (
                          <select value={s.karsiHesapId ?? ''} aria-label="Karşı hesap" onChange={(e) => secimYaz(x.hareket.satirNo, { karsiHesapId: e.target.value || null })}>
                            <option value="">{cikis ? 'Hangi hesaba gitti?' : 'Hangi hesaptan geldi?'}</option>
                            {hesaplar
                              .filter((h) => h.hesap.id !== hesapId && h.hesap.paraBirimi === 'TRY')
                              .map((h) => (
                                <option key={h.hesap.id} value={h.hesap.id}>
                                  {h.hesap.ad}
                                </option>
                              ))}
                          </select>
                        )}
                        {s.tur === 'kredi' && x.kredi && (
                          <span className="soluk kucuk">
                            {x.kredi.ad} · {tarihYaz(x.kredi.vade)} vadeli taksit
                          </span>
                        )}
                        {s.tur === 'masraf' && <span className="soluk kucuk">Firma geneli gider, KDV'siz</span>}
                        {s.tur === 'odeme' && <span className="soluk kucuk">Carinin açık borçlarına en eski vadeden dağıtılır</span>}
                        {hazirMi(x, s) && (
                          <button type="button" className="ikincil" disabled={mesgul} onClick={() => void kaydet([x])}>
                            Kaydet
                          </button>
                        )}
                      </div>
                    )
                  )}
                </li>
              );
            })}
          </ul>
          {gorunen.length === 0 && <p className="mesaj mesaj-basari">Dosyadaki bütün hareketler programda var.</p>}
        </>
      )}
    </>
  );
}
