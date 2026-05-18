// src/app/layout.tsx
import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
})
const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: 'Loom Point',
    template: '%s · Loom Point',
  },
  description: 'Sistema de gestión de ventas para Design Plus',
  robots: {
    index: false,
    follow: false,
  },
  // iPad / iOS: cuando se "instala" en pantalla de inicio, se abre full-screen
  // sin la barra de Safari, con estos valores.
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Loom Point',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: '#000000',
  width: 'device-width',
  initialScale: 1,
  // No permitir zoom: en POS táctil el zoom accidental es molesto.
  // Desactivarlo previene los pinch-zoom no intencionales.
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="es" className="dark" suppressHydrationWarning>
      <head>
        <link
          rel="preconnect"
          href="https://mxkelleuppbdghmokcur.supabase.co"
          crossOrigin="anonymous"
        />
        <link
          rel="dns-prefetch"
          href="https://mxkelleuppbdghmokcur.supabase.co"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        {children}
        <Toaster
          position="top-center"
          richColors
          closeButton={false}
          duration={2500}
        />
      </body>
    </html>
  )
}