'use client'

import { useRef, useState } from 'react'
import Image from 'next/image'
import { ImagePlus, Loader2, Trash2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  comprimirImagen,
  validarArchivoImagen,
} from '@/lib/images/compress'
import {
  subirImagenProducto,
  borrarImagenProducto,
} from '@/lib/images/upload'

type ImagenProductoUploadProps = {
  value: string | null
  onChange: (url: string | null) => void
  productoId?: string | null
  disabled?: boolean
}

/**
 * Uploader de imagen principal con:
 * - Preview
 * - Compresión client-side (1200px max, WebP)
 * - Validación de tipo y tamaño
 * - Drag & drop
 * - Botones "Cambiar" y "Eliminar"
 */
export function ImagenProductoUpload({
  value,
  onChange,
  productoId = null,
  disabled = false,
}: ImagenProductoUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  async function procesarArchivo(file: File) {
    const validacion = validarArchivoImagen(file)
    if (!validacion.ok) {
      toast.error(validacion.error!)
      return
    }

    setUploading(true)
    try {
      // 1. Comprimir
      const comprimida = await comprimirImagen(file, {
        maxWidth: 1200,
        maxHeight: 1200,
        quality: 0.85,
      })

      // 2. Subir
      const result = await subirImagenProducto(
        comprimida.blob,
        comprimida.mimeType,
        productoId
      )

      if (!result.ok) {
        toast.error('Error al subir imagen: ' + result.error)
        return
      }

      // 3. Si había una previa, borrarla (best effort, después de subir la nueva)
      if (value) {
        void borrarImagenProducto(value)
      }

      onChange(result.url)
      toast.success(
        `Imagen subida (${comprimida.sizeKB} KB desde ${comprimida.originalSizeKB} KB)`
      )
    } catch (error) {
      console.error(error)
      toast.error('Error al procesar imagen')
    } finally {
      setUploading(false)
    }
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) procesarArchivo(file)
    // reset para permitir subir el mismo archivo dos veces
    e.target.value = ''
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    if (disabled || uploading) return
    const file = e.dataTransfer.files?.[0]
    if (file) procesarArchivo(file)
  }

  async function handleEliminar() {
    if (!value) return
    // Borrar best-effort en Storage (si es la URL de esta sesión)
    void borrarImagenProducto(value)
    onChange(null)
    toast.success('Imagen eliminada')
  }

  const tieneImagen = !!value

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleFileSelect}
        disabled={disabled || uploading}
      />

      {tieneImagen ? (
        <div className="space-y-3">
          <div className="relative w-full aspect-square max-w-xs rounded-md border overflow-hidden bg-muted">
            <Image
              src={value}
              alt="Imagen del producto"
              fill
              sizes="(max-width: 768px) 100vw, 320px"
              className="object-contain"
              unoptimized
            />
            {uploading && (
              <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                <Loader2 className="size-6 animate-spin" />
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || uploading}
            >
              <RefreshCw className="size-3.5 mr-1.5" />
              Cambiar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleEliminar}
              disabled={disabled || uploading}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5 mr-1.5" />
              Eliminar
            </Button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => !disabled && !uploading && inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            if (!disabled && !uploading) setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'w-full max-w-xs aspect-square rounded-md border-2 border-dashed flex flex-col items-center justify-center gap-2 transition-colors cursor-pointer',
            'hover:border-foreground/40 hover:bg-muted/30',
            isDragging && 'border-foreground/60 bg-muted/40',
            (disabled || uploading) && 'opacity-60 cursor-not-allowed'
          )}
        >
          {uploading ? (
            <>
              <Loader2 className="size-8 text-muted-foreground animate-spin" />
              <p className="text-sm text-muted-foreground">Subiendo...</p>
            </>
          ) : (
            <>
              <ImagePlus className="size-8 text-muted-foreground" />
              <div className="text-center">
                <p className="text-sm font-medium">Agregar imagen</p>
                <p className="text-xs text-muted-foreground">
                  JPG, PNG o WebP · max 10MB
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click o arrastrar acá
                </p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}