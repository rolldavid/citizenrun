-- MIG-M2-01: name keys for the filing matcher (L-name-key; D-078, D-291)
create function os_unaccent(text)
returns text
language sql
immutable strict parallel safe
return public.unaccent('public.unaccent'::regdictionary, $1);

create function os_name_key(first_name text, last_name text)
returns text
language sql
immutable parallel safe
return nullif(
  btrim(regexp_replace(
    regexp_replace(
      lower(os_unaccent(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))),
      '[^a-z0-9 ]', '', 'g'),
    ' +', ' ', 'g')),
  '');
