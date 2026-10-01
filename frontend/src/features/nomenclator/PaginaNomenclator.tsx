import { useMemo, useState, type ReactNode } from 'react'
import { Info, Plus, ShoppingBag, Tags } from 'lucide-react'
import { mesajEroare } from '@/api/errors'
import { useAutentificare } from '@/app/auth'
import { useArticole } from '@/app/queries'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
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

  Pe fila „Produse” stă și „Vinde produse”, pentru ORICE cont: acolo caută
  recepția când îi dă unei cliente niște creme (așa a desenat-o clinica:
  „Nomenclator → Produse → Maria → Cremă 50 ml / 150 RON”). Formularul este
  cel din „Încasări”, nu o copie.
*/

type FilaNomenclator = 'servicii' | 'produse'
type FiltruStare = 'toate' | 'active' | 'inactive'

const STARI: { valoare: FiltruStare; eticheta: string }[] = [
  { valoare: 'toate', eticheta: 'Toate' },
  { valoare: 'active', eticheta: 'Active' },
  { valoare: 'inactive', eticheta: 'Inactive' },
]

export function PaginaNomenclator() {
  const { esteAdministrator } = useAutentificare()

  const [fila, setFila] = useState<FilaNomenclator>('servicii')
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

  const file: Fila<FilaNomenclator>[] = [
    { valoare: 'servicii', eticheta: 'Servicii', contor: serviciiFiltrate.length },
    { valoare: 'produse', eticheta: 'Produse', contor: produseFiltrate.length },
  ]

  const actiuneNoua = {
    eticheta: fila === 'servicii' ? 'Serviciu nou' : 'Produs nou',
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
          ? 'Niciun rând nu corespunde căutării sau filtrului de stare.'
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
          esteAdministrator || fila === 'produse' ? (
            <>
              {esteAdministrator && (
                <Buton
                  // Pe „Produse”, vânzarea e gestul de zi cu zi; adăugarea în
                  // nomenclator trece pe planul doi.
                  varianta={fila === 'produse' ? 'secundar' : 'primar'}
                  onClick={actiuneNoua.porneste}
                >
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">{actiuneNoua.eticheta}</span>
                  <span className="sm:hidden">Adaugă</span>
                </Buton>
              )}
              {fila === 'produse' && (
                <Buton varianta="primar" onClick={() => setVanzareNoua(true)}>
                  <ShoppingBag className="size-4" />
                  Vinde produse
                </Buton>
              )}
            </>
          ) : undefined
        }
      />

      <File file={file} activa={fila} onSchimba={setFila} className="mb-4" />

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
        {fila === 'servicii' && (
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

        {fila === 'produse' && (
          <ListaArticole
            tip="produs"
            randuri={produseFiltrate}
            incarca={produse.isFetching}
            eroare={produse.isError ? mesajEroare(produse.error) : null}
            onReincearca={() => void produse.refetch()}
            onDeschide={esteAdministrator ? setArticolEditat : undefined}
            onVinde={(produs) => {
              setProdusDeVandut(produs)
              setVanzareNoua(true)
            }}
            stareGoala={stareGoala(
              'Niciun produs în nomenclator',
              'Produsele adăugate aici pot fi trecute pe liniile unei vânzări.',
            )}
          />
        )}

      </Card>

      {fila === 'produse' && <VanzariNeachitate />}

      {articolEditat !== null && (
        <FormularArticol
          articol={articolEditat === 'nou' ? null : articolEditat}
          tipInitial={fila === 'produse' ? 'produs' : 'serviciu'}
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
