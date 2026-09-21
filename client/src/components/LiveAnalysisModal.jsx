// LiveAnalysisModal.jsx — Modal de análisis IA del reporte RECIÉN GENERADO (en vivo).
// A diferencia de AnalysisModal (reportes guardados: usa :month + caché + regenerar),
// este consume POST /api/analysis/monthly, que lee la sesión activa vía X-Session-Id.
// Por eso NO tiene UI de caché ni de regenerar: el análisis en vivo no se persiste.
//
// DEUDA TÉCNICA (rastreada, fuera de alcance de DEV-008): markdownToHtml/formatInline
// están duplicados aquí, en AnalysisModal.jsx y en MarketSection.jsx. Un ticket futuro
// debe extraerlos a client/src/utils/markdown.js.

import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '../context/AppContext';

// ── markdownToHtml + formatInline — copiadas de AnalysisModal.jsx (ver deuda técnica arriba) ──
function formatInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

function markdownToHtml(text) {
  if (!text) return '';
  const lines = text.split('\n');
  let html = '',
    inList = false,
    inTable = false,
    tableRows = [];

  const flushTable = () => {
    if (tableRows.length < 2) {
      html += tableRows.map((r) => `<p>${r}</p>`).join('');
      tableRows = [];
      inTable = false;
      return;
    }
    const headers = tableRows[0]
      .split('|')
      .filter((c) => c.trim())
      .map((c) => `<th>${c.trim()}</th>`)
      .join('');
    const body = tableRows
      .slice(2)
      .map((row) => {
        const cells = row
          .split('|')
          .filter((c) => c.trim())
          .map((c) => `<td>${c.trim()}</td>`)
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    html += `<table class="market-analysis__table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
    tableRows = [];
    inTable = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const isTableRow = line.startsWith('|') && line.endsWith('|');
    const isSeparator = /^\|[\s\-|]+\|$/.test(line);
    if (isTableRow) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      tableRows.push(line);
      inTable = true;
      continue;
    }
    if (inTable) flushTable();
    if (!line) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      continue;
    }
    if (/^#{1,2}\s/.test(line)) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += `<h2 class="market-analysis__heading">${line.replace(/^#{1,2}\s/, '')}</h2>`;
      continue;
    }
    if (/^#{3,}\s/.test(line)) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += `<h3 class="market-analysis__subheading">${line.replace(/^#{3,}\s/, '')}</h3>`;
      continue;
    }
    if (/^[-*]\s/.test(line)) {
      if (!inList) {
        html += '<ul class="market-analysis__list">';
        inList = true;
      }
      html += `<li>${formatInline(line.replace(/^[-*]\s/, ''))}</li>`;
      continue;
    }
    if (/^>/.test(line)) {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += `<blockquote class="market-analysis__quote">${formatInline(line.replace(/^>\s?/, ''))}</blockquote>`;
      continue;
    }
    if (line === '---' || line === '***') {
      if (inList) {
        html += '</ul>';
        inList = false;
      }
      html += '<hr class="market-analysis__divider">';
      continue;
    }
    if (inList) {
      html += '</ul>';
      inList = false;
    }
    html += `<p>${formatInline(line)}</p>`;
  }
  if (inList) html += '</ul>';
  if (inTable) flushTable();
  return html;
}

// ── Componente ─────────────────────────────────────────────────────
export default function LiveAnalysisModal({ isOpen, label, onClose }) {
  // sessionId identifica la sesión de procesamiento activa; el backend la usa
  // para recuperar el compareResult del reporte recién generado.
  const { sessionId } = useAppContext();

  const [loading, setLoading] = useState(false);
  const [html, setHtml] = useState('');
  const [error, setError] = useState('');

  const fetchAnalysis = useCallback(async () => {
    setLoading(true);
    setHtml('');
    setError('');
    try {
      const headers = {};
      // El endpoint lee el sessionId por header (o query). Sin sesión activa,
      // el backend responde 400 "Genera primero la comparativa".
      if (sessionId) headers['X-Session-Id'] = sessionId;
      const res = await fetch('/api/analysis/monthly', {
        method: 'POST',
        credentials: 'include',
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar análisis');
      // dangerouslySetInnerHTML es seguro aquí: el HTML viene de markdownToHtml()
      // que procesa texto de Claude (fuente controlada del servidor), no input del usuario.
      setHtml(markdownToHtml(data.analysis));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Fetch al abrir el modal
  useEffect(() => {
    if (!isOpen) return;
    fetchAnalysis();
  }, [isOpen, fetchAnalysis]);

  // Cerrar con Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    // Overlay — clic fuera cierra el modal
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '1rem',
      }}
    >
      {/* Modal — e.stopPropagation previene que el clic interno cierre el overlay */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '700px',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
        }}
      >
        {/* ── Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '1rem 1.5rem',
            background: 'var(--ink)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
            flexShrink: 0,
          }}
        >
          <span
            style={{
              color: 'var(--coral)',
              fontFamily: 'var(--mono)',
              fontSize: '0.85rem',
              fontWeight: 700,
            }}
          >
            ✦ Análisis IA — {label}
          </span>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: 'none',
              border: 'none',
              color: 'rgba(255,255,255,0.5)',
              fontSize: '1.5rem',
              cursor: 'pointer',
              lineHeight: 1,
              padding: 0,
            }}
          >
            ×
          </button>
        </div>

        {/* ── Body con scroll ── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }}>
          {loading && (
            <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--ink-60)' }}>
              <div className="loader__spinner" style={{ margin: '0 auto 1rem' }} />
              <p>Generando análisis con Claude…</p>
            </div>
          )}

          {error && !loading && <p style={{ color: '#b91c1c', padding: '1rem 0' }}>{error}</p>}

          {html && !loading && (
            <div className="market-analysis__body" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </div>
  );
}
