// src/lib/auth/empresa-activa.ts
import 'server-only'
import { cookies } from 'next/headers'

const COOKIE_NAME = 'lp_empresa_activa'
const COOKIE_MAX_AGE = 60 * 60 * 8 // 8 horas

/**
 * Lee el empresa_id que el superadmin está impersonando.
 * Devuelve null si no hay cookie (= no está impersonando ninguna empresa).
 *
 * Solo se usa para superadmin. Para admin/vendedor se ignora porque
 * tienen su propio empresa_id en la tabla usuarios.
 */
export async function getEmpresaActiva(): Promise<string | null> {
  const cookieStore = await cookies()
  const cookie = cookieStore.get(COOKIE_NAME)
  return cookie?.value ?? null
}

/**
 * Setea la cookie de empresa activa.
 * Llamar desde server action cuando el superadmin entra a una empresa.
 */
export async function setEmpresaActiva(empresaId: string): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, empresaId, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE,
    path: '/',
  })
}

/**
 * Borra la cookie de empresa activa.
 * Llamar cuando el superadmin sale de la empresa o cierra sesión.
 */
export async function clearEmpresaActiva(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}