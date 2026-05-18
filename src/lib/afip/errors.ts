/**
 * Diccionario de códigos de error de AFIP traducidos a mensajes legibles.
 *
 * Fuente: Manual del Desarrollador ARCA v4.1 + experiencia comunidad.
 *
 * Si AFIP devuelve un código que NO está acá, traducirErrorAfip() devuelve
 * el mensaje crudo de AFIP en lugar de "error desconocido", para no perder
 * información útil para el debug.
 */

export type GrupoErrorAfip =
  | 'wsaa-cert'        // Cert/key inválidos, vencidos, no asociados al WS
  | 'wsaa-token'       // TA expirado, mal firmado
  | 'validacion'       // Datos de la factura mal armados
  | 'cae'              // Problemas con CAE específico
  | 'caea'             // CAEA (no se usa hoy, dejado para futuro)
  | 'padron'           // CUIT no encontrado en padrón AFIP
  | 'pos'              // Punto de venta no autorizado
  | 'servidor'         // AFIP caído o lento
  | 'desconocido'      // Códigos sin mapear

export type SeveridadErrorAfip =
  | 'reintentable'      // Probablemente se resuelva reintentando (AFIP caído, timeout)
  | 'permanente'        // No se va a resolver con reintento (datos mal, cert vencido)
  | 'requiere_admin'    // Necesita acción del admin del sistema (config, cert)

export type CodigoErrorAfipInfo = {
  codigo: number
  mensaje: string
  remediacion?: string
  grupo: GrupoErrorAfip
  severidad: SeveridadErrorAfip
}

export const CODIGOS_ERROR_AFIP: Record<number, CodigoErrorAfipInfo> = {
  // ============ WSAA: certificado y token ============
  600: {
    codigo: 600,
    mensaje: 'CUIT no autorizado para emitir comprobantes electrónicos',
    remediacion: 'Verificar permisos del CUIT en Administrador de Relaciones de AFIP.',
    grupo: 'wsaa-cert',
    severidad: 'requiere_admin',
  },
  10013: {
    codigo: 10013,
    mensaje: 'Token de acceso vencido',
    remediacion: 'El sistema renovará automáticamente. Reintentá la operación.',
    grupo: 'wsaa-token',
    severidad: 'reintentable',
  },
  10015: {
    codigo: 10015,
    mensaje: 'Token de acceso inválido o mal firmado',
    remediacion: 'Verificar configuración del certificado AFIP en el sistema.',
    grupo: 'wsaa-token',
    severidad: 'requiere_admin',
  },
  10016: {
    codigo: 10016,
    mensaje: 'Fecha del comprobante fuera del rango permitido (±10 días para productos, ±5 para servicios)',
    remediacion: 'Verificar la fecha del comprobante.',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10017: {
    codigo: 10017,
    mensaje: 'Certificado AFIP vencido',
    remediacion: 'Renovar el certificado en AFIP y actualizar en el sistema.',
    grupo: 'wsaa-cert',
    severidad: 'requiere_admin',
  },
  10018: {
    codigo: 10018,
    mensaje: 'CUIT no autorizado para emitir este tipo de comprobante',
    remediacion: 'Verificar permisos en AFIP (Administrador de Relaciones).',
    grupo: 'wsaa-cert',
    severidad: 'requiere_admin',
  },

  // ============ Validación de datos ============
  1000: {
    codigo: 1000,
    mensaje: 'Error de validación genérico de AFIP',
    remediacion: 'Revisar los datos del comprobante (montos, fechas, receptor).',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10000: {
    codigo: 10000,
    mensaje: 'Error genérico de validación',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10005: {
    codigo: 10005,
    mensaje: 'Tipo de comprobante inválido para el tipo de documento del receptor',
    remediacion: 'Verificar que el tipo de factura coincida con la condición IVA del cliente.',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10039: {
    codigo: 10039,
    mensaje: 'Importe total no coincide con la suma de los componentes',
    remediacion: 'Revisar cálculos de neto, IVA y total.',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10048: {
    codigo: 10048,
    mensaje: 'Datos de facturación incompletos o inconsistentes',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10079: {
    codigo: 10079,
    mensaje: 'Falta información obligatoria del receptor',
    remediacion: 'Verificar CUIT, razón social y condición IVA del cliente.',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10153: {
    codigo: 10153,
    mensaje: 'CondicionIVAReceptorId no concuerda con el tipo de comprobante',
    remediacion: 'Por ejemplo, Factura A solo a RI o Monotributo.',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10192: {
    codigo: 10192,
    mensaje: 'Importe neto gravado debe ser cero para Factura C',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10198: {
    codigo: 10198,
    mensaje: 'Datos del comprobante asociado (NC/ND) inválidos',
    remediacion: 'Verificar que la factura asociada exista y esté aprobada.',
    grupo: 'validacion',
    severidad: 'permanente',
  },
  10245: {
    codigo: 10245,
    mensaje: 'La condición de IVA del receptor no es válida para el tipo de comprobante',
    remediacion: 'Verificá la condición frente al IVA del cliente. Factura A solo va a RI o Monotributo. Si es CF/EX usar Factura B. RG 5616 obligatoria desde 1-jul-2025.',
    grupo: 'validacion',
    severidad: 'permanente',
  },

  // ============ Padrón ============
  10019: {
    codigo: 10019,
    mensaje: 'CUIT del receptor no encontrado en el padrón de AFIP',
    remediacion: 'Verificar que el CUIT esté correctamente cargado.',
    grupo: 'padron',
    severidad: 'permanente',
  },
  10020: {
    codigo: 10020,
    mensaje: 'CUIT del receptor inactivo en AFIP',
    remediacion: 'Contactar al cliente para verificar su situación fiscal.',
    grupo: 'padron',
    severidad: 'permanente',
  },

  // ============ Punto de venta ============
  10164: {
    codigo: 10164,
    mensaje: 'Punto de venta no autorizado para emitir comprobantes electrónicos',
    remediacion: 'Verificar habilitación del punto de venta en AFIP.',
    grupo: 'pos',
    severidad: 'requiere_admin',
  },
  10166: {
    codigo: 10166,
    mensaje: 'Punto de venta no asociado al sistema RECE',
    remediacion: 'Habilitar el punto de venta para web services en AFIP.',
    grupo: 'pos',
    severidad: 'requiere_admin',
  },

  // ============ CAE ============
  15000: {
    codigo: 15000,
    mensaje: 'No se puede emitir CAE para este comprobante',
    grupo: 'cae',
    severidad: 'permanente',
  },
  15004: {
    codigo: 15004,
    mensaje: 'Comprobante ya tiene CAE asignado',
    remediacion: 'Buscar el CAE existente, no reintentar emisión.',
    grupo: 'cae',
    severidad: 'permanente',
  },
  15008: {
    codigo: 15008,
    mensaje: 'Número de comprobante fuera de secuencia',
    remediacion: 'Reintentar — el sistema consultará el último número correcto.',
    grupo: 'cae',
    severidad: 'reintentable',
  },

  // ============ Servidor AFIP ============
  500: {
    codigo: 500,
    mensaje: 'Error interno del servidor de AFIP',
    remediacion: 'Reintentar en unos minutos.',
    grupo: 'servidor',
    severidad: 'reintentable',
  },
  501: {
    codigo: 501,
    mensaje: 'AFIP no implementa esta operación',
    grupo: 'servidor',
    severidad: 'permanente',
  },
  502: {
    codigo: 502,
    mensaje: 'AFIP devolvió bad gateway',
    remediacion: 'Reintentar en unos minutos.',
    grupo: 'servidor',
    severidad: 'reintentable',
  },
  503: {
    codigo: 503,
    mensaje: 'Servicio AFIP no disponible',
    remediacion: 'Reintentar en unos minutos.',
    grupo: 'servidor',
    severidad: 'reintentable',
  },
  10049: {
    codigo: 10049,
    mensaje: 'Servicio AFIP no disponible o caído',
    remediacion: 'Reintentar en unos minutos.',
    grupo: 'servidor',
    severidad: 'reintentable',
  },
}

export type ErrorAfipTraducido = {
  codigo: number
  mensaje: string
  remediacion?: string
  grupo: GrupoErrorAfip
  severidad: SeveridadErrorAfip
  esConocido: boolean
}

/**
 * Traduce un código AFIP + mensaje crudo a info legible.
 * Si el código no está en el diccionario, devuelve el mensaje crudo de AFIP
 * con grupo='desconocido' y severidad='permanente' (mejor ser conservador
 * y no auto-reintentar errores no mapeados).
 */
export function traducirErrorAfip(
  codigo: number,
  mensajeCrudo: string,
): ErrorAfipTraducido {
  const info = CODIGOS_ERROR_AFIP[codigo]
  if (info) {
    return {
      codigo: info.codigo,
      mensaje: info.mensaje,
      remediacion: info.remediacion,
      grupo: info.grupo,
      severidad: info.severidad,
      esConocido: true,
    }
  }
  return {
    codigo,
    mensaje: mensajeCrudo || `Error AFIP ${codigo} (sin mapear)`,
    grupo: 'desconocido',
    severidad: 'permanente',
    esConocido: false,
  }
}
