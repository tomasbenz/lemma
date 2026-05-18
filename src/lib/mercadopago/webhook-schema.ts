import { z } from 'zod'

/**
 * Schemas de validación para el body de webhooks de Mercado Pago.
 *
 * Hoy validamos `payment` con shape estricto; otros tipos
 * (`merchant_order`, `point_integration_wh`, etc.) caen en el
 * passthrough genérico para que se registren igual sin romper
 * el handler. Cuando agreguemos lógica para cada tipo, mover
 * cada uno a su propio schema strict.
 */

const IdScalar = z.union([z.string(), z.number()])

const PaymentDataSchema = z
  .object({
    id: IdScalar,
  })
  .strict()

const PaymentNotificationSchema = z
  .object({
    id: IdScalar,
    live_mode: z.boolean().optional(),
    type: z.literal('payment'),
    date_created: z.string().optional(),
    user_id: IdScalar.optional(),
    api_version: z.string().optional(),
    action: z.string().optional(),
    data: PaymentDataSchema,
  })
  .strict()

const GenericNotificationSchema = z
  .object({
    id: IdScalar,
    type: z.string(),
    data: z
      .object({
        id: IdScalar,
      })
      .passthrough(),
  })
  .passthrough()

/**
 * Union por `type`: probamos primero el schema estricto de payment;
 * cualquier otro `type` cae en el passthrough genérico.
 *
 * Nota: no usamos `z.discriminatedUnion` porque el branch genérico
 * acepta `type: z.string()`, lo cual no es un literal y no se puede
 * mezclar en un discriminated union. El comportamiento (validar
 * según `type`) es equivalente para nuestro caso.
 */
export const MPWebhookBodySchema = z.union([
  PaymentNotificationSchema,
  GenericNotificationSchema,
])

export type MPWebhookBody = z.infer<typeof MPWebhookBodySchema>
export type MPPaymentNotification = z.infer<typeof PaymentNotificationSchema>
