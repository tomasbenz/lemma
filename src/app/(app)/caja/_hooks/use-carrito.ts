'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  calcularDescuentoAplicado,
  calcularDescuentoDesdeMonto,
} from '@/lib/cobro/calculos'
import type { Atributos } from '@/lib/format-atributos'

export type ItemCarrito = {
  varianteId: string
  productoId: string
  productoNombre: string
  productoSku: string
  imagenUrl: string | null
  /**
   * Snapshot de atributos de la variante al momento de agregar al carrito.
   * Generaliza el viejo par (color, talle) del proyecto Loom Point en un
   * jsonb arbitrario. Default {} para variantes sin atributos.
   */
  atributos: Atributos
  skuVariante: string
  precioUnitarioNeto: number
  cantidad: number
  stockDisponible: number // para validar sin pasar a DB
  trackStock: boolean
}

const STORAGE_KEY = 'lemma:carrito:v1'

export type DescuentoModo = 'porcentaje' | 'monto'

type EstadoCarrito = {
  items: ItemCarrito[]
  descuentoValor: number
  descuentoModo: DescuentoModo
  clienteId: string | null
}

const ESTADO_INICIAL: EstadoCarrito = {
  items: [],
  descuentoValor: 0,
  descuentoModo: 'monto',
  clienteId: null,
}

function cargarDesdeStorage(): EstadoCarrito {
  if (typeof window === 'undefined') return ESTADO_INICIAL
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return ESTADO_INICIAL
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.items)) return ESTADO_INICIAL
    return {
      items: parsed.items,
      // Compat con v1: 'descuento' era monto absoluto
      descuentoValor: Number(parsed.descuentoValor ?? parsed.descuento) || 0,
      descuentoModo:
        parsed.descuentoModo === 'porcentaje' ? 'porcentaje' : 'monto',
      clienteId: parsed.clienteId ?? null,
    }
  } catch {
    return ESTADO_INICIAL
  }
}

function guardarEnStorage(estado: EstadoCarrito) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(estado))
  } catch {
    // Ignorar errores de storage (quota, modo incógnito, etc.)
  }
}

export function useCarrito() {
  const [estado, setEstado] = useState<EstadoCarrito>(ESTADO_INICIAL)
  const [hidratado, setHidratado] = useState(false)

  // Hidratación desde localStorage al montar
  useEffect(() => {
    setEstado(cargarDesdeStorage())
    setHidratado(true)
  }, [])

  // Persistir cambios
  useEffect(() => {
    if (hidratado) {
      guardarEnStorage(estado)
    }
  }, [estado, hidratado])

  const agregarItem = useCallback(
    (nuevo: Omit<ItemCarrito, 'cantidad'>, cantidadInicial = 1) => {
      setEstado((prev) => {
        const existente = prev.items.find(
          (i) => i.varianteId === nuevo.varianteId
        )

        if (existente) {
          // Ya está en el carrito: incrementar cantidad
          const nuevaCantidad = existente.cantidad + cantidadInicial
          const cantidadFinal =
            nuevo.trackStock
              ? Math.min(nuevaCantidad, nuevo.stockDisponible)
              : nuevaCantidad

          return {
            ...prev,
            items: prev.items.map((i) =>
              i.varianteId === nuevo.varianteId
                ? { ...i, cantidad: cantidadFinal }
                : i
            ),
          }
        }

        // Nuevo item
        return {
          ...prev,
          items: [
            ...prev.items,
            { ...nuevo, cantidad: cantidadInicial },
          ],
        }
      })
    },
    []
  )

  const actualizarCantidad = useCallback(
    (varianteId: string, cantidad: number) => {
      setEstado((prev) => ({
        ...prev,
        items: prev.items
          .map((i) => {
            if (i.varianteId !== varianteId) return i
            const cantidadFinal = i.trackStock
              ? Math.min(Math.max(0, cantidad), i.stockDisponible)
              : Math.max(0, cantidad)
            return { ...i, cantidad: cantidadFinal }
          })
          .filter((i) => i.cantidad > 0),
      }))
    },
    []
  )

  const actualizarPrecioProducto = useCallback(
    (productoId: string, precioNuevo: number) => {
      // Scope = producto entero: actualiza TODAS las líneas del carrito que sean
      // variantes del mismo producto (precio_neto vive en productos, no en
      // variantes). Mantiene la venta en curso consistente con el precio nuevo.
      setEstado((prev) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.productoId === productoId
            ? { ...i, precioUnitarioNeto: precioNuevo }
            : i
        ),
      }))
    },
    []
  )

  const removerItem = useCallback((varianteId: string) => {
    setEstado((prev) => ({
      ...prev,
      items: prev.items.filter((i) => i.varianteId !== varianteId),
    }))
  }, [])

  const limpiar = useCallback(() => {
    setEstado(ESTADO_INICIAL)
  }, [])

  const setDescuentoValor = useCallback((valor: number) => {
    setEstado((prev) => ({ ...prev, descuentoValor: Math.max(0, valor) }))
  }, [])

  const setDescuentoModo = useCallback((modo: DescuentoModo) => {
    setEstado((prev) => ({
      ...prev,
      descuentoModo: modo,
      // Reset valor al cambiar de modo para evitar valores absurdos
      // (ej: 50% mantenido como $50 no tiene sentido)
      descuentoValor: 0,
    }))
  }, [])

  const setClienteId = useCallback((clienteId: string | null) => {
    setEstado((prev) => ({ ...prev, clienteId }))
  }, [])

  // Totales
  const subtotal = estado.items.reduce(
    (acc, i) => acc + i.precioUnitarioNeto * i.cantidad,
    0
  )
  const descuentoAplicado =
    estado.descuentoModo === 'porcentaje'
      ? calcularDescuentoAplicado(subtotal, estado.descuentoValor)
      : calcularDescuentoDesdeMonto(subtotal, estado.descuentoValor)
  const total = subtotal - descuentoAplicado
  const cantidadItems = estado.items.reduce((acc, i) => acc + i.cantidad, 0)

  return {
    items: estado.items,
    descuentoValor: estado.descuentoValor,
    descuentoModo: estado.descuentoModo,
    clienteId: estado.clienteId,
    subtotal,
    descuentoAplicado,
    total,
    cantidadItems,
    hidratado,
    agregarItem,
    actualizarCantidad,
    actualizarPrecioProducto,
    removerItem,
    limpiar,
    setDescuentoValor,
    setDescuentoModo,
    setClienteId,
  }
}
