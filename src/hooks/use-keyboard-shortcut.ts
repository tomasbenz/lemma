'use client'

import { useEffect } from 'react'

type Modifier = 'ctrl' | 'meta' | 'alt' | 'shift' | 'ctrlOrMeta'

type ShortcutOptions = {
  /**
   * Ignorar el shortcut si el foco está en input/textarea/contenteditable.
   * Default: true. Set false para teclas como F1-F12, Escape, etc.
   */
  ignoreInInputs?: boolean
  /** Modificador opcional (ctrl, meta, alt, shift, ctrlOrMeta) */
  modifier?: Modifier
  /** Si está false, el shortcut no se registra */
  enabled?: boolean
  /** Previene default del navegador (ej. F5 refresh) */
  preventDefault?: boolean
}

/**
 * Hook para registrar un shortcut de teclado global.
 *
 * @example
 * useKeyboardShortcut('F5', () => abrirCobro(), { preventDefault: true })
 * useKeyboardShortcut('k', () => abrirCmdK(), { modifier: 'ctrlOrMeta' })
 */
export function useKeyboardShortcut(
  key: string,
  handler: (e: KeyboardEvent) => void,
  options: ShortcutOptions = {}
) {
  const {
    ignoreInInputs = true,
    modifier,
    enabled = true,
    preventDefault = false,
  } = options

  useEffect(() => {
    if (!enabled) return

    function onKey(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== key.toLowerCase()) return

      // Verificar modificador si se pide
      if (modifier) {
        const hasCtrl = e.ctrlKey
        const hasMeta = e.metaKey
        const hasAlt = e.altKey
        const hasShift = e.shiftKey

        switch (modifier) {
          case 'ctrl':
            if (!hasCtrl) return
            break
          case 'meta':
            if (!hasMeta) return
            break
          case 'alt':
            if (!hasAlt) return
            break
          case 'shift':
            if (!hasShift) return
            break
          case 'ctrlOrMeta':
            if (!hasCtrl && !hasMeta) return
            break
        }
      } else {
        // Si no hay modificador esperado, ignorar si viene con modifier
        // (evita disparar "F5" cuando el usuario hace "Ctrl+F5")
        if (e.ctrlKey || e.metaKey || e.altKey) return
      }

      // Ignorar si el foco está en un input editable
      if (ignoreInInputs && esElementoEditable(e.target)) {
        return
      }

      if (preventDefault) e.preventDefault()
      handler(e)
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [key, handler, modifier, enabled, ignoreInInputs, preventDefault])
}

function esElementoEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}