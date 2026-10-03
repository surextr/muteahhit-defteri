import type { SupabaseClient } from '@supabase/supabase-js';
import { maskele } from '../hesap/maskele';
import { IsKuraliHatasi } from '../servisler/kayitServisi';

// Bulut katmanı: yalnızca yapay zekâ ile sözleşme düzenleme için Supabase (e-posta + şifre girişi + Edge Function).
// Kayıtlar buluta gitmez. Kütüphane yalnızca bu özellik kullanılınca yüklenir.
// Publishable anahtar istemcide durmak için tasarlanmıştır; gizli değildir. Asıl anahtar Edge Function'dadır.

const SUPABASE_URL = 'https://ilmmmgrqygjlbbkeyxiy.supabase.co';
const SUPABASE_ANAHTARI = 'sb_publishable_7-zdUlf2pb-15gYJ1zb_Ig_sNdLbju-';
const FONKSIYON = 'sozlesme-duzenle';

let istemci: Promise<SupabaseClient> | null = null;

function supabase(): Promise<SupabaseClient> {
  istemci ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANAHTARI, {
      // Onay bağlantısının dönüşü (#access_token=…) onayDonusunuIsle'de karşılanır; sayfa yönlendirmesi bozulmasın.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'muteahhit-yz-oturum' },
    }),
  );
  return istemci;
}

/** Giriş yapılmışsa e-posta adresi. */
export async function yzOturumu(): Promise<string | null> {
  const { data } = await (await supabase()).auth.getSession();
  return data.session?.user.email ?? null;
}

export const EN_KISA_SIFRE = 8;

/**
 * Hesap açar. Supabase'de "Confirm email" açıksa oturum açılmaz, e-postaya onay bağlantısı gider:
 * dönüş 'onay_bekliyor'. Onay kapalıysa doğrudan giriş yapılır: 'giris_yapildi'.
 */
export async function yzKayitOl(eposta: string, sifre: string): Promise<'onay_bekliyor' | 'giris_yapildi'> {
  if (sifre.length < EN_KISA_SIFRE) throw new IsKuraliHatasi(`Şifre en az ${EN_KISA_SIFRE} karakter olmalı.`);
  const { data, error } = await (await supabase()).auth.signUp({
    email: eposta.trim(),
    password: sifre,
    // Onay bağlantısı uygulamanın bu adresine döner (Supabase'de Redirect URLs'e eklenmiş olmalı).
    options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
  });
  if (error) throw new IsKuraliHatasi(supabaseHatasi(error));
  // Adres zaten kayıtlıysa Supabase güvenlik için hata vermez, boş kimlik listesi döner.
  if (data.user && data.user.identities?.length === 0) throw new IsKuraliHatasi('Bu e-posta ile zaten hesap var; "Giriş yap"ı kullanın.');
  return data.session ? 'giris_yapildi' : 'onay_bekliyor';
}

export async function yzGirisYap(eposta: string, sifre: string): Promise<void> {
  const { error } = await (await supabase()).auth.signInWithPassword({ email: eposta.trim(), password: sifre });
  if (error) throw new IsKuraliHatasi(supabaseHatasi(error));
}

function supabaseHatasi(e: { message: string; status?: number; code?: string }): string {
  if (e.code === 'email_not_confirmed' || /not confirmed/i.test(e.message)) return 'E-posta adresiniz henüz onaylanmadı; e-postanızdaki onay bağlantısına tıklayın.';
  if (e.code === 'invalid_credentials' || /invalid login/i.test(e.message)) return 'E-posta ya da şifre hatalı.';
  if (e.code === 'weak_password' || /password/i.test(e.message)) return `Şifre kabul edilmedi: en az ${EN_KISA_SIFRE} karakter kullanın.`;
  if (e.status === 429 || e.code === 'over_email_send_rate_limit') return 'Çok sık deneme yapıldı; biraz bekleyip yeniden deneyin.';
  if (e.code === 'email_address_invalid' || /email/i.test(e.message)) return 'E-posta adresi geçerli görünmüyor.';
  return `İşlem yapılamadı: ${e.message}`;
}

/**
 * E-postadaki onay bağlantısı uygulamaya "#access_token=…" ya da "#error=…" ile döner. Uygulama açılırken bir kez
 * çağrılır: adres Ayarlar'a çevrilir, sonuç Ayarlar'daki kartta gösterilsin diye oturum deposuna yazılır.
 */
export function onayDonusunuIsle(): void {
  const h = window.location.hash;
  if (!/^#(access_token|error)=/.test(h)) return;
  const p = new URLSearchParams(h.slice(1));
  const sonuc = p.get('error') ? 'hata' : 'onaylandi';
  try {
    sessionStorage.setItem('yz-onay', sonuc);
  } catch {
    // Oturum deposu kapalıysa uyarı gösterilmez; giriş yine çalışır.
  }
  history.replaceState(null, '', `${window.location.pathname}#/ayarlar`);
}

/** onayDonusunuIsle'nin bıraktığı sonuç (bir kez okunur). */
export function onayDonusuOku(): 'onaylandi' | 'hata' | null {
  try {
    const s = sessionStorage.getItem('yz-onay');
    sessionStorage.removeItem('yz-onay');
    return s === 'onaylandi' || s === 'hata' ? s : null;
  } catch {
    return null;
  }
}

export async function yzCikis(): Promise<void> {
  await (await supabase()).auth.signOut();
}

export interface DuzenlemeSonucu {
  duzenlenmis: string;
  sorular: string[];
  kalanHak: number;
}

/**
 * Özel şartları düzenletir. Gönderilen: usta tipinin adı ve maskelenmiş metin (telefon, TC/VKN, IBAN, e-posta yok).
 * İnternet yoksa ya da giriş yapılmamışsa hata verir; ekran şablonla devam eder.
 */
export async function ozelSartlariDuzenle(ustaTipi: string, metin: string): Promise<DuzenlemeSonucu> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new IsKuraliHatasi('İnternet yok; şablonla devam edin.');
  const sb = await supabase();
  const { data: oturum } = await sb.auth.getSession();
  if (!oturum.session) throw new IsKuraliHatasi("Yapay zekâ için önce Ayarlar'dan giriş yapın.");
  const { data, error } = await sb.functions.invoke<DuzenlemeSonucu>(FONKSIYON, { body: { ustaTipi, metin: maskele(metin).metin } });
  if (error) {
    // Fonksiyonun döndürdüğü Türkçe hata metni yanıt gövdesindedir.
    const govde = (error as { context?: Response }).context;
    const mesaj = govde ? ((await govde.json().catch(() => null)) as { hata?: string } | null)?.hata : null;
    throw new IsKuraliHatasi(mesaj ?? 'Yapay zekâya ulaşılamadı; şablonla devam edin.');
  }
  return data!;
}
