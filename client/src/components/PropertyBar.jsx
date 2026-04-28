// PropertyBar.jsx — Barra de selección y acciones sobre propiedades
// Lee el estado de propiedades desde AppContext.
// Devuelve null si no hay usuario o no hay propiedades — sin barra visible.

import { useAppContext } from '../context/AppContext'

export default function PropertyBar() {
  const { properties, currentProperty, setCurrentProperty, user } = useAppContext()

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
            onClick={() => console.log('TODO: renombrar propiedad')}
          >
            ✏ Renombrar
          </button>

          {/* Eliminar solo visible cuando hay 2+ propiedades */}
          {properties.length > 1 && (
            <button
              className="btn--bar-action btn--bar-danger"
              onClick={() => console.log('TODO: eliminar propiedad')}
            >
              🗑 Eliminar
            </button>
          )}

          <button
            className="btn--bar-action btn--bar-primary"
            onClick={() => console.log('TODO: nueva propiedad')}
          >
            + Nueva casa
          </button>
        </div>
      </div>
    </div>
  )
}
