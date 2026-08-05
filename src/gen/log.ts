const flags = globalThis as typeof globalThis & { GIGAHRUSH_GEN_LOGS?: boolean };

export function genLog(text: string): void {
  if (flags.GIGAHRUSH_GEN_LOGS) console.log(text);
}
