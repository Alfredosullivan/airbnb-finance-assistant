// AnalysisModal.jsx — Modal de análisis IA de un reporte mensual guardado
// Consume POST /api/reports/:month/analysis que genera o recupera el análisis
// de Claude. Si ya existe un análisis cacheado, lo devuelve sin coste de API.

import { useState, useEffect, useCallback } from 'react'
import { useAppContext } from '../context/AppContext'

// ── markdownToHtml + formatInline — copiadas de MarketSection.jsx ──
function formatInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

function markdownToHtml(text) {
  if (!text) return ''
  const lines = text.split('\n')
  let html = '', inList = false, inTable = false, tableRows = []

  const flushTable = () => {
    if (tableRows.length < 2) { html += tableRows.map(r => `<p>${r}</p>`).join(''); tableRows = []; inTable = false; return }
    const headers = tableRows[0].split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('')
    const body = tableRows.slice(2).map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('')
      return `<tr>${cells}</tr>`
    }).join('')
    html += `<table class="market-analysis__table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`
    tableRows = []; inTable = false
  }

  for (const raw of lines) {
    const line = raw.trim()
    const isTableRow = line.startsWith('|') && line.endsWith('|')
    const isSeparator = /^\|[\s\-|]+\|$/.test(line)
    if (isTableRow) {
      if (inList) { html += '</ul>'; inList = false }
      if (!isSeparator) tableRows.push(line); else tableRows.push(line)
      inTable = true; continue
    }
    if (inTable) flushTable()
    if (!line) { if (inList) { html += '</ul>'; inList = false }; continue }
    if (/^#{1,2}\s/.test(line)) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<h2 class="market-analysis__heading">${line.replace(/^#{1,2}\s/, '')}</h2>`; continue
    }
    if (/^#{3,}\s/.test(line)) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<h3 class="market-analysis__subheading">${line.replace(/^#{3,}\s/, '')}</h3>`; continue
    }
    if (/^[-*]\s/.test(line)) {
      if (!inList) { html += '<ul class="market-analysis__list">'; inList = true }
      html += `<li>${formatInline(line.replace(/^[-*]\s/, ''))}</li>`; continue
    }
    if (/^>/.test(line)) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<blockquote class="market-analysis__quote">${formatInline(line.replace(/^>\s?/, ''))}</blockquote>`; continue
    }
    if (line === '---' || line === '***') {
      if (inList) { html += '</ul>'; inList = false }
      html += '<hr class="market-analysis__divider">'; continue
    }
    if (inList) { html += '</ul>'; inList = false }
    html += `<p>${formatInline(line)}</p>`
  }
  if (inList) html += '</ul>'
  if (inTable) flushTable()
  return html
}

// ── Componente ─────────────────────────────────────────────────────
export default function AnalysisModal({ isOpen, month, label, onClose }) {
  const { currentProperty } = useAppContext()

  const [loading,  setLoading]  = useState(false)
  const [html,     setHtml]     = useState('')
  const [cached,   setCached]   = useState(false)
  const [cachedAt, setCachedAt] = useState(null)
  const [error,    setError]    = useState('')

  // fetchAnalysis — separado con useCallback para poder llamarlo desde
  // el useEffect (fetch inicial) y desde el botón Regenerar (force=true)
  const fetchAnalysis = useCallback(async (force = false) => {
    if (!month) return
    setLoading(true)
    setHtml('')
    setError('')
    try {
      const params = new URLSearchParams()
      if (currentProperty?.id) params.set('propertyId', String(currentProperty.id))
      if (force)               params.set('force', 'true')
      const qs  = params.toString() ? `?${params}` : ''
      const res = await fetch(`/api/reports/${month}/analysis${qs}`, {
        method:      'POST',
        credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al generar análisis')
      // dangerouslySetInnerHTML es seguro aquí: el HTML viene de markdownToHtml()
      // que procesa texto de Claude (fuente controlada), no input del usuario
      setHtml(markdownToHtml(data.analysis))
      setCached(data.cached   ?? false)
      setCachedAt(data.cachedAt ?? null)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [month, currentProperty])

  // Fetch al abrir el modal o cambiar el mes
  useEffect(() => {
    if (!isOpen || !month) return
    fetchAnalysis(false)
  }, [isOpen, month, fetchAnalysis])

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const formattedDate = cachedAt
    ? new Date(cachedAt).toLocaleString('es-MX', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : null

  return (
    // Overlay — clic fuera cierra el modal
    <div
      onClick={onClose}
      style={{
        position:       'fixed',
        inset:          0,
        background:     'rgba(0,0,0,0.6)',
        zIndex:         200,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        padding:        '1rem',
      }}
    >
      {/* Modal — e.stopPropagation previene que el clic interno cierre el overlay */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:    '#fff',
          borderRadius:  '12px',
          width:         '100%',
          maxWidth:      '700px',
          maxHeight:     '85vh',
          display:       'flex',
          flexDirection: 'column',
          overflow:      'hidden',
          boxShadow:     '0 25px 50px rgba(0,0,0,0.3)',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '1rem 1.5rem',
          background:     'var(--ink)',
          borderBottom:   '1px solid rgba(255,255,255,0.08)',
          flexShrink:     0,
        }}>
          <span style={{
            color:      'var(--coral)',
            fontFamily: 'var(--mono)',
            fontSize:   '0.85rem',
            fontWeight: 700,
          }}>
            ✦ Análisis IA — {label}
          </span>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: 'none',
              border:     'none',
              color:      'rgba(255,255,255,0.5)',
              fontSize:   '1.5rem',
              cursor:     'pointer',
              lineHeight: 1,
              padding:    0,
            }}
          >
            ×
          </button>
        </div>

        {/* ── Body con scroll ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--ink-60)' }}>
              <div className="loader__spinner" style={{ margin: '0 auto 1rem' }} />
              <p>Generando análisis con Claude…</p>
            </div>
          )}

          {error && !loading && (
            <p style={{ color: '#b91c1c', padding: '1rem 0' }}>{error}</p>
          )}

          {html && !loading && (
            <div
              className="market-analysis__body"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}
        </div>

        {/* ── Footer con info de caché ── */}
        {!loading && html && (
          <div style={{
            padding:    '0.75rem 1.5rem',
            borderTop:  '1px solid var(--ink-20)',
            background: '#f9f9f9',
            display:    'flex',
            alignItems: 'center',
            gap:        '1rem',
            flexShrink: 0,
          }}>
            {cached && formattedDate ? (
              <>
                <span style={{ fontSize: '0.8rem', color: 'var(--ink-60)' }}>
                  ✓ Análisis guardado el {formattedDate}
                </span>
                <button
                  className="btn btn--secondary"
                  onClick={() => fetchAnalysis(true)}
                  style={{ fontSize: '0.75rem', padding: '0.2rem 0.75rem' }}
                >
                  ↺ Regenerar
                </button>
              </>
            ) : (
              <span style={{ fontSize: '0.8rem', color: 'var(--coral)' }}>
                ✦ Análisis nuevo generado y guardado
              </span>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
