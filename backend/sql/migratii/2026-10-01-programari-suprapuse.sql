-- 2026-10-01 — aceeași persoană poate avea mai multe programări la aceeași oră.
--
-- Cerința clinicii: o clientă stă cu vopseaua la uscat, alta intră pe scaun.
-- `programare_fara_suprapunere` refuza a doua programare; acum grila le așază
-- una lângă alta. Idempotentă.
--
-- Rulează ca rolul `clinica` (proprietarul tabelelor).

ALTER TABLE programare DROP CONSTRAINT IF EXISTS programare_fara_suprapunere;
