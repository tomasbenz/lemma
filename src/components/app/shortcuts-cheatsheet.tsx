// src/components/app/shortcuts-cheatsheet.tsx
'use client'

import { useState, useEffect } from 'react'
import React from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import type { CurrentUser } from '@/lib/auth/get-current-user'

type Props = {
  rol: CurrentUser['rol']
}

type Shortcut = {
  keys: string[]
  label: string
}

type Group = {
  title: string
  items: Shortcut[]
}

export function ShortcutsCheatsheet({ rol }: Props) {
  const [open, setOpen] = useState(false)

  // Abrir con '?' (Shift + /)
  useEffect(() => {
    function esElementoEditable(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      if (target.isContentEditable) return true
      return false
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== '?') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (esElementoEditable(e.target)) return
      e.preventDefault()
      setOpen((v) => !v)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const grupos = construirGrupos(rol)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="!max-w-2xl w-[calc(100vw-2rem)] max-h-[85vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-4 border-b shrink-0">
          <DialogTitle>Atajos de teclado</DialogTitle>
          <DialogDescription>
            Abrí este listado en cualquier momento con{' '}
            <Kbd>?</Kbd>
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto no-scrollbar p-6 space-y-6">
          {grupos.map((grupo, idx) => (
            <div key={grupo.title}>
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
                {grupo.title}
              </h3>
              <div className="space-y-2">
                {grupo.items.map((item, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between py-1"
                  >
                    <span className="text-sm">{item.label}</span>
                    <div className="flex items-center gap-1">
                      {item.keys.map((k, ki) => (
                        <React.Fragment key={`${k}-${ki}`}>
                          {ki > 0 && (
                            <span className="text-xs text-muted-foreground">
                              luego
                            </span>
                          )}
                          <Kbd>{k}</Kbd>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {idx < grupos.length - 1 && <Separator className="mt-6" />}
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded border bg-muted px-1.5 text-[11px] font-medium font-numeric text-foreground shadow-sm">
      {children}
    </kbd>
  )
}

function construirGrupos(rol: CurrentUser['rol']): Group[] {
  const grupos: Group[] = []

  // ===== CAJA =====
  grupos.push({
    title: 'Caja',
    items: [
      { keys: ['F2'], label: 'Buscar producto' },
      { keys: ['F5'], label: 'Cobrar venta' },
      { keys: ['F9'], label: 'Vaciar carrito' },
      { keys: ['Enter'], label: 'Confirmar acción en modal' },
      { keys: ['Esc'], label: 'Cerrar modal' },
    ],
  })

  // ===== NAVEGACIÓN =====
  const nav: Shortcut[] = [
    { keys: ['G', 'C'], label: 'Ir a Caja' },
    { keys: ['G', 'P'], label: 'Ir a Productos' },
  ]

  if (rol !== 'vendedor') {
    nav.push(
      { keys: ['G', 'H'], label: 'Ir al Panel' },
      { keys: ['G', 'V'], label: 'Ir a Ventas' }
    )
  }

  grupos.push({
    title: 'Navegación',
    items: nav,
  })

  // ===== SISTEMA =====
  grupos.push({
    title: 'Sistema',
    items: [
      { keys: ['?'], label: 'Abrir esta guía de atajos' },
      { keys: ['Ctrl', 'B'], label: 'Colapsar / expandir sidebar' },
    ],
  })

  return grupos
}