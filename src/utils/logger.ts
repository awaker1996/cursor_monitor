const SENSITIVE_KEYS = [
  'cookie',
  'authorization',
  'session',
  'token',
  'password',
  'secret',
  'credential',
];

function maskValue(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}***${value.slice(-4)}`;
}

function sanitizeValue(key: string, value: unknown): unknown {
  const lowerKey = key.toLowerCase();
  if (SENSITIVE_KEYS.some((k) => lowerKey.includes(k))) {
    return typeof value === 'string' ? maskValue(value) : '***';
  }
  if (typeof value === 'object' && value !== null) {
    return sanitizeObject(value as Record<string, unknown>);
  }
  return value;
}

function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    result[key] = sanitizeValue(key, value);
  }
  return result;
}

export function sanitizeForLog(message: string): string {
  let result = message;
  // Mask cookie header patterns
  result = result.replace(/(Cookie:\s*)[^\s;]+/gi, '$1***');
  result = result.replace(/(Authorization:\s*Bearer\s+)[^\s]+/gi, '$1***');
  result = result.replace(/(session[^=]*=)[^;\s]+/gi, '$1***');
  return result;
}

export function createLogger(scope: string) {
  const prefix = `[${scope}]`;

  return {
    info(message: string, data?: Record<string, unknown>): void {
      const safeMsg = sanitizeForLog(message);
      if (data) {
        console.log(prefix, safeMsg, sanitizeObject(data));
      } else {
        console.log(prefix, safeMsg);
      }
    },
    warn(message: string, data?: Record<string, unknown>): void {
      const safeMsg = sanitizeForLog(message);
      if (data) {
        console.warn(prefix, safeMsg, sanitizeObject(data));
      } else {
        console.warn(prefix, safeMsg);
      }
    },
    error(message: string, err?: unknown): void {
      const safeMsg = sanitizeForLog(message);
      if (err instanceof Error) {
        console.error(prefix, safeMsg, sanitizeForLog(err.message));
      } else if (err) {
        console.error(prefix, safeMsg, sanitizeForLog(String(err)));
      } else {
        console.error(prefix, safeMsg);
      }
    },
  };
}
