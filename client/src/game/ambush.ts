// The default start: the stranger serves during the 3-2-1 countdown, so the
// first ball reaches the player as PLAY goes down on the song's first strong
// beat. A song with a quiet opening has no early note, so its countdown plays
// as a plain countdown. ?classic in the page URL restores the old start: a
// 1.8 s lead-in after PLAY and a still countdown.

/** The countdown's length: "3", "2", "1", one second each, then PLAY. */
export const COUNTDOWN_SEC = 3;

/** False only when the page was opened with ?classic. Main thread only (a worker's URL has no query). */
export function isAmbush(): boolean {
  return !(typeof location !== 'undefined' && new URLSearchParams(location.search).has('classic'));
}
