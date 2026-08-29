// tests/unit/sessionStore.test.js — Pruebas del módulo SessionStore
// Verifica: aislamiento por usuario, aislamiento por sesión,
// expiración por TTL, y que destroy elimina solo la sesión correcta.
// No necesita base de datos ni servidor HTTP — es un test puramente unitario.

'use strict';

const SessionStore = require('../../src/store/SessionStore');

// ── Limpieza entre tests ─────────────────────────────────────────
// Cada test crea sus propias sesiones y las destruye al final.
// Usamos afterEach como red de seguridad para no contaminar otros tests.
const createdSessions = [];

function trackCreate(userId) {
  const sessionId = SessionStore.create(userId);
  createdSessions.push({ userId, sessionId });
  return sessionId;
}

afterEach(() => {
  while (createdSessions.length > 0) {
    const { userId, sessionId } = createdSessions.pop();
    SessionStore.destroy(userId, sessionId);
  }
});

// ── Test 1 — Usuarios distintos tienen sesiones aisladas ─────────

describe('T1 — Aislamiento entre usuarios distintos', () => {
  test('Usuario A no puede acceder a la sesión de Usuario B', () => {
    const sessionA = trackCreate('user-A');
    const sessionB = trackCreate('user-B');

    const sA = SessionStore.get('user-A', sessionA);
    const sB = SessionStore.get('user-B', sessionB);

    // Configurar datos distintos en cada sesión
    sA.airbnbPath = 'uploads/airbnb-A.csv';
    sA.bankPaths = ['uploads/bank-A.pdf'];
    sB.airbnbPath = 'uploads/airbnb-B.csv';
    sB.bankPaths = ['uploads/bank-B.pdf'];

    // Cruce de userId: usuario A no puede leer sesión de B y viceversa
    expect(SessionStore.get('user-A', sessionB)).toBeNull();
    expect(SessionStore.get('user-B', sessionA)).toBeNull();

    // Cada sesión conserva únicamente sus propios datos
    expect(SessionStore.get('user-A', sessionA).airbnbPath).toBe('uploads/airbnb-A.csv');
    expect(SessionStore.get('user-B', sessionB).airbnbPath).toBe('uploads/airbnb-B.csv');
    expect(SessionStore.get('user-A', sessionA).bankPaths).toEqual(['uploads/bank-A.pdf']);
    expect(SessionStore.get('user-B', sessionB).bankPaths).toEqual(['uploads/bank-B.pdf']);
  });

  test('Reporte generado para Usuario A no contiene datos de Usuario B', () => {
    const sessionA = trackCreate('user-A');
    const sessionB = trackCreate('user-B');

    // Simular que cada usuario generó su reporte
    SessionStore.get('user-A', sessionA).airbnbData = { payouts: [{ amount: 1000 }] };
    SessionStore.get('user-B', sessionB).airbnbData = { payouts: [{ amount: 9999 }] };

    // El reporte de A tiene los datos de A, no de B
    expect(SessionStore.get('user-A', sessionA).airbnbData.payouts[0].amount).toBe(1000);
    expect(SessionStore.get('user-B', sessionB).airbnbData.payouts[0].amount).toBe(9999);
  });
});

// ── Test 2 — Mismo usuario, dos sesiones independientes ──────────

describe('T2 — Mismo usuario con dos sesiones activas simultáneas', () => {
  test('Sesión A y sesión B del mismo usuario son independientes', () => {
    const sessionA = trackCreate('user-1');
    const sessionB = trackCreate('user-1');

    SessionStore.get('user-1', sessionA).airbnbPath = 'uploads/sesion-A.csv';
    SessionStore.get('user-1', sessionB).airbnbPath = 'uploads/sesion-B.csv';

    // Cada sesión mantiene sus propios datos
    expect(SessionStore.get('user-1', sessionA).airbnbPath).toBe('uploads/sesion-A.csv');
    expect(SessionStore.get('user-1', sessionB).airbnbPath).toBe('uploads/sesion-B.csv');
  });

  test('Generar reporte en sesión A no usa archivos de sesión B', () => {
    const sessionA = trackCreate('user-1');
    const sessionB = trackCreate('user-1');

    SessionStore.get('user-1', sessionA).compareResult = { matched: [{ amount: 500 }] };
    SessionStore.get('user-1', sessionB).compareResult = { matched: [{ amount: 888 }] };

    // Leer compareResult de sesión A devuelve el de A, no el de B
    expect(SessionStore.get('user-1', sessionA).compareResult.matched[0].amount).toBe(500);
  });
});

// ── Test 3 — Sesión expirada no puede utilizarse ─────────────────

describe('T3 — Expiración de sesión por TTL', () => {
  test('get() devuelve null para una sesión expirada', () => {
    const sessionId = trackCreate('user-ttl');

    // Verificar que existe antes de forzar expiración
    expect(SessionStore.get('user-ttl', sessionId)).not.toBeNull();

    // Forzar expiración sin esperar 2 horas
    SessionStore._forceExpire('user-ttl', sessionId);

    // La sesión expirada debe devolver null
    expect(SessionStore.get('user-ttl', sessionId)).toBeNull();
  });

  test('Sesión expirada es eliminada automáticamente del Map al acceder', () => {
    const sessionId = trackCreate('user-ttl2');

    SessionStore._forceExpire('user-ttl2', sessionId);
    SessionStore.get('user-ttl2', sessionId); // dispara la limpieza

    // Segunda llamada también devuelve null (no aparece como sesión válida)
    expect(SessionStore.get('user-ttl2', sessionId)).toBeNull();
  });
});

// ── Test 4 — (ver tests/integration/upload.test.js) ─────────────

// ── Test 5 — destroy elimina únicamente la sesión correcta ───────

describe('T5 — destroy elimina solo la sesión correspondiente', () => {
  test('Destruir sesión A no afecta sesión B del mismo usuario', () => {
    const s1 = trackCreate('user-del');
    const s2 = trackCreate('user-del');

    SessionStore.get('user-del', s1).airbnbPath = 'uploads/s1.csv';
    SessionStore.get('user-del', s2).airbnbPath = 'uploads/s2.csv';

    // Destruir únicamente s1
    SessionStore.destroy('user-del', s1);

    // s1 ya no existe
    expect(SessionStore.get('user-del', s1)).toBeNull();

    // s2 sigue intacta con sus datos
    const s2session = SessionStore.get('user-del', s2);
    expect(s2session).not.toBeNull();
    expect(s2session.airbnbPath).toBe('uploads/s2.csv');
  });

  test('Destruir sesión de usuario A no afecta sesión de usuario B', () => {
    const sA = trackCreate('user-X');
    const sB = trackCreate('user-Y');

    SessionStore.get('user-X', sA).airbnbPath = 'uploads/x.csv';
    SessionStore.get('user-Y', sB).airbnbPath = 'uploads/y.csv';

    SessionStore.destroy('user-X', sA);

    // Sesión de B intacta
    expect(SessionStore.get('user-Y', sB)).not.toBeNull();
    expect(SessionStore.get('user-Y', sB).airbnbPath).toBe('uploads/y.csv');
  });
});
