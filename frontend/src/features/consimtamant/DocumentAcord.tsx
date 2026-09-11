import type { BlocAcord } from './document'

/**
 * Acordul, desenat pe ecran.
 *
 * Citește ACELEAȘI blocuri din care se tipărește PDF-ul (`document.ts` →
 * `pdf.ts`). Nu este o copie a textului și nu trebuie să devină una: dacă
 * ecranul ar avea versiunea lui, s-ar putea ajunge — după o singură modificare
 * făcută într-un loc — ca omul să citească un text și să semneze altul.
 *
 * Cele opt feluri de bloc sunt aceleași ca la tipărire, iar `switch`-ul de mai
 * jos le acoperă pe toate. Adăugat un fel nou în `BlocAcord`, TypeScript se
 * plânge aici — exact ce trebuie, fiindcă un bloc nedesenat pe ecran ar apărea
 * totuși în fișierul semnat.
 */
export function DocumentAcord({ blocuri }: { blocuri: readonly BlocAcord[] }) {
  return (
    <article className="text-[13px] leading-relaxed text-ink">
      {blocuri.map((bloc, i) => (
        <Bloc key={i} bloc={bloc} />
      ))}
    </article>
  )
}

function Bloc({ bloc }: { bloc: BlocAcord }) {
  switch (bloc.fel) {
    case 'operator':
      return <p className="mb-3 font-semibold">{bloc.text}</p>

    case 'titlu':
      return <h3 className="mb-3 font-semibold">{bloc.text}</h3>

    case 'paragraf':
      return <p className="mb-3 text-justify">{bloc.text}</p>

    case 'numerotat':
      return (
        <p className="mb-2 flex gap-2 text-justify">
          <span className="shrink-0 font-semibold tabular-nums">{bloc.numar}.</span>
          <span>{bloc.text}</span>
        </p>
      )

    case 'punct':
      return (
        <p className="mb-1.5 flex gap-2 pl-4 text-justify">
          <span className="shrink-0 text-ink-faint" aria-hidden>
            •
          </span>
          <span>{bloc.text}</span>
        </p>
      )

    case 'campuri':
      // Spațiile de completat cu mâna rămân goale și pe ecran: clientul trebuie
      // să vadă exact hârtia pe care o semnează, cu golurile ei cu tot.
      return (
        <div className="mb-3 pl-2">
          {bloc.etichete.map((eticheta) => (
            <div key={eticheta} className="flex items-baseline gap-2 py-1">
              <span className="shrink-0 text-ink-soft">{eticheta}:</span>
              <span className="min-w-0 flex-1 border-b border-dotted border-line-strong" />
            </div>
          ))}
        </div>
      )

    case 'nota':
      return <p className="mb-3 text-[12px] text-ink-faint">{bloc.text}</p>

    case 'semnatura':
      return (
        <div className="mt-5 flex items-end justify-between gap-6 border-t border-line pt-4">
          <p className="text-ink-soft">
            Data <span className="ml-2 font-medium text-ink tabular-nums">{bloc.data}</span>
          </p>
          <p className="text-ink-soft">Semnătura se culege pe tabletă</p>
        </div>
      )
  }
}
