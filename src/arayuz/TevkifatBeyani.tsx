import { useEffect, useState } from 'react';
import { tevkifatYaz } from '../hesap/gider';
import { tlYaz } from '../hesap/para';
import { yerelGun } from '../hesap/tarih';
import { tevkifatBeyanlari, type TevkifatDonemi } from '../servisler/tevkifat';
import { useUygulama } from './baglam';

const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const ayYaz = (donem: string) => new Date(`${donem}-01T00:00`).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' });

/** Vergi dairesi kartında: ay ay beyan edilecek tevkifat, oran kırılımı ve faturalar. */
export function TevkifatBeyani() {
  const { depo, oturum } = useUygulama();
  const [donemler, setDonemler] = useState<TevkifatDonemi[] | null>(null);

  useEffect(() => {
    void tevkifatBeyanlari(depo, oturum.firmaId).then(setDonemler);
  }, [depo, oturum.firmaId]);

  if (!donemler) return null;
  const bugun = yerelGun(new Date());

  return (
    <section className="kart">
      <h2>Beyan edilecek tevkifat</h2>
      <p className="soluk">
        Alışlarda tevkif ettiğimiz KDV, fatura tarihinin ayına göre. KDV 2 beyannamesi verilip izleyen ayın 28'ine kadar ödenir.
        Ödeme yapınca en eski aydan başlayarak kapanır.
      </p>
      {donemler.length === 0 ? (
        <p className="soluk">Henüz tevkifatlı alış yok.</p>
      ) : (
        <ul className="liste tevkifat-donemleri">
          {donemler.map((d) => {
            const gecikti = d.kalan > 0 && d.sonGun < bugun;
            return (
              <li key={d.donem}>
                <details>
                  <summary>
                    <span>
                      <strong>{ayYaz(d.donem)}</strong>
                      <span className={`soluk blok ${gecikti ? 'bakiye-borc' : ''}`}>
                        Son gün {tarihYaz(d.sonGun)}
                        {gecikti && ' · geçti'}
                      </span>
                    </span>
                    <span className="donem-tutar">
                      <strong>{tlYaz(d.toplam)}</strong>
                      <span className={`blok ${d.kalan <= 0 ? 'bakiye-alacak' : 'soluk'}`}>
                        {d.kalan < 0 ? `Alacak ${tlYaz(-d.kalan)}` : d.kalan === 0 ? 'Ödendi' : d.odenen > 0 ? `Kalan ${tlYaz(d.kalan)}` : 'Ödenmedi'}
                      </span>
                    </span>
                  </summary>

                  <h3>Oranlara göre</h3>
                  <ul className="liste">
                    {d.oranlar.map((o) => (
                      <li key={`${o.kdvOrani}-${tevkifatYaz(o.tevkifat)}`}>
                        <span>
                          KDV %{o.kdvOrani} · tevkifat {tevkifatYaz(o.tevkifat)}
                          <span className="soluk blok">
                            Matrah {tlYaz(o.matrah)} · KDV {tlYaz(o.kdv)}
                          </span>
                        </span>
                        <strong>{tlYaz(o.tevkifatTutari)}</strong>
                      </li>
                    ))}
                  </ul>

                  <h3>Faturalar</h3>
                  <ul className="liste">
                    {d.faturalar.map((f) => (
                      <li key={f.gider.id}>
                        <span>
                          <a href={`#/giderler/${f.gider.id}`}>
                            {f.gider.tur === 'iade' && 'İade · '}
                            {tarihYaz(f.gider.tarih)}
                            {f.gider.faturaNo && ` · ${f.gider.faturaNo}`}
                          </a>
                          <span className="soluk blok">
                            {d.saticiAdlari[f.gider.id] ?? 'Carisiz'} · matrah {tlYaz(f.matrah)}
                          </span>
                        </span>
                        <span className="donem-tutar">
                          <strong>{tlYaz(f.tevkifatTutari)}</strong>
                          {f.gider.tur === 'iade' ? (
                            <span className="soluk blok">{f.kalan < 0 ? `Alacak ${tlYaz(-f.kalan)}` : 'Faturadan düşüldü'}</span>
                          ) : (
                            <>
                              {f.kalan > 0 && f.kalan < f.tevkifatTutari && <span className="soluk blok">Kalan {tlYaz(f.kalan)}</span>}
                              {f.kalan === 0 && <span className="bakiye-alacak blok">Ödendi</span>}
                            </>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
