import { useMemo, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Archive,
  ArchiveRestore,
  MoreVertical,
  Pencil,
  ShoppingBag,
  StickyNote,
  Trash2,
  UserRound,
} from 'lucide-react'
import { esteEroareApi, mesajEroare } from '@/api/errors'
import { useAutentificare, useUtilizator } from '@/app/auth'
import {
  useAdaugaNota,
  useArhiveazaClient,
  useClient,
  useConsimtaminte,
  useIstoricClient,
  useModificaNota,
  useNoteClient,
  useStergeClient,
  useUtilizatori,
} from '@/app/queries'
import { AntetPagina, Pagina } from '@/components/Pagina'
import { InsemnInactiv, InsemnPlata, InsemnStareProgramare } from '@/components/insemne'
import { esteAvans, esteProdus } from '@/domain/avans'
import type {
  IstoricIntrare,
  NotaClientDetaliu,
  ProgramareDetaliu,
  Uuid,
  VanzareDetaliu,
  VanzareLinieDetaliu,
} from '@/domain/types'
import { functii } from '@/config/functii'
import { cn } from '@/lib/cn'
import {
  formateazaData,
  formateazaDataOra,
  formateazaInterval,
  isSameDay,
  laData,
  varsta,
} from '@/lib/dates'
import { formateazaBani, formateazaCantitate, sumaTotal } from '@/lib/money'
import { plural } from '@/lib/text'
import {
  AntetCard,
  Buton,
  Card,
  CorpCard,
  ElementMeniu,
  File,
  IncarcarePagina,
  Meniu,
  ModalaConfirmare,
  Pereche,
  SeparatorMeniu,
  Spinner,
  StareEroare,
  StareGoala,
  Textarea,
  useNotificari,
  type Fila,
} from '@/ui'
import { PanouAcorduri } from '../consimtamant/PanouAcorduri'
import { FormularProgramare, type ProgramareInitiala } from '../programari/FormularProgramare'
import { TratamenteleClientului } from '../tratamente/TratamenteleClientului'
import { FormularVanzare } from '../vanzari/FormularVanzare'
import { PlataVanzarii } from '../vanzari/PlataVanzarii'
import { FormularClient } from './FormularClient'
import { ModalaIncasare } from './ModalaIncasare'

/**
 * Fișa clientului (art. 3.1.A).
 *
 * Adună într-un singur ecran datele de contact, istoricul de programări și
 * vânzări și notele. Ștergerea definitivă rămâne o excepție: pentru un client
 * cu activitate, baza o refuză (ON DELETE RESTRICT), iar calea normală de
 * scoatere din uz este arhivarea, care păstrează istoricul.
 */

type FilaFisa = 'istoric' | 'note' | 'acorduri'

export function PaginaFisaClient() {
  const { id } = useParams<{ id: string }>()
  const clientId = id ?? null
  const navigate = useNavigate()
  const notificari = useNotificari()
  const { esteAdministrator } = useAutentificare()
  const utilizatorCurent = useUtilizator()

  const { data: client, isPending, error, refetch } = useClient(clientId)
  const istoric = useIstoricClient(clientId)
  const note = useNoteClient(clientId)
  // Doar pentru contorul de pe filă; PDF-urile nu se aduc aici.
  const acorduri = useConsimtaminte(clientId ? { client_id: clientId } : {}, clientId !== null)

  // GET /utilizatori este rută de administrator (§7). Pentru ceilalți nu o
  // pornim — ar întoarce 403 doar ca să afle un nume, iar câmpul „creată de”
  // rămâne pe „—”, ceea ce este onest, nu greșit.
  const { data: utilizatori } = useUtilizatori({}, esteAdministrator)

  const arhiveaza = useArhiveazaClient()
  const sterge = useStergeClient()

  const [fila, setFila] = useState<FilaFisa>('istoric')
  const [formularDeschis, setFormularDeschis] = useState(false)
  const [incasareDeschisa, setIncasareDeschisa] = useState(false)
  const [vanzareNoua, setVanzareNoua] = useState(false)
  const [cereConfirmareStergere, setCereConfirmareStergere] = useState(false)
  // Ședința următoare a unui tratament, programată de pe fișă.
  const [programareDinTratament, setProgramareDinTratament] = useState<ProgramareInitiala | null>(null)

  // Cronologia curățată de dubluri; contorul de pe filă o numără pe ea, ca
  // eticheta să spună câte intrări se văd, nu câte a trimis serverul.
  const cronologie = useMemo(() => cronologiaFisei(istoric.data ?? []), [istoric.data])

  // Ce are clientul de plătit se DERIVĂ din istoric, nu se cere separat:
  // ecranul l-a încărcat oricum pentru filă, iar fiecare programare vine deja
  // cu `achitat` și `pret`. O rută nouă doar pentru suma asta ar fi însemnat o
  // a doua cerere care poate rămâne în urma primei și ar arăta alt total decât
  // rândurile de dedesubt.
  const sedinteNeachitate = useMemo(
    () =>
      cronologie.flatMap((intrare) =>
        intrare.fel === 'programare' &&
        intrare.programare.stare === 'onorat' &&
        !intrare.programare.achitat
          ? [intrare.programare]
          : [],
      ),
    [cronologie],
  )
  // Produsele luate pe datorie. O vânzare neachitată are doar produse — una
  // care stinge ședințe este chiar plata lor — deci toate sunt în cronologie.
  const vanzariNeachitate = useMemo(
    () =>
      cronologie.flatMap((intrare) =>
        intrare.fel === 'produse' && !intrare.vanzare.achitat ? [intrare.vanzare] : [],
      ),
    [cronologie],
  )
  const deIncasat = sumaTotal([
    ...sedinteNeachitate.map((programare) => programare.pret),
    ...vanzariNeachitate.map((vanzare) => vanzare.total),
  ])

  // Identificatorul lipsă se tratează înaintea încărcării: interogarea este
  // oprită fără el (`enabled`), deci ecranul ar rămâne în așteptare la infinit.
  if (clientId === null || error) {
    return (
      <Pagina>
        <AntetPagina titlu="Fișa clientului" inapoi="/clienti" />
        <Card>
          <StareEroare
            mesaj={
              clientId === null
                ? 'Adresa nu conține un identificator de client.'
                : mesajEroare(error)
            }
            {...(clientId === null ? {} : { onReincearca: () => void refetch() })}
          />
        </Card>
      </Pagina>
    )
  }

  if (isPending || !client) return <IncarcarePagina text="Se încarcă fișa clientului…" />

  const arhivat = client.arhivat_la !== null
  const ani = varsta(client.data_nasterii)
  const creatDeNume =
    client.creat_de === null
      ? null
      : client.creat_de === utilizatorCurent.id
        ? utilizatorCurent.nume
        : (utilizatori?.find((u) => u.id === client.creat_de)?.nume ?? null)

  const comutaArhivarea = async () => {
    try {
      await arhiveaza.mutateAsync({ id: client.id, arhiveaza: !arhivat })
      notificari.succes(
        arhivat ? 'Fișa a fost readusă între cele active.' : 'Fișa a fost arhivată.',
        client.nume,
      )
    } catch (err) {
      notificari.eroare(mesajEroare(err))
    }
  }

  const stergeDefinitiv = async () => {
    try {
      await sterge.mutateAsync(client.id)
      notificari.succes('Fișa a fost ștearsă definitiv.', client.nume)
      navigate('/clienti', { replace: true })
    } catch (err) {
      setCereConfirmareStergere(false)
      // 409 de la ON DELETE RESTRICT: clientul are programări sau vânzări.
      // Mesajul serverului spune deja câte; noi adăugăm alternativa, pentru că
      // altfel operatoarea rămâne cu o interdicție și fără o soluție.
      notificari.eroare(
        mesajEroare(err),
        esteEroareApi(err) && err.cod === 'conflict'
          ? 'Arhivarea scoate fișa din listele curente și păstrează tot istoricul.'
          : undefined,
      )
    }
  }

  const file: Fila<FilaFisa>[] = [
    {
      valoare: 'istoric',
      eticheta: 'Istoric',
      contor: istoric.data === undefined ? undefined : cronologie.length,
    },
    { valoare: 'note', eticheta: 'Note', contor: note.data?.length },
    { valoare: 'acorduri', eticheta: 'Acorduri GDPR', contor: acorduri.data?.total },
  ]

  return (
    <Pagina>
      <AntetPagina
        inapoi="/clienti"
        titlu={
          <span className="flex items-center gap-2">
            <span className="truncate">{client.nume}</span>
            {arhivat && <InsemnInactiv text="Arhivat" />}
          </span>
        }
        descriere={arhivat ? `Arhivat la ${formateazaData(client.arhivat_la)}` : undefined}
        actiuni={
          <>
            {/* Arhivată, fișa nu mai primește vânzări noi — serverul le refuză. */}
            {functii.costuri && !arhivat && (
              <Buton onClick={() => setVanzareNoua(true)} className="tinta-atingere">
                <ShoppingBag className="size-4" />
                Vinde produse
              </Buton>
            )}
            <Buton onClick={() => setFormularDeschis(true)} className="tinta-atingere">
              <Pencil className="size-4" />
              Modifică
            </Buton>

            <Meniu
              declansator={({ deschis, comuta }) => (
                <Buton
                  dimensiune="icon"
                  aria-label="Alte acțiuni"
                  aria-expanded={deschis}
                  onClick={comuta}
                  className="tinta-atingere"
                >
                  <MoreVertical className="size-4.5" />
                </Buton>
              )}
            >
              <ElementMeniu
                onClick={comutaArhivarea}
                disabled={arhiveaza.isPending}
                pictograma={
                  arhivat ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />
                }
              >
                {arhivat ? 'Dezarhivează' : 'Arhivează'}
              </ElementMeniu>

              {/* Ștergerea definitivă este rută de administrator (§7). */}
              {esteAdministrator && (
                <>
                  <SeparatorMeniu />
                  <ElementMeniu
                    periculos
                    onClick={() => setCereConfirmareStergere(true)}
                    pictograma={<Trash2 className="size-4" />}
                  >
                    Șterge definitiv
                  </ElementMeniu>
                </>
              )}
            </Meniu>
          </>
        }
      />

      <div className="flex flex-col gap-4">
        <Card>
          <AntetCard titlu="Date de contact" />
          <CorpCard>
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Pereche eticheta="Telefon">
                {client.telefon && (
                  <a href={`tel:${client.telefon}`} className="tabular-nums hover:underline">
                    {client.telefon}
                  </a>
                )}
              </Pereche>
              <Pereche eticheta="E-mail">
                {client.email && (
                  <a href={`mailto:${client.email}`} className="hover:underline">
                    {client.email}
                  </a>
                )}
              </Pereche>
              <Pereche eticheta="Adresă">{client.adresa}</Pereche>
              <Pereche eticheta="Data nașterii">
                {client.data_nasterii && (
                  <>
                    {formateazaData(client.data_nasterii)}
                    {ani !== null && (
                      <span className="text-ink-faint">
                        {' · '}
                        {ani} {plural(ani, 'an', 'ani')}
                      </span>
                    )}
                  </>
                )}
              </Pereche>
              <Pereche eticheta="Fișă creată la">{formateazaData(client.creat_la)}</Pereche>
              <Pereche eticheta="Creată de">{creatDeNume}</Pereche>
            </dl>
          </CorpCard>
        </Card>

        {functii.tratamente && (
          <TratamenteleClientului
            clientId={client.id}
            onProgrameaza={(t) =>
              setProgramareDinTratament({
                client_id: t.client_id,
                articol_id: t.articol_id,
                tratament_id: t.id,
              })
            }
          />
        )}

        {/*
          Banda de plată.

          Apare doar când există ședințe onorate și neîncasate sau produse
          luate pe datorie, iar tonul este de avertizare, nu de eroare: banii se
          așteaptă, nu s-a stricat nimic. Stă deasupra filelor pentru că este
          singurul lucru de pe fișă care cere o acțiune acum, în fața clientului.
        */}
        {functii.costuri && (sedinteNeachitate.length > 0 || vanzariNeachitate.length > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-warning-soft px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-warning tabular-nums">
                De plată: {formateazaBani(deIncasat)}
              </p>
              <p className="mt-0.5 text-[13px] text-warning/80 tabular-nums">
                {[
                  sedinteNeachitate.length > 0 &&
                    `${sedinteNeachitate.length} ${plural(sedinteNeachitate.length, 'ședință neîncasată', 'ședințe neîncasate')}`,
                  vanzariNeachitate.length > 0 &&
                    `${vanzariNeachitate.length} ${plural(vanzariNeachitate.length, 'vânzare de produse neachitată', 'vânzări de produse neachitate')}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
            <Buton
              varianta="primar"
              onClick={() => setIncasareDeschisa(true)}
              className="tinta-atingere"
            >
              Încasează
            </Buton>
          </div>
        )}

        <Card className="overflow-hidden">
          <File file={file} activa={fila} onSchimba={setFila} className="px-2" />
          {fila === 'istoric' ? (
            <PanouIstoric clientId={client.id} />
          ) : fila === 'acorduri' ? (
            <PanouAcorduri clientId={client.id} />
          ) : (
            <PanouNote clientId={client.id} />
          )}
        </Card>
      </div>

      <FormularClient
        deschisa={formularDeschis}
        onInchide={() => setFormularDeschis(false)}
        client={client}
      />

      {functii.costuri && (
        <ModalaIncasare
          deschisa={incasareDeschisa}
          onInchide={() => setIncasareDeschisa(false)}
          clientId={client.id}
          clientNume={client.nume}
          sedinte={sedinteNeachitate}
          vanzari={vanzariNeachitate}
        />
      )}

      {vanzareNoua && (
        <FormularVanzare clientInitial={client.id} onInchide={() => setVanzareNoua(false)} />
      )}

      <FormularProgramare
        deschisa={programareDinTratament !== null}
        onInchide={() => setProgramareDinTratament(null)}
        initial={programareDinTratament}
      />

      <ModalaConfirmare
        deschisa={cereConfirmareStergere}
        onInchide={() => setCereConfirmareStergere(false)}
        onConfirma={stergeDefinitiv}
        inCurs={sterge.isPending}
        periculoasa
        titlu="Ștergi definitiv fișa?"
        etichetaConfirmare="Șterge definitiv"
        mesaj={`Fișa lui ${client.nume} și notele ei dispar din baza de date, fără posibilitate de recuperare. Dacă are programări sau vânzări, ștergerea va fi refuzată — în acel caz, arhiveaz-o.`}
      />
    </Pagina>
  )
}

// ---------------------------------------------------------------------------
// Istoric
// ---------------------------------------------------------------------------

/*
  Istoricul.

  `GET /clienti/:id/istoric` întoarce programările și vânzările într-un singur
  flux, deja ordonat descrescător, ca uniune discriminată pe `fel`. Ecranul nu
  reordonează nimic: ordinea este cea a serverului, iar cronologia se citește de
  sus în jos, cu cel mai recent eveniment primul — exact ce caută recepția când
  deschide fișa cu clientul în față.

  Fiecare panou își cere singur datele. Interogările au aceeași cheie ca cele
  din antetul cu file, deci react-query servește ambele din același răspuns.
*/
function PanouIstoric({ clientId }: { clientId: Uuid }) {
  const { data, isPending, error, refetch } = useIstoricClient(clientId)
  const intrari = useMemo(() => cronologiaFisei(data ?? []), [data])

  if (isPending) return <PanouInCurs />
  if (error) {
    return <StareEroare mesaj={mesajEroare(error)} onReincearca={() => void refetch()} />
  }
  if (intrari.length === 0) {
    return (
      <StareGoala
        titlu="Fără activitate înregistrată"
        descriere={
          functii.costuri
            ? 'Ședințele și produsele cumpărate apar aici, cele mai recente primele.'
            : 'Ședințele apar aici, cele mai recente primele.'
        }
      />
    )
  }

  return (
    <CorpCard>
      <ol>
        {intrari.map((intrare, indice) => (
          <li key={intrare.cheie} className="flex gap-3">
            {/* Bulina + firul care leagă intrările; firul lipsește la ultima. */}
            <div className="flex flex-col items-center" aria-hidden>
              <span
                className={cn(
                  'mt-1.5 size-2.5 shrink-0 rounded-full',
                  intrare.fel === 'programare'
                    ? 'bg-primary-400'
                    : intrare.vanzare.achitat
                      ? 'bg-success'
                      : 'bg-warning',
                )}
              />
              {indice < intrari.length - 1 && <span className="w-px flex-1 bg-line" />}
            </div>

            <div className={cn('min-w-0 flex-1', indice < intrari.length - 1 && 'pb-5')}>
              {intrare.fel === 'programare' ? (
                <IntrareProgramare programare={intrare.programare} />
              ) : intrare.fel === 'avans' ? (
                <IntrareAvans vanzare={intrare.vanzare} avansuri={intrare.avansuri} />
              ) : (
                <IntrareProduse vanzare={intrare.vanzare} produse={intrare.produse} />
              )}
            </div>
          </li>
        ))}
      </ol>
    </CorpCard>
  )
}

/** O intrare așa cum se vede pe fișă — nu neapărat un rând din răspuns. */
type IntrareFisa =
  | { cheie: string; fel: 'programare'; programare: ProgramareDetaliu }
  | { cheie: string; fel: 'produse'; vanzare: VanzareDetaliu; produse: VanzareLinieDetaliu[] }
  // Bani luați pe un abonament, înainte de ședințe (3 nov. 2026): nu au o ședință
  // sub care să se vadă, deci apar ei înșiși, până îi consumă ședințele.
  | { cheie: string; fel: 'avans'; vanzare: VanzareDetaliu; avansuri: VanzareLinieDetaliu[] }

/*
  Aceeași ședință, o singură dată.

  Serverul întoarce și programările, și încasările — pe bună dreptate, sunt
  două tabele diferite. Dar o încasare care nu face decât să stingă ședințe nu
  aduce nimic nou pe fișă: ședința este deja acolo, cu prețul ei, cu însemnul
  „Achitat” și cu data plății. Lăsate amândouă, aceeași ședință se citea de două
  ori — o dată ca ședință, o dată ca rând de bon — iar cine aduna coloana din
  dreapta obținea dublul sumei reale.

  Ce rămâne dintr-o încasare sunt produsele: crema luată de la recepție nu are
  altă intrare în care să apară, deci încasarea se păstrează, redusă la liniile
  de produs. Cea fără produse dispare cu totul.

  Pe ecranul „Încasări” bonul rămâne întreg. Acolo se citesc banii, iar un bon
  din care lipsesc ședințele pe care le-a stins ar fi un bon fals. Fișa
  răspunde la altă întrebare — „ce i-am făcut acestei femei și îmi mai
  datorează ceva?” — și pentru ea ședința este evenimentul, nu chitanța.
*/
function cronologiaFisei(istoric: IstoricIntrare[]): IntrareFisa[] {
  const intrari: IntrareFisa[] = []

  for (const intrare of istoric) {
    if (intrare.fel === 'programare') {
      intrari.push({
        cheie: `programare-${intrare.programare.id}`,
        fel: 'programare',
        programare: intrare.programare,
      })
      continue
    }

    // Fără costuri (fork-ul simplu) fișa arată doar ședințele: bonurile, produsele
    // și avansurile sunt bani.
    if (!functii.costuri) continue

    const avansuri = intrare.vanzare.linii.filter(esteAvans)
    if (avansuri.length > 0) {
      intrari.push({
        cheie: `avans-${intrare.vanzare.id}`,
        fel: 'avans',
        vanzare: intrare.vanzare,
        avansuri,
      })
    }

    const produse = intrare.vanzare.linii.filter(esteProdus)
    if (produse.length === 0) continue

    intrari.push({
      cheie: `vanzare-${intrare.vanzare.id}`,
      fel: 'produse',
      vanzare: intrare.vanzare,
      produse,
    })
  }

  return intrari
}

function IntrareProgramare({ programare }: { programare: ProgramareDetaliu }) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-ink">{programare.articol_denumire}</span>
          <InsemnStareProgramare stare={programare.stare} />
          {/*
            Însemnul de plată numai la ședințele onorate: una programată pentru
            joia viitoare nu este „de plată”, este neîntâmplată încă. La fel
            pentru cele anulate sau neprezentate — nu se încasează nimic.
          */}
          {functii.costuri && programare.stare === 'onorat' && <InsemnPlata achitat={programare.achitat} />}
        </span>
        {/* Prețul ședinței, chiar pe rândul ei: fișa arată singură cât costă. */}
        {functii.costuri && (
          <span className="text-sm font-semibold text-ink tabular-nums">
            {formateazaBani(programare.pret)}
          </span>
        )}
      </div>

      <p className="mt-0.5 text-[13px] text-ink-soft tabular-nums">
        {formateazaData(programare.incepe_la)} ·{' '}
        {formateazaInterval(programare.incepe_la, programare.se_termina_la)}
      </p>

      {/*
        Data plății, doar când nu este ziua ședinței.

        Plătit pe loc este cazul obișnuit și nu are ce adăuga — însemnul
        „Achitat” spune deja tot. Plătit altă zi este cazul care ridică
        întrebări la sfârșit de lună, așa că acolo scriem când. Este și
        singurul lucru pe care îl pierdeam scoțând bonul din cronologie.
      */}
      {functii.costuri && platitAltaZi(programare) && (
        <p className="mt-0.5 text-[12px] text-ink-faint tabular-nums">
          Achitat pe {formateazaData(programare.achitat_la)}
        </p>
      )}

      <p className="mt-1 flex items-center gap-1 text-[12px] text-ink-faint">
        <UserRound className="size-3.5" aria-hidden />
        {programare.executant_nume}
      </p>

      {programare.nota && (
        <p className="mt-1 text-[13px] leading-snug text-ink-soft">{programare.nota}</p>
      )}
    </>
  )
}

/** Achitată, dar în altă zi decât cea în care a avut loc. */
function platitAltaZi(programare: ProgramareDetaliu): boolean {
  if (programare.achitat_la === null) return false
  return !isSameDay(laData(programare.achitat_la), laData(programare.incepe_la))
}

/*
  Produsele cumpărate la recepție.

  Totalul de aici este al produselor, nu al bonului: ședințele stinse de aceeași
  plată își au prețul pe rândurile lor, mai jos în cronologie. Așa, coloana din
  dreapta se poate aduna de sus până jos și dă exact cât a lăsat clienta la
  clinică — ceea ce cu bonul întreg nu se putea.
*/
function IntrareProduse({
  vanzare,
  produse,
}: {
  vanzare: VanzareDetaliu
  produse: VanzareLinieDetaliu[]
}) {
  const bucati = Math.round(produse.reduce((total, linie) => total + linie.cantitate, 0))

  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        {/*
          Numărăm bucățile, nu rândurile: două creme pe un singur rând sunt tot
          două produse, iar antetul care ar fi spus „Produs cumpărat” deasupra
          unui „× 2” s-ar fi contrazis singur.
        */}
        <span className="text-sm font-medium text-ink">
          {bucati} {plural(bucati, 'produs cumpărat', 'produse cumpărate')}
        </span>
        <span className="text-sm font-semibold text-ink tabular-nums">
          {formateazaBani(sumaTotal(produse.map((linie) => linie.total_linie)))}
        </span>
      </div>

      <p className="mt-0.5 text-[13px] text-ink-soft tabular-nums">
        {formateazaData(vanzare.efectuat_la)}
      </p>

      <ul className="mt-1.5 flex flex-col gap-0.5">
        {produse.map((linie) => (
          <li key={linie.id} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-ink-soft">
              {linie.articol_denumire}
              {/* Cantitatea se arată doar când nu este 1: „× 1” este zgomot. */}
              {linie.cantitate !== 1 && (
                <span className="text-ink-faint tabular-nums">
                  {' × '}
                  {formateazaCantitate(linie.cantitate)}
                </span>
              )}
            </span>
            <span className="shrink-0 text-ink-faint tabular-nums">
              {formateazaBani(linie.total_linie)}
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-1 text-[12px] text-ink-faint">Operator: {vanzare.operator_nume}</p>

      {/* „Achitat” / „Neachitat” chiar pe rând: se bifează când clienta plătește. */}
      <PlataVanzarii vanzare={vanzare} compact className="mt-2 items-start" />
    </>
  )
}

/*
  Avansul pe abonament, cât n-a fost consumat de nicio ședință.

  Suma de aici este doar ce a RĂMAS din bon: ședințele stinse deja din el își au
  prețul pe rândurile lor, mai sus în cronologie, ca și la ședințele plătite
  direct — deci coloana din dreapta se poate aduna de sus până jos.
*/
function IntrareAvans({
  vanzare,
  avansuri,
}: {
  vanzare: VanzareDetaliu
  avansuri: VanzareLinieDetaliu[]
}) {
  return (
    <>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <span className="text-sm font-medium text-ink">Avans abonament</span>
        <span className="text-sm font-semibold text-ink tabular-nums">
          {formateazaBani(sumaTotal(avansuri.map((linie) => linie.total_linie)))}
        </span>
      </div>

      <p className="mt-0.5 text-[13px] text-ink-soft tabular-nums">
        {formateazaData(vanzare.efectuat_la)}
      </p>

      <ul className="mt-1.5 flex flex-col gap-0.5">
        {avansuri.map((linie) => (
          <li key={linie.id} className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-ink-soft">
              {linie.articol_denumire}
              <span className="text-ink-faint"> · pentru ședințele rămase</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-1 text-[12px] text-ink-faint">Operator: {vanzare.operator_nume}</p>
      <PlataVanzarii vanzare={vanzare} compact className="mt-2 items-start" />
    </>
  )
}

// ---------------------------------------------------------------------------
// Note
// ---------------------------------------------------------------------------

/*
  Notele.

  Se pot modifica (cerința clinicii, 2026-10-01): creionul de pe fiecare notă
  o deschide pe loc. Autorul și data scrierii rămân, „modificată pe …” spune
  că s-a schimbat, iar textul vechi rămâne în jurnal. Ștergere nu există —
  firul rămâne verificabil.

  Conținutul poate cuprinde date privind sănătatea (GDPR art. 9). Ecranul le
  arată doar aici, pe fișă, și nu oferă nicio cale de copiere sau de export în
  masă: minimizarea se aplică inclusiv interfeței, nu doar bazei de date.
*/
function PanouNote({ clientId }: { clientId: Uuid }) {
  const notificari = useNotificari()
  const { data, isPending, error, refetch } = useNoteClient(clientId)
  const adauga = useAdaugaNota()
  const [text, setText] = useState('')

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    const curat = text.trim()
    if (curat === '') return

    try {
      await adauga.mutateAsync({ client_id: clientId, text: curat })
      setText('')
      notificari.succes('Nota a fost adăugată.')
    } catch (err) {
      notificari.eroare(mesajEroare(err))
    }
  }

  return (
    <CorpCard className="flex flex-col gap-4 p-4">
      <form onSubmit={trimite} className="flex flex-col gap-2">
        <Textarea
          eticheta="Notă nouă"
          rows={3}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Observații despre client, preferințe, recomandări…"
          disabled={adauga.isPending}
        />
        <div className="flex justify-end">
          <Buton
            type="submit"
            varianta="primar"
            incarca={adauga.isPending}
            disabled={text.trim() === ''}
            className="tinta-atingere"
          >
            Adaugă nota
          </Buton>
        </div>
      </form>

      {isPending ? (
        <PanouInCurs />
      ) : error ? (
        <StareEroare mesaj={mesajEroare(error)} onReincearca={() => void refetch()} />
      ) : data.length === 0 ? (
        <StareGoala
          pictograma={<StickyNote className="size-5" />}
          titlu="Nicio notă"
          descriere="Prima notă rămâne în fișă cu autorul și data la care a fost scrisă."
        />
      ) : (
        <ol className="flex flex-col gap-3 border-t border-line pt-4">
          {data.map((nota) => (
            <RandNota key={nota.id} nota={nota} />
          ))}
        </ol>
      )}
    </CorpCard>
  )
}

/** O notă din listă: de citit, sau — după creion — de modificat pe loc. */
function RandNota({ nota }: { nota: NotaClientDetaliu }) {
  const notificari = useNotificari()
  const modifica = useModificaNota()
  const [text, setText] = useState<string | null>(null)
  const seModifica = text !== null

  const salveaza = async () => {
    const curat = (text ?? '').trim()
    if (curat === '') return
    try {
      await modifica.mutateAsync({ client_id: nota.client_id, nota_id: nota.id, text: curat })
      setText(null)
      notificari.succes('Nota a fost modificată.')
    } catch (err) {
      notificari.eroare(mesajEroare(err))
    }
  }

  return (
    <li className="rounded-lg bg-muted px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 text-[12px]">
        <span className="font-medium text-ink-soft">
          {/* Autorul poate fi șters (ON DELETE SET NULL) — nota rămâne. */}
          {nota.autor_nume ?? 'Cont șters'}
        </span>
        <span className="flex items-center gap-1 text-ink-faint tabular-nums">
          {formateazaDataOra(nota.creat_la)}
          {nota.modificat_la && (
            <span title={formateazaDataOra(nota.modificat_la)}>
              · modificată {formateazaData(nota.modificat_la)}
            </span>
          )}
          {!seModifica && (
            <Buton
              varianta="discret"
              dimensiune="icon-sm"
              onClick={() => setText(nota.text)}
              aria-label="Modifică nota"
              title="Modifică nota"
              className="-my-1 text-ink-faint hover:text-ink"
            >
              <Pencil className="size-3.5" />
            </Buton>
          )}
        </span>
      </div>
      {seModifica ? (
        <div className="mt-2 flex flex-col gap-2">
          <Textarea
            aria-label="Textul notei"
            rows={Math.min(10, Math.max(3, text.split('\n').length + 1))}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={modifica.isPending}
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <Buton dimensiune="sm" onClick={() => setText(null)} disabled={modifica.isPending}>
              Renunță
            </Buton>
            <Buton
              dimensiune="sm"
              varianta="primar"
              onClick={() => void salveaza()}
              incarca={modifica.isPending}
              disabled={text.trim() === ''}
            >
              Salvează
            </Buton>
          </div>
        </div>
      ) : (
        <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink">{nota.text}</p>
      )}
    </li>
  )
}

function PanouInCurs() {
  return (
    <div className="flex justify-center py-10 text-ink-faint">
      <Spinner />
    </div>
  )
}
