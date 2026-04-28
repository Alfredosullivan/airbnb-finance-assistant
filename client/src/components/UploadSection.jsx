// UploadSection.jsx — Zona de carga de archivos para la conciliación
// Maneja 3 zonas de upload: CSV/PDF Airbnb + 2 PDFs bancarios (el segundo opcional).
// Cada zona tiene un input[type=file] oculto activado por clic en la card.
// El reporte generado se guarda en AppContext para que otros componentes lo consuman.

import { useState, useRef } from 'react'
import { useAppContext } from '../context/AppContext'

export default function UploadSection() {
  const { user, setCurrentReport } = useAppContext()

  const [uploads,    setUploads]    = useState({ airbnb: false, bank1: false, bank2: false })
  const [statuses,   setStatuses]   = useState({ airbnb: '',    bank1: '',    bank2: ''    })
  const [generating, setGenerating] = useState(false)
  const [generated,  setGenerated]  = useState(false)

  // Refs para los inputs ocultos — useRef porque necesitamos acceso al DOM real
  // para llamar .click() programáticamente desde el clic en la card
  const airbnbRef = useRef(null)
  const bank1Ref  = useRef(null)
  const bank2Ref  = useRef(null)

  // ── Upload de archivos ────────────────────────────────────────────
  const uploadFile = async (file, type, slot) => {
    if (!file) return

    // La clave de estado depende del tipo y slot
    const key = type === 'airbnb' ? 'airbnb' : `bank${slot}`
    const ext = file.name.split('.').pop().toLowerCase()

    // Validación en el cliente — el servidor también valida, pero esto da feedback inmediato
    if (type === 'airbnb' && !['pdf', 'csv'].includes(ext)) {
      setStatuses(prev => ({ ...prev, [key]: '✗ Solo se aceptan archivos PDF o CSV' }))
      return
    }
    if (type === 'bank' && ext !== 'pdf') {
      setStatuses(prev => ({ ...prev, [key]: '✗ Solo se aceptan archivos PDF' }))
      return
    }

    setStatuses(prev => ({ ...prev, [key]: 'Subiendo…' }))

    try {
      const formData = new FormData()
      let url

      if (type === 'airbnb') {
        formData.append('pdf', file)          // el endpoint Airbnb espera campo "pdf"
        url = '/api/upload/airbnb'
      } else {
        formData.append('bankPdf', file)      // el endpoint bancario espera "bankPdf"
        formData.append('slot', String(slot)) // y el número de slot (1 o 2)
        url = '/api/upload/bank'
      }

      const res  = await fetch(url, { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al subir el archivo')

      setUploads(prev  => ({ ...prev, [key]: true }))
      setStatuses(prev => ({ ...prev, [key]: `✓ ${file.name}` }))
    } catch (err) {
      setStatuses(prev => ({ ...prev, [key]: `✗ ${err.message}` }))
    }
  }

  // ── Generar reporte ────────────────────────────────────────────────
  // GET /api/report — el servidor combina los archivos ya subidos en sesión
  // y devuelve el resultado de la conciliación Airbnb vs banco
  const handleGenerate = async () => {
    setGenerating(true)
    try {
      const res  = await fetch('/api/report')
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al generar el reporte')
      setCurrentReport(data)   // guarda en Context — ReportResults lo leerá desde ahí
      setGenerated(true)
    } catch (err) {
      console.error('[UploadSection] Error generando reporte:', err.message)
    } finally {
      setGenerating(false)
    }
  }

  // ── Reiniciar todo ─────────────────────────────────────────────────
  const handleReset = async () => {
    try { await fetch('/api/upload/reset', { method: 'POST' }) } catch (_) {}
    setUploads({ airbnb: false, bank1: false, bank2: false })
    setStatuses({ airbnb: '',   bank1: '',    bank2: ''    })
    setGenerated(false)
    setCurrentReport(null)
  }

  if (!user) return null

  const canGenerate = uploads.airbnb && uploads.bank1 && !generating
  const hint = uploads.airbnb && uploads.bank1
    ? uploads.bank2
      ? 'Archivos listos (2 PDFs bancarios). Haz clic para comparar.'
      : 'Archivos listos. Haz clic para comparar.'
    : 'Sube el reporte Airbnb y al menos el PDF bancario Parte 1'

  return (
    <section className="upload-section">
      <h2 className="section-title">Conciliación de Documentos</h2>
      <p className="section-description">
        Sube el reporte de pagos de Airbnb y tu estado de cuenta bancario para comparar
        automáticamente los depósitos y detectar diferencias.
      </p>

      <div className="upload-grid">

        {/* ── Zona Airbnb (CSV o PDF) ── */}
        <div
          className={`upload-card${uploads.airbnb ? ' has-file' : ''}`}
          onClick={() => airbnbRef.current?.click()}
          style={{ cursor: 'pointer' }}
        >
          <div className="upload-card__icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
              <polyline points="10 9 9 9 8 9"/>
            </svg>
          </div>
          <h3 className="upload-card__title">Reporte Airbnb (.csv o .pdf)</h3>
          <p className="upload-card__hint">Haz clic para seleccionar</p>
          {statuses.airbnb && (
            <div className="upload-card__status">{statuses.airbnb}</div>
          )}
          <input
            ref={airbnbRef}
            type="file"
            accept=".csv,.pdf"
            style={{ display: 'none' }}
            onChange={e => uploadFile(e.target.files[0], 'airbnb')}
          />
        </div>

        {/* ── Columna bancaria ── */}
        <div className="bank-column">

          {/* Banco parte 1 — requerida */}
          <div
            className={`upload-card${uploads.bank1 ? ' has-file' : ''}`}
            onClick={() => bank1Ref.current?.click()}
            style={{ cursor: 'pointer' }}
          >
            <div className="upload-card__icon">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <line x1="2" y1="10" x2="22" y2="10"/>
              </svg>
            </div>
            <h3 className="upload-card__title">Estado de cuenta BBVA</h3>
            <p className="upload-card__hint">Haz clic para seleccionar</p>
            {statuses.bank1 && (
              <div className="upload-card__status">{statuses.bank1}</div>
            )}
            <input
              ref={bank1Ref}
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={e => uploadFile(e.target.files[0], 'bank', 1)}
            />
          </div>

          {/* Banco parte 2 — opcional */}
          <div
            className={`upload-card upload-card--optional${uploads.bank2 ? ' has-file' : ''}`}
            onClick={() => bank2Ref.current?.click()}
            style={{ cursor: 'pointer' }}
          >
            <div className="upload-card__icon">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                <rect x="2" y="5" width="20" height="14" rx="2"/>
                <line x1="2" y1="10" x2="22" y2="10"/>
              </svg>
            </div>
            <h3 className="upload-card__title upload-card__title--muted">
              Estado de cuenta (opcional)
              <span className="optional-badge">opcional</span>
            </h3>
            <p className="upload-card__hint">Si tu estado cubre dos PDFs, sube el segundo aquí</p>
            {statuses.bank2 && (
              <div className="upload-card__status">{statuses.bank2}</div>
            )}
            <input
              ref={bank2Ref}
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={e => uploadFile(e.target.files[0], 'bank', 2)}
            />
          </div>

        </div>{/* /bank-column */}

      </div>{/* /upload-grid */}

      {/* ── Fila de acciones ── */}
      <div className="action-row">
        <div className="action-buttons">
          <div className="action-pair action-pair--a">
            <button
              className="btn btn--primary"
              disabled={!canGenerate}
              onClick={handleGenerate}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
              </svg>
              {generating ? 'Generando…' : 'Generar reporte'}
            </button>

            {generated && (
              <button className="btn btn--secondary" onClick={handleReset}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <polyline points="1 4 1 10 7 10"/>
                  <path d="M3.51 15a9 9 0 1 0 .49-4.51"/>
                </svg>
                Reiniciar
              </button>
            )}
          </div>
        </div>
        <span className="action-hint">{hint}</span>
      </div>

    </section>
  )
}
