import { createClient } from '@/lib/supabase/client'

const BUCKET = 'productos'

export type UploadResult =
  | { ok: true; url: string; path: string }
  | { ok: false; error: string }

/**
 * Sube un Blob al bucket "productos" y retorna la URL pública.
 *
 * Path: {productoId}/{timestamp}.{ext}
 * - Usar productoId permite organizar por carpeta
 * - Usar timestamp evita colisiones si se reemplaza rápido
 *
 * Si productoId es null (caso alta), usa "nuevos/{timestamp}.{ext}" temporalmente.
 * El caller es responsable de mover/renombrar después si quiere (no lo hacemos por ahora
 * porque Supabase no tiene rename atómico — la URL queda así).
 */
export async function subirImagenProducto(
  blob: Blob,
  mimeType: string,
  productoId: string | null
): Promise<UploadResult> {
  const supabase = createClient()

  const ext = mimeType === 'image/webp' ? 'webp' : 'jpg'
  const timestamp = Date.now()
  const carpeta = productoId ?? 'nuevos'
  const path = `${carpeta}/${timestamp}.${ext}`

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(path, blob, {
      contentType: mimeType,
      cacheControl: '3600',
      upsert: false,
    })

  if (error) {
    console.error('[subirImagenProducto] Error:', error)
    return { ok: false, error: error.message }
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(BUCKET).getPublicUrl(path)

  return { ok: true, url: publicUrl, path }
}

/**
 * Extrae el path relativo desde una URL pública de Supabase Storage.
 * Retorna null si la URL no es del bucket esperado.
 *
 * Ej: "https://xxx.supabase.co/storage/v1/object/public/productos/abc/123.webp"
 *  → "abc/123.webp"
 */
export function extraerPathDesdeUrl(url: string): string | null {
  if (!url) return null
  const marcador = `/storage/v1/object/public/${BUCKET}/`
  const idx = url.indexOf(marcador)
  if (idx === -1) return null
  return url.slice(idx + marcador.length)
}

/**
 * Borra una imagen del bucket "productos" por URL pública.
 * Silencioso si falla (best effort — no queremos que el fallo de borrado
 * bloquee una actualización de producto).
 */
export async function borrarImagenProducto(urlOPath: string): Promise<void> {
  if (!urlOPath) return

  const path = urlOPath.startsWith('http')
    ? extraerPathDesdeUrl(urlOPath)
    : urlOPath

  if (!path) return

  try {
    const supabase = createClient()
    const { error } = await supabase.storage.from(BUCKET).remove([path])
    if (error) {
      console.warn('[borrarImagenProducto] No se pudo borrar:', error.message)
    }
  } catch (e) {
    console.warn('[borrarImagenProducto] Excepción:', e)
  }
}