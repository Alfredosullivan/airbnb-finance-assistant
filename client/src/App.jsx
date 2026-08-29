// App.jsx — Componente raíz
// Responsabilidad única: gestionar el estado de autenticación y el modal de auth.
// Todo el JSX de la app vive en AppShell, que sí puede usar useAppContext()
// porque está dentro del AppProvider.
//
// ¿Por qué esta separación?
// App.jsx es el PADRE de AppProvider — no puede llamar useAppContext() porque
// el Context no existe aún en su nivel. AppShell es un HIJO de AppProvider,
// así que sí tiene acceso al Context via useAppContext().

import { useState, useEffect } from 'react';
import { AppProvider } from './context/AppContext';
import AuthModal from './components/AuthModal';
import AppShell from './components/AppShell';

function App() {
  // Estado de autenticación — vive aquí porque AuthModal y AppProvider lo necesitan
  const [user, setUser] = useState(null);

  // true mientras se verifica la cookie — evita renderizar UI de visitante
  // durante el chequeo inicial y el flicker que eso causaría
  const [authLoading, setAuthLoading] = useState(true);

  // Estado del modal de auth
  const [authModal, setAuthModal] = useState({ open: false, mode: 'login' });

  // Rehidratación de autenticación al montar.
  // Si existe una cookie JWT válida, el servidor devuelve el usuario actual.
  // La cookie viaja automáticamente — no se lee ni se envía desde JS.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.user) setUser(data.user);
      })
      .catch(() => {})
      .finally(() => setAuthLoading(false));
  }, []);

  const openAuth = (mode = 'login') => setAuthModal({ open: true, mode });
  const closeAuth = () => setAuthModal((prev) => ({ ...prev, open: false }));

  const handleAuthSuccess = (loggedUser) => {
    setUser(loggedUser);
    closeAuth();
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (_) {}
    setUser(null);
  };

  // No renderizar nada mientras se verifica la sesión.
  // Evita el flicker de UI de visitante → UI autenticada.
  if (authLoading) return null;

  return (
    <AppProvider user={user} onLogout={handleLogout}>
      {/* AppShell vive dentro del Provider — puede usar useAppContext() */}
      <AppShell user={user} onLogout={handleLogout} onOpenAuth={openAuth} />

      {/* AuthModal fuera de AppShell — sus callbacks solo necesitan user y openAuth */}
      <AuthModal
        isOpen={authModal.open}
        onClose={closeAuth}
        onSuccess={handleAuthSuccess}
        initialMode={authModal.mode}
      />
    </AppProvider>
  );
}

export default App;
