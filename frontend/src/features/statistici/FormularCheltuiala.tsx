import { useMemo, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import {
  useCategoriiCheltuieli,
  useCreeazaCheltuiala,
  useModificaCheltuiala,
  useStergeCheltuiala,
} from '@/app/queries'
import { GrilaFormular, PeToataLatimea } from '@/components/Pagina'
import type { CheltuialaDetaliu } from '@/domain/types'
import { laInputDate } from '@/lib/dates'
import { useEroriFormular } from '@/lib/formular'
import { formateazaBani, numarInCamp, parseNumar } from '@/lib/money'
import {
  Buton,
  Combobox,
  Input,
  Modala,
  ModalaConfirmare,
  Textarea,
  useNotificari,
  type OptiuneCombobox,
} from '@/ui'

type Camp = 'data' | 'categorie' | 'suma' | 'descriere'

/**
 * Categoriile propuse unei clinici care n-a scris încă nimic. După primele
 * cheltuieli, lista începe cu ce folosește ea — cele mai folosite întâi — iar
 * o categorie nouă se scrie direct în căutare.
 */
const CATEGORII_OBISNUITE = [
  'Chirie',
  'Salarii',
  'Utilități',
  'Consumabile',
  'Produse pentru vânzare',
  'Echipamente',
  'Marketing',
  'Taxe și impozite',
  'Altele',
]

/**
 * Cheltuiala nouă sau corectată. Montat doar cât e deschis (cu `key` pe rând),
 * deci câmpurile pornesc curate fără un efect care să le resincronizeze.
 */
export function FormularCheltuiala({
  cheltuiala,
  onInchide,
}: {
  cheltuiala?: CheltuialaDetaliu
  onInchide: () => void
}) {
  const notificari = useNotificari()
  const erori = useEroriFormular<Camp>()
  const categoriiFolosite = useCategoriiCheltuieli()
  const creeaza = useCreeazaCheltuiala()
  const modifica = useModificaCheltuiala()
  const sterge = useStergeCheltuiala()
  const seTrimite = creeaza.isPending || modifica.isPending

  const [data, setData] = useState(cheltuiala?.data ?? laInputDate(new Date()))
  const [categorie, setCategorie] = useState<string | null>(cheltuiala?.categorie ?? null)
  const [suma, setSuma] = useState(cheltuiala ? numarInCamp(cheltuiala.suma) : '')
  const [descriere, setDescriere] = useState(cheltuiala?.descriere ?? '')
  const [confirmaStergerea, setConfirmaStergerea] = useState(false)

  const optiuni = useMemo<OptiuneCombobox<string>[]>(() => {
    const folosite = categoriiFolosite.data ?? []
    const toate = [
      ...folosite,
      ...CATEGORII_OBISNUITE.filter((c) => !folosite.some((f) => f.toLowerCase() === c.toLowerCase())),
      // Categoria scrisă acum, care nu există încă nicăieri.
      ...(categorie && ![...folosite, ...CATEGORII_OBISNUITE].includes(categorie) ? [categorie] : []),
    ]
    return toate.map((c) => ({ valoare: c, eticheta: c }))
  }, [categoriiFolosite.data, categorie])

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    erori.goleste()

    const valoare = parseNumar(suma)
    if (!data) return erori.setCamp('data', 'Alege ziua plății.')
    if (!categorie) return erori.setCamp('categorie', 'Alege categoria.')
    if (valoare === null || valoare <= 0) return erori.setCamp('suma', 'Scrie suma, mai mare ca zero.')

    const date = {
      data,
      categorie,
      suma: valoare,
      descriere: descriere.trim() === '' ? null : descriere.trim(),
    }
    try {
      if (cheltuiala) {
        await modifica.mutateAsync({ id: cheltuiala.id, date })
        notificari.succes('Cheltuială modificată')
      } else {
        await creeaza.mutateAsync(date)
        notificari.succes(`Cheltuială adăugată: ${formateazaBani(valoare)}`)
      }
      onInchide()
    } catch (err) {
      erori.preia(err)
    }
  }

  const stergeCheltuiala = async () => {
    if (!cheltuiala) return
    try {
      await sterge.mutateAsync(cheltuiala.id)
      notificari.succes('Cheltuială ștearsă')
      setConfirmaStergerea(false)
      onInchide()
    } catch (err) {
      setConfirmaStergerea(false)
      erori.preia(err)
    }
  }

  return (
    <>
      <Modala
        deschisa
        onInchide={onInchide}
        blocata={seTrimite || sterge.isPending}
        titlu={cheltuiala ? 'Modifică cheltuiala' : 'Cheltuială nouă'}
        descriere="Banii ieșiți din clinică — se scad din încasări în profitul din Statistici."
        subsol={
          <>
            {cheltuiala && (
              <Buton
                varianta="discret"
                onClick={() => setConfirmaStergerea(true)}
                disabled={seTrimite}
                className="text-danger hover:text-danger sm:mr-auto"
              >
                <Trash2 className="size-4" />
                Șterge
              </Buton>
            )}
            <Buton onClick={onInchide} disabled={seTrimite} plin className="sm:w-auto">
              Renunță
            </Buton>
            <Buton
              varianta="primar"
              type="submit"
              form="formular-cheltuiala"
              incarca={seTrimite}
              plin
              className="sm:w-auto"
            >
              {cheltuiala ? 'Salvează' : 'Adaugă cheltuiala'}
            </Buton>
          </>
        }
      >
        <form id="formular-cheltuiala" onSubmit={trimite} noValidate className="flex flex-col gap-4">
          <GrilaFormular coloane={2}>
            <Input
              type="date"
              eticheta="Ziua plății"
              obligatoriu
              value={data}
              onChange={(e) => setData(e.target.value)}
              eroare={erori.peCamp.data ?? null}
            />
            <Input
              eticheta="Suma"
              obligatoriu
              inputMode="decimal"
              value={suma}
              onChange={(e) => setSuma(e.target.value)}
              placeholder="0,00"
              sufix={<span className="text-[13px] text-ink-faint">RON</span>}
              eroare={erori.peCamp.suma ?? null}
              autoFocus={!cheltuiala}
            />
            <PeToataLatimea>
              <Combobox
                eticheta="Categoria"
                obligatoriu
                optiuni={optiuni}
                valoare={categorie}
                onSchimba={setCategorie}
                placeholder="Chirie, salarii, consumabile…"
                onCreare={(text) => setCategorie(text.trim())}
                etichetaCreare={(text) => `Categorie nouă: „${text.trim()}”`}
                eroare={erori.peCamp.categorie ?? null}
              />
            </PeToataLatimea>
            <PeToataLatimea>
              <Textarea
                eticheta="Descriere"
                value={descriere}
                onChange={(e) => setDescriere(e.target.value)}
                placeholder="Pentru ce, de la cine…"
                rows={2}
              />
            </PeToataLatimea>
          </GrilaFormular>

          {erori.general && (
            <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {erori.general}
            </p>
          )}
        </form>
      </Modala>

      <ModalaConfirmare
        deschisa={confirmaStergerea}
        onInchide={() => setConfirmaStergerea(false)}
        onConfirma={() => void stergeCheltuiala()}
        titlu="Ștergi cheltuiala?"
        mesaj={
          cheltuiala
            ? `${cheltuiala.categorie}, ${formateazaBani(cheltuiala.suma)}. Profitul perioadei crește cu această sumă. Ștergerea rămâne în jurnal.`
            : ''
        }
        etichetaConfirmare="Șterge"
        periculoasa
        inCurs={sterge.isPending}
      />
    </>
  )
}
