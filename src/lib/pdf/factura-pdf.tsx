import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from '@react-pdf/renderer'

// ============ Tipos ============

export type FacturaPdfData = {
  // Empresa (vendedor)
  empresa: {
    razon_social: string
    /**
     * Nombre comercial / fantasy. Si está presente, se muestra grande arriba
     * y razon_social aparece como dato legal abajo (patrón sistema viejo
     * de Iconic). Si es null, solo se muestra razon_social arriba.
     */
    nombre_fantasia: string | null
    cuit: string
    domicilio: string
    /**
     * Localidad opcional (CABA, Buenos Aires, etc). Va en la línea
     * "Domicilio Comercial" del header.
     */
    localidad: string | null
    condicion_iva: string // "IVA Responsable Inscripto"
    ingresos_brutos: string
    inicio_actividades: string
  }
  // Datos del comprobante.
  // 'A' = Factura A (CbteTipo 1, código visible '01').
  // 'B' = Factura B (CbteTipo 6, código visible '06'). Iconic Fashion (RI)
  //       NUNCA emite Factura C, así que solo soportamos A o B.
  tipo: 'A' | 'B'
  puntoVenta: number
  numero: number
  fechaEmision: string // "24/04/2026"
  cae: string
  caeVencimiento: string // "03/05/2026"
  qrDataUrl: string // data:image/png;base64,...
  // Cliente
  cliente: {
    razon_social: string
    cuit: string
    cond_iva: string // "Consumidor Final", "Responsable Inscripto", etc
    domicilio: string | null
    /**
     * Referencia interna alternativa (alias / nombre custom / nro de pedido web).
     * NO va en los campos legales del receptor (esos son razon_social/cuit).
     * Va arriba del bloque cliente como nota interna.
     */
    nombre_custom?: string | null
  }
  // Items
  items: Array<{
    nombre: string
    sku: string
    cantidad: number
    precio_unitario: number // con IVA si es C, sin IVA si es A
    subtotal: number
  }>
  // Totales
  subtotalNeto: number
  iva: number
  total: number
}

// ============ Estilos ============

const styles = StyleSheet.create({
  page: {
    padding: 30,
    fontSize: 9,
    fontFamily: 'Helvetica',
    color: '#000',
  },
  // Header
  header: {
    flexDirection: 'row',
    borderBottom: '1pt solid #000',
    paddingBottom: 10,
    marginBottom: 10,
  },
  headerLeft: {
    flex: 1,
    paddingRight: 10,
  },
  headerRight: {
    flex: 1,
    paddingLeft: 10,
    borderLeft: '1pt solid #000',
    alignItems: 'center',
  },
  tipoLetra: {
    fontSize: 36,
    fontFamily: 'Helvetica-Bold',
    border: '1pt solid #000',
    width: 60,
    height: 60,
    textAlign: 'center',
    paddingTop: 8,
    marginBottom: 4,
  },
  tipoCodigo: {
    fontSize: 7,
  },
  titulo: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 4,
  },
  numeroFactura: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    marginBottom: 8,
  },
  fechaEmision: {
    marginBottom: 4,
  },
  row: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  label: {
    fontFamily: 'Helvetica-Bold',
    width: 100,
  },
  // Banner de referencia interna (cliente custom)
  bannerRef: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderLeft: '3pt solid #000',
    padding: 6,
    marginBottom: 6,
  },
  bannerRefLabel: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 8,
    marginRight: 6,
  },
  bannerRefValue: {
    fontSize: 9,
  },
  // Cliente
  seccionCliente: {
    border: '1pt solid #000',
    padding: 8,
    marginBottom: 10,
  },
  // Tabla items
  tabla: {
    marginBottom: 10,
  },
  tablaHeader: {
    flexDirection: 'row',
    borderTop: '1pt solid #000',
    borderBottom: '1pt solid #000',
    paddingVertical: 4,
    fontFamily: 'Helvetica-Bold',
    backgroundColor: '#f0f0f0',
  },
  tablaRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottom: '0.5pt solid #ccc',
  },
  colCodigo: { width: '15%', paddingHorizontal: 4 },
  colDesc: { width: '45%', paddingHorizontal: 4 },
  colCant: { width: '10%', paddingHorizontal: 4, textAlign: 'right' },
  colPrecio: { width: '15%', paddingHorizontal: 4, textAlign: 'right' },
  colSubtotal: { width: '15%', paddingHorizontal: 4, textAlign: 'right' },
  // Totales
  totales: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 10,
  },
  bloqueTotales: {
    width: '40%',
  },
  rowTotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  rowTotalFinal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderTop: '1pt solid #000',
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
  },
  // Footer CAE + QR
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 30,
    right: 30,
    flexDirection: 'row',
    borderTop: '1pt solid #000',
    paddingTop: 10,
  },
  footerLeft: {
    flex: 1,
  },
  footerRight: {
    width: 90,
    alignItems: 'flex-end',
  },
  qrImagen: {
    width: 80,
    height: 80,
  },
  caeValor: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 11,
    letterSpacing: 1,
  },
})

// ============ Helpers ============

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(n)
}

function formatNumero(pv: number, nro: number): string {
  return `${pv.toString().padStart(4, '0')}-${nro.toString().padStart(8, '0')}`
}

// ============ Componente ============

export function FacturaPdf({ data }: { data: FacturaPdfData }) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          {/* Izquierda: datos empresa */}
          <View style={styles.headerLeft}>
            {/* Título: nombre_fantasia si existe, sino razon_social */}
            <Text style={styles.titulo}>
              {data.empresa.nombre_fantasia ?? data.empresa.razon_social}
            </Text>

            {/* Si hay nombre_fantasia, razon_social va como dato legal abajo */}
            {data.empresa.nombre_fantasia && (
              <Text style={{ marginBottom: 2 }}>
                <Text style={{ fontFamily: 'Helvetica-Bold' }}>Razón Social: </Text>
                {data.empresa.razon_social}
              </Text>
            )}

            <Text style={{ marginBottom: 2 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>Domicilio Comercial: </Text>
              {data.empresa.domicilio}
              {data.empresa.localidad ? `, ${data.empresa.localidad}` : ''}
            </Text>

            <Text style={{ marginBottom: 2 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>Condición frente al IVA: </Text>
              {data.empresa.condicion_iva}
            </Text>

            <Text style={{ marginBottom: 2 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>CUIT: </Text>
              {data.empresa.cuit}
            </Text>

            <Text style={{ marginBottom: 2 }}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>Ingresos Brutos: </Text>
              {data.empresa.ingresos_brutos}
            </Text>

            <Text>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>Fecha de Inicio de Actividades: </Text>
              {data.empresa.inicio_actividades}
            </Text>
          </View>

          {/* Derecha: tipo de factura + número */}
          <View style={styles.headerRight}>
            <Text style={styles.tipoLetra}>{data.tipo}</Text>
            <Text style={styles.tipoCodigo}>
              COD. {data.tipo === 'A' ? '01' : '06'}
            </Text>

            <Text style={{ fontSize: 11, marginTop: 10, fontFamily: 'Helvetica-Bold' }}>
              FACTURA {data.tipo}
            </Text>
            <Text style={styles.numeroFactura}>
              Nº {formatNumero(data.puntoVenta, data.numero)}
            </Text>
            <Text style={styles.fechaEmision}>
              Fecha: {data.fechaEmision}
            </Text>
          </View>
        </View>

        {/* BANNER REFERENCIA INTERNA (solo si hay nombre custom) */}
        {data.cliente.nombre_custom && (
          <View style={styles.bannerRef}>
            <Text style={styles.bannerRefLabel}>Referencia:</Text>
            <Text style={styles.bannerRefValue}>
              {data.cliente.nombre_custom}
            </Text>
          </View>
        )}

        {/* CLIENTE */}
        <View style={styles.seccionCliente}>
          <View style={styles.row}>
            <Text style={styles.label}>Sr(es):</Text>
            <Text>{data.cliente.razon_social}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>CUIT:</Text>
            <Text>{data.cliente.cuit}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Cond. IVA:</Text>
            <Text>{data.cliente.cond_iva}</Text>
          </View>
          {data.cliente.domicilio && (
            <View style={styles.row}>
              <Text style={styles.label}>Domicilio:</Text>
              <Text>{data.cliente.domicilio}</Text>
            </View>
          )}
        </View>

        {/* TABLA ITEMS */}
        <View style={styles.tabla}>
          <View style={styles.tablaHeader}>
            <Text style={styles.colCodigo}>Código</Text>
            <Text style={styles.colDesc}>Descripción</Text>
            <Text style={styles.colCant}>Cant.</Text>
            <Text style={styles.colPrecio}>P. Unit.</Text>
            <Text style={styles.colSubtotal}>Subtotal</Text>
          </View>
          {data.items.map((item, i) => (
            <View key={i} style={styles.tablaRow}>
              <Text style={styles.colCodigo}>{item.sku}</Text>
              <Text style={styles.colDesc}>{item.nombre}</Text>
              <Text style={styles.colCant}>{item.cantidad}</Text>
              <Text style={styles.colPrecio}>
                {formatARS(item.precio_unitario)}
              </Text>
              <Text style={styles.colSubtotal}>{formatARS(item.subtotal)}</Text>
            </View>
          ))}
        </View>

        {/* TOTALES */}
        <View style={styles.totales}>
          <View style={styles.bloqueTotales}>
            {data.tipo === 'A' && (
              <>
                <View style={styles.rowTotal}>
                  <Text>Subtotal neto:</Text>
                  <Text>{formatARS(data.subtotalNeto)}</Text>
                </View>
                <View style={styles.rowTotal}>
                  <Text>IVA 21%:</Text>
                  <Text>{formatARS(data.iva)}</Text>
                </View>
              </>
            )}
            <View style={styles.rowTotalFinal}>
              <Text>TOTAL:</Text>
              <Text>{formatARS(data.total)}</Text>
            </View>
          </View>
        </View>

        {/* FOOTER CAE + QR */}
        <View style={styles.footer}>
          <View style={styles.footerLeft}>
            <Text style={{ fontSize: 8, marginBottom: 2 }}>
              Comprobante autorizado por AFIP
            </Text>
            <Text style={{ marginBottom: 4 }}>
              CAE Nº: <Text style={styles.caeValor}>{data.cae}</Text>
            </Text>
            <Text>Fecha vto. CAE: {data.caeVencimiento}</Text>
          </View>
          <View style={styles.footerRight}>
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            <Image src={data.qrDataUrl} style={styles.qrImagen} />
          </View>
        </View>
      </Page>
    </Document>
  )
}