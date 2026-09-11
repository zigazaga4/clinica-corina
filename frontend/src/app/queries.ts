/**
 * Stratul de date al interfeței.
 *
 * Toate ecranele citesc și scriu prin funcțiile de aici; niciunul nu apelează
 * `api` direct. Câștigul nu este economia de linii, ci faptul că INVALIDĂRILE
 * stau într-un singur loc: când se înregistrează o vânzare, trebuie
 * împrospătate lista de vânzări, istoricul clientului, contoarele din lista de
 * clienți și jurnalul. Împrăștiată prin module, regula aceasta s-ar aplica
 * incomplet, iar ecranele ar rămâne cu date vechi în moduri greu de reprodus.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { api } from '@/api'
import type {
  DateArticolModificat,
  DateArticolNou,
  DateClientModificat,
  DateClientNou,
  DateConsimtamantNou,
  DateIncasare,
  DateProgramareModificata,
  DateProgramareNoua,
  DateUtilizatorModificat,
  DateUtilizatorNou,
  DateVanzareModificata,
  DateVanzareNoua,
  FiltruArticole,
  FiltruClienti,
  FiltruConsimtaminte,
  FiltruJurnal,
  FiltruProgramari,
  FiltruVanzari,
  Paginat,
  PretSugerat,
} from '@/api/contract'
import type {
  Articol,
  Client,
  ClientListItem,
  ConsimtamantDetaliu,
  IstoricIntrare,
  JurnalOperatiuneDetaliu,
  NotaClientDetaliu,
  ProgramareDetaliu,
  StareProgramare,
  Utilizator,
  Uuid,
  VanzareDetaliu,
} from '@/domain/types'

// ---------------------------------------------------------------------------
// Chei
// ---------------------------------------------------------------------------

/**
 * Cheile sunt ierarhice, ca invalidarea unui prefix să prindă tot ce atârnă de
 * el: `['clienti']` invalidează și listele, și fișele, și istoricele.
 */
export const chei = {
  clienti: {
    tot: ['clienti'] as const,
    lista: (filtru: FiltruClienti) => ['clienti', 'lista', filtru] as const,
    unul: (id: Uuid) => ['clienti', 'unul', id] as const,
    istoric: (id: Uuid) => ['clienti', 'istoric', id] as const,
    note: (id: Uuid) => ['clienti', 'note', id] as const,
  },
  consimtaminte: {
    tot: ['consimtaminte'] as const,
    lista: (filtru: FiltruConsimtaminte) => ['consimtaminte', 'lista', filtru] as const,
  },
  programari: {
    tot: ['programari'] as const,
    lista: (filtru: FiltruProgramari) => ['programari', 'lista', filtru] as const,
    una: (id: Uuid) => ['programari', 'una', id] as const,
    pret: (client_id: Uuid, articol_id: Uuid) =>
      ['programari', 'pret', client_id, articol_id] as const,
  },
  vanzari: {
    tot: ['vanzari'] as const,
    lista: (filtru: FiltruVanzari) => ['vanzari', 'lista', filtru] as const,
    una: (id: Uuid) => ['vanzari', 'una', id] as const,
  },
  articole: {
    tot: ['articole'] as const,
    lista: (filtru: FiltruArticole) => ['articole', 'lista', filtru] as const,
  },
  utilizatori: {
    tot: ['utilizatori'] as const,
    lista: (filtru: { activ?: boolean; q?: string }) => ['utilizatori', 'lista', filtru] as const,
  },
  jurnal: {
    tot: ['jurnal'] as const,
    lista: (filtru: FiltruJurnal) => ['jurnal', 'lista', filtru] as const,
  },
} as const

/**
 * Nomenclatoarele se schimbă rar, dar sunt cerute de aproape fiecare formular.
 * Cinci minute de prospețime elimină o cerere la fiecare deschidere de dialog,
 * fără să rețină vreodată date semnificativ vechi.
 */
const PROSPETIME_NOMENCLATOR = 5 * 60_000

// ---------------------------------------------------------------------------
// Clienți
// ---------------------------------------------------------------------------

export function useClienti(filtru: FiltruClienti = {}): UseQueryResult<Paginat<ClientListItem>> {
  return useQuery({
    queryKey: chei.clienti.lista(filtru),
    queryFn: () => api.clienti.list(filtru),
    // Rândurile anterioare rămân vizibile în timpul refiltrării, ca lista să nu
    // clipească la fiecare literă tastată în căutare.
    placeholderData: (anterioare) => anterioare,
  })
}

export function useClient(id: Uuid | null): UseQueryResult<Client> {
  return useQuery({
    queryKey: chei.clienti.unul(id ?? ''),
    queryFn: () => api.clienti.get(id as Uuid),
    enabled: id !== null,
  })
}

export function useIstoricClient(id: Uuid | null): UseQueryResult<IstoricIntrare[]> {
  return useQuery({
    queryKey: chei.clienti.istoric(id ?? ''),
    queryFn: () => api.clienti.istoric(id as Uuid),
    enabled: id !== null,
  })
}

export function useNoteClient(id: Uuid | null): UseQueryResult<NotaClientDetaliu[]> {
  return useQuery({
    queryKey: chei.clienti.note(id ?? ''),
    queryFn: () => api.clienti.note(id as Uuid),
    enabled: id !== null,
  })
}

export function useCreeazaClient(): UseMutationResult<Client, Error, DateClientNou> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateClientNou) => api.clienti.create(date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.clienti.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

export function useModificaClient(): UseMutationResult<
  Client,
  Error,
  { id: Uuid; date: DateClientModificat }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateClientModificat }) =>
      api.clienti.update(id, date),
    onSuccess: (client) => {
      qc.setQueryData(chei.clienti.unul(client.id), client)
      void qc.invalidateQueries({ queryKey: chei.clienti.tot })
      // Numele clientului apare hidratat în programări și vânzări.
      void qc.invalidateQueries({ queryKey: chei.programari.tot })
      void qc.invalidateQueries({ queryKey: chei.vanzari.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

export function useArhiveazaClient(): UseMutationResult<Client, Error, { id: Uuid; arhiveaza: boolean }> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, arhiveaza }: { id: Uuid; arhiveaza: boolean }) =>
      arhiveaza ? api.clienti.arhiveaza(id) : api.clienti.dezarhiveaza(id),
    onSuccess: (client) => {
      qc.setQueryData(chei.clienti.unul(client.id), client)
      void qc.invalidateQueries({ queryKey: chei.clienti.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

export function useStergeClient(): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Uuid) => api.clienti.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.clienti.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

export function useAdaugaNota(): UseMutationResult<
  NotaClientDetaliu,
  Error,
  { client_id: Uuid; text: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ client_id, text }: { client_id: Uuid; text: string }) =>
      api.clienti.adaugaNota(client_id, text),
    onSuccess: (_nota, { client_id }) => {
      void qc.invalidateQueries({ queryKey: chei.clienti.note(client_id) })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

// ---------------------------------------------------------------------------
// Consimțăminte
// ---------------------------------------------------------------------------

export function useConsimtaminte(
  filtru: FiltruConsimtaminte = {},
  activ = true,
): UseQueryResult<Paginat<ConsimtamantDetaliu>> {
  return useQuery({
    queryKey: chei.consimtaminte.lista(filtru),
    queryFn: () => api.consimtaminte.list(filtru),
    enabled: activ,
  })
}

/**
 * Nu există `useModificaAcord` și nu va exista.
 *
 * Un acord semnat nu se rescrie: serverul nu are PATCH, iar tabela nu are
 * `actualizat_la`. Îndreptarea unei greșeli este o semnătură nouă.
 */
export function useSemneazaAcord(): UseMutationResult<
  ConsimtamantDetaliu,
  Error,
  DateConsimtamantNou
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateConsimtamantNou) => api.consimtaminte.create(date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.consimtaminte.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

// ---------------------------------------------------------------------------
// Programări
// ---------------------------------------------------------------------------

export function useProgramari(
  filtru: FiltruProgramari = {},
  activa = true,
): UseQueryResult<ProgramareDetaliu[]> {
  return useQuery({
    queryKey: chei.programari.lista(filtru),
    queryFn: () => api.programari.list(filtru),
    enabled: activa,
    placeholderData: (anterioare) => anterioare,
  })
}

/** Invalidează tot ce se schimbă odată cu o programare. */
function invalideazaProgramari(qc: ReturnType<typeof useQueryClient>, client_id?: Uuid) {
  void qc.invalidateQueries({ queryKey: chei.programari.tot })
  void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
  // Contorul de programări și „ultima vizită” din lista de clienți.
  void qc.invalidateQueries({ queryKey: chei.clienti.tot })
  if (client_id) void qc.invalidateQueries({ queryKey: chei.clienti.istoric(client_id) })
}

export function useCreeazaProgramare(): UseMutationResult<
  ProgramareDetaliu,
  Error,
  DateProgramareNoua
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateProgramareNoua) => api.programari.create(date),
    onSuccess: (programare) => invalideazaProgramari(qc, programare.client_id),
  })
}

export function useModificaProgramare(): UseMutationResult<
  ProgramareDetaliu,
  Error,
  { id: Uuid; date: DateProgramareModificata }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateProgramareModificata }) =>
      api.programari.update(id, date),
    onSuccess: (programare) => invalideazaProgramari(qc, programare.client_id),
  })
}

/**
 * Schimbarea stării, cu răspunsul la „s-a achitat?” dat în același apel.
 *
 * `achitat` contează doar la trecerea pe „onorat”. Fiind o plată, invalidează
 * și încasările — de aceea trece prin `invalideazaVanzari`, nu doar prin
 * `invalideazaProgramari`.
 */
export function useSchimbaStareProgramare(): UseMutationResult<
  ProgramareDetaliu,
  Error,
  { id: Uuid; stare: StareProgramare; achitat?: boolean }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stare, achitat }: { id: Uuid; stare: StareProgramare; achitat?: boolean }) =>
      api.programari.schimbaStarea(id, stare, achitat),
    onSuccess: (programare, { achitat }) => {
      invalideazaProgramari(qc, programare.client_id)
      if (achitat) invalideazaVanzari(qc, programare.client_id)
    },
  })
}

/**
 * Prețul cu care se deschide formularul pentru perechea client + serviciu.
 *
 * Interogarea pornește doar când ambele sunt alese: fără client nu există
 * istoric de consultat, iar un preț „sugerat” fără el ar fi doar cel de listă,
 * pe care formularul îl are oricum din nomenclator.
 */
export function usePretSugerat(
  client_id: Uuid | null,
  articol_id: Uuid | null,
): UseQueryResult<PretSugerat> {
  return useQuery({
    queryKey: chei.programari.pret(client_id ?? '', articol_id ?? ''),
    queryFn: () => api.programari.pretSugerat(client_id as Uuid, articol_id as Uuid),
    enabled: client_id !== null && articol_id !== null,
    staleTime: PROSPETIME_NOMENCLATOR,
  })
}

// ---------------------------------------------------------------------------
// Vânzări
// ---------------------------------------------------------------------------

export function useVanzari(filtru: FiltruVanzari = {}): UseQueryResult<Paginat<VanzareDetaliu>> {
  return useQuery({
    queryKey: chei.vanzari.lista(filtru),
    queryFn: () => api.vanzari.list(filtru),
    placeholderData: (anterioare) => anterioare,
  })
}

export function useVanzare(id: Uuid | null): UseQueryResult<VanzareDetaliu> {
  return useQuery({
    queryKey: chei.vanzari.una(id ?? ''),
    queryFn: () => api.vanzari.get(id as Uuid),
    enabled: id !== null,
  })
}

function invalideazaVanzari(qc: ReturnType<typeof useQueryClient>, client_id?: Uuid) {
  void qc.invalidateQueries({ queryKey: chei.vanzari.tot })
  void qc.invalidateQueries({ queryKey: chei.clienti.tot })
  void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
  // O încasare schimbă `achitat` pe programările stinse și suma rămasă de
  // plată. Fără linia asta, calendarul și fișa ar continua să arate „De plată”
  // pe o ședință tocmai încasată.
  void qc.invalidateQueries({ queryKey: chei.programari.tot })
  if (client_id) void qc.invalidateQueries({ queryKey: chei.clienti.istoric(client_id) })
}

export function useCreeazaVanzare(): UseMutationResult<VanzareDetaliu, Error, DateVanzareNoua> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateVanzareNoua) => api.vanzari.create(date),
    onSuccess: (vanzare) => invalideazaVanzari(qc, vanzare.client_id),
  })
}

/** Stinge într-o singură plată ședințele rămase de achitat ale unui client. */
export function useIncaseaza(): UseMutationResult<VanzareDetaliu, Error, DateIncasare> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateIncasare) => api.vanzari.incaseaza(date),
    onSuccess: (vanzare) => invalideazaVanzari(qc, vanzare.client_id),
  })
}

export function useModificaVanzare(): UseMutationResult<
  VanzareDetaliu,
  Error,
  { id: Uuid; date: DateVanzareModificata }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateVanzareModificata }) =>
      api.vanzari.update(id, date),
    onSuccess: (vanzare) => {
      qc.setQueryData(chei.vanzari.una(vanzare.id), vanzare)
      invalideazaVanzari(qc, vanzare.client_id)
    },
  })
}

// ---------------------------------------------------------------------------
// Nomenclatoare
// ---------------------------------------------------------------------------

export function useArticole(filtru: FiltruArticole = {}): UseQueryResult<Articol[]> {
  return useQuery({
    queryKey: chei.articole.lista(filtru),
    queryFn: () => api.articole.list(filtru),
    staleTime: PROSPETIME_NOMENCLATOR,
  })
}

export function useCreeazaArticol(): UseMutationResult<Articol, Error, DateArticolNou> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateArticolNou) => api.articole.create(date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.articole.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

export function useModificaArticol(): UseMutationResult<
  Articol,
  Error,
  { id: Uuid; date: DateArticolModificat }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateArticolModificat }) =>
      api.articole.update(id, date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.articole.tot })
      // Denumirea articolului apare hidratată în programări și în linii.
      void qc.invalidateQueries({ queryKey: chei.programari.tot })
      void qc.invalidateQueries({ queryKey: chei.vanzari.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

/*
  Punctele de lucru nu au hook.

  Clinica are o singură locație: niciun ecran nu o alege, nu o afișează și nu o
  administrează, iar serverul o completează singur. Rutele rămân în
  `@/api/contract` pentru specificația backend; aici ar fi fost cod mort.
*/

// ---------------------------------------------------------------------------
// Utilizatori
// ---------------------------------------------------------------------------

/**
 * Lista conturilor este o rută de administrator (§7). Ecranele de programare au
 * însă nevoie de numele executanților, iar un operator obișnuit nu o poate
 * cere. De aceea `activa` permite oprirea interogării — apelantul decide, pe
 * baza rolului, dacă are voie să o pornească.
 */
export function useUtilizatori(
  filtru: { activ?: boolean; q?: string } = {},
  activa = true,
): UseQueryResult<Utilizator[]> {
  return useQuery({
    queryKey: chei.utilizatori.lista(filtru),
    queryFn: () => api.utilizatori.list(filtru),
    enabled: activa,
    staleTime: PROSPETIME_NOMENCLATOR,
  })
}

export function useCreeazaUtilizator(): UseMutationResult<Utilizator, Error, DateUtilizatorNou> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateUtilizatorNou) => api.utilizatori.create(date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.utilizatori.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

export function useModificaUtilizator(): UseMutationResult<
  Utilizator,
  Error,
  { id: Uuid; date: DateUtilizatorModificat }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateUtilizatorModificat }) =>
      api.utilizatori.update(id, date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.utilizatori.tot })
      void qc.invalidateQueries({ queryKey: chei.programari.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

export function useReseteazaParola(): UseMutationResult<
  void,
  Error,
  { id: Uuid; parola_noua: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, parola_noua }: { id: Uuid; parola_noua: string }) =>
      api.utilizatori.reseteazaParola(id, parola_noua),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.utilizatori.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

// ---------------------------------------------------------------------------
// Jurnal
// ---------------------------------------------------------------------------

export function useJurnal(
  filtru: FiltruJurnal = {},
): UseQueryResult<Paginat<JurnalOperatiuneDetaliu>> {
  return useQuery({
    queryKey: chei.jurnal.lista(filtru),
    queryFn: () => api.jurnal.list(filtru),
    placeholderData: (anterioare) => anterioare,
  })
}
