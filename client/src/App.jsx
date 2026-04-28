// App.jsx — Componente raíz de la migración React
// Maneja el estado global de autenticación y renderiza el navbar + modal.
// AppProvider envuelve todo el árbol para compartir user y properties via Context.

import { useState } from 'react'
import { AppProvider } from './context/AppContext'
import AuthModal from './components/AuthModal'
import PropertyBar from './components/PropertyBar'
import Dashboard from './components/Dashboard'
import HistoryDrawer from './components/HistoryDrawer'
import UploadSection from './components/UploadSection'
import ReportResults from './components/ReportResults'

function App() {
  // Estado global de autenticación
  // null = sin sesión, objeto = { userId, username, email }
  const [user, setUser] = useState(null)

  // Estado del modal: open controla visibilidad, mode el tab inicial
  const [authModal, setAuthModal] = useState({ open: false, mode: 'login' })

  // Estado del drawer de historial
  const [historyOpen, setHistoryOpen] = useState(false)

  // Abrir modal en modo login o register
  const openAuth = (mode = 'login') => setAuthModal({ open: true, mode })

  // Cerrar modal — AuthModal también llama a esto desde su onClose prop
  const closeAuth = () => setAuthModal(prev => ({ ...prev, open: false }))

  // Callback de éxito — guarda el usuario en estado y cierra el modal
  const handleAuthSuccess = (loggedUser) => {
    setUser(loggedUser)
    closeAuth()
  }

  // Logout — limpia el usuario del estado y cierra el drawer si está abierto
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (_) {
      // Si el request falla, igualmente limpiamos el estado local
    }
    setHistoryOpen(false)
    setUser(null)
  }

  return (
    // AppProvider envuelve todo — user y onLogout se pasan como props
    // para que AppContext los exponga sin prop drilling a los hijos
    <AppProvider user={user} onLogout={handleLogout}>
      <div className="min-h-screen flex flex-col">

        {/* ── Navbar — usa clases de legacy.css directamente ── */}
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
              <button className="nav-link" onClick={() => openAuth('login')}>
                Iniciar sesión
              </button>
              <button className="nav-link nav-link--coral" onClick={() => openAuth('register')}>
                Registrarse
              </button>
            </div>
          )}
        </nav>

        {/* ── Barra de propiedades — visible cuando hay sesión y propiedades ── */}
        <PropertyBar />

        {/* ── Dashboard de métricas anuales ── */}
        <Dashboard />

        {/* ── Contenido principal ── */}
        <main className="main">
          <UploadSection />
          <ReportResults />
        </main>

        {/* ── Modal de autenticación — renderizado condicional interno ── */}
        <AuthModal
          isOpen={authModal.open}
          onClose={closeAuth}
          onSuccess={handleAuthSuccess}
          initialMode={authModal.mode}
        />

        {/* ── Drawer de historial de reportes ── */}
        <HistoryDrawer
          isOpen={historyOpen}
          onClose={() => setHistoryOpen(false)}
          onViewReport={(month) => console.log('TODO: ver reporte', month)}
          onViewAnalysis={(month, label) => console.log('TODO: análisis IA', month, label)}
        />

      </div>
    </AppProvider>
  )
}

export default App
