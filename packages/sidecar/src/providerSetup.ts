/** Official setup commands, selected by fixed IDs only; never accept shell text from the client. */
export const PROVIDER_SETUP = {
  antigravity: { bin: 'agy', install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash', connect: 'agy', docs: 'https://www.antigravity.google/docs/cli/install/' },
  grok: { bin: 'grok', install: 'curl -fsSL https://x.ai/cli/install.sh | bash', connect: 'grok login', docs: 'https://docs.x.ai/build/overview' },
  opencode: { bin: 'opencode', install: 'npm install -g opencode-ai', connect: 'opencode auth login', docs: 'https://opencode.ai/docs/' },
  hermes: { bin: 'hermes', install: 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash', connect: 'hermes setup', docs: 'https://hermes-agent.nousresearch.com/docs/getting-started/installation' },
} as const
export type SetupProvider = keyof typeof PROVIDER_SETUP
export function providerSetup(provider: string, action: string) {
  if (!Object.hasOwn(PROVIDER_SETUP, provider) || !['install', 'connect'].includes(action)) throw new Error('Ação de configuração desconhecida')
  const entry = PROVIDER_SETUP[provider as SetupProvider]
  return { ...entry, command: action === 'install' ? `${entry.install} && ${entry.bin} --version` : entry.connect }
}
