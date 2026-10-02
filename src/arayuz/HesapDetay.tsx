import { useCallback, useEffect, useState } from 'react';
import type { HesapHareketi, HesapHareketTuru } from '../hesap/bakiye';
import { paraYaz, tutarMetni } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { kayitGecmisiGetir, type GecmisSatiri } from '../servisler/gecmis';
import {
  hesapAcilisAyarla,
  hesapAcilisGetir,
  hesapDetayiGetir,
  hesapGuncelle,
  hesapIptal,
  transferGetir,
  type HesapDetayi,
} from '../servisler/hesap';
import type { AcilisBakiyesi, Hesap } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Hatalar, hataMetni, useGerekceliDegisiklik } from './bilesenler';
import { GecmisListesi, type AlanBicimi } from './GecmisListesi';
import {
  HesapAcilisAlanlari,
  HesapAlanlari,
  TUR_ADI,
  hesapAcilisGirdisi,
  hesapBakiyeMetni,
  hesapFormu,
  hesapGirdisi,
  type HesapAcilisFormu,
  type HesapFormDurumu,
} from './HesaplarEkrani';
import { git } from './rota';

const HAREKET_ADI: Record<HesapHareketTuru, string> = {
  acilis: 'Açılış bakiyesi',
  tahsilat: 'Tahsilat',
  odeme: 'Ödeme',
  transferGiris: 'Transfer',
  transferCikis: 'Transfer',
  cekTahsil: 'Çek tahsili',
  cekOdeme: 'Çek ödemesi',
};

const HESAP_BICIMI: AlanBicimi = {
  etiketler: { ad: 'Hesap adı', tur: 'Tür', paraBirimi: 'Para birimi', banka: 'Banka', iban: 'IBAN' },
  degerYaz: (alan, d) => (alan === 'tur' ? TUR_ADI[d as Hesap['tur']] : undefined),
};

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');

interface Bilgi extends HesapDetayi {
  acilis: AcilisBakiyesi | null;
  gecmis: GecmisSatiri[];
}

export function HesapDetay({ hesapId, duzenle }: { hesapId: string; duzenle: boolean }) {
  const { depo, oturum } = useUygulama();
  /** undefined: okunuyor, null: bulunamadı */
  const [bilgi, setBilgi] = useState<Bilgi | null | undefined>(undefined);

  const yenile = useCallback(async () => {
    const f = oturum.firmaId;
    const detay = await hesapDetayiGetir(depo, f, hesapId);
    if (!detay) return setBilgi(null);
    const [acilis, gecmis] = await Promise.all([hesapAcilisGetir(depo, f, hesapId), kayitGecmisiGetir(depo, f, hesapId)]);
    setBilgi({ ...detay, acilis, gecmis });
  }, [depo, oturum.firmaId, hesapId]);

  useEffect(() => {
    void yenile();
  }, [yenile]);

  if (bilgi === undefined) return <p>Yükleniyor…</p>;
  if (bilgi === null) return <p className="hata">Hesap bulunamadı.</p>;
  // Açılış dışında hareket varsa para birimi kilitlenir (servis de aynı kuralı uygular).
  const birimKilitli = bilgi.hareketler.length > 0;
  if (duzenle) return <HesapDuzenle hesap={bilgi.hesap} birimKilitli={birimKilitli} onKaydedildi={yenile} />;

  const { hesap } = bilgi;

  return (
    <>
      <p>
        <a href="#/hesaplar">← Kasa ve banka</a>
      </p>
      <h1>{hesap.ad}</h1>

      <section className="kart">
        <p className="bakiye-buyuk">
          <span className={`bakiye ${bilgi.bakiye < 0 ? 'bakiye-borc' : ''}`}>{hesapBakiyeMetni(bilgi.bakiye, hesap)}</span>
        </p>
        <p className="soluk">
          {TUR_ADI[hesap.tur]}
          {hesap.banka && ` · ${hesap.banka}`} · {hesap.paraBirimi}
        </p>
        {hesap.iban && <p className="iban">{hesap.iban.replace(/(.{4})/g, '$1 ').trim()}</p>}
        <div className="dugmeler">
          <button type="button" onClick={() => git(`hesaplar/transfer/${hesap.id}`)}>
            ⇄ Transfer
          </button>
          <a className="dugme ikincil" href={`#/hesaplar/${hesap.id}/duzenle`}>
            Düzenle
          </a>
        </div>
      </section>

      <AcilisKarti hesap={hesap} acilis={bilgi.acilis} onDegisti={yenile} />

      <Hareketler bilgi={bilgi} onDegisti={yenile} />

      {bilgi.gecmis.length > 1 && (
        <section className="kart">
          <h2>Değişiklik geçmişi</h2>
          <GecmisListesi satirlar={bilgi.gecmis} bicim={HESAP_BICIMI} />
        </section>
      )}

      <HesapIptalKarti hesap={hesap} />
    </>
  );
}

// ─── Hareketler (ekstre) ───────────────────────────────────────────

function Hareketler({ bilgi, onDegisti }: { bilgi: Bilgi; onDegisti: () => Promise<void> }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [iptalEdilecek, setIptalEdilecek] = useState<HesapHareketi | null>(null);
  const para = (t: number) => paraYaz(t, bilgi.hesap.paraBirimi);

  function transferIptal(x: HesapHareketi) {
    setIptalEdilecek(null);
    // Gerekçe kuralı için kaydın kendisi gerekir; ekstre satırı yalnızca özetini taşır.
    void transferGetir(depo, oturum.firmaId, x.kayitId).then(
      (kayit) =>
        kayit &&
        degistir(kayit, 'Transfer iptal ediliyor', async (g) => {
          await servis.iptal('transfer', kayit.id, g);
          await onDegisti();
        }),
    );
  }

  return (
    <section className="kart">
      <h2>Hareketler</h2>
      {kutu}
      <Hatalar hatalar={hata ? [hata] : []} />
      {bilgi.hareketler.length === 0 ? (
        <p className="soluk">Henüz hareket yok. Ödeme ve tahsilatlar 9. adımda eklenecek; transfer şimdiden yapılabilir.</p>
      ) : (
        <ul className="liste ekstre">
          {bilgi.hareketler.map((x) => (
            <li key={`${x.kayitId}-${x.tur}`}>
              <div className="ekstre-satir">
                <div>
                  <strong>{HAREKET_ADI[x.tur]}</strong>
                  {x.karsiHesapId && (
                    <span>
                      {' '}
                      {x.tur === 'transferGiris' ? '←' : '→'} {bilgi.hesapAdlari[x.karsiHesapId] ?? '?'}
                    </span>
                  )}
                  <div className="soluk">
                    {tarihYaz(x.tarih)}
                    {x.aciklama && ` · ${x.aciklama}`}
                  </div>
                </div>
                <div className="ekstre-tutar">
                  <strong className={x.tutar < 0 ? 'bakiye-borc' : 'bakiye-alacak'}>
                    {x.tutar > 0 ? '+' : ''}
                    {para(x.tutar)}
                  </strong>
                  <div className="soluk">{para(x.bakiye)}</div>
                </div>
              </div>
              {x.kayitTur === 'transfer' &&
                (iptalEdilecek?.kayitId === x.kayitId ? (
                  <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="Transfer iptali">
                    <p>Bu transfer iptal edilsin mi? İki hesabın bakiyesi de eski haline döner; kayıt geçmişte kalır.</p>
                    <div className="dugmeler">
                      <button type="button" className="tehlikeli" onClick={() => transferIptal(x)}>
                        Evet, iptal et
                      </button>
                      <button type="button" className="ikincil" onClick={() => setIptalEdilecek(null)}>
                        Hayır
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="baglanti-dugmesi" onClick={() => setIptalEdilecek(x)}>
                    İptal et
                  </button>
                ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ─── Açılış bakiyesi ───────────────────────────────────────────────

function AcilisKarti(props: { hesap: Hesap; acilis: AcilisBakiyesi | null; onDegisti: () => Promise<void> }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [form, setForm] = useState<HesapAcilisFormu | null>(null);
  const [hatalar, setHatalar] = useState<string[]>([]);

  function kaydet(f: HesapAcilisFormu) {
    const { acilis, hatalar } = hesapAcilisGirdisi(f, props.hesap.tur);
    setHatalar(hatalar);
    if (hatalar.length > 0) return;
    const calistir = async (g?: string) => {
      await hesapAcilisAyarla(depo, servis, props.hesap.id, acilis, g);
      setForm(null);
      await props.onDegisti();
    };
    if (props.acilis) void degistir(props.acilis, 'Açılış bakiyesi değişiyor', calistir);
    else void calistir().catch((e: unknown) => setHatalar([hataMetni(e)]));
  }

  const ac = () =>
    setForm(
      props.acilis
        ? { tutar: tutarMetni(props.hesap.tur === 'kredi_karti' ? -props.acilis.tutar : props.acilis.tutar), tarih: props.acilis.tarih }
        : { tutar: '', tarih: yerelGun(new Date()) },
    );

  return (
    <section className="kart">
      <div className="baslik-satiri">
        <h2>Açılış bakiyesi</h2>
        {!form && (
          <button type="button" className="ikincil" onClick={ac}>
            {props.acilis ? 'Değiştir' : 'Gir'}
          </button>
        )}
      </div>
      {!form && (
        <p>
          {props.acilis ? (
            <>
              {hesapBakiyeMetni(props.acilis.tutar, props.hesap)} <span className="soluk">· {tarihYaz(props.acilis.tarih)}</span>
            </>
          ) : (
            <span className="soluk">Yok</span>
          )}
        </p>
      )}
      {form && (
        <>
          <HesapAcilisAlanlari form={form} paraBirimi={props.hesap.paraBirimi} tur={props.hesap.tur} onDegisti={setForm} />
          {kutu}
          <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
          <div className="dugmeler">
            <button type="button" onClick={() => kaydet(form)}>
              Kaydet
            </button>
            <button type="button" className="ikincil" onClick={() => setForm(null)}>
              Vazgeç
            </button>
          </div>
        </>
      )}
    </section>
  );
}

// ─── İptal ─────────────────────────────────────────────────────────

function HesapIptalKarti({ hesap }: { hesap: Hesap }) {
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [soruluyor, setSoruluyor] = useState(false);

  return (
    <section className="kart">
      <h2>Hesabı iptal et</h2>
      <p className="soluk">Yalnızca hareketi olmayan, yanlış açılmış hesap iptal edilir. Kapanan hesabın bakiyesini önce transferle sıfırlayın.</p>
      {kutu}
      <Hatalar hatalar={hata ? [hata] : []} />
      {soruluyor ? (
        <div className="mesaj mesaj-uyari" role="alertdialog" aria-labelledby="hesap-iptal-baslik">
          <h3 id="hesap-iptal-baslik">{hesap.ad} iptal edilsin mi?</h3>
          <p>Hesap listeden kalkar; açılış bakiyesi de iptal edilir.</p>
          <div className="dugmeler">
            <button
              type="button"
              className="tehlikeli"
              onClick={() => {
                setSoruluyor(false);
                void degistir(hesap, `${hesap.ad} iptal ediliyor`, async (g) => {
                  await hesapIptal(depo, servis, hesap.id, g);
                  git('hesaplar');
                });
              }}
            >
              Evet, iptal et
            </button>
            <button type="button" className="ikincil" onClick={() => setSoruluyor(false)}>
              Hayır
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="ikincil" onClick={() => setSoruluyor(true)}>
          İptal et
        </button>
      )}
    </section>
  );
}

// ─── Düzenleme ─────────────────────────────────────────────────────

function HesapDuzenle(props: { hesap: Hesap; birimKilitli: boolean; onKaydedildi: () => Promise<void> }) {
  const { hesap } = props;
  const { depo, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [form, setForm] = useState<HesapFormDurumu>(() => hesapFormu(hesap));

  function kaydet() {
    void degistir(hesap, `${hesap.ad} değişiyor`, async (g) => {
      await hesapGuncelle(depo, servis, hesap.id, hesapGirdisi(form), g);
      await props.onKaydedildi();
      git(`hesaplar/${hesap.id}`);
    });
  }

  return (
    <>
      <p>
        <a href={`#/hesaplar/${hesap.id}`}>← {hesap.ad}</a>
      </p>
      <h1>Hesabı düzenle</h1>
      <section className="kart">
        <HesapAlanlari form={form} onDegisti={setForm} birimKilitli={props.birimKilitli} />
        {kutu}
        <Hatalar hatalar={hata ? [hata] : []} />
        <div className="dugmeler">
          <button type="button" onClick={kaydet}>
            Kaydet
          </button>
          <button type="button" className="ikincil" onClick={() => git(`hesaplar/${hesap.id}`)}>
            Vazgeç
          </button>
        </div>
      </section>
    </>
  );
}
