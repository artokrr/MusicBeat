/** Session storage survives reloads; the module flag also works when storage is denied. */
let seen = false;
export function shouldPlayOpening(): boolean {
  if (seen || new URLSearchParams(location.search).has('nointro')) return false;
  try { return sessionStorage.getItem('courtyard-intro-seen') !== '1'; } catch { return true; }
}
export function finishOpening() {
  seen = true;
  try { sessionStorage.setItem('courtyard-intro-seen', '1'); } catch { /* Memory still covers menu returns. */ }
}
