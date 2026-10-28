import type { Hakedis, Tarih, UstaSozlesmesi } from '../veri/tipler';
import { bransKisaAdi } from './brans';
import { tevkifatYaz } from './gider';
import { tlYaz } from './para';
import { sayiYaz } from './sayi';
import { isAdlariMetni, sozlesmeMetni, sozlesmeTahminiTutari, type MetinKaynaklari, type MetinMaddesi, type SozlesmeMetni } from './ustaSozlesmesi';

// Yazdırılabilir hakediş belgesi. Saf: veritabanını bilmez. Taraflar ve imza satırları sözleşmenin metniyle aynıdır
// (İşveren = firma, Yüklenici = usta/taşeron). "Önceki" yalnız bu hakedişten önceki (numarası küçük) onaylı
// hakedişlerdir; taslaklar ve sonraki hakedişler sayılmaz.

const tarihYaz = (t: Tarih | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '…/…/……');

type BelgeHakedisi = Pick<
  Hakedis,
  | 'no'
  | 'tarih'
  | 'donemAsama'
  | 'satirlar'
  | 'kesintiler'
  | 'kdvOrani'
  | 'tevkifat'
  | 'teminatOrani'
  | 'avansMahsubu'
  | 'brutTutar'
  | 'kesintiToplam'
  | 'kdvTutari'
  | 'tevkifatTutari'
  | 'borcTutari'
  | 'teminatTutari'
  | 'netTutar'
  | 'not'
>;

export interface HakedisBelgesiKaynagi extends MetinKaynaklari {
  sozlesme: UstaSozlesmesi;
  /** Bu hakedişten önceki onaylı hakedişler (çağıran süzer). */
  oncekiler: Pick<Hakedis, 'satirlar' | 'brutTutar' | 'kesintiToplam' | 'teminatTutari'>[];
}

/** Bu hakedişten önceki onaylı hakedişler: iptal edilmemiş, onaylı ve numarası küçük. */
export function oncekiOnaylilar<T extends Pick<Hakedis, 'no' | 'onay' | 'iptal'>>(hakedisler: T[], no: number): T[] {
  return hakedisler.filter((h) => h.iptal === null && h.onay !== null && h.no < no);
}

export function hakedisBelgesi(h: BelgeHakedisi, k: HakedisBelgesiKaynagi): SozlesmeMetni {
  const s = k.sozlesme;
  const toplu = s.bolumler.length > 1;
  const sozlesmeMetinleri = sozlesmeMetni(s, k);

  // Önceki miktarlar (metraj) ve önceki hakediş toplamları.
  const oncekiMiktar = new Map<string, number>();
  for (const o of k.oncekiler) {
    for (const x of o.satirlar) {
      if (x.tur === 'metraj' && x.kaynakId && x.miktar !== null) oncekiMiktar.set(x.kaynakId, (oncekiMiktar.get(x.kaynakId) ?? 0) + x.miktar);
    }
  }
  const oncekiTutar = k.oncekiler.reduce((t, o) => t + o.brutTutar - o.kesintiToplam, 0);
  const oncekiTeminat = k.oncekiler.reduce((t, o) => t + o.teminatTutari, 0);
  const buTutar = h.brutTutar - h.kesintiToplam;

  const maddeler: MetinMaddesi[] = [];
  maddeler.push({
    baslik: 'Sözleşme',
    paragraflar: [
      `"${k.proje.ad}" projesinde ${tarihYaz(s.sozlesmeTarihi)} tarihli sözleşmeyle ${isAdlariMetni(s.bolumler)} işleri için düzenlenen ${h.no} numaralı hakediştir${h.donemAsama ? ` (${h.donemAsama})` : ''}.`,
    ],
  });

  // Kalem tablosu: iş başına grup (toplu sözleşmede), metrajda önceki / bu dönem / toplam miktar.
  const satirlar: string[][] = [];
  const turler: ('kalem' | 'grup' | 'ara')[] = [];
  for (const b of s.bolumler) {
    const buIs = h.satirlar.filter((x) => x.ustaTipiId === b.ustaTipiId);
    if (buIs.length === 0) continue;
    if (toplu) {
      satirlar.push([`${bransKisaAdi(b.ustaTipiAdi)} işleri`]);
      turler.push('grup');
    }
    for (const x of buIs) {
      if (x.tur === 'metraj') {
        const kalem = s.kalemler.find((y) => y.id === x.kaynakId);
        const onceki = x.kaynakId ? (oncekiMiktar.get(x.kaynakId) ?? 0) : 0;
        satirlar.push([
          kalem?.ad ?? x.aciklama,
          x.birim,
          onceki > 0 ? sayiYaz(onceki) : '—',
          sayiYaz(x.miktar ?? 0),
          sayiYaz(onceki + (x.miktar ?? 0)),
          x.birimFiyat !== null ? tlYaz(x.birimFiyat) : '—',
          tlYaz(x.tutar),
        ]);
      } else {
        const ad = x.tur === 'asama' ? `${x.aciklama} (aşama)` : x.tur === 'ilave' ? `İlave iş: ${x.aciklama}` : x.aciklama;
        const miktarli = x.tur === 'ilave' && x.miktar !== null;
        satirlar.push([ad, miktarli ? x.birim : '—', '—', miktarli ? sayiYaz(x.miktar!) : '—', '—', miktarli && x.birimFiyat !== null ? tlYaz(x.birimFiyat) : '—', tlYaz(x.tutar)]);
      }
      turler.push('kalem');
    }
    if (toplu) {
      satirlar.push([`${bransKisaAdi(b.ustaTipiAdi)} toplamı`, '', '', '', '', '', tlYaz(buIs.reduce((t, x) => t + x.tutar, 0))]);
      turler.push('ara');
    }
  }
  maddeler.push({
    baslik: 'Yapılan işler',
    paragraflar: s.bolumler.some((b) => b.takipYontemi === 'metraj') ? ['Miktarlar yerinde ölçülmüş, "Önceki" sütunu bu hakedişten önce ödenen miktardır.'] : [],
    tablo: {
      basliklar: ['Kalem', 'Birim', 'Önceki', 'Bu hakediş', 'Toplam', 'Birim fiyat', 'Tutar'],
      satirlar,
      ...(toplu ? { satirTurleri: turler } : {}),
      alt: ['Hakediş tutarı', '', '', '', '', '', tlYaz(h.brutTutar)],
    },
  });

  // Hesap özeti: tutar sütunu sağda.
  const ozet: string[][] = [['Hakediş tutarı', tlYaz(h.brutTutar)]];
  for (const x of h.kesintiler) ozet.push([`Kesinti: ${x.aciklama}`, `−${tlYaz(x.tutar)}`]);
  if (h.kdvTutari > 0) ozet.push([`KDV %${h.kdvOrani}`, tlYaz(h.kdvTutari)]);
  if (h.tevkifatTutari > 0) {
    ozet.push([`KDV tevkifatı${h.tevkifat ? ` ${tevkifatYaz(h.tevkifat)}` : ''} (İşveren vergi dairesine öder)`, `−${tlYaz(h.tevkifatTutari)}`]);
  }
  const ozetTurleri: ('kalem' | 'ara')[] = ozet.map(() => 'kalem');
  ozet.push(['Yükleniciye borç', tlYaz(h.borcTutari)]);
  ozetTurleri.push('ara');
  if (h.teminatTutari > 0) {
    ozet.push([`Teminat kesintisi %${sayiYaz(h.teminatOrani)} (iş teslim edilip kabul edilince ödenir)`, `−${tlYaz(h.teminatTutari)}`]);
    ozetTurleri.push('kalem');
  }
  if (h.avansMahsubu > 0) {
    ozet.push(['Daha önce verilen avanstan mahsup', `−${tlYaz(h.avansMahsubu)}`]);
    ozetTurleri.push('kalem');
  }
  maddeler.push({
    baslik: 'Hesap',
    paragraflar: [],
    tablo: { basliklar: ['Açıklama', 'Tutar'], satirlar: ozet, satirTurleri: ozetTurleri, alt: ['Bu hakedişte ödenecek', tlYaz(h.netTutar)], sinif: 'sb-hesap' },
  });

  // İş ilerlemesi: önceki + bu hakediş, sözleşmenin tahmini tutarına oranı.
  const { toplam: sozlesmeTutari, eksikMiktar } = sozlesmeTahminiTutari(s);
  const kumulatif = oncekiTutar + buTutar;
  maddeler.push({
    baslik: 'Toplam durum',
    paragraflar: [
      `Önceki hakedişler: ${tlYaz(oncekiTutar)} · Bu hakediş: ${tlYaz(buTutar)} · Toplam: ${tlYaz(kumulatif)}.`,
      ...(sozlesmeTutari > 0 && !eksikMiktar ? [`Sözleşmenin tahmini tutarı ${tlYaz(sozlesmeTutari)}; yapılan iş bunun %${Math.round((kumulatif / sozlesmeTutari) * 100)}'idir.`] : []),
      ...(h.teminatTutari > 0 || oncekiTeminat > 0 ? [`Bu hakedişle birlikte tutulan toplam teminat: ${tlYaz(oncekiTeminat + h.teminatTutari)}.`] : []),
      ...(h.not.trim() ? [`Not: ${h.not.trim()}`] : []),
    ],
  });

  maddeler.push({
    baslik: 'Onay',
    paragraflar: [`Yukarıdaki miktar ve tutarlar taraflarca kontrol edilmiş, ${tarihYaz(h.tarih)} tarihinde iki nüsha olarak imzalanmıştır.`],
  });

  return {
    baslik: 'HAKEDİŞ BELGESİ',
    altBaslik: `Hakediş ${h.no}${h.donemAsama ? ` · ${h.donemAsama}` : ''} · ${s.bolumler.map((b) => bransKisaAdi(b.ustaTipiAdi)).join(', ')}`,
    taraflar: sozlesmeMetinleri.taraflar,
    maddeler,
    imzaTarihi: tarihYaz(h.tarih),
    imzalar: sozlesmeMetinleri.imzalar,
  };
}
