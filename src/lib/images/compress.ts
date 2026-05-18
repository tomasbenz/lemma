/**
 * Comprime una imagen del lado del cliente usando Canvas.
 *
 * - Redimensiona a un max de ancho/alto (manteniendo aspecto)
 * - Convierte a WebP si el browser soporta, sino JPEG
 * - Calidad 0.85 por default
 * - Retorna un Blob listo para subir
 */

export type CompressOptions = {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  mimeType?: 'image/webp' | 'image/jpeg'
}

export type CompressResult = {
  blob: Blob
  mimeType: string
  width: number
  height: number
  sizeKB: number
  originalSizeKB: number
}

const DEFAULTS: Required<CompressOptions> = {
  maxWidth: 1200,
  maxHeight: 1200,
  quality: 0.85,
  mimeType: 'image/webp',
}

/**
 * Detecta si el browser soporta codificar WebP via canvas.toBlob.
 * Fallback a JPEG si no.
 */
function soportaWebP(): boolean {
  if (typeof document === 'undefined') return false
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  try {
    return canvas.toDataURL('image/webp').startsWith('data:image/webp')
  } catch {
    return false
  }
}

/**
 * Carga un File como HTMLImageElement
 */
function cargarImagen(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('No se pudo cargar la imagen'))
    }
    img.src = url
  })
}

/**
 * Calcula las dimensiones finales manteniendo aspecto
 */
function calcularDimensiones(
  origW: number,
  origH: number,
  maxW: number,
  maxH: number
): { width: number; height: number } {
  // Si ya entra, no escalar
  if (origW <= maxW && origH <= maxH) {
    return { width: origW, height: origH }
  }

  const ratioW = maxW / origW
  const ratioH = maxH / origH
  const ratio = Math.min(ratioW, ratioH)

  return {
    width: Math.round(origW * ratio),
    height: Math.round(origH * ratio),
  }
}

export async function comprimirImagen(
  file: File,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const opts = { ...DEFAULTS, ...options }

  // Si se pidió WebP pero el browser no lo soporta, fallback a JPEG
  const targetMime =
    opts.mimeType === 'image/webp' && !soportaWebP()
      ? 'image/jpeg'
      : opts.mimeType

  const img = await cargarImagen(file)

  const { width, height } = calcularDimensiones(
    img.naturalWidth,
    img.naturalHeight,
    opts.maxWidth,
    opts.maxHeight
  )

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('No se pudo crear contexto de canvas')

  // Fondo blanco si es JPEG (no soporta transparencia)
  if (targetMime === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }

  ctx.drawImage(img, 0, 0, width, height)

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Error al generar imagen comprimida'))
      },
      targetMime,
      opts.quality
    )
  })

  return {
    blob,
    mimeType: targetMime,
    width,
    height,
    sizeKB: Math.round(blob.size / 1024),
    originalSizeKB: Math.round(file.size / 1024),
  }
}

/**
 * Valida que el archivo sea una imagen aceptada
 */
export function validarArchivoImagen(file: File): {
  ok: boolean
  error?: string
} {
  const MAX_SIZE_MB = 10 // original antes de comprimir
  const TIPOS_ACEPTADOS = ['image/jpeg', 'image/png', 'image/webp']

  if (!TIPOS_ACEPTADOS.includes(file.type)) {
    return {
      ok: false,
      error: 'Formato no soportado. Usá JPG, PNG o WebP.',
    }
  }

  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    return {
      ok: false,
      error: `La imagen es muy grande (max ${MAX_SIZE_MB}MB).`,
    }
  }

  return { ok: true }
}