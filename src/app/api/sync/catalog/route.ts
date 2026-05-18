// src/app/api/sync/catalog/route.ts
//
// Endpoint que devuelve el catálogo completo (productos + clientes) para que
// el cliente lo guarde en IndexedDB y pueda operar offline.
//
// Reusa las queries existentes de productos-caja.ts y clientes-caja.ts —
// no duplica lógica. Si esas queries cambian (filtros, ordenamientos), este
// endpoint las hereda automáticamente.
//
// Auth: requerido. Cualquier usuario logueado puede sincronizar (vendedora,
// admin, superadmin). Se valida que la sesión sea válida antes de devolver
// los datos.

import { NextResponse } from 'next/server'
import { listarProductosCaja } from '@/lib/queries/productos-caja'
import { cargarClientesCaja } from '@/lib/queries/clientes-caja'
import { getCurrentUser } from '@/lib/auth/get-current-user'

export async function GET() {
  // Validar que hay sesión antes de exponer el catálogo
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  try {
    // Reusamos las queries existentes que ya devuelven los tipos que la caja usa
    const [productos, clientes] = await Promise.all([
      listarProductosCaja(),
      cargarClientesCaja(),
    ])

    return NextResponse.json(
      {
        productos,
        clientes,
        synced_at: Date.now(),
      },
      {
        // Cache-Control: no-store para que el cliente siempre pida datos frescos.
        // El caching local lo hacemos vía IndexedDB, no vía HTTP cache.
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    )
  } catch (err) {
    console.error('[/api/sync/catalog] Error:', err)
    return NextResponse.json(
      { error: 'Error al cargar catálogo' },
      { status: 500 }
    )
  }
}