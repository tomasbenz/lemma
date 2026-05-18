import { z } from 'zod'

/**
 * Schema para una variante individual
 */
export const varianteSchema = z.object({
  color: z
    .string()
    .max(50, 'Máximo 50 caracteres')
    .optional()
    .or(z.literal('')),
  talle: z
    .string()
    .max(20, 'Máximo 20 caracteres')
    .optional()
    .or(z.literal('')),
  stock: z
    .number()
    .int('Debe ser un número entero')
    .min(0, 'No puede ser negativo')
    .max(999999, 'Máximo 999.999'),
})

export type VarianteInput = z.infer<typeof varianteSchema>

/**
 * Schema para el producto completo con variantes
 */
export const productoSchema = z
  .object({
    nombre: z
      .string()
      .min(2, 'Mínimo 2 caracteres')
      .max(200, 'Máximo 200 caracteres'),

    sku_base: z
      .string()
      .min(2, 'Mínimo 2 caracteres')
      .max(30, 'Máximo 30 caracteres')
      .regex(
        /^[A-Z0-9][A-Z0-9-]*$/i,
        'Solo letras, números y guiones. Debe empezar con letra o número.'
      )
      .transform((val) => val.toUpperCase().trim()),

    precio_neto: z
      .number()
      .min(0, 'No puede ser negativo')
      .max(99999999, 'Precio demasiado alto'),

    categoria: z
      .string()
      .max(50, 'Máximo 50 caracteres')
      .optional()
      .or(z.literal('')),

    descripcion_corta: z
      .string()
      .max(500, 'Máximo 500 caracteres')
      .optional()
      .or(z.literal('')),

    imagen_url: z.string().url().nullable().optional(),

    track_stock: z.boolean(),

    tiene_variantes: z.boolean(),

    stock_inicial: z
      .number()
      .int('Debe ser un número entero')
      .min(0, 'No puede ser negativo')
      .default(0),

    variantes: z.array(varianteSchema).default([]),
  })
  .refine(
    (data) => {
      if (data.tiene_variantes && data.variantes.length === 0) {
        return false
      }
      return true
    },
    {
      message: 'Agregá al menos una variante o desactivá el checkbox',
      path: ['variantes'],
    }
  )

export type ProductoInput = z.infer<typeof productoSchema>

/**
 * Tipo del estado interno del form (input al schema, antes de aplicar
 * defaults y transforms). Difiere de ProductoInput en que algunos campos
 * con .default() son opcionales acá. Usar en useForm como TFieldValues.
 */
export type ProductoFormValues = z.input<typeof productoSchema>