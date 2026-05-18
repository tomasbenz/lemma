# Security audit log — Loom Point

## 2026-05-03 — Phase 5b: REVOKE sa_* functions
Estado anterior: las 5 funciones sa_* tenían EXECUTE para PUBLIC/anon/authenticated.
Acción: REVOKE EXECUTE FROM PUBLIC, anon, authenticated en las 5.
Resultado: solo postgres y service_role pueden invocar.
SQL ejecutado: ver bloque abajo.

\`\`\`sql
REVOKE EXECUTE ON FUNCTION public.sa_exportar_datos(p_motivo text, p_tabla text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_forzar_estado_venta(p_venta_id uuid, p_nuevo_estado venta_estado, p_motivo text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_health_check() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_reparar_stock(p_variante_id uuid, p_nuevo_stock integer, p_motivo text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sa_simular_vista_usuario(p_usuario_id uuid, p_motivo text) FROM PUBLIC, anon, authenticated;
\`\`\`

## 2026-04-28 — RLS hardening
- RLS activado en tabla `usuarios` (estaba deshabilitado, bug crítico)
- Policy `mp_webhooks_select` permisiva → DROPEADA
- 6 funciones SECURITY DEFINER hardeneadas con check auth.uid() = p_usuario_id
- anular_pedido reescrita completa
- Endpoint debug /api/debug/rls-usuarios → eliminado en commit 333d188
- Función SQL debug_rls_contexto() → DROP FUNCTION ejecutado

## 2026-05-03 — Webhook handler de Mercado Pago (en standby)

Handler implementado con 12 defensas + threat model documentado.
Estado: deployado, fail-closed por falta de MP_WEBHOOK_SECRET.

PENDIENTE para activación:
1. Crear/configurar integración en panel de developers de MP
2. Configurar webhook URL: https://<dominio>/api/webhooks/mp/c780ebc078444b269ba4f63a90f1d4aa
3. Setear MP_WEBHOOK_SECRET en Vercel (production + preview)
4. Test con notificación de prueba desde dashboard de MP
5. Verificar entrada en mp_webhook_events con procesado=true

Path segment usado: c780ebc078444b269ba4f63a90f1d4aa
(También guardado en: <tu password manager>)

Archivos relevantes:
- src/app/api/webhooks/mp/[secret_segment]/route.ts
- src/lib/mercadopago/webhook-signature.ts
- src/lib/mercadopago/webhook-schema.ts
