// Prototype for a story-mode final match: the stranger serves during the 3-2-1
// countdown, so the first ball reaches the player as PLAY goes down on the
// song's first strong beat. Opt in with ?ambush in the page URL.

/** The countdown's length: "3", "2", "1", one second each, then PLAY. */
export const COUNTDOWN_SEC = 3;

/** True when the page was opened with ?ambush. Main thread only (a worker's URL has no query). */
export function isAmbush(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).has('ambush');
}
