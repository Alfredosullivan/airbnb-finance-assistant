// app.js — Lógica del cliente
// Maneja uploads (Airbnb CSV/PDF + hasta 2 PDFs bancarios), llama a la API
// y renderiza el reporte. Incluye autenticación, historial de reportes y reset.

// ══════════════════════════════════════════════════════════════
// MÓDULO DE AUTENTICACIÓN (funciones globales, accesibles desde HTML)
// ══════════════════════════════════════════════════════════════

/** Estado de sesión compartido entre los dos módulos */
const Auth = {
  user:          null,   // { id, username, email } o null
  reporteActual: null,   // último reporte generado (para guardar)
};

// ── Estado global de propiedades ──────────────────────────────
let activePropertyId = null;   // id de la propiedad activa (integer)
let properties       = [];     // lista de propiedades del usuario
let renamingPropertyId = null; // id de la propiedad que se está renombrando

// ── Inicialización: verificar sesión al cargar la página ──────
// Llama a /api/auth/me una sola vez al cargar. 401 es el estado normal
// sin sesión (no es un error). Solo actualiza la UI según la respuesta.
async function initAuth() {
  try {
    const res = await fetch('/api/auth/me');
    if (res.ok) {
      // ✓ Hay sesión activa: mostrar grupo de usuario autenticado
      const data = await res.json();
      Auth.user = data.user;
      // Cargar propiedades antes de actualizar la navbar
      await loadProperties();
      actualizarNavbar();
      loadDashboard();
      // Si el usuario solo tiene la propiedad por defecto, sugerir renombrarla
      if (data.needsPropertyName) {
        openRenamePropertyModal();
      }
    } else {
      // Sin sesión: navbar invitado
      actualizarNavbar();
    }
  } catch {
    // Error de red: tratar como sin sesión
    actualizarNavbar();
  }
}

/** Actualiza la navbar según si hay sesión activa o no */
function actualizarNavbar() {
  const navGuest   = document.getElementById('nav-guest');
  const navUser    = document.getElementById('nav-user');
  const navName    = document.getElementById('nav-username');
  const propBar    = document.getElementById('property-bar');

  // Sección de mercado de rentas — solo visible con sesión activa
  const marketSection = document.getElementById('market-section');

  if (Auth.user) {
    navGuest.hidden     = true;
    navUser.hidden      = false;
    navName.textContent = Auth.user.username;
    // Mostrar barra de propiedad solo cuando hay propiedades cargadas
    if (propBar) propBar.hidden = (properties.length === 0);
    // Revelar la sección de mercado al autenticarse
    if (marketSection) marketSection.hidden = false;
  } else {
    navGuest.hidden = false;
    navUser.hidden  = true;
    if (propBar) propBar.hidden = true;
    const dashboardSection = document.getElementById('dashboard-section');
    if (dashboardSection) dashboardSection.hidden = true;
    // Ocultar la sección de mercado al cerrar sesión
    if (marketSection) marketSection.hidden = true;
  }
  // Sincronizar botón de guardar con el estado actual del reporte
  actualizarBotonGuardar();
}

/** Habilita o deshabilita el botón "Guardar reporte" y el botón "Descargar Excel" */
function actualizarBotonGuardar() {
  const saveBtn   = document.getElementById('save-report-btn');
  const excelBtn  = document.getElementById('download-excel-btn');
  const habilitado = !!(Auth.user && Auth.reporteActual);
  if (saveBtn)  saveBtn.disabled  = !habilitado;
  if (excelBtn) excelBtn.disabled = !habilitado;
}

// ── Modales ────────────────────────────────────────────────────
function openLoginModal() {
  document.getElementById('login-modal').hidden = false;
  document.getElementById('login-email').focus();
}
function closeLoginModal() {
  document.getElementById('login-modal').hidden = true;
  document.getElementById('login-error').hidden  = true;
  document.getElementById('login-form').reset();
}
function openRegisterModal() {
  document.getElementById('register-modal').hidden = false;
  document.getElementById('reg-username').focus();
}
function closeRegisterModal() {
  document.getElementById('register-modal').hidden = true;
  document.getElementById('register-error').hidden  = true;
  document.getElementById('register-form').reset();
}
function switchToRegister(e) { e.preventDefault(); closeLoginModal();    openRegisterModal(); }
function switchToLogin(e)    { e.preventDefault(); closeRegisterModal(); openLoginModal(); }

// Cerrar modales al hacer clic en el fondo
document.addEventListener('click', e => {
  if (e.target.id === 'login-modal')          closeLoginModal();
  if (e.target.id === 'register-modal')       closeRegisterModal();
  if (e.target.id === 'new-property-modal')   closeNewPropertyModal();
  if (e.target.id === 'rename-property-modal') closeRenamePropertyModal();
  if (e.target.id === 'analysis-modal')       closeAnalysisModal();
});
// Cerrar con Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const histPanel = document.getElementById('history-panel');
    if (histPanel && histPanel.classList.contains('is-open')) {
      toggleHistory();
      return;
    }
    closeLoginModal();
    closeRegisterModal();
    closeNewPropertyModal();
    closeRenamePropertyModal();
    closeAnalysisModal();
  }
});

// ── Acciones de autenticación ──────────────────────────────────

/** Envía el formulario de registro */
async function submitRegister(event) {
  event.preventDefault();
  const btn = document.getElementById('register-submit-btn');
  const err = document.getElementById('register-error');

  const username = document.getElementById('reg-username').value.trim();
  const email    = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;

  btn.disabled    = true;
  btn.textContent = 'Creando cuenta…';
  err.hidden      = true;

  try {
    const res  = await fetch('/api/auth/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al registrarse');

    Auth.user = data.user;
    closeRegisterModal();
    await loadProperties();
    actualizarNavbar();
  } catch (e) {
    err.textContent = e.message;
    err.hidden      = false;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Crear cuenta';
  }
}

/** Envía el formulario de login */
async function submitLogin(event) {
  event.preventDefault();
  const btn = document.getElementById('login-submit-btn');
  const err = document.getElementById('login-error');

  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;

  btn.disabled    = true;
  btn.textContent = 'Entrando…';
  err.hidden      = true;

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

    Auth.user = data.user;
    closeLoginModal();
    await loadProperties();
    actualizarNavbar();
  } catch (e) {
    err.textContent = e.message;
    err.hidden      = false;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Entrar';
  }
}

/** Cierra sesión */
async function submitLogout() {
  try { await fetch('/api/auth/logout', { method: 'POST' }); } catch (_) {}
  Auth.user          = null;
  Auth.reporteActual = null;
  // Limpiar estado de propiedades
  activePropertyId = null;
  properties       = [];
  // Ocultar barra de propiedad
  const propBar = document.getElementById('property-bar');
  if (propBar) propBar.hidden = true;
  actualizarNavbar();
  // Cerrar el historial si está abierto
  const hp  = document.getElementById('history-panel');
  const hov = document.getElementById('history-overlay');
  if (hp)  { hp.classList.remove('is-open');  hp.hidden  = true; }
  if (hov) { hov.classList.remove('is-open'); hov.hidden = true; }
  historialVisible = false;
  // Ocultar dashboard y destruir gráfica
  const dashboardSection = document.getElementById('dashboard-section');
  if (dashboardSection) dashboardSection.hidden = true;
  if (typeof dashboardChart !== 'undefined' && dashboardChart) {
    dashboardChart.destroy();
    dashboardChart = null;
  }
}

// ── Guardar reporte ────────────────────────────────────────────

/** Guarda el reporte actual en el servidor */
async function saveCurrentReport() {
  if (!Auth.reporteActual || !Auth.user) return;

  const btn = document.getElementById('save-report-btn');
  btn.disabled    = true;
  btn.textContent = 'Guardando…';

  try {
    const res  = await fetch('/api/reports/save', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ ...Auth.reporteActual, propertyId: activePropertyId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    btn.textContent = '✓ Guardado';
    loadDashboard();

    // ── Ofrecer actualizar el reporte del año siguiente ──────────
    if (data.canUpdateNextYear) {
      // Breve pausa para que el usuario vea el check antes del modal
      setTimeout(() => {
        openUpdateNextYearModal(data.nextYearMonth, data.nextYearLabel);
        btn.textContent = 'Guardar reporte';
        actualizarBotonGuardar();
      }, 600);
    } else {
      setTimeout(() => { btn.textContent = 'Guardar reporte'; actualizarBotonGuardar(); }, 2000);
    }
  } catch (e) {
    alert(`Error al guardar: ${e.message}`);
    actualizarBotonGuardar();
  }
}

// ── Modal: Actualizar reporte del año siguiente ────────────────

function openUpdateNextYearModal(targetMonth, targetLabel) {
  const modal = document.getElementById('update-next-year-modal');
  if (!modal) return;
  const labelEl = document.getElementById('update-next-year-label');
  if (labelEl) labelEl.textContent = targetLabel || targetMonth;
  modal.dataset.targetMonth = targetMonth;
  modal.hidden = false;
}

function closeUpdateNextYearModal() {
  const modal = document.getElementById('update-next-year-modal');
  if (modal) modal.hidden = true;
}

async function confirmUpdateNextYear() {
  const modal = document.getElementById('update-next-year-modal');
  if (!modal) return;
  const targetMonth = modal.dataset.targetMonth;
  closeUpdateNextYearModal();
  await updateNextYearReport(targetMonth);
}

/** Llama al endpoint para inyectar prevYearData en el reporte del año siguiente */
async function updateNextYearReport(targetMonth) {
  try {
    const res = await fetch('/api/reports/update-prev-year-ref', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ targetMonth, propertyId: activePropertyId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar');
    console.log('[app] prevYearData actualizado:', data.message);
  } catch (e) {
    console.error('[app] Error en updateNextYearReport:', e.message);
    alert(`No se pudo actualizar el reporte del año siguiente: ${e.message}`);
  }
}
window.updateNextYearReport = updateNextYearReport;

// ── Análisis IA ────────────────────────────────────────────────

/** Convierte el texto Markdown del análisis a HTML para mostrar en el modal */
function _analysisToHtml(text) {
  const html = text.split('\n').map(line => {
    if (line.startsWith('## '))
      return `<h4 class="analysis-section-title">${line.replace(/^## /, '')}</h4>`;
    if (line.trim() === '')
      return '<br>';
    return `<p>${line}</p>`;
  }).join('');
  return `<div class="analysis-content">${html}</div>`;
}

/** Solicita el análisis IA del reporte en vivo (store) y lo muestra en el modal */
async function viewAnalysis() {
  if (!Auth.reporteActual || !Auth.user) return;

  // Modo "en vivo": no hay mes guardado activo
  window._analysisMonth = null;

  const modal   = document.getElementById('analysis-modal');
  const body    = document.getElementById('analysis-modal-body');
  const titleEl = document.getElementById('analysis-modal-title');
  if (!modal || !body) return;

  if (titleEl) titleEl.textContent = 'Análisis inteligente';
  body.innerHTML = '<div class="analysis-loading"><div class="spinner-small"></div><p>Generando análisis con IA…</p></div>';
  modal.hidden   = false;

  try {
    const res  = await fetch('/api/analysis/monthly', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al generar análisis');
    body.innerHTML = _analysisToHtml(data.analysis);
  } catch (e) {
    body.innerHTML = `<p style="color:var(--color-primary);padding:1rem">${e.message}</p>`;
  }
}

/**
 * viewSavedAnalysis — Abre el modal y genera/recupera el análisis de un reporte guardado.
 * @param {string}  month   Formato YYYY-MM
 * @param {string}  label   Etiqueta legible (ej: "Febrero 2026")
 * @param {boolean} force   Si true, ignora caché y genera uno nuevo
 */
async function viewSavedAnalysis(month, label, force = false) {
  const modal      = document.getElementById('analysis-modal');
  const body       = document.getElementById('analysis-modal-body');
  const titleEl    = document.getElementById('analysis-modal-title');
  const footerInfo = document.getElementById('analysis-footer-info');
  if (!modal || !body) return;

  // Guardar mes activo para que downloadAnalysisPDF use el endpoint correcto
  window._analysisMonth = month;
  window._analysisLabel = label;

  if (titleEl) titleEl.textContent = `Análisis — ${label}`;
  if (footerInfo) footerInfo.hidden = true;
  body.innerHTML = '<div class="analysis-loading"><div class="spinner-small"></div><p>Generando análisis con IA…</p></div>';
  modal.hidden   = false;

  try {
    const params = new URLSearchParams();
    if (activePropertyId) params.set('propertyId', activePropertyId);
    if (force)            params.set('force', 'true');
    const qs = params.toString() ? `?${params}` : '';

    const res  = await fetch(`/api/reports/${month}/analysis${qs}`, {
      method:      'POST',
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al generar análisis');

    body.innerHTML = _analysisToHtml(data.analysis);

    // ── Mostrar info de caché en el footer ────────────────────────
    if (footerInfo) {
      if (data.cached && data.cachedAt) {
        const fecha = new Date(data.cachedAt).toLocaleString('es-MX', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        });
        footerInfo.innerHTML =
          `<span class="analysis-cached-badge">✓ Guardado el ${fecha}</span>` +
          `<button class="btn--regen" ` +
            `onclick="viewSavedAnalysis('${month}','${label.replace(/'/g, "\\'")}',true)" ` +
            `title="Genera un análisis nuevo (tiene costo de API)">↺ Regenerar</button>`;
      } else {
        footerInfo.innerHTML =
          `<span class="analysis-cached-badge analysis-cached-badge--new">✦ Análisis nuevo generado y guardado</span>`;
      }
      footerInfo.hidden = false;
    }

  } catch (e) {
    body.innerHTML = `<p style="color:var(--color-primary);padding:1rem">${e.message}</p>`;
  }
}

function closeAnalysisModal() {
  const modal = document.getElementById('analysis-modal');
  if (modal) modal.hidden = true;
}

/**
 * downloadAnalysisPDF — Descarga el análisis como PDF.
 * Si window._analysisMonth está seteado, usa el endpoint de reporte guardado;
 * si no, usa el endpoint del reporte en memoria (store).
 */
async function downloadAnalysisPDF() {
  if (!Auth.user) return;

  const month = window._analysisMonth;
  let url;
  if (month) {
    const propParam = activePropertyId ? `?propertyId=${activePropertyId}` : '';
    url = `/api/reports/${month}/analysis/pdf${propParam}`;
  } else {
    if (!Auth.reporteActual) return;
    url = '/api/analysis/monthly/pdf';
  }

  const btn = document.getElementById('btn-analysis-pdf');
  if (btn) { btn.disabled = true; }

  try {
    const res = await fetch(url, { method: 'POST', credentials: 'include' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Error al generar el PDF');
    }

    const blob = await res.blob();
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `Analisis_${month || (Auth.reporteActual?.summary?.reportLabel || 'mes')}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert(`Error al descargar el PDF: ${e.message}`);
  } finally {
    if (btn) { btn.disabled = false; }
  }
}

window.viewAnalysis        = viewAnalysis;
window.viewSavedAnalysis   = viewSavedAnalysis;
window.closeAnalysisModal  = closeAnalysisModal;
window.downloadAnalysisPDF = downloadAnalysisPDF;

/** Descarga el reporte mensual como archivo .xlsx */
async function downloadExcel() {
  if (!Auth.reporteActual || !Auth.user) return;

  const btn = document.getElementById('download-excel-btn');
  btn.disabled    = true;
  btn.textContent = 'Generando…';

  try {
    const propParam = activePropertyId ? `?propertyId=${activePropertyId}` : '';
    const response = await fetch(`/api/report/excel${propParam}`);

    if (response.status === 401) {
      Auth.abrirModal();
      return;
    }
    if (response.status === 400) {
      const data = await response.json();
      alert(data.error || 'Genera primero una comparativa');
      return;
    }
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'Error al generar el Excel');
    }

    const blob      = await response.blob();
    const url       = URL.createObjectURL(blob);
    const a         = document.createElement('a');
    const label     = Auth.reporteActual?.reportLabel || Auth.reporteActual?.reportMonth || 'reporte';
    a.href          = url;
    a.download      = `Reporte_${label}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`Error al descargar: ${e.message}`);
  } finally {
    btn.textContent = 'Descargar Excel';
    actualizarBotonGuardar();
  }
}

// ── Historial de reportes ──────────────────────────────────────

let historialVisible = false;

/** Muestra u oculta el panel del historial.
 *  Guard: si no hay sesión, abre el modal de login en lugar del panel. */
function toggleHistory() {
  if (!Auth.user) { openLoginModal(); return; }

  const panel   = document.getElementById('history-panel');
  const overlay = document.getElementById('history-overlay');
  const isOpen  = panel.classList.contains('is-open');

  if (isOpen) {
    panel.classList.remove('is-open');
    overlay.classList.remove('is-open');
    setTimeout(() => {
      panel.hidden   = true;
      overlay.hidden = true;
    }, 350);
    historialVisible = false;
  } else {
    panel.hidden   = false;
    overlay.hidden = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        panel.classList.add('is-open');
        overlay.classList.add('is-open');
      });
    });
    historialVisible = true;
    loadHistory();
  }
}

function handleOverlayClick(event) {
  if (event.target === document.getElementById('history-overlay')) {
    toggleHistory();
  }
}
window.handleOverlayClick = handleOverlayClick;

/** Genera el badge de match rate para las tarjetas del historial */
function getMatchBadge(matchRate) {
  const pct = parseFloat(matchRate) || 0;
  let cls, icon;
  if (pct >= 95)       { cls = 'badge--green'; icon = '✓'; }
  else if (pct >= 80)  { cls = 'badge--amber'; icon = '◐'; }
  else                 { cls = 'badge--red';   icon = '✕'; }
  return `<span class="match-badge ${cls}">${icon} ${matchRate}</span>`;
}
window.getMatchBadge = getMatchBadge;

/** Carga y renderiza el historial de reportes agrupado por año (acordeón) */
async function loadHistory() {
  const lista = document.getElementById('history-list');
  lista.innerHTML = '<p class="history-empty">Cargando…</p>';

  try {
    const url      = activePropertyId
      ? `/api/reports/list?propertyId=${activePropertyId}`
      : '/api/reports/list';
    const res      = await fetch(url);
    const data     = await res.json();
    const reportes = data.reports || [];

    if (reportes.length === 0) {
      lista.innerHTML = '<p class="history-empty">No hay reportes guardados aún.</p>';
      return;
    }

    // ── Agrupar por año ──────────────────────────────────────────
    const byYear = {};
    reportes.forEach(r => {
      const y = r.year || parseInt(r.month.substring(0, 4), 10);
      if (!byYear[y]) byYear[y] = [];
      byYear[y].push(r);
    });

    // Años en orden descendente
    const years = Object.keys(byYear).map(Number).sort((a, b) => b - a);

    // ── Renderizar acordeón ──────────────────────────────────────
    const showCombined = properties.length > 1;

    lista.innerHTML = years.map(year => {
      const cardsHTML = byYear[year].map(r => {
        const mes = r.label.split(' ')[0]; // "Febrero" de "Febrero 2026"
        const amt = (r.airbnbTotal != null && r.airbnbTotal !== 0)
          ? `$${Number(r.airbnbTotal).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
          : '—';
        return `
          <div class="history-card">
            <div class="history-card-month">${mes}</div>
            <div class="history-card-amount">${amt}</div>
            <div class="history-card-meta">
              ${getMatchBadge(r.matchRate || '0%')}
            </div>
            <div class="history-card-actions">
              <button class="btn--ver"
                      onclick="loadSavedReport('${r.month}')">Ver</button>
              <button class="btn--ia"
                      onclick="viewSavedAnalysis('${r.month}', '${r.label}')"
                      title="Análisis IA de ${r.label}">✦</button>
              <button class="btn--del"
                      onclick="deleteReport('${r.month}', '${r.label}')"
                      title="Eliminar reporte de ${r.label}">🗑</button>
            </div>
          </div>`;
      }).join('');

      const combinedBtn = showCombined
        ? `<button class="btn--combined-inline"
                   onclick="downloadCombinedReport(${year})"
                   title="Descargar Excel combinado de todas las casas (${year})">
             ⊕ Combinado
           </button>`
        : '';

      return `
        <div class="history-year">
          <div class="history-year-header">
            <button class="history-year-toggle" onclick="toggleYear(${year})">
              <span class="history-year-label">${year}</span>
              <span class="history-year-count">${byYear[year].length} meses</span>
            </button>
            <button class="btn--annual-inline"
                    onclick="downloadAnnualReport(${year})"
                    title="Descargar reporte anual ${year}">
              ↓ Excel ${year}
            </button>
            <button class="btn--annual-inline btn--annual-pdf"
                    onclick="downloadExecutivePDF(${year})"
                    title="Reporte ejecutivo PDF ${year}">
              ↓ PDF ${year}
            </button>
            ${combinedBtn}
            <button class="history-year-chevron"
                    onclick="toggleYear(${year})"
                    id="chevron-${year}"
                    aria-expanded="false">›</button>
          </div>
          <div class="history-year-body" id="year-body-${year}" hidden>
            <div class="history-grid">${cardsHTML}</div>
          </div>
        </div>`;
    }).join('');

  } catch (e) {
    lista.innerHTML = `<p class="history-empty" style="color:var(--color-primary)">Error: ${e.message}</p>`;
  }
}

/** Expande o contrae el grupo de meses de un año en el historial */
function toggleYear(year) {
  const body    = document.getElementById(`year-body-${year}`);
  const chevron = document.getElementById(`chevron-${year}`);
  if (!body) return;
  const isOpen  = !body.hidden;
  body.hidden   = isOpen;
  if (chevron) chevron.setAttribute('aria-expanded', String(!isOpen));
}

// Exponer en window para que los onclick generados dinámicamente puedan llamarla
window.toggleYear = toggleYear;

/** Descarga el reporte anual en Excel para el año y la propiedad activa */
async function downloadAnnualReport(year) {
  try {
    const propParam = activePropertyId ? `?propertyId=${activePropertyId}` : '';
    const res = await fetch(`/api/reports/annual/${year}${propParam}`, { credentials: 'include' });

    if (res.status === 401) {
      openLoginModal();
      return;
    }
    if (res.status === 404) {
      alert(`No hay reportes guardados para ${year}`);
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || `Error al generar el reporte anual de ${year}`);
      return;
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `Reporte_Anual_${year}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

  } catch (e) {
    alert(`Error al descargar el reporte anual: ${e.message}`);
  }
}

window.downloadAnnualReport = downloadAnnualReport;

/** Descarga el reporte ejecutivo PDF para el año */
async function downloadExecutivePDF(year) {
  try {
    const res = await fetch(`/api/reports/executive-pdf/${year}`, { credentials: 'include' });
    if (!res.ok) { alert('Error generando el PDF ejecutivo'); return; }
    const blob = await res.blob();
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `Reporte_Ejecutivo_${year}.pdf`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert(`Error: ${e.message}`);
  }
}
window.downloadExecutivePDF = downloadExecutivePDF;

/** Descarga el reporte anual combinado (todas las propiedades) para un año */
async function downloadCombinedReport(year) {
  try {
    const res = await fetch(`/api/properties/combined/${year}`, { credentials: 'include' });

    if (res.status === 401) { openLoginModal(); return; }
    if (res.status === 404) {
      alert(`No hay reportes guardados para ${year}`);
      return;
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert(err.error || `Error al generar el reporte combinado de ${year}`);
      return;
    }

    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `Reporte_Anual_${year}_Combinado.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    alert(`Error al descargar el reporte combinado: ${e.message}`);
  }
}

window.downloadCombinedReport = downloadCombinedReport;

// ══════════════════════════════════════════════════════════════
// GESTIÓN DE PROPIEDADES
// ══════════════════════════════════════════════════════════════

/**
 * loadProperties — Obtiene las propiedades del usuario y puebla el selector.
 * Mantiene la propiedad activa si sigue existiendo.
 */
async function loadProperties() {
  try {
    const res = await fetch('/api/properties', { credentials: 'include' });
    if (!res.ok) return;
    const data  = await res.json();
    properties  = data.properties || [];

    const select  = document.getElementById('property-select');
    const propBar = document.getElementById('property-bar');
    if (!select || !propBar) return;

    if (properties.length === 0) {
      propBar.hidden = true;
      return;
    }

    // Poblar el <select>
    select.innerHTML = properties.map(p =>
      `<option value="${p.id}">${p.name}</option>`
    ).join('');

    // Mantener la propiedad activa si aún existe; si no, usar la primera
    const stillExists = activePropertyId && properties.find(p => p.id === activePropertyId);
    if (!stillExists) {
      activePropertyId = properties[0].id;
    }
    select.value   = activePropertyId;
    propBar.hidden = false;

    // Botón eliminar: solo visible cuando hay 2+ propiedades
    const delBtn = document.getElementById('delete-property-btn');
    if (delBtn) delBtn.hidden = (properties.length <= 1);
  } catch (e) {
    console.error('[props] Error cargando propiedades:', e.message);
  }
}

/**
 * changeProperty — Cambia la propiedad activa y recarga el historial.
 * Llamado por el onchange del <select>.
 */
function changeProperty(id) {
  activePropertyId = parseInt(id, 10);
  if (historialVisible) loadHistory();
  loadDashboard();
}

window.changeProperty = changeProperty;

// ── Dashboard de métricas anuales ──────────────────────────────
let dashboardChart = null;

/** Carga las métricas del año actual y renderiza el dashboard */
async function loadDashboard() {
  if (!Auth.user || !activePropertyId) return;
  const year = new Date().getFullYear();
  try {
    const res = await fetch(`/api/reports/dashboard/${year}?propertyId=${activePropertyId}`, {
      credentials: 'include',
    });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.success || data.mesesActivos === 0) {
      document.getElementById('dashboard-section').hidden = true;
      return;
    }
    renderDashboard(data);
  } catch (e) {
    console.error('[dashboard] Error:', e.message);
  }
}

/** Renderiza las 5 tarjetas KPI y la comparativa YoY */
function renderDashboard(data) {
  const section      = document.getElementById('dashboard-section');
  const grid         = document.getElementById('dashboard-grid');
  const compareEl    = document.getElementById('dashboard-compare');
  const compareItems = document.getElementById('dashboard-compare-items');
  const yearLabel    = document.getElementById('dashboard-year-label');
  const prevYearEl   = document.getElementById('dashboard-prev-year');
  const metaLabel    = document.getElementById('dashboard-meta-label');
  const toggleIcon   = document.querySelector('.dashboard-toggle-icon');

  const { metricas, variaciones, year, prevYear: prevYearNum, mesesActivos } = data;

  yearLabel.textContent = year;
  if (prevYearEl) prevYearEl.textContent = prevYearNum;
  if (metaLabel)  metaLabel.textContent  = `${mesesActivos} mes${mesesActivos !== 1 ? 'es' : ''} activo${mesesActivos !== 1 ? 's' : ''}`;

  const fmt = n => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n ?? 0);
  const fmtN = n => (n ?? 0).toLocaleString('es-MX');

  const cards = [
    { label: 'Ingresos netos',   value: fmt(metricas.ingresoTotal),    cls: 'coral', sub: `${year}` },
    { label: 'Noches ocupadas',  value: fmtN(metricas.nochesTotal),    cls: '',      sub: 'total del año' },
    { label: 'Ocupación',        value: `${metricas.ocupacion}%`,      cls: metricas.ocupacion >= 60 ? 'green' : '', sub: 'de disponibilidad' },
    { label: 'ADR',              value: fmt(metricas.adr),             cls: '',      sub: 'ingreso por noche' },
    { label: 'Mejor mes',        value: metricas.mejorMes || '—',      cls: 'green', sub: metricas.mejorMes ? fmt(metricas.mejorMesIngreso) : '' },
  ];

  grid.innerHTML = cards.map(c => `
    <div class="dashboard-card">
      <span class="dashboard-card__label">${c.label}</span>
      <span class="dashboard-card__value${c.cls ? ' ' + c.cls : ''}">${c.value}</span>
      ${c.sub ? `<span class="dashboard-card__sub">${c.sub}</span>` : ''}
    </div>
  `).join('');

  // Comparativa YoY
  const hasVar = variaciones.ingreso !== null || variaciones.noches !== null;
  if (hasVar && compareEl && compareItems) {
    const varItems = [];
    if (variaciones.ingreso !== null) {
      const sign = variaciones.ingreso > 0 ? '+' : '';
      const cls  = variaciones.ingreso > 0 ? 'up' : variaciones.ingreso < 0 ? 'down' : 'neutral';
      varItems.push({ name: 'Ingresos', val: `${sign}${variaciones.ingreso}%`, cls });
    }
    if (variaciones.noches !== null) {
      const sign = variaciones.noches > 0 ? '+' : '';
      const cls  = variaciones.noches > 0 ? 'up' : variaciones.noches < 0 ? 'down' : 'neutral';
      varItems.push({ name: 'Noches', val: `${sign}${variaciones.noches}%`, cls });
    }
    compareItems.innerHTML = varItems.map(i => `
      <span class="dashboard-compare-item">
        <span class="dashboard-compare-item__name">${i.name}</span>
        <span class="dashboard-compare-item__val ${i.cls}">${i.val}</span>
      </span>
    `).join('');
    compareEl.hidden = false;
  } else if (compareEl) {
    compareEl.hidden = true;
  }

  // Restaurar estado del toggle
  const body = document.getElementById('dashboard-body');
  if (body && toggleIcon) {
    const isCollapsed = body.classList.contains('collapsed');
    toggleIcon.classList.toggle('open', !isCollapsed);
  }

  if (data.mesesData) {
    renderDashboardChart(data.mesesData, data.year, data.prevYear);
  }

  section.hidden = false;
}

/** Renderiza la gráfica de barras mensuales con Chart.js */
function renderDashboardChart(mesesData, year, prevYear) {
  const canvas = document.getElementById('dashboard-chart');
  if (!canvas) return;

  if (dashboardChart) {
    dashboardChart.destroy();
    dashboardChart = null;
  }

  const ctx      = canvas.getContext('2d');
  const labels   = mesesData.map(m => m.mes);
  const actual   = mesesData.map(m => m.actual);
  const anterior = mesesData.map(m => m.anterior);

  dashboardChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label:               String(prevYear),
          data:                anterior,
          backgroundColor:     'rgba(255,255,255,0.15)',
          borderColor:         'rgba(255,255,255,0.3)',
          borderWidth:         1,
          borderRadius:        4,
          barPercentage:       0.5,
          categoryPercentage:  0.8,
        },
        {
          label:               String(year),
          data:                actual,
          backgroundColor:     '#FF5A5F',
          borderColor:         '#FF5A5F',
          borderWidth:         0,
          borderRadius:        4,
          barPercentage:       0.5,
          categoryPercentage:  0.8,
        },
      ],
    },
    options: {
      responsive:          true,
      maintainAspectRatio: false,
      animation: { duration: 600, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          display:  true,
          position: 'top',
          align:    'end',
          labels: {
            color:        'rgba(255,255,255,0.5)',
            font:         { family: "'DM Mono', monospace", size: 10 },
            boxWidth:     10,
            boxHeight:    10,
            borderRadius: 2,
            padding:      12,
          },
        },
        tooltip: {
          backgroundColor: '#1a1a1a',
          borderColor:     'rgba(255,255,255,0.1)',
          borderWidth:     1,
          titleColor:      'rgba(255,255,255,0.5)',
          bodyColor:       '#fff',
          titleFont:       { family: "'DM Mono', monospace", size: 10 },
          bodyFont:        { family: "'DM Serif Display', serif", size: 13 },
          padding:         10,
          callbacks: {
            label: ctx => {
              const val = ctx.parsed.y;
              if (val === 0) return ' Sin datos';
              return ` $${val.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} MXN`;
            },
          },
        },
      },
      scales: {
        x: {
          grid:   { display: false },
          ticks:  { color: 'rgba(255,255,255,0.35)', font: { family: "'DM Mono', monospace", size: 9 } },
          border: { color: 'rgba(255,255,255,0.08)' },
        },
        y: {
          grid:   { color: 'rgba(255,255,255,0.05)', drawBorder: false },
          ticks: {
            color:         'rgba(255,255,255,0.35)',
            font:          { family: "'DM Mono', monospace", size: 9 },
            maxTicksLimit: 5,
            callback:      val => '$' + (val / 1000).toFixed(0) + 'k',
          },
          border: { display: false },
        },
      },
    },
  });
}

/** Colapsa / expande el cuerpo del dashboard */
function toggleDashboard() {
  const body       = document.getElementById('dashboard-body');
  const toggleIcon = document.querySelector('.dashboard-toggle-icon');
  const btn        = document.getElementById('dashboard-toggle-btn');
  if (!body) return;

  const collapsed = body.classList.toggle('collapsed');
  if (toggleIcon) toggleIcon.classList.toggle('open', !collapsed);
  if (btn) btn.setAttribute('aria-expanded', String(!collapsed));
}

window.toggleDashboard = toggleDashboard;

// ── Modal: Nueva casa ──────────────────────────────────────────

function openNewPropertyModal() {
  document.getElementById('new-property-modal').hidden = false;
  document.getElementById('new-property-name').focus();
}

function closeNewPropertyModal() {
  document.getElementById('new-property-modal').hidden = true;
  document.getElementById('new-property-error').hidden = true;
  document.getElementById('new-property-form').reset();
}

async function submitNewProperty(event) {
  event.preventDefault();
  const btn  = document.getElementById('new-property-submit-btn');
  const err  = document.getElementById('new-property-error');
  const name = document.getElementById('new-property-name').value.trim();

  btn.disabled    = true;
  btn.textContent = 'Creando…';
  err.hidden      = true;

  try {
    const res  = await fetch('/api/properties', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al crear la propiedad');

    closeNewPropertyModal();
    await loadProperties();

    // Cambiar automáticamente a la nueva propiedad
    const newId = data.property?.id;
    if (newId) {
      activePropertyId = newId;
      const select = document.getElementById('property-select');
      if (select) select.value = newId;
    }
    if (historialVisible) loadHistory();
  } catch (e) {
    err.textContent = e.message;
    err.hidden      = false;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Crear casa';
  }
}

window.openNewPropertyModal  = openNewPropertyModal;
window.closeNewPropertyModal = closeNewPropertyModal;
window.submitNewProperty     = submitNewProperty;

// ── Modal: Renombrar casa ──────────────────────────────────────

/**
 * openRenamePropertyModal — Abre el modal con el nombre actual de la propiedad.
 * Si se llama sin argumento, renombra la propiedad activa.
 */
function openRenamePropertyModal(id) {
  renamingPropertyId = id || activePropertyId;
  const prop = properties.find(p => p.id === renamingPropertyId);
  const input = document.getElementById('rename-property-name');
  if (input) {
    input.value = prop?.name || '';
    document.getElementById('rename-property-modal').hidden = false;
    input.select();
    input.focus();
  }
}

function closeRenamePropertyModal() {
  document.getElementById('rename-property-modal').hidden = true;
  document.getElementById('rename-property-error').hidden = true;
  renamingPropertyId = null;
}

async function submitRenameProperty(event) {
  event.preventDefault();
  const btn  = document.getElementById('rename-property-submit-btn');
  const err  = document.getElementById('rename-property-error');
  const name = document.getElementById('rename-property-name').value.trim();

  if (!renamingPropertyId) {
    closeRenamePropertyModal();
    return;
  }

  btn.disabled    = true;
  btn.textContent = 'Guardando…';
  err.hidden      = true;

  try {
    const res  = await fetch(`/api/properties/${renamingPropertyId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al renombrar la propiedad');

    closeRenamePropertyModal();
    await loadProperties();
    if (historialVisible) loadHistory();
  } catch (e) {
    err.textContent = e.message;
    err.hidden      = false;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Guardar nombre';
  }
}

window.openRenamePropertyModal  = openRenamePropertyModal;
window.closeRenamePropertyModal = closeRenamePropertyModal;
window.submitRenameProperty     = submitRenameProperty;

// ── Eliminar casa activa ───────────────────────────────────────

/**
 * deleteActiveProperty — Pide confirmación y elimina la propiedad activa.
 * Solo disponible cuando hay 2+ propiedades (el botón queda hidden en caso contrario).
 */
async function deleteActiveProperty() {
  const prop = properties.find(p => p.id === activePropertyId);
  if (!prop) return;

  const ok = window.confirm(
    `¿Eliminar "${prop.name}"? Esta acción no se puede deshacer.\n` +
    `Solo se puede eliminar si no tiene reportes guardados.`
  );
  if (!ok) return;

  try {
    const res  = await fetch(`/api/properties/${activePropertyId}`, {
      method:  'DELETE',
      credentials: 'include',
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Error al eliminar la propiedad');
      return;
    }

    // Cambiar a la primera propiedad disponible y recargar
    activePropertyId = null;
    await loadProperties();
    actualizarNavbar();
    if (historialVisible) loadHistory();
  } catch (e) {
    alert(`Error al eliminar: ${e.message}`);
  }
}

window.deleteActiveProperty = deleteActiveProperty;

// ── Eliminar reporte individual ────────────────────────────────

/**
 * deleteReport — Pide confirmación y elimina el reporte de un mes.
 * Llama a DELETE /api/reports/:month?propertyId=N
 */
async function deleteReport(month, label) {
  const ok = window.confirm(
    `¿Eliminar el reporte de ${label}? Esta acción no se puede deshacer.`
  );
  if (!ok) return;

  try {
    const propParam = activePropertyId ? `?propertyId=${activePropertyId}` : '';
    const res  = await fetch(`/api/reports/${month}${propParam}`, {
      method:      'DELETE',
      credentials: 'include',
    });
    const data = await res.json();

    if (!res.ok) {
      alert(data.error || 'Error al eliminar el reporte');
      return;
    }

    // Recargar el historial para reflejar el cambio
    loadHistory();
  } catch (e) {
    alert(`Error al eliminar: ${e.message}`);
  }
}

window.deleteReport = deleteReport;

/** Carga un reporte guardado y lo renderiza en la sección de resultados */
async function loadSavedReport(month) {
  try {
    const propParam = activePropertyId ? `?propertyId=${activePropertyId}` : '';
    const res    = await fetch(`/api/reports/${month}${propParam}`);
    const report = await res.json();
    if (!res.ok) throw new Error(report.error || 'Error al cargar reporte');

    // Cerrar el historial y renderizar el reporte
    historialVisible = true;
    toggleHistory();
    // renderReport está en el IIFE de abajo y es accesible via window
    if (typeof window._renderReport === 'function') {
      window._renderReport(report);
    }
  } catch (e) {
    alert(`Error al cargar el reporte: ${e.message}`);
  }
}

// ══════════════════════════════════════════════════════════════
// MÓDULO DE MERCADO DE RENTAS — Lamudi crawler
// Llama a GET /api/crawler/listings y renderiza cards de listings
// ══════════════════════════════════════════════════════════════

/**
 * loadMarketListings — Dispara el crawl y renderiza los resultados en el DOM
 *
 * ¿Por qué está en scope global y no dentro del IIFE de abajo?
 * El botón en el HTML usa onclick="loadMarketListings()", que requiere
 * que la función esté en el scope global (window). El IIFE encapsula
 * el módulo de uploads/reporte para evitar colisiones de variables,
 * pero las funciones de UI general viven aquí, en scope global.
 *
 * ¿Por qué no encolamos el crawl como el análisis?
 * GET /api/crawler/listings es síncrono y tarda 3-6 segundos —
 * acceptable para un request HTTP. POST /api/crawler/analyze encola
 * porque suma el crawl + Claude API (hasta 21 segundos en total).
 */
async function loadMarketListings() {
  const loaderEl   = document.getElementById('market-loader');
  const gridEl     = document.getElementById('market-grid');
  const statsEl    = document.getElementById('market-stats');
  const messageEl  = document.getElementById('market-message');
  const updatedEl  = document.getElementById('market-updated');
  const refreshBtn = document.getElementById('market-refresh-btn');

  // Mostrar loader y limpiar estado anterior
  loaderEl.hidden   = false;
  gridEl.innerHTML  = '';
  statsEl.hidden    = true;
  messageEl.hidden  = true;
  if (refreshBtn) refreshBtn.disabled = true;

  try {
    const res = await fetch('/api/crawler/listings', { credentials: 'include' });

    // 401 — endpoint protegido, sesión expirada
    if (res.status === 401) {
      messageEl.textContent = 'Tu sesión expiró. Inicia sesión de nuevo para ver el mercado.';
      messageEl.hidden      = false;
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al obtener los listings');

    // data tiene forma: { status, listings, summary, errors, scrapedAt }
    const listings = data.listings || [];

    if (listings.length === 0) {
      messageEl.textContent = 'No se encontraron listings disponibles en este momento. Intenta de nuevo en unos minutos.';
      messageEl.hidden      = false;
      return;
    }

    // Renderizar estadísticas y cards
    renderMarketStats(listings, statsEl);
    renderMarketCards(listings, gridEl);

    // Actualizar la línea de timestamp bajo el título
    const hora = new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
    updatedEl.textContent = `Última actualización: hoy a las ${hora} · ${listings.length} listings de Lamudi`;

  } catch (err) {
    messageEl.textContent = `Error al obtener el mercado: ${err.message}. Intenta de nuevo.`;
    messageEl.hidden      = false;
  } finally {
    // Siempre ocultar el loader al terminar, con éxito o con error
    loaderEl.hidden = true;
    if (refreshBtn) refreshBtn.disabled = false;
  }
}

/**
 * renderMarketStats — Calcula y pinta las 4 tarjetas de estadísticas
 *
 * @param {Array}   listings  - Array de listings normalizados
 * @param {Element} container - El elemento .market-stats del DOM
 */
function renderMarketStats(listings, container) {
  // Solo los listings que tienen precio válido participan en las estadísticas
  const prices = listings.map(l => l.price).filter(p => typeof p === 'number' && p > 0);
  if (prices.length === 0) return;

  const sum = prices.reduce((acc, p) => acc + p, 0);
  const avg = sum / prices.length;
  const min = Math.min(...prices);
  const max = Math.max(...prices);

  // Formateador de moneda MXN sin decimales (más legible en precios de renta)
  const fmt = n => new Intl.NumberFormat('es-MX', {
    style:                'currency',
    currency:             'MXN',
    maximumFractionDigits: 0,
  }).format(n);

  document.getElementById('market-stat-total').textContent = listings.length;
  document.getElementById('market-stat-avg').textContent   = fmt(avg);
  document.getElementById('market-stat-min').textContent   = fmt(min);
  document.getElementById('market-stat-max').textContent   = fmt(max);

  container.hidden = false;
}

/**
 * renderMarketCards — Genera una card de listing por cada elemento del array
 *
 * Usa template literals y escapeHtml para evitar XSS: los datos
 * vienen de un sitio externo (Lamudi) y podrían contener HTML malicioso.
 *
 * @param {Array}   listings - Array de listings normalizados
 * @param {Element} grid     - El elemento .market-grid del DOM
 */
function renderMarketCards(listings, grid) {
  const fmt = n => new Intl.NumberFormat('es-MX', {
    style:                'currency',
    currency:             'MXN',
    maximumFractionDigits: 0,
  }).format(n);

  grid.innerHTML = listings.map(l => `
    <div class="market-card">
      <div class="market-card__top">
        <span class="market-card__price">
          ${fmt(l.price)}
          <span class="market-card__per-month">/mes</span>
        </span>
        <span class="market-card__source">${escapeHtml(l.source)}</span>
      </div>

      <p class="market-card__title">${escapeHtml(l.title)}</p>

      <p class="market-card__location">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        ${escapeHtml(l.location)}
      </p>

      ${l.features
        ? `<p class="market-card__features">${escapeHtml(l.features)}</p>`
        : ''}

      ${l.url
        ? `<a class="market-card__link"
              href="${escapeHtml(l.url)}"
              target="_blank"
              rel="noopener noreferrer">Ver en Lamudi →</a>`
        : ''}
    </div>
  `).join('');

  // Revelar el botón de análisis IA ahora que tenemos listings con precios
  const analyzeRow = document.getElementById('market-analyze-row');
  if (analyzeRow) analyzeRow.hidden = false;
}

/**
 * escapeHtml — Sanitiza un string antes de insertarlo como innerHTML
 *
 * ¿Por qué es crítico aquí?
 * Los títulos y ubicaciones vienen de Lamudi (fuente externa). Si un
 * listing tuviera "<script>alert('xss')</script>" en el título y lo
 * insertamos directamente con innerHTML, ese script se ejecutaría en el
 * navegador del usuario. Este helper convierte los caracteres especiales
 * a entidades HTML seguras antes de la inserción.
 *
 * Alternativa descartada: usar textContent en vez de innerHTML. Pero
 * necesitamos innerHTML para poder generar la estructura de la card
 * completa con template literals. Por eso sanitizamos manualmente cada
 * campo que viene del exterior.
 *
 * @param {string} str - String a sanitizar
 * @returns {string} String con caracteres HTML escapados
 */
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * analyzeMarketUI — Dispara el análisis de mercado con Claude y renderiza el resultado.
 *
 * Flujo:
 *   1. Lee el precio promedio actual del DOM (ya calculado por renderMarketStats)
 *   2. POST /api/crawler/analyze con { currentRate: promedio }
 *   3. Polling a GET /api/jobs/:jobId cada 3s, máximo 20 intentos (60s timeout)
 *   4. Cuando status === "completed": renderiza job.result.analysis como HTML
 *   5. Cuando status === "failed" o timeout: muestra error claro
 *
 * ¿Por qué leer el promedio del DOM en lugar de recalcularlo?
 * renderMarketStats ya filtró los precios válidos y calculó el promedio.
 * Releer ese valor evita duplicar la lógica de filtrado (DRY).
 * El texto del span puede tener formato "$12,500", así que limpiamos
 * los caracteres no numéricos antes de parsearlo.
 */
async function analyzeMarketUI() {
  const btn         = document.getElementById('market-analyze-btn');
  const container   = document.getElementById('market-analysis-container');
  const POLL_MS     = 3000; // intervalo entre intentos de polling
  const MAX_POLLS   = 20;   // 20 × 3s = 60 segundos máximo

  // Deshabilitar el botón durante todo el proceso para evitar doble disparo
  btn.disabled    = true;
  btn.textContent = 'Analizando…';

  // Mostrar el contenedor vacío con un mensaje de espera mientras se encola y procesa
  container.hidden    = false;
  container.innerHTML = `
    <div class="market-analysis__loading">
      <div class="loader__spinner"></div>
      <p>Claude está analizando el mercado de rentas en Mérida…<br>
         <small>Esto puede tomar hasta 60 segundos.</small></p>
    </div>`;

  try {
    // Paso 1 — Encolar el job de análisis en el backend (responde 202 inmediatamente)
    const postRes = await fetch('/api/crawler/analyze', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({}),
    });

    if (!postRes.ok) {
      const err = await postRes.json().catch(() => ({}));
      throw new Error(err.error || `Error ${postRes.status} al iniciar el análisis`);
    }

    const { jobId } = await postRes.json();

    // Paso 2 — Polling hasta que el job termine o se agote el tiempo
    let attempts = 0;
    while (attempts < MAX_POLLS) {
      await new Promise(resolve => setTimeout(resolve, POLL_MS));
      attempts++;

      const pollRes = await fetch(`/api/jobs/${jobId}`, { credentials: 'include' });

      if (!pollRes.ok) {
        throw new Error(`Error ${pollRes.status} al consultar el estado del job`);
      }

      const job = await pollRes.json();

      if (job.status === 'completed') {
        // Paso 3a — Renderizar el análisis de Claude
        // markdownToHtml convierte los encabezados y listas del texto de Claude
        // a HTML legible sin necesidad de una librería externa
        container.innerHTML = `
          <div class="market-analysis__header">
            <span class="market-analysis__badge">✦ Análisis IA</span>
            <span class="market-analysis__meta">Generado con Claude · ${new Date().toLocaleTimeString('es-MX')}</span>
          </div>
          <div class="market-analysis__body">
            ${markdownToHtml(job.analysisText || 'Sin contenido en el resultado.')}
          </div>`;
        return; // salir del loop — trabajo terminado
      }

      if (job.status === 'failed') {
        throw new Error(job.error || 'El análisis falló en el servidor');
      }
      // Si status === 'pending' o 'processing', seguir esperando
    }

    // Se agotaron los 20 intentos sin respuesta
    throw new Error('Tiempo de espera agotado (60 s). El servidor tardó demasiado. Intenta de nuevo.');

  } catch (err) {
    container.innerHTML = `
      <div class="market-analysis__error">
        <strong>No se pudo completar el análisis</strong>
        <p>${escapeHtml(err.message)}</p>
      </div>`;
  } finally {
    // Siempre rehabilitar el botón, sin importar si hubo éxito o error
    btn.disabled    = false;
    btn.textContent = '✦ Analizar con IA';
  }
}

function markdownToHtml(text) {
  if (!text) return '';

  const lines = text.split('\n');
  let html = '';
  let inList = false;
  let inTable = false;
  let tableRows = [];

  const flushTable = () => {
    if (tableRows.length < 2) { html += tableRows.map(r => `<p>${r}</p>`).join(''); tableRows = []; inTable = false; return; }
    const headers = tableRows[0].split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
    const body = tableRows.slice(2).map(row => {
      const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    html += `<table class="market-analysis__table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
    tableRows = [];
    inTable = false;
  };

  for (const raw of lines) {
    const line = raw.trim();
    const isTableRow = line.startsWith('|') && line.endsWith('|');
    const isSeparator = /^\|[\s\-|]+\|$/.test(line);

    if (isTableRow) {
      if (inList) { html += '</ul>'; inList = false; }
      if (!isSeparator) tableRows.push(line);
      else tableRows.push(line);
      inTable = true;
      continue;
    }

    if (inTable) flushTable();

    if (!line) {
      if (inList) { html += '</ul>'; inList = false; }
      continue;
    }

    if (/^#{1,2}\s/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2 class="market-analysis__heading">${line.replace(/^#{1,2}\s/, '')}</h2>`;
      continue;
    }

    if (/^#{3,}\s/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3 class="market-analysis__subheading">${line.replace(/^#{3,}\s/, '')}</h3>`;
      continue;
    }

    if (/^[-*]\s/.test(line)) {
      if (!inList) { html += '<ul class="market-analysis__list">'; inList = true; }
      html += `<li>${formatInline(line.replace(/^[-*]\s/, ''))}</li>`;
      continue;
    }

    if (/^>/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<blockquote class="market-analysis__quote">${formatInline(line.replace(/^>\s?/, ''))}</blockquote>`;
      continue;
    }

    if (line === '---' || line === '***') {
      if (inList) { html += '</ul>'; inList = false; }
      html += '<hr class="market-analysis__divider">';
      continue;
    }

    if (inList) { html += '</ul>'; inList = false; }
    html += `<p>${formatInline(line)}</p>`;
  }

  if (inList) html += '</ul>';
  if (inTable) flushTable();

  return html;
}

function formatInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
}

// Exponer al scope global para que el onclick del HTML pueda llamarlas
window.loadMarketListings = loadMarketListings;
window.analyzeMarketUI    = analyzeMarketUI;

// Arrancar verificación de sesión al cargar el DOM
document.addEventListener('DOMContentLoaded', initAuth);

// ══════════════════════════════════════════════════════════════
// MÓDULO PRINCIPAL (uploads, reporte, render)
// ══════════════════════════════════════════════════════════════

(() => {
  // ── Referencias al DOM ─────────────────────────────────────────
  const airbnbInput        = document.getElementById('airbnb-input');
  const bankInput1         = document.getElementById('bank-input-1');
  const bankInput2         = document.getElementById('bank-input-2');
  const airbnbZone         = document.getElementById('airbnb-zone');
  const bankZone1          = document.getElementById('bank-zone-1');
  const bankZone2          = document.getElementById('bank-zone-2');
  const airbnbStatus       = document.getElementById('airbnb-status');
  const bankStatus1        = document.getElementById('bank-status-1');
  const bankStatus2        = document.getElementById('bank-status-2');
  const airbnbFormatBadge  = document.getElementById('airbnb-format-badge');
  const generateBtn        = document.getElementById('generate-btn');
  const resetBtn           = document.getElementById('reset-btn');
  const actionHint         = document.getElementById('action-hint');
  const resultsSection     = document.getElementById('results-section');
  const totalsGrid         = document.getElementById('totals-grid');
  const bankSourcesEl      = document.getElementById('bank-sources');
  const sourcePdf1El       = document.getElementById('source-pdf1');
  const sourcePdf2El       = document.getElementById('source-pdf2');
  const loader             = document.getElementById('loader');
  const errorBanner        = document.getElementById('error-banner');

  // Estado de los uploads
  const state = {
    airbnbUploaded: false,
    bank1Uploaded:  false,
    bank2Uploaded:  false, // Opcional — no bloquea el botón
  };

  // ── Drag & drop en todas las zonas ──────────────────────────────
  [airbnbZone, bankZone1, bankZone2].forEach(zone => {
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const input = zone.querySelector('input[type="file"]');
      if (e.dataTransfer.files.length) {
        const dt = new DataTransfer();
        dt.items.add(e.dataTransfer.files[0]);
        input.files = dt.files;
        input.dispatchEvent(new Event('change'));
      }
    });
  });

  // ── Handlers de selección de archivo ───────────────────────────
  airbnbInput.addEventListener('change', () => uploadFile(airbnbInput, 'airbnb'));
  bankInput1.addEventListener('change',  () => uploadFile(bankInput1, 'bank', 1));
  bankInput2.addEventListener('change',  () => uploadFile(bankInput2, 'bank', 2));

  /**
   * uploadFile — Valida el archivo en el cliente y lo envía al servidor
   * @param {HTMLInputElement} input
   * @param {'airbnb'|'bank'} type
   * @param {1|2} [bankSlot] - Solo aplica cuando type === 'bank'
   */
  async function uploadFile(input, type, bankSlot) {
    const file = input.files[0];
    if (!file) return;

    const zone   = type === 'airbnb' ? airbnbZone  : bankSlot === 1 ? bankZone1  : bankZone2;
    const status = type === 'airbnb' ? airbnbStatus : bankSlot === 1 ? bankStatus1 : bankStatus2;

    // Validación básica en el cliente
    const ext = file.name.split('.').pop().toLowerCase();
    if (type === 'airbnb' && !['pdf', 'csv'].includes(ext)) {
      showStatus(status, 'Solo se aceptan archivos PDF o CSV', 'error');
      zone.classList.remove('has-file');
      return;
    }
    if (type === 'bank' && ext !== 'pdf') {
      showStatus(status, 'Solo se aceptan archivos PDF para el banco', 'error');
      zone.classList.remove('has-file');
      return;
    }

    showStatus(status, 'Subiendo...', '');
    hideError();

    try {
      const formData = new FormData();

      if (type === 'airbnb') {
        formData.append('pdf', file); // El endpoint Airbnb usa campo "pdf"
        const res  = await fetch('/api/upload/airbnb', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al subir el archivo');

        showStatus(status, `✓ ${file.name}`, '');
        zone.classList.add('has-file');
        state.airbnbUploaded = true;

        // Mostrar badge de formato detectado
        showFormatBadge(ext);

      } else {
        formData.append('bankPdf', file); // El endpoint bancario usa campo "bankPdf"
        formData.append('slot', String(bankSlot));
        const res  = await fetch('/api/upload/bank', { method: 'POST', body: formData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error al subir el archivo');

        showStatus(status, `✓ ${file.name}`, '');
        zone.classList.add('has-file');
        if (bankSlot === 1) state.bank1Uploaded = true;
        else                state.bank2Uploaded = true;
      }

    } catch (err) {
      showStatus(status, `✗ ${err.message}`, 'error');
      zone.classList.remove('has-file');
      if (type === 'airbnb')       { state.airbnbUploaded = false; airbnbFormatBadge.hidden = true; }
      else if (bankSlot === 1)     state.bank1Uploaded = false;
      else                         state.bank2Uploaded = false;
    }

    updateGenerateButton();
  }

  // ── Badge de formato CSV/PDF ────────────────────────────────────
  function showFormatBadge(ext) {
    airbnbFormatBadge.textContent = ext.toUpperCase();
    airbnbFormatBadge.className   = `format-badge format-badge--${ext}`;
    airbnbFormatBadge.hidden      = false;
  }

  // ── Habilitar botón cuando los archivos requeridos están listos ─
  function updateGenerateButton() {
    const ready = state.airbnbUploaded && state.bank1Uploaded;
    generateBtn.disabled = !ready;
    if (ready) {
      const extra = state.bank2Uploaded ? ' (2 PDFs bancarios)' : '';
      actionHint.textContent = `Archivos listos${extra}. Haz clic para comparar.`;
    } else {
      actionHint.textContent = 'Sube el reporte Airbnb y al menos el PDF bancario Parte 1';
    }
  }

  // ── Generar el reporte ─────────────────────────────────────────
  generateBtn.addEventListener('click', async () => {
    showLoader(true);
    hideError();
    hideDiscrepancyBanner();
    resultsSection.hidden = true;
    resetBtn.hidden       = true;

    try {
      const res    = await fetch('/api/report');
      const report = await res.json();
      if (!res.ok) throw new Error(report.error || 'Error al generar el reporte');
      renderReport(report);
      resetBtn.hidden = false;
    } catch (err) {
      showError(err.message);
    } finally {
      showLoader(false);
    }
  });

  // Exponer renderReport para que loadSavedReport() del módulo Auth pueda usarla
  window._renderReport = (report) => {
    hideDiscrepancyBanner();
    renderReport(report);
    resultsSection.hidden = false;
    resetBtn.hidden       = false;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── Reset de resultados ────────────────────────────────────────
  resetBtn.addEventListener('click', async () => {
    try { await fetch('/api/reset', { method: 'POST' }); } catch (_) {}
    resultsSection.hidden  = true;
    resetBtn.hidden        = true;
    Auth.reporteActual     = null;  // Limpiar reporte del estado de auth
    actualizarBotonGuardar();
    hideDiscrepancyBanner();
    updateGenerateButton();
    // Ocultar botones de análisis IA
    const btnA = document.getElementById('btn-analysis');
    const btnP = document.getElementById('btn-analysis-pdf');
    if (btnA) btnA.hidden = true;
    if (btnP) btnP.hidden = true;
    const pairB = document.getElementById('action-pair-b');
    if (pairB) pairB.hidden = true;
  });

  // ── Render del reporte ─────────────────────────────────────────
  /**
   * renderReport — recibe el JSON del servidor y actualiza la UI
   * También guarda el reporte en Auth.reporteActual para poder guardarlo después.
   * @param {Object} report - Resultado de formatter.formatReport
   */
  function renderReport(report) {
    // Guardar en el estado global para que "Guardar reporte" lo pueda enviar
    Auth.reporteActual = report;
    actualizarBotonGuardar();

    // Mostrar botones de análisis IA siempre que haya resultados
    const btnAnalysis    = document.getElementById('btn-analysis');
    const btnAnalysisPdf = document.getElementById('btn-analysis-pdf');
    if (btnAnalysis)    btnAnalysis.hidden    = false;
    if (btnAnalysisPdf) btnAnalysisPdf.hidden = false;
    const pairB = document.getElementById('action-pair-b');
    if (pairB) pairB.hidden = false;

    // Usar tables si está disponible (nueva estructura), sino top-level (legado)
    const tables       = report.tables || {};
    const matched      = tables.matched      || report.matched      || [];
    const onlyInAirbnb = tables.onlyInAirbnb || report.onlyInAirbnb || [];
    const onlyInBank   = tables.onlyInBank   || report.onlyInBank   || [];
    const differences  = tables.differences  || report.differences  || [];
    const { summary, bankSources } = report;

    // ── Banner de estado ─────────────────────────────────────────
    // Verde (ningún banner) si netDifference === 0; amarillo si hay discrepancia
    const netDiff = summary.netDifference ?? summary.difference ?? 0;
    if (Math.abs(netDiff) >= 0.01) {
      showDiscrepancyBanner(netDiff, summary.totalAirbnbPayouts, summary.totalBankDeposits);
    }

    // ── Tarjetas de totales ──────────────────────────────────────
    const isOk = summary.status === 'OK';
    const allMonths      = summary.bankTotalAllMonths      ?? 0;
    const allMonthsCount = summary.bankTotalAllMonthsCount ?? 0;
    totalsGrid.innerHTML = `
      <div class="total-card total-card--airbnb">
        <div class="total-card__label">Total Airbnb Payouts</div>
        <div class="total-card__value">${fmtCurrency(summary.totalAirbnbPayouts)}</div>
      </div>
      <div class="total-card total-card--bank">
        <div class="total-card__label">Total Depósitos Banco</div>
        <div class="total-card__value">${fmtCurrency(summary.totalBankDeposits)}</div>
      </div>
      <div class="total-card total-card--${isOk ? 'ok' : 'diff'}">
        <div class="total-card__label">Diferencia neta</div>
        <div class="total-card__value">${fmtCurrency(netDiff)}</div>
      </div>
      <div class="total-card total-card--ok">
        <div class="total-card__label">Match Rate</div>
        <div class="total-card__value">${summary.matchRate}</div>
      </div>
      <div class="total-card total-card--bank">
        <div class="total-card__label">Días promedio al depósito</div>
        <div class="total-card__value">${summary.averageDaysToDeposit}</div>
      </div>
      <div class="total-card total-card--bank">
        <div class="total-card__label">Total banco (todos los meses)</div>
        <div class="total-card__value">${fmtCurrency(allMonths)}</div>
        <div class="total-card__sub">${allMonthsCount} depósito${allMonthsCount !== 1 ? 's' : ''} SPEI</div>
      </div>
    `;

    // ── Indicadores de fuentes bancarias ────────────────────────
    if (bankSources && bankSources.pdf1Transactions > 0) {
      sourcePdf1El.textContent = `PDF 1: ${bankSources.pdf1Transactions} depósitos`;
      bankSourcesEl.hidden     = false;
      if (bankSources.pdf2Transactions > 0) {
        sourcePdf2El.textContent = `PDF 2: ${bankSources.pdf2Transactions} depósitos`;
        sourcePdf2El.hidden      = false;
      } else {
        sourcePdf2El.hidden = true;
      }
    } else {
      bankSourcesEl.hidden = true;
    }

    // ── Badges y visibilidad de pestañas ─────────────────────────
    document.getElementById('badge-matched').textContent     = matched.length;
    document.getElementById('badge-airbnb-only').textContent = onlyInAirbnb.length;
    document.getElementById('badge-bank-only').textContent   = onlyInBank.length;

    // La pestaña "Diferencias" solo se muestra si existen diferencias de monto
    const tabBtnDiff = document.getElementById('tab-btn-differences');
    if (tabBtnDiff) {
      tabBtnDiff.hidden = differences.length === 0;
      document.getElementById('badge-differences').textContent = differences.length;
    }

    // ── Tablas ───────────────────────────────────────────────────
    renderMatchedTable(matched);
    renderOnlyAirbnbTable(onlyInAirbnb);
    renderOnlyBankTable(onlyInBank);
    renderDifferencesTable(differences);

    resultsSection.hidden = false;
    resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Helper: fila de matched/differences (mismas columnas en ambas tablas)
  function matchedRow(r) {
    const cls = Math.abs(r.amountDifference) > 0 ? 'amount-negative' : 'amount-zero';
    return `<tr>
      <td>${r.airbnbDate}</td>
      <td>${r.bankDate}</td>
      <td>${r.bankDescription || '—'}</td>
      <td class="text-right">${fmtCurrency(r.airbnbAmount)}</td>
      <td class="text-right">${fmtCurrency(r.bankAmount)}</td>
      <td class="text-right ${cls}">${fmtCurrency(r.amountDifference)}</td>
      <td class="text-right">${r.daysDifference >= 0 ? '+' : ''}${r.daysDifference}d</td>
    </tr>`;
  }

  // Tabla de coincidentes
  function renderMatchedTable(rows) {
    const tbody = document.querySelector('#table-matched tbody');
    tbody.innerHTML = rows.length
      ? rows.map(matchedRow).join('')
      : '<tr><td colspan="7" style="text-align:center;color:var(--color-text-muted);padding:2rem">Sin coincidencias</td></tr>';
  }

  // Tabla solo en Airbnb — badge "Pendiente"
  function renderOnlyAirbnbTable(rows) {
    const tbody = document.querySelector('#table-airbnb-only tbody');
    tbody.innerHTML = rows.length
      ? rows.map(r => `<tr>
          <td>${r.date}</td>
          <td>${r.referenceCode || '—'}</td>
          <td class="text-right amount-negative">${fmtCurrency(r.amount)}</td>
          <td>${r.currency}</td>
          <td><span class="status-badge status-badge--pending">Pendiente</span></td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);padding:2rem">Sin registros</td></tr>';
  }

  // Tabla solo en banco — badge "Sin registro"
  function renderOnlyBankTable(rows) {
    const tbody = document.querySelector('#table-bank-only tbody');
    tbody.innerHTML = rows.length
      ? rows.map(r => `<tr>
          <td>${r.date}</td>
          <td>${r.description || '—'}</td>
          <td class="text-right amount-positive">${fmtCurrency(r.amount)}</td>
          <td>${r.currency}</td>
          <td><span class="status-badge status-badge--unregistered">Sin registro</span></td>
        </tr>`).join('')
      : '<tr><td colspan="5" style="text-align:center;color:var(--color-text-muted);padding:2rem">Sin registros</td></tr>';
  }

  // Tabla de diferencias — matches con discrepancia de monto
  function renderDifferencesTable(rows) {
    const tbody = document.querySelector('#table-differences tbody');
    if (!tbody) return;
    tbody.innerHTML = rows.length
      ? rows.map(matchedRow).join('')
      : '<tr><td colspan="7" style="text-align:center;color:var(--color-text-muted);padding:2rem">Sin diferencias de monto</td></tr>';
  }

  // ── Gestión de pestañas ─────────────────────────────────────────
  document.addEventListener('click', e => {
    const tab = e.target.closest('.tab');
    if (!tab || !tab.dataset.target) return;
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('tab--active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('tab-panel--hidden'));
    tab.classList.add('tab--active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(tab.dataset.target).classList.remove('tab-panel--hidden');
  });

  // ── Helpers de UI ──────────────────────────────────────────────
  function showStatus(el, msg, type) {
    el.textContent = msg;
    el.className   = `upload-card__status${type === 'error' ? ' error' : ''}`;
  }

  function showLoader(visible) {
    loader.hidden        = !visible;
    generateBtn.disabled = visible;
  }

  function showError(msg) {
    errorBanner.textContent = `Error: ${msg}`;
    errorBanner.hidden      = false;
  }

  function hideError() {
    errorBanner.hidden      = true;
    errorBanner.textContent = '';
  }

  // Banner de discrepancia (amarillo) visible cuando Airbnb ≠ banco
  function showDiscrepancyBanner(diff, airbnbTotal, bankTotal) {
    let existing = document.getElementById('discrepancy-banner');
    if (!existing) {
      existing = document.createElement('div');
      existing.id        = 'discrepancy-banner';
      existing.className = 'discrepancy-banner';
      existing.setAttribute('role', 'alert');
      resultsSection.insertBefore(existing, resultsSection.firstChild);
    }
    const signo = diff > 0 ? 'Airbnb reportó más de lo depositado' : 'El banco recibió más de lo registrado en Airbnb';
    existing.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      <span><strong>Discrepancia detectada:</strong> ${signo}. Diferencia: ${fmtCurrency(Math.abs(diff))}
      (Airbnb: ${fmtCurrency(airbnbTotal)} — Banco: ${fmtCurrency(bankTotal)})</span>
    `;
    existing.hidden = false;
  }

  function hideDiscrepancyBanner() {
    const el = document.getElementById('discrepancy-banner');
    if (el) el.hidden = true;
  }

  /** Formatea un número como moneda MXN */
  function fmtCurrency(amount) {
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(amount ?? 0);
  }

})();
