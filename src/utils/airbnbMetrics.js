'use strict';

/**
 * calcularComisionDesdeReservaciones — Calcula noches y comisión de Airbnb
 * desde un array de entries (payouts, matched entries u onlyInAirbnb entries).
 *
 * El CSV de Airbnb reporta serviceFee como valor negativo (deducción contable).
 * Esta función devuelve comisionAirbnb como magnitud positiva — la regla de
 * dominio que convierte la deducción de Airbnb en un costo de negocio positivo.
 *
 * Referencia de uso:
 *   - session.airbnbData.payouts[]           → entries de la sesión activa
 *   - tables.matched[]/onlyInAirbnb[]        → entries del body del save request
 *
 * @param {Array} entries  Array de entries con campo reservations?[]
 * @returns {{ noches: number, comisionAirbnb: number }}  Magnitudes positivas
 */
function calcularComisionDesdeReservaciones(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { noches: 0, comisionAirbnb: 0 };
  }

  let noches = 0;
  let comisionAirbnb = 0;

  for (const entry of entries) {
    const reservations = Array.isArray(entry?.reservations) ? entry.reservations : [];
    for (const r of reservations) {
      noches += parseInt(r?.nights, 10) || 0;
      comisionAirbnb += Math.abs(parseFloat(r?.serviceFee) || 0);
    }
  }

  return { noches, comisionAirbnb };
}

module.exports = { calcularComisionDesdeReservaciones };
