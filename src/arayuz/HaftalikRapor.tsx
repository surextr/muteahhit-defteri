import { useEffect, useState } from 'react';
import { yazdir } from '../cihaz/paylas';
import { haftaAdi, haftaBasi, haftalikMesaj, yuzdeYazi } from '../hesap/haftalikRapor';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { haftalikRaporGetir, type HaftalikRaporSonucu } from '../servisler/haftalikRapor';
import { useUygulama } from './baglam';
import { PdfPaylasDugmesi, WhatsappDugmesi } from './Paylas';
import { Simge } from './Simge';

// Haftalık şantiye raporu: `#/projeler/:id/haftalik[/:pazartesi]`. Rapor `.sozlesme-belgesi` içinde: yazdırma ve PDF
// paylaşımı yalnız onu alır.

const gunEkle = (t: string, n: number) => new Date(Date.parse(`${t}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const gunAdi = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString('tr-TR', { weekday: 'short', day: 'numeric' });
const tarihKisa = (t: string) => new Date(`${t}T00:00:00`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
const sayi = (n: number) => n.toLocaleString('tr-TR', { maximumFractionDigits: 1 });

export function HaftalikRaporEkrani({ projeId, hafta }: { projeId: string; hafta?: string }) {
  const { depo, firma } = useUygulama();
  const bugun = yerelGun(new Date());
  const bas = haftaBasi(hafta && /^\d{4}-\d{2}-\d{2}$/.test(hafta) ? hafta : bugun);
  const [s, setS] = useState<HaftalikRaporSonucu | null | undefined>(undefined);
  useEffect(() => {
    setS(undefined);
    void haftalikRaporGetir(depo, firma, projeId, bas, bugun).then(setS);
  }, [depo, firma, projeId, bas, bugun]);

  const yol = (t: string) => `#/projeler/${projeId}/haftalik/${t}`;
  const ileriYok = gunEkle(bas, 7) > bugun;
  return (
    <>
      <div className="yazdirma-gizle">
        <p className="geri">
          <a className="geri-baglanti" href={`#/projeler/${projeId}/gunluk`}>
            ← Şantiye günlüğü
          </a>
        </p>
        <h1>Haftalık rapor</h1>
        <div className="hafta-gezgini">
          <a className="dugme ikincil" href={yol(gunEkle(bas, -7))} aria-label="Önceki hafta">
            ←
          </a>
          <strong>{haftaAdi({ baslangic: bas, bitis: gunEkle(bas, 6) })}</strong>
          {ileriYok ? (
            <span className="dugme ikincil devre-disi" aria-hidden="true">
              →
            </span>
          ) : (
            <a className="dugme ikincil" href={yol(gunEkle(bas, 7))} aria-label="Sonraki hafta">
              →
            </a>
          )}
        </div>
        {s && (
          <div className="dugmeler">
            <button type="button" onClick={() => void yazdir()}>
              <Simge ad="yazdir" /> Yazdır / PDF
            </button>
            <PdfPaylasDugmesi ad={`${s.proje.ad} haftalık rapor ${bas}`} mesaj={`${s.proje.ad} haftalık rapor (${haftaAdi(s.rapor)})`} cariId={null} />
            <WhatsappDugmesi telefon={null} etiket="Özeti gönder" metin={() => haftalikMesaj(s.proje.ad, s.rapor, firma.ad)} />
          </div>
        )}
      </div>
      {s === undefined && <p>Yükleniyor…</p>}
      {s === null && <p className="hata">Proje bulunamadı.</p>}
      {s && <Rapor s={s} />}
    </>
  );
}

function Rapor({ s }: { s: HaftalikRaporSonucu }) {
  const { firma } = useUygulama();
  const r = s.rapor;
  return (
    <article className="sozlesme-belgesi haftalik-rapor">
      <header className="sb-baslik">
        {firma.logo && <img src={firma.logo} alt="" className="sb-logo" />}
        <div>
          <h1>HAFTALIK ŞANTİYE RAPORU</h1>
          <p className="sb-alt-baslik">
            {s.proje.ad} · {haftaAdi(r)}
            {r.devamEdiyor && ' (hafta sürüyor)'}
          </p>
        </div>
      </header>

      {r.bos && <p>Bu hafta için kayıt yok: günlük, gider, malzeme, fotoğraf ya da olay girilmemiş.</p>}

      <section className="hr-kutular">
        <div>
          <span>Çalışılan gün</span>
          <strong>{r.calisilanGun}</strong>
        </div>
        <div>
          <span>Adam-gün</span>
          <strong>{sayi(r.adamGun)}</strong>
        </div>
        <div>
          <span>İlerleme</span>
          <strong>{r.ilerleme.sonra === null ? '—' : yuzdeYazi(r.ilerleme.sonra)}</strong>
          {r.ilerleme.once !== null && r.ilerleme.sonra !== null && r.ilerleme.sonra !== r.ilerleme.once && <small>önce {yuzdeYazi(r.ilerleme.once)}</small>}
        </div>
        <div>
          <span>Harcama</span>
          <strong>{tlYaz(r.harcama.toplam)}</strong>
          {r.harcama.faturaSayisi > 0 && <small>{r.harcama.faturaSayisi} fatura</small>}
        </div>
      </section>

      <h2>Günler</h2>
      <table className="sb-tablo hr-gunler">
        <thead>
          <tr>
            <th>Gün</th>
            <th>Hava</th>
            <th>Kişi</th>
            <th>Yapılan işler</th>
          </tr>
        </thead>
        <tbody>
          {r.gunler.map((g) => (
            <tr key={g.tarih}>
              <td>{gunAdi(g.tarih)}</td>
              <td>{g.calisilmadi ? 'Çalışılmadı' : (g.hava ?? '')}</td>
              <td>{g.kisi ? sayi(g.kisi) : ''}</td>
              <td>{g.gunluk ? g.yapilan || '' : <span className="hr-soluk">günlük yok</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(r.calisilmayanGun > 0 || r.gunluksuzGun > 0) && (
        <p className="hr-not">
          {r.calisilmayanGun > 0 && `Hava yüzünden ${r.calisilmayanGun} gün çalışılmadı. `}
          {r.gunluksuzGun > 0 && `${r.gunluksuzGun} günün günlüğü yazılmadı.`}
        </p>
      )}

      {r.ekipler.length > 0 && (
        <>
          <h2>Ekipler</h2>
          <ul className="hr-liste">
            {r.ekipler.map((e) => (
              <li key={e.ad}>
                <strong>{e.ad}</strong>: {sayi(e.adamGun)} adam-gün{e.isler.length ? ` · ${e.isler.join(', ')}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}

      {(r.ilerleme.kalemler.length > 0 || r.harcama.kalemler.length > 0) && (
        <div className="hr-iki">
          {r.ilerleme.kalemler.length > 0 && (
            <div>
              <h2>İlerleme</h2>
              <ul className="hr-liste">
                {r.ilerleme.kalemler.map((k) => (
                  <li key={k.ad}>
                    {k.ad}: {yuzdeYazi(k.once ?? 0)} → <strong>{yuzdeYazi(k.sonra)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.harcama.kalemler.length > 0 && (
            <div>
              <h2>Harcama ({firma.ayarlar.kdvMaliyeteDahil ? 'KDV dahil' : 'KDV hariç'})</h2>
              <ul className="hr-liste">
                {r.harcama.kalemler.slice(0, 8).map((k) => (
                  <li key={k.ad}>
                    {k.ad}: <strong>{tlYaz(k.tutar)}</strong>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(r.olaylar.length > 0 || r.malzeme.length > 0) && (
        <div className="hr-iki">
          {r.olaylar.length > 0 && (
            <div>
              <h2>Bu hafta</h2>
              <ul className="hr-liste">
                {r.olaylar.map((o, i) => (
                  <li key={i}>
                    {tarihKisa(o.tarih)}: {o.metin}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {r.malzeme.length > 0 && (
            <div>
              <h2>Gelen malzeme</h2>
              <ul className="hr-liste">
                {r.malzeme.map((m) => (
                  <li key={`${m.ad}|${m.birim}`}>
                    {m.ad}: {sayi(m.miktar)} {m.birim}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {(r.sorunlar.length > 0 || r.eksik.acik > 0 || r.eksik.acilan > 0) && (
        <>
          <h2>Sorunlar ve eksikler</h2>
          <ul className="hr-liste">
            {r.sorunlar.map((x) => (
              <li key={x.tarih}>
                {tarihKisa(x.tarih)}: {x.metin}
              </li>
            ))}
            {(r.eksik.acik > 0 || r.eksik.acilan > 0 || r.eksik.kapanan > 0) && (
              <li>
                Eksik işler: bu hafta {r.eksik.acilan} açıldı, {r.eksik.kapanan} kapandı; açık {r.eksik.acik}
                {r.eksik.geciken ? ` (${r.eksik.geciken} gecikti)` : ''}.
              </li>
            )}
          </ul>
        </>
      )}

      {r.fotograflar.length > 0 && (
        <>
          <h2>Fotoğraflar</h2>
          <div className="hr-fotograflar">
            {r.fotograflar.map((f) => (
              <figure key={f.id}>
                <img src={f.kucukResim} alt={f.aciklama || 'Şantiye fotoğrafı'} />
                <figcaption>
                  {tarihKisa(f.cekimTarihi)}
                  {f.aciklama && ` · ${f.aciklama}`}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}

      {(r.gelecek.odenecek.length > 0 || r.gelecek.malzeme.length > 0 || r.gelecek.asamalar.length > 0) && (
        <>
          <h2>Gelecek hafta</h2>
          <ul className="hr-liste">
            {r.gelecek.asamalar.length > 0 && <li>Süren aşamalar: {r.gelecek.asamalar.join(', ')}</li>}
            {r.gelecek.malzeme.map((m, i) => (
              <li key={`m${i}`}>
                Malzeme gerekli ({tarihKisa(m.gerekli)}): {m.ad}
              </li>
            ))}
            {r.gelecek.odenecek.length > 0 && (
              <li>
                Ödenecek faturalar: {tlYaz(r.gelecek.odenecek.reduce((t, x) => t + x.tutar, 0))} (
                {r.gelecek.odenecek
                  .slice(0, 4)
                  .map((x) => `${x.baslik} ${tarihKisa(x.vade)}`)
                  .join('; ')}
                {r.gelecek.odenecek.length > 4 ? ` +${r.gelecek.odenecek.length - 4}` : ''})
              </li>
            )}
          </ul>
        </>
      )}
      <p className="sb-tarih">
        {firma.ad} · {new Date().toLocaleDateString('tr-TR')}
      </p>
    </article>
  );
}
