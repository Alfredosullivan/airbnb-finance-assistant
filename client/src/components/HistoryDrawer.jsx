// HistoryDrawer.jsx — Panel lateral de historial de reportes
// Se abre desde el botón "Historial" del navbar.
// La animación replica el doble rAF del Vanilla JS con setTimeout(0):
//   1er tick → renderiza sin is-open (el panel está en posición de partida)
//   2do tick → agrega is-open → CSS aplica la transición de entrada

import { useState, useEffect } from 'react'
import { useAppContext } from '../context/AppContext'

/** Devuelve clase CSS e ícono según el match rate del reporte */
function getMatchBadge(matchRate) {
  const pct = parseFloat(matchRate) || 0
  if (pct >= 95) return { cls: 'badge--green', icon: '✓' }
  if (pct >= 80) return { cls: 'badge--amber', icon: '◐' }
  return { cls: 'badge--red', icon: '✕' }
}

/** Formatea airbnbTotal como moneda MXN o '—' si es cero/null */
function formatMXN(n) {
  if (n == null || n === 0) return '—'
  return `$${Number(n).toLocaleString('es-MX', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export default function HistoryDrawer({ isOpen, onClose, onViewReport, onViewAnalysis }) {
  const { currentProperty } = useAppContext()

  const downloadBlob = async (url, filename) => {
    try {
      const res = await fetch(url, { credentials: 'include' })
      if (res.status === 404) { alert('No hay reportes guardados para este año'); return }
      if (!res.ok) { const d = await res.json().catch(() => ({})); alert(d.error || 'Error al descargar'); return }
      const blob      = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a         = document.createElement('a')
      a.href          = objectUrl
      a.download      = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch (err) {
      alert(`Error al descargar: ${err.message}`)
    }
  }

  const [reports,       setReports]       = useState([])
  const [loading,       setLoading]       = useState(false)
  const [expandedYears, setExpandedYears] = useState(new Set())
  const [animating,     setAnimating]     = useState(false)

  // ── Fetch de reportes cuando el drawer se abre ──────────────────
  useEffect(() => {
    if (!isOpen || !currentProperty) return
    const load = async () => {
      setLoading(true)
      try {
        const res  = await fetch(`/api/reports/list?propertyId=${currentProperty.id}`)
        const data = await res.json()
        setReports(data.reports || [])
      } catch (err) {
        console.error('[HistoryDrawer] Error:', err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [isOpen, currentProperty])

  // ── Animación de entrada/salida ─────────────────────────────────
  // ¿Por qué setTimeout(0)?
  // El CSS necesita que el elemento ya esté en el DOM (sin is-open) para
  // poder hacer la transición. Si agregáramos is-open en el mismo render
  // en que el elemento aparece, el browser no vería el estado "inicial"
  // y no habría transición — el panel simplemente aparecería.
  // setTimeout(0) cede el control al browser por un tick, garantizando
  // que el primer render (sin is-open) se pintó antes de agregar la clase.
  useEffect(() => {
    if (isOpen) {
      setAnimating(false)
      const id = setTimeout(() => setAnimating(true), 0)
      return () => clearTimeout(id)
    } else {
      setAnimating(false)
    }
  }, [isOpen])

  // ── Toggle de año en el acordeón ───────────────────────────────
  // new Set(prev) — no mutamos el Set original, creamos uno nuevo.
  // Si mutáramos prev directamente, React no detectaría el cambio
  // y no re-renderizaría.
  const toggleYear = (year) => {
    setExpandedYears(prev => {
      const next = new Set(prev)
      if (next.has(year)) next.delete(year)
      else next.add(year)
      return next
    })
  }

  // ── Eliminar reporte ────────────────────────────────────────────
  const handleDelete = async (month, label) => {
    if (!window.confirm(`¿Eliminar reporte de ${label}?`)) return
    try {
      const propParam = currentProperty ? `?propertyId=${currentProperty.id}` : ''
      await fetch(`/api/reports/${month}${propParam}`, { method: 'DELETE' })
      // Recargar lista tras eliminar
      const res  = await fetch(
        `/api/reports/list${currentProperty ? `?propertyId=${currentProperty.id}` : ''}`
      )
      const data = await res.json()
      setReports(data.reports || [])
    } catch (err) {
      console.error('[HistoryDrawer] Error al eliminar:', err.message)
    }
  }

  // ── Agrupar reportes por año ────────────────────────────────────
  const byYear = reports.reduce((acc, r) => {
    const year = r.year || parseInt(r.month.substring(0, 4), 10)
    if (!acc[year]) acc[year] = []
    acc[year].push(r)
    return acc
  }, {})

  const years = Object.keys(byYear).map(Number).sort((a, b) => b - a)

  // El drawer completo se desmonta cuando está cerrado
  if (!isOpen) return null

  return (
    <>
      {/* Overlay semitransparente — clic cierra el drawer */}
      <div
        id="history-overlay"
        className={`history-overlay${animating ? ' is-open' : ''}`}
        onClick={onClose}
      />

      {/* Panel drawer — entra desde la derecha con transición CSS */}
      <div
        id="history-panel"
        className={`history-panel${animating ? ' is-open' : ''}`}
        aria-live="polite"
      >
        {/* Handle visual solo en móvil */}
        <div className="history-handle" />

        {/* Header */}
        <div className="history-header">
          <h3 className="history-header__title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Historial de reportes
          </h3>
          <button className="history-close" onClick={onClose} aria-label="Cerrar historial">
            ×
          </button>
        </div>

        {/* Cuerpo con scroll */}
        <div className="history-body">

          {loading && <p className="history-empty">Cargando…</p>}

          {!loading && reports.length === 0 && (
            <p className="history-empty">No hay reportes guardados aún.</p>
          )}

          {!loading && years.map(year => (
            <div key={year} className="history-year">

              {/* Header del año: toggle + botones de descarga */}
              <div className="history-year-header">
                <button
                  className="history-year-toggle"
                  onClick={() => toggleYear(year)}
                >
                  <span className="history-year-label">{year}</span>
                  <span className="history-year-count">{byYear[year].length} meses</span>
                </button>

                <button
                  className="btn--annual-inline"
                  onClick={() => downloadBlob(
                    `/api/reports/annual/${year}?propertyId=${currentProperty?.id}`,
                    `Reporte_Anual_${year}.xlsx`
                  )}
                  title={`Descargar reporte anual ${year}`}
                >
                  ↓ Excel {year}
                </button>

                <button
                  className="btn--annual-inline btn--annual-pdf"
                  onClick={() => downloadBlob(
                    `/api/reports/executive-pdf/${year}`,
                    `Reporte_Ejecutivo_${year}.pdf`
                  )}
                  title={`Reporte ejecutivo PDF ${year}`}
                >
                  ↓ PDF {year}
                </button>

                <button
                  className="history-year-chevron"
                  onClick={() => toggleYear(year)}
                  aria-expanded={expandedYears.has(year)}
                >
                  {expandedYears.has(year) ? '⌄' : '›'}
                </button>
              </div>

              {/* Cards de meses — solo si el año está expandido */}
              {expandedYears.has(year) && (
                <div className="history-year-body">
                  <div className="history-grid">
                    {byYear[year].map(r => {
                      const mes   = r.label.split(' ')[0]
                      const amt   = formatMXN(r.airbnbTotal)
                      const badge = getMatchBadge(r.matchRate || '0%')
                      return (
                        <div key={r.month} className="history-card">
                          <div className="history-card-month">{mes}</div>
                          <div className="history-card-amount">{amt}</div>
                          <div className="history-card-meta">
                            <span className={`match-badge ${badge.cls}`}>
                              {badge.icon} {r.matchRate || '0%'}
                            </span>
                          </div>
                          <div className="history-card-actions">
                            <button
                              className="btn--ver"
                              onClick={() => onViewReport(r.month)}
                            >
                              Ver
                            </button>
                            <button
                              className="btn--ia"
                              onClick={() => onViewAnalysis(r.month, r.label)}
                              title={`Análisis IA de ${r.label}`}
                            >
                              ✦
                            </button>
                            <button
                              className="btn--del"
                              onClick={() => handleDelete(r.month, r.label)}
                              title={`Eliminar reporte de ${r.label}`}
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

            </div>
          ))}

        </div>
      </div>
    </>
  )
}
