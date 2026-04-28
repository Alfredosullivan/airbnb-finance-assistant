// MarketSection.jsx — Sección de mercado de rentas de Mérida
// Scrapea listings de Lamudi y opcionalmente analiza el mercado con Claude.
// La sección es visible cuando hay sesión activa (user existe en Context).

import { useState } from 'react'
import { useAppContext } from '../context/AppContext'

// ── Helpers de formato ─────────────────────────────────────────────
function formatMXN(n) {
  return new Intl.NumberFormat('es-MX', {
    style:                'currency',
    currency:             'MXN',
    maximumFractionDigits: 0,
  }).format(n || 0)
}

// ── markdownToHtml + formatInline — copiadas exactas de public/app.js ──
// ¿Por qué copiar en lugar de importar?
// app.js es Vanilla JS en public/ — no es un módulo ES, no se puede importar.
// Si en el futuro se extrae a un paquete compartido, este es el lugar a actualizar.

function formatInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

function markdownToHtml(text) {
  if (!text) return ''

  const lines = text.split('\n')
  let html = ''
  let inList = false
  let inTable = false
  let tableRows = []

  const flushTable = () => {
    if (tableRows.length < 2) { html += tableRows.map(r => `<p>${r}</p>`).join(''); tableRows = []; inTable = false; return }
    const headers = tableRows[0].split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('')
    const body = tableRows.slice(2).map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('')
      return `<tr>${cells}</tr>`
    }).join('')
    html += `<table class="market-analysis__table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`
    tableRows = []
    inTable = false
  }

  for (const raw of lines) {
    const line = raw.trim()
    const isTableRow = line.startsWith('|') && line.endsWith('|')
    const isSeparator = /^\|[\s\-|]+\|$/.test(line)

    if (isTableRow) {
      if (inList) { html += '</ul>'; inList = false }
      if (!isSeparator) tableRows.push(line)
      else tableRows.push(line)
      inTable = true
      continue
    }

    if (inTable) flushTable()

    if (!line) {
      if (inList) { html += '</ul>'; inList = false }
      continue
    }

    if (/^#{1,2}\s/.test(line)) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<h2 class="market-analysis__heading">${line.replace(/^#{1,2}\s/, '')}</h2>`
      continue
    }

    if (/^#{3,}\s/.test(line)) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<h3 class="market-analysis__subheading">${line.replace(/^#{3,}\s/, '')}</h3>`
      continue
    }

    if (/^[-*]\s/.test(line)) {
      if (!inList) { html += '<ul class="market-analysis__list">'; inList = true }
      html += `<li>${formatInline(line.replace(/^[-*]\s/, ''))}</li>`
      continue
    }

    if (/^>/.test(line)) {
      if (inList) { html += '</ul>'; inList = false }
      html += `<blockquote class="market-analysis__quote">${formatInline(line.replace(/^>\s?/, ''))}</blockquote>`
      continue
    }

    if (line === '---' || line === '***') {
      if (inList) { html += '</ul>'; inList = false }
      html += '<hr class="market-analysis__divider">'
      continue
    }

    if (inList) { html += '</ul>'; inList = false }
    html += `<p>${formatInline(line)}</p>`
  }

  if (inList) html += '</ul>'
  if (inTable) flushTable()

  return html
}

// ── Componente ─────────────────────────────────────────────────────
export default function MarketSection() {
  const { user } = useAppContext()

  const [listings,     setListings]     = useState([])
  const [status,       setStatus]       = useState('idle')  // 'idle'|'loading'|'success'|'error'
  const [errorMsg,     setErrorMsg]     = useState('')
  const [updatedAt,    setUpdatedAt]    = useState('')
  const [analyzing,    setAnalyzing]    = useState(false)
  const [analysisHtml, setAnalysisHtml] = useState('')

  if (!user) return null

  // ── Cargar listings del crawler ──────────────────────────────────
  const loadListings = async () => {
    setStatus('loading')
    setAnalysisHtml('')
    try {
      const res = await fetch('/api/crawler/listings', { credentials: 'include' })
      if (res.status === 401) {
        setStatus('error')
        setErrorMsg('Tu sesión expiró. Inicia sesión de nuevo para ver el mercado.')
        return
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al obtener los listings')

      const ls = data.listings || []
      if (ls.length === 0) {
        setStatus('error')
        setErrorMsg('No se encontraron listings disponibles en este momento. Intenta de nuevo en unos minutos.')
        return
      }

      setListings(ls)
      setStatus('success')
      const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
      setUpdatedAt(`Última actualización: hoy a las ${hora} · ${ls.length} listings de Lamudi`)
    } catch (err) {
      setStatus('error')
      setErrorMsg(`Error al obtener el mercado: ${err.message}. Intenta de nuevo.`)
    }
  }

  // ── Análisis de mercado con Claude (polling asíncrono) ───────────
  const analyzeMarket = async () => {
    setAnalyzing(true)
    setAnalysisHtml('')
    const POLL_MS   = 3000
    const MAX_POLLS = 20

    try {
      const postRes = await fetch('/api/crawler/analyze', {
        method:      'POST',
        credentials: 'include',
        headers:     { 'Content-Type': 'application/json' },
        body:        JSON.stringify({}),
      })
      if (!postRes.ok) {
        const err = await postRes.json().catch(() => ({}))
        throw new Error(err.error || `Error ${postRes.status} al iniciar el análisis`)
      }
      const { jobId } = await postRes.json()

      // Polling hasta completado, fallido o timeout
      let attempts = 0
      while (attempts < MAX_POLLS) {
        await new Promise(resolve => setTimeout(resolve, POLL_MS))
        attempts++

        const pollRes = await fetch(`/api/jobs/${jobId}`, { credentials: 'include' })
        if (!pollRes.ok) throw new Error(`Error ${pollRes.status} al consultar el estado del job`)

        const job = await pollRes.json()

        if (job.status === 'completed') {
          setAnalysisHtml(markdownToHtml(job.analysisText || ''))
          return
        }
        if (job.status === 'failed') {
          throw new Error(job.error || 'El análisis falló en el servidor')
        }
        // pending/processing → continuar esperando
      }

      throw new Error('Tiempo de espera agotado (60 s). El servidor tardó demasiado. Intenta de nuevo.')

    } catch (err) {
      // Mostrar el error dentro del contenedor de análisis
      setAnalysisHtml(
        `<div class="market-analysis__error">
          <strong>No se pudo completar el análisis</strong>
          <p>${err.message}</p>
        </div>`
      )
    } finally {
      setAnalyzing(false)
    }
  }

  // ── Estadísticas calculadas de los listings ──────────────────────
  const prices = listings.map(l => l.price).filter(p => typeof p === 'number' && p > 0)
  const avg    = prices.length > 0 ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
  const min    = prices.length > 0 ? Math.min(...prices) : 0
  const max    = prices.length > 0 ? Math.max(...prices) : 0

  return (
    <section className="market-section">

      {/* ── Header ── */}
      <div className="market-header">
        <div>
          <h2 className="section-title">Mercado de Rentas — Mérida</h2>
          <p className="market-subtitle">
            {updatedAt || 'Pulsa "Actualizar" para ver los listings actuales de Lamudi'}
          </p>
        </div>
        <button
          className="btn btn--secondary"
          onClick={loadListings}
          disabled={status === 'loading'}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-4.51"/>
          </svg>
          {status === 'loading' ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {/* ── Loader ── */}
      {status === 'loading' && (
        <div className="market-loader">
          <div className="loader__spinner" />
          <p className="market-loader__text">Scrapeando Lamudi… puede tardar 5–8 segundos</p>
        </div>
      )}

      {/* ── Error ── */}
      {status === 'error' && (
        <p className="market-message">{errorMsg}</p>
      )}

      {/* ── Resultados ── */}
      {status === 'success' && (
        <>
          {/* 4 stats cards */}
          <div className="market-stats">
            <div className="market-stat">
              <span className="market-stat__label">Listings encontrados</span>
              <span className="market-stat__value">{listings.length}</span>
            </div>
            <div className="market-stat">
              <span className="market-stat__label">Precio promedio</span>
              <span className="market-stat__value market-stat__value--coral">{formatMXN(avg)}</span>
            </div>
            <div className="market-stat">
              <span className="market-stat__label">Precio mínimo</span>
              <span className="market-stat__value">{formatMXN(min)}</span>
            </div>
            <div className="market-stat">
              <span className="market-stat__label">Precio máximo</span>
              <span className="market-stat__value">{formatMXN(max)}</span>
            </div>
          </div>

          {/* Grid de listings */}
          <div className="market-grid">
            {listings.map((l, i) => (
              <div key={i} className="market-card">
                <div className="market-card__top">
                  <span className="market-card__price">
                    {formatMXN(l.price)}
                    <span className="market-card__per-month">/mes</span>
                  </span>
                  <span className="market-card__source">{l.source}</span>
                </div>

                <p className="market-card__title">{l.title}</p>

                <p className="market-card__location">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                    <circle cx="12" cy="10" r="3"/>
                  </svg>
                  {l.location}
                </p>

                {l.features && (
                  <p className="market-card__features">{l.features}</p>
                )}

                {l.url && (
                  <a className="market-card__link"
                     href={l.url}
                     target="_blank"
                     rel="noopener noreferrer">
                    Ver en Lamudi →
                  </a>
                )}
              </div>
            ))}
          </div>

          {/* Botón de análisis IA */}
          {listings.length > 0 && (
            <div className="market-analyze-row">
              <button
                className="btn btn--primary"
                onClick={analyzeMarket}
                disabled={analyzing}
              >
                {analyzing ? 'Analizando…' : '✦ Analizar con IA'}
              </button>
              <p className="market-analyze-hint">
                Claude analizará los precios del mercado y los comparará con tu tarifa actual.
              </p>
            </div>
          )}

          {/* Resultado del análisis de Claude */}
          {analysisHtml && (
            <div className="market-analysis">
              <div className="market-analysis__header">
                <span className="market-analysis__badge">✦ Análisis IA</span>
                <span className="market-analysis__meta">
                  Generado con Claude · {new Date().toLocaleTimeString('es-MX')}
                </span>
              </div>
              {/*
                dangerouslySetInnerHTML es seguro aquí porque analysisHtml viene
                de markdownToHtml(), que procesa texto generado por Claude (fuente
                controlada del servidor). NO procesa input del usuario.
                Si esto cambiara, habría que sanitizar con DOMPurify antes de insertar.
              */}
              <div
                className="market-analysis__body"
                dangerouslySetInnerHTML={{ __html: analysisHtml }}
              />
            </div>
          )}
        </>
      )}

    </section>
  )
}
