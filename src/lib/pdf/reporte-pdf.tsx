import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'

export type ReportePdfData = {
  empresa: {
    razon_social: string
    cuit: string
  }
  periodoLabel: string
  fechaGeneracion: string
  kpis: {
    ventas_total: number
    ventas_total_cobrado: number
    unidades: number
    ticket_promedio: number
    clientes_unicos: number
  }
  ventasPorDia: Array<{
    fecha: string
    monto: number
    cantidad: number
  }>
  topProductos: Array<{
    producto_nombre: string
    producto_sku: string
    unidades: number
    monto: number
  }>
  mediosPago: Array<{
    medio: string
    monto: number
    cantidad_transacciones: number
  }>
}

export type ModoPdf = 'dark' | 'light'

// ============ Paletas ============
const PALETAS = {
  dark: {
    fondo: '#1A1A1A',
    fondoTarjeta: '#2A2A2A',
    fondoDestacado: '#FFFFFF',
    textoPrincipal: '#FFFFFF',
    textoSecundario: '#B8B8B8',
    textoTerciario: '#7A7A7A',
    textoInvertido: '#1A1A1A',
    bordeFuerte: '#FFFFFF',
    bordeFino: '#3A3A3A',
  },
  light: {
    fondo: '#FFFFFF',
    fondoTarjeta: '#F0F0F0',
    fondoDestacado: '#000000',
    textoPrincipal: '#1A1A1A',
    textoSecundario: '#666666',
    textoTerciario: '#999999',
    textoInvertido: '#FFFFFF',
    bordeFuerte: '#000000',
    bordeFino: '#E5E5E5',
  },
}

function crearEstilos(modo: ModoPdf) {
  const c = PALETAS[modo]

  return StyleSheet.create({
    page: {
      padding: 40,
      paddingBottom: 50,
      fontSize: 9,
      fontFamily: 'Helvetica',
      color: c.textoPrincipal,
      backgroundColor: c.fondo,
    },
    // ============ Header ============
    header: {
      marginBottom: 28,
    },
    empresa: {
      fontSize: 20,
      fontFamily: 'Helvetica-Bold',
      letterSpacing: 2,
      color: c.textoPrincipal,
      textTransform: 'uppercase',
    },
    cuitRow: {
      flexDirection: 'row',
      marginTop: 2,
      gap: 12,
    },
    cuit: {
      fontSize: 8,
      color: c.textoSecundario,
      letterSpacing: 0.5,
    },
    lineaDivisoria: {
      borderBottom: `1pt solid ${c.bordeFuerte}`,
      marginTop: 14,
      marginBottom: 14,
    },
    titulo: {
      fontSize: 24,
      fontFamily: 'Helvetica-Bold',
      color: c.textoPrincipal,
      letterSpacing: -0.5,
    },
    subtitulo: {
      fontSize: 10,
      color: c.textoSecundario,
      marginTop: 4,
      letterSpacing: 0.3,
    },
    fechaGen: {
      fontSize: 7.5,
      color: c.textoTerciario,
      marginTop: 6,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    // ============ Secciones ============
    seccion: {
      marginBottom: 24,
    },
    seccionTitulo: {
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: c.textoPrincipal,
      textTransform: 'uppercase',
      letterSpacing: 1.5,
      marginBottom: 10,
    },
    // ============ KPIs ============
    kpisGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      marginLeft: -6,
      marginRight: -6,
    },
    kpi: {
      width: '33.33%',
      paddingHorizontal: 6,
      paddingVertical: 6,
    },
    kpiInner: {
      padding: 12,
      backgroundColor: c.fondoTarjeta,
      borderRadius: 2,
    },
    kpiDestacado: {
      backgroundColor: c.fondoDestacado,
    },
    kpiLabel: {
      fontSize: 7,
      color: c.textoSecundario,
      textTransform: 'uppercase',
      letterSpacing: 1,
    },
    kpiLabelInvertido: {
      color: c.textoTerciario,
    },
    kpiValor: {
      fontSize: 16,
      fontFamily: 'Helvetica-Bold',
      color: c.textoPrincipal,
      marginTop: 6,
      letterSpacing: -0.3,
    },
    kpiValorInvertido: {
      color: c.textoInvertido,
    },
    // ============ Tablas ============
    tabla: {
      borderTop: `1pt solid ${c.bordeFuerte}`,
    },
    tablaHeader: {
      flexDirection: 'row',
      borderBottom: `1pt solid ${c.bordeFuerte}`,
      paddingVertical: 7,
      fontSize: 7,
      fontFamily: 'Helvetica-Bold',
      color: c.textoPrincipal,
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      backgroundColor: c.fondo, // para que se vea bien cuando se repite en otras páginas
    },
    tablaRow: {
      flexDirection: 'row',
      paddingVertical: 7,
      borderBottom: `0.5pt solid ${c.bordeFino}`,
      fontSize: 9,
      color: c.textoPrincipal,
    },
    tablaRowTotal: {
      flexDirection: 'row',
      paddingVertical: 8,
      borderTop: `1pt solid ${c.bordeFuerte}`,
      borderBottom: `0.5pt solid ${c.bordeFino}`,
      fontSize: 9,
      fontFamily: 'Helvetica-Bold',
      color: c.textoPrincipal,
      backgroundColor: c.fondoTarjeta,
    },
    sinDatos: {
      fontSize: 8.5,
      color: c.textoTerciario,
      paddingVertical: 20,
      textAlign: 'center',
      fontStyle: 'italic',
    },
    // Columnas: Top productos
    colRank: {
      width: '7%',
      paddingHorizontal: 6,
      fontFamily: 'Helvetica-Bold',
      color: c.textoTerciario,
    },
    colProducto: { width: '38%', paddingHorizontal: 6 },
    colSku: {
      width: '22%',
      paddingHorizontal: 6,
      color: c.textoSecundario,
      fontSize: 8,
    },
    colUnidades: {
      width: '13%',
      paddingHorizontal: 6,
      textAlign: 'right',
      fontFamily: 'Helvetica-Bold',
    },
    colMontoProd: {
      width: '20%',
      paddingHorizontal: 6,
      textAlign: 'right',
      fontFamily: 'Helvetica-Bold',
    },
    // Columnas: Medios de pago
    colMedio: {
      width: '32%',
      paddingHorizontal: 6,
      fontFamily: 'Helvetica-Bold',
    },
    colMonto: {
      width: '25%',
      paddingHorizontal: 6,
      textAlign: 'right',
      fontFamily: 'Helvetica-Bold',
    },
    colPct: { width: '15%', paddingHorizontal: 6, textAlign: 'right' },
    colTx: {
      width: '28%',
      paddingHorizontal: 6,
      textAlign: 'right',
      color: c.textoSecundario,
    },
    // Columnas: Ventas diarias
    colFecha: { width: '50%', paddingHorizontal: 6 },
    colVentas: {
      width: '20%',
      paddingHorizontal: 6,
      textAlign: 'right',
      fontFamily: 'Helvetica-Bold',
    },
    colMontoDia: {
      width: '30%',
      paddingHorizontal: 6,
      textAlign: 'right',
      fontFamily: 'Helvetica-Bold',
    },
    // ============ Footer ============
    footer: {
      position: 'absolute',
      bottom: 20,
      left: 40,
      right: 40,
      flexDirection: 'row',
      justifyContent: 'space-between',
      borderTop: `0.5pt solid ${c.bordeFino}`,
      paddingTop: 8,
      fontSize: 7,
      color: c.textoTerciario,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
  })
}

function formatARS(n: number): string {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
  }).format(n)
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('es-AR').format(n)
}

const LABELS_MEDIO: Record<string, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  deposito: 'Depósito',
  mercadopago_qr: 'Mercado Pago QR',
  otro: 'Otro',
}

type Props = {
  data: ReportePdfData
  modo?: ModoPdf
}

export function ReportePdf({ data, modo = 'dark' }: Props) {
  const styles = crearEstilos(modo)

  const totalMediosPago = data.mediosPago.reduce((acc, m) => acc + m.monto, 0)
  const diasConVentas = data.ventasPorDia.filter((d) => d.cantidad > 0)
  const totalUnidadesTop = data.topProductos.reduce(
    (a, p) => a + p.unidades,
    0
  )
  const totalMontoTop = data.topProductos.reduce((a, p) => a + p.monto, 0)
  const totalTxMedios = data.mediosPago.reduce(
    (a, m) => a + m.cantidad_transacciones,
    0
  )
  const totalVentasDias = diasConVentas.reduce((a, d) => a + d.cantidad, 0)
  const totalMontoDias = diasConVentas.reduce((a, d) => a + d.monto, 0)

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* HEADER */}
        <View style={styles.header}>
          <Text style={styles.empresa}>{data.empresa.razon_social}</Text>
          <View style={styles.cuitRow}>
            <Text style={styles.cuit}>CUIT {data.empresa.cuit}</Text>
          </View>
          <View style={styles.lineaDivisoria} />
          <Text style={styles.titulo}>Reporte de ventas</Text>
          <Text style={styles.subtitulo}>{data.periodoLabel}</Text>
          <Text style={styles.fechaGen}>
            Generado el {data.fechaGeneracion}
          </Text>
        </View>

        {/* KPIs */}
        <View style={styles.seccion} wrap={false}>
          <Text style={styles.seccionTitulo}>Resumen</Text>
          <View style={styles.kpisGrid}>
            <View style={styles.kpi}>
              <View style={styles.kpiInner}>
                <Text style={styles.kpiLabel}>Ventas</Text>
                <Text style={styles.kpiValor}>
                  {formatNumber(data.kpis.ventas_total)}
                </Text>
              </View>
            </View>
            <View style={styles.kpi}>
              <View style={[styles.kpiInner, styles.kpiDestacado]}>
                <Text style={[styles.kpiLabel, styles.kpiLabelInvertido]}>
                  Facturación total
                </Text>
                <Text style={[styles.kpiValor, styles.kpiValorInvertido]}>
                  {formatARS(data.kpis.ventas_total_cobrado)}
                </Text>
              </View>
            </View>
            <View style={styles.kpi}>
              <View style={styles.kpiInner}>
                <Text style={styles.kpiLabel}>Unidades</Text>
                <Text style={styles.kpiValor}>
                  {formatNumber(data.kpis.unidades)}
                </Text>
              </View>
            </View>
            <View style={styles.kpi}>
              <View style={styles.kpiInner}>
                <Text style={styles.kpiLabel}>Ticket promedio</Text>
                <Text style={styles.kpiValor}>
                  {formatARS(data.kpis.ticket_promedio)}
                </Text>
              </View>
            </View>
            <View style={styles.kpi}>
              <View style={styles.kpiInner}>
                <Text style={styles.kpiLabel}>Clientes únicos</Text>
                <Text style={styles.kpiValor}>
                  {formatNumber(data.kpis.clientes_unicos)}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* TOP PRODUCTOS */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>Productos más vendidos</Text>
          {data.topProductos.length === 0 ? (
            <Text style={styles.sinDatos}>Sin datos en este período.</Text>
          ) : (
            <View style={styles.tabla}>
              <View style={styles.tablaHeader} fixed>
                <Text style={styles.colRank}>#</Text>
                <Text style={styles.colProducto}>Producto</Text>
                <Text style={styles.colSku}>SKU</Text>
                <Text style={styles.colUnidades}>Unidades</Text>
                <Text style={styles.colMontoProd}>Monto</Text>
              </View>
              {data.topProductos.slice(0, 10).map((p, i) => (
                <View key={p.producto_sku} style={styles.tablaRow} wrap={false}>
                  <Text style={styles.colRank}>
                    {String(i + 1).padStart(2, '0')}
                  </Text>
                  <Text style={styles.colProducto}>{p.producto_nombre}</Text>
                  <Text style={styles.colSku}>{p.producto_sku}</Text>
                  <Text style={styles.colUnidades}>
                    {formatNumber(p.unidades)}
                  </Text>
                  <Text style={styles.colMontoProd}>{formatARS(p.monto)}</Text>
                </View>
              ))}
              <View style={styles.tablaRowTotal} wrap={false}>
                <Text style={styles.colRank}></Text>
                <Text style={styles.colProducto}>TOTAL</Text>
                <Text style={styles.colSku}></Text>
                <Text style={styles.colUnidades}>
                  {formatNumber(totalUnidadesTop)}
                </Text>
                <Text style={styles.colMontoProd}>
                  {formatARS(totalMontoTop)}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* MEDIOS DE PAGO */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>
            Distribución por medio de pago
          </Text>
          {data.mediosPago.length === 0 ? (
            <Text style={styles.sinDatos}>Sin datos en este período.</Text>
          ) : (
            <View style={styles.tabla}>
              <View style={styles.tablaHeader} fixed>
                <Text style={styles.colMedio}>Medio</Text>
                <Text style={styles.colMonto}>Monto</Text>
                <Text style={styles.colPct}>%</Text>
                <Text style={styles.colTx}>Transacciones</Text>
              </View>
              {data.mediosPago.map((m) => {
                const pct =
                  totalMediosPago > 0 ? (m.monto / totalMediosPago) * 100 : 0
                return (
                  <View key={m.medio} style={styles.tablaRow} wrap={false}>
                    <Text style={styles.colMedio}>
                      {LABELS_MEDIO[m.medio] ?? m.medio}
                    </Text>
                    <Text style={styles.colMonto}>{formatARS(m.monto)}</Text>
                    <Text style={styles.colPct}>{pct.toFixed(1)}%</Text>
                    <Text style={styles.colTx}>
                      {formatNumber(m.cantidad_transacciones)}
                    </Text>
                  </View>
                )
              })}
              <View style={styles.tablaRowTotal} wrap={false}>
                <Text style={styles.colMedio}>TOTAL</Text>
                <Text style={styles.colMonto}>
                  {formatARS(totalMediosPago)}
                </Text>
                <Text style={styles.colPct}>100%</Text>
                <Text style={styles.colTx}>{formatNumber(totalTxMedios)}</Text>
              </View>
            </View>
          )}
        </View>

        {/* VENTAS POR DÍA */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>Ventas diarias</Text>
          {diasConVentas.length === 0 ? (
            <Text style={styles.sinDatos}>Sin ventas en este período.</Text>
          ) : (
            <View style={styles.tabla}>
              <View style={styles.tablaHeader} fixed>
                <Text style={styles.colFecha}>Fecha</Text>
                <Text style={styles.colVentas}>Ventas</Text>
                <Text style={styles.colMontoDia}>Monto facturado</Text>
              </View>
              {diasConVentas.map((d) => {
                const fecha = new Date(d.fecha + 'T12:00:00')
                return (
                  <View key={d.fecha} style={styles.tablaRow} wrap={false}>
                    <Text style={styles.colFecha}>
                      {fecha.toLocaleDateString('es-AR', {
                        weekday: 'long',
                        day: '2-digit',
                        month: 'long',
                        year: 'numeric',
                      })}
                    </Text>
                    <Text style={styles.colVentas}>
                      {formatNumber(d.cantidad)}
                    </Text>
                    <Text style={styles.colMontoDia}>
                      {formatARS(d.monto)}
                    </Text>
                  </View>
                )
              })}
              <View style={styles.tablaRowTotal} wrap={false}>
                <Text style={styles.colFecha}>TOTAL</Text>
                <Text style={styles.colVentas}>
                  {formatNumber(totalVentasDias)}
                </Text>
                <Text style={styles.colMontoDia}>
                  {formatARS(totalMontoDias)}
                </Text>
              </View>
            </View>
          )}
        </View>

        {/* FOOTER */}
        <View style={styles.footer} fixed>
          <Text>{data.empresa.razon_social}</Text>
          <Text
            render={({ pageNumber, totalPages }) =>
              `Página ${pageNumber} de ${totalPages}`
            }
          />
          <Text>Lemma</Text>
        </View>
      </Page>
    </Document>
  )
}