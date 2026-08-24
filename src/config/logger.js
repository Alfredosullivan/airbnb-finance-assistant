'use strict';

const { createLogger, format, transports } = require('winston');

const isProd = process.env.NODE_ENV === 'production';

// En producción: JSON puro — parseable por Datadog, CloudWatch, Papertrail, etc.
// En desarrollo: colorizado + legible por humanos
const prodFormat = format.combine(format.timestamp(), format.json());

const devFormat = format.combine(
  format.colorize(),
  format.timestamp({ format: 'HH:mm:ss' }),
  format.printf(({ level, message, timestamp }) => `${timestamp} ${level}: ${message}`)
);

const logger = createLogger({
  // LOG_LEVEL en .env permite cambiar verbosidad sin tocar código
  level: process.env.LOG_LEVEL || 'info',
  format: isProd ? prodFormat : devFormat,
  transports: [new transports.Console()],
  exitOnError: false,
});

module.exports = logger;
