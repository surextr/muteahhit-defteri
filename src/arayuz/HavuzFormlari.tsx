import { useEffect, useState } from 'react';
import { havuzOnerisi, havuzSatiriGetir, type HavuzSatiri } from '../servisler/havuz';
import type { Cari } from '../veri/tipler';
import { useUygulama } from './baglam';
import { GiderFormu } from './GiderFormu';
import { OdemeFormu, TahsilatFormu } from './OdemeEkrani';
import { CekFormu } from './CeklerEkrani';

// Onay havuzundaki belgeden kayıt formları: belge (ve varsa tanınan fatura) yüklenir, form onunla açılır.

function useHavuzSatiri(havuzId: string) {
  const { depo, oturum } = useUygulama();
  const [durum, setDurum] = useState<{ satir: HavuzSatiri | null; cari: Cari | null } | undefined>(undefined);
  useEffect(() => {
    void havuzSatiriGetir(depo, oturum.firmaId, havuzId).then(async (satir) => {
      const cari = satir ? (await havuzOnerisi(depo, oturum.firmaId, satir.havuz)).cari : null;
      setDurum({ satir: satir && satir.havuz.durum === 'bekliyor' ? satir : null, cari });
    });
  }, [depo, oturum.firmaId, havuzId]);
  return durum;
}

function Bulunamadi() {
  return (
    <section className="kart">
      <p>Belge havuzda bulunamadı; bağlanmış ya da kaldırılmış olabilir.</p>
      <a className="dugme ikincil" href="#/havuz">
        Belge havuzuna dön
      </a>
    </section>
  );
}

export type HavuzFormTuru = 'gider' | 'odeme' | 'tahsilat' | 'cek-al' | 'cek-ver';

export function HavuzKayitFormu({ havuzId, tur }: { havuzId: string; tur: HavuzFormTuru }) {
  const d = useHavuzSatiri(havuzId);
  if (d === undefined) return <p>Yükleniyor…</p>;
  if (!d.satir) return <Bulunamadi />;
  if (tur === 'odeme') return <OdemeFormu havuz={d.satir} />;
  if (tur === 'tahsilat') return <TahsilatFormu havuz={d.satir} />;
  if (tur === 'cek-al' || tur === 'cek-ver') return <CekFormu havuz={d.satir} yon={tur === 'cek-al' ? 'alinan' : 'verilen'} />;
  return <GiderFormu havuz={d.satir} havuzCarisi={d.cari} iade={!!d.satir.havuz.tanima?.iade} />;
}
