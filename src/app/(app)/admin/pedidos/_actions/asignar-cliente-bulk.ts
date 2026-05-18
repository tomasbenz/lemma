'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { puedeGestionarPedido } from '@/lib/auth/permisos'

export type AsignarClienteBulkResult = {
  ok: boolean
  exitosos: number
  fallidos: Array<{ pedidoId: string; numero: number | null; error: string }>
}

export async function asignarClienteBulk(
  pedidoIds: string[],
  clienteId: string | null,
): Promise<AsignarClienteBulkResult> {
  const user = await getCurrentUser()
  if (!user) {
    return { ok: false, exitosos: 0, fallidos: [] }
  }
  if (!user.empresa_id) {
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

  const supabase = await createClient()

  // Si clienteId no es null, verificar que existe y pertenece a la empresa
  if (clienteId !== null) {
    const { data: cliente } = await supabase
      .from('clientes')
      .select('id')
      .eq('id', clienteId)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle()
    if (!cliente) {
      return {
        ok: false,
        exitosos: 0,
        fallidos: [
          { pedidoId: '', numero: null, error: 'Cliente no encontrado' },
        ],
      }
    }
  }

  // Solo permitir asignar cliente a pedidos GUARDADA (no cerrada/anulada).
  // Tambien traemos usuario_id para validar ownership por vendedora.
  const { data: pedidos, error: errFetch } = await supabase
    .from('ventas')
    .select('id, numero, estado, usuario_id')
    .in('id', pedidoIds)
    .eq('empresa_id', user.empresa_id)

  if (errFetch) {
    return { ok: false, exitosos: 0, fallidos: [] }
  }

  const fallidos: AsignarClienteBulkResult['fallidos'] = []
  const idsValidos: string[] = []

  for (const id of pedidoIds) {
    const pedido = pedidos?.find((p) => p.id === id)
    if (!pedido) {
      fallidos.push({ pedidoId: id, numero: null, error: 'No encontrado' })
      continue
    }
    if (!puedeGestionarPedido(user, pedido.usuario_id)) {
      fallidos.push({
        pedidoId: id,
        numero: pedido.numero,
        error: 'No tenés permisos sobre este pedido',
      })
      continue
    }
    if (pedido.estado !== 'guardada') {
      fallidos.push({
        pedidoId: id,
        numero: pedido.numero,
        error: `No se puede modificar un pedido ${pedido.estado}`,
      })
      continue
    }
    idsValidos.push(id)
  }

  let exitosos = 0
  if (idsValidos.length > 0) {
    const { error } = await supabase
      .from('ventas')
      .update({ cliente_id: clienteId })
      .in('id', idsValidos)
      .eq('empresa_id', user.empresa_id)
      .eq('estado', 'guardada')

    if (error) {
      for (const id of idsValidos) {
        const pedido = pedidos?.find((p) => p.id === id)
        fallidos.push({
          pedidoId: id,
          numero: pedido?.numero ?? null,
          error: error.message,
        })
      }
    } else {
      exitosos = idsValidos.length
    }
  }

  revalidatePath('/admin/pedidos')

  return {
    ok: exitosos > 0,
    exitosos,
    fallidos,
  }
}
