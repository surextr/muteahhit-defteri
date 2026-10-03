# Yapay zekâ ile sözleşme düzenleme — Supabase kurulumu

Proje: `https://ilmmmgrqygjlbbkeyxiy.supabase.co`. Panel: https://supabase.com/dashboard → projeyi açın.
Uygulamadaki publishable anahtar `src/bulut/yapayZeka.ts` içinde; Anthropic anahtarı yalnızca Supabase'de gizli ayardır.

## 1. Kullanım sayacı tablosu (SQL)

1. Sol menü **SQL Editor** → **New query**.
2. `supabase/migrations/20261004000000_yz_kullanim.sql` dosyasının tamamını yapıştırın.
3. **Run**. Beklenen: "Success. No rows returned".

## 2. Gizli ayarlar

1. Sol menü **Edge Functions** → **Secrets**.
2. **Add new secret**: Name `ANTHROPIC_API_KEY`, Value: Anthropic anahtarınız → **Save**.
3. (İsteğe bağlı) `YZ_GUNLUK_SINIR` = `20` (kullanıcı başına günlük düzenleme), `YZ_MODEL` = `claude-opus-5-5`.

## 3. Edge Function

1. **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Ad tam olarak: `sozlesme-duzenle`.
3. Örnek kodu silin; `supabase/functions/sozlesme-duzenle/index.ts` dosyasının tamamını yapıştırın.
4. **Deploy function**. Fonksiyonun ayarlarında **Verify JWT** açık kalsın.

## 4. E-posta ile kod girişi

1. **Authentication** → **Sign In / Providers** → **Email** açık olsun.
2. **Authentication** → **Emails** → **Templates**:
   - **Magic Link** şablonunu açın; konu: `Müteahhit Defteri giriş kodu`; gövde:
     ```html
     <p>Giriş kodunuz: <strong>{{ .Token }}</strong></p>
     <p>Bu kodu uygulamadaki "E-postadaki kod" alanına yazın. Siz istemediyseniz bu e-postayı yok sayın.</p>
     ```
   - **Confirm signup** şablonuna da aynı gövdeyi yazın (ilk girişte bu şablon gider).
   - **Save**.
3. **Authentication** → **URL Configuration** → **Site URL**: `https://surextr.github.io/muteahhit-defteri/`.

Not: Supabase'in kendi e-posta servisi saatte birkaç e-posta gönderir; denemeye yeter. Çok kullanıcıda
**Authentication → Emails → SMTP Settings** ile kendi e-posta servisinizi bağlayın.

## Komut satırıyla (isteğe bağlı, paneldeki 1–3 yerine)

```
npx supabase login
npx supabase link --project-ref ilmmmgrqygjlbbkeyxiy
npx supabase db push
npx supabase secrets set ANTHROPIC_API_KEY=...
npx supabase functions deploy sozlesme-duzenle
```

## Deneme

Uygulama → **Ayarlar** → **Yapay zekâ ile sözleşme düzenleme** → e-posta → **Kod gönder** → koddaki rakamlar →
**Giriş yap** → **Dene**: usta tipi seçin, özel şartları yazın, **Yapay zekâyla düzenle**.
