import { z } from 'zod'

/**
 * Schema de validación del formulario de login.
 *
 * Validaciones:
 * - Email: formato válido, obligatorio, normalizado a lowercase
 * - Password: mínimo 6 caracteres (Supabase requiere ≥6)
 */
export const loginSchema = z.object({
  email: z
    .string()
    .min(1, 'El email es obligatorio')
    .email('Ingresá un email válido')
    .toLowerCase()
    .trim(),
  password: z
    .string()
    .min(1, 'La contraseña es obligatoria')
    .min(6, 'La contraseña debe tener al menos 6 caracteres'),
})

export type LoginInput = z.infer<typeof loginSchema>