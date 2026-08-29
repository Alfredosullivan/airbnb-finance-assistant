// tests/unit/reportsController.test.js — DEV-004 (cobertura complementaria)
// Tests unitarios de _resolverComisionAirbnb y _buildAnalysisData.
//
// Verifica que ambas funciones devuelvan comisionAirbnb como magnitud positiva:
//   - _resolverComisionAirbnb cubre el fallback de generateAnnualReport
//   - _buildAnalysisData cubre la propagación desde datos guardados en DB

'use strict';

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const {
  _resolverComisionAirbnb,
  _buildAnalysisData,
} = require('../../src/controllers/reports.controller');

// ── _resolverComisionAirbnb ───────────────────────────────────────────────────

describe('_resolverComisionAirbnb', () => {
  // Fuente 1: excelData guardado en DB

  test('normaliza excel.comisionAirbnb negativa a positiva (datos históricos pre-DEV-004)', () => {
    const result = _resolverComisionAirbnb({ comisionAirbnb: -200 }, [], 10000);
    expect(result).toBe(200);
  });

  test('preserva excel.comisionAirbnb positiva sin cambios', () => {
    const result = _resolverComisionAirbnb({ comisionAirbnb: 200 }, [], 10000);
    expect(result).toBe(200);
  });

  test('respeta excel.comisionAirbnb === 0 y no cae al fallback de matchedRows', () => {
    const matchedRows = [{ serviceFee: -150 }];
    const result = _resolverComisionAirbnb({ comisionAirbnb: 0 }, matchedRows, 10000);
    expect(result).toBe(0);
  });

  // Fuente 2: serviceFee/comision de matchedRows

  test('normaliza serviceFee negativo de matchedRows cuando no hay excelData', () => {
    const matchedRows = [{ serviceFee: -150 }, { serviceFee: -100 }];
    const result = _resolverComisionAirbnb({}, matchedRows, 10000);
    expect(result).toBe(250);
  });

  test('usa campo comision de matchedRows cuando serviceFee está ausente', () => {
    const matchedRows = [{ comision: 75 }];
    const result = _resolverComisionAirbnb({}, matchedRows, 10000);
    expect(result).toBe(75);
  });

  test('acumula serviceFee de múltiples matchedRows con signo mixto', () => {
    const matchedRows = [{ serviceFee: -200 }, { serviceFee: 50 }, { serviceFee: -30 }];
    const result = _resolverComisionAirbnb({}, matchedRows, 10000);
    expect(result).toBe(280);
  });

  // Fuente 3: estimado 3.5%

  test('usa estimado 3.5% cuando no hay excelData ni matchedRows con fee', () => {
    const result = _resolverComisionAirbnb({}, [], 10000);
    expect(result).toBe(350);
  });

  test('devuelve 0 cuando no hay datos y airbnbTotal es 0', () => {
    const result = _resolverComisionAirbnb({}, [], 0);
    expect(result).toBe(0);
  });

  test('matchedRows con serviceFee 0 cae al estimado 3.5%', () => {
    const matchedRows = [{ serviceFee: 0 }];
    const result = _resolverComisionAirbnb({}, matchedRows, 5000);
    expect(result).toBe(175);
  });
});

// ── _buildAnalysisData ────────────────────────────────────────────────────────

describe('_buildAnalysisData', () => {
  test('normaliza comisionAirbnb negativa en excelData a positiva', () => {
    const reportData = {
      excelData: { comisionAirbnb: -300, noches: 5, ivaRetenido: 100, isrRetenido: 50 },
      summary: { totalAirbnbPayouts: 10000 },
    };
    const result = _buildAnalysisData(reportData);
    expect(result.excelData.comisionAirbnb).toBe(300);
  });

  test('preserva comisionAirbnb positiva en excelData sin cambios', () => {
    const reportData = {
      excelData: { comisionAirbnb: 300, noches: 5, ivaRetenido: 100, isrRetenido: 50 },
      summary: { totalAirbnbPayouts: 10000 },
    };
    const result = _buildAnalysisData(reportData);
    expect(result.excelData.comisionAirbnb).toBe(300);
  });

  test('usa estimado 3.5% cuando comisionAirbnb no está guardada en excelData', () => {
    const reportData = {
      excelData: { noches: 5 },
      summary: { totalAirbnbPayouts: 10000 },
    };
    const result = _buildAnalysisData(reportData);
    expect(result.excelData.comisionAirbnb).toBe(350);
  });

  test('respeta comisionAirbnb === 0 y no lo sobreescribe con el estimado', () => {
    const reportData = {
      excelData: { comisionAirbnb: 0 },
      summary: { totalAirbnbPayouts: 10000 },
    };
    const result = _buildAnalysisData(reportData);
    expect(result.excelData.comisionAirbnb).toBe(0);
  });

  test('usa estimado cuando reportData no tiene excelData', () => {
    const reportData = {
      summary: { totalAirbnbPayouts: 5000 },
    };
    const result = _buildAnalysisData(reportData);
    expect(result.excelData.comisionAirbnb).toBe(175);
  });
});
