import type { SupabaseClient } from '@supabase/supabase-js';
import { maskele } from '../hesap/maskele';

// Bulut katmanı: yalnızca yapay zekâ ile sözleşme düzenleme için Supabase (e-posta ile kodla giriş + Edge Function).
// Kayıtlar buluta gitmez. Kütüphane yalnızca bu özellik kullanılınca yüklenir.
// Publishable anahtar istemcide durmak için tasarlanmıştır; gizli değildir. Asıl anahtar Edge Function'dadır.

const SUPABASE_URL = 'https://ilmmmgrqygjlbbkeyxiy.supabase.co';
const SUPABASE_ANAHTARI = 'sb_publishable_7-zdUlf2pb-15gYJ1zb_Ig_sNdLbju-';
const FONKSIYON = 'sozlesme-duzenle';

let istemci: Promise<SupabaseClient> | null = null;

function supabase(): Promise<SupabaseClient> {
  istemci ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(SUPABASE_URL, SUPABASE_ANAHTARI, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'muteahhit-yz-oturum' } }),
  );
  return istemci;
}

/** Giriş yapılmışsa e-posta adresi. */
export async function yzOturumu(): Promise<string | null> {
  const { data } = await (await supabase()).auth.getSession();
  return data.session?.user.email ?? null;
}

/** E-postaya giriş kodu gönderir (hesap yoksa açılır). */
export async function girisKoduGonder(eposta: string): Promise<void> {
  const { error } = await (await supabase()).auth.signInWithOtp({ email: eposta.trim(), options: { shouldCreateUser: true } });
  if (error) throw new Error(error.status === 429 ? 'Çok sık kod istendi; biraz bekleyip yeniden deneyin.' : `Kod gönderilemedi: ${error.message}`);
}

export async function girisKoduDogrula(eposta: string, kod: string): Promise<void> {
  const { error } = await (await supabase()).auth.verifyOtp({ email: eposta.trim(), token: kod.replace(/\s/g, ''), type: 'email' });
  if (error) throw new Error('Kod hatalı ya da süresi geçmiş.');
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
  if (typeof navigator !== 'undefined' && !navigator.onLine) throw new Error('İnternet yok; şablonla devam edin.');
  const sb = await supabase();
  const { data: oturum } = await sb.auth.getSession();
  if (!oturum.session) throw new Error('Yapay zekâ için önce e-posta ile giriş yapın (Ayarlar).');
  const { data, error } = await sb.functions.invoke<DuzenlemeSonucu>(FONKSIYON, { body: { ustaTipi, metin: maskele(metin).metin } });
  if (error) {
    // Fonksiyonun döndürdüğü Türkçe hata metni yanıt gövdesindedir.
    const govde = (error as { context?: Response }).context;
    const mesaj = govde ? ((await govde.json().catch(() => null)) as { hata?: string } | null)?.hata : null;
    throw new Error(mesaj ?? 'Yapay zekâya ulaşılamadı; şablonla devam edin.');
  }
  return data!;
}
