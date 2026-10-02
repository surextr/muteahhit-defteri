import { useCallback, useEffect, useState } from 'react';
import { kayitGecmisiGetir, type GecmisSatiri } from '../servisler/gecmis';
import { ALAN_TANIMLARI, projeGetir, projeGuncelle } from '../servisler/proje';
import type { Proje } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, useGerekceliDegisiklik } from './bilesenler';
import { GecmisListesi, type AlanBicimi } from './GecmisListesi';
import { ProjeBilgiAlanlari, projeFormu, projeGirdisi, type ProjeFormu } from './ProjeBilgiFormu';
import { ARSA_TIPI_ADI } from './ProjelerEkrani';
import { git } from './rota';

export const PROJE_DURUM_ADI: Record<Proje['durum'], string> = { aktif: 'Devam ediyor', tamamlandi: 'Tamamlandı' };

const PROJE_BICIMI: AlanBicimi = {
  etiketler: {
    ad: 'Proje adı',
    il: 'İl',
    ilce: 'İlçe',
    mahalle: 'Mahalle',
    adres: 'Açık adres',
    parseller: 'Parseller',
    planlananBitis: 'Planlanan bitiş',
    gerceklesenBitis: 'Gerçekleşen bitiş',
    arsaTipi: 'Arsa tipi',
    baslangicTarihi: 'Başlangıç tarihi',
    durum: 'Durum',
    ...Object.fromEntries(Object.entries(ALAN_TANIMLARI).map(([ad, t]) => [`alanlar.${ad}`, t.etiket])),
  },
  degerYaz: (alan, d) => {
    if (alan === 'arsaTipi') return ARSA_TIPI_ADI[d as Proje['arsaTipi']];
    if (alan === 'durum') return PROJE_DURUM_ADI[d as Proje['durum']];
    return undefined;
  },
};

export function ProjeDuzenle({ projeId }: { projeId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  /** undefined: okunuyor, null: bulunamadı */
  const [proje, setProje] = useState<Proje | null | undefined>(undefined);
  const [form, setForm] = useState<ProjeFormu | null>(null);
  const [durum, setDurum] = useState<Proje['durum']>('aktif');
  const [gecmis, setGecmis] = useState<GecmisSatiri[]>([]);
  const [hatalar, setHatalar] = useState<string[]>([]);
  const [kaydedildi, setKaydedildi] = useState(false);

  const gecmisiOku = useCallback(
    async () => setGecmis(await kayitGecmisiGetir(depo, oturum.firmaId, projeId)),
    [depo, oturum.firmaId, projeId],
  );

  useEffect(() => {
    void projeGetir(depo, oturum.firmaId, projeId).then((bulundu) => {
      setProje(bulundu);
      if (bulundu) {
        setForm(projeFormu(bulundu));
        setDurum(bulundu.durum);
      }
    });
    void gecmisiOku();
  }, [depo, oturum.firmaId, projeId, gecmisiOku]);

  if (proje === undefined) return <p>Yükleniyor…</p>;
  if (proje === null || form === null) return <p className="hata">Proje bulunamadı.</p>;

  function kaydet(p: Proje, f: ProjeFormu) {
    setKaydedildi(false);
    const { girdi, hatalar } = projeGirdisi(f);
    setHatalar(hatalar);
    if (hatalar.length > 0) return;
    void degistir(`${p.ad} bilgileri değişiyor`, async (g) => {
      const guncel = await projeGuncelle(servis, p.id, { ...girdi, durum }, g);
      setProje(guncel);
      setForm(projeFormu(guncel));
      setKaydedildi(true);
      await gecmisiOku();
    });
  }

  return (
    <>
      <p>
        <a href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <h1>Proje bilgilerini düzenle</h1>
      <section className="kart">
        <ProjeBilgiAlanlari
          duzenleme
          form={form}
          onDegisti={(f) => {
            setKaydedildi(false);
            setForm(f);
          }}
        />
        <Alan etiket="Proje durumu">
          <select value={durum} onChange={(e) => setDurum(e.target.value as Proje['durum'])}>
            {Object.entries(PROJE_DURUM_ADI).map(([k, ad]) => (
              <option key={k} value={k}>
                {ad}
              </option>
            ))}
          </select>
        </Alan>
        {kutu}
        <Hatalar hatalar={hata ? [...hatalar, hata] : hatalar} />
        {kaydedildi && (
          <p className="mesaj mesaj-basari" role="status">
            Kaydedildi. Değişiklik aşağıdaki geçmişe eklendi.
          </p>
        )}
        <div className="dugmeler">
          <button type="button" onClick={() => kaydet(proje, form)}>
            Kaydet
          </button>
          <button type="button" className="ikincil" onClick={() => git(`projeler/${projeId}`)}>
            Kapat
          </button>
        </div>
      </section>

      <section className="kart">
        <h2>Değişiklik geçmişi</h2>
        <GecmisListesi satirlar={gecmis} bicim={PROJE_BICIMI} />
      </section>
    </>
  );
}
