// PropertyBar.jsx — Barra de selección y acciones sobre propiedades
// Lee el estado de propiedades desde AppContext.
// Devuelve null si no hay usuario o no hay propiedades — sin barra visible.

import { useState } from 'react'
import { useAppContext } from '../context/AppContext'
import PropertyModal from './PropertyModal'

export default function PropertyBar() {
  const { properties, currentProperty, setCurrentProperty, setProperties, user } = useAppContext()

  const [modal, setModal] = useState({ open: false, mode: 'new' })

  // No renderizar si no hay sesión o no hay propiedades cargadas
  if (!user || properties.length === 0) return null

  // Cambiar propiedad activa — recibe el objeto completo, no solo el id.
  // ¿Por qué el objeto completo? Los componentes hijos necesitan name e id;
  // guardar solo el id requeriría un .find() en cada hijo que lo use.
  const handleChange = (e) => {
    const selectedId = parseInt(e.target.value, 10)
    const selected   = properties.find(p => p.id === selectedId)
    if (selected) setCurrentProperty(selected)
  }

  // Eliminar propiedad activa — solo disponible con 2+ propiedades
  const handleDelete = async () => {
    if (!window.confirm(
      `¿Eliminar "${currentProperty?.name}"? Esta acción no se puede deshacer.\n` +
      `Solo se puede eliminar si no tiene reportes guardados.`
    )) return
    try {
      const res  = await fetch(`/api/properties/${currentProperty.id}`, {
        method: 'DELETE', credentials: 'include',
      })
      const data = await res.json()
      if (!res.ok) { alert(data.error || 'Error al eliminar la propiedad'); return }
      const remaining = properties.filter(p => p.id !== currentProperty.id)
      setProperties(remaining)
      setCurrentProperty(remaining[0] || null)
    } catch (err) {
      alert(`Error al eliminar: ${err.message}`)
    }
  }

  return (
    <div id="property-bar">
      <div className="property-bar-inner">
        <span className="property-bar-icon">🏠</span>

        <select
          className="property-bar-select"
          value={currentProperty?.id ?? ''}
          onChange={handleChange}
        >
          {properties.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <div className="property-bar-actions">
          <button
            className="btn--bar-action"
            onClick={() => setModal({ open: true, mode: 'rename' })}
          >
            ✏ Renombrar
          </button>

          {/* Eliminar solo visible cuando hay 2+ propiedades */}
          {properties.length > 1 && (
            <button
              className="btn--bar-action btn--bar-danger"
              onClick={handleDelete}
            >
              🗑 Eliminar
            </button>
          )}

          <button
            className="btn--bar-action btn--bar-primary"
            onClick={() => setModal({ open: true, mode: 'new' })}
          >
            + Nueva casa
          </button>
        </div>
      </div>

      {/* Modal de crear/renombrar propiedad */}
      <PropertyModal
        isOpen={modal.open}
        mode={modal.mode}
        onClose={() => setModal({ open: false, mode: 'new' })}
        onSuccess={() => setModal({ open: false, mode: 'new' })}
      />
    </div>
  )
}
