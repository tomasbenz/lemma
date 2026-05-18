// src/lib/validations/configuracion.ts
import { z } from 'zod'

const CUIT_REGEX = /^\d{2}-?\d{8}-?\d{1}$/

export const configuracionSchema = z.object({
  razon_social: z
    .string()
    .trim()
    .min(2, 'Ingresá la razón social')
    .max(200),

  cuit: z
    .string()
    .trim()
    .refine((val) => CUIT_REGEX.test(val), 'CUIT inválido (XX-XXXXXXXX-X)')
    .transform((val) => {
      const digits = val.replace(/-/g, '')
      if (digits.length === 11) {
        return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
      }
      return val
    }),

  condicion_iva: z
    .string()
    .trim()
    .min(1, 'Ingresá la condición frente al IVA')
    .max(100),

  ingresos_brutos: z
    .string()
    .trim()
    .max(50)
    .optional()
    .transform((v) => v || null),

  inicio_actividades: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v),
      'Fecha inválida (YYYY-MM-DD)'
    )
    .transform((v) => v || null),

  domicilio: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),

  localidad: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || null),

  provincia: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || null),

  codigo_postal: z
    .string()
    .trim()
    .max(20)
    .optional()
    .transform((v) => v || null),

  telefono: z
    .string()
    .trim()
    .max(50)
    .optional()
    .transform((v) => v || null),

  email: z
    .string()
    .trim()
    .optional()
    .refine(
      (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
      'Email inválido'
    )
    .transform((v) => v || null),

  web: z
    .string()
    .trim()
    .max(200)
    .optional()
    .transform((v) => v || null),

  punto_venta_default: z.coerce
    .number()
    .int('Debe ser un número entero')
    .min(1, 'Mínimo 1')
    .max(9999, 'Máximo 9999'),

  puntos_venta: z
    .array(z.coerce.number().int().min(1).max(99999))
    .min(1, 'Debe haber al menos un punto de venta')
    .max(20, 'Máximo 20 puntos de venta'),

  umbral_stock_bajo: z.coerce
    .number()
    .int('Debe ser un número entero')
    .min(0, 'No puede ser negativo')
    .max(9999, 'Máximo 9999'),
})