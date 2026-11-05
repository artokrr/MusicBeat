import { useRef, useState } from 'react';
import { toPng } from 'html-to-image';

import { clearAnonymousSession, getAnonymousSessionToken } from '../api/anonymousSession';
import { downloadBeatmapDebugReport } from '../beatmap/beatmapDebug';
import { useGameStore } from '../store/gameStore';
import { DIFFICULTY_PRESETS } from '../types/game';

import { at, u } from '../game/pixel/layout';
import PxText from '../game/pixel/PxText';
import SceneBackdrop from './SceneBackdrop';

import type { ChangeEvent } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL ?? '';

interface ApiErrorPayload {
  error?: string;
  message?: string;
}

function getApiUrl(path: string): string {
  if (!API_BASE_URL) return path;
  const normalizedBaseUrl = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
  return `${normalizedBaseUrl}${path}`;
}

async function getApiErrorMessage(response: Response): Promise<string> {
  const fallbackMessage = `Request failed with status ${response.status}.`;

  try {
    const payload = (await response.json()) as ApiErrorPayload;
    const errorMessage = typeof payload.error === 'string' ? payload.error.trim() : '';
    if (errorMessage) return errorMessage;
    const message = typeof payload.message === 'string' ? payload.message.trim() : '';
    if (message) return message;
  } catch (error) {
    console.error('Failed to parse API error response:', error);
  }

  return fallbackMessage;
}

function toShareErrorMessage(error: unknown): string {
  const fallbackMessage = 'Could not create a share link. Try again.';
  if (!(error instanceof Error)) return fallbackMessage;

  const detail = error.message.trim();
  if (!detail || detail.toLowerCase() === 'error') return fallbackMessage;
  if (detail === 'Failed to fetch') {
    return 'Could not reach the server. Start the backend and try again.';
  }

  return `${fallbackMessage} ${detail}`;
}

function getGrade(accuracy: number) {
  if (accuracy >= 95) return { grade: 'S', color: 'var(--perfect)' };
  if (accuracy >= 90) return { grade: 'A', color: 'var(--good)' };
  if (accuracy >= 80) return { grade: 'B', color: 'var(--rose)' };
  if (accuracy >= 70) return { grade: 'C', color: 'var(--ok)' };
  if (accuracy >= 60) return { grade: 'D', color: 'var(--rose-deep)' };
  return { grade: 'F', color: 'var(--text-faint)' };
}

function buildShareUrl(id: string) {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  return `${baseUrl}?run=${id}`;
}

export default function ResultsScreen() {
  const score = useGameStore((state) => state.score);
  const resetGame = useGameStore((state) => state.resetGame);
  const setScreen = useGameStore((state) => state.setScreen);
  const setPhase = useGameStore((state) => state.setPhase);
  const resetScore = useGameStore((state) => state.resetScore);
  const beatmap = useGameStore((state) => state.beatmap);
  const difficulty = useGameStore((state) => state.difficulty);
  const playerHandle = useGameStore((state) => state.playerHandle);
  const setPlayerHandle = useGameStore((state) => state.setPlayerHandle);
  const songTitle = useGameStore((state) => state.songTitle);
  const setSongTitle = useGameStore((state) => state.setSongTitle);
  const runOutcome = useGameStore((state) => state.runOutcome);

  const [shareId, setShareId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const shareCardRef = useRef<HTMLDivElement>(null);


  const totalNotes = score.perfectCount + score.goodCount + score.okCount + score.missCount;
  const accuracyValue = totalNotes > 0
    ? ((score.perfectCount + score.goodCount * 0.7 + score.okCount * 0.3) / totalNotes) * 100
    : 0;
  const accuracy = accuracyValue.toFixed(1);

  const scoreValue = Math.floor(score.score);
  const safeHandle = playerHandle.trim() || 'player';
  const safeTitle = songTitle.trim() || beatmap?.metadata.title || 'Untitled Track';
  const bpm = beatmap?.timing.bpm ?? 0;
  const duration = beatmap?.metadata.duration ?? 0;
  const missStreakFail = DIFFICULTY_PRESETS[difficulty].missStreakFail;

  const { grade, color } = getGrade(accuracyValue);
  const failed = runOutcome === 'hp_depleted' || runOutcome === 'miss_streak';
  const failedReason = runOutcome === 'miss_streak'
    ? (missStreakFail !== null
      ? `Failed (${missStreakFail} miss streak)`
      : 'Failed (miss streak)')
    : runOutcome === 'hp_depleted'
      ? 'Failed (HP depleted)'
      : null;
  const shareText = failed
    ? `I failed in Pong. ${scoreValue} pts ${accuracy}% accuracy`
    : `My wrists survived. ${scoreValue} pts ${accuracy}% accuracy`;
  const shareUrl = shareId ? buildShareUrl(shareId) : '';
  const debugReport = beatmap?.debug;

  const resetShareState = () => {
    setShareId(null);
    setShareError(null);
    setCopyMessage(null);
    setShareStatus('idle');
  };

  const handleHandleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setPlayerHandle(event.target.value);
    resetShareState();
  };

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSongTitle(event.target.value);
    resetShareState();
  };

  const handleRetry = () => {
    resetScore();
    setPhase('countdown');
    setScreen('playing');
  };

  const handleNewSong = () => {
    resetGame();
  };

  const handleShare = async () => {
    if (!beatmap) {
      setShareError('Missing beatmap data.');
      setShareStatus('error');
      return;
    }

    setShareStatus('saving');
    setShareError(null);
    setCopyMessage(null);

    try {
      const body = JSON.stringify({
        title: safeTitle,
        handle: safeHandle,
        score: scoreValue,
        accuracy: Number(accuracyValue.toFixed(1)),
        maxCombo: score.maxCombo,
        grade,
        perfectCount: score.perfectCount,
        goodCount: score.goodCount,
        okCount: score.okCount,
        missCount: score.missCount,
        bpm,
        duration,
        difficulty,
      });

      const sendRunRequest = async (forceSessionRefresh: boolean): Promise<Response> => {
        const sessionToken = await getAnonymousSessionToken({ forceRefresh: forceSessionRefresh });
        return fetch(getApiUrl('/api/run'), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${sessionToken}`,
            'Content-Type': 'application/json',
          },
          body,
        });
      };

      let response = await sendRunRequest(false);
      if (response.status === 401) {
        clearAnonymousSession();
        response = await sendRunRequest(true);
      }

      if (!response.ok) {
        const errorMessage = await getApiErrorMessage(response);
        throw new Error(errorMessage);
      }

      const data = await response.json();
      setShareId(data.id as string);
      setShareStatus('saved');
    } catch (error) {
      console.error('Failed to save run:', error);
      setShareError(toShareErrorMessage(error));
      setShareStatus('error');
    }
  };

  const handleCopyLink = async () => {
    if (!shareUrl) return;

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyMessage('Link copied.');
    } catch (error) {
      console.error('Copy failed:', error);
      setCopyMessage('Copy failed.');
    }
  };

  const handleCopyText = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopyMessage('Share text copied.');
    } catch (error) {
      console.error('Copy failed:', error);
      setCopyMessage('Copy failed.');
    }
  };

  const handleDownloadCard = async () => {
    if (!shareCardRef.current) return;

    try {
      const dataUrl = await toPng(shareCardRef.current, { cacheBust: true, pixelRatio: 2 });
      const link = document.createElement('a');
      link.download = `pong-${safeTitle}.png`;
      link.href = dataUrl;
      link.click();
    } catch (error) {
      console.error('Card export failed:', error);
      setShareError('Failed to export share card.');
    }
  };

  const handleDownloadDebugReport = () => {
    if (!debugReport) return;

    downloadBeatmapDebugReport(debugReport, safeTitle);
    setCopyMessage('Debug report downloaded.');
  };

  const outcomeTitle = failedReason ? failedReason.toLowerCase() : 'complete';
  const rows: Array<[string, string, string]> = [
    ['perfect', score.perfectCount.toString(), 'var(--perfect)'],
    ['good', score.goodCount.toString(), 'var(--good)'],
    ['ok', score.okCount.toString(), 'var(--ok)'],
    ['miss', score.missCount.toString(), 'var(--miss)'],
    ['combo', `×${score.maxCombo}`, 'var(--text)'],
  ];

  const [perfectRow, goodRow, okRow, missRow, comboRow] = rows;

  return (
    <SceneBackdrop dim={0.72} glitch={failed}>
      <PxText text={outcomeTitle} style={at(LEFT, 8, { color: failed ? 'var(--miss)' : 'var(--rose)' })} />

      {/* Left: the run, also exported as the share card */}
      <div style={at(LEFT, TOP)}>
        <div ref={shareCardRef} className="px-panel" style={styles.card}>
          <PxText text={`@${fitHandle(safeHandle)}`} style={{ color: 'var(--text-dim)' }} />
          <PxText className="px-truncate" text={fitTitle(safeTitle)} style={{ color: 'var(--rose)' }} />

          <div style={styles.gradeRow}>
            <PxText text={grade} scale={3} style={{ color }} />
            <div style={styles.scoreBlock}>
              <PxText text={scoreValue.toString().padStart(7, '0')} />
              <PxText text={`${accuracy}%`} style={{ color: 'var(--text-dim)' }} />
            </div>
          </div>

          <div style={styles.stats}>
            {[[perfectRow, goodRow, okRow], [missRow, comboRow]].map((column, i) => (
              <div key={i} style={styles.statColumn}>
                {column.map(([label, value, tint]) => (
                  <div key={label} style={styles.row}>
                    <PxText text={label} style={{ color: 'var(--text-faint)' }} />
                    <PxText text={value} style={{ color: tint }} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right: what next, then sharing */}
      <div className="px-results-side" style={at(SIDE_X, TOP, styles.side)}>
        <div style={styles.actions}>
          <button className="px-option" onClick={handleRetry} autoFocus>
            <PxText text="play again" />
          </button>
          <button className="px-option" onClick={handleNewSong}>
            <PxText text="new song" />
          </button>
        </div>

        <div style={styles.divider} />

        <input
          className="px-input"
          value={playerHandle}
          onChange={handleHandleChange}
          placeholder="handle"
          aria-label="Player handle"
        />
        <input
          className="px-input"
          value={songTitle}
          onChange={handleTitleChange}
          placeholder="song title"
          aria-label="Song title"
        />

        {shareUrl ? (
          <div style={styles.linkRow}>
            <input
              className="px-input"
              value={shareUrl}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
              aria-label="Share link"
            />
            <button className="px-button" style={styles.copyButton} onClick={handleCopyLink}>
              <PxText text="copy" />
            </button>
          </div>
        ) : null}

        <div style={styles.actions}>
          <button className="px-option" onClick={handleShare} disabled={shareStatus === 'saving'}>
            <PxText text={shareStatus === 'saving' ? 'saving…' : 'share link'} />
          </button>
          <button className="px-option" onClick={handleDownloadCard}>
            <PxText text="save card" />
          </button>
          <button className="px-option" onClick={handleCopyText}>
            <PxText text="copy text" />
          </button>
          {debugReport && (
            <button className="px-option" onClick={handleDownloadDebugReport}>
              <PxText text="debug json" />
            </button>
          )}
        </div>

        {shareError && <PxText text={shareError.toLowerCase()} maxWidth={SIDE_W} style={{ color: 'var(--miss)' }} />}
        {copyMessage && <PxText text={copyMessage.toLowerCase()} maxWidth={SIDE_W} style={{ color: 'var(--good)' }} />}
      </div>
    </SceneBackdrop>
  );
}

// Laid out for the 384x216 frame: card on the left, one column of choices on the right.
const LEFT = 24;
const TOP = 30;
const CARD_W = 232;
const SIDE_X = LEFT + CARD_W + 16;
const SIDE_W = 384 - SIDE_X - 16;

function fitHandle(handle: string): string {
  return handle.length > 24 ? `${handle.slice(0, 23)}…` : handle;
}

function fitTitle(title: string): string {
  return title.length > 24 ? `${title.slice(0, 23)}…` : title;
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    width: u(CARD_W),
    padding: `${u(7)} ${u(10)} ${u(8)}`,
    display: 'flex',
    flexDirection: 'column',
    gap: u(2),
  },
  gradeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: u(12),
    margin: `${u(4)} 0`,
  },
  scoreBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: u(2),
  },
  stats: {
    display: 'flex',
    gap: u(16),
    paddingTop: u(5),
    borderTop: `${u(1)} solid var(--hud-line)`,
  },
  statColumn: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
  },
  side: {
    display: 'flex',
    flexDirection: 'column',
    gap: u(4),
    maxHeight: u(216 - TOP - 8),
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: `${u(1)} ${u(2)} ${u(2)} ${u(9)}`,
    marginLeft: u(-9),
    width: u(SIDE_W + 9),
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    marginLeft: u(-7),
  },
  divider: {
    height: u(1),
    background: 'var(--hud-line)',
    margin: `${u(1)} 0`,
  },
  linkRow: {
    display: 'flex',
    gap: u(2),
  },
  copyButton: {
    padding: `0 ${u(3)}`,
  },
};
