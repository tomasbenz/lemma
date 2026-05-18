// src/app/login/login-form.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Loader2, Eye, EyeOff, ArrowRight } from 'lucide-react'
import { toast } from 'sonner'

import { loginSchema, type LoginInput } from '@/lib/validations/auth'
import { loginAction } from '@/lib/auth/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const [isPending, startTransition] = useTransition()

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  })

  // Si vinimos con ?error=... mostrar toast
  const urlError = searchParams.get('error')
  if (urlError === 'auth_callback_error') {
    toast.error('Error de autenticación. Intentá de nuevo.')
  }

  function onSubmit(data: LoginInput) {
    startTransition(async () => {
      const result = await loginAction(data)

      if (!result.success) {
        toast.error(result.error)
        // Limpiar solo la contraseña, dejar el email para reintentar
        form.setValue('password', '')
        return
      }

      toast.success('Sesión iniciada')
      router.push(result.redirectTo)
      router.refresh() // Refresca los Server Components
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] uppercase tracking-wider text-white/55 font-medium">
                Email
              </FormLabel>
              <FormControl>
                <Input
                  type="email"
                  placeholder="tucuenta@libreriasamu.com.ar"
                  autoComplete="email"
                  autoFocus
                  disabled={isPending}
                  className="h-10 bg-white/[0.02] border-white/10 text-white placeholder:text-white/25 focus-visible:border-white/40 focus-visible:ring-0 transition-colors"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="text-[11px] uppercase tracking-wider text-white/55 font-medium">
                Contraseña
              </FormLabel>
              <FormControl>
                <div className="relative">
                  <Input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    disabled={isPending}
                    className="h-10 bg-white/[0.02] border-white/10 text-white placeholder:text-white/25 focus-visible:border-white/40 focus-visible:ring-0 transition-colors pr-10"
                    {...field}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
                    tabIndex={-1}
                    aria-label={
                      showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'
                    }
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <Button
          type="submit"
          className="group w-full h-10 mt-2 bg-white text-black hover:bg-white/90 font-medium tracking-wide transition-all"
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Ingresando...
            </>
          ) : (
            <>
              Ingresar
              <ArrowRight className="ml-2 h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
      </form>
    </Form>
  )
}