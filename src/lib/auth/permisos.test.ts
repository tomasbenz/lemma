import { test } from 'node:test'
import { strict as assert } from 'node:assert'
import {
  puedeCobrar,
  puedeEditarCatalogo,
  puedeAjustarStock,
  puedeVerPanelAdmin,
  puedeGestionarPedido,
  restringirAPedidosPropios,
} from './permisos'

// ============================================================================
// Acceso por rol — invariante: vendedora NUNCA puede cobrar / editar catálogo
// / ver el panel administrativo completo. Estos gates son la traducción TS de
// la regla de negocio "vendedora arma pedidos pero no toca plata".
// ============================================================================

test('puedeCobrar — admin y superadmin sí, vendedora no', () => {
  assert.equal(puedeCobrar('admin'), true)
  assert.equal(puedeCobrar('superadmin'), true)
  assert.equal(puedeCobrar('vendedor'), false)
})

test('puedeEditarCatalogo — admin y superadmin sí, vendedora no', () => {
  assert.equal(puedeEditarCatalogo('admin'), true)
  assert.equal(puedeEditarCatalogo('superadmin'), true)
  assert.equal(puedeEditarCatalogo('vendedor'), false)
})

test('puedeAjustarStock — TODOS los roles pueden (vendedora incluida)', () => {
  // Excepción explícita en la doc: vendedora ajusta stock con motivo,
  // el audit_log registra usuario+IP. No es "tocar plata".
  assert.equal(puedeAjustarStock('admin'), true)
  assert.equal(puedeAjustarStock('superadmin'), true)
  assert.equal(puedeAjustarStock('vendedor'), true)
})

test('puedeVerPanelAdmin — admin y superadmin sí, vendedora no', () => {
  // Vendedora tiene acceso parcial a /admin/pedidos y /admin/productos,
  // pero NO al panel administrativo en general (este gate cubre eso).
  assert.equal(puedeVerPanelAdmin('admin'), true)
  assert.equal(puedeVerPanelAdmin('superadmin'), true)
  assert.equal(puedeVerPanelAdmin('vendedor'), false)
})

// ============================================================================
// puedeGestionarPedido — ownership check para vendedora
// ============================================================================

test('puedeGestionarPedido — admin puede gestionar pedidos ajenos', () => {
  const admin = { id: 'admin-uuid', rol: 'admin' as const }
  assert.equal(puedeGestionarPedido(admin, 'otro-uuid'), true)
})

test('puedeGestionarPedido — superadmin puede gestionar pedidos ajenos', () => {
  const sa = { id: 'sa-uuid', rol: 'superadmin' as const }
  assert.equal(puedeGestionarPedido(sa, 'otro-uuid'), true)
})

test('puedeGestionarPedido — vendedora puede gestionar SUS pedidos', () => {
  const v = { id: 'vendedora-uuid', rol: 'vendedor' as const }
  assert.equal(puedeGestionarPedido(v, 'vendedora-uuid'), true)
})

test('puedeGestionarPedido — vendedora NO puede gestionar pedidos ajenos', () => {
  const v = { id: 'vendedora-uuid', rol: 'vendedor' as const }
  assert.equal(puedeGestionarPedido(v, 'otra-vendedora-uuid'), false)
})

test('puedeGestionarPedido — pedidoUsuarioId null → vendedora no puede', () => {
  // Defense in depth: si el pedido viene sin usuario_id (corner case de RLS o
  // bug de carga), la vendedora NO debe poder verlo. Solo admin/superadmin.
  const v = { id: 'vendedora-uuid', rol: 'vendedor' as const }
  assert.equal(puedeGestionarPedido(v, null), false)
})

test('puedeGestionarPedido — pedidoUsuarioId undefined → vendedora no puede', () => {
  const v = { id: 'vendedora-uuid', rol: 'vendedor' as const }
  assert.equal(puedeGestionarPedido(v, undefined), false)
})

test('puedeGestionarPedido — admin con pedido sin usuario_id igual puede', () => {
  // Admin no tiene gate por ownership; el rol es suficiente.
  const admin = { id: 'a', rol: 'admin' as const }
  assert.equal(puedeGestionarPedido(admin, null), true)
  assert.equal(puedeGestionarPedido(admin, undefined), true)
})

// ============================================================================
// restringirAPedidosPropios — devuelve user.id para vendedora, null para resto
// ============================================================================

test('restringirAPedidosPropios — vendedora devuelve su user.id', () => {
  const v = { id: 'vendedora-uuid', rol: 'vendedor' as const }
  assert.equal(restringirAPedidosPropios(v), 'vendedora-uuid')
})

test('restringirAPedidosPropios — admin devuelve null (sin restricción)', () => {
  const admin = { id: 'admin-uuid', rol: 'admin' as const }
  assert.equal(restringirAPedidosPropios(admin), null)
})

test('restringirAPedidosPropios — superadmin devuelve null', () => {
  const sa = { id: 'sa-uuid', rol: 'superadmin' as const }
  assert.equal(restringirAPedidosPropios(sa), null)
})

// ============================================================================
// Cross-helper invariante: nadie puede cobrar si no puede ver panel admin
// (excepto vendedora que puede ajustar stock pero no cobrar — caso especial)
// ============================================================================

test('invariante — puedeCobrar implica puedeEditarCatalogo (alineamiento de gates)', () => {
  const roles: Array<'admin' | 'superadmin' | 'vendedor'> = [
    'admin',
    'superadmin',
    'vendedor',
  ]
  for (const r of roles) {
    if (puedeCobrar(r)) {
      assert.equal(
        puedeEditarCatalogo(r),
        true,
        `Si ${r} puede cobrar, también debe poder editar catálogo`
      )
    }
  }
})

test('invariante — puedeCobrar implica puedeVerPanelAdmin', () => {
  const roles: Array<'admin' | 'superadmin' | 'vendedor'> = [
    'admin',
    'superadmin',
    'vendedor',
  ]
  for (const r of roles) {
    if (puedeCobrar(r)) {
      assert.equal(
        puedeVerPanelAdmin(r),
        true,
        `Si ${r} puede cobrar, también debe poder ver panel admin`
      )
    }
  }
})
