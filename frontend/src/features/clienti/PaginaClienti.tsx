import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive, ChevronRight, Plus, SearchX, Users } from 'lucide-react'
import type { FiltruClienti } from '@/api/contract'
import { mesajEroare } from '@/api/errors'
import { useClienti } from '@/app/queries'
import { AntetPagina, BaraFiltre, Pagina } from '@/components/Pagina'
import { InsemnInactiv } from '@/components/insemne'
import type { ClientListItem } from '@/domain/types'
import { formateazaData } from '@/lib/dates'
import { useIntarziat } from '@/lib/hooks'
import { formateazaBani } from '@/lib/money'
import { plural } from '@/lib/text'
import {
  Avatar,
  Buton,
  Card,
  CampCautare,
  CelulaDubla,
  Paginare,
  Select,
  StareGoala,
  Tabel,
  type Coloana,
} from '@/ui'
import { FormularClient } from './FormularClient'

/**
 * Lista de clienți (art. 3.1.A).
 *
 * Căutarea, filtrul de arhivați și ordonarea merg toate pe server, prin
 * `FiltruClienti`. Alternativa — aducerea întregii clientele și filtrarea
 * locală — funcționează în prima lună și devine tot mai scumpă cu fiecare fișă
 * adăugată, exact pe dispozitivul cel mai slab: telefonul de la recepție.
 */

const PE_PAGINA = 25

/**
 * Ordonările oferite, ca o singură alegere.
 *
 * Serverul primește `sortare` și `directie` separat, dar pentru operatoare
 * există o singură întrebare — „cum vreau lista?”. Două controale alăturate ar
 * permite combinații fără sens practic („ultima vizită, crescător”).
 */
const ORDONARI = {
  'nume:asc': { eticheta: 'Nume (A–Z)', sortare: 'nume', directie: 'asc' },
  'nume:desc': { eticheta: 'Nume (Z–A)', sortare: 'nume', directie: 'desc' },
  'creat_la:desc': { eticheta: 'Adăugați recent', sortare: 'creat_la', directie: 'desc' },
  'ultima_vizita:desc': { eticheta: 'Ultima vizită', sortare: 'ultima_vizita', directie: 'desc' },
} as const satisfies Record<
  string,
  { eticheta: string; sortare: FiltruClienti['sortare']; directie: FiltruClienti['directie'] }
>

type CheieOrdonare = keyof typeof ORDONARI

const coloane: Coloana<ClientListItem>[] = [
  {
    cheie: 'nume',
    antet: 'Client',
    celula: (rand) => (
      <CelulaDubla
        principal={
          <span className="flex items-center gap-2">
            <span className="truncate">{rand.nume}</span>
            {rand.arhivat_la && <InsemnInactiv text="Arhivat" />}
          </span>
        }
        secundar={rand.telefon ?? rand.email}
      />
    ),
  },
  {
    cheie: 'telefon',
    antet: 'Telefon',
    ascunsaSub: 'lg',
    className: 'whitespace-nowrap tabular-nums',
    celula: (rand) => rand.telefon ?? <span className="text-ink-faint">—</span>,
  },
  {
    cheie: 'email',
    antet: 'E-mail',
    ascunsaSub: 'xl',
    className: 'max-w-56',
    celula: (rand) =>
      rand.email ? (
        <span className="block truncate">{rand.email}</span>
      ) : (
        <span className="text-ink-faint">—</span>
      ),
  },
  {
    cheie: 'ultima_vizita',
    antet: 'Ultima vizită',
    ascunsaSub: 'md',
    className: 'whitespace-nowrap tabular-nums',
    celula: (rand) =>
      rand.ultima_vizita ? (
        formateazaData(rand.ultima_vizita)
      ) : (
        <span className="text-ink-faint">niciuna</span>
      ),
  },
  {
    cheie: 'programari',
    antet: 'Programări',
    ascunsaSub: 'md',
    laDreapta: true,
    className: 'tabular-nums',
    celula: (rand) => <NumarActivitate valoare={rand.numar_programari} />,
  },
  {
    cheie: 'vanzari',
    antet: 'Vânzări',
    ascunsaSub: 'md',
    laDreapta: true,
    className: 'tabular-nums',
    celula: (rand) => <NumarActivitate valoare={rand.numar_vanzari} />,
  },
  {
    // Ultima coloană, lângă marginea pe care se opresc ochii după ce parcurg
    // rândul: „cine îmi datorează bani?” se citește dintr-o singură privire pe
    // verticală, fără să fie nevoie de un raport separat.
    cheie: 'de_incasat',
    antet: 'De plată',
    ascunsaSub: 'md',
    laDreapta: true,
    className: 'whitespace-nowrap tabular-nums',
    celula: (rand) =>
      rand.de_incasat > 0 ? (
        <span className="font-medium text-warning">{formateazaBani(rand.de_incasat)}</span>
      ) : (
        // Zeroul rămâne o liniuță estompată: „0,00 RON” îngroșat pe fiecare
        // rând ar transforma coloana în zgomot și ar ascunde exact cazurile
        // care contează.
        <span className="text-ink-faint">—</span>
      ),
  },
]

/** Zero se afișează estompat: coloana rămâne scanabilă, fără să atragă privirea. */
function NumarActivitate({ valoare }: { valoare: number }) {
  return <span className={valoare === 0 ? 'text-ink-faint' : undefined}>{valoare}</span>
}

/** Cardul care înlocuiește rândul pe telefon (art. 2.2). */
function randMobil(rand: ClientListItem) {
  return (
    <div className="flex items-start gap-3">
      <Avatar nume={rand.nume} dimensiune="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-ink">{rand.nume}</span>
          {rand.arhivat_la && <InsemnInactiv text="Arhivat" />}
        </div>
        <div className="mt-0.5 truncate text-[13px] text-ink-faint">
          {rand.telefon ?? rand.email ?? 'Fără date de contact'}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-faint">
          <span>
            Ultima vizită: {rand.ultima_vizita ? formateazaData(rand.ultima_vizita) : 'niciuna'}
          </span>
          <span className="tabular-nums">
            {rand.numar_programari} {plural(rand.numar_programari, 'programare', 'programări')}
          </span>
          <span className="tabular-nums">
            {rand.numar_vanzari} {plural(rand.numar_vanzari, 'vânzare', 'vânzări')}
          </span>
        </div>
        {/*
          Pe telefon suma stă pe rândul ei, nu amestecată printre contoare:
          coloana „De plată” este ascunsă sub `md`, iar recepția lucrează de pe
          telefon tocmai când clientul e în fața ei și trebuie să încaseze.
        */}
        {rand.de_incasat > 0 && (
          <div className="mt-1 text-[12px] font-medium text-warning tabular-nums">
            De plată: {formateazaBani(rand.de_incasat)}
          </div>
        )}
      </div>
      <ChevronRight className="mt-1 size-4 shrink-0 text-ink-faint" aria-hidden />
    </div>
  )
}

export function PaginaClienti() {
  const navigate = useNavigate()

  const [cautare, setCautare] = useState('')
  const [includeArhivati, setIncludeArhivati] = useState(false)
  const [ordonare, setOrdonare] = useState<CheieOrdonare>('nume:asc')
  const [pagina, setPagina] = useState(1)
  const [formularDeschis, setFormularDeschis] = useState(false)

  const cautareIntarziata = useIntarziat(cautare, 250)
  const ordonarea = ORDONARI[ordonare]

  const { data, isFetching, error, refetch } = useClienti({
    q: cautareIntarziata.trim(),
    include_arhivati: includeArhivati,
    sortare: ordonarea.sortare,
    directie: ordonarea.directie,
    pagina,
    pe_pagina: PE_PAGINA,
  })

  // Orice schimbare de filtru readuce lista la prima pagină. Fără asta, o
  // căutare pornită de pe pagina 4 pare să nu întoarcă nimic, deși are
  // rezultate — doar că nu atâtea încât să existe o pagină 4.
  const schimbaCautarea = (valoare: string) => {
    setCautare(valoare)
    setPagina(1)
  }

  const schimbaOrdonarea = (valoare: CheieOrdonare) => {
    setOrdonare(valoare)
    setPagina(1)
  }

  const comutaArhivatii = (valoare: boolean) => {
    setIncludeArhivati(valoare)
    setPagina(1)
  }

  const golesteFiltrele = () => {
    setCautare('')
    setIncludeArhivati(false)
    setPagina(1)
  }

  const cautareActiva = cautareIntarziata.trim() !== ''

  const stareGoala = cautareActiva ? (
    <StareGoala
      pictograma={<SearchX className="size-5" />}
      titlu="Niciun client găsit"
      descriere="Căutarea merge pe nume, telefon și e-mail. Verifică termenul sau golește filtrele."
      actiune={{ eticheta: 'Golește filtrele', onClick: golesteFiltrele }}
    />
  ) : (
    <StareGoala
      pictograma={<Users className="size-5" />}
      titlu="Nu există încă nicio fișă de client"
      descriere="Fișa se creează o singură dată și se folosește apoi la fiecare programare și vânzare."
      actiune={{ eticheta: 'Adaugă primul client', onClick: () => setFormularDeschis(true) }}
    >
      {!includeArhivati && (
        <Buton varianta="legatura" dimensiune="sm" onClick={() => comutaArhivatii(true)}>
          Arată și clienții arhivați
        </Buton>
      )}
    </StareGoala>
  )

  return (
    <Pagina>
      <AntetPagina
        titlu="Clienți"
        descriere={
          data ? `${data.total} ${plural(data.total, 'fișă', 'fișe')} în listă` : undefined
        }
        actiuni={
          <Buton
            varianta="primar"
            onClick={() => setFormularDeschis(true)}
            className="tinta-atingere"
          >
            <Plus className="size-4" />
            Client nou
          </Buton>
        }
      />

      <BaraFiltre>
        <CampCautare
          valoare={cautare}
          onSchimba={schimbaCautarea}
          placeholder="Caută după nume, telefon sau e-mail…"
          containerClassName="w-56 sm:w-80"
          aria-label="Caută un client"
        />

        <Select
          value={ordonare}
          onChange={(e) => schimbaOrdonarea(e.target.value as CheieOrdonare)}
          aria-label="Ordonarea listei"
          className="w-44"
        >
          {Object.entries(ORDONARI).map(([cheie, optiune]) => (
            <option key={cheie} value={cheie}>
              {optiune.eticheta}
            </option>
          ))}
        </Select>

        <Buton
          varianta={includeArhivati ? 'primar' : 'secundar'}
          aria-pressed={includeArhivati}
          onClick={() => comutaArhivatii(!includeArhivati)}
          title="Arhivarea este o ștergere logică: fișele rămân, dar ies din listele curente."
          className="tinta-atingere"
        >
          <Archive className="size-4" />
          Include arhivați
        </Buton>
      </BaraFiltre>

      <Card className="overflow-hidden">
        <Tabel
          coloane={coloane}
          randuri={data?.randuri ?? []}
          cheieRand={(rand) => rand.id}
          randMobil={randMobil}
          onRandClick={(rand) => navigate(`/clienti/${rand.id}`)}
          incarca={isFetching}
          eroare={error ? mesajEroare(error) : null}
          onReincearca={() => void refetch()}
          stareGoala={stareGoala}
        />

        <Paginare
          pagina={data?.pagina ?? pagina}
          pePagina={data?.pe_pagina ?? PE_PAGINA}
          total={data?.total ?? 0}
          onSchimba={setPagina}
        />
      </Card>

      <FormularClient deschisa={formularDeschis} onInchide={() => setFormularDeschis(false)} />
    </Pagina>
  )
}
