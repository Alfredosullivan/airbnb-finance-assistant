// tests/unit/airbnbMetrics.test.js — DEV-004
// Tests unitarios del helper calcularComisionDesdeReservaciones.
// Verifica que comisionAirbnb se devuelva siempre como magnitud positiva
// independientemente del signo de serviceFee en el CSV de Airbnb.

'use strict';

const { calcularComisionDesdeReservaciones } = require('../../src/utils/airbnbMetrics');

describe('calcularComisionDesdeReservaciones', () => {
  // ── serviceFee negativo ───────────────────────────────────────

  test('serviceFee negativo se convierte en comisionAirbnb positiva', () => {
    const entries = [{ reservations: [{ nights: 3, serviceFee: -200 }] }];

    const { noches, comisionAirbnb } = calcularComisionDesdeReservaciones(entries);

    expect(noches).toBe(3);
    expect(comisionAirbnb).toBe(200);
  });

  // ── serviceFee positivo ───────────────────────────────────────

  test('serviceFee positivo permanece positivo en comisionAirbnb', () => {
    const entries = [{ reservations: [{ nights: 2, serviceFee: 150 }] }];

    const { noches, comisionAirbnb } = calcularComisionDesdeReservaciones(entries);

    expect(noches).toBe(2);
    expect(comisionAirbnb).toBe(150);
  });

  // ── múltiples reservaciones ───────────────────────────────────

  test('acumula noches y comisionAirbnb de múltiples reservaciones en varios entries', () => {
    // matched: [{ nights:3, fee:-200 }, { nights:4, fee:-100 }] + onlyAirbnb: [{ nights:2, fee:-50 }]
    const entries = [
      {
        reservations: [
          { nights: 3, serviceFee: -200 },
          { nights: 4, serviceFee: -100 },
        ],
      },
      { reservations: [{ nights: 2, serviceFee: -50 }] },
    ];

    const { noches, comisionAirbnb } = calcularComisionDesdeReservaciones(entries);

    expect(noches).toBe(9);
    expect(comisionAirbnb).toBe(350);
  });

  // ── serviceFee null ───────────────────────────────────────────

  test('trata serviceFee null como 0', () => {
    const entries = [{ reservations: [{ nights: 5, serviceFee: null }] }];

    const { noches, comisionAirbnb } = calcularComisionDesdeReservaciones(entries);

    expect(noches).toBe(5);
    expect(comisionAirbnb).toBe(0);
  });

  // ── serviceFee undefined ──────────────────────────────────────

  test('trata serviceFee undefined como 0', () => {
    const entries = [{ reservations: [{ nights: 5 }] }];

    const { noches, comisionAirbnb } = calcularComisionDesdeReservaciones(entries);

    expect(noches).toBe(5);
    expect(comisionAirbnb).toBe(0);
  });

  // ── valor inválido ────────────────────────────────────────────

  test('trata serviceFee con string no numérico como 0', () => {
    const entries = [{ reservations: [{ nights: 2, serviceFee: 'abc' }] }];

    const { noches, comisionAirbnb } = calcularComisionDesdeReservaciones(entries);

    expect(noches).toBe(2);
    expect(comisionAirbnb).toBe(0);
  });

  // ── ausencia de reservations ──────────────────────────────────

  test('devuelve 0 cuando el entry no tiene campo reservations', () => {
    const entries = [{ airbnbDate: '2026-02-15', amount: 3000 }];

    const { noches, comisionAirbnb } = calcularComisionDesdeReservaciones(entries);

    expect(noches).toBe(0);
    expect(comisionAirbnb).toBe(0);
  });

  test('devuelve 0 cuando reservations es null en el entry', () => {
    const entries = [{ reservations: null }];

    const { noches, comisionAirbnb } = calcularComisionDesdeReservaciones(entries);

    expect(noches).toBe(0);
    expect(comisionAirbnb).toBe(0);
  });

  test('devuelve { noches: 0, comisionAirbnb: 0 } cuando entries es array vacío', () => {
    const result = calcularComisionDesdeReservaciones([]);

    expect(result).toEqual({ noches: 0, comisionAirbnb: 0 });
  });

  test('devuelve { noches: 0, comisionAirbnb: 0 } cuando entries es null', () => {
    const result = calcularComisionDesdeReservaciones(null);

    expect(result).toEqual({ noches: 0, comisionAirbnb: 0 });
  });

  // ── inmutabilidad ─────────────────────────────────────────────

  test('no muta el objeto reservation original', () => {
    const entries = [{ reservations: [{ nights: 3, serviceFee: -200 }] }];
    const serviceFeeOriginal = entries[0].reservations[0].serviceFee;
    const nightsOriginal = entries[0].reservations[0].nights;

    calcularComisionDesdeReservaciones(entries);

    expect(entries[0].reservations[0].serviceFee).toBe(serviceFeeOriginal);
    expect(entries[0].reservations[0].nights).toBe(nightsOriginal);
  });
});
