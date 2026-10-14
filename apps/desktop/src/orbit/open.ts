import { isTauri } from './context.tsx'

/** Opens a web address in the person's browser (the app's webview does not follow external links). */
export async function openExternal(url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) return
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } else {
    window.open(url, '_blank', 'noopener')
  }
}
