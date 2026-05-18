'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export type AnularBulkResult = {
  ok: boolean
  exitosos: number
  fallidos: Array<{ pedidoId: string; numero: number | null; error: string }>
}

export async function anularPedidosBulk(
  pedidoIds: string[],
  motivo: string,
): Promise<AnularBulkResult> {
  const user = await getCurrentUser()
  if (!user) {
    return { ok: false, exitosos: 0, fallidos: [] }
  }
  if (user.rol === 'vendedor') {
    return { ok: false, exitosos: 0, fallidos: [] }
  }
  if (!user.empresa_id) {
    return { ok: false, exitosos: 0, fallidos: [] }
  }

  const motivoLimpio = motivo?.trim() ?? ''
  if (!motivoLimpio) {
    return { ok: false, exitosos: 0, fallidos: [] }
  }

  if (!Array.isArray(pedidoIds) || pedidoIds.length === 0) {
    return { ok: false, exitosos: 0, fallidos: [] }
  }

  if (pedidoIds.length > 100) {
    return {
      ok: false,
      exitosos: 0,
      fallidos: [
        { pedidoId: '', numero: null, error: 'Máximo 100 pedidos por operación' },
      ],
    }
  }

  const headersList = await headers()
  const ip =
    headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    headersList.get('x-real-ip') ??
    null
  const userAgent = headersList.get('user-agent') ?? null

  const supabase = await createClient()

  // Verificar que TODOS los pedidos pertenecen a la empresa del usuario
  // (defensa en profundidad sobre RLS)
  const { data: existentes, error: errFetch } = await supabase
    .from('ventas')
    .select('id, numero, estado')
    .in('id', pedidoIds)
    .eq('empresa_id', user.empresa_id)

  if (errFetch) {
    console.error('[anularPedidosBulk] Error fetch:', errFetch)
    return { ok: false, exitosos: 0, fallidos: [] }
  }

  const fallidos: AnularBulkResult['fallidos'] = []
  let exitosos = 0

  // Procesar uno por uno (la RPC anular_pedido valida cada caso)
  for (const id of pedidoIds) {
    const pedido = existentes?.find((p) => p.id === id)

    if (!pedido) {
      fallidos.push({ pedidoId: id, numero: null, error: 'Pedido no encontrado' })
      continue
    }

    if (pedido.estado !== 'guardada') {
      fallidos.push({
        pedidoId: id,
        numero: pedido.numero,
        error: `No se puede anular un pedido ${pedido.estado}`,
      })
      continue
    }

    const { data, error } = await supabase.rpc('anular_pedido', {
      p_pedido_id: id,
      p_motivo: motivoLimpio,
      p_ip: ip,
      p_user_agent: userAgent,
    } as never)

    if (
      error ||
      !data ||
      typeof data !== 'object' ||
      !(data as { ok?: boolean }).ok
    ) {
      fallidos.push({
        pedidoId: id,
        numero: pedido.numero,
        error: error?.message ?? 'Error al anular',
      })
      continue
    }

    exitosos++
  }

  revalidatePath('/admin/pedidos')

  return {
    ok: exitosos > 0,
    exitosos,
    fallidos,
  }
}
