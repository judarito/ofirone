export const helpProcesses = [
  { id: 'getting-started', title: 'Primeros pasos', icon: 'mdi-rocket-launch-outline', color: 'primary' },
  { id: 'sales', title: 'Ventas', icon: 'mdi-point-of-sale', color: 'secondary' },
  { id: 'purchases', title: 'Compras', icon: 'mdi-cart-plus', color: 'deep-orange' },
  { id: 'cash', title: 'Caja', icon: 'mdi-cash-register', color: 'success' },
  { id: 'inventory', title: 'Inventario', icon: 'mdi-warehouse', color: 'info' },
  { id: 'accounting', title: 'Contabilidad', icon: 'mdi-scale-balance', color: 'purple' }
]

export const helpArticles = [
  {
    slug: 'primeros-pasos',
    process: 'getting-started',
    title: 'Primeros pasos en OfirOne',
    summary: 'Guia de arranque para dejar la empresa lista para vender, comprar, operar caja y controlar inventario.',
    audience: 'Administrador del tenant',
    estimatedMinutes: 15,
    prerequisites: [
      'Tener acceso al tenant correcto.',
      'Validar que la empresa, la sede principal y la caja principal existan.',
      'Contar con al menos un usuario administrador activo.'
    ],
    steps: [
      {
        id: 'company',
        title: 'Completa datos de empresa',
        description: 'Revisa nombre comercial, prefijo, idioma y configuraciones generales para que recibos y documentos salgan correctamente.',
        route: { path: '/tenant-config', query: { tab: 'general' } }
      },
      {
        id: 'catalog',
        title: 'Carga productos y variantes',
        description: 'Crea manualmente tu catalogo o usa cargue masivo si ya tienes un archivo base.',
        route: { path: '/products', query: { tab: 'products', onboarding: 'sales-products', action: 'create-product' } }
      },
      {
        id: 'cash',
        title: 'Deja una caja lista para operar',
        description: 'Configura caja, asignacion y una sesion de prueba para evitar bloqueos en el POS.',
        route: '/cash-sessions'
      },
      {
        id: 'inventory',
        title: 'Carga stock inicial',
        description: 'Ingresa inventario desde compras, operaciones de inventario o cargue masivo.',
        route: { path: '/inventory', query: { tab: 'operations', onboarding: 'inventory-stock' } }
      },
      {
        id: 'first-sale',
        title: 'Haz una venta de prueba',
        description: 'Registra una venta corta para confirmar que el flujo completo ya esta operativo.',
        route: '/pos'
      }
    ],
    nextSteps: [
      'Abre la guia de ventas para entrenar al equipo de caja.',
      'Carga inventario inicial si aun no has ingresado existencias.',
      'Si vas a usar contabilidad, activala solo despues de estabilizar la operacion comercial.'
    ],
    expectedResult: 'La empresa queda operativa para hacer la primera venta y registrar entradas de inventario sin depender de soporte.',
    commonErrors: [
      {
        title: 'No aparecen productos en POS',
        answer: 'Verifica que el producto tenga al menos una variante activa y que el inventario o la configuracion del catalogo ya este cargada.'
      },
      {
        title: 'No puedo abrir caja',
        answer: 'Confirma que exista una caja activa y que el usuario tenga asignacion vigente.'
      }
    ],
    faqIds: ['faq-no-veo-menu', 'faq-no-stock-pos'],
    related: ['ventas-operacion', 'inventario-operacion', 'caja-operacion']
  },
  {
    slug: 'ventas-operacion',
    process: 'sales',
    title: 'Como registrar una venta',
    summary: 'Recorre el flujo recomendado para buscar productos, agregar pagos y cobrar sin friccion.',
    audience: 'Cajero, administrador y gerente',
    estimatedMinutes: 8,
    prerequisites: [
      'Caja abierta o lista para abrir.',
      'Productos con variantes activas.',
      'Medios de pago configurados.'
    ],
    steps: [
      {
        id: 'open-pos',
        title: 'Abre el Punto de Venta',
        description: 'Entra al POS desde el dashboard o desde el menu lateral.',
        route: '/pos'
      },
      {
        id: 'find-product',
        title: 'Busca por codigo, SKU o nombre',
        description: 'Usa el buscador superior para localizar la variante correcta y agregarla al carrito.',
        route: '/pos'
      },
      {
        id: 'check-customer',
        title: 'Asocia cliente solo cuando aplique',
        description: 'Si la venta va a credito o requiere datos del cliente, selecciona el cliente antes de cobrar.',
        route: '/pos'
      },
      {
        id: 'payments',
        title: 'Completa los pagos',
        description: 'Revisa que el total quede cubierto por los metodos de pago antes de confirmar.',
        route: '/pos'
      },
      {
        id: 'charge',
        title: 'Cobra y valida el comprobante',
        description: 'Haz clic en Cobrar y revisa que la venta quede registrada en historico.',
        route: '/sales'
      }
    ],
    nextSteps: [
      'Revisa ventas historicas para validar que los comprobantes esten saliendo como esperas.',
      'Entrena al equipo en apertura y cierre de caja para evitar bloqueos.',
      'Si vendes a credito, configura clientes y cupos antes de masificar el proceso.'
    ],
    expectedResult: 'La venta queda en historico, el inventario se mueve y la caja registra correctamente el pago.',
    commonErrors: [
      {
        title: 'El boton Cobrar no se activa',
        answer: 'Normalmente falta completar pagos, hay saldo pendiente o la sesion de caja no esta activa.'
      },
      {
        title: 'No encuentra el producto',
        answer: 'Confirma SKU, nombre o codigo de barras y valida que la variante este activa.'
      }
    ],
    faqIds: ['faq-no-stock-pos', 'faq-cobrar-inactivo'],
    related: ['primeros-pasos', 'caja-operacion', 'inventario-operacion']
  },
  {
    slug: 'compras-operacion',
    process: 'purchases',
    title: 'Como registrar una compra',
    summary: 'Guia para abastecer inventario, asociar proveedor y dejar el costo correctamente registrado.',
    audience: 'Compras, bodega, administrador',
    estimatedMinutes: 10,
    prerequisites: [
      'Proveedor creado o identificado.',
      'Sede de recepcion definida.',
      'Productos y variantes ya cargados.'
    ],
    steps: [
      {
        id: 'new-purchase',
        title: 'Crea una nueva compra',
        description: 'Desde el modulo de compras abre el formulario de Nueva Compra.',
        route: '/purchases'
      },
      {
        id: 'supplier',
        title: 'Selecciona sede y proveedor',
        description: 'La compra debe quedar asociada al lugar donde entra la mercancia y a su proveedor.',
        route: '/purchases'
      },
      {
        id: 'lines',
        title: 'Agrega las lineas de compra',
        description: 'Busca la variante, define cantidad y costo unitario por cada item.',
        route: '/purchases'
      },
      {
        id: 'save',
        title: 'Guarda y revisa el detalle',
        description: 'Confirma que la compra quede visible en historico y con sus datos completos.',
        route: '/purchases'
      },
      {
        id: 'verify-stock',
        title: 'Verifica el impacto en inventario',
        description: 'Revisa stock o kardex para confirmar que la entrada de inventario fue aplicada.',
        route: { path: '/inventory', query: { tab: 'kardex', onboarding: 'inventory-proof' } }
      }
    ],
    nextSteps: [
      'Verifica kardex o stock para confirmar la entrada de inventario.',
      'Si manejas cuentas por pagar, revisa el tablero de proveedores despues de guardar.',
      'Usa cargue masivo si vas a registrar muchas referencias nuevas.'
    ],
    expectedResult: 'La compra queda registrada, el costo unitario se conserva y el inventario aumenta en la sede correspondiente.',
    commonErrors: [
      {
        title: 'No sale el proveedor en la lista',
        answer: 'Revisa que el tercero este activo y marcado como proveedor o mixto.'
      },
      {
        title: 'No puedo guardar la compra',
        answer: 'Valida cantidades, costos y que todas las lineas tengan una variante seleccionada.'
      }
    ],
    faqIds: ['faq-supplier-not-found', 'faq-stock-no-update'],
    related: ['inventario-operacion', 'primeros-pasos']
  },
  {
    slug: 'caja-operacion',
    process: 'cash',
    title: 'Como abrir, operar y cerrar caja',
    summary: 'Checklist operativo para evitar bloqueos de caja y dejar trazabilidad de sesiones. Las cajas operan mediante sesiones que deben abrirse y cerrarse.',
    audience: 'Cajero, administrador y gerente',
    estimatedMinutes: 7,
    prerequisites: [
      'Caja registrada.',
      'Usuario asignado a caja.',
      'Monto base o politica operativa definida.',
      'Tener claro el parametro `cash_session_max_hours`, que define cuantas horas maximo puede durar abierta una sesion antes de marcarse como vencida.'
    ],
    steps: [
      {
        id: 'open-session',
        title: 'Abre una sesion',
        description: 'Ingresa el monto inicial y confirma que la caja quede abierta. Sin una sesion abierta, la caja no puede operar ventas.',
        route: '/cash-sessions'
      },
      {
        id: 'operate-pos',
        title: 'Opera normalmente desde POS',
        description: 'Mientras la sesion este activa, las ventas se amarran a la caja actual. Si supera el limite de horas configurado, la sesion se marca como vencida.',
        route: '/pos'
      },
      {
        id: 'review-movements',
        title: 'Revisa arqueos y movimientos',
        description: 'Antes de cerrar, verifica efectivo, medios de pago y diferencias para detectar inconsistencias antes del cierre.',
        route: '/cash-sessions'
      },
      {
        id: 'close-session',
        title: 'Cierra caja al final del turno',
        description: 'El cierre ayuda a evitar sesiones abiertas por demasiado tiempo, respeta el limite configurado en tenant settings y deja control del turno.',
        route: '/cash-sessions'
      },
      {
        id: 'session-hours-setting',
        title: 'Revisa el maximo de horas por sesion',
        description: 'En Configuracion de Empresa existe el parametro `cash_session_max_hours`, que define cuantas horas puede permanecer abierta una sesion antes de considerarse vencida.',
        route: { path: '/tenant-config', query: { tab: 'general' } }
      }
    ],
    nextSteps: [
      'Haz una venta de prueba para validar la caja actual.',
      'Controla sesiones abiertas desde el dashboard para evitar turnos mal cerrados.',
      'Asegura que el equipo entienda cuando cerrar y reabrir una sesion.',
      'Define con administracion cuantas horas maximo debe durar una sesion de caja para este tenant.'
    ],
    expectedResult: 'La caja queda abierta solo el tiempo necesario, con trazabilidad de aperturas, ventas y cierres.',
    commonErrors: [
      {
        title: 'El POS dice Sin caja abierta',
        answer: 'Abre una sesion o valida que el usuario este asignado a una caja activa.'
      },
      {
        title: 'La sesion aparece expirada',
        answer: 'La empresa tiene un limite de horas para sesiones controlado por el parametro `cash_session_max_hours` en Configuracion de Empresa. Cierra la sesion actual y abre una nueva.'
      },
      {
        title: 'La caja estuvo abierta mas horas de las permitidas',
        answer: 'Revisa el parametro `cash_session_max_hours` a nivel tenant. Si el limite es correcto, el equipo debe cerrar la sesion al terminar el turno y abrir una nueva cuando corresponda.'
      }
    ],
    faqIds: ['faq-no-cash-session', 'faq-session-expired', 'faq-cash-session-hours'],
    related: ['ventas-operacion', 'primeros-pasos']
  },
  {
    slug: 'inventario-operacion',
    process: 'inventory',
    title: 'Como cargar y revisar inventario',
    summary: 'Explica como ingresar stock, hacer ajustes y validar movimientos en kardex.',
    audience: 'Bodega, compras, administrador',
    estimatedMinutes: 10,
    prerequisites: [
      'Productos inventariables activos.',
      'Variantes activas.',
      'Sedes definidas.'
    ],
    steps: [
      {
        id: 'catalog-ready',
        title: 'Asegura productos y variantes',
        description: 'El inventario se mueve por variantes. Revisa el catalogo antes de cargar stock.',
        route: { path: '/products', query: { tab: 'products', onboarding: 'inventory-variants' } }
      },
      {
        id: 'load-stock',
        title: 'Elige como cargar stock',
        description: 'Puedes hacerlo desde compras, desde operaciones de inventario o por cargue masivo.',
        route: { path: '/inventory', query: { tab: 'operations', onboarding: 'inventory-stock' } }
      },
      {
        id: 'manual-adjust',
        title: 'Usa ajustes o traslados cuando aplique',
        description: 'Los ajustes corrigen diferencias y los traslados mueven inventario entre sedes.',
        route: { path: '/inventory', query: { tab: 'operations', onboarding: 'inventory-stock' } }
      },
      {
        id: 'bulk-import',
        title: 'Aprovecha el cargue masivo',
        description: 'Si vienes de otra herramienta, sube productos y variantes con stock inicial desde Excel.',
        route: { path: '/bulk-imports', query: { type: 'product_variants', onboarding: 'inventory-import' } }
      },
      {
        id: 'kardex',
        title: 'Verifica el kardex',
        description: 'Despues de cualquier entrada o salida, revisa el kardex para validar cantidades y costos.',
        route: { path: '/inventory', query: { tab: 'kardex', onboarding: 'inventory-proof' } }
      }
    ],
    nextSteps: [
      'Revisa stock por sede despues de cualquier ajuste o compra.',
      'Usa kardex como verificacion final de cantidades y costos.',
      'Si vienes de otro sistema, aprovecha el cargue masivo para acelerar el arranque.'
    ],
    expectedResult: 'El stock por sede queda confiable y el kardex refleja compras, ajustes y traslados.',
    commonErrors: [
      {
        title: 'El stock no cambia despues de cargar inventario',
        answer: 'Revisa que la operacion se haya guardado correctamente y luego valida el kardex por sede.'
      },
      {
        title: 'No encuentro la variante en operaciones',
        answer: 'Confirma que la variante este activa y que el buscador tenga al menos dos caracteres.'
      }
    ],
    faqIds: ['faq-stock-no-update', 'faq-no-stock-pos'],
    related: ['compras-operacion', 'ventas-operacion', 'primeros-pasos']
  },
  {
    slug: 'contabilidad-operacion',
    process: 'accounting',
    title: 'Como activar y operar contabilidad',
    summary: 'Adopcion gradual del modulo contable para no bloquear la operacion comercial.',
    audience: 'Contador, administrador, gerente',
    estimatedMinutes: 12,
    prerequisites: [
      'Modulo contable habilitado en configuracion de empresa.',
      'Cuentas base creadas.',
      'Entender si el posteo sera manual o automatico.'
    ],
    steps: [
      {
        id: 'enable',
        title: 'Activa el modulo contable',
        description: 'Habilita contabilidad solo cuando la empresa ya tenga claro su flujo operativo.',
        route: { path: '/tenant-config', query: { tab: 'accounting', onboarding: 'accounting-enable' } }
      },
      {
        id: 'chart',
        title: 'Configura el plan de cuentas base',
        description: 'Define las cuentas necesarias para ventas, compras y otras operaciones clave.',
        route: { path: '/accounting/plan-cuentas', query: { from: 'help-center' } }
      },
      {
        id: 'automation',
        title: 'Define automatizacion',
        description: 'Decide si ventas y compras generaran efectos contables automaticamente o si el equipo los posteara luego.',
        route: { path: '/tenant-config', query: { tab: 'accounting', onboarding: 'accounting-automation' } }
      },
      {
        id: 'queue',
        title: 'Valida la cola contable',
        description: 'Revisa que los eventos del POS y compras se procesen correctamente.',
        route: { path: '/accounting', query: { tab: 'queue', onboarding: 'accounting-proof' } }
      },
      {
        id: 'reports',
        title: 'Consulta libros y reportes',
        description: 'Usa diario, mayor y balanza para la revision del equipo contable.',
        route: '/accounting/diario'
      }
    ],
    nextSteps: [
      'Configura automatizacion solo cuando el plan de cuentas este estable.',
      'Revisa la cola contable con una operacion real antes de masificar el uso.',
      'Entrena al contador en diario, mayor y balanza como flujo de revision.'
    ],
    expectedResult: 'La empresa puede operar POS y compras sin friccion mientras la contabilidad se adopta de forma segura y verificable.',
    commonErrors: [
      {
        title: 'No veo nada de contabilidad',
        answer: 'Si la contabilidad esta desactivada en configuracion de empresa, el modulo no debe mostrarse ni afectar el onboarding.'
      },
      {
        title: 'Hay eventos pendientes en cola',
        answer: 'Revisa plan de cuentas, automatizacion y errores del evento antes de reprocesar.'
      }
    ],
    faqIds: ['faq-accounting-hidden', 'faq-accounting-queue'],
    related: ['primeros-pasos']
  }
]

export const helpFaqs = [
  {
    id: 'faq-no-veo-menu',
    process: 'getting-started',
    question: 'No veo el menu o me carga incompleto.',
    answer: 'Confirma que el usuario tenga rol y permisos asignados. Si es superadmin, entrara con un menu diferente orientado a tenants. Si es usuario de tenant, revisa tambien que el perfil este asociado al tenant correcto.'
  },
  {
    id: 'faq-no-stock-pos',
    process: 'sales',
    question: 'El producto aparece pero no tiene stock en POS.',
    answer: 'Valida el stock por sede en Inventario, confirma que la variante este activa y revisa si el producto controla inventario o permite backorder.'
  },
  {
    id: 'faq-cobrar-inactivo',
    process: 'sales',
    question: 'El boton Cobrar sigue desactivado.',
    answer: 'Revisa que el total quede cubierto por medios de pago, que no haya errores de credito y que la sesion de caja siga activa.'
  },
  {
    id: 'faq-supplier-not-found',
    process: 'purchases',
    question: 'No aparece el proveedor en compras.',
    answer: 'Verifica que el tercero este activo y que su tipo sea proveedor o mixto. Si lo acabas de crear, refresca la busqueda.'
  },
  {
    id: 'faq-stock-no-update',
    process: 'inventory',
    question: 'Registre una compra o ajuste y el stock no cambio.',
    answer: 'Revisa kardex, sede, variante y si la operacion se guardo sin errores. En compras, confirma que las lineas se hayan procesado completamente.'
  },
  {
    id: 'faq-no-cash-session',
    process: 'cash',
    question: 'El sistema dice que no hay caja abierta.',
    answer: 'Abre una sesion en Caja y valida que el usuario este asignado a una caja activa.'
  },
  {
    id: 'faq-session-expired',
    process: 'cash',
    question: 'La sesion de caja aparece expirada.',
    answer: 'La empresa define un maximo de horas por sesion mediante `cash_session_max_hours` en Configuracion de Empresa. Si una sesion supera ese tiempo, se marca como vencida y debe cerrarse para abrir una nueva.'
  },
  {
    id: 'faq-cash-session-hours',
    process: 'cash',
    question: 'Donde se define cuantas horas puede durar abierta una sesion de caja.',
    answer: 'Ese limite se configura a nivel de tenant en Configuracion de Empresa, con el parametro `cash_session_max_hours`. Si el valor es 24, cualquier sesion que supere 24 horas se considera vencida.'
  },
  {
    id: 'faq-accounting-hidden',
    process: 'accounting',
    question: 'No aparece el modulo contable.',
    answer: 'Cuando la contabilidad esta desactivada en Configuracion de Empresa, no debe mostrarse nada del modulo contable ni en onboarding ni en menu.'
  },
  {
    id: 'faq-accounting-queue',
    process: 'accounting',
    question: 'Hay eventos pendientes o con error en la cola contable.',
    answer: 'Revisa si faltan cuentas base, si la automatizacion aplica al tipo de evento o si el periodo contable esta listo. Luego reprocesa desde la cola.'
  }
]

export const helpContexts = {
  home: {
    title: 'Empieza por el resultado, no por el menu',
    summary: 'Usa el manual guiado para dejar la empresa operativa sin perderte entre configuraciones.',
    icon: 'mdi-compass-outline',
    color: 'primary',
    featuredArticle: 'primeros-pasos',
    quickTips: [
      'Completa empresa, catalogo, caja e inventario inicial.',
      'Haz una venta de prueba para validar el arranque.',
      'Usa el asistente de configuracion si aun faltan pasos esenciales.'
    ],
    faqIds: ['faq-no-veo-menu']
  },
  pos: {
    title: 'Ayuda rapida para vender',
    summary: 'Si el equipo necesita apoyo en caja, esta guia resuelve el flujo de punta a punta.',
    icon: 'mdi-point-of-sale',
    color: 'secondary',
    featuredArticle: 'ventas-operacion',
    quickTips: [
      'Busca por SKU, codigo o nombre.',
      'Confirma pagos antes de cobrar.',
      'Si no puedes cobrar, revisa caja y saldo pendiente.'
    ],
    faqIds: ['faq-cobrar-inactivo', 'faq-no-stock-pos']
  },
  purchases: {
    title: 'Ayuda rapida para compras',
    summary: 'Ideal para registrar abastecimiento sin afectar inventario ni costos.',
    icon: 'mdi-cart-plus',
    color: 'deep-orange',
    featuredArticle: 'compras-operacion',
    quickTips: [
      'Selecciona sede y proveedor antes de agregar lineas.',
      'Cada linea necesita variante, cantidad y costo.',
      'Valida kardex despues de guardar.'
    ],
    faqIds: ['faq-supplier-not-found', 'faq-stock-no-update']
  },
  inventory: {
    title: 'Ayuda rapida para inventario',
    summary: 'Explica cuando cargar stock por compra, ajuste, traslado o Excel.',
    icon: 'mdi-warehouse',
    color: 'info',
    featuredArticle: 'inventario-operacion',
    quickTips: [
      'El stock se mueve por variantes.',
      'Operaciones sirve para ajustes y traslados.',
      'Kardex es la verificacion final.'
    ],
    faqIds: ['faq-stock-no-update', 'faq-no-stock-pos']
  },
  accounting: {
    title: 'Ayuda rapida para contabilidad',
    summary: 'Usa esta guia para activar el modulo contable sin bloquear POS ni compras.',
    icon: 'mdi-scale-balance',
    color: 'purple',
    featuredArticle: 'contabilidad-operacion',
    quickTips: [
      'Activa contabilidad solo cuando la empresa este lista.',
      'Configura cuentas base antes de automatizar.',
      'Revisa la cola cuando algo no postee.'
    ],
    faqIds: ['faq-accounting-hidden', 'faq-accounting-queue']
  }
}
