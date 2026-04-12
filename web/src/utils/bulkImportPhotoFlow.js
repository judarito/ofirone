export function applyPhotoAnalysisToState(resultData = {}) {
  const rows = Array.isArray(resultData?.rows) ? resultData.rows : []
  return {
    rows,
    warnings: Array.isArray(resultData?.warnings) ? resultData.warnings : [],
    meta: {
      model: resultData?.model || null,
      usage: resultData?.usage || null,
    },
    shouldOpenPreview: rows.length > 0,
  }
}

export function updatePhotoDraftRow(rows = [], index, field, value) {
  return (Array.isArray(rows) ? rows : []).map((row, rowIndex) => (
    rowIndex === index
      ? { ...row, [field]: value }
      : row
  ))
}

export function removePhotoDraftRow(rows = [], index) {
  return (Array.isArray(rows) ? rows : []).filter((_, rowIndex) => rowIndex !== index)
}

export function buildPhotoImportFeedback(summary = {}) {
  if (Number(summary?.failed || 0) > 0) {
    return {
      color: 'warning',
      message: `Importacion parcial: ${summary.processed} ok, ${summary.failed} con error.`,
    }
  }

  return {
    color: 'success',
    message: `Importacion completada: ${summary.processed} fila(s) procesadas.`,
  }
}
