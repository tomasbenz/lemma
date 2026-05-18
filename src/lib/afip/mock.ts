import 'server-only'
import type {
  AdaptadorAfip,
  DatosFacturaInput,
  ResultadoConsulta,
  ResultadoConsultaUltimo,
  ResultadoFactura,
  ResultadoFacturaExito,
  ResultadoHealthcheck,
  TipoFacturaAfip,
} from './types'

/**
 * Adaptador MOCK de AFIP.
 *
 * Simula el comportamiento real:
 * - Delay de 600-1000ms (como una llamada HTTP a AFIP).
 * - Genera un CAE ficticio de 14 dígitos.
 * - Asigna números correlativos por punto de venta + tipo de comprobante.
 * - CAE vence a 10 días desde hoy (igual al real).
 * - ~5% de los casos simula un rechazo para probar flujos de error.
 * - Mantiene los emitidos para que `consultarComprobante` pueda recuperarlos
 *   (útil para testear reconciliación tras timeout).
 *
 * Cuando tengamos certificados + WSFE habilitados, se reemplaza por real.ts
 * (Fase 5) y `index.ts` decide cuál exportar según env.
 */

// ============================================================
// ESTADO INTERNO DEL MOCK
// ============================================================

// Contadores correlativos por `${puntoVenta}:${tipoFactura}`.
// En producción real esto lo maneja AFIP.
const contadoresMock = new Map<string, number>()

// Comprobantes emitidos para soportar `consultarComprobante`.
// key = `${puntoVenta}:${tipoFactura}:${numero}`
const emitidosMock = new Map<string, ResultadoFacturaExito>()

// ============================================================
// HELPERS
// ============================================================

function keyContador(puntoVenta: number, tipo: TipoFacturaAfip): string {
  return `${puntoVenta}:${tipo}`
}

function keyEmitido(
  puntoVenta: number,
  tipo: TipoFacturaAfip,
  numero: number,
): string {
  return `${puntoVenta}:${tipo}:${numero}`
}

function siguienteNumero(puntoVenta: number, tipo: TipoFacturaAfip): number {
  const key = keyContador(puntoVenta, tipo)
  const actual = contadoresMock.get(key) ?? 0
  const siguiente = actual + 1
  contadoresMock.set(key, siguiente)
  return siguiente
}

function generarCaeFicticio(): string {
  // 14 dígitos (AFIP usa 14)
  let cae = ''
  for (let i = 0; i < 14; i++) {
    cae += Math.floor(Math.random() * 10).toString()
  }
  return cae
}

function fechaEnDias(dias: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dias)
  return d.toISOString().split('T')[0]
}

function esTipoA_oB(tipo: TipoFacturaAfip): boolean {
  return (
    tipo === 'factura_a' ||
    tipo === 'factura_b' ||
    tipo === 'nc_a' ||
    tipo === 'nc_b' ||
    tipo === 'nd_a' ||
    tipo === 'nd_b'
  )
}

function esTipoC(tipo: TipoFacturaAfip): boolean {
  return tipo === 'factura_c' || tipo === 'nc_c' || tipo === 'nd_c'
}

function esNcOnD(tipo: TipoFacturaAfip): boolean {
  return tipo.startsWith('nc_') || tipo.startsWith('nd_')
}

function fechaValidaYYYYMMDD(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s))
}

function diferenciaEnDias(fechaIso: string): number {
  // Truncamos hoy y la fecha al día (UTC) para evitar drift por zona horaria.
  const hoy = new Date()
  const hoyUtc = Date.UTC(
    hoy.getUTCFullYear(),
    hoy.getUTCMonth(),
    hoy.getUTCDate(),
  )
  const target = new Date(fechaIso)
  const targetUtc = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  )
  const msPorDia = 1000 * 60 * 60 * 24
  return Math.round((targetUtc - hoyUtc) / msPorDia)
}

// ============================================================
// VALIDACIONES PRE-EMISIÓN
// ============================================================

function validarDatos(datos: DatosFacturaInput): string | null {
  // 1. Monto total > 0
  if (datos.montoTotal <= 0) {
    return 'El monto total debe ser mayor a cero'
  }

  // 2. Punto de venta entre 1 y 9999
  if (datos.puntoVenta < 1 || datos.puntoVenta > 9999) {
    return 'Punto de venta inválido'
  }

  // 3. Items no vacíos
  if (datos.items.length === 0) {
    return 'La factura debe tener al menos un item'
  }

  // 4. Items con valores válidos
  for (const item of datos.items) {
    if (
      item.cantidad <= 0 ||
      item.precioUnitarioFacturado < 0 ||
      item.subtotalFacturado < 0
    ) {
      return `Item inválido: ${item.productoSku}`
    }
  }

  // 5. Suma de items = montoTotal (tolerancia 0.05)
  const sumaItems = datos.items.reduce(
    (acc, i) => acc + i.subtotalFacturado,
    0,
  )
  if (Math.abs(sumaItems - datos.montoTotal) >= 0.05) {
    return `Suma de items facturados (${sumaItems}) no coincide con monto total (${datos.montoTotal})`
  }

  // 6. Coherencia de alícuotas según tipo
  if (esTipoA_oB(datos.tipoFactura)) {
    if (datos.alicuotas.length === 0) {
      return 'Factura A/B requiere al menos una alícuota de IVA'
    }
  }
  if (esTipoC(datos.tipoFactura)) {
    if (datos.alicuotas.length !== 0) {
      return 'Factura C no debe tener alícuotas'
    }
  }

  // 7. A/B: sum(baseImp) + sum(importe) = montoTotal (tolerancia 0.05)
  if (esTipoA_oB(datos.tipoFactura) && datos.alicuotas.length > 0) {
    const sumaBase = datos.alicuotas.reduce((acc, a) => acc + a.baseImp, 0)
    const sumaIva = datos.alicuotas.reduce((acc, a) => acc + a.importe, 0)
    if (Math.abs(sumaBase + sumaIva - datos.montoTotal) >= 0.05) {
      return 'Alícuotas no suman el monto total'
    }
  }

  // 8. Receptor para factura A
  if (datos.tipoFactura === 'factura_a') {
    if (!datos.receptor) {
      return 'Factura A requiere receptor RI o Monotributo'
    }
    if (datos.receptor.condIva !== 1 && datos.receptor.condIva !== 6) {
      return 'Factura A requiere receptor RI o Monotributo'
    }
    if (datos.receptor.documento.tipo !== 80) {
      return 'Factura A requiere CUIT del receptor'
    }
  }

  // 9. Concepto y fechas de servicio
  if (datos.concepto === 2 || datos.concepto === 3) {
    if (
      !datos.fechaServicioDesde ||
      !datos.fechaServicioHasta ||
      !datos.fechaVtoPago
    ) {
      return 'Concepto servicios requiere fechas de servicio'
    }
  }

  // 10. NC/ND requieren comprobante asociado
  if (esNcOnD(datos.tipoFactura)) {
    if (
      !datos.comprobantesAsociados ||
      datos.comprobantesAsociados.length === 0
    ) {
      return 'Notas de crédito y débito requieren comprobante asociado'
    }
  }

  // 11. Fecha de emisión: formato YYYY-MM-DD, ±10 días
  if (!fechaValidaYYYYMMDD(datos.fechaEmision)) {
    return 'Fecha de emisión fuera de rango ±10 días'
  }
  const diff = diferenciaEnDias(datos.fechaEmision)
  if (diff < -10 || diff > 10) {
    return 'Fecha de emisión fuera de rango ±10 días'
  }

  return null
}

// ============================================================
// IMPLEMENTACIÓN DEL ADAPTADOR
// ============================================================

export const adaptadorMock: AdaptadorAfip = {
  nombre: 'mock',

  async emitir(datos: DatosFacturaInput): Promise<ResultadoFactura> {
    // Simular latencia de red (600-1000ms)
    await new Promise((r) => setTimeout(r, 600 + Math.random() * 400))

    // Validaciones que el mock corre antes de "llamar a AFIP"
    const errorValidacion = validarDatos(datos)
    if (errorValidacion) {
      return {
        ok: false,
        error: errorValidacion,
        rawResponse: {
          mock: true,
          rechazadoPor: 'validacion_local',
          detalle: errorValidacion,
        },
      }
    }

    // Rechazo aleatorio (~5%) para probar flujos de error
    if (Math.random() < 0.05) {
      return {
        ok: false,
        error: 'AFIP rechazó el comprobante (simulado)',
        codigoError: 10016,
        rawResponse: {
          mock: true,
          rechazadoPor: 'afip_simulado',
          codigoError: 10016,
          mensaje: 'La fecha del comprobante está fuera del rango permitido (simulación)',
        },
      }
    }

    // Éxito: generamos respuesta como si AFIP hubiera aprobado
    const numero = siguienteNumero(datos.puntoVenta, datos.tipoFactura)
    const cae = generarCaeFicticio()
    const caeVencimiento = fechaEnDias(10)

    const ivaPayload = datos.alicuotas.map((a) => ({
      Id: a.id,
      BaseImp: a.baseImp,
      Importe: a.importe,
    }))

    const docTipo = datos.receptor?.documento.tipo ?? 99
    const docNro = datos.receptor?.documento.nro ?? '0'
    const condIvaReceptorId = datos.receptor?.condIva ?? 5

    const cbteTipo: number = (() => {
      // Mapeo inline para no acoplar mock al export de CBTE_TIPO_AFIP.
      switch (datos.tipoFactura) {
        case 'factura_a': return 1
        case 'factura_b': return 6
        case 'factura_c': return 11
        case 'nota_credito_a': return 3
        case 'nota_credito_b': return 8
        case 'nota_debito_a': return 2
        case 'nota_debito_b': return 7
        case 'nc_a': return 3
        case 'nc_b': return 8
        case 'nc_c': return 13
        case 'nd_a': return 2
        case 'nd_b': return 7
        case 'nd_c': return 12
      }
    })()

    const exito: ResultadoFacturaExito = {
      ok: true,
      cae,
      caeVencimiento,
      numeroComprobante: numero,
      resultado: 'A',
      observaciones: undefined,
      eventos: undefined,
      rawResponse: {
        mock: true,
        CbteTipo: cbteTipo,
        PtoVta: datos.puntoVenta,
        CbteNro: numero,
        CAE: cae,
        CAEFchVto: caeVencimiento.replace(/-/g, ''),
        Resultado: 'A',
        Iva: ivaPayload,
        CondicionIVAReceptorId: condIvaReceptorId,
        DocTipo: docTipo,
        DocNro: docNro,
        Concepto: datos.concepto,
        Observaciones: null,
      },
    }

    // Guardar para que consultarComprobante pueda recuperarlo
    emitidosMock.set(
      keyEmitido(datos.puntoVenta, datos.tipoFactura, numero),
      exito,
    )

    return exito
  },

  async consultarUltimoComprobante(
    puntoVenta: number,
    tipoFactura: TipoFacturaAfip,
  ): Promise<ResultadoConsultaUltimo> {
    const numero = contadoresMock.get(keyContador(puntoVenta, tipoFactura)) ?? 0
    return { ok: true, numero }
  },

  async consultarComprobante(
    puntoVenta: number,
    tipoFactura: TipoFacturaAfip,
    numero: number,
  ): Promise<ResultadoConsulta> {
    const emitido = emitidosMock.get(keyEmitido(puntoVenta, tipoFactura, numero))
    if (!emitido) {
      return { ok: false, error: 'Comprobante no encontrado' }
    }
    // El mock no almacena fechaEmision ni montoTotal en el éxito original,
    // los reconstruimos de manera coherente: fecha = hoy (mock no la guarda),
    // monto = lo que figura en el rawResponse o 0 si no estuviera disponible.
    const raw = emitido.rawResponse
    const baseImpTotal = Array.isArray(raw.Iva)
      ? (raw.Iva as Array<{ BaseImp: number; Importe: number }>).reduce(
          (acc, i) => acc + (i.BaseImp ?? 0) + (i.Importe ?? 0),
          0,
        )
      : 0
    return {
      ok: true,
      cae: emitido.cae,
      caeVencimiento: emitido.caeVencimiento,
      numeroComprobante: emitido.numeroComprobante,
      fechaEmision: new Date().toISOString().split('T')[0],
      montoTotal: baseImpTotal,
      rawResponse: emitido.rawResponse,
    }
  },

  async healthcheck(): Promise<ResultadoHealthcheck> {
    return { ok: true, mensaje: 'mock activo' }
  },
}
