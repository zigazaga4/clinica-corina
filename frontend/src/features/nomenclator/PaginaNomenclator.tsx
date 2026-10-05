import { useMemo, useState, type ReactNode } from 'react'
import { Info, Plus, ShoppingBag, Tags } from 'lucide-react'
import { mesajEroare } from '@/api/errors'
import { useAutentificare } from '@/app/auth'
import { useArticole } from '@/app/queries'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { categoriileProduselor } from '@/domain/categorii'
import type { Articol } from '@/domain/types'
import { contine } from '@/lib/text'
import {
  Buton,
  ButonGrup,
  Card,
  CampCautare,
  File,
  GrupButoane,
  StareGoala,
  type Fila,
} from '@/ui'
import { FormularVanzare } from '../vanzari/FormularVanzare'
import { VanzariNeachitate } from '../vanzari/VanzariNeachitate'
import { FormularArticol } from './FormularArticol'
import { ListaArticole } from './liste'

/*
  Nomenclatorul: serviciile și produsele din ofertă.

  NU există ștergere — §7 nu prevede DELETE pe /articole, iar asta este
  intenționat: un serviciu scos din ofertă rămâne referit de programările și de
  vânzările deja înregistrate, iar o ștergere ar rupe istoricul pe care se
  sprijină rapoartele. Singurul mod de a scoate ceva din uz este comutatorul
  „Activ” din formulare, iar în ecran nu apare niciun buton de ștergere.

  Citirea este deschisă tuturor; POST și PATCH sunt rezervate administratorului
  (§7). Pentru ceilalți ecranul rămâne o listă, fără butoane care oricum ar fi
  respinse de server — dar cu o notă care spune cine face modificările, ca
  absența butoanelor să nu pară o defecțiune.

  Punctele de lucru nu mai au filă: clinica are o singură locație.

  Pe filele de produse stă și „Vinde produse”, pentru ORICE cont: acolo caută
  recepția când îi dă unei cliente niște creme (așa a desenat-o clinica:
  „Nomenclator → Produse → Maria → Cremă 50 ml / 150 RON”). Formularul este
  cel din „Încasări”, nu o copie.

  Fiecare categorie de produse are fila ei, lângă „Servicii” — cerut de
  clinică: „Servicii | Produse clienți | Produse colaboratori”, nu o singură
  filă „Produse” cu un filtru înăuntru. Filele se citesc din categoriile
  folosite, deci o categorie nouă își face singură loc. Produsele rămase fără
  categorie stau la „Alte produse”, fila care apare doar cât timp există; fără
  nicio categorie, fila lor se cheamă simplu „Produse”.
*/

/**
 * Cheia filei: „servicii”, „produse” (produsele fără categorie) sau
 * `categorie:<nume>` — o categorie poate avea orice nume, deci nu poate fi
 * ea însăși cheia fără să se ciocnească, cândva, cu primele două.
 */
type FilaNomenclator = string
const FILA_SERVICII = 'servicii'
const FILA_FARA_CATEGORIE = 'produse'
const PREFIX_CATEGORIE = 'categorie:'

/** Categoria produselor de pe filă; null = fără categorie. */
function categoriaFilei(fila: FilaNomenclator): string | null {
  return fila.startsWith(PREFIX_CATEGORIE) ? fila.slice(PREFIX_CATEGORIE.length) : null
}

type FiltruStare = 'toate' | 'active' | 'inactive'

const STARI: { valoare: FiltruStare; eticheta: string }[] = [
  { valoare: 'toate', eticheta: 'Toate' },
  { valoare: 'active', eticheta: 'Active' },
  { valoare: 'inactive', eticheta: 'Inactive' },
]

export function PaginaNomenclator() {
  const { esteAdministrator } = useAutentificare()

  const [fila, setFila] = useState<FilaNomenclator>(FILA_SERVICII)
  const [cautare, setCautare] = useState('')
  const [stare, setStare] = useState<FiltruStare>('toate')

  // `'nou'` distinge „formular deschis pentru o înregistrare nouă” de „închis”.
  const [articolEditat, setArticolEditat] = useState<Articol | 'nou' | null>(null)
  const [vanzareNoua, setVanzareNoua] = useState(false)
  // Produsul al cărui „Vinde” s-a apăsat: pornește vânzarea cu el pe bon.
  const [produsDeVandut, setProdusDeVandut] = useState<Articol | null>(null)

  // Starea merge în filtrul cererii (are trei valori, deci cel mult trei chei în
  // memoria cache), denumirea se filtrează local: nomenclatorul unei clinici are
  // zeci de rânduri, deja aduse integral pentru selectoarele din programări și
  // vânzări. O cerere la fiecare literă tastată n-ar aduce nimic în plus, iar
  // `contine` ignoră diacriticele, la fel ca trigramele din bază.
  const filtruStare = stare === 'toate' ? {} : { activ: stare === 'active' }

  const servicii = useArticole({ tip: 'serviciu', ...filtruStare })
  const produse = useArticole({ tip: 'produs', ...filtruStare })

  const serviciiFiltrate = useMemo(
    () => (servicii.data ?? []).filter((articol) => contine(articol.denumire, cautare)),
    [servicii.data, cautare],
  )
  const produseFiltrate = useMemo(
    () => (produse.data ?? []).filter((articol) => contine(articol.denumire, cautare)),
    [produse.data, cautare],
  )

  // Filele produselor vin din TOATE produsele, nu din cele filtrate pe stare:
  // altfel o filă ar dispărea sub cursor la „Inactive”. Aceeași cerere ca a
  // formularului de produs — din memoria cache, fără drum în plus la server.
  const toateProdusele = useArticole({ tip: 'produs' })
  const categorii = useMemo(
    () => categoriileProduselor(toateProdusele.data ?? []),
    [toateProdusele.data],
  )
  const areFaraCategorie = (toateProdusele.data ?? []).some((a) => a.categorie === null)
  const cateIn = (categorie: string | null) =>
    produseFiltrate.filter((a) => a.categorie === categorie).length

  const file: Fila<FilaNomenclator>[] = [
    { valoare: FILA_SERVICII, eticheta: 'Servicii', contor: serviciiFiltrate.length },
    ...categorii.map((c) => ({ valoare: PREFIX_CATEGORIE + c, eticheta: c, contor: cateIn(c) })),
    ...(categorii.length === 0 || areFaraCategorie
      ? [
          {
            valoare: FILA_FARA_CATEGORIE,
            eticheta: categorii.length === 0 ? 'Produse' : 'Alte produse',
            contor: cateIn(null),
          },
        ]
      : []),
  ]
  // Fila unei categorii golite între timp (ultimul ei produs mutat în alta)
  // nu mai există: ecranul se întoarce la servicii, nu rămâne pe o filă fantomă.
  const filaActiva = file.some((f) => f.valoare === fila) ? fila : FILA_SERVICII
  const peProduse = filaActiva !== FILA_SERVICII
  const categorieActiva = peProduse ? categoriaFilei(filaActiva) : null
  const produseleFilei = useMemo(
    () => produseFiltrate.filter((a) => a.categorie === categorieActiva),
    [produseFiltrate, categorieActiva],
  )

  const actiuneNoua = {
    eticheta: peProduse ? 'Produs nou' : 'Serviciu nou',
    porneste: () => setArticolEditat('nou'),
  }

  const areFiltre = cautare.trim() !== '' || stare !== 'toate'
  const golesteFiltrele = () => {
    setCautare('')
    setStare('toate')
  }

  // Lista goală din cauza filtrelor și lista goală pentru că nu s-a creat încă
  // nimic arată la fel, dar cer lucruri diferite de la utilizator.
  const stareGoala = (titluGol: string, descriereGoala: string): ReactNode => (
    <StareGoala
      pictograma={<Tags className="size-5" />}
      titlu={areFiltre ? 'Niciun rezultat' : titluGol}
      descriere={
        areFiltre
          ? 'Niciun rând nu corespunde căutării sau filtrelor.'
          : descriereGoala
      }
      {...(areFiltre
        ? { actiune: { eticheta: 'Golește filtrele', onClick: golesteFiltrele } }
        : esteAdministrator
          ? { actiune: { eticheta: actiuneNoua.eticheta, onClick: actiuneNoua.porneste } }
          : {})}
    />
  )

  return (
    <Pagina>
      <AntetPagina
        titlu="Nomenclator"
        descriere="Serviciile și produsele din ofertă."
        actiuni={
          esteAdministrator || peProduse ? (
            <>
              {esteAdministrator && (
                <Buton
                  // Pe produse, vânzarea e gestul de zi cu zi; adăugarea în
                  // nomenclator trece pe planul doi.
                  varianta={peProduse ? 'secundar' : 'primar'}
                  onClick={actiuneNoua.porneste}
                >
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">{actiuneNoua.eticheta}</span>
                  <span className="sm:hidden">Adaugă</span>
                </Buton>
              )}
              {peProduse && (
                <Buton varianta="primar" onClick={() => setVanzareNoua(true)}>
                  <ShoppingBag className="size-4" />
                  Vinde produse
                </Buton>
              )}
            </>
          ) : undefined
        }
      />

      <File file={file} activa={filaActiva} onSchimba={setFila} className="mb-4" />

      <BaraFiltre>
        <CampCautare
          valoare={cautare}
          onSchimba={setCautare}
          placeholder="Caută după denumire…"
          aria-label="Caută în nomenclator"
          containerClassName="w-56 sm:w-72"
        />
        <GrupButoane eticheta="Filtrare după stare">
          {STARI.map((optiune) => (
            <ButonGrup
              key={optiune.valoare}
              activ={stare === optiune.valoare}
              onClick={() => setStare(optiune.valoare)}
              className="h-11 px-3 sm:h-8"
            >
              {optiune.eticheta}
            </ButonGrup>
          ))}
        </GrupButoane>
      </BaraFiltre>

      {!esteAdministrator && (
        <p className="mb-3 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-[13px] text-ink-soft">
          <Info className="mt-px size-4 shrink-0 text-ink-faint" aria-hidden />
          Nomenclatorul poate fi consultat de oricine, dar adăugarea și modificarea se fac din
          contul de administrator.
        </p>
      )}

      <Card className="overflow-hidden">
        {!peProduse && (
          <ListaArticole
            tip="serviciu"
            randuri={serviciiFiltrate}
            incarca={servicii.isFetching}
            eroare={servicii.isError ? mesajEroare(servicii.error) : null}
            onReincearca={() => void servicii.refetch()}
            onDeschide={esteAdministrator ? setArticolEditat : undefined}
            stareGoala={stareGoala(
              'Niciun serviciu în nomenclator',
              'Serviciile adăugate aici pot fi programate în calendar și vândute.',
            )}
          />
        )}

        {peProduse && (
          <ListaArticole
            tip="produs"
            randuri={produseleFilei}
            incarca={produse.isFetching}
            eroare={produse.isError ? mesajEroare(produse.error) : null}
            onReincearca={() => void produse.refetch()}
            onDeschide={esteAdministrator ? setArticolEditat : undefined}
            onVinde={(produs) => {
              setProdusDeVandut(produs)
              setVanzareNoua(true)
            }}
            stareGoala={stareGoala(
              categorieActiva ? `Niciun produs în „${categorieActiva}”` : 'Niciun produs în nomenclator',
              'Produsele adăugate aici pot fi trecute pe liniile unei vânzări.',
            )}
          />
        )}

      </Card>

      {peProduse && <VanzariNeachitate />}

      {articolEditat !== null && (
        <FormularArticol
          articol={articolEditat === 'nou' ? null : articolEditat}
          tipInitial={peProduse ? 'produs' : 'serviciu'}
          // Produsul nou pornit de pe fila colaboratorilor intră în ea.
          categorieInitiala={categorieActiva}
          onInchide={() => setArticolEditat(null)}
        />
      )}

      {vanzareNoua && (
        <FormularVanzare
          {...(produsDeVandut ? { produsInitial: produsDeVandut } : {})}
          onInchide={() => {
            setVanzareNoua(false)
            setProdusDeVandut(null)
          }}
        />
      )}
    </Pagina>
  )
}
