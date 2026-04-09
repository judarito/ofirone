<template>
  <div>
    <v-card>
      <v-card-title class="d-flex align-center">
        <v-icon start color="deep-purple">mdi-cog</v-icon>
        Configuración de Empresa
      </v-card-title>

      <v-alert
        v-if="setupHintVisible"
        type="info"
        variant="tonal"
        class="mx-4 mt-4"
        icon="mdi-rocket-launch-outline"
      >
        <strong>Modo guiado:</strong> estás completando la configuración inicial.
        <div class="mt-2">
          {{ setupHintMessage }}
        </div>
      </v-alert>

      <v-alert
        v-if="billingSummary && billingBannerMessage"
        :type="billingAlertType"
        variant="tonal"
        class="mx-4 mt-4"
        icon="mdi-credit-card-alert-outline"
      >
        <strong>Estado comercial:</strong> {{ billingBannerMessage }}
        <div class="mt-2 text-body-2">
          Plan {{ billingSummary.plan_name || billingSummary.plan_code || 'sin nombre' }} ·
          Estado {{ billingStatusLabel }} ·
          {{ billingDaysHint }}
        </div>
      </v-alert>

      <v-alert
        v-if="billingSaveBlocked"
        type="warning"
        variant="tonal"
        class="mx-4 mt-4"
        icon="mdi-lock-outline"
      >
        La suscripción actual permite consulta del estado comercial, pero bloquea cambios administrativos en esta pantalla.
      </v-alert>

      <v-tabs v-model="tab" color="primary" class="px-4">
        <v-tab value="general">General</v-tab>
        <v-tab value="billing">Suscripción</v-tab>
        <v-tab value="ui">Interfaz</v-tab>
        <v-tab value="ai">Inteligencia IA</v-tab>
        <v-tab value="accounting">Contabilidad</v-tab>
        <v-tab value="inventory">Inventario</v-tab>
        <v-tab value="sales">Ventas</v-tab>
        <v-tab value="invoicing">Facturación</v-tab>
        <v-tab value="notifications">Notificaciones</v-tab>
      </v-tabs>

      <v-card-text>
        <v-form ref="configForm" @submit.prevent="saveAll">
          <v-window v-model="tab">
            <!-- GENERAL -->
            <v-window-item value="general">
              <div class="text-h6 mb-4">Información General</div>
              <v-row>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="tenant.name" label="Nombre de la Empresa *" variant="outlined" :rules="[rules.required]"></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="tenant.tax_id" label="NIT / Identificación fiscal" variant="outlined"></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select v-model="tenant.currency_code" :items="currencies" label="Moneda *" variant="outlined" :rules="[rules.required]"></v-select>
                </v-col>
              </v-row>

              <v-divider class="my-4"></v-divider>
              <div class="text-h6 mb-4">Datos del Negocio</div>
              <v-row>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="settings.business_name" label="Nombre comercial (recibos)" variant="outlined"></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="settings.business_phone" label="Teléfono de contacto" variant="outlined" prepend-inner-icon="mdi-phone"></v-text-field>
                </v-col>
                <v-col cols="12">
                  <v-text-field v-model="settings.business_address" :label="t('common.address')" variant="outlined" prepend-inner-icon="mdi-map-marker"></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field v-model="settings.logo_url" label="URL del Logo" variant="outlined" prepend-inner-icon="mdi-image"></v-text-field>
                </v-col>
                <v-col cols="12">
                  <v-textarea v-model="settings.receipt_footer" label="Pie de recibo/factura" variant="outlined" rows="3" hint="Texto que aparecerá al final del recibo"></v-textarea>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-switch v-model="settings.default_tax_included" label="Impuesto incluido en precio por defecto" color="primary"></v-switch>
                </v-col>
              </v-row>

              <!-- Vista previa logo -->
              <div v-if="settings.logo_url" class="mb-4">
                <div class="text-caption mb-1">Vista previa del logo:</div>
                <v-img :src="settings.logo_url" max-height="100" max-width="200" contain class="border rounded"></v-img>
              </div>
            </v-window-item>

            <!-- BILLING -->
            <v-window-item value="billing">
              <div class="text-h6 mb-4">Suscripción y monetización</div>

              <v-alert
                v-if="!billingSummary && !billingLoading"
                type="info"
                variant="tonal"
                class="mb-4"
              >
                No hay una suscripción comercial registrada para este tenant todavía.
              </v-alert>

              <v-skeleton-loader
                v-else-if="billingLoading"
                type="article, article"
              />

              <template v-else-if="billingSummary">
                <v-row>
                  <v-col cols="12" md="4">
                    <v-card variant="tonal" :color="billingStatusColor">
                      <v-card-text>
                        <div class="text-overline">Plan actual</div>
                        <div class="text-h5">{{ billingSummary.plan_name || billingSummary.plan_code || 'Sin nombre' }}</div>
                        <div class="text-body-2 mt-2">{{ billingStatusLabel }}</div>
                      </v-card-text>
                    </v-card>
                  </v-col>

                  <v-col cols="12" md="4">
                    <v-card variant="tonal" color="primary">
                      <v-card-text>
                        <div class="text-overline">{{ billingExpiryLabel }}</div>
                        <div class="text-h5">{{ billingExpiryDate }}</div>
                        <div class="text-body-2 mt-2">{{ billingDaysHint }}</div>
                      </v-card-text>
                    </v-card>
                  </v-col>

                  <v-col cols="12" md="4">
                    <v-card variant="tonal" :color="billingSummary.can_operate_sales ? 'success' : 'error'">
                      <v-card-text>
                        <div class="text-overline">Operación permitida</div>
                        <div class="text-body-1 mt-2">Ventas: {{ billingSummary.can_operate_sales ? 'Sí' : 'No' }}</div>
                        <div class="text-body-1">Administración: {{ billingSummary.can_operate_admin ? 'Sí' : 'No' }}</div>
                      </v-card-text>
                    </v-card>
                  </v-col>
                </v-row>

                <v-alert
                  v-if="billingSummary.banner_message"
                  type="info"
                  variant="tonal"
                  class="mt-4"
                >
                  {{ billingSummary.banner_message }}
                </v-alert>

                <v-row class="mt-2">
                  <v-col cols="12" md="6">
                    <v-card variant="outlined">
                      <v-card-title class="text-subtitle-1">Features activas</v-card-title>
                      <v-divider />
                      <v-card-text>
                        <div v-if="billingFeatures.length" class="d-flex flex-wrap ga-2">
                          <v-chip
                            v-for="feature in billingFeatures"
                            :key="feature.code"
                            :color="feature.enabled ? 'success' : 'grey'"
                            size="small"
                            variant="tonal"
                          >
                            {{ feature.code }}: {{ feature.enabled ? 'On' : 'Off' }}
                          </v-chip>
                        </div>
                        <div v-else class="text-body-2 text-medium-emphasis">
                          No hay feature flags configuradas.
                        </div>
                      </v-card-text>
                    </v-card>
                  </v-col>

                  <v-col cols="12" md="6">
                    <v-card variant="outlined">
                      <v-card-title class="text-subtitle-1">Límites del plan</v-card-title>
                      <v-divider />
                      <v-card-text>
                        <v-list density="compact" v-if="billingLimits.length">
                          <v-list-item v-for="limit in billingLimits" :key="limit.code">
                            <v-list-item-title>{{ limit.code }}</v-list-item-title>
                            <v-list-item-subtitle>{{ limit.value }} {{ limit.unit }}</v-list-item-subtitle>
                          </v-list-item>
                        </v-list>
                        <div v-else class="text-body-2 text-medium-emphasis">
                          No hay límites configurados.
                        </div>
                      </v-card-text>
                    </v-card>
                  </v-col>
                </v-row>
              </template>
            </v-window-item>

            <!-- INTERFAZ -->
            <v-window-item value="ui">
              <div class="text-h6 mb-4">Configuración de Interfaz</div>
              <v-row>
                <v-col cols="12" sm="6">
                  <v-select 
                    v-model="settings.default_page_size" 
                    :items="[10, 20, 50, 100]" 
                    label="Registros por página *" 
                    variant="outlined"
                    hint="Cantidad de registros a mostrar en listas"
                    persistent-hint
                  ></v-select>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select 
                    v-model="settings.theme" 
                    :items="themeOptions" 
                    label="Tema de la interfaz *" 
                    variant="outlined"
                    hint="Apariencia visual de la aplicación"
                    persistent-hint
                  ></v-select>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select 
                    v-model="settings.date_format" 
                    :items="dateFormatOptions" 
                    label="Formato de fecha *" 
                    variant="outlined"
                    hint="Formato para mostrar fechas"
                    persistent-hint
                  ></v-select>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select 
                    v-model="settings.locale" 
                    :items="localeOptions" 
                    label="Idioma/Región *" 
                    variant="outlined"
                    hint="Configuración regional del sistema"
                    persistent-hint
                  ></v-select>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field 
                    v-model.number="settings.session_timeout_minutes" 
                    type="number" 
                    label="Tiempo de sesión (minutos) *" 
                    variant="outlined"
                    min="5"
                    max="480"
                    hint="Minutos de inactividad antes de cerrar sesión"
                    persistent-hint
                  ></v-text-field>
                </v-col>
              </v-row>
            </v-window-item>

            <!-- IA -->
            <v-window-item value="ai">
              <div class="text-h6 mb-4">Configuración de Inteligencia Artificial</div>
              <v-alert type="info" variant="tonal" class="mb-4">
                <strong>IA Powered by DeepSeek</strong><br>
                Configura cómo la IA analiza tu negocio para generar insights y recomendaciones.
              </v-alert>
              <v-row>
                <v-col cols="12" sm="6">
                  <v-select 
                    v-model="settings.ai_forecast_days_back" 
                    :items="[30, 60, 90, 180]" 
                    label="Días de historial para pronóstico *" 
                    variant="outlined"
                    hint="Días hacia atrás para analizar tendencias"
                    persistent-hint
                  ></v-select>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select 
                    v-model="settings.ai_purchase_suggestion_days" 
                    :items="[7, 14, 30]" 
                    label="Días de proyección de compras *" 
                    variant="outlined"
                    hint="Días hacia adelante para sugerencias"
                    persistent-hint
                  ></v-select>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-switch 
                    v-model="settings.ai_purchase_advisor_enabled" 
                    label="Habilitar Asesor de Compras IA" 
                    color="purple"
                    hint="Sugerencias inteligentes de qué comprar"
                    persistent-hint
                  ></v-switch>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-switch 
                    v-model="settings.ai_sales_forecast_enabled" 
                    label="Habilitar Pronóstico de Ventas IA" 
                    color="purple"
                    hint="Predicción de ventas futuras"
                    persistent-hint
                  ></v-switch>
                </v-col>
              </v-row>

              <!-- Administración de Caché IA -->
              <v-divider class="my-6"></v-divider>
              <div class="text-h6 mb-4">Administración de Caché IA</div>
              <v-alert type="info" variant="tonal" class="mb-4">
                <v-icon start>mdi-cached</v-icon>
                El caché ahorra ~70% en costos de API al reutilizar análisis recientes.
                <br>
                <strong>Pronósticos:</strong> 24 horas | <strong>Compras:</strong> 12 horas
              </v-alert>

              <v-row v-if="cacheStats">
                <v-col cols="12" sm="3">
                  <v-card variant="tonal" color="blue">
                    <v-card-text>
                      <div class="text-overline">Total en Caché</div>
                      <div class="text-h4">{{ validCacheCount }}</div>
                      <div class="text-caption">entradas válidas</div>
                    </v-card-text>
                  </v-card>
                </v-col>
                <v-col cols="12" sm="3">
                  <v-card variant="tonal" color="orange">
                    <v-card-text>
                      <div class="text-overline">Expiradas</div>
                      <div class="text-h4">{{ expiredCacheCount }}</div>
                      <div class="text-caption">para limpieza</div>
                    </v-card-text>
                  </v-card>
                </v-col>
                <v-col cols="12" sm="3">
                  <v-card variant="tonal" color="green">
                    <v-card-text>
                      <div class="text-overline">Tamaño</div>
                      <div class="text-h4">{{ cacheSizeKB }}</div>
                      <div class="text-caption">KB almacenados</div>
                    </v-card-text>
                  </v-card>
                </v-col>
                <v-col cols="12" sm="3">
                  <v-card variant="tonal" color="purple">
                    <v-card-text>
                      <div class="text-overline">Ahorro Estimado</div>
                      <div class="text-h4">~70%</div>
                      <div class="text-caption">en costos API</div>
                    </v-card-text>
                  </v-card>
                </v-col>
              </v-row>

              <v-row class="mt-2">
                <v-col cols="12" sm="auto">
                  <v-btn 
                    color="primary" 
                    prepend-icon="mdi-refresh" 
                    variant="outlined"
                    @click="refreshCacheStats"
                  >
                    Actualizar Stats
                  </v-btn>
                </v-col>
                <v-col cols="12" sm="auto">
                  <v-btn 
                    color="warning" 
                    prepend-icon="mdi-broom" 
                    variant="outlined"
                    @click="clearExpiredCache"
                  >
                    Limpiar Expirados
                  </v-btn>
                </v-col>
                <v-col cols="12" sm="auto">
                  <v-btn 
                    color="error" 
                    prepend-icon="mdi-delete" 
                    variant="outlined"
                    @click="confirmClearAllCache"
                  >
                    Limpiar Todo
                  </v-btn>
                </v-col>
              </v-row>
            </v-window-item>

            <!-- CONTABILIDAD -->
            <v-window-item value="accounting">
              <div class="text-h6 mb-4">Configuración de Contabilidad</div>
              <v-alert type="info" variant="tonal" class="mb-4">
                Define cómo se conecta contabilidad con el POS sin bloquear ventas ni compras.
              </v-alert>

              <v-row>
                <v-col cols="12" sm="6">
                  <v-switch
                    v-model="settings.accounting_enabled"
                    label="Contabilidad habilitada"
                    color="success"
                    hint="Activa o desactiva el módulo contable. El POS sigue operando si está apagado."
                    persistent-hint
                  ></v-switch>
                </v-col>

                <v-col cols="12" sm="6">
                  <v-select
                    v-model="settings.accounting_mode"
                    :items="accountingModeOptions"
                    item-title="title"
                    item-value="value"
                    label="Modo de integración contable"
                    variant="outlined"
                    hint="Forma de operar la integración con el POS"
                    persistent-hint
                  ></v-select>
                  <div class="text-caption text-medium-emphasis mt-1">
                    {{ accountingModeDescription }}
                  </div>
                </v-col>

                <v-col cols="12" sm="4">
                  <v-switch
                    v-model="settings.accounting_auto_post_sales"
                    label="Auto contabilizar ventas"
                    color="primary"
                    hint="Envía automáticamente ventas a la cola contable"
                    persistent-hint
                  ></v-switch>
                </v-col>

                <v-col cols="12" sm="4">
                  <v-switch
                    v-model="settings.accounting_auto_post_purchases"
                    label="Auto contabilizar compras"
                    color="primary"
                    hint="Envía automáticamente compras a la cola contable"
                    persistent-hint
                  ></v-switch>
                </v-col>

                <v-col cols="12" sm="4">
                  <v-switch
                    v-model="settings.accounting_ai_enabled"
                    label="IA contable"
                    color="secondary"
                    hint="Habilita sugerencias IA para asientos y análisis"
                    persistent-hint
                  ></v-switch>
                </v-col>
              </v-row>

              <v-alert type="info" variant="tonal" class="mt-2" icon="mdi-lightbulb-on-outline">
                <strong>Recomendado para iniciar:</strong> Contabilidad habilitada + modo ASYNC +
                auto ventas activado. Activa auto compras cuando valides el flujo contable de compras.
              </v-alert>
            </v-window-item>

            <!-- INVENTARIO -->
            <v-window-item value="inventory">
              <div class="text-h6 mb-4">Configuración de Inventario</div>
              <v-alert type="info" variant="tonal" class="mb-4">
                <strong>Nota:</strong> Stock mínimo y sobreventa se configuran individualmente por producto.
              </v-alert>
              <v-row>
                <v-col cols="12" sm="6">
                  <v-text-field 
                    v-model.number="settings.expiry_alert_days" 
                    type="number" 
                    label="Días de alerta de vencimiento *" 
                    variant="outlined"
                    min="1"
                    max="365"
                    hint="Alertar productos próximos a vencer"
                    persistent-hint
                  ></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-switch 
                    v-model="settings.reserve_stock_on_layaway" 
                    label="Reservar stock en plan separé" 
                    color="primary"
                    hint="Apartar inventario al crear separé"
                    persistent-hint
                  ></v-switch>
                </v-col>
              </v-row>
            </v-window-item>

            <!-- VENTAS -->
            <v-window-item value="sales">
              <div class="text-h6 mb-4">Configuración de Ventas y Precios</div>
              <v-alert type="info" variant="tonal" class="mb-4">
                <strong>Nota:</strong> Descuentos y retrofecha de venta en POS deben restringirse a personal de confianza.
              </v-alert>
              <v-row>
                <v-col cols="12" sm="6">
                  <v-text-field 
                    v-model.number="settings.max_discount_without_auth" 
                    type="number" 
                    label="Descuento máximo cajeros (%)" 
                    variant="outlined"
                    min="0"
                    max="100"
                    step="0.01"
                    suffix="%"
                    hint="Descuento máximo que puede aplicar un cajero"
                    persistent-hint
                  ></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select 
                    v-model="settings.rounding_method" 
                    :items="roundingOptions" 
                    label="Método de redondeo *" 
                    variant="outlined"
                    hint="Cómo redondear totales de ventas"
                    persistent-hint
                  ></v-select>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-select 
                    v-model="settings.rounding_multiple" 
                    :items="[{label: 'Unidades (1)', value: 1}, {label: 'Decenas (10)', value: 10}, {label: 'Centenas (100)', value: 100}, {label: 'Miles (1000)', value: 1000}]"
                    item-title="label"
                    item-value="value" 
                    label="Múltiplo de redondeo *" 
                    variant="outlined"
                    hint="A qué múltiplo redondear"
                    persistent-hint
                  ></v-select>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field
                    v-model.number="settings.cash_session_max_hours"
                    type="number"
                    label="Máximo de horas de sesión de caja"
                    variant="outlined"
                    prepend-inner-icon="mdi-cash-clock"
                    min="1"
                    max="720"
                    hint="Sesiones de caja abiertas más de estas horas se marcan como vencidas (ej: 24)"
                    persistent-hint
                  ></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-switch
                    v-model="settings.pos_allow_manual_sale_datetime"
                    label="Permitir fecha manual en POS"
                    color="warning"
                    hint="Habilita selector de fecha/hora de venta para administradores y gerentes"
                    persistent-hint
                  ></v-switch>
                </v-col>
                <v-col cols="12" sm="6" v-if="settings.pos_allow_manual_sale_datetime">
                  <v-text-field
                    v-model.number="settings.pos_max_backdate_hours"
                    type="number"
                    label="Máximo de retrofecha POS (horas)"
                    variant="outlined"
                    prepend-inner-icon="mdi-calendar-clock"
                    min="1"
                    max="720"
                    hint="Límite para registrar ventas con fecha/hora anterior"
                    persistent-hint
                  ></v-text-field>
                </v-col>
              </v-row>
            </v-window-item>

            <!-- FACTURACIÓN -->
            <v-window-item value="invoicing">
              <div class="text-h6 mb-4">Configuración de Facturación</div>

              <!-- Siempre visible: impresión y consecutivo POS -->
              <v-row>
                <v-col cols="12" sm="4">
                  <v-text-field v-model="settings.invoice_prefix" label="Prefijo de factura *" variant="outlined"
                    hint="Ej: FAC, INV, FC" persistent-hint></v-text-field>
                </v-col>
                <v-col cols="12" sm="4">
                  <v-text-field v-model.number="settings.next_invoice_number" type="number" label="Siguiente # de factura *"
                    variant="outlined" min="1" hint="Consecutivo POS" persistent-hint></v-text-field>
                </v-col>
                <v-col cols="12" sm="4">
                  <v-select v-model="settings.print_format" :items="printFormatOptions" label="Formato de impresión *"
                    variant="outlined" hint="Tipo de impresora" persistent-hint></v-select>
                </v-col>
                <v-col cols="12" sm="4">
                  <v-select v-model="settings.thermal_paper_width"
                    :items="[{label:'58mm',value:58},{label:'80mm',value:80}]"
                    item-title="label" item-value="value" label="Ancho papel térmico"
                    variant="outlined" :disabled="settings.print_format !== 'thermal'"
                    hint="Ancho del rollo" persistent-hint></v-select>
                </v-col>
                <v-col cols="12" sm="8" class="d-flex align-center">
                  <v-switch v-model="settings.electronic_invoicing_enabled"
                    label="Activar Facturación Electrónica DIAN"
                    color="indigo" hint="Habilita el módulo FE completo con proveedor tecnológico"
                    persistent-hint></v-switch>
                </v-col>
              </v-row>

              <!-- ======= SECCIÓN FE (solo si está habilitada) ======= -->
              <template v-if="settings.electronic_invoicing_enabled">

                <!-- DATOS FISCALES DEL EMISOR -->
                <v-divider class="my-5"></v-divider>
                <div class="d-flex align-center mb-3">
                  <v-icon start color="blue">mdi-office-building-cog</v-icon>
                  <span class="text-subtitle-1 font-weight-bold">Datos Fiscales del Emisor (DIAN)</span>
                </div>
                <v-alert type="info" variant="tonal" density="compact" class="mb-4">
                  Estos datos se incluyen en el XML de cada factura electrónica emitida.
                </v-alert>
                <v-row>
                  <v-col cols="12" sm="3">
                    <v-text-field v-model="tenant.dv" label="DV (dígito verificación)" variant="outlined"
                      hint="Dígito de verificación del NIT" persistent-hint maxlength="1"></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="5">
                    <v-text-field v-model="tenant.trade_name" label="Nombre comercial" variant="outlined"
                      hint="Nombre comercial del emisor (puede diferir de la razón social)" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-select v-model="tenant.tax_regime" :items="taxRegimeOptions" item-title="title" item-value="value"
                      label="Régimen tributario" variant="outlined" hint="Régimen ante la DIAN" persistent-hint></v-select>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="tenant.ciiu_code" label="Código CIIU" variant="outlined"
                      hint="Actividad económica principal" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="tenant.fiscal_email" label="Email fiscal" variant="outlined" type="email"
                      prepend-inner-icon="mdi-email" hint="Email en encabezado del XML" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="tenant.fiscal_phone" label="Teléfono fiscal" variant="outlined"
                      prepend-inner-icon="mdi-phone" hint="Teléfono en encabezado del XML" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="6">
                    <v-switch v-model="tenant.is_responsible_for_iva" label="Responsable de IVA"
                      color="primary" hide-details inset></v-switch>
                  </v-col>
                  <v-col cols="12" sm="6">
                    <v-switch v-model="tenant.obligated_accounting" label="Obligado a llevar contabilidad"
                      color="primary" hide-details inset></v-switch>
                  </v-col>
                </v-row>

                <!-- DIRECCIÓN FISCAL DEL EMISOR -->
                <v-row class="mt-0">
                  <v-col cols="12">
                    <div class="text-caption text-medium-emphasis font-weight-bold mb-n1">
                      <v-icon size="small" color="orange">mdi-map-marker</v-icon>
                      Dirección Fiscal del Emisor (requerida en XML FE)
                    </div>
                  </v-col>
                  <v-col cols="12">
                    <v-text-field v-model="tenant.address" :label="t('common.address')" variant="outlined"
                      prepend-inner-icon="mdi-map-marker"
                      hint="Ej: Calle 68 # 95-30 Piso 2" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="tenant.city" label="Ciudad / Municipio" variant="outlined"
                      prepend-inner-icon="mdi-city" hint="Nombre del municipio" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="3">
                    <v-text-field v-model="tenant.city_code" label="Código DANE" variant="outlined"
                      prepend-inner-icon="mdi-numeric"
                      hint="5 dígitos (ej: 11001)" persistent-hint maxlength="5"></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="3">
                    <v-text-field v-model="tenant.department" label="Departamento" variant="outlined"
                      prepend-inner-icon="mdi-map" hint="Nombre del departamento" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="2">
                    <v-text-field v-model="tenant.postal_code" label="Cód. Postal" variant="outlined"
                      hint="Código postal" persistent-hint></v-text-field>
                  </v-col>
                </v-row>

                <!-- PROVEEDOR TECNOLÓGICO -->
                <v-divider class="my-5"></v-divider>
                <div class="d-flex align-center mb-3">
                  <v-icon start color="purple">mdi-cloud-sync</v-icon>
                  <span class="text-subtitle-1 font-weight-bold">Proveedor Tecnológico</span>
                </div>
                <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
                  Ingresa las credenciales del proveedor tecnológico habilitado por la DIAN.
                  El sistema enviará cada factura electrónica a esta URL.
                </v-alert>
                <v-row>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="feProvider.provider_name" label="Nombre del proveedor" variant="outlined"
                      hint="Ej: Gosocket, SIIGO, Bizlink, propio" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="8">
                    <v-text-field v-model="feProvider.base_url" label="URL base de la API *" variant="outlined"
                      prepend-inner-icon="mdi-web"
                      hint="Sin barra final, ej: https://api.proveedor.co/v1" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-select v-model="feProvider.auth_type"
                      :items="[{title:'API Key (header)',value:'apikey'},{title:'Bearer Token',value:'bearer'},{title:'Basic Auth',value:'basic'}]"
                      item-title="title" item-value="value"
                      label="Tipo de autenticación" variant="outlined"></v-select>
                  </v-col>
                  <v-col cols="12" sm="4" v-if="feProvider.auth_type === 'apikey'">
                    <v-text-field v-model="feProvider.auth_header" label="Nombre del header" variant="outlined"
                      hint="Ej: X-API-Key, x-auth-token" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="feProvider.api_key"
                      :label="feProvider.auth_type === 'basic' ? 'Usuario:Contraseña' : 'API Key / Token'"
                      variant="outlined" type="password"
                      prepend-inner-icon="mdi-key"
                      hint="Se almacena tal como se ingresa" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="feProvider.software_id" label="Software ID (DIAN)" variant="outlined"
                      hint="ID del software registrado ante DIAN" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="feProvider.software_pin" label="Software PIN (DIAN)" variant="outlined"
                      type="password" prepend-inner-icon="mdi-shield-key"
                      hint="PIN del software ante DIAN" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-select v-model="feProvider.environment" :items="feEnvironmentOptions"
                      item-title="title" item-value="value"
                      label="Ambiente" variant="outlined"
                      hint="Habilitación = pruebas ante DIAN" persistent-hint></v-select>
                  </v-col>
                  <v-col cols="12" sm="4" v-if="feProvider.environment === 'habilitacion'">
                    <v-text-field v-model="feProvider.test_set_id" label="Test Set ID" variant="outlined"
                      hint="ID del set de pruebas asignado por DIAN" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="2">
                    <v-text-field v-model.number="feProvider.timeout_seconds" type="number" label="Timeout (seg)"
                      variant="outlined" min="5" max="120" hint="Segundos máx por petición" persistent-hint></v-text-field>
                  </v-col>
                </v-row>

                <!-- RESOLUCIÓN DIAN -->
                <v-divider class="my-5"></v-divider>
                <div class="d-flex align-center mb-3">
                  <v-icon start color="green">mdi-file-document-check</v-icon>
                  <span class="text-subtitle-1 font-weight-bold">Resolución DIAN Activa</span>
                </div>
                <v-alert type="success" variant="tonal" density="compact" class="mb-4">
                  Ingresa los datos de la resolución de facturación electrónica autorizada por la DIAN.
                </v-alert>
                <v-row>
                  <v-col cols="12" sm="3">
                    <v-select v-model="activeResolution.document_type" :items="feDocTypeOptions"
                      item-title="title" item-value="value"
                      label="Tipo de documento" variant="outlined"></v-select>
                  </v-col>
                  <v-col cols="12" sm="3">
                    <v-text-field v-model="activeResolution.prefix" label="Prefijo autorizado" variant="outlined"
                      hint="Ej: SETP, FE, LETF (según resolución)" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="3">
                    <v-text-field v-model.number="activeResolution.from_number" type="number" label="Desde #"
                      variant="outlined" min="1"></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="3">
                    <v-text-field v-model.number="activeResolution.to_number" type="number" label="Hasta #"
                      variant="outlined" min="1"></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="activeResolution.resolution_number" label="Número de resolución DIAN"
                      variant="outlined" hint="Número oficial de la resolución" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model="activeResolution.resolution_date" type="date" label="Fecha de resolución"
                      variant="outlined"></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="4">
                    <v-text-field v-model.number="activeResolution.current_number" type="number"
                      label="Último consecutivo usado" variant="outlined" min="0"
                      hint="Se incrementa automáticamente al emitir" persistent-hint></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="6">
                    <v-text-field v-model="activeResolution.valid_from" type="date" label="Vigencia desde"
                      variant="outlined"></v-text-field>
                  </v-col>
                  <v-col cols="12" sm="6">
                    <v-text-field v-model="activeResolution.valid_to" type="date" label="Vigencia hasta"
                      variant="outlined"></v-text-field>
                  </v-col>
                  <v-col cols="12">
                    <v-textarea v-model="activeResolution.technical_key" label="Clave técnica (para cálculo del CUFE)"
                      variant="outlined" rows="2" auto-grow
                      hint="Clave técnica de 64 caracteres entregada por la DIAN" persistent-hint
                      :rules="[v => !v || v.length === 64 || 'La clave técnica debe tener exactamente 64 caracteres']"
                    ></v-textarea>
                  </v-col>
                </v-row>

              </template>
            </v-window-item>

            <!-- NOTIFICACIONES -->
            <v-window-item value="notifications">
              <div class="text-h6 mb-4">Configuración de Notificaciones</div>
              <v-row>
                <v-col cols="12" sm="6">
                  <v-switch 
                    v-model="settings.email_alerts_enabled" 
                    label="Habilitar alertas por email" 
                    color="blue"
                    hint="Enviar notificaciones al correo"
                    persistent-hint
                  ></v-switch>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-text-field 
                    v-model="settings.alert_email" 
                    label="Email para alertas" 
                    variant="outlined"
                    type="email"
                    prepend-inner-icon="mdi-email"
                    :disabled="!settings.email_alerts_enabled"
                    hint="Email que recibirá las notificaciones"
                    persistent-hint
                  ></v-text-field>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-switch 
                    v-model="settings.notify_low_stock" 
                    label="Notificar stock bajo" 
                    color="orange"
                    :disabled="!settings.email_alerts_enabled"
                    hint="Alertar cuando productos tengan poco stock"
                    persistent-hint
                  ></v-switch>
                </v-col>
                <v-col cols="12" sm="6">
                  <v-switch 
                    v-model="settings.notify_expiring_products" 
                    label="Notificar productos por vencer" 
                    color="red"
                    :disabled="!settings.email_alerts_enabled"
                    hint="Alertar productos próximos a vencerse"
                    persistent-hint
                  ></v-switch>
                </v-col>
              </v-row>
            </v-window-item>
          </v-window>

          <v-divider class="my-4"></v-divider>

          <v-btn
            type="submit"
            color="primary"
            block
            size="large"
            :loading="saving"
            :disabled="billingSaveBlocked"
            prepend-icon="mdi-content-save"
          >
            Guardar Configuración
          </v-btn>
        </v-form>
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="3000">{{ snackbarMessage }}</v-snackbar>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useTenant } from '@/composables/useTenant'
import { useTenantSettings } from '@/composables/useTenantSettings'
import { useAICache } from '@/composables/useAICache'
import { useTheme } from '@/composables/useTheme'
import { useSetupAssistant } from '@/composables/useSetupAssistant'
import { useTenantBilling } from '@/composables/useTenantBilling'
import tenantSettingsService from '@/services/tenantSettings.service'
import electronicInvoicingService from '@/services/electronicInvoicing.service'
import { useI18n } from '@/i18n'

const { t } = useI18n()
const route = useRoute()

const { tenantId } = useTenant()
const { loadSettings } = useTenantSettings()
const { syncThemeFromTenant } = useTheme()
const { processMap, loadSetupReadiness } = useSetupAssistant()
const {
  billingSummary,
  billingLoading,
  billingBannerMessage,
  billingStatusLabel,
  canOperateAdmin,
  loadBillingSummary,
} = useTenantBilling()
const { 
  cacheStats, 
  validCacheCount, 
  expiredCacheCount, 
  cacheSizeKB,
  refreshStats: refreshCacheStats,
  clearAll,
  clearExpired
} = useAICache()

const configForm = ref(null)
const tab = ref('general')
const saving = ref(false)
const snackbar = ref(false)
const snackbarMessage = ref('')
const snackbarColor = ref('success')
const rules = { required: v => !!v || 'Campo requerido' }

const currencies = ['COP', 'USD', 'EUR', 'MXN', 'PEN', 'ARS', 'CLP', 'BRL']

const themeOptions = [
  { title: 'Claro', value: 'light' },
  { title: 'Oscuro', value: 'dark' },
  { title: 'Automático', value: 'auto' }
]

const dateFormatOptions = [
  { title: 'DD/MM/YYYY', value: 'DD/MM/YYYY' },
  { title: 'MM/DD/YYYY', value: 'MM/DD/YYYY' },
  { title: 'YYYY-MM-DD', value: 'YYYY-MM-DD' }
]

const localeOptions = [
  { title: 'Español Colombia (es-CO)', value: 'es-CO' },
  { title: 'Español México (es-MX)', value: 'es-MX' },
  { title: 'Español España (es-ES)', value: 'es-ES' },
  { title: 'Inglés US (en-US)', value: 'en-US' }
]

const accountingModeOptions = [
  { title: 'OFF - Desactivado', value: 'OFF' },
  { title: 'ASYNC - Cola desacoplada', value: 'ASYNC' },
  { title: 'MANUAL - Registro manual', value: 'MANUAL' }
]

const roundingOptions = [
  { title: 'Normal (Matemático)', value: 'normal' },
  { title: 'Hacia arriba', value: 'up' },
  { title: 'Hacia abajo', value: 'down' },
  { title: 'Sin redondeo', value: 'none' }
]

const printFormatOptions = [
  { title: 'Impresora Térmica', value: 'thermal' },
  { title: 'Carta (A4)', value: 'letter' },
  { title: 'Ticket (Media Carta)', value: 'ticket' }
]

const tenant = ref({
  name: '', tax_id: '', currency_code: 'COP',
  // Datos fiscales emisor (Facturación Electrónica)
  dv: '', trade_name: '', tax_regime: '',
  is_responsible_for_iva: false, obligated_accounting: false,
  ciiu_code: '', fiscal_email: '', fiscal_phone: '',
  // Dirección fiscal del emisor (requerida en XML FE)
  address: '', city: '', department: '', country_code: 'CO', postal_code: '', city_code: ''
})

// Configuración proveedor tecnológico FE
const feProvider = ref({
  provider_name: '', base_url: '', auth_type: 'apikey', auth_header: 'X-API-Key',
  api_key: '', software_id: '', software_pin: '', environment: 'habilitacion',
  test_set_id: '', timeout_seconds: 30, is_active: true
})

// Resolución DIAN activa
const activeResolution = ref({
  resolution_id: null, document_type: 'FE', prefix: '',
  from_number: 1, to_number: 1000, current_number: 0,
  resolution_number: '', resolution_date: '', valid_from: '', valid_to: '',
  technical_key: '', is_active: true
})

const taxRegimeOptions = [
  { title: 'Responsable de IVA (Régimen Ordinario)', value: '48' },
  { title: 'No Responsable de IVA', value: '49' },
  { title: 'Gran Contribuyente', value: 'O-13' },
  { title: 'Régimen Simple de Tributación (SIMPLE)', value: 'ZZ' }
]

const feEnvironmentOptions = [
  { title: 'Habilitación (Pruebas)', value: 'habilitacion' },
  { title: 'Producción', value: 'produccion' }
]

const feDocTypeOptions = [
  { title: 'Factura Electrónica (FE)', value: 'FE' },
  { title: 'Tiquete POS (FV)', value: 'FV' },
  { title: 'Nota Crédito (NC)', value: 'NC' },
  { title: 'Nota Débito (ND)', value: 'ND' }
]

const settings = ref({
  // General
  business_name: '',
  business_address: '',
  business_phone: '',
  logo_url: '',
  receipt_footer: '',
  default_tax_included: false,
  
  // UI
  default_page_size: 20,
  theme: 'light',
  date_format: 'DD/MM/YYYY',
  locale: 'es-CO',
  session_timeout_minutes: 60,
  cash_session_max_hours: 24,
  
  // IA
  ai_forecast_days_back: 90,
  ai_purchase_suggestion_days: 14,
  ai_purchase_advisor_enabled: true,
  ai_sales_forecast_enabled: true,

  // Contabilidad
  accounting_enabled: false,
  accounting_mode: 'ASYNC',
  accounting_ai_enabled: true,
  accounting_auto_post_sales: false,
  accounting_auto_post_purchases: false,
  accounting_country_code: 'CO',
  
  // Inventario (sin duplicados - min_stock y allow_backorder ya existen por producto)
  expiry_alert_days: 30,
  reserve_stock_on_layaway: true,
  
  // Ventas
  max_discount_without_auth: 5,
  rounding_method: 'normal',
  rounding_multiple: 100,
  pos_allow_manual_sale_datetime: false,
  pos_max_backdate_hours: 24,
  
  // Facturación
  invoice_prefix: 'FAC',
  next_invoice_number: 1,
  electronic_invoicing_enabled: false,
  print_format: 'thermal',
  thermal_paper_width: 80,
  
  // Notificaciones
  email_alerts_enabled: false,
  alert_email: '',
  notify_low_stock: true,
  notify_expiring_products: true
})

const accountingModeDescription = computed(() => {
  const mode = settings.value.accounting_mode
  if (mode === 'OFF') return 'No se generan eventos contables automáticos.'
  if (mode === 'MANUAL') return 'El equipo contable registra asientos manualmente.'
  return 'El POS envía eventos a una cola y contabilidad los procesa sin bloquear operación.'
})

const allowedTabs = ['general', 'billing', 'ui', 'ai', 'accounting', 'inventory', 'sales', 'invoicing', 'notifications']
const setupHintKey = computed(() => String(route.query.onboarding || '').trim())
const accountingProcess = computed(() => processMap.value.accounting || null)
const setupHintVisible = computed(() => setupHintKey.value.length > 0)
const billingSaveBlocked = computed(() => billingSummary.value && canOperateAdmin.value === false)
const billingStatusColor = computed(() => {
  const status = billingSummary.value?.status
  if (status === 'active') return 'success'
  if (status === 'trialing') return 'info'
  if (status === 'past_due') return 'error'
  if (status === 'grace_period') return 'warning'
  if (status === 'suspended') return 'error'
  return 'primary'
})
const billingAlertType = computed(() => {
  const status = billingSummary.value?.status
  if (status === 'past_due' || status === 'suspended') return 'error'
  if (status === 'grace_period') return 'warning'
  return 'info'
})
const billingExpiryLabel = computed(() => {
  if (!billingSummary.value) return 'Vigencia'
  if (billingSummary.value.status === 'trialing') return 'Fin del trial'
  if (billingSummary.value.status === 'grace_period') return 'Fin de gracia'
  return 'Vigencia'
})
const billingExpiryDate = computed(() => {
  const value = billingSummary.value?.expiration_date
  if (!value) return 'Sin fecha'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Fecha inválida'
  return date.toLocaleDateString('es-CO', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  })
})
const billingDaysHint = computed(() => {
  const days = billingSummary.value?.days_to_expiry
  if (!Number.isFinite(days)) return 'Sin cálculo de vigencia'
  if (days < 0) return `Venció hace ${Math.abs(days)} día(s)`
  if (days === 0) return 'Vence hoy'
  if (days === 1) return 'Vence mañana'
  return `Faltan ${days} día(s)`
})
const billingFeatures = computed(() => {
  return Object.entries(billingSummary.value?.feature_flags || {})
    .map(([code, enabled]) => ({ code, enabled: enabled === true }))
    .sort((a, b) => a.code.localeCompare(b.code))
})
const billingLimits = computed(() => {
  return Object.entries(billingSummary.value?.plan_limits || {})
    .map(([code, detail]) => ({
      code,
      value: detail?.value ?? '—',
      unit: detail?.unit ?? '',
    }))
    .sort((a, b) => a.code.localeCompare(b.code))
})
const setupHintMessage = computed(() => {
  if (setupHintKey.value.startsWith('accounting')) {
    return accountingProcess.value?.nextStep?.description || 'Completa los campos contables esenciales y guarda antes de volver al asistente.'
  }
  if (setupHintKey.value === 'sales-company') {
    return 'Completa datos del negocio, nombre comercial y prefijo para dejar la primera venta lista.'
  }
  return 'Completa los campos necesarios y guarda para que el asistente reevalúe el progreso.'
})

const showMsg = (msg, color = 'success') => { snackbarMessage.value = msg; snackbarColor.value = color; snackbar.value = true }

const loadData = async () => {
  if (!tenantId.value) return

  const [tRes, sRes] = await Promise.all([
    tenantSettingsService.getTenant(tenantId.value),
    tenantSettingsService.getSettings(tenantId.value)
  ])

  if (tRes.success) {
    const td = tRes.data
    tenant.value = {
      name:                  td.name                  || '',
      tax_id:                td.tax_id                || '',
      currency_code:         td.currency_code         || 'COP',
      dv:                    td.dv                    || '',
      trade_name:            td.trade_name            || '',
      tax_regime:            td.tax_regime            || '',
      is_responsible_for_iva: td.is_responsible_for_iva || false,
      obligated_accounting:  td.obligated_accounting  || false,
      ciiu_code:             td.ciiu_code             || '',
      fiscal_email:          td.fiscal_email          || '',
      fiscal_phone:          td.fiscal_phone          || '',
      // Dirección fiscal del emisor
      address:               td.address               || '',
      city:                  td.city                  || '',
      department:            td.department            || '',
      country_code:          td.country_code          || 'CO',
      postal_code:           td.postal_code           || '',
      city_code:             td.city_code             || ''
    }
  }

  // Cargar configuración del proveedor FE y resolución activa (si FE está habilitada)
  if (settings.value?.electronic_invoicing_enabled || true) {
    const [providerRes, resolutionRes] = await Promise.all([
      electronicInvoicingService.getProviderConfig(tenantId.value),
      electronicInvoicingService.getActiveResolution(tenantId.value, 'FE')
    ])
    if (providerRes.success && providerRes.data) {
      Object.assign(feProvider.value, providerRes.data)
    }
    if (resolutionRes.success && resolutionRes.data) {
      Object.assign(activeResolution.value, resolutionRes.data)
    }
  }

  if (sRes.success && sRes.data) {
    const data = sRes.data
    settings.value = {
      // General
      business_name: data.business_name || '',
      business_address: data.business_address || '',
      business_phone: data.business_phone || '',
      logo_url: data.logo_url || '',
      receipt_footer: data.receipt_footer || '',
      default_tax_included: data.default_tax_included || false,
      
      // UI
      default_page_size: data.default_page_size || 20,
      theme: data.theme || 'light',
      date_format: data.date_format || 'DD/MM/YYYY',
      locale: data.locale || 'es-CO',
      session_timeout_minutes: data.session_timeout_minutes || 60,
      cash_session_max_hours: data.cash_session_max_hours || 24,
      
      // IA
      ai_forecast_days_back: data.ai_forecast_days_back || 90,
      ai_purchase_suggestion_days: data.ai_purchase_suggestion_days || 14,
      ai_purchase_advisor_enabled: data.ai_purchase_advisor_enabled !== false,
      ai_sales_forecast_enabled: data.ai_sales_forecast_enabled !== false,

      // Contabilidad
      accounting_enabled: data.accounting_enabled || false,
      accounting_mode: data.accounting_mode || 'ASYNC',
      accounting_ai_enabled: data.accounting_ai_enabled !== false,
      accounting_auto_post_sales: data.accounting_auto_post_sales || false,
      accounting_auto_post_purchases: data.accounting_auto_post_purchases || false,
      accounting_country_code: data.accounting_country_code || 'CO',
      
      // Inventario (sin duplicados)
      expiry_alert_days: data.expiry_alert_days || 30,
      reserve_stock_on_layaway: data.reserve_stock_on_layaway !== false,
      
      // Ventas
      max_discount_without_auth: data.max_discount_without_auth || 5,
      rounding_method: data.rounding_method || 'normal',
      rounding_multiple: data.rounding_multiple || 100,
      pos_allow_manual_sale_datetime: data.pos_allow_manual_sale_datetime === true,
      pos_max_backdate_hours: data.pos_max_backdate_hours || 24,
      
      // Facturación
      invoice_prefix: data.invoice_prefix || 'FAC',
      next_invoice_number: data.next_invoice_number || 1,
      electronic_invoicing_enabled: data.electronic_invoicing_enabled || false,
      print_format: data.print_format || 'thermal',
      thermal_paper_width: data.thermal_paper_width || 80,
      
      // Notificaciones
      email_alerts_enabled: data.email_alerts_enabled || false,
      alert_email: data.alert_email || '',
      notify_low_stock: data.notify_low_stock !== false,
      notify_expiring_products: data.notify_expiring_products !== false
    }
  }
}

const saveAll = async () => {
  if (billingSaveBlocked.value) {
    showMsg('La suscripción actual no permite cambios administrativos en este tenant', 'warning')
    return
  }

  const { valid } = await configForm.value.validate()
  if (!valid) return

  saving.value = true
  try {
    // Guardar tenant + settings + proveedor FE + resolución (en paralelo)
    const saveTasks = [
      tenantSettingsService.updateTenant(tenantId.value, tenant.value),
      tenantSettingsService.saveSettings(tenantId.value, settings.value)
    ]

    if (settings.value.electronic_invoicing_enabled) {
      saveTasks.push(
        electronicInvoicingService.saveProviderConfig(tenantId.value, feProvider.value)
      )
      if (feProvider.value.base_url) {
        // Solo guardar resolución si hay datos mínimos
        if (activeResolution.value.resolution_number || activeResolution.value.prefix) {
          saveTasks.push(
            electronicInvoicingService.upsertResolution(tenantId.value, activeResolution.value)
          )
        }
      }
    }

    const [tRes, sRes] = await Promise.all(saveTasks)

    if (tRes.success && sRes.success) {
      showMsg('Configuración guardada exitosamente')
      
      // Recargar settings del composable
      await loadSettings(true)
      await loadSetupReadiness()
      
      // Sincronizar tema si cambió
      await syncThemeFromTenant(tenantId.value)
      
      // Recargar datos del formulario
      await loadData()
    } else {
      showMsg(tRes.error || sRes.error || 'Error al guardar', 'error')
    }
  } catch (error) {
    console.error('Error guardando configuración:', error)
    showMsg('Error al guardar configuración', 'error')
  } finally { saving.value = false }
}

// Funciones de Gestión de Caché IA
const clearExpiredCache = () => {
  const count = clearExpired()
  showMsg(`${count} entradas expiradas eliminadas`, 'success')
}

const confirmClearAllCache = () => {
  if (confirm('¿Está seguro de eliminar TODO el caché de IA? Esto forzará nuevas consultas a la API.')) {
    const count = clearAll()
    showMsg(`${count} entradas eliminadas. El caché se ha limpiado completamente.`, 'warning')
  }
}

onMounted(async () => {
  await loadData()
  await loadBillingSummary()
  await loadSetupReadiness()
  const queryTab = String(route.query.tab || '').trim()
  if (allowedTabs.includes(queryTab)) {
    tab.value = queryTab
  }
})

watch(
  () => route.query.tab,
  (nextTab) => {
    const normalized = String(nextTab || '').trim()
    if (allowedTabs.includes(normalized)) {
      tab.value = normalized
    }
  }
)
</script>
