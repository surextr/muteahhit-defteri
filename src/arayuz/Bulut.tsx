import { useEffect, useState } from 'react';
import { bulutaAc, bulutBaglantisiniKes, bulutFirmasinaKatil, sunucuApi, type EsitlemeDurumu } from '../bulut/esitleme';
import { IsKuraliHatasi } from '../servisler/kayitServisi';
import type { Depo } from '../veri/depo';
import { useUygulama, useYetki } from './baglam';
import { Alan, Hatalar, hataMetni } from './bilesenler';
import { HesapGirisi, useHesap } from './HesapGirisi';

// Bulut eşitleme ekranları: Ayarlar kartı, kurulumda buluttaki firmaya katılma, kullanıcıya davet kodu.

const zamanYaz = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';

export function durumMetni(d: EsitlemeDurumu): string {
  const bekleyen = 'bekleyen' in d && d.bekleyen > 0 ? ` · ${d.bekleyen} değişiklik gönderilmeyi bekliyor` : '';
  switch (d.tur) {
    case 'bagli_degil':
      return 'Buluta bağlı değil';
    case 'esitleniyor':
      return 'Eşitleniyor…';
    case 'tamam':
      return `Eşitlendi (${zamanYaz(d.zaman)})${bekleyen}`;
    case 'cevrimdisi':
      return `İnternet yok; bağlanınca eşitlenecek${bekleyen}`;
    case 'giris_gerekli':
      return `Oturumun süresi doldu; yeniden giriş yapın${bekleyen}`;
    case 'hata':
      return `Eşitlenemedi: ${d.mesaj}${bekleyen}`;
  }
}

/** Ayarlar › Bulut eşitleme. */
export function BulutKarti() {
  const { depo, oturum, firma, bulut } = useUygulama();
  const yetki = useYetki();
  const [eposta, setEposta] = useHesap();
  const [islemde, setIslemde] = useState<string | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [kesSoru, setKesSoru] = useState(false);
  const bagli = bulut.durum.tur !== 'bagli_degil';

  async function calistir(ad: string, is: () => Promise<void>) {
    setIslemde(ad);
    setHata(null);
    try {
      await is();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(null);
    }
  }

  return (
    <section className="kart">
      <h2>Bulut eşitleme</h2>
      <p className="soluk">
        Firmanın kayıtları muteahhit.surex.tr sunucusunda saklanır ve bağlı bütün cihazlarda aynı olur. Cihaz internetsiz de çalışır; bağlanınca eşitlenir. Her
        kişi kendi giriş hesabıyla girer; yetkiler Ayarlar › Kullanıcılar'daki rollerdendir.
      </p>
      {bagli && (
        <>
          <p className={`bulut-satiri bulut-${bulut.durum.tur}`} role="status">
            {durumMetni(bulut.durum)}
          </p>
          <div className="dugmeler">
            <button type="button" disabled={!!islemde || bulut.durum.tur === 'esitleniyor'} onClick={() => void calistir('simdi', bulut.simdi)}>
              Şimdi eşitle
            </button>
            {!kesSoru && (
              <button type="button" className="baglanti-dugmesi" onClick={() => setKesSoru(true)}>
                Bu cihazın bağlantısını kes
              </button>
            )}
          </div>
          {kesSoru && (
            <div className="mesaj mesaj-uyari" role="alertdialog" aria-label="Bağlantıyı kesme">
              <p>
                Bu cihaz eşitlemeyi bırakır; kayıtlar cihazda kalır ama başka cihazlardaki değişiklikler gelmez.
                {'bekleyen' in bulut.durum && bulut.durum.bekleyen > 0 && ` Gönderilmemiş ${bulut.durum.bekleyen} değişiklik buluta gitmez.`}
              </p>
              <div className="dugmeler">
                <button
                  type="button"
                  className="tehlikeli"
                  onClick={() =>
                    void calistir('kes', async () => {
                      await bulutBaglantisiniKes(depo);
                      setKesSoru(false);
                      bulut.yenidenBaslat();
                    })
                  }
                >
                  Bağlantıyı kes
                </button>
                <button type="button" className="ikincil" onClick={() => setKesSoru(false)}>
                  Vazgeç
                </button>
              </div>
            </div>
          )}
          {(bulut.durum.tur === 'giris_gerekli' || eposta === null) && (
            <HesapGirisi eposta={eposta} onDegisti={(e) => (setEposta(e), e && void bulut.simdi())} />
          )}
        </>
      )}
      {!bagli && (
        <>
          <HesapGirisi eposta={eposta} onDegisti={setEposta} />
          {eposta && yetki('yonetici') && (
            <>
              <p className="mesaj-not">
                Firmayı buluta açınca bu cihazdaki bütün kayıtlar gönderilir; sonra Ayarlar › Kullanıcılar'dan her kişiye davet kodu üretin. Bu hesap ({eposta})
                firmanın yöneticisi olur.
              </p>
              <button
                type="button"
                disabled={!!islemde}
                onClick={() =>
                  void calistir('ac', async () => {
                    const s = await bulutaAc(depo, oturum, firma.ad);
                    if (s.reddedilen.length > 0) throw new IsKuraliHatasi(`${s.reddedilen.length} kayıt sunucuya kabul edilmedi.`);
                    bulut.yenidenBaslat();
                  })
                }
              >
                {islemde === 'ac' ? 'Kayıtlar gönderiliyor…' : 'Firmayı buluta aç'}
              </button>
            </>
          )}
          {eposta && !yetki('yonetici') && (
            <p className="mesaj-not">Firmayı buluta yalnız yönetici açar. Yönetici açınca size davet kodu verir; kodu yeni kurulan bir cihazda girersiniz.</p>
          )}
        </>
      )}
      <Hatalar hatalar={hata ? [hata] : []} />
    </section>
  );
}

/** Kurulum ekranında: buluttaki firmaya davet koduyla ya da hesabın bağlı olduğu firmayla katılma. */
export function BulutaKatil({ depo, onKatildi }: { depo: Depo; onKatildi: () => void }) {
  const [eposta, setEposta] = useHesap();
  const [firmalar, setFirmalar] = useState<{ id: string; ad: string; kullaniciId: string }[] | null>(null);
  const [kod, setKod] = useState('');
  const [islemde, setIslemde] = useState(false);
  const [hata, setHata] = useState<string | null>(null);

  useEffect(() => {
    if (!eposta) return setFirmalar(null);
    void sunucuApi.firmalarim().then(
      (y) => setFirmalar(y.firmalar),
      (e: unknown) => setHata(hataMetni(e)),
    );
  }, [eposta]);

  async function katil(f: { firmaId: string; kullaniciId: string }) {
    setIslemde(true);
    setHata(null);
    try {
      await bulutFirmasinaKatil(depo, f);
      onKatildi();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  async function kodlaKatil() {
    setIslemde(true);
    setHata(null);
    try {
      const d = await sunucuApi.davetKabul(kod);
      await bulutFirmasinaKatil(depo, d);
      onKatildi();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  return (
    <section className="kart">
      <h2>Buluttaki firmaya katıl</h2>
      <p className="soluk">Firmanız başka bir cihazda buluta açıldıysa kendi giriş hesabınızla girin; kayıtlar bu cihaza alınır.</p>
      <HesapGirisi eposta={eposta} onDegisti={setEposta} />
      {eposta && (
        <>
          {firmalar && firmalar.length > 0 && (
            <ul className="liste">
              {firmalar.map((f) => (
                <li key={f.id}>
                  <strong>{f.ad}</strong>
                  <button type="button" disabled={islemde} onClick={() => void katil({ firmaId: f.id, kullaniciId: f.kullaniciId })}>
                    {islemde ? 'Kayıtlar alınıyor…' : 'Bu firmayla devam et'}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (kod.trim() && !islemde) void kodlaKatil();
            }}
          >
            <Alan etiket="Davet kodu" aciklama="Yöneticinizin Ayarlar › Kullanıcılar'dan ürettiği kod (örn. K7MQ-2WXA).">
              <input value={kod} onChange={(e) => setKod(e.target.value.toUpperCase())} autoCapitalize="characters" autoComplete="off" />
            </Alan>
            <button type="submit" disabled={islemde || !kod.trim()}>
              {islemde ? 'Kayıtlar alınıyor…' : 'Katıl'}
            </button>
          </form>
        </>
      )}
      <Hatalar hatalar={hata ? [hata] : []} />
    </section>
  );
}

/** Kullanıcılar ekranında: kişinin bağlı hesabı, davet kodu üretme, bağı kaldırma (yalnız yönetici, bulut bağlıyken). */
export function DavetAlani({ kullaniciId, ben, hesap, onDegisti }: { kullaniciId: string; ben: boolean; hesap: string | null; onDegisti: () => void }) {
  const { oturum } = useUygulama();
  const [kod, setKod] = useState<{ kod: string; gun: number } | null>(null);
  const [hata, setHata] = useState<string | null>(null);
  const [islemde, setIslemde] = useState(false);

  async function calistir(is: () => Promise<void>) {
    setIslemde(true);
    setHata(null);
    try {
      await is();
    } catch (e) {
      setHata(hataMetni(e));
    } finally {
      setIslemde(false);
    }
  }

  return (
    <div className="davet-alani">
      <p className="soluk">{hesap ? `Giriş hesabı: ${hesap}` : 'Henüz bir giriş hesabına bağlı değil.'}</p>
      {kod && (
        <div className="mesaj mesaj-basari" role="status">
          <p>
            Davet kodu: <strong className="davet-kodu">{kod.kod}</strong>
          </p>
          <p className="kucuk-bilgi">
            Kişi kendi telefonunda muteahhit.surex.tr'yi açar, "Buluttaki firmaya katıl"ı seçer, kendi e-postasıyla kayıt olup girer ve bu kodu yazar. Kod{' '}
            {kod.gun} gün geçerli, bir kez kullanılır.
          </p>
        </div>
      )}
      {!ben && (
        <div className="dugmeler">
          <button
            type="button"
            className="ikincil"
            disabled={islemde}
            onClick={() => void calistir(async () => setKod(await sunucuApi.davetOlustur({ firmaId: oturum.firmaId, kullaniciId })))}
          >
            {hesap ? 'Yeni davet kodu' : 'Davet kodu oluştur'}
          </button>
          {hesap && (
            <button
              type="button"
              className="baglanti-dugmesi"
              disabled={islemde}
              onClick={() =>
                void calistir(async () => {
                  await sunucuApi.baglantiKaldir({ firmaId: oturum.firmaId, kullaniciId });
                  onDegisti();
                })
              }
            >
              Hesap bağını kaldır
            </button>
          )}
        </div>
      )}
      <Hatalar hatalar={hata ? [hata] : []} />
    </div>
  );
}

/** Firmadaki kullanıcıların bağlı giriş hesapları (yönetici, bulut bağlıyken). */
export function useBagliHesaplar(): [Map<string, string> | null, () => void] {
  const { oturum, bulut } = useUygulama();
  const yetki = useYetki();
  const [hesaplar, setHesaplar] = useState<Map<string, string> | null>(null);
  const [tur, setTur] = useState(0);
  const bagli = bulut.durum.tur !== 'bagli_degil';
  const yonetici = yetki('yonetici');
  useEffect(() => {
    if (!bagli || !yonetici) return setHesaplar(null);
    void sunucuApi.uyeler(oturum.firmaId).then(
      (y) => setHesaplar(new Map(y.uyeler.map((u) => [u.kullaniciId, u.eposta]))),
      () => setHesaplar(null),
    );
  }, [bagli, yonetici, oturum.firmaId, tur]);
  return [hesaplar, () => setTur((n) => n + 1)];
}
