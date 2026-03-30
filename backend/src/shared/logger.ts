import winston from 'winston';
import { config } from './config';

const { combine, timestamp, errors, json, colorize, simple } = winston.format;

export const logger = winston.createLogger({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  format: combine(
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ssZ' }),
    errors({ stack: true }),
    json(),
  ),
  defaultMeta: { service: 'ops-hub-api' },
  transports: [
    new winston.transports.Console({
      format: config.NODE_ENV === 'production'
        ? combine(timestamp(), json())
        : combine(colorize(), simple()),
    }),
  ],
});
