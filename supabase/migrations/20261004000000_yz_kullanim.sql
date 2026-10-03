-- Yapay zekâ ile sözleşme düzenleme: kullanıcı başına günlük kullanım sayacı.
-- Sayaç yalnızca aşağıdaki fonksiyonlarla değişir; tabloya doğrudan yazma izni yoktur (RLS).
-- Gün, Türkiye saatine göre sayılır.

create table if not exists public.yz_kullanim (
  kullanici_id uuid not null references auth.users (id) on delete cascade,
  gun date not null,
  sayi integer not null default 0,
  primary key (kullanici_id, gun)
);

alter table public.yz_kullanim enable row level security;

drop policy if exists "kendi kullanımını okur" on public.yz_kullanim;
create policy "kendi kullanımını okur" on public.yz_kullanim
  for select to authenticated using (auth.uid() = kullanici_id);

-- Bir hak kullanır; sınır aşılırsa 'gunluk_sinir' hatası verir (sayaç artmaz). Dönüş: kalan hak.
create or replace function public.yz_hakki_kullan(sinir integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gun date := (now() at time zone 'Europe/Istanbul')::date;
  v_sayi integer;
begin
  if auth.uid() is null then
    raise exception 'giris_gerekli';
  end if;
  insert into yz_kullanim (kullanici_id, gun, sayi)
  values (auth.uid(), v_gun, 1)
  on conflict (kullanici_id, gun) do update set sayi = yz_kullanim.sayi + 1
  returning sayi into v_sayi;
  if v_sayi > sinir then
    raise exception 'gunluk_sinir';
  end if;
  return sinir - v_sayi;
end;
$$;

-- Yapay zekâ çağrısı başarısız olursa kullanılan hak geri verilir.
create or replace function public.yz_hakki_iade()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update yz_kullanim
  set sayi = greatest(sayi - 1, 0)
  where kullanici_id = auth.uid() and gun = (now() at time zone 'Europe/Istanbul')::date;
end;
$$;

revoke all on function public.yz_hakki_kullan(integer) from public, anon;
revoke all on function public.yz_hakki_iade() from public, anon;
grant execute on function public.yz_hakki_kullan(integer) to authenticated;
grant execute on function public.yz_hakki_iade() to authenticated;
