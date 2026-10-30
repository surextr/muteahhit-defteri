import { useCallback, useEffect, useState } from 'react';
import { tlOku, tlYaz, tutarMetni } from '../hesap/para';
import { donemAdi, donemKaydir, type SgkGirdisi } from '../hesap/sgk';
import { yerelGun } from '../hesap/tarih';
import { projeGetir } from '../servisler/proje';
import { oncekiAydanKopyala, sgkDonemi, sgkEkle, sgkGuncelle, sgkIptal, type SgkDonemi } from '../servisler/sgk';
import { projeSozlesmeleri, type SozlesmeOzeti } from '../servisler/ustaSozlesmesi';
import type { Proje, SgkKaydi } from '../veri/tipler';
import { useUygulama } from './baglam';
import { Alan, Hatalar, useGerekceliDegisiklik } from './bilesenler';
import { TutarGirdisi } from './Girdiler';

// SGK takibi: projede ay ay, hangi ustanın (sözleşmenin) kaç işçisi kaç gün bildirildi, prim ve kim ödüyor.
// İmzalı sözleşmesi olup o ay hiç bildirimi girilmemiş ustalar uyarı olarak görünür.

interface Form {
  id?: string;
  sozlesmeId: string;
  isciAdi: string;
  gun: string;
  prim: string;
  odeyen: 'muteahhit' | 'taseron';
  hakediseDahil: boolean;
  girisTarihi: string;
  cikisTarihi: string;
}

const bosForm = (sozlesmeId = ''): Form => ({ sozlesmeId, isciAdi: '', gun: '', prim: '', odeyen: sozlesmeId ? 'taseron' : 'muteahhit', hakediseDahil: false, girisTarihi: '', cikisTarihi: '' });

const kayittanForm = (k: SgkKaydi): Form => ({
  id: k.id,
  sozlesmeId: k.sozlesmeId ?? '',
  isciAdi: k.isciAdi,
  gun: String(k.gun),
  prim: k.prim > 0 ? tutarMetni(k.prim) : '',
  odeyen: k.odeyen,
  hakediseDahil: k.hakediseDahil,
  girisTarihi: k.girisTarihi ?? '',
  cikisTarihi: k.cikisTarihi ?? '',
});

export function SgkEkrani({ projeId }: { projeId: string }) {
  const { depo, oturum, servis } = useUygulama();
  const { degistir, kutu, hata } = useGerekceliDegisiklik();
  const [proje, setProje] = useState<Proje | null | undefined>(undefined);
  const [sozlesmeler, setSozlesmeler] = useState<SozlesmeOzeti[]>([]);
  const [donem, setDonem] = useState(yerelGun(new Date()).slice(0, 7));
  const [veri, setVeri] = useState<SgkDonemi | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [mesaj, setMesaj] = useState<string | null>(null);

  const yukle = useCallback(async () => {
    const [p, s, v] = await Promise.all([projeGetir(depo, oturum.firmaId, projeId), projeSozlesmeleri(depo, oturum.firmaId, projeId), sgkDonemi(depo, oturum.firmaId, projeId, donem)]);
    setProje(p);
    setSozlesmeler(s.filter((x) => x.sozlesme.onay));
    setVeri(v);
  }, [depo, oturum.firmaId, projeId, donem]);
  useEffect(() => {
    void yukle();
  }, [yukle]);

  if (proje === undefined || !veri) return <p>Yükleniyor…</p>;
  if (proje === null) return <p className="hata">Proje bulunamadı.</p>;

  async function kaydet() {
    if (!form) return;
    const prim = form.prim.trim() ? tlOku(form.prim) : 0;
    const gun = form.gun.trim() ? Number(form.gun) : 0;
    if (prim === null) return setMesaj('Prim tutarı okunamadı.');
    const g: SgkGirdisi = {
      sozlesmeId: form.sozlesmeId || null,
      donem,
      isciAdi: form.isciAdi,
      girisTarihi: form.girisTarihi || null,
      cikisTarihi: form.cikisTarihi || null,
      gun,
      prim,
      odeyen: form.odeyen,
      hakediseDahil: form.odeyen === 'muteahhit' && form.hakediseDahil,
    };
    await degistir('SGK kaydı', async (gerekce) => {
      if (form.id) await sgkGuncelle(depo, servis, form.id, g, gerekce);
      else await sgkEkle(depo, servis, projeId, g);
      setForm(form.id ? null : bosForm(form.sozlesmeId));
      setMesaj(null);
      await yukle();
    });
  }

  async function kopyala() {
    await degistir('SGK kopyalama', async () => {
      const n = await oncekiAydanKopyala(depo, servis, projeId, donem, donemKaydir(donem, -1));
      setMesaj(n > 0 ? `${n} işçi önceki aydan taşındı; gün ve primlerini yazın.` : 'Önceki ayda taşınacak işçi yok.');
      await yukle();
    });
  }

  const { ozet } = veri;
  return (
    <>
      <p>
        <a className="geri-baglanti" href={`#/projeler/${projeId}`}>← {proje.ad}</a>
      </p>
      <h1>SGK takibi</h1>
      <div className="donem-secici">
        <button type="button" className="ikincil" aria-label="Önceki ay" onClick={() => (setDonem(donemKaydir(donem, -1)), setForm(null))}>
          ‹
        </button>
        <strong>{donemAdi(donem)}</strong>
        <button type="button" className="ikincil" aria-label="Sonraki ay" onClick={() => (setDonem(donemKaydir(donem, 1)), setForm(null))}>
          ›
        </button>
      </div>

      <section className="kart">
        <p className="ozet-tutar">
          <span>Bildirilen kişi</span>
          <span>{ozet.kisi}</span>
        </p>
        <p className="ozet-tutar">
          <span>Toplam gün</span>
          <span>{ozet.gun}</span>
        </p>
        <p className="ozet-tutar">
          <span>Toplam prim</span>
          <span>{tlYaz(ozet.prim)}</span>
        </p>
        {ozet.muteahhitPrimi > 0 && (
          <p className="mesaj mesaj-not">
            Bizim ödediğimiz prim {tlYaz(ozet.muteahhitPrimi)}. Maliyete girmesi için ödendiğinde <a href={`#/giderler/yeni/${projeId}`}>gider olarak girin</a>.
          </p>
        )}
      </section>

      {veri.bildirimsiz.length > 0 && (
        <div className="mesaj mesaj-uyari">
          <strong>Bu ay bildirimi girilmemiş ustalar</strong>
          <ul>
            {veri.bildirimsiz.map((b) => (
              <li key={b.sozlesme.id}>
                {b.cariAdi} · {b.sozlesme.ustaTipiAdi}
              </li>
            ))}
          </ul>
          <p className="kucuk">İş sürüyorsa işçi bildirimlerini isteyip girin; iş bitmişse sözleşmenin bitiş tarihini yazın.</p>
        </div>
      )}

      {veri.gruplar.map((g) => (
        <section key={g.sozlesme?.id ?? 'kendi'} className="kart">
          <div className="baslik-satiri">
            <h2>{g.cariAdi}</h2>
            <span className="soluk kucuk">
              {g.ozet.kisi} kişi · {g.ozet.gun} gün · {tlYaz(g.ozet.prim)}
            </span>
          </div>
          <ul className="liste">
            {g.kayitlar.map((k) => (
              <li key={k.id}>
                <button type="button" className="genis-satir duz-dugme" onClick={() => (setForm(kayittanForm(k)), setMesaj(null))}>
                  <span className="baslik-satiri">
                    <strong>{k.isciAdi}</strong>
                    <span>{k.gun} gün</span>
                  </span>
                  <span className="soluk blok kucuk">
                    {k.prim > 0 ? tlYaz(k.prim) : 'prim yazılmadı'} · {k.odeyen === 'muteahhit' ? 'biz ödüyoruz' : 'usta öder'}
                    {k.hakediseDahil && ' · hakedişe dahil'}
                    {k.cikisTarihi && ` · çıkış ${new Date(`${k.cikisTarihi}T00:00`).toLocaleDateString('tr-TR')}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="kart">
        <h2>{form?.id ? 'İşçi kaydını düzenle' : 'İşçi ekle'}</h2>
        {!form ? (
          <div className="dugmeler">
            <button type="button" onClick={() => setForm(bosForm(sozlesmeler[0]?.sozlesme.id ?? ''))}>
              + İşçi ekle
            </button>
            <button type="button" className="ikincil" onClick={() => void kopyala()}>
              Önceki aydan taşı
            </button>
          </div>
        ) : (
          <>
            <Alan etiket="Usta / taşeron">
              <select value={form.sozlesmeId} onChange={(e) => setForm({ ...form, sozlesmeId: e.target.value, odeyen: e.target.value ? form.odeyen : 'muteahhit' })}>
                {sozlesmeler.map((s) => (
                  <option key={s.sozlesme.id} value={s.sozlesme.id}>
                    {s.cariAdi} · {s.sozlesme.ustaTipiAdi}
                  </option>
                ))}
                <option value="">Kendi işçimiz</option>
              </select>
            </Alan>
            <Alan etiket="İşçi adı">
              <input value={form.isciAdi} onChange={(e) => setForm({ ...form, isciAdi: e.target.value })} />
            </Alan>
            <div className="iki-sutun">
              <Alan etiket="Gün">
                <input inputMode="numeric" value={form.gun} placeholder="0" onChange={(e) => setForm({ ...form, gun: e.target.value })} />
              </Alan>
              <Alan etiket="Prim (₺)">
                <TutarGirdisi value={form.prim} placeholder="0,00" onChange={(v) => setForm({ ...form, prim: v })} />
              </Alan>
            </div>
            <fieldset className="secenekler">
              <legend>Primi kim ödüyor</legend>
              <label>
                <input type="radio" checked={form.odeyen === 'taseron'} disabled={!form.sozlesmeId} onChange={() => setForm({ ...form, odeyen: 'taseron', hakediseDahil: false })} /> Usta / taşeron
              </label>
              <label>
                <input type="radio" checked={form.odeyen === 'muteahhit'} onChange={() => setForm({ ...form, odeyen: 'muteahhit' })} /> Biz
              </label>
            </fieldset>
            {form.odeyen === 'muteahhit' && form.sozlesmeId && (
              <label className="onay-kutusu">
                <input type="checkbox" checked={form.hakediseDahil} onChange={(e) => setForm({ ...form, hakediseDahil: e.target.checked })} /> Hakedişten kesildi (maliyete
                ayrıca yazılmaz)
              </label>
            )}
            <div className="iki-sutun">
              <Alan etiket="İşe giriş">
                <input type="date" value={form.girisTarihi} onChange={(e) => setForm({ ...form, girisTarihi: e.target.value })} />
              </Alan>
              <Alan etiket="Çıkış">
                <input type="date" value={form.cikisTarihi} onChange={(e) => setForm({ ...form, cikisTarihi: e.target.value })} />
              </Alan>
            </div>
            {kutu}
            {(hata || mesaj) && <Hatalar hatalar={[hata ?? mesaj!]} />}
            <div className="dugmeler">
              <button type="button" disabled={!form.isciAdi.trim()} onClick={() => void kaydet()}>
                Kaydet
              </button>
              <button type="button" className="ikincil" onClick={() => setForm(null)}>
                Vazgeç
              </button>
              {form.id && (
                <button
                  type="button"
                  className="tehlikeli"
                  onClick={() =>
                    void degistir('SGK kaydı iptali', async (gerekce) => {
                      await sgkIptal(servis, form.id!, gerekce);
                      setForm(null);
                      await yukle();
                    })
                  }
                >
                  Sil
                </button>
              )}
            </div>
          </>
        )}
        {!form && mesaj && <p className="mesaj mesaj-not">{mesaj}</p>}
      </section>
    </>
  );
}
