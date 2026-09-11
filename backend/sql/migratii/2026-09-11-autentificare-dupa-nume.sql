/*
  Autentificare după nume.

  Se intră în aplicație cu „Irina”, nu cu o adresă de e-mail (v. `routes/auth.ts`,
  POST /login, care caută pe `lower(email)` SAU pe `lower(btrim(nume))`). Ca
  întrebarea „cine e Irina?” să aibă un singur răspuns, numele trebuie să fie
  unic — altfel contul ales ar fi depins de ordinea rândurilor din tabelă.

  Fișierul repetă, cuvânt cu cuvânt, indexul adăugat în `sql/01_schema.sql`.
  Schema completă se aplică pe o bază goală; aici se aplică pe una vie.

  ATENȚIE: dacă în bază există deja două conturi cu același nume, crearea
  indexului eșuează — intenționat. Redenumiți-le întâi; a le lăsa așa ar
  însemna un cont în care nu se poate intra niciodată.
*/
BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS utilizator_nume_uk ON utilizator (lower(btrim(nume)));

COMMIT;
