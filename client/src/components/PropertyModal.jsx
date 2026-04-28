// PropertyModal.jsx — Modal para crear o renombrar una propiedad
// Un solo componente para ambas operaciones (mode: 'new' | 'rename')
// para reutilizar el mismo form, validación y estilos.

import { useState, useEffect, useRef } from 'react'
import { useAppContext } from '../context/AppContext'

export default function PropertyModal({ isOpen, mode, onClose, onSuccess }) {
  const { currentProperty, properties, setProperties, setCurrentProperty } = useAppContext()

  const [name,    setName]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const inputRef = useRef(null)

  // Pre-llenar el nombre al abrir y limpiar error al cambiar modo
  useEffect(() => {
    if (!isOpen) return
    setError('')
    setName(mode === 'rename' ? (currentProperty?.name || '') : '')
    // Focus programático después del render — useRef porque el input
    // no existe hasta que isOpen === true (return null cuando cerrado)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [isOpen, mode, currentProperty])

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleSubmit = async () => {
    if (!name.trim() || loading) return
    setLoading(true)
    setError('')
    try {
      let res, data
      if (mode === 'new') {
        res  = await fetch('/api/properties', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name: name.trim() }),
        })
        data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Error al crear la propiedad')
        // Agregar al array sin recargar toda la lista
        setProperties([...properties, data.property])
        setCurrentProperty(data.property)
      } else {
        res  = await fetch(`/api/properties/${currentProperty.id}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name: name.trim() }),
        })
        data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Error al renombrar la propiedad')
        const updatedProperty = { ...currentProperty, name: data.name }
        setProperties(properties.map(p =>
          p.id === currentProperty.id ? updatedProperty : p
        ))
        setCurrentProperty(updatedProperty)
      }
      onSuccess()
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!isOpen) return null

  const title = mode === 'new' ? 'Nueva propiedad' : 'Renombrar propiedad'

  return (
    // Overlay
    <div
      onClick={onClose}
      style={{
        position:       'fixed',
        inset:          0,
        background:     'rgba(0,0,0,0.5)',
        zIndex:         300,
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'center',
        padding:        '1rem',
      }}
    >
      {/* Modal */}
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background:   '#fff',
          borderRadius: '12px',
          width:        '100%',
          maxWidth:     '400px',
          overflow:     'hidden',
          boxShadow:    '0 20px 40px rgba(0,0,0,0.25)',
        }}
      >
        {/* Header */}
        <div style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'space-between',
          padding:        '1rem 1.5rem',
          background:     'var(--ink)',
        }}>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.95rem' }}>
            {title}
          </span>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: 'none', border: 'none',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '1.5rem', cursor: 'pointer',
              lineHeight: 1, padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: '1.5rem' }}>
          <label style={{
            display:      'block',
            fontSize:     '0.85rem',
            color:        'var(--ink-60)',
            fontFamily:   'var(--mono)',
            marginBottom: '0.5rem',
          }}>
            Nombre de la propiedad
          </label>
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleSubmit() }}
            placeholder={mode === 'new' ? 'Ej: Casa Polígono 108' : ''}
            style={{
              width:        '100%',
              padding:      '0.6rem 0.75rem',
              border:       '1px solid var(--ink-20)',
              borderRadius: '6px',
              fontSize:     '0.9375rem',
              fontFamily:   'inherit',
              outline:      'none',
              boxSizing:    'border-box',
            }}
          />
          {error && (
            <p style={{ color: '#b91c1c', fontSize: '0.85rem', marginTop: '0.5rem' }}>
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display:        'flex',
          justifyContent: 'flex-end',
          gap:            '0.75rem',
          padding:        '1rem 1.5rem',
          borderTop:      '1px solid var(--ink-20)',
          background:     '#f9f9f9',
        }}>
          <button className="btn btn--secondary" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="btn btn--primary"
            onClick={handleSubmit}
            disabled={loading || !name.trim()}
          >
            {loading ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  )
}
