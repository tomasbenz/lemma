// next.config.ts
import type { NextConfig } from 'next'
import withSerwistInit from '@serwist/next'

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  // En dev queremos Turbopack a full velocidad y sin SW interfiriendo con HMR.
  // En production (Vercel) sí se activa el SW.
  disable: process.env.NODE_ENV === 'development',
  // Cuando vuelve internet, recargar la página automáticamente para que las
  // queries que estaban en estado de error se reintenten contra el server real.
  reloadOnOnline: true,
})

const nextConfig: NextConfig = {
  // Config explícita de Turbopack (vacía es válida).
  // Le dice a Next 16 que NO use el webpack config implícito que agrega Serwist
  // cuando estamos en dev. Sin esto, Next tira el error
  // "This build is using Turbopack, with a webpack config and no turbopack config".
  turbopack: {},

  // Evitar que se loguee el contenido de las Server Actions.
  // El logging default puede incluir passwords, tokens, etc.
  logging: {
    fetches: {
      fullUrl: false,
    },
    incomingRequests: {
      ignore: [/\/_next\//],
    },
  },
  // Seguridad: headers globales + headers específicos para Service Worker.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
      {
        // Service Worker: jamás cachear el archivo en sí, y permitir scope amplio.
        // Si el navegador cachea sw.js, las actualizaciones del SW nunca llegan.
        source: '/sw.js',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-store, must-revalidate',
          },
          {
            key: 'Service-Worker-Allowed',
            value: '/',
          },
        ],
      },
      {
        // Manifest: cache moderado.
        source: '/manifest.json',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600',
          },
        ],
      },
    ]
  },
  // Dominios permitidos para next/image
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'mxkelleuppbdghmokcur.supabase.co',
        pathname: '/storage/v1/object/public/productos/**',
      },
    ],
  },
}

export default withSerwist(nextConfig)