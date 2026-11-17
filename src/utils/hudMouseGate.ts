/**
 * The HUD window lets the mouse through to the app below, except while the pointer is over
 * the HUD itself. This tells Electron when to switch, only when it changes.
 */
export function createHudMouseGate(send: (ignore: boolean) => void) {
  let ignoring = true;
  const set = (ignore: boolean) => {
    if (ignore === ignoring) return;
    ignoring = ignore;
    send(ignore);
  };
  return {
    move: (overHud: boolean) => set(!overHud),
    leave: () => set(true),
    /** The HUD was shown again and Electron lets the mouse through, whatever was asked before. */
    reset: () => {
      ignoring = true;
    },
  };
}
