import { Fragment, useEffect, useState } from "react";
import type { ExcelSayfasi } from "../hesap/excel";
import {
  ILERLEME_ESIGI,
  TAHMIN_YONTEMI_ADI,
  type IsSonuKalemi,
  type IsSonuTahmini,
} from "../hesap/isSonu";
import { tlYaz } from "../hesap/para";
import { yerelGun } from "../hesap/tarih";
import { isSonuRaporuGetir, type IsSonuRaporu } from "../servisler/isSonu";
import { projeGetir } from "../servisler/proje";
import type { Proje } from "../veri/tipler";
import { AktarmaDugmeleri } from "./Aktarma";
import { useUygulama } from "./baglam";
import { useGenisEkran } from "./ekran";
import { Simge } from "./Simge";

// İş sonu maliyet tahmini: bugüne kadar harcanan + işi bitirmek için gereken (ana kalem başına), beklenen kâr ve son
// aylarda neden değiştiği. Hesap `hesap/isSonu.ts`.

const tl = (k: number) => tlYaz(Math.round(k / 100) * 100).replace(/,00$/, "");
const tlIsaretli = (k: number) =>
  `${k > 0 ? "+" : k < 0 ? "−" : ""}${tl(Math.abs(k))}`;
const yuzde = (n: number | null) => (n === null ? "—" : `%${Math.round(n)}`);
const ayYaz = (t: string, bugun: string) =>
  t === bugun
    ? "Bugün"
    : new Date(`${t}T00:00:00`).toLocaleDateString("tr-TR", {
        month: "long",
        year: "numeric",
      }) + " sonu";

function aciklama(k: IsSonuKalemi): string {
  switch (k.yontem) {
    case "ilerleme":
      return k.ilerleme !== null && k.ilerleme >= 100
        ? "İş tamamlandı olarak girilmiş: tahmin harcanan kadar."
        : `İş ${yuzde(k.ilerleme)} oranında yapıldı ve ${tl(k.harcanan)} harcandı. Harcama hızı aynı kalırsa iş sonu maliyeti: ${tl(k.tahmin)}.`;
    case "butce":
      return k.ilerleme !== null && k.ilerleme > 0
        ? `İlerleme %${ILERLEME_ESIGI} oranından az; harcama hızı henüz güvenilir değil, bütçe alındı.`
        : "İlerleme girilmedi: bütçe alındı. İlerleme girildikçe tahmin harcama hızına göre güncellenir.";
    case "taahhut":
      return `İmzalı sözleşmelerde ve arsa sahibine kalan ödeme (${tl(k.taahhut)}) yapılmadan iş bitmez: harcanan + kalan taahhüt.`;
    case "harcanan":
      return "Bütçe ve ilerleme yok: yalnız bugüne kadar harcanan sayıldı (kalan iş bilinmiyor).";
  }
}

function sapmaSinifi(s: number | null) {
  return s === null || s === 0
    ? undefined
    : s > 0
      ? "vade-cikis"
      : "vade-giris";
}

function excelSayfalari(
  proje: string,
  r: IsSonuRaporu,
  kdv: string,
  bugun: string,
): ExcelSayfasi[] {
  const t = r.bugun.tahmin;
  const p = (n: number) => ({ tl: n });
  return [
    {
      ad: "İş sonu tahmini",
      ust: [
        `${proje} · İş sonu maliyet tahmini (${kdv})`,
        `Hazırlanma: ${new Date(`${bugun}T00:00`).toLocaleDateString("tr-TR")}`,
      ],
      basliklar: [
        "Kalem",
        "Bütçe",
        "Harcanan",
        "İlerleme %",
        "Kalan taahhüt",
        "İşi bitirmek için",
        "İş sonu tahmini",
        "Bütçeden sapma",
        "Yöntem",
      ],
      satirlar: [
        ...t.kalemler.map((k) => [
          k.ad,
          k.butce === null ? null : p(k.butce),
          p(k.harcanan),
          k.ilerleme,
          p(k.taahhut),
          p(k.kalanIs),
          p(k.tahmin),
          k.sapma === null ? null : p(k.sapma),
          TAHMIN_YONTEMI_ADI[k.yontem],
        ]),
        ...(t.kalemsiz
          ? [
              [
                "Kalemsiz harcama",
                null,
                p(t.kalemsiz),
                null,
                null,
                null,
                p(t.kalemsiz),
                null,
                "",
              ],
            ]
          : []),
        [
          { kalin: "Toplam" },
          p(t.butce),
          p(t.harcanan),
          null,
          null,
          p(t.kalanIs),
          p(t.tahmin),
          p(t.sapma),
          "",
        ],
      ],
    },
    {
      ad: "Değişim",
      basliklar: [
        "Tarih",
        "Gelir tahmini",
        "İş sonu maliyet",
        "Beklenen kâr",
        "Değişim",
        "Nedenler",
      ],
      satirlar: r.gecmis.map((x) => [
        { tarih: x.gun },
        p(x.tahmin.gelir),
        p(x.tahmin.tahmin),
        p(x.tahmin.kar),
        x.karFarki === null ? null : p(x.karFarki),
        x.nedenler.join(" · "),
      ]),
    },
  ];
}

/** Bütçesi, harcaması ve taahhüdü olmayan kalem tahmine bir şey katmaz; listede kalabalık etmesin. */
const bosKalem = (k: IsSonuKalemi) =>
  k.butce === null && k.harcanan === 0 && k.taahhut === 0;

function KalemSatirlari({ t: tumu }: { t: IsSonuTahmini }) {
  const genis = useGenisEkran();
  const [acik, setAcik] = useState<string | null>(null);
  const t = { ...tumu, kalemler: tumu.kalemler.filter((k) => !bosKalem(k)) };
  const bosAdlar = tumu.kalemler.filter(bosKalem).map((k) => k.ad);
  const bosNotu = bosAdlar.length > 0 && (
    <p className="soluk kucuk">
      Bütçesi ve harcaması olmayan kalemler gösterilmedi: {bosAdlar.join(", ")}.
    </p>
  );
  if (!genis)
    return (
      <>
        <ul className="is-sonu-kartlari">
          {t.kalemler.map((k) => (
            <li key={k.kalemId}>
              <button
                type="button"
                className="is-sonu-kart"
                aria-expanded={acik === k.kalemId}
                onClick={() => setAcik(acik === k.kalemId ? null : k.kalemId)}
              >
                <span className="isk-ust">
                  <strong>{k.ad}</strong>
                  <strong>{tl(k.tahmin)}</strong>
                </span>
                <span className="isk-alt soluk">
                  Harcanan {tl(k.harcanan)} · ilerleme {yuzde(k.ilerleme)} ·
                  kalan {tl(k.kalanIs)}
                </span>
                <span className="isk-alt">
                  <span className="etiket-cip">
                    {TAHMIN_YONTEMI_ADI[k.yontem]}
                  </span>
                  {k.sapma !== null && k.sapma !== 0 && (
                    <span className={sapmaSinifi(k.sapma)}>
                      bütçeden {tlIsaretli(k.sapma)}
                    </span>
                  )}
                </span>
              </button>
              {acik === k.kalemId && (
                <p className="isk-aciklama soluk">{aciklama(k)}</p>
              )}
            </li>
          ))}
        </ul>
        {bosNotu}
      </>
    );
  return (
    <>
      <div className="tablo-kaydir">
        <table className="veri-tablosu is-sonu-tablosu">
          <thead>
            <tr>
              <th scope="col">Kalem</th>
              <th scope="col">Bütçe</th>
              <th scope="col">Harcanan</th>
              <th scope="col">İlerleme</th>
              <th scope="col">İşi bitirmek için</th>
              <th scope="col">İş sonu tahmini</th>
              <th scope="col">Bütçeden sapma</th>
            </tr>
          </thead>
          <tbody>
            {t.kalemler.map((k) => (
              <Fragment key={k.kalemId}>
                <tr
                  className="nt-satir"
                  onClick={() => setAcik(acik === k.kalemId ? null : k.kalemId)}
                >
                  <th scope="row">
                    <button
                      type="button"
                      className="baglanti-dugmesi"
                      aria-expanded={acik === k.kalemId}
                    >
                      {k.ad}
                    </button>
                    <span className="nt-not soluk">
                      {TAHMIN_YONTEMI_ADI[k.yontem]}
                    </span>
                  </th>
                  <td>{k.butce === null ? "—" : tl(k.butce)}</td>
                  <td>{tl(k.harcanan)}</td>
                  <td>{yuzde(k.ilerleme)}</td>
                  <td>{tl(k.kalanIs)}</td>
                  <td>
                    <strong>{tl(k.tahmin)}</strong>
                  </td>
                  <td className={sapmaSinifi(k.sapma)}>
                    {k.sapma === null ? "—" : tlIsaretli(k.sapma)}
                  </td>
                </tr>
                {acik === k.kalemId && (
                  <tr>
                    <td colSpan={7} className="isk-aciklama soluk">
                      {aciklama(k)}
                      {k.taahhut > 0 &&
                        k.yontem !== "taahhut" &&
                        ` Sözleşmelerde ve arsa sahibine kalan: ${tl(k.taahhut)}.`}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {t.kalemsiz > 0 && (
              <tr>
                <th scope="row">Kalemsiz harcama</th>
                <td>—</td>
                <td>{tl(t.kalemsiz)}</td>
                <td />
                <td>{tl(0)}</td>
                <td>{tl(t.kalemsiz)}</td>
                <td />
              </tr>
            )}
            <tr className="nt-baslangic">
              <th scope="row">
                <strong>Toplam</strong>
              </th>
              <td>{tl(t.butce)}</td>
              <td>{tl(t.harcanan)}</td>
              <td />
              <td>{tl(t.kalanIs)}</td>
              <td>
                <strong>{tl(t.tahmin)}</strong>
              </td>
              <td className={sapmaSinifi(t.sapma)}>{tlIsaretli(t.sapma)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {bosNotu}
    </>
  );
}

export function IsSonuEkrani({ projeId }: { projeId: string }) {
  const { depo, oturum, firma } = useUygulama();
  const kdvDahil = firma.ayarlar.kdvMaliyeteDahil;
  const bugun = yerelGun(new Date());
  const [proje, setProje] = useState<Proje | null | undefined>(undefined);
  const [r, setR] = useState<IsSonuRaporu | null>(null);

  useEffect(() => {
    void Promise.all([
      projeGetir(depo, oturum.firmaId, projeId),
      isSonuRaporuGetir(depo, oturum.firmaId, projeId, kdvDahil, bugun),
    ]).then(([p, x]) => {
      setProje(p ?? null);
      setR(x);
    });
  }, [depo, oturum.firmaId, projeId, kdvDahil, bugun]);

  if (proje === undefined || !r) return <p>Yükleniyor…</p>;
  if (proje === null) return <p className="hata">Proje bulunamadı.</p>;
  const t = r.bugun.tahmin;
  const kdv = kdvDahil ? "KDV dahil" : "KDV hariç";
  const ilk =
    r.gecmis.find((x) => x.tahmin.harcanan > 0 || x.tahmin.gelir > 0) ??
    r.gecmis[0]!;
  const toplamDegisim = t.kar - ilk.tahmin.kar;
  const ilerlemesiz = t.kalemler.every((k) => k.ilerleme === null);

  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}`}>
          ← {proje.ad}
        </a>
      </p>
      <div className="baslik-satiri baslik-sarar">
        <h1>İş sonu tahmini · {proje.ad}</h1>
        <AktarmaDugmeleri
          dosyaAdi={`${proje.ad} iş sonu tahmini`}
          sayfalar={() => excelSayfalari(proje.ad, r, kdv, bugun)}
        />
      </div>
      <p className="soluk">
        Bugüne kadar harcanan + işi bitirmek için gereken ({kdv}). Başlangıç
        bütçesinden ayrıdır: bütçe plandır, bu tahmin bugünkü harcama hızına,
        ilerlemeye ve imzalı sözleşmelere göre güncellenir.
      </p>

      <section className="kart kz-ozet">
        <div className="kz-kutular">
          <div>
            <span className="soluk">Bütçe</span>
            <strong>{tl(t.butce)}</strong>
          </div>
          <div>
            <span className="soluk">Harcanan</span>
            <strong>{tl(t.harcanan)}</strong>
          </div>
          <div>
            <span className="soluk">İşi bitirmek için gereken</span>
            <strong>{tl(t.kalanIs)}</strong>
          </div>
          <div>
            <span className="soluk">İş sonu maliyet tahmini</span>
            <strong>{tl(t.tahmin)}</strong>
            {t.butce > 0 && t.sapma !== 0 && (
              <small className={sapmaSinifi(t.sapma)}>
                bütçeden {tlIsaretli(t.sapma)}
              </small>
            )}
          </div>
          <div>
            <span className="soluk">Gelir tahmini (KDV hariç)</span>
            <strong>{tl(t.gelir)}</strong>
          </div>
          <div className={t.kar < 0 ? "kz-zarar" : "kz-kar"}>
            <span className="soluk">
              {t.kar < 0 ? "Beklenen zarar" : "Beklenen kâr"}
            </span>
            <strong>{tl(Math.abs(t.kar))}</strong>
            <small className="soluk">
              {t.marj !== null &&
                `%${t.marj.toLocaleString("tr-TR", { maximumFractionDigits: 1 })} marj · `}
              bütçeye göre {tl(t.butceyeGoreKar)}
            </small>
          </div>
        </div>
        {ilerlemesiz && (
          <p className="mesaj-not">
            <Simge ad="uyari" /> Projede ilerleme girilmemiş: tahmin bütçe ve
            sözleşmelere dayanıyor. Kalem ilerlemesi girildikçe harcama hızı
            hesaba katılır.{" "}
            <a href={`#/projeler/${projeId}/ilerleme`}>İlerleme gir</a>
          </p>
        )}
      </section>

      <section className="kart">
        <h2>Kalemler</h2>
        <p className="soluk kucuk">
          Bir kaleme dokunun: tahminin nasıl yapıldığı açılır.
        </p>
        <KalemSatirlari t={t} />
      </section>

      <section className="kart">
        <h2>Beklenen kâr nasıl değişti</h2>
        {r.gecmis.length > 1 && ilk !== r.bugun && (
          <p
            className={
              toplamDegisim < 0
                ? "hata"
                : toplamDegisim > 0
                  ? "vade-giris"
                  : "soluk"
            }
          >
            Beklenen kâr ({ayYaz(ilk.gun, bugun)} → bugün):{" "}
            {toplamDegisim === 0 ? "değişmedi" : tlIsaretli(toplamDegisim)}.
          </p>
        )}
        <ol className="is-sonu-gecmis">
          {[...r.gecmis].reverse().map((x) => (
            <li key={x.gun}>
              <div className="isg-ust">
                <strong>{ayYaz(x.gun, bugun)}</strong>
                <span>
                  Kâr {tl(x.tahmin.kar)}
                  {x.karFarki !== null && x.karFarki !== 0 && (
                    <span
                      className={x.karFarki < 0 ? "vade-cikis" : "vade-giris"}
                    >
                      {" "}
                      ({tlIsaretli(x.karFarki)})
                    </span>
                  )}
                </span>
              </div>
              <span className="soluk kucuk">
                Maliyet {tl(x.tahmin.tahmin)} · gelir {tl(x.tahmin.gelir)}
              </span>
              {x.nedenler.length > 0 && (
                <ul className="isg-nedenler">
                  {x.nedenler.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
        <p className="soluk kucuk">
          Her nokta kayıtların kendi tarihine göre hesaplanır (fatura, ilerleme,
          sözleşme, hakediş ve satış tarihi). Bütçe ve arsa sahibi ödemeleri
          bugünkü hâliyle alınır.
        </p>
      </section>
    </>
  );
}
