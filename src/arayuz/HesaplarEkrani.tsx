import { useEffect, useState } from 'react';
import { paraYaz, tlOku } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import type { AcilisGirdisi } from '../servisler/acilis';
import {
  PARA_BIRIMLERI,
  birimToplamlari,
  hesapOlustur,
  hesaplariListele,
  transferYap,
  type HesapGirdisi,
  type HesapOzeti,
} from '../servisler/hesap';
import type { Hesap } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { git } from './rota';

// ─── Ortak: hesap formu ────────────────────────────────────────────

export const TUR_ADI: Record<Hesap['tur'], string> = { kasa: 'Kasa', banka: 'Banka', kredi_karti: 'Kredi kartı' };

export interface HesapFormDurumu {
  ad: string;
  tur: Hesap['tur'];
  paraBirimi: Hesap['paraBirimi'];
  banka: string;
  iban: string;
}

export const hesapFormu = (h?: Hesap): HesapFormDurumu => ({
  ad: h?.ad ?? '',
  tur: h?.tur ?? 'kasa',
  paraBirimi: h?.paraBirimi ?? 'TRY',
  banka: h?.banka ?? '',
  iban: h?.iban?.replace(/(.{4})/g, '$1 ').trim() ?? '',
});

export const hesapGirdisi = (f: HesapFormDurumu): HesapGirdisi => ({ ...f });

export function HesapAlanlari(props: {
  form: HesapFormDurumu;
  onDegisti: (f: HesapFormDurumu) => void;
  /** Hareketi olan hesapta para birimi değiştirilemez. */
  birimKilitli?: boolean;
}) {
  const { form, onDegisti } = props;
  const yaz = <K extends keyof HesapFormDurumu>(alan: K, deger: HesapFormDurumu[K]) => onDegisti({ ...form, [alan]: deger });
  return (
    <>
      <div className="iki-sutun">
        <Alan etiket="Tür">
          <select value={form.tur} onChange={(e) => yaz('tur', e.target.value as Hesap['tur'])}>
            <option value="kasa">Kasa (nakit)</option>
            <option value="banka">Banka hesabı</option>
            <option value="kredi_karti">Kredi kartı</option>
          </select>
        </Alan>
        <Alan etiket="Para birimi" aciklama={props.birimKilitli ? 'Hareketi olan hesapta değişmez.' : undefined}>
          <select
            value={form.paraBirimi}
            disabled={props.birimKilitli}
            onChange={(e) => yaz('paraBirimi', e.target.value as Hesap['paraBirimi'])}
          >
            {PARA_BIRIMLERI.map((pb) => (
              <option key={pb}>{pb}</option>
            ))}
          </select>
        </Alan>
      </div>
      <Alan etiket="Hesap adı" aciklama="Listede ve transferde bu adla görünür.">
        <input
          value={form.ad}
          placeholder={{ kasa: 'Merkez kasa, şantiye kasası', banka: 'Ziraat TL', kredi_karti: 'Garanti kartı' }[form.tur]}
          onChange={(e) => yaz('ad', e.target.value)}
          autoFocus
        />
      </Alan>
      {form.tur === 'kredi_karti' && (
        <>
          <Alan etiket="Banka">
            <input value={form.banka} onChange={(e) => yaz('banka', e.target.value)} />
          </Alan>
          <p className="mesaj-not">Kartla yapılan ödemeler bu hesabı eksiye düşürür (kart borcu). Kart borcunu ödemek için bankadan bu karta transfer yapın.</p>
        </>
      )}
      {form.tur === 'banka' && (
        <>
          <Alan etiket="Banka">
            <input value={form.banka} onChange={(e) => yaz('banka', e.target.value)} />
          </Alan>
          <Alan etiket="IBAN">
            <input
              value={form.iban}
              placeholder="TR00 0000 0000 0000 0000 0000 00"
              autoCapitalize="characters"
              onChange={(e) => yaz('iban', e.target.value)}
            />
          </Alan>
        </>
      )}
    </>
  );
}

/** Açılış bakiyesi metinleri; eksi tutar (KMH) "-" ile yazılır. */
export interface HesapAcilisFormu {
  tutar: string;
  tarih: string;
}

/** Kredi kartında kullanıcı borcu artı yazar; bakiyede eksi saklanır. */
export function hesapAcilisGirdisi(f: HesapAcilisFormu, tur: Hesap['tur']): { acilis: AcilisGirdisi | null; hatalar: string[] } {
  if (!f.tutar.trim()) return { acilis: null, hatalar: [] };
  const tutar = tlOku(f.tutar);
  if (tutar === null) return { acilis: null, hatalar: ['Açılış bakiyesi geçerli bir tutar değil (örn. 25.000 ya da 1.250,50).'] };
  if (!f.tarih) return { acilis: null, hatalar: ['Açılış bakiyesinin tarihini girin.'] };
  return { acilis: { tutar: tur === 'kredi_karti' ? -tutar : tutar, tarih: f.tarih }, hatalar: [] };
}

/** Bakiye metni; kredi kartında eksi bakiye "Kart borcu" olarak okunur. */
export function hesapBakiyeMetni(bakiye: number, hesap: Pick<Hesap, 'tur' | 'paraBirimi'>): string {
  if (hesap.tur === 'kredi_karti' && bakiye < 0) return `Kart borcu ${paraYaz(-bakiye, hesap.paraBirimi)}`;
  return paraYaz(bakiye, hesap.paraBirimi);
}

/**
 * Para çıkışı hesabı eksiye düşürecekse uyarı; kaydı engellemez.
 * Kredi kartı zaten borç hesabıdır (bakiyesi eksidir), onda uyarı çıkmaz.
 */
export function EksiBakiyeUyarisi({ hesap, tutar }: { hesap: HesapOzeti | undefined; tutar: number | null }) {
  if (!hesap || hesap.hesap.tur === 'kredi_karti' || tutar === null || tutar <= 0) return null;
  const sonra = hesap.bakiye - tutar;
  if (sonra >= 0) return null;
  return (
    <p className="mesaj mesaj-uyari" role="status">
      {hesap.hesap.ad} bakiyesi {paraYaz(sonra, hesap.hesap.paraBirimi)} olacak (eksiye düşüyor). Tutarı kontrol edin.
    </p>
  );
}

export function HesapAcilisAlanlari(props: {
  form: HesapAcilisFormu;
  paraBirimi: Hesap['paraBirimi'];
  tur: Hesap['tur'];
  onDegisti: (f: HesapAcilisFormu) => void;
}) {
  const kart = props.tur === 'kredi_karti';
  return (
    <div className="iki-sutun">
      <Alan
        etiket={kart ? `Kart borcu (${props.paraBirimi})` : `Tutar (${props.paraBirimi})`}
        aciklama={kart ? 'Boş: borç yok.' : 'Boş: açılış yok. Eksi bakiye için başına - yazın.'}
      >
        <input
          value={props.form.tutar}
          inputMode="decimal"
          placeholder="0"
          onChange={(e) => props.onDegisti({ ...props.form, tutar: e.target.value })}
        />
      </Alan>
      <Alan etiket="Tarih">
        <input type="date" value={props.form.tarih} onChange={(e) => props.onDegisti({ ...props.form, tarih: e.target.value })} />
      </Alan>
    </div>
  );
}

// ─── Liste ─────────────────────────────────────────────────────────

export function HesaplarEkrani() {
  const { depo, oturum } = useUygulama();
  const [hesaplar, setHesaplar] = useState<HesapOzeti[] | null>(null);

  useEffect(() => {
    void hesaplariListele(depo, oturum.firmaId).then(setHesaplar);
  }, [depo, oturum.firmaId]);

  return (
    <>
      <div className="baslik-satiri">
        <h1>Kasa ve banka</h1>
        <button type="button" onClick={() => git('hesaplar/yeni')}>
          + Yeni hesap
        </button>
      </div>
      {hesaplar === null && <p>Yükleniyor…</p>}
      {hesaplar?.length === 0 && (
        <section className="kart">
          <p>Henüz kasa ya da banka hesabı yok.</p>
          <p className="soluk">Nakit için bir kasa, her banka hesabı için ayrı bir hesap açın. Dövizli hesaplar kendi biriminde tutulur.</p>
        </section>
      )}
      {hesaplar && hesaplar.length > 0 && (
        <>
          <section className="kart">
            <h2>Eldeki para</h2>
            <ul className="liste">
              {birimToplamlari(hesaplar).map(({ paraBirimi, toplam }) => (
                <li key={paraBirimi}>
                  <span>Kasa + banka ({paraBirimi})</span>
                  <strong className={toplam < 0 ? 'bakiye-borc' : undefined}>{paraYaz(toplam, paraBirimi)}</strong>
                </li>
              ))}
              {birimToplamlari(hesaplar, true)
                .filter(({ toplam }) => toplam !== 0)
                .map(({ paraBirimi, toplam }) => (
                  <li key={`kart-${paraBirimi}`}>
                    <span>Kredi kartı borcu ({paraBirimi})</span>
                    <strong className={toplam < 0 ? 'bakiye-borc' : undefined}>{paraYaz(-toplam, paraBirimi)}</strong>
                  </li>
                ))}
            </ul>
            {hesaplar.length > 1 && (
              <button type="button" className="ikincil genis transfer-dugmesi" onClick={() => git('hesaplar/transfer')}>
                ⇄ Hesaplar arası transfer
              </button>
            )}
          </section>
          <ul className="kart-listesi liste-arasi">
            {hesaplar.map(({ hesap, bakiye }) => (
              <li key={hesap.id}>
                <a className="kart kart-baglanti" href={`#/hesaplar/${hesap.id}`}>
                  <span className="baslik-satiri">
                    <strong>{hesap.ad}</strong>
                    <span className={`bakiye ${bakiye < 0 ? 'bakiye-borc' : ''}`}>{hesapBakiyeMetni(bakiye, hesap)}</span>
                  </span>
                  <span className="soluk">
                    {TUR_ADI[hesap.tur]}
                    {hesap.banka && ` · ${hesap.banka}`}
                    {hesap.paraBirimi !== 'TRY' && ` · ${hesap.paraBirimi}`}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ─── Yeni hesap ────────────────────────────────────────────────────

export function HesapYeni() {
  const { depo, servis } = useUygulama();
  const [form, setForm] = useState<HesapFormDurumu>(() => hesapFormu());
  const [acilis, setAcilis] = useState<HesapAcilisFormu>(() => ({ tutar: '', tarih: yerelGun(new Date()) }));
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);

  async function kaydet() {
    const a = hesapAcilisGirdisi(acilis, form.tur);
    setHatalar(a.hatalar);
    if (a.hatalar.length > 0) return;
    setIslemde(true);
    try {
      const hesap = await hesapOlustur(depo, servis, hesapGirdisi(form), a.acilis);
      git(`hesaplar/${hesap.id}`);
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  return (
    <>
      <p>
        <a href="#/hesaplar">← Kasa ve banka</a>
      </p>
      <h1>Yeni hesap</h1>
      <section className="kart">
        <HesapAlanlari form={form} onDegisti={setForm} />
        <h3>Açılış bakiyesi</h3>
        <p className="soluk">Programa başladığınız gün hesapta ne kadar para var? Sonraki hareketler bakiyeyi kendisi hesaplar.</p>
        <HesapAcilisAlanlari form={acilis} paraBirimi={form.paraBirimi} tur={form.tur} onDegisti={setAcilis} />
        <Hatalar hatalar={hatalar} />
        <div className="dugmeler">
          <button type="button" onClick={() => void kaydet()} disabled={islemde}>
            {islemde ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
          <button type="button" className="ikincil" onClick={() => git('hesaplar')} disabled={islemde}>
            Vazgeç
          </button>
        </div>
      </section>
    </>
  );
}

// ─── Transfer ──────────────────────────────────────────────────────

export function TransferEkrani({ kaynakId }: { kaynakId?: string }) {
  const { depo, oturum, servis } = useUygulama();
  const [hesaplar, setHesaplar] = useState<HesapOzeti[] | null>(null);
  const [form, setForm] = useState({
    kaynak: kaynakId ?? '',
    hedef: '',
    tarih: yerelGun(new Date()),
    tutar: '',
    hedefTutar: '',
    aciklama: '',
  });
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [islemde, setIslemde] = useState(false);

  useEffect(() => {
    void hesaplariListele(depo, oturum.firmaId).then(setHesaplar);
  }, [depo, oturum.firmaId]);

  if (hesaplar === null) return <p>Yükleniyor…</p>;

  const yaz = (alan: keyof typeof form, deger: string) => setForm((f) => ({ ...f, [alan]: deger }));
  const kaynak = hesaplar.find((h) => h.hesap.id === form.kaynak);
  const hedef = hesaplar.find((h) => h.hesap.id === form.hedef);
  const farkliBirim = !!kaynak && !!hedef && kaynak.hesap.paraBirimi !== hedef.hesap.paraBirimi;
  const tutar = tlOku(form.tutar);
  const hedefTutar = farkliBirim ? tlOku(form.hedefTutar) : null;
  const kur = farkliBirim && tutar && hedefTutar ? tutar / hedefTutar : null;

  async function kaydet() {
    const yeniHatalar: string[] = [];
    if (tutar === null) yeniHatalar.push('Tutarı yazın (örn. 25.000 ya da 1.250,50).');
    if (farkliBirim && hedefTutar === null) yeniHatalar.push(`${hedef!.hesap.ad} hesabına giren ${hedef!.hesap.paraBirimi} tutarını yazın.`);
    setHatalar(yeniHatalar);
    if (yeniHatalar.length > 0) return;
    setIslemde(true);
    try {
      await transferYap(depo, servis, {
        tarih: form.tarih,
        kaynakHesapId: form.kaynak,
        hedefHesapId: form.hedef,
        tutar: tutar!,
        hedefTutar,
        aciklama: form.aciklama,
      });
      git(kaynakId ? `hesaplar/${kaynakId}` : 'hesaplar');
    } catch (e) {
      setHatalar([hataMetni(e)]);
      setIslemde(false);
    }
  }

  const secenekler = (haric: string) =>
    hesaplar
      .filter((h) => h.hesap.id !== haric)
      .map(({ hesap, bakiye }) => (
        <option key={hesap.id} value={hesap.id}>
          {hesap.ad} ({hesapBakiyeMetni(bakiye, hesap)})
        </option>
      ));

  return (
    <>
      <p>
        <a href={kaynakId ? `#/hesaplar/${kaynakId}` : '#/hesaplar'}>← Geri</a>
      </p>
      <h1>Hesaplar arası transfer</h1>
      <section className="kart">
        <p className="soluk">Transfer gelir ya da gider değildir; yalnızca paranın yerini değiştirir.</p>
        <Alan etiket="Paranın çıktığı hesap">
          <select value={form.kaynak} onChange={(e) => yaz('kaynak', e.target.value)}>
            <option value="">Seçin</option>
            {secenekler(form.hedef)}
          </select>
        </Alan>
        <Alan etiket="Paranın girdiği hesap">
          <select value={form.hedef} onChange={(e) => yaz('hedef', e.target.value)}>
            <option value="">Seçin</option>
            {secenekler(form.kaynak)}
          </select>
        </Alan>
        <div className="iki-sutun">
          <Alan etiket={`Tutar${kaynak ? ` (${kaynak.hesap.paraBirimi})` : ''}`}>
            <input value={form.tutar} inputMode="decimal" placeholder="0" onChange={(e) => yaz('tutar', e.target.value)} />
          </Alan>
          <Alan etiket="Tarih">
            <input type="date" value={form.tarih} onChange={(e) => yaz('tarih', e.target.value)} />
          </Alan>
        </div>
        {farkliBirim && (
          <Alan
            etiket={`${hedef!.hesap.ad} hesabına giren (${hedef!.hesap.paraBirimi})`}
            aciklama={kur ? `Kur: 1 ${hedef!.hesap.paraBirimi} = ${kur.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} ${kaynak!.hesap.paraBirimi}` : 'Bankanın uyguladığı kurla hesaba geçen tutar.'}
          >
            <input value={form.hedefTutar} inputMode="decimal" onChange={(e) => yaz('hedefTutar', e.target.value)} />
          </Alan>
        )}
        <Alan etiket="Açıklama">
          <input value={form.aciklama} placeholder="Şantiye kasasına harçlık" onChange={(e) => yaz('aciklama', e.target.value)} />
        </Alan>
        <EksiBakiyeUyarisi hesap={kaynak} tutar={tutar} />
        <Hatalar hatalar={hatalar} />
        <div className="dugmeler">
          <button type="button" onClick={() => void kaydet()} disabled={islemde}>
            {islemde ? 'Kaydediliyor…' : 'Transferi kaydet'}
          </button>
          <button type="button" className="ikincil" onClick={() => git(kaynakId ? `hesaplar/${kaynakId}` : 'hesaplar')} disabled={islemde}>
            Vazgeç
          </button>
        </div>
      </section>
    </>
  );
}
