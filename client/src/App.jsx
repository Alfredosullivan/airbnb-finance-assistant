// App.jsx — Componente raíz
// Responsabilidad única: gestionar el estado de autenticación y el modal de auth.
// Todo el JSX de la app vive en AppShell, que sí puede usar useAppContext()
// porque está dentro del AppProvider.
//
// ¿Por qué esta separación?
// App.jsx es el PADRE de AppProvider — no puede llamar useAppContext() porque
// el Context no existe aún en su nivel. AppShell es un HIJO de AppProvider,
// así que sí tiene acceso al Context via useAppContext().

import { useState } from 'react'
import { AppProvider } from './context/AppContext'
import AuthModal from './components/AuthModal'
import AppShell from './components/AppShell'

function App() {
  // Estado de autenticación — vive aquí porque AuthModal y AppProvider lo necesitan
  const [user, setUser] = useState(null)

  // Estado del modal de auth
  const [authModal, setAuthModal] = useState({ open: false, mode: 'login' })

  const openAuth  = (mode = 'login') => setAuthModal({ open: true, mode })
  const closeAuth = () => setAuthModal(prev => ({ ...prev, open: false }))

  const handleAuthSuccess = (loggedUser) => {
    setUser(loggedUser)
    closeAuth()
  }

  const handleLogout = async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch (_) {}
    setUser(null)
  }

  return (
    <AppProvider user={user} onLogout={handleLogout}>
      {/* AppShell vive dentro del Provider — puede usar useAppContext() */}
      <AppShell
        user={user}
        onLogout={handleLogout}
        onOpenAuth={openAuth}
      />

      {/* AuthModal fuera de AppShell — sus callbacks solo necesitan user y openAuth */}
      <AuthModal
        isOpen={authModal.open}
        onClose={closeAuth}
        onSuccess={handleAuthSuccess}
        initialMode={authModal.mode}
      />
    </AppProvider>
  )
}

export default App
