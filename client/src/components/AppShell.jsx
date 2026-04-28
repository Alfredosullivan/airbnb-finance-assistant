// AppShell.jsx — Cuerpo principal de la app
// Vive dentro de AppProvider → puede llamar useAppContext().
// Recibe user, onLogout y onOpenAuth como props desde App.jsx.
// Aquí viven los estados y funciones que necesitan tanto props como Context.

import { useState } from 'react'
import { useAppContext } from '../context/AppContext'
import PropertyBar from './PropertyBar'
import Dashboard from './Dashboard'
import HistoryDrawer from './HistoryDrawer'
import AnalysisModal from './AnalysisModal'
import UploadSection from './UploadSection'
import ReportResults from './ReportResults'
import MarketSection from './MarketSection'

export default function AppShell({ user, onLogout, onOpenAuth }) {
  const { currentProperty, setCurrentReport } = useAppContext()

  // Estado del drawer de historial — vive aquí y no en App.jsx porque
  // handleViewReport necesita setCurrentReport del Context, que solo
  // está disponible dentro del Provider
  const [historyOpen,   setHistoryOpen]   = useState(false)
  const [analysisModal, setAnalysisModal] = useState({ open: false, month: null, label: null })

  // Cierra el drawer y carga el reporte guardado en el Context
  // para que ReportResults lo renderice automáticamente
  const handleViewReport = async (month) => {
    try {
      const propParam = currentProperty?.id ? `?propertyId=${currentProperty.id}` : ''
      const res  = await fetch(`/api/reports/${month}${propParam}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al cargar el reporte')
      setCurrentReport(data)
      setHistoryOpen(false)
    } catch (err) {
      console.error('[AppShell] Error cargando reporte guardado:', err.message)
    }
  }

  const handleViewAnalysis = (month, label) => {
    setAnalysisModal({ open: true, month, label })
    setHistoryOpen(false)
  }

  // Logout también cierra el drawer
  const handleLogout = async () => {
    setHistoryOpen(false)
    await onLogout()
  }

  return (
    <div className="min-h-screen flex flex-col">

      {/* ── Navbar ── */}
      <nav>
        <span className="brand">✦ Airbnb Finance</span>

        {user ? (
          <div id="nav-user" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <span className="nav-welcome">
              Hola, <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{user.username}</strong>
            </span>
            <button className="nav-link" onClick={() => setHistoryOpen(true)}>
              Historial
            </button>
            <button className="nav-link nav-link--coral" onClick={handleLogout}>
              Salir
            </button>
          </div>
        ) : (
          <div id="nav-guest" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <button className="nav-link" onClick={() => onOpenAuth('login')}>
              Iniciar sesión
            </button>
            <button className="nav-link nav-link--coral" onClick={() => onOpenAuth('register')}>
              Registrarse
            </button>
          </div>
        )}
      </nav>

      {/* ── Barra de propiedades ── */}
      <PropertyBar />

      {/* ── Dashboard de métricas anuales ── */}
      <Dashboard />

      {/* ── Contenido principal ── */}
      <main className="main">
        <UploadSection />
        <ReportResults />
        <MarketSection />
      </main>

      {/* ── Drawer de historial ── */}
      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onViewReport={handleViewReport}
        onViewAnalysis={handleViewAnalysis}
      />

      {/* ── Modal de análisis IA ── */}
      <AnalysisModal
        isOpen={analysisModal.open}
        month={analysisModal.month}
        label={analysisModal.label}
        onClose={() => setAnalysisModal({ open: false, month: null, label: null })}
      />

    </div>
  )
}
