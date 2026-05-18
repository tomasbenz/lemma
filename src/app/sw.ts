// src/app/sw.ts
//
// Service Worker de Loom Point.
//
// FASE 1: precache de assets de la app, runtime caching de imágenes y páginas.
// Sin lógica de pedidos offline todavía (eso es Fase 3).
//
// Serwist genera el SW final en build, reemplazando self.__SW_MANIFEST con
// el manifiesto real de archivos del build. Acá solo declaramos la config.

import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { Serwist } from 'serwist'

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  // El manifiesto de precache lo inyecta Serwist en build time
  precacheEntries: self.__SW_MANIFEST,

  // skipWaiting: cuando hay un SW nuevo, lo activa inmediatamente
  // (en lugar de esperar a que se cierren todas las pestañas)
  skipWaiting: true,

  // clientsClaim: el SW toma control de las pestañas existentes apenas se activa
  clientsClaim: true,

  // navigationPreload: optimización que paraleliza el fetch de la página
  // con el arranque del SW. Reduce latencia de navegación.
  navigationPreload: true,

  // runtimeCaching: estrategias de cache para los recursos en tiempo de ejecución.
  // defaultCache de Serwist trae estrategias bien pensadas:
  //   - Páginas HTML: NetworkFirst (siempre intenta server, fallback a cache)
  //   - Assets de Next (_next/static): CacheFirst (no cambian dentro del build)
  //   - Imágenes: StaleWhileRevalidate
  //   - Fonts: CacheFirst con expiración larga
  //   - APIs: NetworkFirst con timeout
  // Las APIs y Server Actions de Loom Point NO se cachean — la lógica offline
  // de pedidos/catálogo vive en IndexedDB (Fases 2-3), no acá.
  runtimeCaching: defaultCache,
})

serwist.addEventListeners()