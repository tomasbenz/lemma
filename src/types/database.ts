export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      afip_request_log: {
        Row: {
          codigos_error: number[] | null
          contexto: Json | null
          created_at: string
          duracion_ms: number
          empresa_id: string
          endpoint: string | null
          error_clase: string | null
          error_mensaje: string | null
          http_status: number | null
          id: number
          intento: number
          metodo: string
          modo: string
          request_xml: string | null
          response_xml: string | null
          resultado: Database["public"]["Enums"]["afip_resultado"]
          servicio: string
          severidad_max: Database["public"]["Enums"]["afip_severidad"] | null
        }
        Insert: {
          codigos_error?: number[] | null
          contexto?: Json | null
          created_at?: string
          duracion_ms?: number
          empresa_id: string
          endpoint?: string | null
          error_clase?: string | null
          error_mensaje?: string | null
          http_status?: number | null
          id?: number
          intento?: number
          metodo: string
          modo: string
          request_xml?: string | null
          response_xml?: string | null
          resultado: Database["public"]["Enums"]["afip_resultado"]
          servicio: string
          severidad_max?: Database["public"]["Enums"]["afip_severidad"] | null
        }
        Update: {
          codigos_error?: number[] | null
          contexto?: Json | null
          created_at?: string
          duracion_ms?: number
          empresa_id?: string
          endpoint?: string | null
          error_clase?: string | null
          error_mensaje?: string | null
          http_status?: number | null
          id?: number
          intento?: number
          metodo?: string
          modo?: string
          request_xml?: string | null
          response_xml?: string | null
          resultado?: Database["public"]["Enums"]["afip_resultado"]
          servicio?: string
          severidad_max?: Database["public"]["Enums"]["afip_severidad"] | null
        }
        Relationships: [
          {
            foreignKeyName: "afip_request_log_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      afip_ta_cache: {
        Row: {
          created_at: string
          cuit: string
          empresa_id: string
          expires_at: string
          modo: string
          service: string
          sign: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cuit: string
          empresa_id: string
          expires_at: string
          modo: string
          service: string
          sign: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cuit?: string
          empresa_id?: string
          expires_at?: string
          modo?: string
          service?: string
          sign?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "afip_ta_cache_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          accion: string
          created_at: string
          detalle: Json
          empresa_id: string | null
          entidad: string
          entidad_id: string | null
          es_accion_superadmin: boolean
          id: number
          ip: unknown
          motivo_superadmin: string | null
          user_agent: string | null
          usuario_email_snapshot: string | null
          usuario_id: string | null
        }
        Insert: {
          accion: string
          created_at?: string
          detalle?: Json
          empresa_id?: string | null
          entidad: string
          entidad_id?: string | null
          es_accion_superadmin?: boolean
          id?: number
          ip?: unknown
          motivo_superadmin?: string | null
          user_agent?: string | null
          usuario_email_snapshot?: string | null
          usuario_id?: string | null
        }
        Update: {
          accion?: string
          created_at?: string
          detalle?: Json
          empresa_id?: string | null
          entidad?: string
          entidad_id?: string | null
          es_accion_superadmin?: boolean
          id?: number
          ip?: unknown
          motivo_superadmin?: string | null
          user_agent?: string | null
          usuario_email_snapshot?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "v_usuario_empresa_id"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      cajas: {
        Row: {
          activa: boolean
          created_at: string
          eliminada_at: string | null
          id: string
          nombre: string
          sucursal_id: string
          updated_at: string
        }
        Insert: {
          activa?: boolean
          created_at?: string
          eliminada_at?: string | null
          id?: string
          nombre: string
          sucursal_id: string
          updated_at?: string
        }
        Update: {
          activa?: boolean
          created_at?: string
          eliminada_at?: string | null
          id?: string
          nombre?: string
          sucursal_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "cajas_sucursal_id_fkey"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
        ]
      }
      catalogo_categorias: {
        Row: {
          activo: boolean
          created_at: string
          empresa_id: string
          id: string
          nombre: string
          nombre_normalizado: string
          orden: number
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          empresa_id: string
          id?: string
          nombre: string
          nombre_normalizado: string
          orden?: number
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          empresa_id?: string
          id?: string
          nombre?: string
          nombre_normalizado?: string
          orden?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalogo_categorias_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      categoria_atributos: {
        Row: {
          activo: boolean
          categoria_id: string
          created_at: string
          empresa_id: string
          id: string
          nombre: string
          obligatorio: boolean
          opciones: Json | null
          orden: number
          tipo: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          categoria_id: string
          created_at?: string
          empresa_id: string
          id?: string
          nombre: string
          obligatorio?: boolean
          opciones?: Json | null
          orden?: number
          tipo?: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          categoria_id?: string
          created_at?: string
          empresa_id?: string
          id?: string
          nombre?: string
          obligatorio?: boolean
          opciones?: Json | null
          orden?: number
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categoria_atributos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "catalogo_categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categoria_atributos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          activo: boolean
          codigo_postal: string | null
          cond_iva: Database["public"]["Enums"]["cond_iva"]
          consentimiento_marketing: boolean
          created_at: string
          created_by: string | null
          cuit: string | null
          domicilio: string | null
          email: string | null
          email_verificado: boolean
          empresa_id: string
          id: string
          localidad: string | null
          notas: string | null
          password_hash: string | null
          provincia: string | null
          razon_social: string
          telefono: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          codigo_postal?: string | null
          cond_iva?: Database["public"]["Enums"]["cond_iva"]
          consentimiento_marketing?: boolean
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          domicilio?: string | null
          email?: string | null
          email_verificado?: boolean
          empresa_id: string
          id?: string
          localidad?: string | null
          notas?: string | null
          password_hash?: string | null
          provincia?: string | null
          razon_social: string
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          codigo_postal?: string | null
          cond_iva?: Database["public"]["Enums"]["cond_iva"]
          consentimiento_marketing?: boolean
          created_at?: string
          created_by?: string | null
          cuit?: string | null
          domicilio?: string | null
          email?: string | null
          email_verificado?: boolean
          empresa_id?: string
          id?: string
          localidad?: string | null
          notas?: string | null
          password_hash?: string | null
          provincia?: string | null
          razon_social?: string
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clientes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "clientes_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_usuario_empresa_id"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "clientes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracion: {
        Row: {
          codigo_postal: string | null
          condicion_iva: string
          cuit: string
          domicilio: string | null
          email: string | null
          empresa_id: string
          id: number
          ingresos_brutos: string | null
          inicio_actividades: string | null
          localidad: string | null
          nombre_fantasia: string | null
          provincia: string | null
          punto_venta_default: number
          puntos_venta: number[]
          razon_social: string
          telefono: string | null
          umbral_stock_bajo: number
          updated_at: string
          updated_by: string | null
          web: string | null
        }
        Insert: {
          codigo_postal?: string | null
          condicion_iva?: string
          cuit?: string
          domicilio?: string | null
          email?: string | null
          empresa_id: string
          id?: number
          ingresos_brutos?: string | null
          inicio_actividades?: string | null
          localidad?: string | null
          nombre_fantasia?: string | null
          provincia?: string | null
          punto_venta_default?: number
          puntos_venta?: number[]
          razon_social?: string
          telefono?: string | null
          umbral_stock_bajo?: number
          updated_at?: string
          updated_by?: string | null
          web?: string | null
        }
        Update: {
          codigo_postal?: string | null
          condicion_iva?: string
          cuit?: string
          domicilio?: string | null
          email?: string | null
          empresa_id?: string
          id?: number
          ingresos_brutos?: string | null
          inicio_actividades?: string | null
          localidad?: string | null
          nombre_fantasia?: string | null
          provincia?: string | null
          punto_venta_default?: number
          puntos_venta?: number[]
          razon_social?: string
          telefono?: string | null
          umbral_stock_bajo?: number
          updated_at?: string
          updated_by?: string | null
          web?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "configuracion_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "configuracion_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "configuracion_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "v_usuario_empresa_id"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
      empresas: {
        Row: {
          activo: boolean
          created_at: string
          eliminada_at: string | null
          features: Json
          id: string
          multi_caja: boolean
          multi_sucursal: boolean
          nombre: string
          rubro: string
          slug: string
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          eliminada_at?: string | null
          features?: Json
          id?: string
          multi_caja?: boolean
          multi_sucursal?: boolean
          nombre: string
          rubro?: string
          slug: string
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          eliminada_at?: string | null
          features?: Json
          id?: string
          multi_caja?: boolean
          multi_sucursal?: boolean
          nombre?: string
          rubro?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      facturas: {
        Row: {
          cae: string
          cae_vto: string
          cliente_cond_iva: Database["public"]["Enums"]["cond_iva"]
          cliente_cuit: string | null
          cliente_razon_social: string
          created_at: string
          created_by: string | null
          empresa_id: string
          id: string
          monto_iva: number
          monto_neto: number
          monto_total: number
          numero: number
          pdf_path: string | null
          porcentaje_facturado: number
          punto_venta: number
          tipo: Database["public"]["Enums"]["factura_tipo"]
          venta_id: string
          xml_request: string | null
          xml_response: string | null
        }
        Insert: {
          cae: string
          cae_vto: string
          cliente_cond_iva: Database["public"]["Enums"]["cond_iva"]
          cliente_cuit?: string | null
          cliente_razon_social: string
          created_at?: string
          created_by?: string | null
          empresa_id: string
          id?: string
          monto_iva: number
          monto_neto: number
          monto_total: number
          numero: number
          pdf_path?: string | null
          porcentaje_facturado?: number
          punto_venta: number
          tipo: Database["public"]["Enums"]["factura_tipo"]
          venta_id: string
          xml_request?: string | null
          xml_response?: string | null
        }
        Update: {
          cae?: string
          cae_vto?: string
          cliente_cond_iva?: Database["public"]["Enums"]["cond_iva"]
          cliente_cuit?: string | null
          cliente_razon_social?: string
          created_at?: string
          created_by?: string | null
          empresa_id?: string
          id?: string
          monto_iva?: number
          monto_neto?: number
          monto_total?: number
          numero?: number
          pdf_path?: string | null
          porcentaje_facturado?: number
          punto_venta?: number
          tipo?: Database["public"]["Enums"]["factura_tipo"]
          venta_id?: string
          xml_request?: string | null
          xml_response?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "facturas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "v_usuario_empresa_id"
            referencedColumns: ["usuario_id"]
          },
          {
            foreignKeyName: "facturas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: true
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      facturas_afip: {
        Row: {
          cae: string | null
          cae_vencimiento: string | null
          created_at: string
          empresa_id: string
          error_mensaje: string | null
          estado: string
          factura_asociada_id: string | null
          id: string
          intentos: number
          numero_comprobante: number | null
          punto_venta: number
          raw_response: Json | null
          tipo_factura: Database["public"]["Enums"]["tipo_factura"]
          updated_at: string
          venta_id: string
        }
        Insert: {
          cae?: string | null
          cae_vencimiento?: string | null
          created_at?: string
          empresa_id: string
          error_mensaje?: string | null
          estado?: string
          factura_asociada_id?: string | null
          id?: string
          intentos?: number
          numero_comprobante?: number | null
          punto_venta: number
          raw_response?: Json | null
          tipo_factura: Database["public"]["Enums"]["tipo_factura"]
          updated_at?: string
          venta_id: string
        }
        Update: {
          cae?: string | null
          cae_vencimiento?: string | null
          created_at?: string
          empresa_id?: string
          error_mensaje?: string | null
          estado?: string
          factura_asociada_id?: string | null
          id?: string
          intentos?: number
          numero_comprobante?: number | null
          punto_venta?: number
          raw_response?: Json | null
          tipo_factura?: Database["public"]["Enums"]["tipo_factura"]
          updated_at?: string
          venta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "facturas_afip_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_afip_factura_asociada_id_fkey"
            columns: ["factura_asociada_id"]
            isOneToOne: false
            referencedRelation: "facturas_afip"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "facturas_afip_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      items_venta: {
        Row: {
          cantidad: number
          created_at: string
          empresa_id: string
          id: string
          precio_unitario_neto: number
          producto_nombre: string
          producto_sku: string
          subtotal_neto: number
          variante_atributos: Json
          variante_id: string
          variante_sku: string
          venta_id: string
        }
        Insert: {
          cantidad: number
          created_at?: string
          empresa_id: string
          id?: string
          precio_unitario_neto: number
          producto_nombre: string
          producto_sku: string
          subtotal_neto: number
          variante_atributos?: Json
          variante_id: string
          variante_sku: string
          venta_id: string
        }
        Update: {
          cantidad?: number
          created_at?: string
          empresa_id?: string
          id?: string
          precio_unitario_neto?: number
          producto_nombre?: string
          producto_sku?: string
          subtotal_neto?: number
          variante_atributos?: Json
          variante_id?: string
          variante_sku?: string
          venta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "items_venta_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_venta_variante_id_fkey"
            columns: ["variante_id"]
            isOneToOne: false
            referencedRelation: "variantes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "items_venta_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      medios_pago_venta: {
        Row: {
          created_at: string
          empresa_id: string
          id: string
          medio: Database["public"]["Enums"]["medio_pago"]
          monto: number
          referencia: string | null
          venta_id: string
        }
        Insert: {
          created_at?: string
          empresa_id: string
          id?: string
          medio: Database["public"]["Enums"]["medio_pago"]
          monto: number
          referencia?: string | null
          venta_id: string
        }
        Update: {
          created_at?: string
          empresa_id?: string
          id?: string
          medio?: Database["public"]["Enums"]["medio_pago"]
          monto?: number
          referencia?: string | null
          venta_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "medios_pago_venta_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "medios_pago_venta_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      mp_webhook_events: {
        Row: {
          empresa_id: string | null
          error: string | null
          event_id: string
          id: number
          payload: Json | null
          procesado: boolean
          procesado_at: string | null
          received_at: string
          resource_id: string | null
          retry_count: number
          topic: string | null
        }
        Insert: {
          empresa_id?: string | null
          error?: string | null
          event_id: string
          id?: number
          payload?: Json | null
          procesado?: boolean
          procesado_at?: string | null
          received_at?: string
          resource_id?: string | null
          retry_count?: number
          topic?: string | null
        }
        Update: {
          empresa_id?: string | null
          error?: string | null
          event_id?: string
          id?: number
          payload?: Json | null
          procesado?: boolean
          procesado_at?: string | null
          received_at?: string
          resource_id?: string | null
          retry_count?: number
          topic?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mp_webhook_events_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      pagos: {
        Row: {
          confirmed_at: string | null
          created_at: string
          empresa_id: string
          estado: Database["public"]["Enums"]["pago_estado"]
          id: string
          metadata: Json
          metodo: Database["public"]["Enums"]["metodo_pago"]
          monto: number
          mp_expires_at: string | null
          mp_order_id: string | null
          mp_payment_id: string | null
          mp_qr_data: string | null
          mp_status_detail: string | null
          venta_id: string | null
        }
        Insert: {
          confirmed_at?: string | null
          created_at?: string
          empresa_id: string
          estado?: Database["public"]["Enums"]["pago_estado"]
          id?: string
          metadata?: Json
          metodo: Database["public"]["Enums"]["metodo_pago"]
          monto: number
          mp_expires_at?: string | null
          mp_order_id?: string | null
          mp_payment_id?: string | null
          mp_qr_data?: string | null
          mp_status_detail?: string | null
          venta_id?: string | null
        }
        Update: {
          confirmed_at?: string | null
          created_at?: string
          empresa_id?: string
          estado?: Database["public"]["Enums"]["pago_estado"]
          id?: string
          metadata?: Json
          metodo?: Database["public"]["Enums"]["metodo_pago"]
          monto?: number
          mp_expires_at?: string | null
          mp_order_id?: string | null
          mp_payment_id?: string | null
          mp_qr_data?: string | null
          mp_status_detail?: string | null
          venta_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pagos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagos_venta_id_fkey"
            columns: ["venta_id"]
            isOneToOne: false
            referencedRelation: "ventas"
            referencedColumns: ["id"]
          },
        ]
      }
      productos: {
        Row: {
          activo: boolean
          alicuota_iva: number
          categoria: string | null
          created_at: string
          descripcion_corta: string | null
          descripcion_larga: string | null
          destacado: boolean
          empresa_id: string
          id: string
          imagen_url: string | null
          imagenes: string[]
          meta_descripcion: string | null
          meta_titulo: string | null
          nombre: string
          peso_gramos: number | null
          precio_neto: number
          sku_base: string
          slug: string | null
          track_stock: boolean
          updated_at: string
          visible_online: boolean
        }
        Insert: {
          activo?: boolean
          alicuota_iva?: number
          categoria?: string | null
          created_at?: string
          descripcion_corta?: string | null
          descripcion_larga?: string | null
          destacado?: boolean
          empresa_id: string
          id?: string
          imagen_url?: string | null
          imagenes?: string[]
          meta_descripcion?: string | null
          meta_titulo?: string | null
          nombre: string
          peso_gramos?: number | null
          precio_neto?: number
          sku_base: string
          slug?: string | null
          track_stock?: boolean
          updated_at?: string
          visible_online?: boolean
        }
        Update: {
          activo?: boolean
          alicuota_iva?: number
          categoria?: string | null
          created_at?: string
          descripcion_corta?: string | null
          descripcion_larga?: string | null
          destacado?: boolean
          empresa_id?: string
          id?: string
          imagen_url?: string | null
          imagenes?: string[]
          meta_descripcion?: string | null
          meta_titulo?: string | null
          nombre?: string
          peso_gramos?: number | null
          precio_neto?: number
          sku_base?: string
          slug?: string | null
          track_stock?: boolean
          updated_at?: string
          visible_online?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      sucursales: {
        Row: {
          activa: boolean
          created_at: string
          direccion: string | null
          eliminada_at: string | null
          empresa_id: string
          id: string
          localidad: string | null
          nombre: string
          provincia: string | null
          telefono: string | null
          updated_at: string
        }
        Insert: {
          activa?: boolean
          created_at?: string
          direccion?: string | null
          eliminada_at?: string | null
          empresa_id: string
          id?: string
          localidad?: string | null
          nombre: string
          provincia?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Update: {
          activa?: boolean
          created_at?: string
          direccion?: string | null
          eliminada_at?: string | null
          empresa_id?: string
          id?: string
          localidad?: string | null
          nombre?: string
          provincia?: string | null
          telefono?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sucursales_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      turnos_caja: {
        Row: {
          abierto_at: string
          base_inicial: number
          caja_id: string
          cerrado_at: string | null
          created_at: string
          diferencia: number | null
          empresa_id: string
          forzado_por_admin: boolean
          id: string
          motivo_forzado: string | null
          nota_apertura: string | null
          nota_cierre: string | null
          total_declarado: number | null
          updated_at: string
          usuario_apertura_id: string
          usuario_cierre_id: string | null
        }
        Insert: {
          abierto_at?: string
          base_inicial: number
          caja_id: string
          cerrado_at?: string | null
          created_at?: string
          diferencia?: number | null
          empresa_id: string
          forzado_por_admin?: boolean
          id?: string
          motivo_forzado?: string | null
          nota_apertura?: string | null
          nota_cierre?: string | null
          total_declarado?: number | null
          updated_at?: string
          usuario_apertura_id: string
          usuario_cierre_id?: string | null
        }
        Update: {
          abierto_at?: string
          base_inicial?: number
          caja_id?: string
          cerrado_at?: string | null
          created_at?: string
          diferencia?: number | null
          empresa_id?: string
          forzado_por_admin?: boolean
          id?: string
          motivo_forzado?: string | null
          nota_apertura?: string | null
          nota_cierre?: string | null
          total_declarado?: number | null
          updated_at?: string
          usuario_apertura_id?: string
          usuario_cierre_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "turnos_caja_caja_id_fkey"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnos_caja_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnos_caja_usuario_apertura_id_fkey"
            columns: ["usuario_apertura_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "turnos_caja_usuario_cierre_id_fkey"
            columns: ["usuario_cierre_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios: {
        Row: {
          activo: boolean
          created_at: string
          email: string
          empresa_id: string | null
          id: string
          nombre_completo: string
          rol: Database["public"]["Enums"]["user_role"]
          ultimo_login_at: string | null
          ultimo_login_ip: unknown
          ultimo_login_user_agent: string | null
          updated_at: string
        }
        Insert: {
          activo?: boolean
          created_at?: string
          email: string
          empresa_id?: string | null
          id: string
          nombre_completo?: string
          rol?: Database["public"]["Enums"]["user_role"]
          ultimo_login_at?: string | null
          ultimo_login_ip?: unknown
          ultimo_login_user_agent?: string | null
          updated_at?: string
        }
        Update: {
          activo?: boolean
          created_at?: string
          email?: string
          empresa_id?: string | null
          id?: string
          nombre_completo?: string
          rol?: Database["public"]["Enums"]["user_role"]
          ultimo_login_at?: string | null
          ultimo_login_ip?: unknown
          ultimo_login_user_agent?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usuarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      variantes: {
        Row: {
          activa: boolean
          atributos: Json
          created_at: string
          empresa_id: string
          id: string
          precio_neto_override: number | null
          producto_id: string
          sku_variante: string | null
          stock: number
          updated_at: string
        }
        Insert: {
          activa?: boolean
          atributos?: Json
          created_at?: string
          empresa_id: string
          id?: string
          precio_neto_override?: number | null
          producto_id: string
          sku_variante?: string | null
          stock?: number
          updated_at?: string
        }
        Update: {
          activa?: boolean
          atributos?: Json
          created_at?: string
          empresa_id?: string
          id?: string
          precio_neto_override?: number | null
          producto_id?: string
          sku_variante?: string | null
          stock?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "variantes_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variantes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variantes_producto_id_fkey"
            columns: ["producto_id"]
            isOneToOne: false
            referencedRelation: "productos_con_stock_total"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas: {
        Row: {
          caja_id: string | null
          canal: Database["public"]["Enums"]["canal_venta"]
          cliente_id: string | null
          closed_at: string | null
          creada_desde_ip: unknown
          created_at: string
          descuento_total: number
          empresa_id: string
          estado: Database["public"]["Enums"]["venta_estado"]
          estado_facturacion_afip: Database["public"]["Enums"]["estado_facturacion_afip"]
          id: string
          monto_facturado: number
          nombre_cliente_custom: string | null
          nota_interna: string | null
          numero: number
          recargo_factura_completa: boolean
          recargo_motivo: string | null
          recargo_porcentaje_manual: number | null
          subtotal_neto: number
          sucursal_id: string | null
          tipo_factura: Database["public"]["Enums"]["tipo_factura"]
          total: number
          turno_id: string | null
          ultimo_error_facturacion: string | null
          ultimo_intento_facturacion_at: string | null
          ultimo_request_log_id: number | null
          updated_at: string
          usuario_id: string
          vista_at: string | null
        }
        Insert: {
          caja_id?: string | null
          canal?: Database["public"]["Enums"]["canal_venta"]
          cliente_id?: string | null
          closed_at?: string | null
          creada_desde_ip?: unknown
          created_at?: string
          descuento_total?: number
          empresa_id: string
          estado?: Database["public"]["Enums"]["venta_estado"]
          estado_facturacion_afip?: Database["public"]["Enums"]["estado_facturacion_afip"]
          id?: string
          monto_facturado?: number
          nombre_cliente_custom?: string | null
          nota_interna?: string | null
          numero?: number
          recargo_factura_completa?: boolean
          recargo_motivo?: string | null
          recargo_porcentaje_manual?: number | null
          subtotal_neto?: number
          sucursal_id?: string | null
          tipo_factura?: Database["public"]["Enums"]["tipo_factura"]
          total?: number
          turno_id?: string | null
          ultimo_error_facturacion?: string | null
          ultimo_intento_facturacion_at?: string | null
          ultimo_request_log_id?: number | null
          updated_at?: string
          usuario_id: string
          vista_at?: string | null
        }
        Update: {
          caja_id?: string | null
          canal?: Database["public"]["Enums"]["canal_venta"]
          cliente_id?: string | null
          closed_at?: string | null
          creada_desde_ip?: unknown
          created_at?: string
          descuento_total?: number
          empresa_id?: string
          estado?: Database["public"]["Enums"]["venta_estado"]
          estado_facturacion_afip?: Database["public"]["Enums"]["estado_facturacion_afip"]
          id?: string
          monto_facturado?: number
          nombre_cliente_custom?: string | null
          nota_interna?: string | null
          numero?: number
          recargo_factura_completa?: boolean
          recargo_motivo?: string | null
          recargo_porcentaje_manual?: number | null
          subtotal_neto?: number
          sucursal_id?: string | null
          tipo_factura?: Database["public"]["Enums"]["tipo_factura"]
          total?: number
          turno_id?: string | null
          ultimo_error_facturacion?: string | null
          ultimo_intento_facturacion_at?: string | null
          ultimo_request_log_id?: number | null
          updated_at?: string
          usuario_id?: string
          vista_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_caja_id_fk"
            columns: ["caja_id"]
            isOneToOne: false
            referencedRelation: "cajas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_sucursal_id_fk"
            columns: ["sucursal_id"]
            isOneToOne: false
            referencedRelation: "sucursales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_turno_id_fkey"
            columns: ["turno_id"]
            isOneToOne: false
            referencedRelation: "turnos_caja"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_ultimo_request_log_fk"
            columns: ["ultimo_request_log_id"]
            isOneToOne: false
            referencedRelation: "afip_request_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "v_usuario_empresa_id"
            referencedColumns: ["usuario_id"]
          },
        ]
      }
    }
    Views: {
      productos_con_stock_total: {
        Row: {
          activo: boolean | null
          categoria: string | null
          created_at: string | null
          descripcion_corta: string | null
          empresa_id: string | null
          id: string | null
          imagen_url: string | null
          nombre: string | null
          precio_neto: number | null
          sku_base: string | null
          stock_total: number | null
          tiene_stock_bajo: boolean | null
          track_stock: boolean | null
        }
        Insert: {
          activo?: boolean | null
          categoria?: string | null
          created_at?: string | null
          descripcion_corta?: string | null
          empresa_id?: string | null
          id?: string | null
          imagen_url?: string | null
          nombre?: string | null
          precio_neto?: number | null
          sku_base?: string | null
          stock_total?: never
          tiene_stock_bajo?: never
          track_stock?: boolean | null
        }
        Update: {
          activo?: boolean | null
          categoria?: string | null
          created_at?: string | null
          descripcion_corta?: string | null
          empresa_id?: string | null
          id?: string | null
          imagen_url?: string | null
          nombre?: string | null
          precio_neto?: number | null
          sku_base?: string | null
          stock_total?: never
          tiene_stock_bajo?: never
          track_stock?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "productos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      v_acciones_superadmin: {
        Row: {
          accion: string | null
          created_at: string | null
          detalle: Json | null
          empresa_id: string | null
          entidad: string | null
          entidad_id: string | null
          id: number | null
          ip: unknown
          motivo_superadmin: string | null
          superadmin_email: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      v_usuario_empresa_id: {
        Row: {
          empresa_id: string | null
          usuario_id: string | null
        }
        Insert: {
          empresa_id?: string | null
          usuario_id?: string | null
        }
        Update: {
          empresa_id?: string | null
          usuario_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usuarios_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      ventas_con_resumen: {
        Row: {
          canal: Database["public"]["Enums"]["canal_venta"] | null
          cliente_id: string | null
          closed_at: string | null
          created_at: string | null
          descuento_total: number | null
          empresa_id: string | null
          estado: Database["public"]["Enums"]["venta_estado"] | null
          estado_facturacion_afip:
            | Database["public"]["Enums"]["estado_facturacion_afip"]
            | null
          id: string | null
          items_cantidad_total: number | null
          items_count: number | null
          monto_facturado: number | null
          nombre_cliente_custom: string | null
          nota_interna: string | null
          numero: number | null
          recargo_factura_completa: boolean | null
          recargo_motivo: string | null
          recargo_porcentaje_manual: number | null
          subtotal_neto: number | null
          tipo_factura: Database["public"]["Enums"]["tipo_factura"] | null
          total: number | null
          updated_at: string | null
          usuario_id: string | null
          vista_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ventas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ventas_usuario_id_fkey"
            columns: ["usuario_id"]
            isOneToOne: false
            referencedRelation: "usuarios"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      abrir_turno: {
        Args: {
          p_base_inicial: number
          p_caja_id: string
          p_nota_apertura?: string
        }
        Returns: {
          abierto_at: string
          base_inicial: number
          caja_id: string
          cerrado_at: string | null
          created_at: string
          diferencia: number | null
          empresa_id: string
          forzado_por_admin: boolean
          id: string
          motivo_forzado: string | null
          nota_apertura: string | null
          nota_cierre: string | null
          total_declarado: number | null
          updated_at: string
          usuario_apertura_id: string
          usuario_cierre_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "turnos_caja"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      ajustar_stock: {
        Args: {
          p_delta: number
          p_motivo: string
          p_permitir_negativo?: boolean
          p_usuario_id: string
          p_variante_id: string
        }
        Returns: Json
      }
      anular_pedido: {
        Args: {
          p_ip?: unknown
          p_motivo: string
          p_pedido_id: string
          p_user_agent?: string
        }
        Returns: Json
      }
      anular_venta: {
        Args: {
          p_ip?: unknown
          p_motivo: string
          p_user_agent?: string
          p_venta_id: string
        }
        Returns: {
          caja_id: string | null
          canal: Database["public"]["Enums"]["canal_venta"]
          cliente_id: string | null
          closed_at: string | null
          creada_desde_ip: unknown
          created_at: string
          descuento_total: number
          empresa_id: string
          estado: Database["public"]["Enums"]["venta_estado"]
          estado_facturacion_afip: Database["public"]["Enums"]["estado_facturacion_afip"]
          id: string
          monto_facturado: number
          nombre_cliente_custom: string | null
          nota_interna: string | null
          numero: number
          recargo_factura_completa: boolean
          recargo_motivo: string | null
          recargo_porcentaje_manual: number | null
          subtotal_neto: number
          sucursal_id: string | null
          tipo_factura: Database["public"]["Enums"]["tipo_factura"]
          total: number
          ultimo_error_facturacion: string | null
          ultimo_intento_facturacion_at: string | null
          ultimo_request_log_id: number | null
          updated_at: string
          usuario_id: string
          vista_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ventas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      cerrar_venta: {
        Args: {
          p_canal?: string
          p_cliente_id: string
          p_descuento_total?: number
          p_items?: Json
          p_medios_pago?: Json
          p_monto_facturado?: number
          p_nombre_cliente_custom?: string
          p_nota_interna?: string
          p_recargo_factura_completa?: boolean
          p_recargo_motivo?: string
          p_recargo_porcentaje_manual?: number
          p_tipo_factura?: Database["public"]["Enums"]["tipo_factura"]
          p_usuario_id: string
        }
        Returns: Json
      }
      cerrar_turno: {
        Args: {
          p_nota_cierre?: string
          p_total_declarado: number
          p_turno_id: string
        }
        Returns: Json
      }
      editar_pedido: {
        Args: {
          p_ip?: string
          p_items_nuevos: Json
          p_pedido_id: string
          p_user_agent?: string
          p_usuario_id: string
        }
        Returns: Json
      }
      editar_venta: {
        Args: {
          p_ip?: string
          p_items_nuevos: Json
          p_user_agent?: string
          p_usuario_id: string
          p_venta_id: string
        }
        Returns: Json
      }
      es_admin: { Args: never; Returns: boolean }
      es_admin_estricto: { Args: never; Returns: boolean }
      es_superadmin: { Args: never; Returns: boolean }
      finalizar_pedido: {
        Args: {
          p_descuento_total?: number
          p_medios_pago: Json
          p_monto_facturado?: number
          p_nota_interna?: string
          p_pedido_id: string
          p_recargo_factura_completa?: boolean
          p_recargo_motivo?: string
          p_recargo_porcentaje_manual?: number
          p_tipo_factura?: Database["public"]["Enums"]["tipo_factura"]
          p_usuario_id: string
        }
        Returns: Json
      }
      forzar_cierre_turno: {
        Args: { p_motivo: string; p_turno_id: string }
        Returns: {
          abierto_at: string
          base_inicial: number
          caja_id: string
          cerrado_at: string | null
          created_at: string
          diferencia: number | null
          empresa_id: string
          forzado_por_admin: boolean
          id: string
          motivo_forzado: string | null
          nota_apertura: string | null
          nota_cierre: string | null
          total_declarado: number | null
          updated_at: string
          usuario_apertura_id: string
          usuario_cierre_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "turnos_caja"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_default_caja_id: { Args: { p_empresa_id: string }; Returns: string }
      get_default_sucursal_id: {
        Args: { p_empresa_id: string }
        Returns: string
      }
      get_empresa_id: { Args: never; Returns: string }
      get_rol_usuario: { Args: never; Returns: string }
      guardar_pedido: {
        Args: {
          p_canal?: string
          p_cliente_id?: string
          p_items?: Json
          p_nombre_cliente_custom?: string
          p_nota_interna?: string
          p_usuario_id: string
        }
        Returns: Json
      }
      importar_productos_bulk: {
        Args: { p_productos: Json; p_usuario_id: string }
        Returns: Json
      }
      normalizar_nombre: { Args: { texto: string }; Returns: string }
      obtener_turno_activo: {
        Args: { p_caja_id: string }
        Returns: {
          abierto_at: string
          base_inicial: number
          caja_id: string
          cerrado_at: string | null
          created_at: string
          diferencia: number | null
          empresa_id: string
          forzado_por_admin: boolean
          id: string
          motivo_forzado: string | null
          nota_apertura: string | null
          nota_cierre: string | null
          total_declarado: number | null
          updated_at: string
          usuario_apertura_id: string
          usuario_cierre_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "turnos_caja"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      persistir_cae_y_marcar_emitida: {
        Args: {
          p_cae: string
          p_cae_vencimiento: string
          p_empresa_id: string
          p_factura_id: string
          p_numero_comprobante: number
          p_raw_response: Json
          p_request_log_id: number
          p_venta_id: string
        }
        Returns: undefined
      }
      registrar_login: {
        Args: { p_ip?: unknown; p_user_agent?: string }
        Returns: undefined
      }
      reporte_ventas_agregado: {
        Args: { p_desde: string; p_hasta: string }
        Returns: Json
      }
      resumen_turno: {
        Args: { p_turno_id: string }
        Returns: Json
      }
      rol_actual: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      sa_exportar_datos: {
        Args: { p_empresa_id?: string; p_motivo: string; p_tabla?: string }
        Returns: Json
      }
      sa_forzar_estado_venta: {
        Args: {
          p_motivo: string
          p_nuevo_estado: Database["public"]["Enums"]["venta_estado"]
          p_venta_id: string
        }
        Returns: {
          caja_id: string | null
          canal: Database["public"]["Enums"]["canal_venta"]
          cliente_id: string | null
          closed_at: string | null
          creada_desde_ip: unknown
          created_at: string
          descuento_total: number
          empresa_id: string
          estado: Database["public"]["Enums"]["venta_estado"]
          estado_facturacion_afip: Database["public"]["Enums"]["estado_facturacion_afip"]
          id: string
          monto_facturado: number
          nombre_cliente_custom: string | null
          nota_interna: string | null
          numero: number
          recargo_factura_completa: boolean
          recargo_motivo: string | null
          recargo_porcentaje_manual: number | null
          subtotal_neto: number
          sucursal_id: string | null
          tipo_factura: Database["public"]["Enums"]["tipo_factura"]
          total: number
          ultimo_error_facturacion: string | null
          ultimo_intento_facturacion_at: string | null
          ultimo_request_log_id: number | null
          updated_at: string
          usuario_id: string
          vista_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "ventas"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sa_health_check: { Args: never; Returns: Json }
      sa_reparar_stock: {
        Args: { p_motivo: string; p_nuevo_stock: number; p_variante_id: string }
        Returns: {
          activa: boolean
          atributos: Json
          created_at: string
          empresa_id: string
          id: string
          precio_neto_override: number | null
          producto_id: string
          sku_variante: string | null
          stock: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "variantes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      sa_simular_vista_usuario: {
        Args: { p_motivo: string; p_usuario_id: string }
        Returns: Json
      }
      ventas_totales_filtrados: {
        Args: {
          p_busqueda_texto?: string
          p_cliente_id?: string
          p_desde?: string
          p_estado?: string
          p_hasta?: string
          p_numero?: number
          p_tipo_factura?: string
          p_usuario_id?: string
        }
        Returns: Json
      }
    }
    Enums: {
      afip_resultado: "exito" | "error_negocio" | "error_red" | "error_config"
      afip_severidad: "reintentable" | "permanente" | "requiere_admin"
      canal_venta: "mostrador" | "pedido" | "online"
      cond_iva: "RI" | "MONO" | "CF" | "EX"
      estado_facturacion_afip:
        | "no_aplica"
        | "pendiente_emision"
        | "emitida"
        | "pendiente_facturacion"
        | "error_permanente"
      factura_tipo: "A" | "B" | "C"
      medio_pago:
        | "efectivo"
        | "transferencia"
        | "deposito"
        | "tarjeta_credito"
        | "tarjeta_debito"
        | "cheque"
        | "mercadopago"
        | "mercadopago_qr"
        | "otro"
      metodo_pago: "efectivo" | "transferencia" | "tarjeta" | "mercadopago"
      pago_estado: "pendiente" | "confirmado" | "rechazado"
      tipo_factura:
        | "sin_factura"
        | "factura_a"
        | "factura_b"
        | "factura_c"
        | "nota_credito_a"
        | "nota_credito_b"
        | "nota_debito_a"
        | "nota_debito_b"
      user_role: "superadmin" | "admin" | "vendedor"
      venta_estado: "abierta" | "guardada" | "cerrada" | "anulada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      afip_resultado: ["exito", "error_negocio", "error_red", "error_config"],
      afip_severidad: ["reintentable", "permanente", "requiere_admin"],
      canal_venta: ["mostrador", "pedido", "online"],
      cond_iva: ["RI", "MONO", "CF", "EX"],
      estado_facturacion_afip: [
        "no_aplica",
        "pendiente_emision",
        "emitida",
        "pendiente_facturacion",
        "error_permanente",
      ],
      factura_tipo: ["A", "B", "C"],
      medio_pago: [
        "efectivo",
        "transferencia",
        "deposito",
        "tarjeta_credito",
        "tarjeta_debito",
        "cheque",
        "mercadopago",
        "mercadopago_qr",
        "otro",
      ],
      metodo_pago: ["efectivo", "transferencia", "tarjeta", "mercadopago"],
      pago_estado: ["pendiente", "confirmado", "rechazado"],
      tipo_factura: [
        "sin_factura",
        "factura_a",
        "factura_b",
        "factura_c",
        "nota_credito_a",
        "nota_credito_b",
        "nota_debito_a",
        "nota_debito_b",
      ],
      user_role: ["superadmin", "admin", "vendedor"],
      venta_estado: ["abierta", "guardada", "cerrada", "anulada"],
    },
  },
} as const
