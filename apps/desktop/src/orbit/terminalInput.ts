/** The engine's headless terminal owns these replies; a rendered xterm must not duplicate them.
 * Complete device responses only. Arrow keys, pasted text and modified keyboard input still pass.
 */
export function terminalDeviceReply(data: string): boolean {
  return /^\x1b\[(?:\??\d+;\d+R|[?>]?[\d;]*c|\??\d+n|\?\d+;\d+\$y)$/.test(data)
}
