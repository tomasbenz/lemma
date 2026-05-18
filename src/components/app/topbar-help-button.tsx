'use client'

import { Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Botón "?" en el topbar que abre el cheatsheet disparando un '?' keypress.
 * Cumple una función dual: acceso por mouse + hint visual de que existe.
 */
export function TopbarHelpButton() {
  function abrirCheatsheet() {
    // Simular pressed '?' para abrir el cheatsheet
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', bubbles: true })
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={abrirCheatsheet}
      className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
      title="Atajos de teclado (?)"
    >
      <Keyboard className="size-4" />
      <kbd className="hidden sm:inline-flex rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium font-numeric">
        ?
      </kbd>
    </Button>
  )
}