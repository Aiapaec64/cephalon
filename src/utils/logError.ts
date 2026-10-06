// Only known codes are allowed; raw Discord/SQL errors can contain secrets.
const safeCodes = new Set([
  '23505', '23503', '23514', '42P01', '42703', '28P01', '3D000', '08000', '08001', '08003', '08006',
  '57P01', '53300', '57014', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'EPIPE',
]);

export function logError(context: string, error: unknown): void {
  let current = error;
  let suffix = '';
  for (let depth = 0; depth < 3 && current instanceof Error; depth++) {
    const code = 'code' in current ? current.code : undefined;
    if (typeof code === 'number' || typeof code === 'string' && safeCodes.has(code)) {
      suffix = ` (code ${code})`;
      break;
    }
    current = current.cause;
  }
  console.error(`${context}${suffix}`);
}
