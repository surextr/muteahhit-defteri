import type { Cari, Firma, Kurus, Mutabakat, MutabakatYaniti, Tarih } from '../veri/tipler';
import type { CariHareketi, CariHareketTuru } from './bakiye';
import { tlYaz } from './para';
import type { MetinMaddesi, SozlesmeMetni } from './ustaSozlesmesi';

// Cari mutabakatı (saf): durum, fark ve farkı açıklayabilecek hareketler, mutabakat mektubu, WhatsApp mesajı.
// İşaret cari ekstresiyle aynı: artı = borcumuz (cariye), eksi = alacağımız.

export type MutabakatDurumu = 'hazir' | 'gonderildi' | 'mutabik' | 'farkli' | 'cozuldu';

export const MUTABAKAT_DURUMU_ADI: Record<MutabakatDurumu, string> = {
  hazir: 'Gönderilmedi',
  gonderildi: 'Yanıt bekleniyor',
  mutabik: 'Mutabık',
  farkli: 'Fark var',
  cozuldu: 'Fark çözüldü',
};

export function mutabakatDurumu(m: Pick<Mutabakat, 'gonderildi' | 'yanit' | 'cozuldu'>): MutabakatDurumu {
  if (m.yanit) return m.yanit.mutabik ? 'mutabik' : m.cozuldu ? 'cozuldu' : 'farkli';
  return m.gonderildi ? 'gonderildi' : 'hazir';
}

/** Karşı bakiye − bizim bakiye; mutabıksa ya da yanıt yoksa 0. */
export const mutabakatFarki = (m: Pick<Mutabakat, 'bakiye' | 'yanit'>): Kurus => (m.yanit && !m.yanit.mutabik && m.yanit.karsiBakiye !== null ? m.yanit.karsiBakiye - m.bakiye : 0);

/** "Size borcumuz 12.000 TL", "Bize borcunuz …", "Bakiye yok". */
export function bakiyeMetni(bakiye: Kurus, kimden: 'biz' | 'onlar' = 'biz'): string {
  if (bakiye === 0) return 'borç/alacak yok';
  if (kimden === 'biz') return bakiye > 0 ? `firmamızın size borcu ${tlYaz(bakiye)}` : `firmamıza borcunuz ${tlYaz(-bakiye)}`;
  return bakiye > 0 ? `onlara borcumuz ${tlYaz(bakiye)}` : `bize borçları ${tlYaz(-bakiye)}`;
}

export function yanitHatalari(y: Pick<MutabakatYaniti, 'tarih' | 'mutabik' | 'karsiBakiye'>, gonderimTarihi: Tarih | null, tarih: Tarih): string[] {
  const h: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(y.tarih)) h.push('Yanıt gününü seçin.');
  else if (y.tarih < (gonderimTarihi ?? tarih)) h.push('Yanıt günü gönderimden önce olamaz.');
  if (!y.mutabik && y.karsiBakiye === null) h.push('Karşı tarafın kayıtlarındaki bakiyeyi yazın.');
  return h;
}

export interface FarkAdayi {
  hareket: CariHareketi;
  /** Neden açıklayabilir. */
  neden: string;
}

const TUR_ADI: Record<CariHareketTuru, string> = {
  acilis: 'Açılış bakiyesi',
  gider: 'Fatura',
  iade: 'İade faturası',
  tevkifat: 'Tevkifat',
  hakedis: 'Hakediş',
  alacak: 'Alacak',
  odeme: 'Ödeme',
  tahsilat: 'Tahsilat',
  cekGeriDondu: 'Geri dönen çek',
};
export const hareketAdi = (h: Pick<CariHareketi, 'tur' | 'aciklama'>): string => [TUR_ADI[h.tur], h.aciklama].filter(Boolean).join(' · ');

/**
 * Farkı tek başına açıklayabilecek hareketler: tutarı farka eşit (±1 TL) olanlar. Fark artı ise (karşı taraf bize daha çok
 * borç yazmış) bizim kaydımızın onlarda olmaması bakiyemizi düşüren bir harekettir (ödememiz, iade); eksi ise artıran
 * (faturaları). Dönem dışındakiler de aranır (yanlış tarihli kayıt).
 */
export function farkAdaylari(hareketler: CariHareketi[], fark: Kurus): FarkAdayi[] {
  if (fark === 0) return [];
  return hareketler
    .filter((h) => Math.abs(Math.abs(h.tutar) - Math.abs(fark)) <= 100)
    .map((h) => {
      // Karşı tarafta olmayan kaydımız: bakiyemizi (−h.tutar) kadar farklı gösterir.
      const eksikOnlarda = Math.sign(-h.tutar) === Math.sign(fark);
      return {
        hareket: h,
        neden: eksikOnlarda
          ? `Bu kayıt karşı tarafta olmayabilir (${h.tutar < 0 ? 'ödememizi işlememiş' : 'faturasını kaydetmemiş'} olabilirler).`
          : 'Bu kayıt iki kez sayılmış ya da karşı tarafta tutarı farklı olabilir.',
      };
    });
}

/** Karşı tarafta olup bizde olmayan kayıt için öneri (aday yoksa). */
export function farkYorumu(fark: Kurus): string {
  if (fark === 0) return '';
  return fark > 0
    ? `Karşı taraf bize ${tlYaz(fark)} daha fazla borç yazmış: bizde girilmemiş bir faturaları olabilir ya da bizim bir iademiz / ödememiz onlarda fazla görünüyor.`
    : `Karşı taraf bize ${tlYaz(-fark)} daha az borç yazmış: bizde girilmemiş bir ödemeleri / iadeleri olabilir ya da bir faturamız onlarda yok.`;
}

const tarihYaz = (t: Tarih | null) => (t ? new Date(`${t}T00:00`).toLocaleDateString('tr-TR') : '…/…/……');
/** Hesap dökümünde bakiye: A = hesabınız alacaklı (borcumuz), B = borçlu. */
const bakiyeHucre = (n: Kurus) => (n === 0 ? '0' : `${tlYaz(Math.abs(n))} ${n > 0 ? '(A)' : '(B)'}`);
const dolu = (x: (string | false | null | undefined)[]) => x.filter((y): y is string => !!y);

export interface MektupKaynaklari {
  firma: Pick<Firma, 'ad' | 'bilgiler'>;
  cari: Pick<Cari, 'ad' | 'telefon' | 'vergiNo' | 'adres' | 'yetkili'>;
  /** Dönem içi hareketler (tarih sırasıyla). */
  hareketler: CariHareketi[];
  /** Dönem başındaki devir bakiyesi. */
  devir: Kurus;
}

/** Mutabakat mektubu: bakiye, dönem hareket dökümü, yanıt kutuları, imzalar. */
export function mutabakatMektubu(m: Mutabakat, k: MektupKaynaklari): SozlesmeMetni {
  const b = k.firma.bilgiler;
  const maddeler: MetinMaddesi[] = [];
  const yon = m.bakiye > 0 ? 'alacak (firmamızın size borcu)' : m.bakiye < 0 ? 'borç (firmamıza borcunuz)' : '';
  maddeler.push({
    baslik: 'Bakiye',
    paragraflar: [
      m.bakiye === 0
        ? `Firmamız kayıtlarına göre ${tarihYaz(m.tarih)} tarihi itibarıyla cari hesabınızda borç ya da alacak bakiyesi bulunmamaktadır.`
        : `Firmamız kayıtlarına göre ${tarihYaz(m.tarih)} tarihi itibarıyla cari hesabınız ${tlYaz(Math.abs(m.bakiye))} ${yon} bakiyesi vermektedir.`,
    ],
  });
  if (k.hareketler.length > 0) {
    const borc = k.hareketler.filter((h) => h.tutar > 0).reduce((t, h) => t + h.tutar, 0);
    const alacak = k.hareketler.filter((h) => h.tutar < 0).reduce((t, h) => t - h.tutar, 0);
    maddeler.push({
      baslik: 'Hesap dökümü',
      paragraflar: [
        `${m.donemBaslangic ? `${tarihYaz(m.donemBaslangic)} – ${tarihYaz(m.tarih)} arası` : `${tarihYaz(m.tarih)} tarihine kadar`} hareketler aşağıdadır. Faturalar ve hakedişler hesabınıza alacak, ödemelerimiz borç yazılmıştır; bakiyede (A) hesabınızın alacaklı, (B) borçlu olduğunu gösterir.`,
      ],
      tablo: {
        basliklar: ['Tarih', 'Açıklama', 'Borç', 'Alacak', 'Bakiye'],
        satirlar: [
          ...(m.donemBaslangic ? [['', 'Devir', '', '', bakiyeHucre(k.devir)]] : []),
          ...k.hareketler.map((h) => [tarihYaz(h.tarih), hareketAdi(h), h.tutar < 0 ? tlYaz(-h.tutar) : '', h.tutar > 0 ? tlYaz(h.tutar) : '', bakiyeHucre(h.bakiye)]),
        ],
        alt: ['Dönem toplamı', '', tlYaz(alacak), tlYaz(borc), bakiyeHucre(m.bakiye)],
      },
    });
  }
  maddeler.push({
    baslik: 'Yanıt',
    paragraflar: [
      'Kayıtlarınızla karşılaştırarak aşağıdaki seçeneklerden birini işaretleyip imzalı olarak bize iletmenizi rica ederiz. Mutabık değilseniz kayıtlarınızdaki bakiyeyi ve mümkünse hesap dökümünüzü ekleyiniz.',
      '☐ Mutabıkız.',
      '☐ Mutabık değiliz. Kayıtlarımıza göre bakiye: ……………………… TL  ☐ borcunuz  ☐ alacağınız',
    ],
  });
  if (m.not.trim()) maddeler.push({ baslik: 'Not', paragraflar: [m.not.trim()] });
  maddeler.push({
    baslik: 'Saygılarımızla',
    paragraflar: [`Bu mektup ${tarihYaz(m.gonderildi ?? m.tarih)} tarihinde düzenlenmiştir. Hesap ekstresi ve belgeler istenirse ayrıca gönderilir.`],
  });
  return {
    baslik: 'CARİ HESAP MUTABAKAT MEKTUBU',
    altBaslik: `${k.cari.ad} · ${tarihYaz(m.tarih)} itibarıyla`,
    taraflar: [
      { rol: 'Gönderen', ad: k.firma.ad, satirlar: dolu([b.adres, (b.vergiDairesi || b.vergiNo) && `Vergi: ${dolu([b.vergiDairesi, b.vergiNo]).join(' / ')}`, b.telefon && `Tel: ${b.telefon}`]) },
      { rol: 'Sayın', ad: k.cari.ad, satirlar: dolu([k.cari.yetkili && `Yetkili: ${k.cari.yetkili}`, k.cari.adres, k.cari.vergiNo && `Vergi / TC no: ${k.cari.vergiNo}`, k.cari.telefon && `Tel: ${k.cari.telefon}`]) },
    ],
    maddeler,
    imzaTarihi: tarihYaz(m.gonderildi ?? m.tarih),
    imzalar: [
      { rol: k.firma.ad, ad: b.yetkili || '' },
      { rol: k.cari.ad, ad: 'Kaşe / imza' },
    ],
  };
}

/** WhatsApp kısa mesajı (PDF ayrıca paylaşılabilir). */
export function mutabakatMesaji(g: { cariAdi: string; firmaAdi: string; tarih: Tarih; bakiye: Kurus }): string {
  return [
    `Sayın ${g.cariAdi},`,
    `Kayıtlarımıza göre ${tarihYaz(g.tarih)} itibarıyla ${bakiyeMetni(g.bakiye)}.`,
    'Kayıtlarınızla mutabık mısınız? Değilseniz sizdeki bakiyeyi ve hesap dökümünüzü iletmenizi rica ederiz.',
    '',
    g.firmaAdi,
  ].join('\n');
}
