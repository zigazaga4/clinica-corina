import { useEffect, useId, useState, type FormEvent } from 'react'
import { Mail, Phone } from 'lucide-react'
import type { DateClientNou } from '@/api/contract'
import { useCreeazaClient, useModificaClient } from '@/app/queries'
import { GrilaFormular, PeToataLatimea } from '@/components/Pagina'
import type { Client } from '@/domain/types'
import { useEroriFormular } from '@/lib/formular'
import { Buton, Input, Modala, Textarea, useNotificari } from '@/ui'

/**
 * Formularul fișei de client, pentru creare și pentru modificare.
 *
 * Este aceeași fereastră în ambele cazuri: câmpurile, validările și mesajele
 * serverului sunt identice, iar două variante separate ar diverge la prima
 * coloană adăugată în tabela `client`. Ce diferă — titlul, eticheta butonului
 * și metoda apelată — se deduce din prezența lui `client`.
 */

/** Câmpurile pe care serverul le poate marca vinovate (`EroareApi.camp`). */
type CampClient = 'nume' | 'telefon' | 'email' | 'adresa' | 'data_nasterii'

export function FormularClient({
  deschisa,
  onInchide,
  client = null,
}: {
  deschisa: boolean
  onInchide: () => void
  /** Lipsește la creare; prezent la modificare. */
  client?: Client | null
}) {
  const idFormular = useId()
  const notificari = useNotificari()
  const { peCamp, general, goleste, preia, setCamp } = useEroriFormular<CampClient>()

  const creeaza = useCreeazaClient()
  const modifica = useModificaClient()
  const seTrimite = creeaza.isPending || modifica.isPending

  const [nume, setNume] = useState('')
  const [telefon, setTelefon] = useState('')
  const [email, setEmail] = useState('')
  const [adresa, setAdresa] = useState('')
  const [dataNasterii, setDataNasterii] = useState('')

  // Reîncărcarea valorilor se leagă de DESCHIDEREA ferestrei și de identitatea
  // clientului, nu de obiectul `client`. Fișa se împrospătează în fundal după
  // orice invalidare de cache; dacă am urmări obiectul, o astfel de
  // împrospătare ar șterge exact ce tocmai a tastat operatoarea.
  const clientId = client?.id ?? null
  useEffect(() => {
    if (!deschisa) return
    setNume(client?.nume ?? '')
    setTelefon(client?.telefon ?? '')
    setEmail(client?.email ?? '')
    setAdresa(client?.adresa ?? '')
    setDataNasterii(client?.data_nasterii ?? '')
    goleste()
  }, [deschisa, clientId, goleste])

  const trimite = async (e: FormEvent) => {
    e.preventDefault()
    goleste()

    // Aceeași regulă ca `NOT NULL` pe `client.nume`, verificată înainte de
    // cerere: mesajul apare instant, fără drumul până la server și înapoi.
    if (nume.trim() === '') {
      setCamp('nume', 'Numele clientului este obligatoriu.')
      return
    }

    const date: DateClientNou = {
      nume: nume.trim(),
      // Șirul gol devine NULL, ca în bază — altfel „fără telefon” s-ar salva ca
      // telefon vid și ar trece de orice filtru „are telefon”.
      telefon: telefon.trim() || null,
      email: email.trim() || null,
      adresa: adresa.trim() || null,
      data_nasterii: dataNasterii || null,
    }

    try {
      if (client) {
        await modifica.mutateAsync({ id: client.id, date })
        notificari.succes('Fișa a fost actualizată.', client.nume)
      } else {
        const creat = await creeaza.mutateAsync(date)
        notificari.succes('Client adăugat.', creat.nume)
      }
      onInchide()
    } catch (err) {
      preia(err)
    }
  }

  return (
    <Modala
      deschisa={deschisa}
      onInchide={onInchide}
      blocata={seTrimite}
      titlu={client ? 'Modifică fișa clientului' : 'Client nou'}
      descriere={
        client ? undefined : 'Doar numele este obligatoriu; restul se pot completa oricând.'
      }
      subsol={
        <>
          <Buton onClick={onInchide} disabled={seTrimite} className="tinta-atingere sm:w-auto" plin>
            Renunță
          </Buton>
          <Buton
            type="submit"
            form={idFormular}
            varianta="primar"
            incarca={seTrimite}
            className="tinta-atingere sm:w-auto"
            plin
          >
            {client ? 'Salvează' : 'Adaugă clientul'}
          </Buton>
        </>
      }
    >
      {/*
        Formularul stă în corpul modalei, iar butonul de trimitere în subsol,
        legat prin `form`. Astfel bara de acțiuni rămâne vizibilă la derulare,
        fără ca tasta Enter dintr-un câmp să înceteze să salveze.
      */}
      <form id={idFormular} onSubmit={trimite} className="flex flex-col gap-4" noValidate>
        <GrilaFormular>
          <PeToataLatimea>
            <Input
              eticheta="Nume"
              obligatoriu
              autoFocus
              autoComplete="name"
              value={nume}
              onChange={(e) => setNume(e.target.value)}
              eroare={peCamp.nume}
              placeholder="Popescu Maria"
            />
          </PeToataLatimea>

          <Input
            eticheta="Telefon"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={telefon}
            onChange={(e) => setTelefon(e.target.value)}
            eroare={peCamp.telefon}
            pictograma={<Phone className="size-4" />}
            placeholder="07xx xxx xxx"
          />

          <Input
            eticheta="E-mail"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            eroare={peCamp.email}
            pictograma={<Mail className="size-4" />}
            placeholder="nume@exemplu.ro"
          />

          <Input
            eticheta="Data nașterii"
            type="date"
            value={dataNasterii}
            onChange={(e) => setDataNasterii(e.target.value)}
            eroare={peCamp.data_nasterii}
            ajutor="Folosită pentru vârstă și pentru urările de zi de naștere."
          />

          <PeToataLatimea>
            <Textarea
              eticheta="Adresă"
              rows={2}
              value={adresa}
              onChange={(e) => setAdresa(e.target.value)}
              eroare={peCamp.adresa}
              placeholder="Strada, numărul, localitatea"
            />
          </PeToataLatimea>
        </GrilaFormular>

        {general && (
          <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">
            {general}
          </p>
        )}
      </form>
    </Modala>
  )
}
