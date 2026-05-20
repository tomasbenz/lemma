// src/app/(app)/caja/_hooks/use-scanner-beep.ts
//
// Beeps audibles para feedback del scanner de códigos de barras.
// Usa Web Audio API nativa (sin archivos ni dependencias) y crea el
// AudioContext lazy en el primer beep para no chocar con las políticas
// de autoplay del browser.

'use client'

import { useCallback, useRef } from 'react'

type AudioContextCtor = typeof AudioContext

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    AudioContext?: AudioContextCtor
    webkitAudioContext?: AudioContextCtor
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

function tono(ctx: AudioContext, freq: number, durMs: number, startAt: number): void {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'square'
  osc.frequency.value = freq
  // Envelope para evitar clicks al cortar
  gain.gain.setValueAtTime(0, startAt)
  gain.gain.linearRampToValueAtTime(0.15, startAt + 0.005)
  gain.gain.linearRampToValueAtTime(0, startAt + durMs / 1000)
  osc.connect(gain).connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt + durMs / 1000 + 0.02)
}

export function useScannerBeep() {
  const ctxRef = useRef<AudioContext | null>(null)

  const ensureCtx = useCallback((): AudioContext | null => {
    if (ctxRef.current) return ctxRef.current
    const Ctor = getAudioContextCtor()
    if (!Ctor) return null
    try {
      ctxRef.current = new Ctor()
      return ctxRef.current
    } catch {
      return null
    }
  }, [])

  const beepExito = useCallback(() => {
    const ctx = ensureCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()
    tono(ctx, 800, 80, ctx.currentTime)
  }, [ensureCtx])

  const beepError = useCallback(() => {
    const ctx = ensureCtx()
    if (!ctx) return
    if (ctx.state === 'suspended') void ctx.resume()
    const now = ctx.currentTime
    tono(ctx, 200, 90, now)
    tono(ctx, 200, 90, now + 0.12)
  }, [ensureCtx])

  return { beepExito, beepError }
}
