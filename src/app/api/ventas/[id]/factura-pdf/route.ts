import { NextRequest, NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import QRCode from 'qrcode'
import { createElement } from 'react'
import { getCurrentUser } from '@/lib/auth/get-current-user'
import { createClient } from '@/lib/supabase/server'
import { obtenerConfiguracion } from '@/lib/queries/configuracion'
import { FacturaPdf, type FacturaPdfData } from '@/lib/pdf/factura-pdf'
import { descomponerFactura } from '@/lib/afip/calculos'
import { formatearFechaDDMMYYYY } from '@/lib/afip/fechas'
import { armarQrUrl } from '@/lib/afip/qr'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }
  if (user.rol === 'vendedor') {
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  const { id: ventaId } = await params

  // Defense in depth sobre RLS: sin empresa_id no hay tenant que consultar.
  // Mismo 404 genérico que "venta no encontrada" para no filtrar info.
  if (!user.empresa_id) {
    return NextResponse.json(
      { error: 'Venta no encontrada' },
      { status: 404 }
    )
  }

  const supabase = await createClient()

  // Traer en paralelo: config de empresa + venta + factura
  const [config, ventaResult, facturaResult] = await Promise.all([
    obtenerConfiguracion(),
    supabase
      .from('ventas')
      .select(
        `
        id,
        numero,
        created_at,
        tipo_factura,
        monto_facturado,
        subtotal_neto,
        total,
        nombre_cliente_custom,
        cliente:clientes!ventas_cliente_id_fkey(razon_social, cuit, cond_iva, domicilio),
        items_venta(
          producto_nombre,
          variante_sku,
          cantidad,
          precio_unitario_neto,
          subtotal_neto
        )
      `
      )
      .eq('id', ventaId)
      .eq('empresa_id', user.empresa_id)
      .single(),
    supabase
      .from('facturas_afip')
      .select('*')
      .eq('venta_id', ventaId)
      .eq('empresa_id', user.empresa_id)
      // Aceptar tanto facturas activas (aprobada) como anuladas por NC posterior.
      // La factura original sigue siendo válida para reimpresión y auditoría —
      // el CAE no se invalida cuando se emite NC. La NC asociada se muestra en
      // otra parte de la UI.
      .in('estado', ['aprobada', 'anulada_por_nc'])
      .maybeSingle(),
  ])

  const venta = ventaResult.data
  const factura = facturaResult.data

  if (!venta) {
    return NextResponse.json(
      { error: 'Venta no encontrada' },
      { status: 404 }
    )
  }

  if (!factura || !factura.cae) {
    return NextResponse.json(
      { error: 'La factura no está aprobada o no existe' },
      { status: 404 }
    )
  }

  // Normalizar cliente
  const clienteRaw = venta.cliente as
    | Array<{
        razon_social: string
        cuit: string | null
        cond_iva: string
        domicilio: string | null
      }>
    | {
        razon_social: string
        cuit: string | null
        cond_iva: string
        domicilio: string | null
      }
    | null
  const cliente = Array.isArray(clienteRaw) ? clienteRaw[0] ?? null : clienteRaw

  const condIvaLabels: Record<string, string> = {
    RI: 'IVA Responsable Inscripto',
    MONO: 'IVA Responsable Monotributo',
    CF: 'Consumidor Final',
    EX: 'IVA Exento',
  }

  const items = (venta.items_venta ?? []) as Array<{
    producto_nombre: string
    variante_sku: string
    cantidad: number
    precio_unitario_neto: number
    subtotal_neto: number
  }>

  // Totales según tipo. Bajo el modelo nuevo, monto_facturado YA es el total
  // final cobrado: para A y B se descompone en neto + IVA; para C el IVA
  // queda en 0 (no aplica a emisores RI — solo backcompat de homo).
  const esTipoA = venta.tipo_factura === 'factura_a'
  const {
    netoGravado: subtotalNeto,
    iva,
    total: totalFactura,
  } = descomponerFactura(
    venta.monto_facturado,
    venta.tipo_factura as 'factura_a' | 'factura_b' | 'factura_c',
  )

  // Items prorrateados al monto facturado (regla inviolable del cliente,
  // memoria #5 del proyecto). Cada item se ajusta por el factor
  // monto_facturado / sum(subtotal_neto). Replica el cálculo del server
  // action `emitir-factura-afip.ts` para que el PDF muestre los mismos
  // valores que recibió AFIP, y sum(items) = TOTAL exacto.
  const totalNetoItems = items.reduce(
    (acc, i) => acc + Number(i.subtotal_neto),
    0,
  )
  // Si no hay neto (no debería pasar en una factura aprobada), factor=1
  // para no dividir por cero — la suma se ajusta abajo en el último item.
  const factor = totalNetoItems > 0
    ? venta.monto_facturado / totalNetoItems
    : 1

  const itemsParaPdf = items.map((i) => {
    const precioUnitarioFacturado =
      Math.round(Number(i.precio_unitario_neto) * factor * 100) / 100
    const subtotalFacturado =
      Math.round(i.cantidad * precioUnitarioFacturado * 100) / 100
    return {
      nombre: i.producto_nombre,
      sku: i.variante_sku,
      cantidad: i.cantidad,
      precio_unitario: precioUnitarioFacturado,
      subtotal: subtotalFacturado,
    }
  })

  // Ajuste fino: el último item absorbe centavos de redondeo para que
  // sum(items) = totalFactura exactamente. Mismo patrón que el server action.
  // A diferencia del server action, acá NO threwamos si la diferencia es
  // grande: el PDF siempre se renderiza, queremos que cierre visualmente.
  const sumaActual = itemsParaPdf.reduce((acc, i) => acc + i.subtotal, 0)
  const diferencia = Math.round((totalFactura - sumaActual) * 100) / 100
  if (diferencia !== 0 && itemsParaPdf.length > 0) {
    const last = itemsParaPdf[itemsParaPdf.length - 1]
    last.subtotal = Math.round((last.subtotal + diferencia) * 100) / 100
  }

  // El tipoCmp del QR debe matchear exactamente el cbteTipo enviado a AFIP.
  // Emisor RI emite:
  // - factura_a → cbteTipo 1 (Factura A)
  // - factura_b → cbteTipo 6 (Factura B)
  // - factura_c en DB → cbteTipo 6 (Factura B), backcompat de ventas
  //   historicas de homologacion. Un RI NUNCA emite Factura C real.
  // Si en el futuro se suman NC/ND, mapear acá: 3=NC A, 8=NC B, 13=NC C,
  // 2=ND A, 7=ND B, 12=ND C.
  const tipoCmp = esTipoA ? 1 : 6

  // QR con formato AFIP/ARCA (RG 4892/2020). Lógica encapsulada en
  // `armarQrUrl` para mantener este route delgado y testear el helper aislado.
  const qrUrl = armarQrUrl({
    cuitEmisor: config.cuit,
    fecha: factura.created_at,
    puntoVenta: factura.punto_venta,
    tipoCmp,
    nroCmp: factura.numero_comprobante ?? 0,
    importe: totalFactura,
    cuitReceptor: cliente?.cuit ?? null,
    cae: factura.cae,
  })
  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    width: 200,
    margin: 1,
  })

  // Fechas formateadas.
  //
  // fechaEmision: usa helper compartido con TZ AR para garantizar que el día
  // del PDF coincida con el CbteFch enviado a AFIP. `factura.created_at` es
  // un timestamptz (instante absoluto) y `toLocaleDateString` respetaría la
  // TZ del runtime (UTC en Vercel) — para ventas emitidas cerca de medianoche
  // AR ese drift hace divergir el PDF del comprobante AFIP.
  //
  // cae_vencimiento e inicio_actividades son columnas `date` (día civil sin
  // hora), no instantes. Las dejamos con `toLocaleDateString` porque el helper
  // de fechas.ts opera sobre instantes y aplicar TZ AR a un `new Date('2026-05-23')`
  // (UTC midnight) devolvería el día anterior.
  const fechaEmision = formatearFechaDDMMYYYY(new Date(factura.created_at))
  const caeVencimiento = factura.cae_vencimiento
    ? new Date(factura.cae_vencimiento).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—'
  const inicioActividades = config.inicio_actividades
    ? new Date(config.inicio_actividades).toLocaleDateString('es-AR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '—'

  const nombreCustom = (
    venta as { nombre_cliente_custom?: string | null }
  ).nombre_cliente_custom

  const data: FacturaPdfData = {
    empresa: {
      razon_social: config.razon_social,
      nombre_fantasia: config.nombre_fantasia,
      cuit: config.cuit,
      domicilio: config.domicilio ?? '—',
      localidad: config.localidad,
      condicion_iva: config.condicion_iva,
      ingresos_brutos: config.ingresos_brutos ?? '—',
      inicio_actividades: inicioActividades,
    },
    tipo: esTipoA ? 'A' : 'B',
    puntoVenta: factura.punto_venta,
    numero: factura.numero_comprobante ?? 0,
    fechaEmision,
    cae: factura.cae,
    caeVencimiento,
    qrDataUrl,
    cliente: {
      razon_social: cliente?.razon_social ?? 'Consumidor Final',
      cuit: cliente?.cuit ?? '-',
      cond_iva: cliente
        ? condIvaLabels[cliente.cond_iva] ?? cliente.cond_iva
        : 'Consumidor Final',
      domicilio: cliente?.domicilio ?? null,
      nombre_custom: nombreCustom?.trim() || null,
    },
    items: itemsParaPdf,
    subtotalNeto,
    iva,
    total: totalFactura,
  }

  const pdfBuffer = await renderToBuffer(
    createElement(FacturaPdf, { data }) as never
  )

  return new NextResponse(new Uint8Array(pdfBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="factura-${factura.punto_venta}-${factura.numero_comprobante}.pdf"`,
    },
  })
}