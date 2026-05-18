import { z } from 'zod'

const CUIT_REGEX = /^\d{2}-?\d{8}-?\d{1}$/

export const clienteSchema = z.object({
  razon_social: z
    .string()
    .trim()
    .min(2, 'La razón social debe tener al menos 2 caracteres')
    .max(200, 'Máximo 200 caracteres'),

  cond_iva: z.enum(['RI', 'MONO', 'CF', 'EX'], {
    message: 'Seleccioná una condición frente al IVA',
  }),

  cuit: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) => !val || CUIT_REGEX.test(val),
      'CUIT inválido. Formato: XX-XXXXXXXX-X o 11 dígitos'
    )
    .transform((val) => {
      if (!val) return null
      // Normalizar a XX-XXXXXXXX-X
      const digits = val.replace(/-/g, '')
      if (digits.length === 11) {
        return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`
      }
      return val
    }),

  email: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) => !val || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val),
      'Email inválido'
    )
    .transform((val) => val || null),

  telefono: z
    .string()
    .trim()
    .max(50, 'Máximo 50 caracteres')
    .optional()
    .transform((val) => val || null),

  domicilio: z
    .string()
    .trim()
    .max(200, 'Máximo 200 caracteres')
    .optional()
    .transform((val) => val || null),

  localidad: z
    .string()
    .trim()
    .max(100, 'Máximo 100 caracteres')
    .optional()
    .transform((val) => val || null),

  provincia: z
    .string()
    .trim()
    .max(100, 'Máximo 100 caracteres')
    .optional()
    .transform((val) => val || null),

  notas: z
    .string()
    .trim()
    .max(1000, 'Máximo 1000 caracteres')
    .optional()
    .transform((val) => val || null),
})

export type ClienteFormData = z.input<typeof clienteSchema>
export type ClienteFormDataNormalizada = z.output<typeof clienteSchema>