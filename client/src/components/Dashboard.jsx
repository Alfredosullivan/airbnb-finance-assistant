// Dashboard.jsx — Métricas anuales con gráfica de barras
// Lee currentProperty y user desde AppContext.
// La gráfica Chart.js vive en un useRef — no puede vivir en el render de React
// porque necesita acceso al DOM real del <canvas>.

import { useState, useEffect, useRef } from 'react'
import { Chart } from 'chart.js/auto'
import { useAppContext } from '../context/AppContext'

// Formatea números como moneda MXN sin decimales
// ¿Por qué local en lugar de utils/? Es específico de este componente.
// Si otro componente lo necesita, moverlo a src/utils/format.js.
function formatMXN(n) {
  return new Intl.NumberFormat('es-MX', {
    style:                'currency',
    currency:             'MXN',
    maximumFractionDigits: 0,
  }).format(n || 0)
}

export default function Dashboard() {
  const { currentProperty, user } = useAppContext()

  const [data,      setData]      = useState(null)
  const [loading,   setLoading]   = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [year]                    = useState(() => new Date().getFullYear())

  // Refs para Chart.js — no pueden ser estado porque mutar una ref
  // no dispara un re-render (y no queremos re-renderizar al instanciar el chart)
  const chartRef      = useRef(null)  // referencia al elemento <canvas>
  const chartInstance = useRef(null)  // instancia activa de Chart.js

  // ── Fetch de datos ──────────────────────────────────────────────
  // Se ejecuta cuando cambia la propiedad activa o el año
  useEffect(() => {
    if (!user || !currentProperty) return

    const load = async () => {
      setLoading(true)
      setData(null)
      try {
        const res  = await fetch(
          `/api/reports/dashboard/${year}?propertyId=${currentProperty.id}`
        )
        if (!res.ok) return
        const json = await res.json()
        // Si no hay meses con actividad, no mostrar el dashboard
        if (!json.success || json.mesesActivos === 0) {
          setData(null)
        } else {
          setData(json)
        }
      } catch (err) {
        console.error('[Dashboard] Error:', err.message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [currentProperty, year, user])

  // ── Chart.js ────────────────────────────────────────────────────
  // Se ejecuta cuando cambian los datos o el estado colapsado.
  // ¿Por qué depende de collapsed? Chart.js no puede renderizar en un
  // canvas oculto (display:none) — si el dashboard está colapsado,
  // esperamos a que se expanda para instanciar el chart.
  useEffect(() => {
    if (collapsed || !data || !data.mesesData || !chartRef.current) return

    // Destruir instancia anterior antes de crear una nueva —
    // sin esto, Chart.js acumula instancias y lanza warnings de canvas reutilizado
    if (chartInstance.current) {
      chartInstance.current.destroy()
      chartInstance.current = null
    }

    chartInstance.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels:   data.mesesData.map(m => m.mes),
        datasets: [
          {
            label:           String(data.prevYear),
            data:            data.mesesData.map(m => m.anterior),
            backgroundColor: 'rgba(255,255,255,0.15)',
            borderColor:     'rgba(255,255,255,0.3)',
            borderWidth:     1,
            borderRadius:    4,
            barPercentage:       0.5,
            categoryPercentage:  0.8,
          },
          {
            label:           String(data.year),
            data:            data.mesesData.map(m => m.actual),
            backgroundColor: '#FF5A5F',
            borderColor:     '#FF5A5F',
            borderWidth:     0,
            borderRadius:    4,
            barPercentage:       0.5,
            categoryPercentage:  0.8,
          },
        ],
      },
      options: {
        responsive:          true,
        maintainAspectRatio: false,
        animation: { duration: 600, easing: 'easeOutQuart' },
        plugins: {
          legend: {
            display:  true,
            position: 'top',
            align:    'end',
            labels: {
              color:    'rgba(255,255,255,0.5)',
              font:     { family: "'DM Mono', monospace", size: 10 },
              boxWidth:  10,
              boxHeight: 10,
              padding:   12,
            },
          },
          tooltip: {
            backgroundColor: '#1a1a1a',
            borderColor:     'rgba(255,255,255,0.1)',
            borderWidth:     1,
            titleColor:      'rgba(255,255,255,0.5)',
            bodyColor:       '#fff',
            callbacks: {
              label: ctx => {
                const val = ctx.parsed.y
                if (val === 0) return ' Sin datos'
                return ` $${val.toLocaleString('es-MX', { maximumFractionDigits: 0 })} MXN`
              },
            },
          },
        },
        scales: {
          x: {
            grid:   { display: false },
            ticks:  { color: 'rgba(255,255,255,0.35)', font: { family: "'DM Mono', monospace", size: 9 } },
            border: { color: 'rgba(255,255,255,0.08)' },
          },
          y: {
            grid:   { color: 'rgba(255,255,255,0.05)' },
            ticks: {
              color:         'rgba(255,255,255,0.35)',
              font:          { family: "'DM Mono', monospace", size: 9 },
              maxTicksLimit: 5,
              callback:      val => '$' + (val / 1000).toFixed(0) + 'k',
            },
            border: { display: false },
          },
        },
      },
    })

    // Cleanup — destruir el chart cuando el componente se desmonte
    // o antes de que el efecto vuelva a correr
    return () => {
      if (chartInstance.current) {
        chartInstance.current.destroy()
        chartInstance.current = null
      }
    }
  }, [data, collapsed])

  // ── Guards de renderizado ────────────────────────────────────────
  if (!user || !currentProperty) return null
  if (loading) {
    return (
      <div id="dashboard-section" className="dashboard-section">
        <div className="dashboard-inner">
          <p className="dashboard-loading">Cargando…</p>
        </div>
      </div>
    )
  }
  if (!data) return null

  // ── KPI cards ────────────────────────────────────────────────────
  const cards = [
    { label: 'Ingresos netos',  value: formatMXN(data.metricas.ingresoTotal),  cls: 'coral' },
    { label: 'Noches ocupadas', value: data.metricas.nochesTotal,               cls: '' },
    { label: 'Ocupación',       value: `${data.metricas.ocupacion}%`,           cls: data.metricas.ocupacion >= 60 ? 'green' : '' },
    { label: 'ADR',             value: formatMXN(data.metricas.adr),            cls: '' },
    { label: 'Mejor mes',       value: data.metricas.mejorMes || '—',           cls: 'green' },
  ]

  // ── Comparativa YoY ──────────────────────────────────────────────
  const varItems = []
  if (data.variaciones?.ingreso !== null && data.variaciones?.ingreso !== undefined) {
    const sign = data.variaciones.ingreso > 0 ? '+' : ''
    const cls  = data.variaciones.ingreso > 0 ? 'up' : data.variaciones.ingreso < 0 ? 'down' : 'neutral'
    varItems.push({ name: 'Ingresos', val: `${sign}${data.variaciones.ingreso}%`, cls })
  }
  if (data.variaciones?.noches !== null && data.variaciones?.noches !== undefined) {
    const sign = data.variaciones.noches > 0 ? '+' : ''
    const cls  = data.variaciones.noches > 0 ? 'up' : data.variaciones.noches < 0 ? 'down' : 'neutral'
    varItems.push({ name: 'Noches', val: `${sign}${data.variaciones.noches}%`, cls })
  }
  const hasVariaciones = varItems.length > 0

  const mesesLabel = `${data.mesesActivos} mes${data.mesesActivos !== 1 ? 'es' : ''} activo${data.mesesActivos !== 1 ? 's' : ''}`

  return (
    <div id="dashboard-section" className="dashboard-section">
      <div className="dashboard-inner">

        {/* ── Toggle header ── */}
        <button
          className="dashboard-toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-expanded={!collapsed}
        >
          <span className="dashboard-toggle-left">
            <span className="dashboard-toggle-icon">{collapsed ? '▸' : '▾'}</span>
            <span className="dashboard-toggle-title">Resumen</span>
            <span className="dashboard-toggle-year">{data.year}</span>
          </span>
          <span className="dashboard-toggle-meta">{mesesLabel}</span>
        </button>

        {/* ── Body colapsable ── */}
        {!collapsed && (
          <div className="dashboard-body">

            {/* 5 KPI cards */}
            <div className="dashboard-grid">
              {cards.map(c => (
                <div key={c.label} className="dashboard-card">
                  <span className="dashboard-card__label">{c.label}</span>
                  <span className={`dashboard-card__value${c.cls ? ' ' + c.cls : ''}`}>
                    {c.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Comparativa YoY */}
            {hasVariaciones && (
              <div className="dashboard-compare">
                <span className="dashboard-compare-label">
                  vs <span>{data.prevYear}</span>
                </span>
                <div className="dashboard-compare-items">
                  {varItems.map(i => (
                    <span key={i.name} className="dashboard-compare-item">
                      <span className="dashboard-compare-item__name">{i.name}</span>
                      <span className={`dashboard-compare-item__val ${i.cls}`}>{i.val}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Gráfica de barras Chart.js */}
            <div className="dashboard-chart-wrap">
              <canvas ref={chartRef} id="dashboard-chart" height="180" />
            </div>

          </div>
        )}

      </div>
    </div>
  )
}
