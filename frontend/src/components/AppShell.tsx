import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { LogOut, MonitorCog, Moon, MoreHorizontal, Sun } from 'lucide-react'
import { esteModDemo } from '@/api'
import { useAutentificare } from '@/app/auth'
import { esteInElement, navigarePentru, type ElementNavigare } from '@/app/navigation'
import { useTema, type Tema } from '@/app/theme'
import { cn } from '@/lib/cn'
import { Avatar, Buton, ElementMeniu, Meniu, SeparatorMeniu, TitluMeniu } from '@/ui'

/*
  Cadrul aplicației.

  Aceeași bază de cod servește trei platforme (art. 2.2), deci navigația are
  două înfățișări din aceeași sursă de adevăr:

    - lat  (≥ lg): bară laterală permanentă, cu etichete;
    - îngust    : bară jos cu pictograme, în zona în care ajunge degetul mare.

  Bara de jos respectă `pb-sigur`, altfel pe iPhone ar cădea sub bara de
  gesturi și butoanele de la margine ar deveni imposibil de atins.
*/

export function CadruAplicatie() {
  const { utilizator, esteAdministrator } = useAutentificare()
  const elemente = navigarePentru(esteAdministrator)
  const principale = elemente.filter((e) => e.principal)
  const secundare = elemente.filter((e) => !e.principal)

  if (!utilizator) return null

  return (
    <div className="flex h-ecran flex-col lg:flex-row">
      <BaraLaterala elemente={elemente} />

      {/*
        `min-h-0` nu este ornament — el este cel care ține cadrul în ecran.

        Un element de flex primește implicit `min-height: auto`, adică „nu te
        micșora sub conținutul tău”. Coloana aceasta moștenea regula și, cu o
        listă de 61 de fișe, creștea la 3600 de pixeli în loc să se oprească la
        844: depășea cadrul, `main` primea toată acea înălțime ca spațiu liber,
        iar `overflow-y: auto` nu mai avea ce tăia. Nimic nu derula înăuntru —
        se mișca documentul întreg, ducând cu el și bara de file. De acolo venea
        senzația că bara „nu stă jos”: nu se dezlipea de nicăieri, pleca în sus
        odată cu pagina.

        `min-w-0` era deja aici pentru exact aceeași regulă pe orizontală, la
        trunchierea textelor. Îi lipsea perechea.
      */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AntetMobil />
        {esteModDemo && <PanglicaDemo />}

        {/*
          Derularea se întâmplă AICI, nu în document: cadrul are exact înălțimea
          ferestrei, iar lista lungă se mișcă înăuntru, sub antet și deasupra
          barei de file.

          `overscroll-contain` oprește mișcarea la capătul listei în loc să o
          predea paginii de dedesubt — pe telefon, tragerea peste ultima
          programare ar clătina altfel tot cadrul. Are însă o condiție: `main`
          chiar trebuie să fie ceva ce derulează. Cât timp coloana de deasupra
          creștea nemărginit (v. `min-h-0`), `main` nu avea nimic de derulat,
          iar „contain” tăia și singura mișcare rămasă — a documentului. Ecranul
          îngheța complet. Cele două linii se țin una pe alta; nu se separă.
        */}
        <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <Outlet />
        </main>

        <BaraJos principale={principale} secundare={secundare} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bara laterală (desktop)
// ---------------------------------------------------------------------------

function BaraLaterala({ elemente }: { elemente: ElementNavigare[] }) {
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface lg:flex">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <SiglaClinica />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">Gestiune Clinică</p>
          <p className="truncate text-[11px] text-ink-faint">Aplicație internă</p>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2.5 py-2">
        {elemente.map((element) => (
          <NavLink
            key={element.cale}
            to={element.cale}
            title={element.descriere}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium',
                'transition-colors',
                isActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-ink-soft hover:bg-muted hover:text-ink',
              )
            }
          >
            <element.pictograma className="size-4.5 shrink-0" />
            <span className="truncate">{element.eticheta}</span>
          </NavLink>
        ))}
      </nav>

      <MeniuCont />
    </aside>
  )
}

function SiglaClinica() {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-600 text-white">
      <svg viewBox="0 0 24 24" fill="none" className="size-5" aria-hidden>
        <path
          d="M12 21c4.97-3.2 7.5-6.5 7.5-9.9A5.1 5.1 0 0 0 12 6.6a5.1 5.1 0 0 0-7.5 4.5c0 3.4 2.53 6.7 7.5 9.9Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
        <path d="M12 6.6V3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      </svg>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Antetul de pe telefon
// ---------------------------------------------------------------------------

function AntetMobil() {
  const location = useLocation()
  const { esteAdministrator } = useAutentificare()
  const curent = navigarePentru(esteAdministrator).find((e) => esteInElement(location.pathname, e))

  return (
    <header
      className={cn(
        'flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-2.5',
        // `sticky` din același motiv ca la bara de jos, și de la aceeași margine
        // opusă: antetul și bara de file se pierd sau rămân împreună.
        'sticky top-0 z-20 pt-sigur lg:hidden',
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <SiglaClinica />
        <p className="truncate text-[15px] font-semibold text-ink">
          {curent?.eticheta ?? 'Gestiune Clinică'}
        </p>
      </div>
      <MeniuCont compact />
    </header>
  )
}

// ---------------------------------------------------------------------------
// Bara de jos (telefon)
// ---------------------------------------------------------------------------

function BaraJos({
  principale,
  secundare,
}: {
  principale: ElementNavigare[]
  secundare: ElementNavigare[]
}) {
  const [meniuDeschis, setMeniuDeschis] = useState(false)
  const location = useLocation()
  const inSecundar = secundare.some((e) => esteInElement(location.pathname, e))

  return (
    <>
      <nav
        /*
          `sticky bottom-0` peste așezarea în coloană.

          Când cadrul are într-adevăr înălțimea ferestrei, bara este ultimul
          element al coloanei și stă jos oricum; `sticky` nu face nimic. Când
          ceva scapă acea înălțime — tastatura care urcă, o măsurătoare de
          viewport care nu se potrivește cu ce se vede — documentul începe să se
          deruleze, iar bara pleacă în sus împreună cu el. `sticky` o lipește
          înapoi de marginea de jos, fără să o scoată din flux: rămâne cu locul
          ei rezervat, deci nu acoperă ultimul rând din listă, cum ar face
          `fixed`.

          `z-20`, nu mai sus: bara trebuie să treacă peste conținutul paginii —
          peste coloana de ore din grila zilei, care e tot pe 20 și pierde la
          ordinea din document — dar să rămână SUB listele care se deschid
          (`z-30`). O bară pe 30 ar fi acoperit ultimele rânduri ale unui
          selector deschis în josul ecranului, adică exact acolo unde degetul
          îl deschide.
        */
        className="sticky bottom-0 z-20 grid shrink-0 border-t border-line bg-surface pb-sigur lg:hidden"
        // Numărul de coloane depinde de rol, deci nu poate fi o clasă Tailwind
        // statică — acelea se generează la compilare, nu la rulare.
        style={{ gridTemplateColumns: `repeat(${principale.length + 1}, minmax(0, 1fr))` }}
      >
        {principale.map((element) => (
          <NavLink
            key={element.cale}
            to={element.cale}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors',
                'tinta-atingere',
                isActive ? 'text-primary-600' : 'text-ink-faint',
              )
            }
          >
            <element.pictograma className="size-5" />
            <span className="truncate px-1">{element.etichetaScurta ?? element.eticheta}</span>
          </NavLink>
        ))}

        <button
          type="button"
          onClick={() => setMeniuDeschis(true)}
          className={cn(
            'flex flex-col items-center gap-1 py-2 text-[11px] font-medium transition-colors',
            'tinta-atingere',
            inSecundar ? 'text-primary-600' : 'text-ink-faint',
          )}
        >
          <MoreHorizontal className="size-5" />
          <span>Mai mult</span>
        </button>
      </nav>

      {/*
        Restul secțiunilor, ca foaie de jos. Bara are loc pentru patru ținte de
        atingere; a înghesui șase ar coborî fiecare sub pragul de 44px.
      */}
      {meniuDeschis && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMeniuDeschis(false)}
        >
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-line bg-elevated p-2 pb-sigur anim-intrare-foaie"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center py-2" aria-hidden>
              <span className="h-1 w-9 rounded-full bg-line-strong" />
            </div>
            {secundare.map((element) => (
              <NavLink
                key={element.cale}
                to={element.cale}
                onClick={() => setMeniuDeschis(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors',
                    isActive ? 'bg-primary-50 text-primary-700' : 'text-ink',
                  )
                }
              >
                <element.pictograma className="size-5 shrink-0 text-ink-faint" />
                <span className="min-w-0">
                  <span className="block font-medium">{element.eticheta}</span>
                  <span className="block text-[12px] text-ink-faint">{element.descriere}</span>
                </span>
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Contul
// ---------------------------------------------------------------------------

const etichetaTema: Record<Tema, string> = {
  sistem: 'Ca sistemul',
  deschisa: 'Temă deschisă',
  intunecata: 'Temă întunecată',
}

function MeniuCont({ compact = false }: { compact?: boolean }) {
  const { utilizator, delogheaza, esteAdministrator } = useAutentificare()
  const { tema, setTema } = useTema()
  if (!utilizator) return null

  return (
    <div className={cn(!compact && 'border-t border-line p-2.5')}>
      <Meniu
        aliniere={compact ? 'dreapta' : 'stanga'}
        // Pe calculator butonul stă lipit de marginea de jos a barei laterale:
        // desfăcut în jos, meniul ar cădea sub marginea ferestrei. În antetul
        // de telefon („compact”) stă sus, deci acolo se desface normal.
        directie={compact ? 'jos' : 'sus'}
        declansator={({ comuta, deschis }) => (
          <button
            type="button"
            onClick={comuta}
            aria-expanded={deschis}
            className={cn(
              'flex items-center gap-2.5 rounded-lg transition-colors hover:bg-muted',
              compact ? 'p-0.5' : 'w-full px-2 py-1.5',
            )}
          >
            <Avatar nume={utilizator.nume} dimensiune={compact ? 'sm' : 'md'} />
            {!compact && (
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[13px] font-medium text-ink">
                  {utilizator.nume}
                </span>
                <span className="block truncate text-[11px] text-ink-faint">
                  {esteAdministrator ? 'Administrator' : 'Utilizator'}
                </span>
              </span>
            )}
          </button>
        )}
      >
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium text-ink">{utilizator.nume}</p>
          <p className="truncate text-[12px] text-ink-faint">{utilizator.email}</p>
        </div>
        <SeparatorMeniu />

        <TitluMeniu>Aspect</TitluMeniu>
        {(['sistem', 'deschisa', 'intunecata'] as Tema[]).map((valoare) => (
          <ElementMeniu
            key={valoare}
            onClick={() => setTema(valoare)}
            pictograma={
              valoare === 'sistem' ? (
                <MonitorCog className="size-4" />
              ) : valoare === 'deschisa' ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )
            }
          >
            <span className={cn(tema === valoare && 'font-semibold text-primary-700')}>
              {etichetaTema[valoare]}
            </span>
          </ElementMeniu>
        ))}

        <SeparatorMeniu />
        <ElementMeniu
          onClick={() => void delogheaza()}
          pictograma={<LogOut className="size-4" />}
          periculos
        >
          Deconectare
        </ElementMeniu>
      </Meniu>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Semnalizarea datelor demo
// ---------------------------------------------------------------------------

/**
 * Cât timp aplicația rulează pe date în memorie, spune-o explicit.
 *
 * Fără acest avertisment, cineva ar putea introduce date reale de client
 * într-o versiune care le pierde la închiderea ferestrei — și, potrivit
 * art. 8.3, acelea pot fi date privind sănătatea.
 */
function PanglicaDemo() {
  const [ascunsa, setAscunsa] = useState(false)
  if (ascunsa) return null

  return (
    <div className="flex items-center gap-2 border-b border-warning/25 bg-warning-soft px-4 py-1.5 text-[12px] text-warning">
      <span className="flex-1">
        <strong className="font-semibold">Date demonstrative.</strong> Aplicația nu este conectată
        la server; modificările se pierd la închidere.
      </span>
      <Buton
        varianta="discret"
        dimensiune="sm"
        onClick={() => setAscunsa(true)}
        className="h-6 px-1.5 text-[12px] text-warning hover:bg-warning/10"
      >
        Am înțeles
      </Buton>
    </div>
  )
}
