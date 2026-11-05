-- Bucket novo no ambiente de testes. Sem políticas de escrita anônima.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 values('colaboradores','colaboradores',true,2097152,array['image/jpeg','image/png','image/webp'])
on conflict(id) do nothing;
