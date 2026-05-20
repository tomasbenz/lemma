import { z } from 'zod'

/**
 * Atributo individual de una variante: par clave/valor de texto libre.
 *
 * Reemplazo del viejo modelo (color: string, talle: string) heredado del
 * proyecto Loom Point (textil). Lemma generaliza para soportar cualquier
 * combinación de atributos por categoría (color, tamaño, formato, gramaje,
 * presentación, sabor, edición, etc.).
 */
export const atributoSchema = z.object({
  clave: z
    .string()
    .min(1, 'Falta el nombre del atributo')
    .max(50, 'Máximo 50 caracteres'),
  valor: z
    .string()
    .min(1, 'Falta el valor')
    .max(100, 'Máximo 100 caracteres'),
})

export type AtributoInput = z.infer<typeof atributoSchema>

/**
 * Schema para una variante individual.
 *
 * Estructura:
 *  - atributos: array de pares (clave, valor) que se serializa a jsonb en DB.
 *    Si es vacío [], la variante es DEFAULT (sin atributos distintivos).
 *  - stock: stock inicial entero >= 0.
 */
export const varianteSchema = z.object({
  atributos: z.array(atributoSchema).default([]),
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

    codigo_barras: z
      .string()
      .trim()
      .regex(/^\d{8,18}$/, 'El código de barras debe tener entre 8 y 18 dígitos')
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
