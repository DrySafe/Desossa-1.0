-- ============================================================
-- MIGRAÇÃO — Storage pra fotos de colaboradores
-- ============================================================
-- Rode no SQL Editor do Supabase.
-- ============================================================

insert into storage.buckets (id, name, public)
values ('colaboradores', 'colaboradores', true)
on conflict (id) do nothing;

-- Leitura pública (as fotos aparecem na tela de login sem precisar de autenticação)
drop policy if exists "Leitura publica fotos colaboradores" on storage.objects;
create policy "Leitura publica fotos colaboradores"
  on storage.objects for select
  using (bucket_id = 'colaboradores');

-- Upload (o app grava direto com a chave anon, igual faz com as outras tabelas)
drop policy if exists "Upload fotos colaboradores" on storage.objects;
create policy "Upload fotos colaboradores"
  on storage.objects for insert
  with check (bucket_id = 'colaboradores');

-- Substituir foto (reenviar com o mesmo nome de arquivo, ao editar)
drop policy if exists "Atualizar fotos colaboradores" on storage.objects;
create policy "Atualizar fotos colaboradores"
  on storage.objects for update
  using (bucket_id = 'colaboradores');

drop policy if exists "Apagar fotos colaboradores" on storage.objects;
create policy "Apagar fotos colaboradores"
  on storage.objects for delete
  using (bucket_id = 'colaboradores');
