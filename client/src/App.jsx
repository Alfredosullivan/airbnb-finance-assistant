// App.jsx — Componente raíz de la migración React
// Maneja el estado global de autenticación y renderiza el navbar + modal.
// Esta es la fase inicial: solo auth. El dashboard se migrará en pasos siguientes.

import { useState } from 'react'
import AuthModal from './components/AuthModal'

function App() {
  // Estado global de autenticación
  // null = sin sesión, objeto = { userId, username, email }
  const [user, setUser] = useState(null)

  // Estado del modal: open controla visibilidad, mode el tab inicial
  const [authModal, setAuthModal] = useState({ open: false, mode: 'login' })

  // Abrir modal en modo login o register
  const openAuth = (mode = 'login') => setAuthModal({ open: true, mode })

  // Cerrar modal — AuthModal también llama a esto desde su onClose prop
  const closeAuth = () => setAuthModal(prev => ({ ...prev, open: false }))

  // Callback de éxito — guarda el usuario en estado y cierra el modal
  const handleAuthSuccess = (loggedUser) => {
    setUser(loggedUser)
    // AuthModal ya llama onClose() internamente al hacer onSuccess,
    // pero lo cerramos aquí también por si el orden de llamadas cambia
    closeAuth()
  }

  // Logout — limpia el usuario del estado
  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } catch (_) {
      // Si el request falla, igualmente limpiamos el estado local
    }
    setUser(null)
  }

  return (
    // min-h-screen + flex-col de Tailwind — no existe en legacy.css
    <div className="min-h-screen flex flex-col">

      {/* ── Navbar — usa clases de legacy.css directamente ── */}
      <nav>
        <span className="brand">✦ Airbnb Finance</span>

        {user ? (
          // Estado autenticado — muestra bienvenida y botón de salida
          <div id="nav-user" style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
            <span className="nav-welcome">
              Hola, <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{user.username}</strong>
            </span>
            <button className="nav-link nav-link--coral" onClick={handleLogout}>
              Salir
            </button>
          </div>
        ) : (
          // Estado sin sesión — muestra botones de auth
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

      {/* ── Contenido principal — placeholder hasta migrar el dashboard ── */}
      <main className="flex-1 flex items-center justify-center">
        {user ? (
          <p className="text-gray-500 text-sm font-mono">
            Sesión activa como <strong>{user.username}</strong> — dashboard próximamente
          </p>
        ) : (
          <p className="text-gray-400 text-sm font-mono">
            Inicia sesión para acceder a tus reportes
          </p>
        )}
      </main>

      {/* ── Modal de autenticación — renderizado condicional interno ── */}
      <AuthModal
        isOpen={authModal.open}
        onClose={closeAuth}
        onSuccess={handleAuthSuccess}
        initialMode={authModal.mode}
      />

    </div>
  )
}

export default App
