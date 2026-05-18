'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { clienteSchema } from '@/lib/validations/cliente'

type ActionResult =
  | { ok: true; clienteId: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> }

export async function actualizarCliente(
  id: string,
  formData: FormData
): Promise<ActionResult> {
  try {
    const user = await getCurrentUser()
    if (!user) redirect('/login')
    if (user.rol === 'vendedor') return { ok: false, error: 'Sin permisos' }
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
      return { ok: false, error: 'Revisá los campos marcados', fieldErrors }
    }

    const data = parsed.data
    const supabase = await createClient()

    // Verificar CUIT duplicado (excluir al actual)
    if (data.cuit) {
      const { data: existente } = await supabase
        .from('clientes')
        .select('id, razon_social')
        .eq('cuit', data.cuit)
        .eq('activo', true)
        .eq('empresa_id', user.empresa_id)
        .neq('id', id)
        .maybeSingle()

      if (existente) {
        return {
          ok: false,
          error: `Ya existe otro cliente con ese CUIT: ${existente.razon_social}`,
          fieldErrors: { cuit: ['CUIT ya registrado en otro cliente'] },
        }
      }
    }

    const { error } = await supabase
      .from('clientes')
      .update({
        razon_social: data.razon_social,
        cond_iva: data.cond_iva,
        cuit: data.cuit,
        email: data.email,
        telefono: data.telefono,
        domicilio: data.domicilio,
        localidad: data.localidad,
        provincia: data.provincia,
        notas: data.notas,
      } as never)
      .eq('id', id)
      .eq('empresa_id', user.empresa_id)

    if (error) {
      console.error('[actualizarCliente]', error)
      return { ok: false, error: error.message }
    }

    revalidatePath('/admin/clientes')
    revalidatePath(`/admin/clientes/${id}`)

    return { ok: true, clienteId: id }
  } catch (err) {
    console.error('[actualizarCliente]', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Error inesperado',
    }
  }
}