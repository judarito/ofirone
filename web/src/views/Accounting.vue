<template>
  <div>
    <v-card class="mb-4" variant="tonal" color="primary">
      <v-card-text class="d-flex align-center justify-space-between flex-wrap gap-3">
        <div>
          <div class="text-h5 font-weight-bold d-flex align-center gap-2">
            <v-icon size="30">mdi-scale-balance</v-icon>
            Contabilidad Colombia
          </div>
          <div class="text-body-2 mt-1">
            Módulo contable desacoplado del POS, con integración asíncrona e IA.
          </div>
        </div>
        <div class="d-flex align-center gap-2 flex-wrap">
          <v-btn-toggle
            v-model="viewMode"
            mandatory
            color="primary"
            density="comfortable"
            variant="outlined"
          >
            <v-btn value="LIST" size="small" prepend-icon="mdi-view-list">Lista</v-btn>
            <v-btn value="TABLE" size="small" prepend-icon="mdi-table">Tabla</v-btn>
          </v-btn-toggle>
          <v-btn color="primary" variant="elevated" prepend-icon="mdi-refresh" :loading="loading" @click="loadAll">
            Actualizar
          </v-btn>
        </div>
      </v-card-text>
    </v-card>

    <ContextHelpCard
      class="mb-4"
      context-key="accounting"
    />

    <v-alert
      v-if="accountingSetupHintVisible"
      :type="accountingProcess?.state === 'READY_FOR_TEST' ? 'success' : 'info'"
      variant="tonal"
      class="mb-4"
      icon="mdi-rocket-launch-outline"
    >
      <div class="d-flex align-center justify-space-between flex-wrap gap-3">
        <div>
          <strong>Onboarding contable:</strong>
          {{ accountingSetupMessage }}
          <div v-if="accountingProcess?.blockers?.length" class="mt-2 text-body-2">
            Bloqueantes: {{ accountingProcess.blockers.join(', ') }}
          </div>
        </div>
        <div class="d-flex flex-wrap gap-2">
          <v-btn
            v-if="accountingProcess?.nextStep"
            color="primary"
            variant="elevated"
            :to="accountingProcess.nextStep.route || accountingProcess.route"
          >
            {{ accountingProcess.nextStep.actionLabel || 'Continuar onboarding' }}
          </v-btn>
          <v-btn
            color="secondary"
            variant="tonal"
            :to="{ path: '/setup', query: { process: 'accounting' } }"
          >
            Ver asistente
          </v-btn>
        </div>
      </div>
    </v-alert>

    <v-card class="mb-4">
      <v-card-title class="d-flex align-center justify-space-between flex-wrap gap-2">
        <span class="d-flex align-center gap-2">
          <v-icon color="primary">mdi-office-building-cog</v-icon>
          Configuración (solo lectura)
        </span>
        <v-btn color="primary" variant="tonal" prepend-icon="mdi-cog" @click="goToCompanyConfig">
          Ir a Empresa
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-3">
          La configuración de integración contable se administra desde
          <strong>Configuración de Empresa</strong>.
        </p>

        <v-row>
          <v-col cols="12" sm="6" md="2">
            <div class="text-caption text-medium-emphasis">Contabilidad</div>
            <v-chip :color="settings.accounting_enabled ? 'success' : 'grey'" size="small">
              {{ settings.accounting_enabled ? 'Habilitada' : 'Deshabilitada' }}
            </v-chip>
          </v-col>
          <v-col cols="12" sm="6" md="2">
            <div class="text-caption text-medium-emphasis">Modo</div>
            <v-chip color="primary" size="small">{{ modeLabel }}</v-chip>
          </v-col>
          <v-col cols="12" sm="6" md="2">
            <div class="text-caption text-medium-emphasis">Auto ventas</div>
            <v-chip :color="settings.accounting_auto_post_sales ? 'success' : 'grey'" size="small">
              {{ settings.accounting_auto_post_sales ? 'Activa' : 'Inactiva' }}
            </v-chip>
          </v-col>
          <v-col cols="12" sm="6" md="2">
            <div class="text-caption text-medium-emphasis">Auto compras</div>
            <v-chip :color="settings.accounting_auto_post_purchases ? 'success' : 'grey'" size="small">
              {{ settings.accounting_auto_post_purchases ? 'Activa' : 'Inactiva' }}
            </v-chip>
          </v-col>
          <v-col cols="12" sm="6" md="2">
            <div class="text-caption text-medium-emphasis">IA contable</div>
            <v-chip :color="settings.accounting_ai_enabled ? 'success' : 'grey'" size="small">
              {{ settings.accounting_ai_enabled ? 'Activa' : 'Inactiva' }}
            </v-chip>
          </v-col>
          <v-col cols="12" sm="6" md="2">
            <div class="text-caption text-medium-emphasis">Norma</div>
            <v-chip color="secondary" size="small">{{ settings.accounting_country_code || 'CO' }}</v-chip>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-alert
      v-if="!settings.accounting_enabled"
      type="info"
      variant="tonal"
      class="mb-4"
      icon="mdi-information-outline"
    >
      La contabilidad está desactivada. El POS seguirá operando sin dependencia contable.
    </v-alert>

    <template v-else>
      <v-tabs v-model="activeTab" color="primary" class="mb-4">
        <v-tab value="dashboard">
          <v-icon start>mdi-view-dashboard-outline</v-icon>
          Dashboard
        </v-tab>
        <v-tab value="compliance">
          <v-icon start>mdi-clipboard-check-outline</v-icon>
          Panel Contador / DIAN
        </v-tab>
        <v-tab value="queue">
          <v-badge
            :content="pendingQueueCount > 99 ? '99+' : pendingQueueCount"
            :model-value="pendingQueueCount > 0"
            color="warning"
            inline
          >
            <span class="d-flex align-center">
              <v-icon size="18" class="mr-1">mdi-queue-first-in-last-out</v-icon>
              Cola POS
            </span>
          </v-badge>
        </v-tab>
        <v-tab value="ai" :disabled="!settings.accounting_ai_enabled">
          <v-icon start>mdi-robot-outline</v-icon>
          Asistente IA
        </v-tab>
      </v-tabs>

      <v-window v-model="activeTab">
        <v-window-item value="dashboard">
          <v-row class="mb-4">
            <v-col cols="12" md="3">
              <v-card variant="outlined">
                <v-card-text>
                  <div class="text-caption text-medium-emphasis">Eventos pendientes</div>
                  <div class="text-h4 font-weight-bold">{{ summary.pending_events ?? 0 }}</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" md="3">
              <v-card variant="outlined">
                <v-card-text>
                  <div class="text-caption text-medium-emphasis">Asientos borrador</div>
                  <div class="text-h4 font-weight-bold">{{ summary.draft_entries ?? 0 }}</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" md="3">
              <v-card variant="outlined">
                <v-card-text>
                  <div class="text-caption text-medium-emphasis">Posteados este mes</div>
                  <div class="text-h4 font-weight-bold">{{ summary.posted_entries_month ?? 0 }}</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" md="3">
              <v-card variant="outlined">
                <v-card-text>
                  <div class="text-caption text-medium-emphasis">Balance mensual</div>
                  <v-chip :color="summary.is_balanced_month ? 'success' : 'error'" size="small">
                    {{ summary.is_balanced_month ? 'Cuadrado' : 'Descuadrado' }}
                  </v-chip>
                  <div class="text-caption mt-2">
                    D: {{ formatMoney(summary.month_debits || 0) }}<br>
                    C: {{ formatMoney(summary.month_credits || 0) }}
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>

          <v-card id="trial-balance-section" class="mb-4">
            <v-card-title class="d-flex align-center justify-space-between flex-wrap gap-2">
              <span>Balanza de Comprobación</span>
              <div class="d-flex align-center gap-2">
                <v-text-field
                  v-model="filters.date_from"
                  label="Desde"
                  type="date"
                  variant="outlined"
                  density="compact"
                  hide-details
                  style="max-width: 170px"
                />
                <v-text-field
                  v-model="filters.date_to"
                  label="Hasta"
                  type="date"
                  variant="outlined"
                  density="compact"
                  hide-details
                  style="max-width: 170px"
                />
                <v-btn color="primary" variant="tonal" @click="loadTrialBalance">Aplicar</v-btn>
                <v-btn
                  color="success"
                  variant="tonal"
                  prepend-icon="mdi-file-excel"
                  :disabled="trialBalance.length === 0"
                  :loading="exportingTrialBalanceXlsx"
                  @click="exportTrialBalanceXlsx"
                >
                  XLSX
                </v-btn>
                <v-btn
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-file-delimited"
                  :disabled="trialBalance.length === 0"
                  :loading="exportingTrialBalanceCsv"
                  @click="exportTrialBalanceCsv"
                >
                  CSV
                </v-btn>
              </div>
            </v-card-title>
            <v-divider />

            <v-card-text v-if="isTableView" class="pa-0">
              <v-table density="comfortable" fixed-header height="380">
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Cuenta</th>
                    <th>Tipo</th>
                    <th>Naturaleza</th>
                    <th class="text-right">Débitos</th>
                    <th class="text-right">Créditos</th>
                    <th class="text-right">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in trialBalance" :key="row.account_code">
                    <td><code>{{ row.account_code }}</code></td>
                    <td>{{ row.account_name }}</td>
                    <td>{{ row.account_type }}</td>
                    <td>{{ row.natural_side }}</td>
                    <td class="text-right">{{ formatMoney(row.debit_total) }}</td>
                    <td class="text-right">{{ formatMoney(row.credit_total) }}</td>
                    <td class="text-right" :class="Number(row.balance || 0) < 0 ? 'text-error' : ''">
                      {{ formatMoney(row.balance) }}
                    </td>
                  </tr>
                  <tr v-if="trialBalance.length === 0">
                    <td colspan="7" class="text-center text-medium-emphasis py-6">
                      No hay datos para el período seleccionado.
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card-text>
            <v-card-text v-else>
              <ListView
                title="Balanza de Comprobación"
                icon="mdi-scale-balance"
                :items="paginatedTrialBalance"
                :total-items="trialBalance.length"
                :loading="loading"
                :page-size="LIST_PAGE_SIZE.trialBalance"
                :auto-load="false"
                item-key="account_code"
                title-field="account_name"
                avatar-icon="mdi-calculator-variant-outline"
                avatar-color="indigo"
                empty-message="No hay datos para el período seleccionado."
                :searchable="false"
                :show-create-button="false"
                :editable="false"
                :deletable="false"
                @load-page="onTrialBalanceListPage"
              >
                <template #title="{ item: row }">
                  <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
                    <div>
                      <code>{{ row.account_code }}</code>
                      <span class="ml-2 font-weight-medium">{{ row.account_name }}</span>
                    </div>
                    <v-chip size="x-small" color="indigo">{{ row.natural_side }}</v-chip>
                  </div>
                </template>
                <template #content="{ item: row }">
                  <div class="text-caption">{{ row.account_type }}</div>
                  <div class="text-caption mt-1">Débitos: {{ formatMoney(row.debit_total) }}</div>
                  <div class="text-caption">Créditos: {{ formatMoney(row.credit_total) }}</div>
                  <div class="text-body-2 font-weight-bold mt-1" :class="Number(row.balance || 0) < 0 ? 'text-error' : ''">
                    Saldo: {{ formatMoney(row.balance) }}
                  </div>
                </template>
              </ListView>
            </v-card-text>
          </v-card>

          <v-card id="entries-section">
            <v-card-title>Últimos Asientos</v-card-title>
            <v-divider />
            <v-card-text v-if="isTableView" class="pa-0">
              <v-table density="comfortable" fixed-header height="320">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Fecha</th>
                    <th>Módulo</th>
                    <th>Descripción</th>
                    <th>Estado</th>
                    <th>Creado</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="entry in recentEntries" :key="entry.entry_id">
                    <td>{{ entry.entry_number }}</td>
                    <td>{{ formatDate(entry.entry_date) }}</td>
                    <td>{{ entry.source_module }}</td>
                    <td>{{ entry.description || '-' }}</td>
                    <td>
                      <v-chip
                        size="x-small"
                        :color="entry.status === 'POSTED' ? 'success' : (entry.status === 'VOIDED' ? 'error' : 'warning')"
                      >
                        {{ entry.status }}
                      </v-chip>
                    </td>
                    <td>{{ formatDate(entry.created_at) }}</td>
                  </tr>
                  <tr v-if="recentEntries.length === 0">
                    <td colspan="6" class="text-center text-medium-emphasis py-6">
                      No hay asientos recientes.
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card-text>
            <v-card-text v-else>
              <ListView
                title="Últimos Asientos"
                icon="mdi-book-open-page-variant"
                :items="paginatedRecentEntries"
                :total-items="recentEntries.length"
                :loading="loading"
                :page-size="LIST_PAGE_SIZE.recentEntries"
                :auto-load="false"
                item-key="entry_id"
                title-field="entry_number"
                avatar-icon="mdi-book-open-page-variant"
                avatar-color="primary"
                empty-message="No hay asientos recientes."
                :searchable="false"
                :show-create-button="false"
                :editable="false"
                :deletable="false"
                @load-page="onRecentEntriesListPage"
              >
                <template #title="{ item: entry }">
                  <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
                    <div>
                      <strong>#{{ entry.entry_number }}</strong>
                      <span class="ml-2">{{ formatDate(entry.entry_date) }}</span>
                    </div>
                    <v-chip
                      size="x-small"
                      :color="entry.status === 'POSTED' ? 'success' : (entry.status === 'VOIDED' ? 'error' : 'warning')"
                    >
                      {{ entry.status }}
                    </v-chip>
                  </div>
                </template>
                <template #content="{ item: entry }">
                  <div class="text-caption"><strong>Módulo:</strong> {{ entry.source_module }}</div>
                  <div class="text-caption">{{ entry.description || '-' }}</div>
                  <div class="text-caption text-medium-emphasis">Creado: {{ formatDate(entry.created_at) }}</div>
                </template>
              </ListView>
            </v-card-text>
          </v-card>
        </v-window-item>

        <v-window-item value="compliance">
          <v-card class="mb-4" variant="tonal" color="indigo">
            <v-card-text class="d-flex align-center justify-space-between flex-wrap gap-3">
              <div>
                <div class="text-h6 font-weight-bold">Panel del Contador Público (Colombia)</div>
                <div class="text-body-2 mt-1">
                  Vista unificada de reportes contables, estado tributario y obligaciones ante DIAN.
                </div>
              </div>
              <div class="d-flex align-center flex-wrap gap-2">
                <v-text-field
                  v-model="filters.date_from"
                  label="Desde"
                  type="date"
                  variant="outlined"
                  density="compact"
                  hide-details
                  style="max-width: 170px"
                />
                <v-text-field
                  v-model="filters.date_to"
                  label="Hasta"
                  type="date"
                  variant="outlined"
                  density="compact"
                  hide-details
                  style="max-width: 170px"
                />
                <v-btn
                  color="primary"
                  variant="elevated"
                  prepend-icon="mdi-calendar-check-outline"
                  :loading="loadingCompliance"
                  @click="reloadCompliance"
                >
                  Cargar período
                </v-btn>
              </div>
            </v-card-text>
          </v-card>

          <v-row class="mb-4">
            <v-col cols="12" md="3">
              <v-card variant="outlined" class="h-100">
                <v-card-text>
                  <div class="text-caption text-medium-emphasis">Ventas del período</div>
                  <div class="text-h5 font-weight-bold">{{ formatMoney(compliance.kpis.sales_total || 0) }}</div>
                  <div class="text-caption mt-1">
                    {{ compliance.kpis.sales_count || 0 }} documentos comerciales
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" md="3">
              <v-card variant="outlined" class="h-100">
                <v-card-text>
                  <div class="text-caption text-medium-emphasis">IVA generado en ventas</div>
                  <div class="text-h5 font-weight-bold">{{ formatMoney(compliance.kpis.sales_tax || 0) }}</div>
                  <div class="text-caption mt-1">Base: {{ formatMoney(compliance.kpis.sales_subtotal || 0) }}</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" md="3">
              <v-card variant="outlined" class="h-100">
                <v-card-text>
                  <div class="text-caption text-medium-emphasis">Compras del período</div>
                  <div class="text-h5 font-weight-bold">{{ formatMoney(compliance.kpis.purchases_total || 0) }}</div>
                  <div class="text-caption mt-1">{{ compliance.kpis.purchases_count || 0 }} compras registradas</div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" md="3">
              <v-card variant="outlined" class="h-100">
                <v-card-text>
                  <div class="text-caption text-medium-emphasis">Preparación DIAN</div>
                  <div class="text-h5 font-weight-bold">{{ complianceProgressPercent }}%</div>
                  <v-progress-linear
                    class="mt-2"
                    :model-value="complianceProgressPercent"
                    :color="complianceProgressPercent >= 80 ? 'success' : (complianceProgressPercent >= 50 ? 'warning' : 'error')"
                    height="8"
                    rounded
                  />
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>

          <v-row class="mb-4">
            <v-col cols="12" md="6">
              <v-card variant="outlined" class="h-100">
                <v-card-title class="d-flex align-center justify-space-between">
                  <span>Salud Facturación Electrónica</span>
                  <v-chip
                    size="small"
                    :color="compliance.fe_configuration?.is_ready ? 'success' : 'warning'"
                  >
                    {{ compliance.fe_configuration?.is_ready ? 'Operativa' : 'Pendiente' }}
                  </v-chip>
                </v-card-title>
                <v-divider />
                <v-card-text class="text-body-2">
                  <div>
                    <strong>Proveedor:</strong>
                    {{ compliance.fe_configuration?.provider_name || 'No configurado' }}
                    <span v-if="compliance.fe_configuration?.environment">
                      ({{ compliance.fe_configuration.environment }})
                    </span>
                  </div>
                  <div class="mt-1">
                    <strong>FE emitidas:</strong> {{ compliance.kpis.fe_total || 0 }} |
                    <strong>Aceptadas:</strong> {{ compliance.kpis.fe_accepted || 0 }} |
                    <strong>Pendientes:</strong> {{ compliance.kpis.fe_pending || 0 }} |
                    <strong>Rechazadas/Error:</strong> {{ (compliance.kpis.fe_rejected || 0) + (compliance.kpis.fe_error || 0) }}
                  </div>
                  <div class="mt-1" v-if="compliance.fe_configuration?.resolution">
                    <strong>Resolución:</strong>
                    {{ compliance.fe_configuration.resolution.prefix || 'Sin prefijo' }}
                    · {{ compliance.fe_configuration.resolution.current_number }}
                    / {{ compliance.fe_configuration.resolution.to_number }}
                  </div>
                  <div class="mt-3">
                    <v-btn
                      size="small"
                      variant="tonal"
                      color="primary"
                      prepend-icon="mdi-cog"
                      @click="goToRoute('/tenant-config')"
                    >
                      Configurar FE en Empresa
                    </v-btn>
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
            <v-col cols="12" md="6">
              <v-card variant="outlined" class="h-100">
                <v-card-title class="d-flex align-center justify-space-between">
                  <span>Higiene Contable</span>
                  <v-chip
                    size="small"
                    :color="(compliance.kpis.pending_queue_events || 0) > 0 ? 'warning' : 'success'"
                  >
                    {{ (compliance.kpis.pending_queue_events || 0) > 0 ? 'Requiere revisión' : 'Al día' }}
                  </v-chip>
                </v-card-title>
                <v-divider />
                <v-card-text class="text-body-2">
                  <div><strong>Asientos posteados:</strong> {{ compliance.kpis.posted_entries || 0 }}</div>
                  <div><strong>Asientos borrador:</strong> {{ compliance.kpis.draft_entries || 0 }}</div>
                  <div><strong>Eventos pendientes en cola:</strong> {{ compliance.kpis.pending_queue_events || 0 }}</div>
                  <div><strong>Terceros en período:</strong> {{ compliance.kpis.counterparties || 0 }}</div>
                  <div class="mt-3">
                    <v-btn
                      size="small"
                      variant="tonal"
                      color="success"
                      prepend-icon="mdi-play-circle-outline"
                      @click="activeTab = 'queue'"
                    >
                      Ir a Cola POS
                    </v-btn>
                  </div>
                </v-card-text>
              </v-card>
            </v-col>
          </v-row>

          <v-card class="mb-4">
            <v-card-title class="d-flex align-center justify-space-between flex-wrap gap-2">
              <span>Obligaciones tributarias y reportes exigidos</span>
              <div class="d-flex align-center gap-2 flex-wrap">
                <v-btn
                  size="small"
                  color="success"
                  variant="tonal"
                  prepend-icon="mdi-file-excel"
                  :loading="exportingComplianceXlsx"
                  @click="exportComplianceChecklistXlsx"
                >
                  Exportar XLSX
                </v-btn>
                <v-btn
                  size="small"
                  color="primary"
                  variant="tonal"
                  prepend-icon="mdi-file-delimited"
                  :loading="exportingComplianceCsv"
                  @click="exportComplianceChecklistCsv"
                >
                  Exportar CSV
                </v-btn>
                <v-chip color="primary" size="small">Guía operativa para contador y gerente</v-chip>
              </div>
            </v-card-title>
            <v-divider />
            <v-card-text v-if="isTableView" class="pa-0">
              <v-table density="comfortable" fixed-header height="360">
                <thead>
                  <tr>
                    <th>Obligación</th>
                    <th>Frecuencia</th>
                    <th>Qué significa</th>
                    <th>Estado</th>
                    <th>Evidencia en sistema</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="item in compliance.obligations" :key="item.key">
                    <td class="font-weight-medium">{{ item.name }}</td>
                    <td>{{ item.frequency }}</td>
                    <td class="text-caption">{{ item.meaning }}</td>
                    <td>
                      <v-chip size="x-small" :color="getComplianceStatusColor(item.status)">
                        {{ getComplianceStatusLabel(item.status) }}
                      </v-chip>
                    </td>
                    <td class="text-caption">{{ item.evidence }}</td>
                    <td>
                      <v-btn
                        size="x-small"
                        variant="tonal"
                        color="primary"
                        :disabled="!item.route"
                        @click="openComplianceItem(item)"
                      >
                        Abrir
                      </v-btn>
                    </td>
                  </tr>
                  <tr v-if="(compliance.obligations || []).length === 0">
                    <td colspan="6" class="text-center text-medium-emphasis py-6">
                      Sin obligaciones para mostrar.
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card-text>
            <v-card-text v-else>
              <ListView
                title="Checklist contable y DIAN"
                icon="mdi-clipboard-check-outline"
                :items="paginatedObligations"
                :total-items="obligationsItems.length"
                :loading="loadingCompliance"
                :page-size="LIST_PAGE_SIZE.obligations"
                :auto-load="false"
                item-key="key"
                title-field="name"
                avatar-icon="mdi-clipboard-check-outline"
                avatar-color="indigo"
                empty-message="Sin obligaciones para mostrar."
                :searchable="false"
                :show-create-button="false"
                :editable="false"
                :deletable="false"
                @load-page="onObligationsListPage"
              >
                <template #title="{ item }">
                  <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
                    <div class="font-weight-medium">{{ item.name }}</div>
                    <v-chip size="x-small" :color="getComplianceStatusColor(item.status)">
                      {{ getComplianceStatusLabel(item.status) }}
                    </v-chip>
                  </div>
                </template>
                <template #content="{ item }">
                  <div class="text-caption mt-1"><strong>Frecuencia:</strong> {{ item.frequency }}</div>
                  <div class="text-caption">{{ item.meaning }}</div>
                  <div class="text-caption mt-1"><strong>Evidencia:</strong> {{ item.evidence || '-' }}</div>
                </template>
                <template #actions="{ item }">
                  <v-btn
                    size="small"
                    variant="tonal"
                    color="primary"
                    :disabled="!item.route"
                    @click.stop="openComplianceItem(item)"
                  >
                    Abrir
                  </v-btn>
                </template>
              </ListView>
            </v-card-text>
          </v-card>

          <v-card>
            <v-card-title>Reportes clave para el cierre contable</v-card-title>
            <v-divider />
            <v-card-text>
              <v-row>
                <v-col
                  v-for="report in compliance.required_reports"
                  :key="report.key"
                  cols="12"
                  md="6"
                  lg="4"
                >
                  <v-card variant="outlined" class="h-100">
                    <v-card-text>
                      <div class="text-subtitle-2 font-weight-bold mb-1">{{ report.name }}</div>
                      <div class="text-caption text-medium-emphasis mb-3">{{ report.purpose }}</div>
                      <div class="d-flex align-center justify-space-between">
                        <v-chip size="x-small" :color="getComplianceStatusColor(report.status)">
                          {{ getComplianceStatusLabel(report.status) }}
                        </v-chip>
                        <v-btn
                          size="x-small"
                          variant="tonal"
                          color="primary"
                          :disabled="!report.route"
                          @click="openRequiredReport(report)"
                        >
                          Ver reporte
                        </v-btn>
                      </div>
                    </v-card-text>
                  </v-card>
                </v-col>
              </v-row>
            </v-card-text>
          </v-card>
        </v-window-item>

        <v-window-item value="queue">
          <v-card>
            <v-card-title class="d-flex align-center justify-space-between">
              <span>Cola de Integración POS → Contabilidad</span>
              <div class="d-flex align-center gap-2">
                <v-btn
                  color="success"
                  variant="tonal"
                  prepend-icon="mdi-play-circle-outline"
                  :loading="processingQueue"
                  @click="processPendingQueue"
                >
                  Procesar pendientes
                </v-btn>
                <v-btn color="primary" variant="tonal" @click="loadQueue">Refrescar cola</v-btn>
              </div>
            </v-card-title>
            <v-divider />
            <v-card-text v-if="isTableView" class="pa-0">
              <v-table density="comfortable" fixed-header height="580">
                <thead>
                  <tr>
                    <th>Creado</th>
                    <th>Módulo</th>
                    <th>Evento</th>
                    <th>Referencia</th>
                    <th>Intentos</th>
                    <th>Estado</th>
                    <th>Error</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="event in eventQueue" :key="event.event_id">
                    <td>{{ formatDate(event.created_at) }}</td>
                    <td>{{ event.source_module }}</td>
                    <td>{{ event.event_type }}</td>
                    <td><code>{{ event.source_id }}</code></td>
                    <td>{{ event.attempts }}</td>
                    <td>
                      <v-chip
                        size="x-small"
                        :color="getQueueStatusColor(event.status)"
                      >
                        {{ event.status }}
                      </v-chip>
                    </td>
                    <td class="text-caption text-error">{{ event.last_error || '-' }}</td>
                  </tr>
                  <tr v-if="eventQueue.length === 0">
                    <td colspan="7" class="text-center text-medium-emphasis py-6">
                      No hay eventos en la cola.
                    </td>
                  </tr>
                </tbody>
              </v-table>
            </v-card-text>
            <v-card-text v-else>
              <ListView
                title="Cola de Integración POS → Contabilidad"
                icon="mdi-queue-first-in-last-out"
                :items="paginatedQueueEvents"
                :total-items="eventQueue.length"
                :loading="loading || processingQueue"
                :page-size="LIST_PAGE_SIZE.queue"
                :auto-load="false"
                item-key="event_id"
                title-field="event_type"
                avatar-icon="mdi-queue-first-in-last-out"
                avatar-color="warning"
                empty-message="No hay eventos en la cola."
                :searchable="false"
                :show-create-button="false"
                :editable="false"
                :deletable="false"
                @load-page="onQueueListPage"
              >
                <template #title="{ item: event }">
                  <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
                    <div>{{ event.source_module }} · {{ event.event_type }}</div>
                    <v-chip size="x-small" :color="getQueueStatusColor(event.status)">
                      {{ event.status }}
                    </v-chip>
                  </div>
                </template>
                <template #content="{ item: event }">
                  <div class="text-caption"><strong>Creado:</strong> {{ formatDate(event.created_at) }}</div>
                  <div class="text-caption"><strong>Referencia:</strong> <code>{{ event.source_id }}</code></div>
                  <div class="text-caption"><strong>Intentos:</strong> {{ event.attempts }}</div>
                  <div class="text-caption text-error"><strong>Error:</strong> {{ event.last_error || '-' }}</div>
                </template>
              </ListView>
            </v-card-text>
          </v-card>
        </v-window-item>

        <v-window-item value="ai">
          <v-card class="mb-4">
            <v-card-title>Asistente IA Contable (CO)</v-card-title>
            <v-divider />
            <v-card-text>
              <v-textarea
                v-model="aiPrompt"
                label="Describe la operación (ej: venta crédito con IVA 19%, abono parcial, devolución, etc.)"
                variant="outlined"
                auto-grow
                rows="6"
              />
              <div class="d-flex justify-end mt-2">
                <v-btn color="secondary" prepend-icon="mdi-robot-outline" :loading="aiLoading" @click="generateAISuggestion">
                  Generar borrador de asiento
                </v-btn>
              </div>
            </v-card-text>
          </v-card>

          <v-card v-if="aiResult">
            <v-card-title class="d-flex align-center gap-2">
              <v-icon color="secondary">mdi-lightbulb-on-outline</v-icon>
              Sugerencia IA
            </v-card-title>
            <v-divider />
            <v-card-text>
              <div class="mb-3"><strong>Resumen:</strong> {{ aiResult.summary || 'Sin resumen' }}</div>
              <div class="mb-3"><strong>Confianza:</strong> {{ aiResult.confidence ?? 'N/A' }}</div>

              <v-alert
                v-if="Array.isArray(aiResult.warnings) && aiResult.warnings.length"
                type="warning"
                variant="tonal"
                class="mb-4"
              >
                <div><strong>Alertas:</strong></div>
                <div v-for="(w, idx) in aiResult.warnings" :key="idx">- {{ w }}</div>
              </v-alert>

              <v-table density="comfortable" v-if="isTableView && aiResult.entry?.lines?.length">
                <thead>
                  <tr>
                    <th>Cuenta</th>
                    <th>Nombre</th>
                    <th class="text-right">Débito</th>
                    <th class="text-right">Crédito</th>
                    <th>Justificación</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(line, idx) in aiResult.entry.lines" :key="idx">
                    <td><code>{{ line.account_code }}</code></td>
                    <td>{{ line.account_name }}</td>
                    <td class="text-right">{{ formatMoney(line.debit_amount || 0) }}</td>
                    <td class="text-right">{{ formatMoney(line.credit_amount || 0) }}</td>
                    <td class="text-caption">{{ line.reason || '-' }}</td>
                  </tr>
                </tbody>
              </v-table>
              <ListView
                v-else-if="aiResult.entry?.lines?.length"
                title="Líneas sugeridas por IA"
                icon="mdi-robot-outline"
                :items="paginatedAiLines"
                :total-items="aiLinesItems.length"
                :loading="aiLoading"
                :page-size="LIST_PAGE_SIZE.aiLines"
                :auto-load="false"
                item-key="_list_key"
                title-field="account_name"
                avatar-icon="mdi-robot-outline"
                avatar-color="secondary"
                empty-message="Sin líneas sugeridas por IA."
                :searchable="false"
                :show-create-button="false"
                :editable="false"
                :deletable="false"
                @load-page="onAiLinesListPage"
              >
                <template #title="{ item: line }">
                  <div class="d-flex align-center justify-space-between flex-wrap ga-2 w-100">
                    <div>
                      <code>{{ line.account_code }}</code>
                      <span class="ml-2">{{ line.account_name }}</span>
                    </div>
                    <div class="text-caption">
                      <strong>D:</strong> {{ formatMoney(line.debit_amount || 0) }}
                      <span class="mx-1">|</span>
                      <strong>C:</strong> {{ formatMoney(line.credit_amount || 0) }}
                    </div>
                  </div>
                </template>
                <template #content="{ item: line }">
                  <div class="text-caption">{{ line.reason || '-' }}</div>
                </template>
              </ListView>
            </v-card-text>
          </v-card>
        </v-window-item>
      </v-window>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { utils, writeFileXLSX } from 'xlsx'
import { useTenant } from '@/composables/useTenant'
import { useNotification } from '@/composables/useNotification'
import { useAccountingViewMode } from '@/composables/useAccountingViewMode'
import { useSetupAssistant } from '@/composables/useSetupAssistant'
import accountingService from '@/services/accounting.service'
import ListView from '@/components/ListView.vue'
import ContextHelpCard from '@/components/ContextHelpCard.vue'

const router = useRouter()
const route = useRoute()
const { tenantId } = useTenant()
const { show } = useNotification()
const { viewMode, isTableView } = useAccountingViewMode()
const { processMap, loadSetupReadiness } = useSetupAssistant()

const loading = ref(false)
const aiLoading = ref(false)
const processingQueue = ref(false)
const loadingCompliance = ref(false)
const exportingTrialBalanceXlsx = ref(false)
const exportingTrialBalanceCsv = ref(false)
const exportingComplianceXlsx = ref(false)
const exportingComplianceCsv = ref(false)

const activeTab = ref('dashboard')

const createDefaultSettings = () => ({
  accounting_enabled: false,
  accounting_mode: 'ASYNC',
  accounting_ai_enabled: true,
  accounting_auto_post_sales: false,
  accounting_auto_post_purchases: false,
  accounting_country_code: 'CO'
})

const createEmptyComplianceState = () => ({
  period: accountingService.getDefaultPeriod(),
  kpis: {},
  fe_configuration: {},
  obligations: [],
  required_reports: [],
  readiness_score: 0,
  readiness_max: 0
})

const settings = ref(createDefaultSettings())

const summary = ref({})
const trialBalance = ref([])
const recentEntries = ref([])
const eventQueue = ref([])
const compliance = ref(createEmptyComplianceState())

const filters = ref({
  ...accountingService.getDefaultPeriod()
})

const aiPrompt = ref('')
const aiResult = ref(null)
const loadedTabs = ref({
  dashboard: false,
  compliance: false,
  queue: false,
  ai: false
})

const LIST_PAGE_SIZE = {
  trialBalance: 12,
  recentEntries: 8,
  obligations: 6,
  queue: 8,
  aiLines: 8
}

const trialBalancePage = ref(1)
const recentEntriesPage = ref(1)
const obligationsPage = ref(1)
const queuePage = ref(1)
const aiLinesPage = ref(1)

const getPaginatedItems = (items, page, pageSize) => {
  const list = Array.isArray(items) ? items : []
  const start = Math.max(0, (page - 1) * pageSize)
  return list.slice(start, start + pageSize)
}

const trialBalanceTotalPages = computed(() => Math.max(1, Math.ceil((trialBalance.value || []).length / LIST_PAGE_SIZE.trialBalance)))
const paginatedTrialBalance = computed(() => getPaginatedItems(trialBalance.value, trialBalancePage.value, LIST_PAGE_SIZE.trialBalance))

const recentEntriesTotalPages = computed(() => Math.max(1, Math.ceil((recentEntries.value || []).length / LIST_PAGE_SIZE.recentEntries)))
const paginatedRecentEntries = computed(() => getPaginatedItems(recentEntries.value, recentEntriesPage.value, LIST_PAGE_SIZE.recentEntries))

const obligationsItems = computed(() => compliance.value?.obligations || [])
const obligationsTotalPages = computed(() => Math.max(1, Math.ceil(obligationsItems.value.length / LIST_PAGE_SIZE.obligations)))
const paginatedObligations = computed(() => getPaginatedItems(obligationsItems.value, obligationsPage.value, LIST_PAGE_SIZE.obligations))

const queueTotalPages = computed(() => Math.max(1, Math.ceil((eventQueue.value || []).length / LIST_PAGE_SIZE.queue)))
const paginatedQueueEvents = computed(() => getPaginatedItems(eventQueue.value, queuePage.value, LIST_PAGE_SIZE.queue))

const aiLinesItems = computed(() => {
  const lines = aiResult.value?.entry?.lines || []
  return lines.map((line, index) => ({
    ...line,
    _list_key: `ai-line-${index}`
  }))
})
const aiLinesTotalPages = computed(() => Math.max(1, Math.ceil(aiLinesItems.value.length / LIST_PAGE_SIZE.aiLines)))
const paginatedAiLines = computed(() => getPaginatedItems(aiLinesItems.value, aiLinesPage.value, LIST_PAGE_SIZE.aiLines))

const onTrialBalanceListPage = ({ page }) => {
  trialBalancePage.value = Number(page || 1)
}

const onRecentEntriesListPage = ({ page }) => {
  recentEntriesPage.value = Number(page || 1)
}

const onObligationsListPage = ({ page }) => {
  obligationsPage.value = Number(page || 1)
}

const onQueueListPage = ({ page }) => {
  queuePage.value = Number(page || 1)
}

const onAiLinesListPage = ({ page }) => {
  aiLinesPage.value = Number(page || 1)
}

const isEnabled = computed(() => settings.value.accounting_enabled)
const pendingQueueCount = computed(() => Number(summary.value?.pending_events || 0))
const complianceProgressPercent = computed(() => {
  const max = Number(compliance.value?.readiness_max || 0)
  if (!max) return 0
  const score = Number(compliance.value?.readiness_score || 0)
  return Math.round((score / max) * 100)
})
const modeLabel = computed(() => {
  const mode = settings.value.accounting_mode
  if (mode === 'OFF') return 'OFF'
  if (mode === 'MANUAL') return 'MANUAL'
  return 'ASYNC'
})
const accountingProcess = computed(() => processMap.value.accounting || null)
const accountingSetupHintVisible = computed(() => {
  if (!accountingProcess.value) return false
  return accountingProcess.value.state !== 'OPERATIONAL' || String(route.query.onboarding || '').trim().length > 0
})
const accountingSetupMessage = computed(() => {
  if (!accountingProcess.value) {
    return 'Estamos evaluando el estado contable del tenant.'
  }

  if (accountingProcess.value.state === 'READY_FOR_TEST') {
    return 'La configuracion base ya esta lista. Falta validar un evento o asiento real.'
  }

  return accountingProcess.value.nextStep?.description || accountingProcess.value.onboardingDescription || 'Completa los pasos pendientes para adoptar contabilidad gradualmente.'
})

const resolveTabFromRoute = () => {
  const currentPath = String(route.path || '')
  if (currentPath === '/accounting/dashboard' || currentPath === '/contabilidad/dashboard') return 'dashboard'
  if (currentPath === '/accounting/compliance' || currentPath === '/contabilidad/compliance') return 'compliance'
  if (currentPath === '/accounting/queue' || currentPath === '/contabilidad/queue') return 'queue'
  if (currentPath === '/accounting/assistant' || currentPath === '/contabilidad/asistente-ia') return 'ai'

  const queryTab = String(route.query.tab || '').trim()
  if (['dashboard', 'compliance', 'queue', 'ai'].includes(queryTab)) {
    return queryTab
  }

  return 'dashboard'
}

const formatMoney = (value) => {
  const n = Number(value || 0)
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 2
  }).format(n)
}

const formatDate = (value) => {
  if (!value) return '-'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('es-CO')
}

const getQueueStatusColor = (status) => {
  if (status === 'PROCESSED') return 'success'
  if (status === 'FAILED') return 'error'
  if (status === 'PROCESSING') return 'primary'
  if (status === 'SKIPPED') return 'grey'
  return 'warning'
}

const getComplianceStatusColor = (status) => {
  if (status === 'READY') return 'success'
  if (status === 'ALERT') return 'error'
  if (status === 'PARTIAL') return 'warning'
  return 'grey'
}

const getComplianceStatusLabel = (status) => {
  if (status === 'READY') return 'Listo'
  if (status === 'ALERT') return 'Alerta'
  if (status === 'PARTIAL') return 'Parcial'
  return 'Pendiente'
}

const sanitizeForExport = (value) => {
  if (value === null || value === undefined) return ''
  const str = String(value)
  return /^[=+\-@]/.test(str) ? `'${str}` : str
}

const toCsvValue = (value) => {
  const str = String(value ?? '')
  const escaped = str.replaceAll('"', '""')
  return `"${escaped}"`
}

const downloadCsv = (rows, filename) => {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [
    headers.map(toCsvValue).join(','),
    ...rows.map((row) => headers.map((key) => toCsvValue(row[key])).join(','))
  ].join('\n')

  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

const getDateSuffix = () => {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

const buildTrialBalanceExportRows = () => {
  return (trialBalance.value || []).map((row) => ({
    CuentaCodigo: sanitizeForExport(row.account_code || ''),
    CuentaNombre: sanitizeForExport(row.account_name || ''),
    Tipo: sanitizeForExport(row.account_type || ''),
    Naturaleza: sanitizeForExport(row.natural_side || ''),
    Debitos: Number(row.debit_total || 0),
    Creditos: Number(row.credit_total || 0),
    Saldo: Number(row.balance || 0)
  }))
}

const buildComplianceChecklistExportRows = () => {
  const obligations = (compliance.value?.obligations || []).map((item) => ({
    Categoria: 'Obligacion',
    Item: sanitizeForExport(item.name || ''),
    Frecuencia: sanitizeForExport(item.frequency || ''),
    Significado: sanitizeForExport(item.meaning || ''),
    Estado: sanitizeForExport(getComplianceStatusLabel(item.status)),
    Evidencia: sanitizeForExport(item.evidence || ''),
    Ruta: sanitizeForExport(item.route || '')
  }))

  const reports = (compliance.value?.required_reports || []).map((item) => ({
    Categoria: 'Reporte',
    Item: sanitizeForExport(item.name || ''),
    Frecuencia: '',
    Significado: sanitizeForExport(item.purpose || ''),
    Estado: sanitizeForExport(getComplianceStatusLabel(item.status)),
    Evidencia: '',
    Ruta: sanitizeForExport(item.route || '')
  }))

  return [...obligations, ...reports]
}

const resetLoadedTabs = () => {
  loadedTabs.value = {
    dashboard: false,
    compliance: false,
    queue: false,
    ai: false
  }
}

const resetDataState = () => {
  summary.value = {}
  trialBalance.value = []
  recentEntries.value = []
  eventQueue.value = []
  compliance.value = createEmptyComplianceState()
  aiResult.value = null
}

const loadSettings = async () => {
  if (!tenantId.value) return
  const result = await accountingService.getSettings(tenantId.value)
  if (result.success) {
    settings.value = {
      ...settings.value,
      ...result.data
    }
  }
}

const loadSummary = async () => {
  if (!tenantId.value || !isEnabled.value) return
  const result = await accountingService.getSummary(tenantId.value)
  if (result.success) {
    summary.value = result.data || {}
  }
}

const loadTrialBalance = async () => {
  if (!tenantId.value || !isEnabled.value) return
  const result = await accountingService.getTrialBalance(tenantId.value, filters.value)
  if (result.success) {
    trialBalance.value = result.data || []
  }
}

const loadRecentEntries = async () => {
  if (!tenantId.value || !isEnabled.value) return
  const result = await accountingService.getRecentEntries(tenantId.value, 30)
  if (result.success) {
    recentEntries.value = result.data || []
  }
}

const loadQueue = async () => {
  if (!tenantId.value || !isEnabled.value) return
  const result = await accountingService.getEventQueue(tenantId.value, 80)
  if (result.success) {
    eventQueue.value = result.data || []
  }
}

const loadCompliance = async () => {
  if (!tenantId.value || !isEnabled.value) return
  loadingCompliance.value = true
  try {
    const result = await accountingService.getComplianceSnapshot(tenantId.value, filters.value)
    if (!result.success) {
      show(result.error || 'No se pudo cargar el panel tributario.', 'error')
      return
    }
    compliance.value = result.data || compliance.value
  } finally {
    loadingCompliance.value = false
  }
}

const ensureActiveTabData = async (tab, options = {}) => {
  if (!tenantId.value || !isEnabled.value) return

  const normalizedTab = ['dashboard', 'compliance', 'queue', 'ai'].includes(tab) ? tab : 'dashboard'
  if (!options.force && loadedTabs.value[normalizedTab]) {
    return
  }

  if (normalizedTab === 'dashboard') {
    await Promise.all([
      loadTrialBalance(),
      loadRecentEntries()
    ])
  } else if (normalizedTab === 'compliance') {
    await loadCompliance()
  } else if (normalizedTab === 'queue') {
    await loadQueue()
  } else if (normalizedTab === 'ai') {
    aiResult.value = aiResult.value || null
  }

  loadedTabs.value = {
    ...loadedTabs.value,
    [normalizedTab]: true
  }
}

const loadAll = async () => {
  loading.value = true
  try {
    await loadSetupReadiness()

    if (!tenantId.value) {
      settings.value = createDefaultSettings()
      resetLoadedTabs()
      resetDataState()
      return
    }

    await loadSettings()
    resetLoadedTabs()

    if (!isEnabled.value) {
      resetDataState()
      return
    }

    await loadSummary()
    await ensureActiveTabData(activeTab.value, { force: true })
  } finally {
    loading.value = false
  }
}

const goToCompanyConfig = () => {
  router.push({
    path: '/tenant-config',
    query: {
      tab: 'accounting',
      onboarding: 'accounting-enable'
    }
  })
}

const goToRoute = (route) => {
  if (!route) return

  const shouldAttachAccountingContext = (
    typeof route === 'string' && (
      route.startsWith('/reports') ||
      route === '/accounting/diario' ||
      route === '/accounting/mayor'
    )
  )

  if (shouldAttachAccountingContext) {
    router.push({
      path: route,
      query: {
        from: 'accounting',
        tab: activeTab.value
      }
    })
    return
  }

  router.push(route)
}

const scrollToSection = (id) => {
  if (!id) return
  const element = document.getElementById(id)
  if (!element) return
  element.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

const openComplianceItem = async (item) => {
  if (!item) return
  goToRoute(item.route)
}

const openRequiredReport = async (report) => {
  if (!report) return

  if (report.key === 'trial_balance') {
    activeTab.value = 'dashboard'
    await nextTick()
    scrollToSection('trial-balance-section')
    return
  }

  goToRoute(report.route)
}

const reloadCompliance = async () => {
  await Promise.all([
    loadCompliance(),
    loadTrialBalance()
  ])
  loadedTabs.value = {
    ...loadedTabs.value,
    dashboard: true,
    compliance: true
  }
}

const exportTrialBalanceXlsx = async () => {
  if (!trialBalance.value.length) return
  exportingTrialBalanceXlsx.value = true
  try {
    const rows = buildTrialBalanceExportRows()
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'Balanza')
    writeFileXLSX(wb, `balanza_comprobacion_${getDateSuffix()}.xlsx`)
  } catch (error) {
    show(error.message || 'No se pudo exportar la balanza en XLSX.', 'error')
  } finally {
    exportingTrialBalanceXlsx.value = false
  }
}

const exportTrialBalanceCsv = async () => {
  if (!trialBalance.value.length) return
  exportingTrialBalanceCsv.value = true
  try {
    const rows = buildTrialBalanceExportRows()
    downloadCsv(rows, `balanza_comprobacion_${getDateSuffix()}.csv`)
  } catch (error) {
    show(error.message || 'No se pudo exportar la balanza en CSV.', 'error')
  } finally {
    exportingTrialBalanceCsv.value = false
  }
}

const exportComplianceChecklistXlsx = async () => {
  exportingComplianceXlsx.value = true
  try {
    const rows = buildComplianceChecklistExportRows()
    if (!rows.length) {
      show('No hay datos de obligaciones/reportes para exportar.', 'warning')
      return
    }
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, 'ChecklistDIAN')
    writeFileXLSX(wb, `checklist_contable_dian_${getDateSuffix()}.xlsx`)
  } catch (error) {
    show(error.message || 'No se pudo exportar checklist en XLSX.', 'error')
  } finally {
    exportingComplianceXlsx.value = false
  }
}

const exportComplianceChecklistCsv = async () => {
  exportingComplianceCsv.value = true
  try {
    const rows = buildComplianceChecklistExportRows()
    if (!rows.length) {
      show('No hay datos de obligaciones/reportes para exportar.', 'warning')
      return
    }
    downloadCsv(rows, `checklist_contable_dian_${getDateSuffix()}.csv`)
  } catch (error) {
    show(error.message || 'No se pudo exportar checklist en CSV.', 'error')
  } finally {
    exportingComplianceCsv.value = false
  }
}

const processPendingQueue = async () => {
  if (!tenantId.value) return

  processingQueue.value = true
  try {
    const result = await accountingService.processQueue(tenantId.value, { limit: 100 })
    if (!result.success) {
      show(result.error || 'No se pudo procesar la cola contable.', 'error')
      return
    }

    const payload = result.data || {}
    show(
      `Cola procesada: ${payload.processed || 0} procesados, ${payload.failed || 0} fallidos, ${payload.skipped || 0} omitidos.`,
      'success'
    )

    const refreshTasks = [
      loadSummary(),
      loadQueue()
    ]

    if (loadedTabs.value.dashboard) {
      refreshTasks.push(loadRecentEntries(), loadTrialBalance())
    }

    if (loadedTabs.value.compliance) {
      refreshTasks.push(loadCompliance())
    }

    await Promise.all(refreshTasks)
    await loadSetupReadiness()
    loadedTabs.value = {
      ...loadedTabs.value,
      dashboard: loadedTabs.value.dashboard,
      compliance: loadedTabs.value.compliance,
      queue: true
    }
  } finally {
    processingQueue.value = false
  }
}

const generateAISuggestion = async () => {
  if (!tenantId.value) return
  aiResult.value = null

  aiLoading.value = true
  try {
    const result = await accountingService.requestAIAssistant({
      tenantId: tenantId.value,
      prompt: aiPrompt.value
    })

    if (!result.success) {
      show(result.error || 'No se pudo generar sugerencia IA.', 'error')
      return
    }

    aiResult.value = result.data
    show('Sugerencia IA generada.', 'success')
  } finally {
    aiLoading.value = false
  }
}

watch(() => trialBalance.value.length, () => {
  trialBalancePage.value = 1
})

watch(() => recentEntries.value.length, () => {
  recentEntriesPage.value = 1
})

watch(() => obligationsItems.value.length, () => {
  obligationsPage.value = 1
})

watch(() => eventQueue.value.length, () => {
  queuePage.value = 1
})

watch(() => aiLinesItems.value.length, () => {
  aiLinesPage.value = 1
})

watch(activeTab, (nextTab, previousTab) => {
  if (nextTab === previousTab) return
  ensureActiveTabData(nextTab)
})

watch(trialBalanceTotalPages, (total) => {
  if (trialBalancePage.value > total) trialBalancePage.value = total
})

watch(recentEntriesTotalPages, (total) => {
  if (recentEntriesPage.value > total) recentEntriesPage.value = total
})

watch(obligationsTotalPages, (total) => {
  if (obligationsPage.value > total) obligationsPage.value = total
})

watch(queueTotalPages, (total) => {
  if (queuePage.value > total) queuePage.value = total
})

watch(aiLinesTotalPages, (total) => {
  if (aiLinesPage.value > total) aiLinesPage.value = total
})

onMounted(() => {
  activeTab.value = resolveTabFromRoute()
  loadAll()
})

watch(
  () => [route.path, route.query.tab],
  () => {
    const nextTab = resolveTabFromRoute()
    if (activeTab.value !== nextTab) {
      activeTab.value = nextTab
      return
    }
    ensureActiveTabData(nextTab)
  }
)

watch(() => tenantId.value, (nextTenantId, previousTenantId) => {
  if (nextTenantId === previousTenantId) return
  loadAll()
})
</script>
