import type { AyarDegeri, Tarih } from '../veri/tipler';

/**
 * Verilen tarihte geçerli olan ayar değeri: o tarihte veya öncesinde başlayanların en yenisi.
 * Böylece yeni asgari ücret/SGK oranı girildiğinde eski kayıtların hesabı değişmez.
 */
export function gecerliAyarDegeri(
  ayarlar: AyarDegeri[],
  anahtar: string,
  tarih: Tarih,
): AyarDegeri | undefined {
  let sonuc: AyarDegeri | undefined;
  for (const a of ayarlar) {
    if (a.iptal !== null || a.anahtar !== anahtar || a.gecerlilikBaslangici > tarih) continue;
    if (!sonuc || a.gecerlilikBaslangici > sonuc.gecerlilikBaslangici) sonuc = a;
  }
  return sonuc;
}
