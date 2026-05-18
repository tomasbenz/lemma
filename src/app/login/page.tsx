// src/app/login/page.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser, getDefaultRoute } from '@/lib/auth/get-current-user'
import { LoginForm } from './login-form'

export const metadata = {
  title: 'Ingresar',
}

/**
 * Página de login.
 *
 * - Si ya hay sesión activa, redirige directamente a la ruta del rol
 *   (para evitar mostrar el formulario a usuarios ya logueados)
 */
export default async function LoginPage() {
  const user = await getCurrentUser()

  if (user) {
    redirect(getDefaultRoute(user.rol))
  }

  return (
    <div className="relative min-h-svh flex items-center justify-center bg-black p-4 overflow-hidden">
      {/* Background grain pattern (sutil) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035]"
        style={{
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='1'/></svg>\")",
        }}
      />

      {/* Radial gradient muy sutil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, rgba(255,255,255,0.04) 0%, rgba(0,0,0,0) 60%)',
        }}
      />

      {/* Tag de staging arriba a la derecha */}
      <div className="absolute top-6 right-6 z-10">
        <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-medium tracking-widest uppercase text-white/50 border border-white/10 rounded-sm">
          <span className="size-1.5 rounded-full bg-white/40" />
          Staging
        </span>
      </div>

      <div className="relative w-full max-w-[420px] animate-in fade-in slide-in-from-bottom-2 duration-500">
        {/* Monograma L */}
        <div className="flex justify-center mb-8">
          <div className="size-12 flex items-center justify-center border border-white/15 rounded-sm">
            <span className="text-white text-base font-semibold tracking-tight">
              L
            </span>
          </div>
        </div>

        {/* Branding */}
        <div className="text-center space-y-3 mb-10">
          <h1 className="text-4xl font-bold tracking-tight text-white">
            Lemma
          </h1>
          <div className="flex items-center justify-center gap-3">
            <span className="h-px w-8 bg-white/15" />
            <p className="text-[11px] uppercase tracking-[0.18em] text-white/45 font-medium">
              Sistema de gestión · Librería
            </p>
            <span className="h-px w-8 bg-white/15" />
          </div>
        </div>

        {/* Card del formulario */}
        <div className="rounded-md border border-white/10 bg-white/[0.02] backdrop-blur-sm p-7 transition-colors duration-300 hover:border-white/15 focus-within:border-white/20">
          <div className="mb-6">
            <h2 className="text-base font-semibold text-white">Ingresar</h2>
            <p className="text-xs text-white/45 mt-1">
              Iniciá sesión con tu cuenta
            </p>
          </div>
          <LoginForm />
        </div>

        {/* Footer */}
        <div className="mt-8 flex items-center justify-between text-[11px] text-white/35">
          <span className="font-numeric tabular-nums">v0.1</span>
          <p>
            ¿Problemas para ingresar?{' '}
            <span className="text-white/55 hover:text-white/80 transition-colors cursor-default">
              Contactá al administrador
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}