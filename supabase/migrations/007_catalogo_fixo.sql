-- Inserir somente se faltarem. Valores existentes nunca são recalculados ou sobrescritos.
insert into public.cortes_catalogo(codigo,nome,preco_venda_kg) values
 ('00000','QUEBRA',0),('93960','SEBO E OSSO',0.20)
on conflict(codigo) do nothing;
