import {
  etichetaRol,
  etichetaStareProgramare,
  etichetaTipArticol,
} from '@/domain/labels'
import type {
  JurnalOperatiuneDetaliu,
  RolUtilizator,
  StareProgramare,
  TipArticol,
} from '@/domain/types'
import { formateazaData, formateazaDataOra, formateazaDurata } from '@/lib/dates'
import { formateazaBani } from '@/lib/money'

/**
 * Citirea conținutului unei intrări de jurnal.
 *
 * `date_vechi` / `date_noi` sosesc ca obiecte libere: serverul reține doar
 * câmpurile atinse de operațiune, cu numele lor din bază. Afișate ca atare, ar
 * fi un JSON pe ecran — „stare: neprezentat, pret_lista: 180” nu este un
 * răspuns la întrebarea „ce s-a schimbat”. Funcțiile de aici traduc numele
 * coloanei în etichetă și valoarea brută în forma în care utilizatorul o vede
 * în restul aplicației: sume în lei, momente în ora locală, enumerări cu
 * eticheta lor.
 */

const ETICHETE_CAMP: Record<string, string> = {
  id: 'Identificator',
  nume: 'Nume',
  email: 'E-mail',
  telefon: 'Telefon',
  adresa: 'Adresă',
  data_nasterii: 'Data nașterii',
  rol: 'Rol',
  activ: 'Activ',
  ultima_autentificare: 'Ultima autentificare',
  parola_resetata: 'Parolă resetată',
  sesiuni_revocate: 'Sesiuni revocate',
  dispozitiv: 'Dispozitiv',
  arhivat_la: 'Arhivat la',
  creat_la: 'Creat la',
  creat_de: 'Creat de',
  actualizat_la: 'Actualizat la',
  autor_id: 'Autor',
  text: 'Text',
  client_id: 'Client',
  articol_id: 'Articol',
  articol_tip: 'Tip articol',
  executant_id: 'Persoana care execută',
  punct_lucru_id: 'Punct de lucru',
  operator_id: 'Operator',
  programare_id: 'Programare',
  versiune: 'Versiunea acordului',
  marime: 'Mărime fișier',
  amprenta: 'Amprentă SHA-256',
  date_semnatar: 'Datele semnatarului',
  semnat_la: 'Semnat la',
  vanzare_id: 'Vânzare',
  incepe_la: 'Începe la',
  se_termina_la: 'Se termină la',
  efectuat_la: 'Efectuat la',
  stare: 'Stare',
  nota: 'Notă',
  tip: 'Tip',
  denumire: 'Denumire',
  durata_minute: 'Durată',
  pret_lista: 'Preț de listă',
  pret_unitar: 'Preț unitar',
  cantitate: 'Cantitate',
  total_linie: 'Total linie',
  numar_linii: 'Număr de linii',
  linii_inlocuite: 'Linii înlocuite',
}

/** Enumerările au deja etichete de domeniu; le refolosim, nu le rescriem. */
const TRADUCERI_ENUM: Record<string, (valoare: string) => string> = {
  rol: (v) => etichetaRol[v as RolUtilizator] ?? v,
  stare: (v) => etichetaStareProgramare[v as StareProgramare] ?? v,
  tip: (v) => etichetaTipArticol[v as TipArticol] ?? v,
  articol_tip: (v) => etichetaTipArticol[v as TipArticol] ?? v,
}

const CHEI_BANI = new Set(['pret_lista', 'pret_unitar', 'total_linie', 'total'])

/**
 * Câmpurile după care se recunoaște înregistrarea atinsă, în ordinea în care
 * merită încercate: un nume spune mai mult decât un identificator.
 */
const CHEI_IDENTIFICATOR = [
  'nume',
  'denumire',
  'dispozitiv',
  'text',
  'email',
  'incepe_la',
  'efectuat_la',
]

export function etichetaCamp(cheie: string): string {
  return ETICHETE_CAMP[cheie] ?? cheie
}

/** Coloanele de tip uuid se afișează monospațiat; nu au sens de citit, doar de comparat. */
export function esteIdentificator(cheie: string): boolean {
  return cheie === 'id' || cheie.endsWith('_id')
}

/**
 * Valoarea unei coloane, în forma din interfață.
 * Lipsa valorii este „—”, ca peste tot altundeva: un spațiu gol nu distinge
 * „câmpul era nul” de „nu s-a încărcat”.
 */
export function formateazaValoare(cheie: string, valoare: unknown): string {
  if (valoare === null || valoare === undefined || valoare === '') return '—'

  if (typeof valoare === 'boolean') return valoare ? 'Da' : 'Nu'

  if (typeof valoare === 'number') {
    if (CHEI_BANI.has(cheie)) return formateazaBani(valoare)
    if (cheie === 'durata_minute') return formateazaDurata(valoare)
    return String(valoare)
  }

  if (typeof valoare === 'string') {
    const traducere = TRADUCERI_ENUM[cheie]
    if (traducere) return traducere(valoare)
    // Coloanele `timestamptz` se termină toate în `_la`; excepția istorică este
    // `ultima_autentificare`, tot un moment.
    if (cheie.endsWith('_la') || cheie === 'ultima_autentificare') {
      return formateazaDataOra(valoare)
    }
    if (cheie === 'data_nasterii') return formateazaData(valoare)
    return valoare
  }

  // Tablourile și obiectele nu apar în jurnalul actual, dar o coloană `jsonb`
  // adăugată ulterior nu trebuie să spargă ecranul.
  return JSON.stringify(valoare)
}

/** Reuniunea câmpurilor atinse, în ordinea în care le-a scris serverul. */
export function campuriSchimbate(intrare: JurnalOperatiuneDetaliu): string[] {
  const chei = new Set<string>()
  for (const cheie of Object.keys(intrare.date_vechi ?? {})) chei.add(cheie)
  for (const cheie of Object.keys(intrare.date_noi ?? {})) chei.add(cheie)
  return [...chei]
}

const REZUMAT_IMPLICIT: Record<string, string> = {
  creare: 'Înregistrare creată',
  stergere: 'Înregistrare ștearsă',
  arhivare: 'Înregistrare arhivată',
  autentificare: 'Sesiune deschisă',
}

/**
 * Rezumatul dintr-un rând de listă.
 *
 * La modificare interesează CE s-a schimbat — serverul reține doar câmpurile
 * atinse, deci enumerarea lor este scurtă și exactă. La celelalte acțiuni
 * interesează DESPRE CINE este vorba, iar identificatorul din date spune asta
 * mai bine decât lista completă a coloanelor scrise.
 */
export function rezumatSchimbare(intrare: JurnalOperatiuneDetaliu): string {
  if (intrare.actiune === 'modificare') {
    const campuri = campuriSchimbate(intrare)
    if (campuri.length === 0) return '—'
    return campuri.map(etichetaCamp).join(', ')
  }

  const sursa = intrare.date_noi ?? intrare.date_vechi
  if (sursa) {
    for (const cheie of CHEI_IDENTIFICATOR) {
      const valoare = sursa[cheie]
      if (valoare !== null && valoare !== undefined && valoare !== '') {
        return formateazaValoare(cheie, valoare)
      }
    }
  }

  return REZUMAT_IMPLICIT[intrare.actiune] ?? '—'
}
