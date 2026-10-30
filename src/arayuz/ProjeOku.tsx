import { useEffect, useMemo, useState } from 'react';
import { DWG_UYARISI, planDosyasiOku } from '../cihaz/planDosyasi';
import { GIRDI_ADI } from '../hesap/maliyet';
import { aramaAnahtari } from '../hesap/metin';
import {
  aktarimOnerisi,
  birimTahmini,
  blokFormulOner,
  blokSayilari,
  duvarKatmaniOner,
  katmanUzunluklari,
  kotlardanKatYuksekligi,
  ODA_SINIFI_ADI,
  planlariBul,
  type AktarimSatiri,
  type Cizim,
  type OdaSinifi,
  type OkumaSonucu,
  type Plan,
  type PlanSecimi,
} from '../hesap/planOkuma';
import { sayiOku, sayiYaz } from '../hesap/sayi';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import { maliyetHesabiGetir, maliyetHesabiKaydet } from '../servisler/maliyet';
import { MALIYET_FORMULLERI } from '../veri/sabit/maliyetFormulleri';
import type { BinaGirdileri, MaliyetHesabi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { git } from './rota';

// Projeden okuma: mimari PDF ya da DXF yüklenir, planlar / mahaller / duvar / bloklar bulunur, kullanıcı onaylar,
// seçtikleri maliyet hesabına "📐 projeden" satırları ve bina bilgileri olarak aktarılır.

const BIRIMLER = [
  { carpan: 1, ad: 'metre' },
  { carpan: 0.01, ad: 'santimetre' },
  { carpan: 0.001, ad: 'milimetre' },
];
const BLOK_FORMULLERI = ['ic_kapi', 'celik_kapi', 'klozet', 'lavabo', 'batarya', 'kombi'];
const m2 = (n: number) => `${sayiYaz(Math.round(n * 100) / 100)} m²`;
const anonimBlok = (ad: string) => /^\*|^A\$C/i.test(ad);

export function ProjeOkuEkrani({ id }: { id: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [h, setH] = useState<MaliyetHesabi | null | undefined>(undefined);
  const [cizim, setCizim] = useState<Cizim | null>(null);
  const [okuma, setOkuma] = useState<OkumaSonucu | null>(null);
  const [ilerleme, setIlerleme] = useState<number | null>(null);
  const [hata, setHata] = useState<string[]>([]);

  useEffect(() => {
    void maliyetHesabiGetir(depo, oturum.firmaId, id).then(setH);
  }, [depo, oturum.firmaId, id]);

  if (h === undefined) return <p>Yükleniyor…</p>;
  if (h === null) return <p className="hata">Maliyet hesabı bulunamadı.</p>;

  const oku = async (dosya: File) => {
    setHata([]);
    setCizim(null);
    setOkuma(null);
    setIlerleme(0);
    try {
      const c = await planDosyasiOku(dosya, setIlerleme);
      const o = planlariBul(c);
      if (!o.planlar.length) throw new IsKuraliHatasi('Dosyada mahal (oda adı ve m²) bulunamadı. Mimari kat planlarının olduğu PDF ya da DXF yükleyin.');
      setCizim(c);
      setOkuma(o);
    } catch (e) {
      setHata([hataMetni(e)]);
    } finally {
      setIlerleme(null);
    }
  };

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/maliyet/${h.id}`}>← {h.ad}</a>
      </p>
      <h1>Projeden oku</h1>
      {h.onay ? (
        <p className="mesaj mesaj-uyari">Bu hesap onaylanmış; projeden okumak için önce revizyon açın.</p>
      ) : (
        <section className="kart">
          <p className="soluk">
            Mimari projenin PDF'ini (AutoCAD'den basılmış) ya da DXF dosyasını seçin. Dosya bu cihazda okunur, hiçbir yere gönderilmez. Kat planları, odalar ve m²'leri,
            DXF'te ayrıca duvar uzunluğu ve kapı/vitrifiye adetleri bulunur; hesaba aktarmadan önce siz onaylarsınız.
          </p>
          <label className="dugme dosya-dugmesi">
            📐 Dosya seç (PDF, DXF)
            <input
              type="file"
              accept=".pdf,.dxf,.dwg,application/pdf"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void oku(f);
              }}
            />
          </label>
          <p className="mesaj-not">{DWG_UYARISI} Büyük DXF dosyalarını bilgisayardan yüklemeniz önerilir.</p>
          {ilerleme !== null && (
            <p className="kucuk-bilgi" role="status">
              Okunuyor… %{Math.round(ilerleme * 100)}
            </p>
          )}
          <Hatalar hatalar={hata} />
        </section>
      )}
      {cizim && okuma && !h.onay && (
        <OkumaOnayi
          key={cizim.dosyaAdi}
          h={h}
          cizim={cizim}
          okuma={okuma}
          onAktar={async (girdiler, satirlar) => {
            const yeniSatirlar = h.satirlar.map((s) => {
              const a = satirlar.find((x) => x.formulKodu === s.formulKodu);
              return a ? { ...s, miktarKaynagi: 'proje' as const, miktar: a.miktar, dayanak: a.dayanak } : s;
            });
            await maliyetHesabiKaydet(depo, servis, h.id, { ad: h.ad, aciklama: h.aciklama, girdiler: { ...h.girdiler, ...girdiler }, satirlar: yeniSatirlar });
            git(`maliyet/${h.id}`);
          }}
        />
      )}
    </>
  );
}

/** Her kat (aynı kot ya da aynı ad) bir kez seçili gelir: birden çok paftada varsa mahal alanı en büyük olanı. */
function varsayilanSecimler(o: OkumaSonucu): PlanSecimi[] {
  const alan = (p: Plan) => p.mahaller.reduce((t, m) => t + (m.alan ?? 0), 0);
  const anahtar = (p: Plan) => {
    const b = p.baslik !== null ? o.basliklar[p.baslik]! : null;
    return !b || b.tip === 'diger' ? null : b.kot !== null ? `kot:${b.kot}` : `ad:${aramaAnahtari(b.ad)}`;
  };
  const secilen = new Map<string, Plan>();
  for (const p of o.planlar) {
    const k = anahtar(p);
    if (k && (!secilen.has(k) || alan(p) > alan(secilen.get(k)!))) secilen.set(k, p);
  }
  const dahil = new Set([...secilen.values()].map((p) => p.no));
  return o.planlar.map((p) => {
    const b = p.baslik !== null ? o.basliklar[p.baslik]! : null;
    return { no: p.no, dahil: dahil.has(p.no), tekrar: 1, ad: b?.ad ?? `Plan ${p.no + 1}`, tip: b?.tip ?? 'normal', kot: b?.kot ?? null };
  });
}

function OkumaOnayi({ h, cizim, okuma, onAktar }: { h: MaliyetHesabi; cizim: Cizim; okuma: OkumaSonucu; onAktar: (g: Partial<BinaGirdileri>, s: AktarimSatiri[]) => Promise<void> }) {
  const dxf = cizim.kaynak === 'dxf';
  const [secimler, setSecimler] = useState<PlanSecimi[]>(() => varsayilanSecimler(okuma));
  const [siniflar, setSiniflar] = useState<Map<string, OdaSinifi>>(new Map());
  const [acikPlan, setAcikPlan] = useState<number | null>(null);
  const [hata, setHata] = useState<string[]>([]);
  const [mesgul, setMesgul] = useState(false);

  // Plan başına katman uzunlukları ve bloklar (DXF): plan kutusu %8 genişletilir (duvarlar oda yazılarının dışında kalır).
  const planOlcumleri = useMemo(() => {
    const m = new Map<number, { katmanlar: Map<string, number>; bloklar: Map<string, number> }>();
    if (!dxf) return m;
    for (const p of okuma.planlar) {
      const pay = Math.max(p.kutu.x1 - p.kutu.x0, p.kutu.y1 - p.kutu.y0) * 0.08;
      m.set(p.no, { katmanlar: katmanUzunluklari(cizim.parcalar, p.kutu, pay), bloklar: blokSayilari(cizim.bloklar, p.kutu, pay) });
    }
    return m;
  }, [dxf, okuma, cizim]);
  const dahilPlanlar = okuma.planlar.filter((p) => secimler.find((s) => s.no === p.no)?.dahil);
  const katmanToplami = useMemo(() => {
    const t = new Map<string, number>();
    for (const p of dahilPlanlar) for (const [k, u] of planOlcumleri.get(p.no)?.katmanlar ?? []) t.set(k, (t.get(k) ?? 0) + u);
    return t;
  }, [dahilPlanlar, planOlcumleri]);
  const [duvarKatmani, setDuvarKatmani] = useState<string>(() => duvarKatmaniOner(katmanToplami) ?? '');
  const [carpan, setCarpan] = useState(() => birimTahmini(cizim.parcalar.get(duvarKatmani), cizim.birimKodu));
  const blokAdlari = useMemo(() => {
    const t = new Map<string, number>();
    for (const p of dahilPlanlar) for (const [b, n] of planOlcumleri.get(p.no)?.bloklar ?? []) if (!anonimBlok(b)) t.set(b, (t.get(b) ?? 0) + n);
    return [...t].sort((a, b) => b[1] - a[1]).slice(0, 15);
  }, [dahilPlanlar, planOlcumleri]);
  const [blokFormulleri, setBlokFormulleri] = useState<Map<string, string>>(() => new Map(blokAdlari.flatMap(([b]) => (blokFormulOner(b) ? [[b, blokFormulOner(b)!] as [string, string]] : []))));
  const kotYuksekligi = kotlardanKatYuksekligi(secimler.filter((s) => s.dahil).map((s) => s.kot));
  const [katYuk, setKatYuk] = useState(sayiYaz(kotYuksekligi ?? h.girdiler.katYuksekligi));

  const formulAdi = (kod: string) => h.satirlar.find((s) => s.formulKodu === kod)?.ad ?? MALIYET_FORMULLERI.find((f) => f.kod === kod)?.ad ?? kod;
  const oneri = aktarimOnerisi({
    dosyaAdi: cizim.dosyaAdi,
    planlar: okuma.planlar.map((plan) => ({
      plan,
      secim: secimler.find((s) => s.no === plan.no)!,
      duvarUzunlugu: dxf && duvarKatmani ? (planOlcumleri.get(plan.no)?.katmanlar.get(duvarKatmani) ?? 0) * carpan : null,
      bloklar: planOlcumleri.get(plan.no)?.bloklar ?? new Map(),
    })),
    siniflar,
    blokFormulleri,
    katYuksekligi: sayiOku(katYuk),
  });
  const [kapali, setKapali] = useState<Set<string>>(new Set());
  const secimDegistir = (no: number, d: Partial<PlanSecimi>) => setSecimler((l) => l.map((s) => (s.no === no ? { ...s, ...d } : s)));
  const satirVar = (kod: string) => h.satirlar.some((s) => s.formulKodu === kod);

  const aktar = async () => {
    setHata([]);
    setMesgul(true);
    try {
      const girdiler = Object.fromEntries(Object.entries(oneri.girdiler).filter(([k]) => !kapali.has(`g:${k}`))) as Partial<BinaGirdileri>;
      await onAktar(
        girdiler,
        oneri.satirlar.filter((s) => !kapali.has(`s:${s.formulKodu}`) && satirVar(s.formulKodu)),
      );
    } catch (e) {
      setHata([hataMetni(e)]);
      setMesgul(false);
    }
  };
  const isaret = (anahtar: string) => (
    <input
      type="checkbox"
      checked={!kapali.has(anahtar)}
      onChange={(e) =>
        setKapali((k) => {
          const y = new Set(k);
          if (e.target.checked) y.delete(anahtar);
          else y.add(anahtar);
          return y;
        })
      }
    />
  );

  return (
    <>
      <section className="kart">
        <h2>Bulunan planlar</h2>
        <p className="soluk">
          {cizim.dosyaAdi} · {okuma.planlar.length} plan, {okuma.basliklar.filter((b) => b.tip !== 'diger').length} kat başlığı. Aynı plan birden çok paftada varsa yalnız
          biri seçili gelir; normal kat birkaç katta tekrar ediyorsa "Tekrar"ı artırın.
        </p>
        {(() => {
          const satirlar = (liste: Plan[]) => (
            <ul className="plan-listesi">
          {liste.map((p) => {
            const s = secimler.find((x) => x.no === p.no)!;
            const alan = p.mahaller.reduce((t, m) => t + (m.alan ?? 0), 0);
            const duvar = dxf && duvarKatmani ? (planOlcumleri.get(p.no)?.katmanlar.get(duvarKatmani) ?? 0) * carpan * 0.5 : null;
            return (
              <li key={p.no} className={s.dahil ? 'plan-dahil' : ''}>
                <div className="plan-satiri">
                  <label className="onay-kutusu">
                    <input type="checkbox" checked={s.dahil} onChange={(e) => secimDegistir(p.no, { dahil: e.target.checked })} />
                    <span className="sr-only">Hesaba kat</span>
                  </label>
                  <input className="plan-adi" value={s.ad} onChange={(e) => secimDegistir(p.no, { ad: e.target.value })} aria-label="Kat adı" />
                  <label className="plan-tekrar">
                    ×
                    <input inputMode="numeric" value={s.tekrar} onChange={(e) => secimDegistir(p.no, { tekrar: Math.max(0, Math.min(99, Number(e.target.value) || 0)) })} aria-label="Tekrar" />
                  </label>
                </div>
                <button type="button" className="baglanti-dugmesi plan-bilgi" onClick={() => setAcikPlan((a) => (a === p.no ? null : p.no))}>
                  {s.kot !== null && `${s.kot >= 0 ? '+' : ''}${sayiYaz(s.kot)} kot · `}
                  {p.mahaller.length} mahal · {m2(alan)}
                  {duvar !== null && ` · duvar ${sayiYaz(Math.round(duvar))} m`} {acikPlan === p.no ? '▲' : '▼'}
                </button>
                {acikPlan === p.no && <MahalTablosu plan={p} siniflar={siniflar} onSinif={(k, v) => setSiniflar((m) => new Map(m).set(k, v))} />}
              </li>
            );
          })}
            </ul>
          );
          const basliksiz = okuma.planlar.filter((p) => p.baslik === null && !secimler.find((x) => x.no === p.no)!.dahil);
          return (
            <>
              {satirlar(okuma.planlar.filter((p) => !basliksiz.includes(p)))}
              {basliksiz.length > 0 && (
                <details>
                  <summary>Başlığı bulunamayan planlar ({basliksiz.length})</summary>
                  {satirlar(basliksiz)}
                </details>
              )}
            </>
          );
        })()}
      </section>

      <section className="kart">
        <h2>Ölçüler</h2>
        <div className="satir-alanlar">
          <Alan etiket="Kat yüksekliği (m)" aciklama={kotYuksekligi !== null ? `Kotlardan ${sayiYaz(kotYuksekligi)} m` : 'Kotlardan bulunamadı; yazın'}>
            <input inputMode="decimal" value={katYuk} onChange={(e) => setKatYuk(e.target.value)} />
          </Alan>
          {dxf && (
            <Alan etiket="Çizim birimi" aciklama="Duvar kalınlığından tahmin edildi">
              <select value={carpan} onChange={(e) => setCarpan(Number(e.target.value))}>
                {BIRIMLER.map((b) => (
                  <option key={b.carpan} value={b.carpan}>
                    {b.ad}
                  </option>
                ))}
              </select>
            </Alan>
          )}
        </div>
        {dxf && (
          <>
            <Alan etiket="Duvar katmanı" aciklama="Duvar çizgilerinin olduğu katman; uzunluğun yarısı duvar boyu sayılır (iki yüz)">
              <select value={duvarKatmani} onChange={(e) => setDuvarKatmani(e.target.value)}>
                <option value="">— Duvar ölçme —</option>
                {[...katmanToplami]
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 40)
                  .map(([k, u]) => (
                    <option key={k} value={k}>
                      {k} · {sayiYaz(Math.round(u * carpan * 0.5))} m
                    </option>
                  ))}
              </select>
            </Alan>
            {blokAdlari.length > 0 && (
              <>
                <h3>Bloklar (seçili planlarda)</h3>
                <ul className="blok-listesi">
                  {blokAdlari.map(([ad, n]) => (
                    <li key={ad}>
                      <span>
                        {ad} <span className="soluk">× {n}</span>
                      </span>
                      <select
                        value={blokFormulleri.get(ad) ?? ''}
                        onChange={(e) =>
                          setBlokFormulleri((m) => {
                            const y = new Map(m);
                            if (e.target.value) y.set(ad, e.target.value);
                            else y.delete(ad);
                            return y;
                          })
                        }
                        aria-label={`${ad} bloğu`}
                      >
                        <option value="">Sayma</option>
                        {BLOK_FORMULLERI.map((f) => (
                          <option key={f} value={f}>
                            {formulAdi(f)}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section className="kart">
        <h2>Hesaba aktarılacaklar</h2>
        <p className="soluk">
          Alanlar: oda {m2(oneri.alanlar.kuru)} · ıslak hacim {m2(oneri.alanlar.islak)} · ortak {m2(oneri.alanlar.ortak)} · balkon/teras {m2(oneri.alanlar.balkon)}
          {oneri.alanlar.bosluk > 0 && ` · boşluk ${m2(oneri.alanlar.bosluk)} (girmez)`}
        </p>
        {oneri.uyarilar.map((u) => (
          <p key={u} className="mesaj mesaj-uyari">
            {u}
          </p>
        ))}
        <ul className="aktarim-listesi">
          {(Object.entries(oneri.girdiler) as [keyof BinaGirdileri, number][]).map(([k, v]) => (
            <li key={k}>
              <label className="onay-kutusu">
                {isaret(`g:${k}`)}
                <span>
                  <strong>{GIRDI_ADI[k].ad}</strong>: {sayiYaz(h.girdiler[k])} → <strong>{sayiYaz(v)}</strong> {GIRDI_ADI[k].birim}
                </span>
              </label>
            </li>
          ))}
          {oneri.satirlar.map((s) => {
            const mevcut = h.satirlar.find((x) => x.formulKodu === s.formulKodu);
            return (
              <li key={s.formulKodu}>
                <label className="onay-kutusu">
                  {mevcut ? isaret(`s:${s.formulKodu}`) : <input type="checkbox" disabled />}
                  <span>
                    <strong>📐 {formulAdi(s.formulKodu)}</strong>: {sayiYaz(mevcut?.miktar ?? null) || '—'} → <strong>{sayiYaz(s.miktar)}</strong> {mevcut?.birim}
                    {s.yaklasik && <span className="etiket-cip">yaklaşık</span>}
                    <br />
                    <span className="soluk">{mevcut ? s.dayanak : 'Bu satır hesaptan çıkarılmış; önce "Satır ekle"den geri ekleyin.'}</span>
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        <p className="mesaj-not">
          Aktarılan satırlar "📐 Projeden" olarak işaretlenir; bunlara dayanan satırlar (tuğla, alçı, boya…) da bu miktarlarla yeniden hesaplanır. Satırın içinden "🧮 Formülle"ye
          dönebilirsiniz.
        </p>
        <Hatalar hatalar={hata} />
        <div className="dugmeler">
          <button type="button" disabled={mesgul || !dahilPlanlar.length} onClick={() => void aktar()}>
            Hesaba aktar
          </button>
        </div>
      </section>
    </>
  );
}

function MahalTablosu({ plan, siniflar, onSinif }: { plan: Plan; siniflar: Map<string, OdaSinifi>; onSinif: (anahtar: string, s: OdaSinifi) => void }) {
  return (
    <table className="veri-tablosu mahal-tablosu">
      <thead>
        <tr>
          <th>Mahal</th>
          <th>m²</th>
          <th>Sınıf</th>
        </tr>
      </thead>
      <tbody>
        {plan.mahaller.map((m, i) => {
          const k = `${plan.no}:${i}`;
          return (
            <tr key={k}>
              <td>{m.ad}</td>
              <td className="sayi">{m.alan === null ? '—' : sayiYaz(m.alan)}</td>
              <td>
                <select value={siniflar.get(k) ?? m.sinif} onChange={(e) => onSinif(k, e.target.value as OdaSinifi)} aria-label={`${m.ad} sınıfı`}>
                  {(Object.keys(ODA_SINIFI_ADI) as OdaSinifi[]).map((s) => (
                    <option key={s} value={s}>
                      {ODA_SINIFI_ADI[s]}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
