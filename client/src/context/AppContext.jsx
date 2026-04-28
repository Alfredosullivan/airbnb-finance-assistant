// AppContext.jsx — Estado global compartido de la app
// Centraliza propiedades y usuario para evitar prop drilling.
// AppProvider envuelve toda la app en App.jsx.
// useAppContext() es el hook de acceso — lanza error si se usa fuera del Provider.

import { createContext, useContext, useState, useEffect } from 'react'

const AppContext = createContext(null)

export function AppProvider({ children, user, onLogout }) {
  const [properties, setProperties]               = useState([])
  const [currentProperty, setCurrentProperty]     = useState(null)
  const [loadingProperties, setLoadingProperties] = useState(false)

  // Cargar propiedades cuando hay usuario autenticado.
  // ¿Por qué user como dependencia? Cuando user cambia de null a un objeto
  // (login exitoso), el efecto corre y carga las propiedades.
  // Cuando cambia de objeto a null (logout), limpia el estado.
  useEffect(() => {
    if (!user) {
      setProperties([])
      setCurrentProperty(null)
      return
    }
    const load = async () => {
      setLoadingProperties(true)
      try {
        const res  = await fetch('/api/properties')
        const data = await res.json()
        if (data.properties?.length > 0) {
          setProperties(data.properties)
          // Mantener la propiedad activa si aún existe en la lista;
          // si no, seleccionar la primera. Mismo comportamiento que el Vanilla JS original.
          setCurrentProperty(prev =>
            data.properties.find(p => p.id === prev?.id)
              ? prev
              : data.properties[0]
          )
        }
      } catch (err) {
        console.error('Error cargando propiedades:', err)
      } finally {
        setLoadingProperties(false)
      }
    }
    load()
  }, [user])

  const value = {
    properties,
    setProperties,
    currentProperty,
    setCurrentProperty,
    loadingProperties,
    user,
    onLogout,
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useAppContext() {
  const ctx = useContext(AppContext)
  // Fallo rápido: si alguien usa el hook fuera del Provider, el error
  // aparece en el componente culpable, no en un crash misterioso más arriba.
  if (!ctx) throw new Error('useAppContext debe usarse dentro de AppProvider')
  return ctx
}
