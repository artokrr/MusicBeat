// The opening shot (camera descending from the panel block) is off: the game
// opens straight on the courtyard menu. ?intro in the URL still plays it once,
// for anyone who wants to look at it.
/** Session storage survives reloads; the module flag also works when storage is denied. */
let seen = false;
export function shouldPlayOpening(): boolean {
  if (seen || !new URLSearchParams(location.search).has('intro')) return false;
  try { return sessionStorage.getItem('courtyard-intro-seen') !== '1'; } catch { return true; }
}
export function finishOpening() {
  seen = true;
  try { sessionStorage.setItem('courtyard-intro-seen', '1'); } catch { /* Memory still covers menu returns. */ }
}
