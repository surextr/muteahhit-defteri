import { yazdir as sayfayiYazdir } from '../cihaz/paylas';
import { Simge } from './Simge';
import { useState } from 'react';
import { cihaz } from '../cihaz';
import { dosyaAdiTemizle, EXCEL_TURU, excelOlustur, type ExcelSayfasi } from '../hesap/excel';
import { yerelGun } from '../hesap/tarih';

/**
 * Listeyi Excel'e aktarır ya da sayfayı yazdırır (yazdırma penceresinden "PDF olarak kaydet"). Yazdırmada menüler,
 * düğmeler ve süzgeçler gizlenir (stil.css @media print). Excel tabloyu ekrandaki süzgeçle verir.
 */
export function AktarmaDugmeleri({ dosyaAdi, sayfalar, yazdir = true }: { dosyaAdi: string; sayfalar: () => ExcelSayfasi[] | Promise<ExcelSayfasi[]>; yazdir?: boolean }) {
  const [mesgul, setMesgul] = useState(false);
  async function excel() {
    setMesgul(true);
    try {
      const baytlar = excelOlustur(await sayfalar());
      await cihaz.dosyaKaydet(new Blob([baytlar as BlobPart], { type: EXCEL_TURU }), `${dosyaAdiTemizle(dosyaAdi)} ${yerelGun(new Date())}.xlsx`);
    } finally {
      setMesgul(false);
    }
  }
  return (
    <div className="aktarma yazdirma-gizle">
      <button type="button" className="ikincil" onClick={() => void excel()} disabled={mesgul} title="Excel dosyası olarak indir">
        ⬇ Excel
      </button>
      {yazdir && (
        <button type="button" className="ikincil" onClick={() => void sayfayiYazdir(dosyaAdi)} title="Yazdır ya da PDF olarak kaydet">
          <Simge ad="yazdir" /> PDF / Yazdır
        </button>
      )}
    </div>
  );
}
