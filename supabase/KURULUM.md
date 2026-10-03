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

## 4. E-posta + şifre girişi

E-posta şablonu değiştirmek gerekmez; varsayılan "Confirm signup" e-postası onay bağlantısı gönderir.

1. **Authentication** → **Sign In / Providers** → **Email**:
   - **Enable Email provider**: açık.
   - **Confirm email**: açık (kayıttan sonra e-postadaki bağlantıya tıklanır).
   - **Minimum password length**: `8` (uygulama da en az 8 ister).
   - **Save**.
2. **Authentication** → **URL Configuration**:
   - **Site URL**: `https://surextr.github.io/muteahhit-defteri/`
   - **Redirect URLs** → **Add URL**: `https://surextr.github.io/muteahhit-defteri/` ve bilgisayarda denemek için
     `http://localhost:5173/` → **Save**.

Önemli: Supabase'in kendi e-posta servisi (özel SMTP yokken) yalnızca **projenin ekip üyelerinin** adreslerine e-posta
gönderir ve saatte birkaç e-postayla sınırlıdır. Kendi e-postanızla kayıt olup denemeye yeter. Başka kişiler de
kullanacaksa ya özel SMTP bağlayın ya da **Confirm email**'i kapatın (o zaman kayıt olunca doğrudan giriş yapılır).

## Komut satırıyla (isteğe bağlı, paneldeki 1–3 yerine)

```
npx supabase login
npx supabase link --project-ref ilmmmgrqygjlbbkeyxiy
npx supabase db push
npx supabase secrets set ANTHROPIC_API_KEY=...
npx supabase functions deploy sozlesme-duzenle
```

## Deneme

Uygulama → **Ayarlar** → **Yapay zekâ ile sözleşme düzenleme** → **Kayıt ol** (e-posta, şifre) → e-postadaki onay
bağlantısına tıklayın (uygulama Ayarlar'da açılır) → **Giriş yap** → **Dene**: usta tipi seçin, özel şartları yazın, **Yapay zekâyla düzenle**.
