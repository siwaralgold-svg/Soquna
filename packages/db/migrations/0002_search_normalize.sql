-- Search normalisation for Arabic + English full-text search.
-- MUST stay identical to normalizeForSearch() in packages/domain/src/search.ts
-- (a test compares the two on the same inputs):
--   lower-case; Arabic-Indic digits → 0-9; أ إ آ ٱ → ا; ة → ه; ى → ي;
--   strip tashkeel and tatweel; non-letters → space; drop a leading "ال" (word stays ≥ 2 letters).
CREATE FUNCTION souqna_normalize(input text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
RETURN regexp_replace(
  trim(
    regexp_replace(
      regexp_replace(
        translate(lower(input), 'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', 'ااااهي01234567890123456789'),
        '[ً-ٰٟـ]', '', 'g'
      ),
      '[^0-9a-zء-ي]+', ' ', 'g'
    )
  ),
  '(^| )ال(\S{2,})', '\1\2', 'g'
);
