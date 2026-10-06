// Raw Discord/REST errors can contain tokens or request details.
export function logError(context: string, error: unknown): void {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  console.error(`${context}${typeof code === 'number' ? ` (code ${code})` : ''}`);
}
