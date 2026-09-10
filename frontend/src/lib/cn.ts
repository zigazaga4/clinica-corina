import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Compune clase Tailwind, rezolvând conflictele în favoarea ultimei.
 *
 * Fără asta, `cn('p-2', 'p-4')` ar produce ambele clase și rezultatul ar
 * depinde de ordinea din CSS. Este mecanismul care face ca `className` primit
 * prin props să poată suprascrie stilul implicit al unei componente.
 */
export function cn(...intrari: ClassValue[]): string {
  return twMerge(clsx(intrari))
}
