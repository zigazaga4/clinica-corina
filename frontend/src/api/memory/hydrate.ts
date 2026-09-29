/**
 * Proiecțiile compuse — echivalentul JOIN-urilor pe care le face serverul.
 *
 * Interfața primește programarea deja însoțită de numele clientului, al
 * serviciului și al executantului. Fără asta, fiecare celulă de calendar ar
 * declanșa trei cereri, iar o săptămână cu optzeci de programări ar face
 * două sute patruzeci.
 *
 * Numele lipsă nu aruncă eroare: cheile cu ON DELETE SET NULL chiar pot indica
 * spre nimic, iar o listă care crapă pentru că un cont a fost șters este mai
 * rea decât una care afișează „—”.
 */

import type {
  Client,
  ClientListItem,
  ConsimtamantDetaliu,
  JurnalOperatiune,
  JurnalOperatiuneDetaliu,
  NotaClient,
  NotaClientDetaliu,
  Notita,
  NotitaDetaliu,
  Programare,
  ProgramareDetaliu,
  Tratament,
  TratamentDetaliu,
  Utilizator,
  Uuid,
  Vanzare,
  VanzareDetaliu,
  VanzareLinieDetaliu,
} from '@/domain/types'
import { rotunjeste, sumaTotal } from '@/lib/money'
import { magazin, type RandConsimtamant, type RandUtilizator } from './store'

/** Elimină `parola_hash` — coloana nu părăsește niciodată serverul. */
export function utilizatorPublic(rand: RandUtilizator): Utilizator {
  const { parola_hash: _ascuns, ...public_ } = rand
  return public_
}

const numeUtilizator = (id: Uuid | null): string | null =>
  id === null ? null : (magazin.utilizator.get(id)?.nume ?? null)

/**
 * Încasarea care a stins o programare, dacă există.
 *
 * Pe server este un `JOIN vanzare_linie ... JOIN vanzare` filtrat pe
 * `programare_id`, servit de un index. Aici este o scanare — la volumul datelor
 * demo (sute de linii) costul nu se simte, iar rezultatul este identic.
 *
 * Întoarce încasarea întreagă, nu doar identificatorul ei: apelanții care voiau
 * doar „s-a achitat?” compară tot cu `null`, iar cel care are nevoie de data
 * plății o are fără o a doua căutare.
 */
export function incasareaProgramarii(programare_id: Uuid): Vanzare | null {
  for (const l of magazin.vanzare_linie.values()) {
    if (l.programare_id === programare_id) return magazin.vanzare.get(l.vanzare_id) ?? null
  }
  return null
}

/** Ședința ocupă un loc în tratament — și ia bani — doar programată sau onorată. */
const conteaza = (p: Programare): boolean => p.stare === 'programat' || p.stare === 'onorat'

/**
 * Ședințele unui tratament, în ordinea din calendar.
 *
 * Ordinea este `(incepe_la, id)`, ca pe server: două ședințe la aceeași oră —
 * o greșeală, dar posibilă la persoane diferite — trebuie totuși să primească
 * același „ședința 3 din 8” la fiecare citire.
 */
export function sedinteleTratamentului(tratament_id: Uuid): Programare[] {
  const randuri: Programare[] = []
  for (const p of magazin.programare.values()) {
    if (p.tratament_id === tratament_id) randuri.push(p)
  }
  randuri.sort((a, b) => a.incepe_la.localeCompare(b.incepe_la) || a.id.localeCompare(b.id))
  return randuri
}

export function hidrateazaProgramare(p: Programare): ProgramareDetaliu {
  const client = magazin.client.get(p.client_id)
  const articol = magazin.articol.get(p.articol_id)
  const executant = magazin.utilizator.get(p.executant_id)
  const punct = magazin.punct_lucru.get(p.punct_lucru_id)
  const incasare = incasareaProgramarii(p.id)
  const tratament = p.tratament_id === null ? null : (magazin.tratament.get(p.tratament_id) ?? null)

  // „Ședința 3 din 8”: poziția între ședințele care contează, până la ea inclusiv.
  let sedinta_nr: number | null = null
  if (tratament && conteaza(p)) {
    sedinta_nr = sedinteleTratamentului(tratament.id)
      .filter(conteaza)
      .findIndex((q) => q.id === p.id) + 1
  }

  return {
    ...p,
    client_nume: client?.nume ?? '—',
    client_telefon: client?.telefon ?? null,
    articol_denumire: articol?.denumire ?? '—',
    articol_durata_minute: articol?.durata_minute ?? null,
    executant_nume: executant?.nume ?? '—',
    punct_lucru_denumire: punct?.denumire ?? '—',
    achitat: incasare !== null,
    vanzare_id: incasare?.id ?? null,
    achitat_la: incasare?.efectuat_la ?? null,
    tratament_numar_sedinte: tratament?.numar_sedinte ?? null,
    sedinta_nr,
  }
}

/**
 * `v_tratament_detaliu`: tot ce se numără din ședințe, la fiecare citire.
 *
 * Aceeași împărțire ca pe server: restul neplanificat din `pret_total`, la
 * ședințele rămase, rotunjit la ban și niciodată sub zero. Ultima ședință ia
 * exact ce a rămas, deci suma părților dă totalul convenit.
 */
export function hidrateazaTratament(t: Tratament): TratamentDetaliu {
  const client = magazin.client.get(t.client_id)
  const articol = magazin.articol.get(t.articol_id)

  let sedinte_programate = 0
  let sedinte_onorate = 0
  const alocate: number[] = []
  const incasate: number[] = []
  const restante: number[] = []
  let urmatoarea_la: string | null = null
  let ultima_la: string | null = null

  for (const p of sedinteleTratamentului(t.id)) {
    if (p.stare === 'programat') {
      sedinte_programate++
      alocate.push(p.pret)
      if (urmatoarea_la === null || p.incepe_la < urmatoarea_la) urmatoarea_la = p.incepe_la
    } else if (p.stare === 'onorat') {
      sedinte_onorate++
      alocate.push(p.pret)
      if (incasareaProgramarii(p.id) !== null) incasate.push(p.pret)
      else restante.push(p.pret)
      if (ultima_la === null || p.incepe_la > ultima_la) ultima_la = p.incepe_la
    }
  }

  const alocat = sumaTotal(alocate)
  const sedinte_ramase = Math.max(t.numar_sedinte - sedinte_programate - sedinte_onorate, 0)
  const pret_urmatoarea =
    sedinte_ramase === 0 ? 0 : Math.max(rotunjeste((t.pret_total - alocat) / sedinte_ramase), 0)

  return {
    ...t,
    client_nume: client?.nume ?? '—',
    client_telefon: client?.telefon ?? null,
    articol_denumire: articol?.denumire ?? '—',
    articol_durata_minute: articol?.durata_minute ?? null,
    sedinte_programate,
    sedinte_onorate,
    sedinte_ramase,
    alocat,
    incasat: sumaTotal(incasate),
    de_incasat: sumaTotal(restante),
    pret_urmatoarea,
    urmatoarea_la,
    ultima_la,
  }
}

export function liniiVanzare(vanzare_id: Uuid): VanzareLinieDetaliu[] {
  const linii: VanzareLinieDetaliu[] = []
  for (const l of magazin.vanzare_linie.values()) {
    if (l.vanzare_id !== vanzare_id) continue
    const articol = magazin.articol.get(l.articol_id)
    const programare = l.programare_id === null ? null : magazin.programare.get(l.programare_id)
    linii.push({
      ...l,
      articol_denumire: articol?.denumire ?? '—',
      articol_tip: articol?.tip ?? 'produs',
      programare_incepe_la: programare?.incepe_la ?? null,
    })
  }
  return linii
}

/** Ședințele onorate și încă neîncasate ale unui client. */
export function programariDeIncasat(client_id: Uuid): Programare[] {
  const randuri: Programare[] = []
  for (const p of magazin.programare.values()) {
    if (p.client_id !== client_id) continue
    if (p.stare !== 'onorat') continue
    if (incasareaProgramarii(p.id) !== null) continue
    randuri.push(p)
  }
  randuri.sort((a, b) => a.incepe_la.localeCompare(b.incepe_la))
  return randuri
}

export function hidrateazaVanzare(v: Vanzare): VanzareDetaliu {
  const linii = liniiVanzare(v.id)
  return {
    ...v,
    client_nume: magazin.client.get(v.client_id)?.nume ?? '—',
    punct_lucru_denumire: magazin.punct_lucru.get(v.punct_lucru_id)?.denumire ?? '—',
    operator_nume: magazin.utilizator.get(v.operator_id)?.nume ?? '—',
    achitat: v.achitat_la !== null,
    linii,
    total: sumaTotal(linii.map((l) => l.total_linie)),
  }
}

export function hidrateazaNota(n: NotaClient): NotaClientDetaliu {
  return { ...n, autor_nume: numeUtilizator(n.autor_id) }
}

/** `v_notita_detaliu`: numele persoanei rămâne NULL la notițele întregii clinici. */
export function hidrateazaNotita(n: Notita): NotitaDetaliu {
  return {
    ...n,
    executant_nume: numeUtilizator(n.executant_id),
    creat_de_nume: numeUtilizator(n.creat_de),
  }
}

/**
 * Acordul, fără PDF — exact ce întoarce vederea `v_consimtamant_detaliu`.
 *
 * Documentul se scoate aici, nu la apelant: dacă ar depinde de fiecare loc care
 * citește un acord, ar fi de ajuns o singură uitare ca un PDF întreg să plece
 * într-o listă.
 */
export function hidrateazaConsimtamant(c: RandConsimtamant): ConsimtamantDetaliu {
  const { document: _fisier, ...fara } = c
  return {
    ...fara,
    client_nume: magazin.client.get(c.client_id)?.nume ?? '—',
    creat_de_nume: numeUtilizator(c.creat_de),
  }
}

export function hidrateazaJurnal(j: JurnalOperatiune): JurnalOperatiuneDetaliu {
  return { ...j, utilizator_nume: numeUtilizator(j.utilizator_id) }
}

/**
 * Rândul din lista de clienți, cu contoarele afișate lângă nume.
 *
 * Serverul le obține din subinterogări agregate; aici se numără prin scanare.
 * La volumul datelor demo (zeci de clienți, sute de rânduri) diferența nu se
 * simte, iar forma rezultatului este identică.
 */
export function hidrateazaClient(c: Client): ClientListItem {
  let numar_programari = 0
  let ultima_vizita: string | null = null
  const restante: number[] = []

  for (const p of magazin.programare.values()) {
    if (p.client_id !== c.id) continue
    numar_programari++
    if (p.stare === 'onorat') {
      if (ultima_vizita === null || p.incepe_la > ultima_vizita) ultima_vizita = p.incepe_la
      if (incasareaProgramarii(p.id) === null) restante.push(p.pret)
    }
  }

  let numar_vanzari = 0
  for (const v of magazin.vanzare.values()) {
    if (v.client_id !== c.id) continue
    numar_vanzari++
    if (ultima_vizita === null || v.efectuat_la > ultima_vizita) {
      ultima_vizita = v.efectuat_la
    }
    // Produsele luate pe datorie se adună la ședințele neplătite.
    if (v.achitat_la === null) {
      restante.push(sumaTotal(liniiVanzare(v.id).map((l) => l.total_linie)))
    }
  }

  return {
    ...c,
    numar_programari,
    numar_vanzari,
    ultima_vizita,
    de_incasat: sumaTotal(restante),
  }
}
