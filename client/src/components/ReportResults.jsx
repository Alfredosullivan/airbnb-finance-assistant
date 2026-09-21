// ReportResults.jsx — Muestra el resultado de la conciliación Airbnb vs banco
// Lee currentReport desde AppContext — se renderiza automáticamente cuando
// UploadSection llama setCurrentReport después de GET /api/report.
// Nada de props: toda la data viene del Context.

import { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import LiveAnalysisModal from './LiveAnalysisModal';

function formatMXN(n) {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    maximumFractionDigits: 0,
  }).format(n || 0);
}

export default function ReportResults() {
  const { currentReport, currentProperty, sessionId, aiEnabled } = useAppContext();

  const [activeTab, setActiveTab] = useState('matched');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [liveAnalysisOpen, setLiveAnalysisOpen] = useState(false);

  // Mes del reporte activo. Se declara antes del guard para usarlo en el useEffect
  // sin violar las Reglas de Hooks (todos los hooks van antes de cualquier return).
  const reportMonth = currentReport?.reportMonth;

  // Reinicia el estado "guardado" al cambiar de reporte. Sin esto, tras guardar un
  // reporte el botón queda pegado en "✓ Guardado" (disabled) para los reportes
  // generados después, hasta recargar la página.
  useEffect(() => {
    setSaved(false);
    setSaving(false);
  }, [reportMonth]);

  // Guard: sin reporte, sin render
  if (!currentReport) return null;

  const { reportLabel, summary, tables } = currentReport;
  const matched = tables?.matched || [];
  const onlyInAirbnb = tables?.onlyInAirbnb || [];
  const onlyInBank = tables?.onlyInBank || [];
  const differences = tables?.differences || [];

  // ── Guardar reporte ────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    try {
      // X-Session-Id permite que saveReport lea airbnbData de la sesión activa
      // para calcular noches y comisión con precisión antes de destruir la sesión
      const headers = { 'Content-Type': 'application/json' };
      if (sessionId) headers['X-Session-Id'] = sessionId;

      const res = await fetch('/api/reports/save', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          month: reportMonth,
          label: reportLabel,
          propertyId: currentProperty?.id,
          summary,
          tables,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al guardar');
      }
      setSaved(true);

      // ── Auto-actualización del año siguiente ──────────────────────────
      // Si ya existe guardado el mismo mes del año siguiente, saveReport lo indica
      // en la respuesta. Ofrecemos inyectar estos datos como referencia del año
      // anterior (prevYearData — Hoja 3 del Excel anual del año siguiente).
      if (data.canUpdateNextYear) {
        const confirmar = window.confirm(
          `Ya tienes guardado ${data.nextYearLabel}. ¿Actualizarlo con los datos de ` +
            `${reportLabel} como referencia del año anterior?`
        );
        if (confirmar) {
          try {
            const upRes = await fetch('/api/reports/update-prev-year-ref', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                targetMonth: data.nextYearMonth,
                propertyId: currentProperty?.id,
              }),
            });
            if (!upRes.ok) {
              const upData = await upRes.json().catch(() => ({}));
              throw new Error(upData.error || 'Error al actualizar el año siguiente');
            }
          } catch (err) {
            // El guardado ya fue exitoso; un fallo aquí no lo revierte.
            console.error('[ReportResults] Error al actualizar año siguiente:', err.message);
          }
        }
      }
    } catch (err) {
      console.error('[ReportResults] Error al guardar:', err.message);
    } finally {
      setSaving(false);
    }
  };

  // ── Tarjetas de totales ────────────────────────────────────────────
  const totalCards = [
    { label: 'Total Airbnb', value: formatMXN(summary.totalAirbnbPayouts) },
    { label: 'Total banco', value: formatMXN(summary.totalBankDeposits) },
    { label: 'Match rate', value: summary.matchRate },
    { label: 'Diferencia', value: formatMXN(Math.abs(summary.difference || 0)) },
  ];

  // ── Pestañas ───────────────────────────────────────────────────────
  const tabs = [
    { key: 'matched', label: 'Coincidentes', count: matched.length, hidden: false },
    { key: 'airbnb-only', label: 'Solo Airbnb', count: onlyInAirbnb.length, hidden: false },
    { key: 'bank-only', label: 'Solo banco', count: onlyInBank.length, hidden: false },
    {
      key: 'differences',
      label: 'Diferencias',
      count: differences.length,
      hidden: differences.length === 0,
    },
  ];

  return (
    <section className="results-section">
      {/* ── Encabezado con label del mes ── */}
      <h2 className="section-title">{reportLabel}</h2>

      {/* ── 4 tarjetas de totales ── */}
      <div className="totals-grid">
        {totalCards.map((c) => (
          <div key={c.label} className="total-card">
            <div className="total-card__label">{c.label}</div>
            <div className="total-card__value">{c.value}</div>
          </div>
        ))}
      </div>

      {/* ── Pestañas de categoría ── */}
      <div className="tabs" role="tablist">
        {tabs
          .filter((t) => !t.hidden)
          .map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={activeTab === t.key}
              className={`tab${activeTab === t.key ? ' tab--active' : ''}`}
              onClick={() => setActiveTab(t.key)}
            >
              {t.label}
              <span className="badge">{t.count}</span>
            </button>
          ))}
      </div>

      {/* ── Contenido de la pestaña activa ── */}
      <div className="tab-content">
        {/* Coincidentes */}
        {activeTab === 'matched' && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha Airbnb</th>
                  <th>Fecha banco</th>
                  <th className="text-right">Monto</th>
                  <th className="text-right">Días</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {matched.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="text-center">
                      Sin coincidencias
                    </td>
                  </tr>
                ) : (
                  matched.map((r, i) => (
                    <tr key={i}>
                      <td>{r.airbnbDate}</td>
                      <td>{r.bankDate}</td>
                      <td className="text-right">{formatMXN(r.airbnbAmount)}</td>
                      <td className="text-right">
                        {r.daysDifference >= 0 ? '+' : ''}
                        {r.daysDifference}d
                      </td>
                      <td>{r.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Solo en Airbnb */}
        {activeTab === 'airbnb-only' && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="text-right">Monto</th>
                  <th>Código de referencia</th>
                </tr>
              </thead>
              <tbody>
                {onlyInAirbnb.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="text-center">
                      Sin registros
                    </td>
                  </tr>
                ) : (
                  onlyInAirbnb.map((r, i) => (
                    <tr key={i}>
                      <td>{r.airbnbDate}</td>
                      <td className="text-right">{formatMXN(r.airbnbAmount)}</td>
                      <td>{r.referenceCode || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Solo en banco */}
        {activeTab === 'bank-only' && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th className="text-right">Monto</th>
                  <th>Descripción</th>
                </tr>
              </thead>
              <tbody>
                {onlyInBank.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="text-center">
                      Sin registros
                    </td>
                  </tr>
                ) : (
                  onlyInBank.map((r, i) => (
                    <tr key={i}>
                      <td>{r.bankDate}</td>
                      <td className="text-right">{formatMXN(r.bankAmount)}</td>
                      <td>{r.bankDescription || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Diferencias */}
        {activeTab === 'differences' && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fecha Airbnb</th>
                  <th>Fecha banco</th>
                  <th className="text-right">Monto</th>
                  <th className="text-right">Días</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {differences.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="text-center">
                      Sin diferencias
                    </td>
                  </tr>
                ) : (
                  differences.map((r, i) => (
                    <tr key={i}>
                      <td>{r.airbnbDate}</td>
                      <td>{r.bankDate}</td>
                      <td className="text-right">{formatMXN(r.airbnbAmount)}</td>
                      <td className="text-right">
                        {r.daysDifference >= 0 ? '+' : ''}
                        {r.daysDifference}d
                      </td>
                      <td>{r.status}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {/* /tab-content */}

      {/* ── Acciones ── */}
      <div className="action-row" style={{ marginTop: '1.5rem' }}>
        <div className="action-buttons">
          <div className="action-pair">
            <button className="btn btn--primary" onClick={handleSave} disabled={saving || saved}>
              {saved ? '✓ Guardado' : saving ? 'Guardando…' : 'Guardar reporte'}
            </button>

            <button
              className="btn btn--secondary"
              onClick={() => {
                // window.open no puede enviar headers — se pasa el sessionId como query param
                const url = sessionId
                  ? `/api/report/excel?sessionId=${sessionId}`
                  : '/api/report/excel';
                window.open(url, '_blank');
              }}
            >
              Descargar Excel
            </button>

            {/* Análisis IA en vivo — solo si aiEnabled (feature flag DEV-007).
                Estilo ink + ✦ coral: distinto de Guardar (coral) y Descargar (contorno). */}
            {aiEnabled && (
              <button className="btn btn--ai" onClick={() => setLiveAnalysisOpen(true)}>
                <span style={{ color: 'var(--coral)' }}>✦</span>
                Analizar con IA
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Modal de análisis IA en vivo (reporte recién generado) ── */}
      <LiveAnalysisModal
        isOpen={liveAnalysisOpen}
        label={reportLabel}
        onClose={() => setLiveAnalysisOpen(false)}
      />
    </section>
  );
}
