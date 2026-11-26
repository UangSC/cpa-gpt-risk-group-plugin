import { createContext, useContext, useMemo, type ReactNode } from 'react'

export interface SelectionApi {
  selected: string[]
  toggle: (id: string, shiftKey?: boolean) => void
  set: (ids: string[]) => void
  clear: () => void
  has: (id: string) => boolean
}

const SelectionContext = createContext<SelectionApi | null>(null)

export function SelectionProvider({ value, children }: { value: SelectionApi; children: ReactNode }) {
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>
}

export function useSelection(): SelectionApi {
  const ctx = useContext(SelectionContext)
  if (!ctx) throw new Error('SelectionProvider missing')
  return ctx
}

/** Memoized membership set so large lists do not re-render on every keystroke. */
export function useSelectionSet(ids: string[]) {
  return useMemo(() => new Set(ids), [ids])
}
