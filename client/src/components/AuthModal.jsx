// AuthModal.jsx — Modal de autenticación (login + registro)
// Maneja ambos modos en un solo componente para compartir estado de formulario
// y evitar duplicación. El modo se controla con la prop initialMode.

import { useState, useEffect, useCallback } from 'react'

export default function AuthModal({
  isOpen,
  onClose,
  onSuccess,
  initialMode = 'login',
}) {
  // Estado del formulario — compartido entre login y register
  // (email y password se reusan en ambos modos)
  const [mode, setMode]         = useState(initialMode)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')

  // Resetea formulario, error y modo al estado inicial
  // useCallback para que sea estable como dependencia del useEffect de Escape
  const resetForm = useCallback(() => {
    setEmail('')
    setPassword('')
    setUsername('')
    setError('')
    setMode(initialMode)
  }, [initialMode])

  // Cerrar con Escape — se registra solo cuando el modal está abierto
  // ¿Por qué useEffect? Necesitamos un event listener global (document),
  // que no podemos poner en un elemento JSX. useEffect lo registra cuando
  // isOpen=true y lo limpia cuando el modal se cierra o el componente se desmonta.
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        resetForm()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, resetForm])

  // Cambiar de modo limpia el error (UX: el error de login no debe
  // seguir visible cuando el usuario cambia a registro)
  const switchMode = (newMode) => {
    setError('')
    setMode(newMode)
  }

  // Cerrar desde botón × o desde overlay
  const handleClose = () => {
    resetForm()
    onClose()
  }

  // Clic en el overlay — solo cierra si el clic fue directamente sobre
  // el overlay, no sobre el modal interior (e.target === e.currentTarget)
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) handleClose()
  }

  // Submit login — POST /api/auth/login
  const handleLoginSubmit = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión')
      onSuccess(data.user)
      resetForm()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Submit register — POST /api/auth/register
  const handleRegisterSubmit = async () => {
    if (loading) return
    setLoading(true)
    setError('')
    try {
      const res  = await fetch('/api/auth/register', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ username, email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al registrarse')
      onSuccess(data.user)
      resetForm()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // No renderizar nada si el modal está cerrado — desmonta el componente
  // y resetea el estado de React automáticamente en el próximo montaje
  if (!isOpen) return null

  return (
    <div
      className="auth-modal-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <div className="auth-modal">

        {/* Header — igual en ambos modos */}
        <div className="auth-modal__header">
          <span className="auth-modal__brand">✦ Airbnb Finance</span>
          <button
            className="auth-modal__close"
            onClick={handleClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </div>

        {/* Body — condicional por modo */}
        <div className="auth-modal__body">
          {mode === 'login' ? (
            <>
              <div className="auth-modal__tag">Acceso seguro</div>
              <h2 className="auth-modal__title" id="auth-title">
                Inicia <em>sesión</em>
              </h2>
              <p className="auth-modal__subtitle">
                Accede a tus reportes y comparativas financieras.
              </p>

              <div className="auth-form">
                <div className="auth-field">
                  <label className="auth-label" htmlFor="login-email">
                    Correo electrónico
                  </label>
                  <input
                    className="auth-input"
                    type="email"
                    id="login-email"
                    placeholder="correo@ejemplo.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="login-password">
                    Contraseña
                  </label>
                  <input
                    className="auth-input"
                    type="password"
                    id="login-password"
                    placeholder="••••••••"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {error && <p className="auth-error">{error}</p>}
                <button
                  className="auth-btn auth-btn--primary"
                  onClick={handleLoginSubmit}
                  disabled={loading}
                >
                  {loading ? 'Entrando…' : 'Iniciar sesión'}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="auth-modal__tag">Registro gratuito</div>
              <h2 className="auth-modal__title" id="auth-title">
                Crea tu <em>cuenta</em>
              </h2>
              <p className="auth-modal__subtitle">
                Empieza a conciliar tus finanzas de Airbnb en segundos.
              </p>

              <div className="auth-form">
                <div className="auth-field">
                  <label className="auth-label" htmlFor="reg-username">
                    Usuario
                  </label>
                  <input
                    className="auth-input"
                    type="text"
                    id="reg-username"
                    placeholder="tu_usuario"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="reg-email">
                    Correo electrónico
                  </label>
                  <input
                    className="auth-input"
                    type="email"
                    id="reg-email"
                    placeholder="correo@ejemplo.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="auth-field">
                  <label className="auth-label" htmlFor="reg-password">
                    Contraseña
                  </label>
                  <input
                    className="auth-input"
                    type="password"
                    id="reg-password"
                    placeholder="••••••••"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {error && <p className="auth-error">{error}</p>}
                <button
                  className="auth-btn auth-btn--primary"
                  onClick={handleRegisterSubmit}
                  disabled={loading}
                >
                  {loading ? 'Creando cuenta…' : 'Crear cuenta'}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Footer — link para cambiar de modo */}
        <div className="auth-modal__footer">
          {mode === 'login' ? (
            <>
              <span className="auth-modal__footer-text">¿No tienes cuenta?</span>
              <button
                className="auth-modal__footer-link"
                onClick={() => switchMode('register')}
              >
                Crear cuenta
              </button>
            </>
          ) : (
            <>
              <span className="auth-modal__footer-text">¿Ya tienes cuenta?</span>
              <button
                className="auth-modal__footer-link"
                onClick={() => switchMode('login')}
              >
                Iniciar sesión
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  )
}
