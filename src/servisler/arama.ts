import { bolumNo } from '../hesap/bolum';
import { aramaUyar } from '../hesap/metin';
import { tlYaz } from '../hesap/para';
import type { Depo } from '../veri/depo';

// Genel arama: proje, cari, gider (fatura no, cari, açıklama, tutar), satış, sözleşme, çek, belge. Türkçe harfsiz yazım
// ve kelime kelime eşleşir (hesap/metin.ts). Kişinin erişemediği projelerin kayıtları gelmez.

export interface AramaSonucu {
  grup: 'Projeler' | 'Cariler' | 'Giderler' | 'Satışlar' | 'Sözleşmeler' | 'Çek ve senetler' | 'Belgeler';
  baslik: string;
  ayrinti: string;
  yol: string;
}

const aktif = <T extends { iptal: unknown }>(l: T[]) => l.filter((k) => k.iptal === null);
const tarihYaz = (t: string) => new Date(`${t}T00:00`).toLocaleDateString('tr-TR');
const rakam = (s: string) => s.replace(/\D/g, '');

export async function genelArama(depo: Depo, firmaId: string, metin: string, erisim: Set<string> | null, grupBasina = 8): Promise<AramaSonucu[]> {
  const q = metin.trim();
  if (q.length < 2) return [];
  const k = { firmaId };
  const [projeler, cariler, giderler, satirlar, satislar, sozlesmeler, cekler, belgeler, bolumler, bloklar] = await Promise.all([
    depo.listele('proje', k),
    depo.listele('cari', k),
    depo.listele('gider', k),
    depo.listele('giderSatiri', k),
    depo.listele('satis', k),
    depo.listele('ustaSozlesmesi', k),
    depo.listele('cekSenet', k),
    depo.listele('belge', k),
    depo.listele('bagimsizBolum', k),
    depo.listele('blok', k),
  ]);
  const gorunur = (projeId: string | null) => !erisim || projeId === null || erisim.has(projeId);
  const cariAdi = new Map(cariler.map((c) => [c.id, c.ad]));
  const projeAdi = new Map(projeler.map((p) => [p.id, p.ad]));
  const blokAdi = new Map(bloklar.map((b) => [b.id, b.ad]));
  const bolum = new Map(bolumler.map((b) => [b.id, bolumNo(blokAdi.get(b.blokId), b.no)]));
  const qRakam = rakam(q);
  // Tutar araması: "12500" ya da "12.500" yazılırsa o tutardaki kayıtlar da gelir.
  const tutarUyar = (kurus: number) => qRakam.length >= 3 && /^[\d.,\s₺]+$/.test(q) && String(Math.round(kurus / 100)).startsWith(qRakam.replace(/^0+/, ''));
  const sonuc: AramaSonucu[] = [];
  const ekle = (liste: AramaSonucu[]) => sonuc.push(...liste.slice(0, grupBasina));

  ekle(
    aktif(projeler)
      .filter((p) => gorunur(p.id) && aramaUyar(`${p.ad} ${p.mahalle ?? ''} ${p.ilce ?? ''} ${p.adres ?? ''}`, q))
      .map((p) => ({ grup: 'Projeler', baslik: p.ad, ayrinti: [p.mahalle, p.ilce].filter(Boolean).join(', '), yol: `projeler/${p.id}` })),
  );
  ekle(
    aktif(cariler)
      .filter((c) => aramaUyar(`${c.ad} ${c.not} ${c.yetkili ?? ''}`, q) || (qRakam.length >= 4 && (rakam(c.telefon ?? '').includes(qRakam) || rakam(c.vergiNo ?? '').includes(qRakam))))
      .map((c) => ({ grup: 'Cariler', baslik: c.ad, ayrinti: c.telefon ?? '', yol: `cariler/${c.id}` })),
  );
  const satirMetni = new Map<string, string>();
  for (const s of aktif(satirlar)) satirMetni.set(s.giderId, `${satirMetni.get(s.giderId) ?? ''} ${s.aciklama}`);
  ekle(
    aktif(giderler)
      .filter((g) => gorunur(g.projeId))
      .filter((g) => aramaUyar(`${g.faturaNo ?? ''} ${cariAdi.get(g.cariId ?? '') ?? ''} ${g.aciklama} ${satirMetni.get(g.id) ?? ''}`, q) || tutarUyar(g.toplam))
      .sort((a, b) => b.tarih.localeCompare(a.tarih))
      .map((g) => ({
        grup: 'Giderler',
        baslik: `${cariAdi.get(g.cariId ?? '') ?? 'Carisiz'} · ${tlYaz(g.toplam)}`,
        ayrinti: [tarihYaz(g.tarih), g.faturaNo, projeAdi.get(g.projeId ?? '')].filter(Boolean).join(' · '),
        yol: `giderler/${g.id}`,
      })),
  );
  ekle(
    aktif(satislar)
      .filter((s) => gorunur(s.projeId) && aramaUyar(`${bolum.get(s.bolumId) ?? ''} ${cariAdi.get(s.cariId) ?? ''} ${projeAdi.get(s.projeId) ?? ''}`, q))
      .map((s) => ({ grup: 'Satışlar', baslik: `${bolum.get(s.bolumId) ?? '?'} · ${cariAdi.get(s.cariId) ?? '?'}`, ayrinti: projeAdi.get(s.projeId) ?? '', yol: `satislar/${s.id}` })),
  );
  ekle(
    aktif(sozlesmeler)
      .filter((s) => gorunur(s.projeId) && aramaUyar(`${cariAdi.get(s.cariId) ?? ''} ${s.ustaTipiAdi} ${projeAdi.get(s.projeId) ?? ''}`, q))
      .map((s) => ({ grup: 'Sözleşmeler', baslik: `${cariAdi.get(s.cariId) ?? '?'} · ${s.ustaTipiAdi}`, ayrinti: `${projeAdi.get(s.projeId) ?? ''}${s.onay ? '' : ' · taslak'}`, yol: `sozlesmeler/${s.id}` })),
  );
  ekle(
    aktif(cekler)
      .filter((c) => aramaUyar(`${c.seriNo ?? ''} ${c.banka ?? ''} ${c.kesideci ?? ''} ${cariAdi.get(c.cariId) ?? ''}`, q) || tutarUyar(c.tutar))
      .map((c) => ({ grup: 'Çek ve senetler', baslik: `${cariAdi.get(c.cariId) ?? '?'} · ${tlYaz(c.tutar)}`, ayrinti: `${c.yon === 'alinan' ? 'Alınan' : 'Verilen'} · vade ${tarihYaz(c.vadeTarihi)}`, yol: `cekler/${c.id}` })),
  );
  ekle(
    aktif(belgeler)
      .filter((b) => aramaUyar(b.ad, q))
      .sort((a, b) => b.tarih.localeCompare(a.tarih))
      .map((b) => ({ grup: 'Belgeler', baslik: b.ad, ayrinti: tarihYaz(b.tarih), yol: b.bagliTur === 'belgeHavuzu' ? `havuz/${b.bagliId}` : `belgeler/${b.id}` })),
  );
  return sonuc;
}
