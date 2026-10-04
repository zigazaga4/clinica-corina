/*
  Produsele clinicii, din cele două liste de prețuri trimise pe 4 oct. 2026:

    „Lista de preturi 2023.doc”  -> categoria „Produse colaboratori” (64 produse)
    „Produse clienti.doc”        -> categoria „Produse clienți”      (40 produse)

  Aceeași cremă apare pe amândouă liste, cu prețuri diferite, deci intră de două
  ori în nomenclator — o dată pe fiecare listă, cu prețul ei. Peelingurile
  Mandelic, Esoyal/ESOPURE/ESOSHINE/ESOGLICO și crema conductivă Ultra Power
  Tech sunt doar pe lista colaboratorilor.

  Denumirile sunt cele din documente; s-au îndreptat doar spațiile duble, „10ml”
  -> „10 ml” și liniuța de la „Mix de uleiuri esențiale”. Cantitatea din coloana
  „Cantitate ml” s-a lipit la sfârșitul denumirii („… 250 ml”): fără ea, crema de
  250 ml și cea de 50 ml s-ar fi numit la fel. Unde denumirea spune deja
  ambalajul („12 flacoane x 10 ml”), nu s-a mai adăugat nimic.

  O singură abatere de la documente: „Demachiant bifazic” pe lista clienților
  apare cu 15 RON, față de 110 RON la colaboratori — o cifră lipsă. S-a pus
  150 RON, confirmat pe 4 oct. 2026.

  Cere migrația 2026-10-04-categorii-produse.sql (coloana `articol.categorie`).

  Se poate rula de câte ori vrei: un produs care există deja în aceeași
  categorie, cu aceeași denumire, nu se mai adaugă și nu se atinge (nici prețul
  lui, dacă între timp l-a schimbat cineva din Nomenclator). Fiecare rând nou
  lasă o urmă în jurnal, fără autor — l-a scris importul, nu un cont.
*/

BEGIN;

WITH lista (ordine, denumire, pret_colaboratori, pret_clienti) AS (VALUES
  ( 1, 'Orange blue Concentrate active cu acțiune antirid și antoxidant 120 ml', 25, 35),

  ( 2, 'Botox like Cremă Botox 250 ml', 185, 290),
  ( 3, 'Botox like Mască Botox-Like 250 ml', 185, 290),
  ( 4, 'Botox like Concentrate active cu acțiune Botox-Like 12 flacoane x 10 ml', 25, 35),
  ( 5, 'Botox like Cremă Botox-Like 50 ml', 150, 220),
  ( 6, 'Botox like Ser Botox-Like 30 ml', 175, 210),

  ( 7, 'New skin Cremă revitalizantă și iluminantă 250 ml', 180, 290),
  ( 8, 'New skin Mască revitalizantă și iluminantă/Revitalizing Illuminating Mask 250 ml', 180, 290),
  ( 9, 'New skin Concentrate active cu acțiune revitalizantă și iluminantă 12 flacoane x 10 ml', 25, 35),
  (10, 'New skin Cremă revitalizantă și iluminantă 50 ml', 150, 220),
  (11, 'New skin Ser revitalizant și iluminant 30 ml', 175, 210),

  (12, 'Antiage Cremă anti-îmbătrânire, oxigenare și regenerare celulară 250 ml', 190, 290),
  (13, 'Antiage Mască anti-îmbătrânire, oxigenare și regenerare celulară 250 ml', 190, 290),
  (14, 'Antiage Concentrate active cu acțiune anti-îmbătrânire, oxigenare și regenerare celulară 12 flacoane x 10 ml', 25, 35),
  (15, 'Antiage Cremă anti-îmbătrânire, oxigenare și regenerare celulară 50 ml', 150, 220),
  (16, 'Antiage Ser anti-îmbătrânire, oxigenare și regenerare celulară 30 ml', 175, 210),

  (17, 'Extra Energy Lapte demachiant intens hidratant și vitaminizant/Super Moisturizing Cleansing Milk 400 ml', 145, 189),
  (18, 'Extra Energy Loțiune tonică intens hidratantă și vitaminizantă/Super Moisturizing Tonic Lotion 400 ml', 145, 189),

  (19, 'Sensitive skin cremă calmantă, protectoare și decongestionantă 250 ml', 170, 290),
  (20, 'Sensitive skin mască calmantă, protectoare și decongestionantă 250 ml', 170, 290),
  (21, 'Sensitive skin concentrate active cu acțiune calmantă și protectoare 12 flacoane x 10 ml', 35, 45),
  (22, 'Sensitive skin cremă calmantă, protectoare și decongestionantă 50 ml', 150, 220),

  (23, 'Oily skin Cremă purifiantă 250 ml', 180, 290),
  (24, 'Oily skin Mască cu argilă sebo-reglatoare 250 ml', 180, 290),
  (25, 'Oily skin Concentrate active cu acțiune sebo-reglatoare opacifiante 12 flacoane x 10 ml', 25, 35),
  (26, 'Oily skin Cremă purifiantă 50 ml', 150, 220),

  (27, 'Ser iluminator contra petelor 30 ml', 145, 210),
  (28, 'Cremă contur ochi cu aur și colagen/Eye Contour Cream with Gold and Collagen 50 ml', 140, 190),

  (29, 'Over Boost Concentrate cu acțiune revitalizantă cu acid hialuronic 12 flacoane x 10 ml', 30, 35),
  (30, 'Over Boost Concentrate cu acțiune intens hidratantă cu colagen 12 flacoane x 10 ml', 30, 35),
  (31, 'Over Boost Măști revitalizante cu acid hialuronic 10 buc x 35 ml', 35, 50),
  (32, 'Over Boost Măști intens hidratante cu colagen 10 buc x 35 ml', 35, 50),

  (33, 'Demachiant bifazic pentru piele normală și mixtă 200 ml', 110, 150),
  (34, 'Scrub/Exfoliant purifiant cu microgranule din caise și ulei de migdale dulci 250 ml', 145, 189),

  (35, 'Mandelic Peeling Stop 400 ml', 195, NULL),
  (36, 'Mandelic Pre Peeling 400 ml', 195, NULL),
  (37, 'Mandelic Peeling illuminator pentru acnee și riduri cu Acid Mandelic soluție 50% 30 ml', 195, NULL),
  (38, 'Mandelic Peeling exfoliant anti-pete cu Acid Mandelic si Acid Azelaic – soluție 50% 30 ml', 195, NULL),
  (39, 'Mandelic Mască exfoliantă anti-pete cu Acid Mandelic și Acid Azelaic 250 ml', 195, NULL),
  (40, 'Mandelic Cremă reechilibrantă și neutralizantă 250 ml', 215, NULL),

  (41, 'Ultra Power Tech Cremă conductivă pentru aparatura electro-estetică 500 ml', 190, NULL),

  (42, 'Perfect epi Ulei calmant după epilare - Perfect Epil 500 ml', 179, 200),
  (43, 'Perfect epi Emulsie emolientă după epilare 500 ml', 179, 200),

  (44, 'Mix de uleiuri esențiale – Celulită 30 ml', 155, 185),
  (45, 'Mix de uleiuri esențiale – Drenaj 30 ml', 155, 185),

  (46, 'Cremă cu protecție solară pentru față SPF 50+ – cu activator pentru melanină 50 ml', 90, 110),
  (47, 'Rigenera Ser concentrate cu vitamina C 30 ml', 185, 210),

  (48, 'Esoyal Peeling 30 ml', 210, NULL),
  (49, 'Esoyal Modulator 100 ml', 180, NULL),
  (50, 'Esoyal Crema Activator 250 ml', 220, NULL),
  (51, 'Esoyal Ser cu acid 30 ml', 230, NULL),
  (52, 'Esoacid Pre-peeling preparator 500 ml', 189, NULL),
  (53, 'ESOPURE Peeling 30 ml', 210, NULL),
  (54, 'ESOPURE Modulator 100 ml', 180, NULL),
  (55, 'ESOPURE Crema Activator 250 ml', 220, NULL),
  (56, 'ESOPURE Ser cu Acid 30 ml', 230, NULL),
  (57, 'ESOSHINE Peeling 30 ml', 210, NULL),
  (58, 'ESOSHINE Modulator 100 ml', 180, NULL),
  (59, 'ESOSHINE Crema Activator 250 ml', 220, NULL),
  (60, 'ESOSHINE Ser cu Acid 30 ml', 230, NULL),
  (61, 'ESOGLICO Peeling 30 ml', 210, NULL),
  (62, 'ESOGLICO Modulator 100 ml', 180, NULL),
  (63, 'ESOGLICO Crema Activator 250 ml', 220, NULL),
  (64, 'ESOGLICO Ser cu Acid 30 ml', 230, NULL)
),
de_pus AS (
  SELECT 'Produse colaboratori' AS categorie, ordine, denumire, pret_colaboratori AS pret FROM lista
  UNION ALL
  SELECT 'Produse clienți', ordine, denumire, pret_clienti FROM lista WHERE pret_clienti IS NOT NULL
),
noi AS (
  INSERT INTO articol (tip, denumire, durata_minute, pret_lista, activ, numar_sedinte, categorie)
  SELECT 'produs', d.denumire, NULL, d.pret, true, 1, d.categorie
  FROM de_pus d
  WHERE NOT EXISTS (
    SELECT 1 FROM articol a
    WHERE a.tip = 'produs'
      AND lower(a.categorie) = lower(d.categorie)
      AND lower(btrim(a.denumire)) = lower(d.denumire)
  )
  ORDER BY d.categorie, d.ordine
  RETURNING *
)
INSERT INTO jurnal_operatiuni (utilizator_id, actiune, entitate, entitate_id, date_noi)
SELECT NULL, 'creare', 'articol', noi.id, to_jsonb(noi) - 'actualizat_la'
FROM noi;

SELECT categorie, count(*) AS produse
FROM articol
WHERE tip = 'produs' AND categorie IN ('Produse colaboratori', 'Produse clienți')
GROUP BY categorie
ORDER BY categorie;

COMMIT;
