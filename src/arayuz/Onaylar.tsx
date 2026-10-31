import { useCallback, useEffect, useState } from 'react';
import { ODEME_ONAYI_DURUMU_ADI, onayAkisi } from '../hesap/onay';
import { tlYaz } from '../hesap/para';
import { kullanicilariListele } from '../servisler/kullanici';
import { bekleyenOnaylar, odemeTalimatiGeriCek, odemeTalimatiKontrolEt, odemeTalimatiOnayla, odemeTalimatiReddet, type BekleyenOnaylar } from '../servisler/onay';
import type { OdemeOnayi } from '../veri/tipler';
import { useProjeErisimi, useUygulama } from './baglam';
import { BosDurum, Hatalar, hataMetni } from './bilesenler';
import { git } from './rota';

// Onay akışı: bekleyen ödeme talimatları (kontrol / onay / red / geri çekme), eşik üstü hakedişler ve son sonuçlananlar.

const tarihYaz = (t: string) => new Date(`${t.slice(0, 10)}T00:00`).toLocaleDateString('tr-TR');

export function OnaylarEkrani({ gonderildi }: { gonderildi?: boolean }) {
  const { depo, oturum, servis, firma, kullanici } = useUygulama();
  const erisim = useProjeErisimi();
  const akis = onayAkisi(firma.ayarlar);
  const rol = kullanici.rol ?? 'santiye';
  const [b, setB] = useState<BekleyenOnaylar | null>(null);
  const [adlar, setAdlar] = useState<{ cari: Map<string, string>; kisi: Map<string, string>; hesap: Map<string, string> }>({ cari: new Map(), kisi: new Map(), hesap: new Map() });
  const [hata, setHata] = useState<string | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(gonderildi ? 'Ödeme talimatı onaya gönderildi. Onaylanınca ödeme yapılır ve faturalara bağlanır.' : null);
  const [red, setRed] = useState<{ id: string; gerekce: string } | null>(null);

  const yukle = useCallback(async () => {
    const [x, cariler, kullanicilar, hesaplar] = await Promise.all([
      bekleyenOnaylar(depo, oturum.firmaId, akis, erisim),
      depo.listele('cari', { firmaId: oturum.firmaId }),
      kullanicilariListele(depo, oturum.firmaId).then((l) => l.map((x) => x.kullanici)),
      depo.listele('hesap', { firmaId: oturum.firmaId }),
    ]);
    setAdlar({ cari: new Map(cariler.map((c) => [c.id, c.ad])), kisi: new Map(kullanicilar.map((k) => [k.id, k.ad])), hesap: new Map(hesaplar.map((h) => [h.id, h.ad])) });
    setB(x);
  }, [depo, oturum.firmaId, akis, erisim]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  const calistir = async (is: () => Promise<unknown>, basari: string) => {
    setHata(null);
    setMesaj(null);
    try {
      await is();
      setMesaj(basari);
      setRed(null);
      await yukle();
    } catch (e) {
      setHata(hataMetni(e));
    }
  };

  if (!b) return <p>Yükleniyor…</p>;
  const kisi = (id: string) => adlar.kisi.get(id) ?? '?';

  // Bileşen değil işlev: içteki bileşen her çizimde yeniden kurulur ve gerekçe kutusu odağını kaybeder.
  const talimat = (t: OdemeOnayi) => {
    const kendi = t.olusturan === oturum.kullaniciId;
    const kontrolEdebilir = !!akis?.kontrol && t.durum === 'bekliyor' && !kendi && (rol === 'muhasebe' || rol === 'yonetici');
    const onaylayabilir = rol === 'yonetici' && (!akis?.kontrol || t.durum === 'kontrol_edildi');
    return (
      <li key={t.id} className="onay-ogesi">
        <div className="isg-ust">
          <strong>{adlar.cari.get(t.cariId) ?? '?'}</strong>
          <strong>{tlYaz(t.tutar)}</strong>
        </div>
        <span className="soluk kucuk">
          {tarihYaz(t.tarih)} · {adlar.hesap.get(t.hesapId) ?? 'hesap'} · hazırlayan {kisi(t.olusturan)}
          {t.aciklama ? ` · ${t.aciklama}` : ''}
          {t.dagitim.length ? ` · ${t.dagitim.length} faturaya` : ' · avans'}
        </span>
        <span className={`etiket-cip ${t.durum === 'kontrol_edildi' ? 'rozet-tamam' : 'rozet-gecikti'}`}>{ODEME_ONAYI_DURUMU_ADI[t.durum]}</span>
        {t.kontrol && (
          <span className="soluk kucuk blok">
            Kontrol: {kisi(t.kontrol.kullaniciId)}, {tarihYaz(t.kontrol.zaman)}
            {t.kontrol.not ? ` · ${t.kontrol.not}` : ''}
          </span>
        )}
        {red?.id === t.id ? (
          <div className="dugmeler">
            <input value={red.gerekce} placeholder="Red gerekçesi" aria-label="Red gerekçesi" autoFocus onChange={(e) => setRed({ id: t.id, gerekce: e.target.value })} />
            <button type="button" className="tehlikeli" onClick={() => void calistir(() => odemeTalimatiReddet(depo, servis, t.id, red.gerekce), 'Talimat reddedildi.')}>
              Reddet
            </button>
            <button type="button" className="ikincil" onClick={() => setRed(null)}>
              Vazgeç
            </button>
          </div>
        ) : (
          <div className="dugmeler">
            {onaylayabilir && (
              <button type="button" onClick={() => void calistir(() => odemeTalimatiOnayla(depo, servis, t.id), 'Onaylandı; ödeme yapıldı.')}>
                Onayla ve öde
              </button>
            )}
            {kontrolEdebilir && (
              <button type="button" onClick={() => void calistir(() => odemeTalimatiKontrolEt(depo, servis, t.id), 'Kontrol edildi; yönetici onayına gitti.')}>
                Kontrol ettim
              </button>
            )}
            {rol === 'yonetici' && (
              <button type="button" className="ikincil" onClick={() => setRed({ id: t.id, gerekce: '' })}>
                Reddet
              </button>
            )}
            {kendi && (
              <button type="button" className="baglanti-dugmesi" onClick={() => void calistir(() => odemeTalimatiGeriCek(depo, servis, t.id), 'Talimat geri çekildi.')}>
                Geri çek
              </button>
            )}
            {t.dagitim[0] && (
              <a className="baglanti-dugmesi" href={`#/giderler/${t.dagitim[0].giderId}`}>
                Faturayı gör
              </a>
            )}
          </div>
        )}
      </li>
    );
  };

  return (
    <>
      <h1>Onaylar</h1>
      {!akis ? (
        <p className="mesaj mesaj-not">
          Onay akışı kapalı: ödemeler ve hakedişler doğrudan kaydedilir. Yönetici Ayarlar › Kullanıcılar › Onay akışı'ndan açabilir.
        </p>
      ) : (
        <p className="soluk">
          {tlYaz(akis.esik)} ve üstü {[akis.odeme && 'ödemeler', akis.hakedis && 'hakedişler'].filter(Boolean).join(' ve ')} yönetici onayından geçer
          {akis.kontrol ? '; önce muhasebe kontrol eder' : ''}.
        </p>
      )}
      {mesaj && <p className="mesaj mesaj-basari">{mesaj}</p>}
      {hata && <Hatalar hatalar={[hata]} />}

      <section className="kart">
        <h2>Ödeme talimatları</h2>
        {b.talimatlar.length === 0 ? <BosDurum metin="Bekleyen ödeme talimatı yok." /> : <ul className="onay-listesi">{b.talimatlar.map(talimat)}</ul>}
      </section>

      {akis?.hakedis && (
        <section className="kart">
          <h2>Hakedişler</h2>
          {b.hakedisler.length === 0 ? (
            <p className="soluk">Onay bekleyen eşik üstü hakediş yok.</p>
          ) : (
            <ul className="onay-listesi">
              {b.hakedisler.map((h) => (
                <li key={h.id} className="onay-ogesi">
                  <div className="isg-ust">
                    <strong>
                      {adlar.cari.get(h.cariId) ?? '?'} · {h.no}. hakediş
                    </strong>
                    <strong>{tlYaz(h.borcTutari)}</strong>
                  </div>
                  <span className="soluk kucuk">
                    {tarihYaz(h.tarih)} · hazırlayan {kisi(h.olusturan)}
                    {h.kontrol ? ` · kontrol: ${kisi(h.kontrol.kullaniciId)}` : akis.kontrol ? ' · kontrol bekliyor' : ''}
                  </span>
                  <div className="dugmeler">
                    <button type="button" className="ikincil" onClick={() => git(`hakedisler/${h.id}`)}>
                      {rol === 'yonetici' ? 'Aç ve onayla' : 'Aç'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {b.sonuclananlar.length > 0 && (
        <section className="kart">
          <h2>Son 30 gün</h2>
          <ul className="liste">
            {b.sonuclananlar.map((t) => (
              <li key={t.id}>
                <span>
                  {adlar.cari.get(t.cariId) ?? '?'} · {tlYaz(t.tutar)}
                  <span className="blok soluk kucuk">
                    {ODEME_ONAYI_DURUMU_ADI[t.durum]}
                    {t.karar ? ` · ${kisi(t.karar.kullaniciId)}, ${tarihYaz(t.karar.zaman)}${t.karar.not ? ` · ${t.karar.not}` : ''}` : ''}
                  </span>
                </span>
                {t.odemeId && <a href={`#/odemeler/${t.odemeId}`}>Ödeme</a>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
