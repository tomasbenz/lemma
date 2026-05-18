// src/lib/auth/permisos.ts
//
// Helpers canonicos de permisos para evitar la replicacion
// `if (user.rol === 'vendedor')` a lo largo del codigo.
//
// Regla del cliente Iconic Fashion: "Las cuentas de vendedoras pueden
// organizar stock y pasar cuentas. NUNCA cobrar."
//
// Traduccion al sistema:
//   - vendedora puede armar pedidos en /caja y guardarlos
//   - vendedora puede ajustar stock (RPC ajustar_stock con audit_log)
//   - vendedora puede ver / editar / anular / asignar cliente de SUS
//     propios pedidos guardados
//   - vendedora NO puede cobrar (finalizar_pedido), descuentos en caja,
//     facturas/NCs, reportes, auditoria, usuarios, configuracion,
//     catalogos, ABM de productos/clientes, ni tocar pedidos ajenos.

import type { CurrentUser } from './get-current-user'

type Rol = CurrentUser['rol']

/**
 * Acciones de "cobro" estrictamente prohibidas para vendedora:
 * finalizar_pedido, emitir factura, emitir NC, anular venta cerrada.
 */
export function puedeCobrar(rol: Rol): boolean {
  return rol === 'admin' || rol === 'superadmin'
}

/**
 * ABM completo de catalogo (crear/editar/eliminar productos, cambiar
 * precios, importar, cambiar estado, etc).
 */
export function puedeEditarCatalogo(rol: Rol): boolean {
  return rol === 'admin' || rol === 'superadmin'
}

/**
 * Ajustar stock con motivo (RPC ajustar_stock). Vendedora puede.
 * El audit_log registra usuario+IP+motivo.
 */
export function puedeAjustarStock(rol: Rol): boolean {
  return rol === 'admin' || rol === 'superadmin' || rol === 'vendedor'
}

/**
 * Acceder al panel administrativo en general (clientes, ventas,
 * reportes, usuarios, configuracion, catalogos, auditoria).
 * Vendedora SOLO tiene acceso parcial a /admin/pedidos y /admin/productos.
 */
export function puedeVerPanelAdmin(rol: Rol): boolean {
  return rol === 'admin' || rol === 'superadmin'
}

/**
 * Gestionar (ver detalle / editar items / anular / asignar cliente) un
 * pedido en estado guardada. Admin/superadmin pueden todos. Vendedora
 * solo los que ella misma creo.
 */
export function puedeGestionarPedido(
  user: Pick<CurrentUser, 'id' | 'rol'>,
  pedidoUsuarioId: string | null | undefined,
): boolean {
  if (user.rol === 'admin' || user.rol === 'superadmin') return true
  if (user.rol === 'vendedor') return pedidoUsuarioId === user.id
  return false
}

/**
 * Cuando el caller es vendedor, devuelve su user.id para usarlo como
 * filtro `usuario_id` en queries de pedidos. Para admin/superadmin
 * devuelve null (no se restringe).
 *
 * Patron: pasar este valor a `listarPedidos({ restringirUsuarioId })`
 * y a `obtenerPedido(id, { restringirUsuarioId })`.
 */
export function restringirAPedidosPropios(
  user: Pick<CurrentUser, 'id' | 'rol'>,
): string | null {
  return user.rol === 'vendedor' ? user.id : null
}
