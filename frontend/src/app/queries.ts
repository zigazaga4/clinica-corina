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
  useQueries,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { api, esteStatisticiIncuiate } from '@/api'
import type {
  AccesStatistici,
  DateAchitareLinii,
  DateArticolModificat,
  DateArticolNou,
  DateCheltuialaModificata,
  DateCheltuialaNoua,
  DateClientModificat,
  DateClientNou,
  DateConsimtamantNou,
  DateIncasare,
  DateNotitaModificata,
  DateNotitaNoua,
  DateParolaStatistici,
  DateProgramLucru,
  DateProgramareModificata,
  DateProgramareNoua,
  DateTratamentModificat,
  DateAvans,
  DateTratamentNou,
  DateUtilizatorModificat,
  DateUtilizatorNou,
  DateVanzareModificata,
  DateVanzareNoua,
  FiltruArticole,
  FiltruCheltuieli,
  FiltruClienti,
  FiltruConsimtaminte,
  FiltruJurnal,
  FiltruNotite,
  FiltruProgramLucru,
  FiltruProgramari,
  FiltruStatistici,
  FiltruTratamente,
  FiltruVanzari,
  ListaCheltuieli,
  OptiuniStare,
  Paginat,
  PretSugerat,
  StareParolaStatistici,
} from '@/api/contract'
import type {
  Articol,
  CheltuialaDetaliu,
  Client,
  ClientListItem,
  ConsimtamantDetaliu,
  IstoricIntrare,
  JurnalOperatiuneDetaliu,
  NotaClientDetaliu,
  NotitaDetaliu,
  ProgramLucru,
  ProgramareDetaliu,
  RaportPersoana,
  RaportStatistici,
  StareProgramare,
  TratamentDetaliu,
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
  notite: {
    tot: ['notite'] as const,
    lista: (filtru: FiltruNotite) => ['notite', 'lista', filtru] as const,
  },
  programLucru: {
    tot: ['program-lucru'] as const,
    lista: (filtru: FiltruProgramLucru) => ['program-lucru', 'lista', filtru] as const,
  },
  tratamente: {
    tot: ['tratamente'] as const,
    lista: (filtru: FiltruTratamente) => ['tratamente', 'lista', filtru] as const,
    unul: (id: Uuid) => ['tratamente', 'unul', id] as const,
  },
  vanzari: {
    tot: ['vanzari'] as const,
    /** Lista întreagă a încasărilor — în spatele parolei statisticilor. */
    liste: ['vanzari', 'lista'] as const,
    lista: (filtru: FiltruVanzari) => ['vanzari', 'lista', filtru] as const,
    una: (id: Uuid) => ['vanzari', 'una', id] as const,
  },
  statistici: {
    tot: ['statistici'] as const,
    parola: ['statistici', 'parola'] as const,
    raport: (filtru: FiltruStatistici) => ['statistici', 'raport', filtru] as const,
    /** Cifrele contului autentificat — „Statisticile mele”, fără parolă. */
    mele: (filtru: FiltruStatistici) => ['statistici', 'mele', filtru] as const,
    /** Cifrele unei persoane, văzute de proprietar, cu parola. */
    persoana: (id: Uuid, filtru: FiltruStatistici) => ['statistici', 'persoana', id, filtru] as const,
  },
  cheltuieli: {
    tot: ['cheltuieli'] as const,
    lista: (filtru: FiltruCheltuieli) => ['cheltuieli', 'lista', filtru] as const,
    categorii: ['cheltuieli', 'categorii'] as const,
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

export function useModificaNota(): UseMutationResult<
  NotaClientDetaliu,
  Error,
  { client_id: Uuid; nota_id: Uuid; text: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ client_id, nota_id, text }: { client_id: Uuid; nota_id: Uuid; text: string }) =>
      api.clienti.modificaNota(client_id, nota_id, text),
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

/**
 * Toate serviciile programării din care face parte `programare`, în ordinea lor.
 *
 * Fereastra unei programări se deschide din locuri care știu doar un rând —
 * o ședință din fișa unui tratament, de pildă — dar arată și închide
 * programarea ÎNTREAGĂ. `cunoscute` sunt rândurile pe care apelantul le are
 * deja (calendarul le are pe toate): se arată pe loc, cât sosește răspunsul.
 *
 * Fără `placeholderData` moștenit de la cheia precedentă, ca la `useProgramari`:
 * o fereastră nou deschisă ar fi arătat o clipă serviciile altei programări.
 */
export function useServiciileProgramarii(
  programare: ProgramareDetaliu | null,
  cunoscute?: ProgramareDetaliu[],
): ProgramareDetaliu[] {
  const vizita_id = programare?.vizita_id ?? null
  const { data } = useQuery({
    queryKey: chei.programari.lista({ vizita_id: vizita_id ?? '' }),
    queryFn: () => api.programari.list({ vizita_id: vizita_id as Uuid }),
    enabled: vizita_id !== null,
  })
  // Aceeași listă cât timp nimic nu s-a schimbat: ferestrele o pun în
  // dependențele efectelor care le completează câmpurile.
  return useMemo(() => {
    if (!programare) return []
    const aleEi = (data ?? cunoscute ?? []).filter((p) => p.vizita_id === programare.vizita_id)
    return aleEi.length > 0 ? aleEi : [programare]
  }, [programare, data, cunoscute])
}

/** Invalidează tot ce se schimbă odată cu o programare. */
function invalideazaProgramari(qc: ReturnType<typeof useQueryClient>, client_id?: Uuid) {
  void qc.invalidateQueries({ queryKey: chei.programari.tot })
  void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
  // Contorul de programări și „ultima vizită” din lista de clienți.
  void qc.invalidateQueries({ queryKey: chei.clienti.tot })
  // Tot ce știe un tratament se numără din ședințele lui: câte s-au făcut,
  // cât s-a împărțit, care e următoarea. O ședință nouă sau mutată le schimbă.
  void qc.invalidateQueries({ queryKey: chei.tratamente.tot })
  // Programările onorate, neprezentările și restanțele din Statistici.
  void qc.invalidateQueries({ queryKey: chei.statistici.tot })
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
 * Schimbarea stării, cu răspunsul la „s-a achitat?” — și „cât?” — dat în
 * același apel.
 *
 * `achitat` contează doar la trecerea pe „onorat”. Fiind o plată, invalidează
 * și încasările — de aceea trece prin `invalideazaVanzari`, nu doar prin
 * `invalideazaProgramari`.
 */
export function useSchimbaStareProgramare(): UseMutationResult<
  ProgramareDetaliu,
  Error,
  { id: Uuid; stare: StareProgramare } & OptiuniStare
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, stare, ...optiuni }: { id: Uuid; stare: StareProgramare } & OptiuniStare) =>
      api.programari.schimbaStarea(id, stare, optiuni),
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

/**
 * Același răspuns, pentru fiecare serviciu al unei programări — câte unul pe
 * rândul lui din formular, în ordinea lor. Cheile sunt ale lui
 * `usePretSugerat`, deci cele două împart memoria.
 */
export function usePreturiSugerate(
  client_id: Uuid | null,
  articol_ids: readonly (Uuid | null)[],
): (PretSugerat | undefined)[] {
  return useQueries({
    queries: articol_ids.map((articol_id) => ({
      queryKey: chei.programari.pret(client_id ?? '', articol_id ?? ''),
      queryFn: () => api.programari.pretSugerat(client_id as Uuid, articol_id as Uuid),
      enabled: client_id !== null && articol_id !== null,
      staleTime: PROSPETIME_NOMENCLATOR,
    })),
  }).map((rezultat) => rezultat.data)
}

// ---------------------------------------------------------------------------
// Notițe în calendar
// ---------------------------------------------------------------------------

export function useNotite(
  filtru: FiltruNotite = {},
  activa = true,
): UseQueryResult<NotitaDetaliu[]> {
  return useQuery({
    queryKey: chei.notite.lista(filtru),
    queryFn: () => api.notite.list(filtru),
    enabled: activa,
    placeholderData: (anterioare) => anterioare,
  })
}

/**
 * O notiță nu atinge clienți, încasări sau prețuri — invalidează doar
 * calendarul ei și jurnalul. Este cea mai ieftină mutație din aplicație.
 */
function invalideazaNotite(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: chei.notite.tot })
  void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
}

export function useCreeazaNotita(): UseMutationResult<NotitaDetaliu, Error, DateNotitaNoua> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateNotitaNoua) => api.notite.create(date),
    onSuccess: () => invalideazaNotite(qc),
  })
}

export function useModificaNotita(): UseMutationResult<
  NotitaDetaliu,
  Error,
  { id: Uuid; date: DateNotitaModificata }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateNotitaModificata }) =>
      api.notite.update(id, date),
    onSuccess: () => invalideazaNotite(qc),
  })
}

export function useStergeNotita(): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Uuid) => api.notite.remove(id),
    onSuccess: () => invalideazaNotite(qc),
  })
}

// ---------------------------------------------------------------------------
// Programul de lucru — zile pare / impare, pe persoană și lună
// ---------------------------------------------------------------------------

export function useProgramLucru(
  filtru: FiltruProgramLucru,
  activa = true,
): UseQueryResult<ProgramLucru[]> {
  return useQuery({
    queryKey: chei.programLucru.lista(filtru),
    queryFn: () => api.programLucru.list(filtru),
    enabled: activa,
    placeholderData: (anterioare) => anterioare,
  })
}

export function useSeteazaProgramLucru(): UseMutationResult<
  ProgramLucru | null,
  Error,
  DateProgramLucru
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateProgramLucru) => api.programLucru.seteaza(date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.programLucru.tot })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

// ---------------------------------------------------------------------------
// Tratamente — servicii în mai multe ședințe
// ---------------------------------------------------------------------------

export function useTratamente(
  filtru: FiltruTratamente = {},
  activa = true,
): UseQueryResult<Paginat<TratamentDetaliu>> {
  return useQuery({
    queryKey: chei.tratamente.lista(filtru),
    queryFn: () => api.tratamente.list(filtru),
    enabled: activa,
    placeholderData: (anterioare) => anterioare,
  })
}

export function useTratament(id: Uuid | null): UseQueryResult<TratamentDetaliu> {
  return useQuery({
    queryKey: chei.tratamente.unul(id ?? ''),
    queryFn: () => api.tratamente.get(id as Uuid),
    enabled: id !== null,
  })
}

/**
 * O schimbare pe tratament mută partea propusă ședințelor următoare, deci și
 * `pretSugerat` din formularul de programare (cheie sub `programari`).
 */
function invalideazaTratamente(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: chei.tratamente.tot })
  void qc.invalidateQueries({ queryKey: chei.programari.tot })
  void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
}

export function useCreeazaTratament(): UseMutationResult<TratamentDetaliu, Error, DateTratamentNou> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateTratamentNou) => api.tratamente.create(date),
    onSuccess: () => invalideazaTratamente(qc),
  })
}

export function useModificaTratament(): UseMutationResult<
  TratamentDetaliu,
  Error,
  { id: Uuid; date: DateTratamentModificat }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateTratamentModificat }) =>
      api.tratamente.update(id, date),
    onSuccess: () => invalideazaTratamente(qc),
  })
}

/** Încheierea și redeschiderea, într-un singur hook — ca arhivarea fișei. */
export function useIncheieTratament(): UseMutationResult<
  TratamentDetaliu,
  Error,
  { id: Uuid; incheie: boolean }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, incheie }: { id: Uuid; incheie: boolean }) =>
      incheie ? api.tratamente.incheie(id) : api.tratamente.redeschide(id),
    onSuccess: () => invalideazaTratamente(qc),
  })
}

/**
 * Încasarea pe abonament, înainte de ședințe (avans). Schimbă ce știe
 * abonamentul, dar și fișa clientului, calendarul și Statisticile: banii au
 * intrat, iar o ședință onorată deja în așteptare se stinge pe loc.
 */
export function useIncaseazaPeAbonament(): UseMutationResult<
  TratamentDetaliu,
  Error,
  { id: Uuid; date: DateAvans }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateAvans }) => api.tratamente.incaseaza(id, date),
    onSuccess: (tratament) => {
      invalideazaTratamente(qc)
      invalideazaVanzari(qc, tratament.client_id)
    },
  })
}

/** Șterge tratamentul, cu ședințele și banii lui — deci și din Statistici. */
export function useStergeTratament(): UseMutationResult<void, Error, TratamentDetaliu> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (tratament: TratamentDetaliu) => api.tratamente.remove(tratament.id),
    onSuccess: (_gol, tratament) => {
      invalideazaTratamente(qc)
      invalideazaVanzari(qc, tratament.client_id)
    },
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
  // Banii intrați sunt jumătate din Statistici.
  void qc.invalidateQueries({ queryKey: chei.statistici.tot })
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

/** Achită doar liniile alese ale unei vânzări neachitate; restul rămâne datorie. */
export function useAchitaLinii(): UseMutationResult<
  VanzareDetaliu,
  Error,
  { id: Uuid; date: DateAchitareLinii }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateAchitareLinii }) =>
      api.vanzari.achitaLinii(id, date),
    onSuccess: (vanzare) => invalideazaVanzari(qc, vanzare.client_id),
  })
}

/** Șterge o încasare — doar cu statisticile deblocate. */
export function useStergeVanzare(): UseMutationResult<void, Error, VanzareDetaliu> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (vanzare: VanzareDetaliu) => api.vanzari.remove(vanzare.id),
    onSuccess: (_gol, vanzare) => {
      qc.removeQueries({ queryKey: chei.vanzari.una(vanzare.id) })
      invalideazaVanzari(qc, vanzare.client_id)
    },
  })
}

// ---------------------------------------------------------------------------
// Statistici — în spatele parolei lor
// ---------------------------------------------------------------------------

/** Există parola statisticilor? Dacă nu, un administrator o alege. */
export function useStareParolaStatistici(): UseQueryResult<StareParolaStatistici> {
  return useQuery({
    queryKey: chei.statistici.parola,
    queryFn: () => api.statistici.stare(),
  })
}

export function useDeblocheazaStatistici(): UseMutationResult<AccesStatistici, Error, string> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (parola: string) => api.statistici.deblocheaza(parola),
    // Deschiderea rămâne în jurnal.
    onSuccess: () => void qc.invalidateQueries({ queryKey: chei.jurnal.tot }),
  })
}

export function useSeteazaParolaStatistici(): UseMutationResult<
  AccesStatistici,
  Error,
  DateParolaStatistici
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateParolaStatistici) => api.statistici.seteazaParola(date),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.statistici.parola })
      void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
    },
  })
}

/**
 * Încuie statisticile: clientul API uită deblocarea, iar ce se citise cu ea
 * dispare din memoria interfeței.
 *
 * Fără a doua parte, cifrele ar fi rămas în cache după plecarea din pagină și
 * ar fi reapărut, pentru o clipă, la următoarea deschidere — înainte de parolă.
 * Se cheamă DUPĂ ce ecranele care le citeau s-au închis: șterse de sub ochii
 * lor, s-ar fi cerut din nou, fără deblocare.
 */
export function useBlocheazaStatistici(): () => void {
  const qc = useQueryClient()
  return useCallback(() => {
    api.statistici.blocheaza()
    qc.removeQueries({ queryKey: chei.statistici.tot, predicate: (q) => q.queryKey[1] !== 'parola' })
    qc.removeQueries({ queryKey: chei.cheltuieli.tot })
    qc.removeQueries({ queryKey: chei.vanzari.liste })
  }, [qc])
}

/**
 * Anunță când serverul spune că statisticile s-au încuiat — deblocarea a
 * expirat sau parola s-a schimbat de pe alt calculator.
 *
 * Ascultă memoria interogărilor, nu fiecare ecran în parte: raportul, lista
 * de cheltuieli, lista de încasări, o salvare din formular — oricare ar afla
 * primul, pagina se încuie o singură dată, din același loc.
 */
export function useLaStatisticiIncuiate(laIncuiere: (mesaj: string) => void): void {
  const qc = useQueryClient()
  const ultima = useRef(laIncuiere)
  useEffect(() => {
    ultima.current = laIncuiere
  }, [laIncuiere])

  useEffect(() => {
    const verifica = (eroare: unknown) => {
      if (esteStatisticiIncuiate(eroare)) ultima.current(eroare.message)
    }
    const interogari = qc.getQueryCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'error') verifica(e.action.error)
    })
    const mutatii = qc.getMutationCache().subscribe((e) => {
      if (e.type === 'updated' && e.action.type === 'error') verifica(e.action.error)
    })
    return () => {
      interogari()
      mutatii()
    }
  }, [qc])
}

export function useRaportStatistici(filtru: FiltruStatistici): UseQueryResult<RaportStatistici> {
  return useQuery({
    queryKey: chei.statistici.raport(filtru),
    queryFn: () => api.statistici.raport(filtru),
    // Graficele țin cadrul vechi cât sosesc cifrele noi — fără salt, fără schelet.
    placeholderData: (anterioare) => anterioare,
    // Întoarcerea la fereastră reverifică deblocarea: o parolă schimbată de pe
    // alt calculator încuie ecranul de aici atunci, nu abia peste o oră.
    refetchOnWindowFocus: true,
  })
}

/**
 * „Statisticile mele”: ședințele și banii contului autentificat, fără parola
 * statisticilor. Persoana nu se alege — o știe serverul din cont.
 */
export function useStatisticileMele(filtru: FiltruStatistici): UseQueryResult<RaportPersoana> {
  return useQuery({
    queryKey: chei.statistici.mele(filtru),
    queryFn: () => api.statistici.mele(filtru),
    placeholderData: (anterioare) => anterioare,
  })
}

/**
 * Aceleași cifre pentru oricare persoană, pentru proprietar — cere statisticile
 * deblocate. `id` nul = nu se cere nimic (se arată raportul clinicii).
 */
export function useRaportPersoana(
  id: Uuid | null,
  filtru: FiltruStatistici,
): UseQueryResult<RaportPersoana> {
  return useQuery({
    queryKey: chei.statistici.persoana(id ?? '', filtru),
    queryFn: () => api.statistici.persoana(id as Uuid, filtru),
    enabled: id !== null,
    placeholderData: (anterioare) => anterioare,
    refetchOnWindowFocus: true,
  })
}

export function useCheltuieli(filtru: FiltruCheltuieli = {}): UseQueryResult<ListaCheltuieli> {
  return useQuery({
    queryKey: chei.cheltuieli.lista(filtru),
    queryFn: () => api.cheltuieli.list(filtru),
    placeholderData: (anterioare) => anterioare,
    refetchOnWindowFocus: true,
  })
}

export function useCategoriiCheltuieli(): UseQueryResult<string[]> {
  return useQuery({
    queryKey: chei.cheltuieli.categorii,
    queryFn: () => api.cheltuieli.categorii(),
  })
}

/** O cheltuială mută profitul — lista ei, categoriile, raportul și jurnalul. */
function invalideazaCheltuieli(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: chei.cheltuieli.tot })
  void qc.invalidateQueries({ queryKey: chei.statistici.tot })
  void qc.invalidateQueries({ queryKey: chei.jurnal.tot })
}

export function useCreeazaCheltuiala(): UseMutationResult<CheltuialaDetaliu, Error, DateCheltuialaNoua> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (date: DateCheltuialaNoua) => api.cheltuieli.create(date),
    onSuccess: () => invalideazaCheltuieli(qc),
  })
}

export function useModificaCheltuiala(): UseMutationResult<
  CheltuialaDetaliu,
  Error,
  { id: Uuid; date: DateCheltuialaModificata }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, date }: { id: Uuid; date: DateCheltuialaModificata }) =>
      api.cheltuieli.update(id, date),
    onSuccess: () => invalideazaCheltuieli(qc),
  })
}

export function useStergeCheltuiala(): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Uuid) => api.cheltuieli.remove(id),
    onSuccess: () => invalideazaCheltuieli(qc),
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

/** Șterge un articol nefolosit; unul folosit întoarce 409 (se dezactivează). */
export function useStergeArticol(): UseMutationResult<void, Error, Uuid> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: Uuid) => api.articole.remove(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: chei.articole.tot })
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
