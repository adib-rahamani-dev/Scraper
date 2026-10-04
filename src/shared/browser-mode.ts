export type BrowserMode = 'extension' | 'companion';
export function usesCompanion(serverLocal: boolean, mode: BrowserMode): boolean {
  return serverLocal && mode === 'companion';
}
export function extensionMatchesPanel(state: { connected?: boolean; endpoint?: string }, origin: string): boolean {
  const target = new URL(origin).hostname === 'lead-radar-jade.vercel.app'
    ? 'https://lead-radar-jade.vercel.app' : 'http://127.0.0.1:4300';
  return state.connected === true && (state.endpoint || 'https://lead-radar-jade.vercel.app') === target;
}
