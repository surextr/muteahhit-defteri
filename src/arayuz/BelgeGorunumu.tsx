import type { MetinMaddesi, SozlesmeMetni } from '../hesap/ustaSozlesmesi';

// Yazdırılabilir belge (usta sözleşmesi, hakediş): logo, başlık, taraflar, numaralı maddeler, tablolar, imzalar.
// `@media print` yalnız `.sozlesme-belgesi`ni basar.

function MaddeIcerigi({ md }: { md: MetinMaddesi }) {
  return (
    <>
      <h2>{md.baslik}</h2>
      {md.paragraflar.map((p) => (
        <p key={p}>{p}</p>
      ))}
      {md.tablo && (
        <table className={`sb-tablo${md.tablo.sinif ? ` ${md.tablo.sinif}` : ''}`}>
          <thead>
            <tr>
              {md.tablo.basliklar.map((b) => (
                <th key={b}>{b}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {md.tablo.satirlar.map((r, i) => {
              const tur = md.tablo!.satirTurleri?.[i] ?? 'kalem';
              const sutun = md.tablo!.basliklar.length;
              if (tur === 'grup')
                return (
                  <tr key={i} className="sb-grup">
                    <th colSpan={sutun}>{r[0]}</th>
                  </tr>
                );
              if (tur === 'ara')
                return (
                  <tr key={i} className="sb-ara">
                    <td colSpan={sutun - 1}>{r[0]}</td>
                    <td>{r[r.length - 1]}</td>
                  </tr>
                );
              return (
                <tr key={i}>
                  {r.map((h, j) => (
                    <td key={j}>{h}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
          {md.tablo.alt && (
            <tfoot>
              <tr>
                <td colSpan={md.tablo.basliklar.length - 1}>{md.tablo.alt[0]}</td>
                <td>{md.tablo.alt[md.tablo.alt.length - 1]}</td>
              </tr>
            </tfoot>
          )}
        </table>
      )}
      {md.liste && (
        <ol className="sb-alt-liste">
          {md.liste.map((x, i) => (
            <li key={i}>{x}</li>
          ))}
        </ol>
      )}
    </>
  );
}

function Madde({ md }: { md: MetinMaddesi }) {
  return (
    <li>
      <MaddeIcerigi md={md} />
    </li>
  );
}

export function SozlesmeBelgesiGorunumu(props: { metin: SozlesmeMetni; logo: string | null; taslak: boolean; surum: number }) {
  const { metin: m } = props;
  return (
    <article className="sozlesme-belgesi">
      <header className="sb-baslik">
        {props.logo && <img src={props.logo} alt="" className="sb-logo" />}
        <div>
          <h1>{m.baslik}</h1>
          <p className="sb-alt-baslik">{m.altBaslik}</p>
        </div>
        {props.taslak ? <span className="sb-damga">TASLAK</span> : props.surum > 1 && <span className="sb-surum">Sürüm {props.surum}</span>}
      </header>

      <section className="sb-taraflar">
        {m.taraflar.map((t) => (
          <div key={t.rol}>
            <h2>{t.rol}</h2>
            <p>
              <strong>{t.ad}</strong>
            </p>
            {t.satirlar.map((x) => (
              <p key={x}>{x}</p>
            ))}
          </div>
        ))}
      </section>

      <ol className="sb-maddeler">
        {m.maddeler.slice(0, -1).map((md) => (
          <Madde key={md.baslik} md={md} />
        ))}
      </ol>

      {/* Son madde (yürürlük / onay) imzalarla aynı sayfada kalsın: imzalar tek başına sayfaya düşmesin. */}
      <div className="sb-son">
        {m.maddeler.length > 0 && (
          <ol className="sb-maddeler" start={m.maddeler.length}>
            <Madde md={m.maddeler.at(-1)!} />
          </ol>
        )}
        <section className="sb-imzalar">
          {m.imzalar.map((i) => (
            <div key={i.rol}>
              <h2>{i.rol}</h2>
              <p>{i.ad}</p>
              <p className="sb-imza-cizgisi">İmza</p>
            </div>
          ))}
        </section>
        <p className="sb-tarih">Tarih: {m.imzaTarihi}</p>
      </div>
    </article>
  );
}
