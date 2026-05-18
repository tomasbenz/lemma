import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json(
      { ok: false, error: 'No autenticado' },
      { status: 401 }
    )
  }

  // Defense in depth sobre RLS: sin empresa_id no hay tenant que consultar.
  if (!user.empresa_id && user.rol !== 'superadmin') {
    return NextResponse.json(
      { ok: false, error: 'El turno no existe' },
      { status: 404 }
    )
  }

  const { id: turnoId } = await params

  if (!turnoId || typeof turnoId !== 'string') {
    return NextResponse.json(
      { ok: false, error: 'ID de turno inválido' },
      { status: 400 }
    )
  }

  const supabase = await createClient()

  // Pre-check: turno pertenece a la empresa del caller.
  if (user.empresa_id) {
    const { data: turnoRow, error: turnoError } = await supabase
      .from('turnos_caja')
      .select('id')
      .eq('id', turnoId)
      .eq('empresa_id', user.empresa_id)
      .maybeSingle()

    if (turnoError || !turnoRow) {
      return NextResponse.json(
        { ok: false, error: 'El turno no existe' },
        { status: 404 }
      )
    }
  }

  const { data, error } = await supabase.rpc('resumen_turno', {
    p_turno_id: turnoId,
  })

  if (error) {
    console.error('[api/turnos/:id/resumen] RPC:', error)
    return NextResponse.json(
      { ok: false, error: error.message || 'Error al obtener resumen' },
      { status: 500 }
    )
  }

  if (!data || typeof data !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'Respuesta inválida' },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, resumen: data })
}
