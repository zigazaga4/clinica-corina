/*
  Notele de pe fișa clientului se pot modifica.

  Cerut de clinică (2026-10-01). Până acum erau imuabile — o corectură se
  scria ca notă nouă. Acum textul se schimbă pe loc; textul vechi rămâne în
  jurnal (date_vechi), deci firul se poate reconstitui oricând.

  `modificat_la` = momentul ultimei modificări; NULL = nemodificată.

  Se poate rula de câte ori vrei. Se rulează cu rolul `clinica`.
*/

ALTER TABLE nota_client ADD COLUMN IF NOT EXISTS modificat_la timestamptz;
