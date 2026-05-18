'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { clienteSchema } from '@/lib/validations/cliente'

type ActionResult =
  | { ok: true; clienteId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

export async function crearCliente(
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await getCurrentUser()
    if (!user) redirect('/login')
    if (user.rol === 'vendedor') {
      return { ok: false, error: 'Sin permisos' }
    }
    if (!user.empresa_id) {
      return { ok: false, error: 'No hay empresa activa' }
    }

    const raw = {
      razon_social: formData.get('razon_social')?.toString() ?? '',
      cond_iva: formData.get('cond_iva')?.toString() ?? '',
      cuit: formData.get('cuit')?.toString() ?? '',
      email: formData.get('email')?.toString() ?? '',
      telefono: formData.get('telefono')?.toString() ?? '',
      domicilio: formData.get('domicilio')?.toString() ?? '',
      localidad: formData.get('localidad')?.toString() ?? '',
      provincia: formData.get('provincia')?.toString() ?? '',
      notas: formData.get('notas')?.toString() ?? '',
    }

    const parsed = clienteSchema.safeParse(raw)
    if (!parsed.success) {
      const fieldErrors: Record<string, string[]> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]?.toString() ?? '_'
        if (!fieldErrors[key]) fieldErrors[key] = []
        fieldErrors[key].push(issue.message)
      }
      return {
        ok: false,
        error: 'Revisá los campos marcados',
        fieldErrors,
      }
    }

    const data = parsed.data
    const supabase = await createClient()

    // Si mandó CUIT, verificar que no exista otro cliente activo con ese CUIT
    if (data.cuit) {
      const { data: existente } = await supabase
        .from('clientes')
        .select('id, razon_social')
        .eq('cuit', data.cuit)
        .eq('activo', true)
        .eq('empresa_id', user.empresa_id)
        .maybeSingle()

      if (existente) {
        return {
          ok: false,
          error: `Ya existe un cliente con ese CUIT: ${existente.razon_social}`,
          fieldErrors: { cuit: ['CUIT ya registrado'] },
        }
      }
    }

    const { data: cliente, error } = await supabase
      .from('clientes')
      .insert({
        empresa_id: user.empresa_id,
        razon_social: data.razon_social,
        cond_iva: data.cond_iva,
        cuit: data.cuit,
        email: data.email,
        telefono: data.telefono,
        domicilio: data.domicilio,
        localidad: data.localidad,
        provincia: data.provincia,
        notas: data.notas,
        activo: true,
        created_by: user.id,
      } as never)
      .select('id')
      .single()

    if (error || !cliente) {
      console.error('[crearCliente]', error)
      return {
        ok: false,
        error: error?.message ?? 'No se pudo crear el cliente',
      }
    }

    revalidatePath('/admin/clientes')

    return { ok: true, clienteId: cliente.id }
  } catch (err) {
    console.error('[crearCliente] error inesperado:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}