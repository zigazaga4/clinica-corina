/**
 * Trusa de componente.
 *
 * Modulele importă din `@/ui`, nu din fișierele individuale. Un singur punct de
 * intrare face vizibil, la o simplă citire a importurilor, dacă un ecran își
 * construiește propriile controale în loc să le refolosească pe acestea.
 */

export { Avatar, type AvatarProps } from './Avatar'
export { Badge, Contor, type BadgeProps, type BadgeTone } from './Badge'
export {
  Buton,
  ButonGrup,
  ButonRand,
  GrupButoane,
  type ButonProps,
  type DimensiuneButon,
  type VariantaButon,
} from './Button'
export { AntetCard, Card, CorpCard, Pereche, Statistica } from './Card'
export { Combobox, type ComboboxProps, type OptiuneCombobox } from './Combobox'
export { StareEroare, StareGoala, type StareGoalaProps } from './EmptyState'
export {
  Camp,
  Checkbox,
  Comutator,
  Input,
  Select,
  Textarea,
  type CampProps,
  type CheckboxProps,
  type InputProps,
  type SelectProps,
  type TextareaProps,
} from './Field'
export {
  CardGrafic,
  formateazaAxa,
  GraficBare,
  GraficColoane,
  gradatii,
  type PunctGrafic,
  type RandBare,
  type SerieGrafic,
  type TabelGrafic,
} from './Grafice'
export { ElementMeniu, Meniu, SeparatorMeniu, TitluMeniu, type MeniuProps } from './Menu'
export {
  Modala,
  ModalaConfirmare,
  type DimensiuneModala,
  type ModalaProps,
} from './Modal'
export { Paginare } from './Pagination'
export { CULORI_PALETA, PaletaCulori, PunctCuloare, type CuloarePaleta } from './PaletaCulori'
export { CampOra, oreDinPas, type CampOraProps } from './CampOra'
export { CampCautare } from './SearchInput'
export { IncarcarePagina, Schelet, Spinner, type SpinnerProps } from './Spinner'
export { CelulaDubla, Tabel, type Coloana, type TabelProps } from './Table'
export { File, type Fila } from './Tabs'
export {
  FurnizorNotificari,
  useNotificari,
  type FelNotificare,
  type Notificare,
} from './Toast'
