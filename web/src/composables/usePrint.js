import { ref } from 'vue'
import jsPDF from 'jspdf'
import 'jspdf-autotable'

export function usePrint() {
  const printing = ref(false)

  // Formatear dinero
  const formatMoney = (value) => {
    if (!value && value !== 0) return '$0'
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  }

  // Formatear fecha
  const formatDate = (date) => {
    if (!date) return ''
    return new Date(date).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  // Imprimir Ticket de Venta (Térmica 80mm)
  const printSaleTicket = (sale, tenant) => {
    printing.value = true

    const content = `
      <div style="width: 300px; font-family: 'Courier New', monospace; font-size: 12px; padding: 10px;">
        <div style="text-align: center; margin-bottom: 10px;">
          <h2 style="margin: 0; font-size: 16px;">${tenant?.name || 'OfirOne'}</h2>
          <div>${tenant?.tax_id || ''}</div>
          <div>${tenant?.address || ''}</div>
          <div>${tenant?.phone || ''}</div>
        </div>
        
        <div style="border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 5px 0; margin: 10px 0;">
          <div><strong>FACTURA DE VENTA #${sale.sale_number}</strong></div>
          <div>${formatDate(sale.sold_at)}</div>
          <div>Vendedor: ${sale.sold_by_user?.full_name || ''}</div>
          <div>Cliente: ${sale.customer?.full_name || 'Consumidor Final'}</div>
          <div>Sede: ${sale.location?.name || ''}</div>
        </div>

        <table style="width: 100%; font-size: 11px;">
          <thead>
            <tr style="border-bottom: 1px dashed #000;">
              <th style="text-align: left;">Producto</th>
              <th style="text-align: center;">Cant</th>
              <th style="text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${sale.sale_lines?.map(line => `
              <tr>
                <td style="padding: 3px 0;">
                  ${line.variant?.product?.name || ''}
                  ${line.variant?.variant_name ? '<br><small>' + line.variant.variant_name + '</small>' : ''}
                </td>
                <td style="text-align: center;">${line.quantity}</td>
                <td style="text-align: right;">${formatMoney(line.line_total)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <div style="border-top: 1px dashed #000; margin-top: 10px; padding-top: 5px;">
          <div style="display: flex; justify-content: space-between;">
            <span>Subtotal:</span>
            <span>${formatMoney(sale.subtotal)}</span>
          </div>
          ${sale.discount_total > 0 ? `
            <div style="display: flex; justify-content: space-between;">
              <span>Descuento:</span>
              <span>-${formatMoney(sale.discount_total)}</span>
            </div>
          ` : ''}
          <div style="display: flex; justify-content: space-between;">
            <span>Impuestos:</span>
            <span>${formatMoney(sale.tax_total)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 14px; font-weight: bold; border-top: 1px solid #000; margin-top: 5px; padding-top: 5px;">
            <span>TOTAL:</span>
            <span>${formatMoney(sale.total)}</span>
          </div>
        </div>

        ${sale.sale_payments?.length > 0 ? `
          <div style="border-top: 1px dashed #000; margin-top: 10px; padding-top: 5px;">
            <div><strong>Pagos:</strong></div>
            ${sale.sale_payments.map(p => `
              <div style="display: flex; justify-content: space-between; padding: 2px 0;">
                <span>${p.payment_method?.name || ''}</span>
                <span>${formatMoney(p.amount)}</span>
              </div>
            `).join('')}
          </div>
        ` : ''}

        <div style="text-align: center; margin-top: 15px; font-size: 10px;">
          <div>¡Gracias por su compra!</div>
          <div style="margin-top: 5px;">www.poslite.com</div>
        </div>
      </div>
    `

    const printWindow = window.open('', '', 'width=400,height=600')
    printWindow.document.write(`
      <html>
        <head>
          <title>Factura #${sale.sale_number}</title>
          <style>
            @media print {
              body { margin: 0; }
              @page { margin: 0; size: 80mm auto; }
            }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
      printing.value = false
    }, 250)
  }

  // Imprimir Recibo de Abono
  const printPaymentReceipt = (payment, contract, tenant) => {
    printing.value = true

    const content = `
      <div style="width: 300px; font-family: 'Courier New', monospace; font-size: 12px; padding: 10px;">
        <div style="text-align: center; margin-bottom: 10px;">
          <h2 style="margin: 0; font-size: 16px;">${tenant?.name || 'OfirOne'}</h2>
          <div>${tenant?.tax_id || ''}</div>
          <div>${tenant?.address || ''}</div>
          <div>${tenant?.phone || ''}</div>
        </div>
        
        <div style="border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 5px 0; margin: 10px 0;">
          <div style="text-align: center;"><strong>RECIBO DE ABONO</strong></div>
          <div>${formatDate(payment.paid_at)}</div>
          <div>Plan Separe: ${contract.layaway_id?.substring(0, 8)}</div>
        </div>

        <div style="margin: 10px 0;">
          <div><strong>Cliente:</strong></div>
          <div>${contract.customer?.full_name || ''}</div>
          ${contract.customer?.document ? `<div>Doc: ${contract.customer.document}</div>` : ''}
          ${contract.customer?.phone ? `<div>Tel: ${contract.customer.phone}</div>` : ''}
        </div>

        <div style="border-top: 1px dashed #000; margin-top: 10px; padding-top: 5px;">
          <div style="display: flex; justify-content: space-between; padding: 3px 0;">
            <span>Total Contrato:</span>
            <span>${formatMoney(contract.total)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0;">
            <span>Pagado Anterior:</span>
            <span>${formatMoney(contract.paid_total - payment.amount)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-weight: bold; font-size: 14px;">
            <span>ABONO:</span>
            <span>${formatMoney(payment.amount)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0; border-top: 1px solid #000; margin-top: 5px; padding-top: 5px;">
            <span>Pagado Total:</span>
            <span>${formatMoney(contract.paid_total)}</span>
          </div>
          <div style="display: flex; justify-content: space-between; padding: 3px 0; font-weight: bold;">
            <span>Saldo Pendiente:</span>
            <span>${formatMoney(contract.balance)}</span>
          </div>
        </div>

        <div style="border-top: 1px dashed #000; margin-top: 10px; padding-top: 5px;">
          <div><strong>Método de Pago:</strong></div>
          <div>${payment.payment_method?.name || ''}</div>
          ${payment.reference ? `<div>Ref: ${payment.reference}</div>` : ''}
        </div>

        ${contract.due_date ? `
          <div style="margin-top: 10px; text-align: center; font-size: 11px;">
            <div><strong>Fecha límite:</strong></div>
            <div>${formatDate(contract.due_date)}</div>
          </div>
        ` : ''}

        <div style="text-align: center; margin-top: 15px; font-size: 10px;">
          <div>¡Gracias por su pago!</div>
          <div style="margin-top: 5px;">www.poslite.com</div>
        </div>
      </div>
    `

    const printWindow = window.open('', '', 'width=400,height=600')
    printWindow.document.write(`
      <html>
        <head>
          <title>Recibo de Abono</title>
          <style>
            @media print {
              body { margin: 0; }
              @page { margin: 0; size: 80mm auto; }
            }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `)
    printWindow.document.close()
    printWindow.focus()
    
    setTimeout(() => {
      printWindow.print()
      printWindow.close()
      printing.value = false
    }, 250)
  }

  // Imprimir Contrato de Plan Separe (PDF Carta)
  const printLayawayContract = (contract, tenant) => {
    printing.value = true

    try {
      const doc = new jsPDF()
      
      // Encabezado
      doc.setFontSize(18)
      doc.setFont(undefined, 'bold')
      doc.text(tenant?.name || 'OfirOne', 105, 20, { align: 'center' })
      
      doc.setFontSize(10)
      doc.setFont(undefined, 'normal')
      doc.text(tenant?.tax_id || '', 105, 27, { align: 'center' })
      doc.text(tenant?.address || '', 105, 32, { align: 'center' })
      doc.text(tenant?.phone || '', 105, 37, { align: 'center' })

      // Título
      doc.setFontSize(14)
      doc.setFont(undefined, 'bold')
      doc.text('CONTRATO DE PLAN SEPARE', 105, 50, { align: 'center' })

      // Info del contrato
      doc.setFontSize(10)
      doc.setFont(undefined, 'normal')
      let yPos = 60
      
      doc.text(`Contrato No: ${contract.layaway_id?.substring(0, 8)}`, 20, yPos)
      doc.text(`Fecha: ${formatDate(contract.created_at)}`, 120, yPos)
      yPos += 7
      doc.text(`Sede: ${contract.location?.name || ''}`, 20, yPos)
      if (contract.due_date) {
        doc.text(`Vence: ${formatDate(contract.due_date)}`, 120, yPos)
      }
      yPos += 10

      // Datos del cliente
      doc.setFont(undefined, 'bold')
      doc.text('DATOS DEL CLIENTE', 20, yPos)
      yPos += 7
      doc.setFont(undefined, 'normal')
      doc.text(`Nombre: ${contract.customer?.full_name || ''}`, 20, yPos)
      yPos += 6
      if (contract.customer?.document) {
        doc.text(`Documento: ${contract.customer.document}`, 20, yPos)
        yPos += 6
      }
      if (contract.customer?.phone) {
        doc.text(`Teléfono: ${contract.customer.phone}`, 20, yPos)
        yPos += 6
      }
      if (contract.customer?.email) {
        doc.text(`Email: ${contract.customer.email}`, 20, yPos)
        yPos += 6
      }
      yPos += 5

      // Productos
      doc.setFont(undefined, 'bold')
      doc.text('PRODUCTOS', 20, yPos)
      yPos += 7

      const tableData = contract.layaway_items?.map(item => [
        `${item.variant?.product?.name || ''}\n${item.variant?.variant_name || ''}`,
        item.quantity.toString(),
        formatMoney(item.unit_price),
        formatMoney(item.discount_amount || 0),
        formatMoney(item.line_total)
      ]) || []

      doc.autoTable({
        startY: yPos,
        head: [['Producto', 'Cant', 'Precio', 'Desc', 'Total']],
        body: tableData,
        theme: 'grid',
        styles: { fontSize: 9 },
        headStyles: { fillColor: [25, 118, 210] },
        columnStyles: {
          1: { halign: 'center', cellWidth: 20 },
          2: { halign: 'right', cellWidth: 25 },
          3: { halign: 'right', cellWidth: 25 },
          4: { halign: 'right', cellWidth: 25 }
        }
      })

      yPos = doc.lastAutoTable.finalY + 10

      // Totales
      doc.setFont(undefined, 'normal')
      doc.text(`Subtotal:`, 130, yPos)
      doc.text(formatMoney(contract.subtotal), 190, yPos, { align: 'right' })
      yPos += 6
      
      if (contract.discount_total > 0) {
        doc.text(`Descuento:`, 130, yPos)
        doc.text(`-${formatMoney(contract.discount_total)}`, 190, yPos, { align: 'right' })
        yPos += 6
      }
      
      doc.text(`Impuestos:`, 130, yPos)
      doc.text(formatMoney(contract.tax_total), 190, yPos, { align: 'right' })
      yPos += 6
      
      doc.setFont(undefined, 'bold')
      doc.setFontSize(12)
      doc.text(`TOTAL:`, 130, yPos)
      doc.text(formatMoney(contract.total), 190, yPos, { align: 'right' })
      yPos += 10

      // Estado de pagos
      doc.setFontSize(10)
      doc.setFont(undefined, 'normal')
      doc.text(`Inicial/Pagado:`, 130, yPos)
      doc.text(formatMoney(contract.paid_total), 190, yPos, { align: 'right' })
      yPos += 6
      doc.setFont(undefined, 'bold')
      doc.text(`Saldo Pendiente:`, 130, yPos)
      doc.text(formatMoney(contract.balance), 190, yPos, { align: 'right' })
      yPos += 15

      // Términos y condiciones
      doc.setFontSize(9)
      doc.setFont(undefined, 'bold')
      doc.text('TÉRMINOS Y CONDICIONES', 20, yPos)
      yPos += 5
      doc.setFont(undefined, 'normal')
      const terms = [
        '1. El cliente se compromete a pagar el saldo pendiente antes de la fecha límite.',
        '2. Los productos quedan reservados y no pueden ser vendidos a terceros.',
        '3. En caso de incumplimiento, el contrato podrá ser cancelado perdiendo el monto abonado.',
        '4. Los productos pueden ser retirados una vez pagado el total del contrato.',
        '5. No se aceptan devoluciones una vez completado el pago total.'
      ]
      
      terms.forEach(term => {
        doc.text(term, 20, yPos, { maxWidth: 170 })
        yPos += 8
      })

      yPos += 15

      // Firmas
      doc.line(20, yPos, 80, yPos)
      doc.line(130, yPos, 190, yPos)
      yPos += 5
      doc.setFontSize(9)
      doc.text('Firma del Cliente', 50, yPos, { align: 'center' })
      doc.text('Firma Autorizada', 160, yPos, { align: 'center' })

      // Pie de página
      doc.setFontSize(8)
      doc.text('OfirOne - Sistema de Punto de Venta', 105, 285, { align: 'center' })

      // Abrir en nueva ventana para imprimir o descargar
      doc.autoPrint()
      window.open(doc.output('bloburl'), '_blank')
      
      printing.value = false
    } catch (error) {
      console.error('Error generando PDF:', error)
      printing.value = false
      throw error
    }
  }

  return {
    printing,
    printSaleTicket,
    printPaymentReceipt,
    printLayawayContract
  }
}
