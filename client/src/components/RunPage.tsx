import { useEffect, useState } from 'react';

import { at, u } from '../game/pixel/layout';
import PxText from '../game/pixel/PxText';
import SceneBackdrop from './SceneBackdrop';

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
  const fallbackMessage = response.status === 404
    ? 'Run not found.'
    : `Request failed with status ${response.status}.`;

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

function toRunLoadErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return 'Could not load this run.';
  const detail = error.message.trim();
  if (!detail || detail.toLowerCase() === 'error') return 'Could not load this run.';
  if (detail === 'Failed to fetch') {
    return 'Could not reach the server. Start the backend and refresh.';
  }

  return detail;
}

interface RunData {
  id: string;
  title: string;
  handle: string;
  score: number;
  accuracy: number;
  maxCombo: number;
  grade: string;
  perfectCount: number;
  goodCount: number;
  okCount: number;
  missCount: number;
  bpm: number;
  duration: number;
  difficulty: string;
  createdAt: string;
}

function gradeColor(grade: string) {
  switch (grade) {
    case 'S':
      return 'var(--perfect)';
    case 'A':
      return 'var(--good)';
    case 'B':
      return 'var(--rose)';
    case 'C':
      return 'var(--ok)';
    case 'D':
      return 'var(--rose-deep)';
    default:
      return 'var(--text-faint)';
  }
}

interface RunPageProps {
  runId: string;
}

export default function RunPage({ runId }: RunPageProps) {
  const [run, setRun] = useState<RunData | null>(null);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>('loading');
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  useEffect(() => {
    const loadRun = async () => {
      setStatus('loading');
      setError(null);

      try {
        const response = await fetch(getApiUrl(`/api/run/${runId}`));
        if (!response.ok) {
          const errorMessage = await getApiErrorMessage(response);
          throw new Error(errorMessage);
        }

        const data = (await response.json()) as RunData;
        setRun(data);
        setStatus('ready');
      } catch (err) {
        console.error('Failed to load run:', err);
        setError(toRunLoadErrorMessage(err));
        setStatus('error');
      }
    };

    loadRun();
  }, [runId]);

  const handlePlay = () => {
    const baseUrl = `${window.location.origin}${window.location.pathname}`;
    window.location.href = baseUrl;
  };

  const handleCopyLink = async () => {
    const shareUrl = window.location.href;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyMessage('Link copied.');
    } catch (err) {
      console.error('Copy failed:', err);
      setCopyMessage('Copy failed.');
    }
  };

  if (status === 'loading' || status === 'error' || !run) {
    return (
      <SceneBackdrop dim={0.6}>
        <div style={at(0, 92, styles.center)}>
          {status === 'loading' ? (
            <PxText text="loading…" />
          ) : (
            <>
              <PxText text="run not found" style={{ color: 'var(--miss)' }} />
              <PxText text={(error ?? 'Try another link.').toLowerCase()} maxWidth={200} align="center" style={{ color: 'var(--text-dim)' }} />
              <button className="px-option" onClick={handlePlay}>
                <PxText text="play" />
              </button>
            </>
          )}
        </div>
      </SceneBackdrop>
    );
  }

  const accuracy = run.accuracy.toFixed(1);
  const color = gradeColor(run.grade);
  const rows: Array<[string, string, string]> = [
    ['perfect', run.perfectCount.toString(), 'var(--perfect)'],
    ['good', run.goodCount.toString(), 'var(--good)'],
    ['ok', run.okCount.toString(), 'var(--ok)'],
    ['miss', run.missCount.toString(), 'var(--miss)'],
    ['combo', `×${run.maxCombo}`, 'var(--text)'],
  ];
  const title = run.title.length > 24 ? `${run.title.slice(0, 23)}…` : run.title;

  return (
    <SceneBackdrop dim={0.6}>
      <div className="px-panel" style={at(LEFT, TOP, styles.card)}>
        <div style={styles.header}>
          <PxText text={`@${run.handle}`} style={{ color: 'var(--text-dim)' }} />
          <PxText text={run.difficulty} style={{ color: 'var(--text-faint)' }} />
        </div>
        <PxText text={title} style={{ color: 'var(--rose)' }} />

        <div style={styles.gradeRow}>
          <PxText text={run.grade} scale={3} style={{ color }} />
          <div style={styles.scoreBlock}>
            <PxText text={run.score.toString().padStart(7, '0')} />
            <PxText text={`${accuracy}%`} style={{ color: 'var(--text-dim)' }} />
          </div>
        </div>

        <div style={styles.stats}>
          {[rows.slice(0, 3), rows.slice(3)].map((column, i) => (
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

      <div style={at(SIDE_X, TOP, styles.side)}>
        <button className="px-option" onClick={handlePlay} autoFocus>
          <PxText text="play" />
        </button>
        <button className="px-option" onClick={handleCopyLink}>
          <PxText text={copyMessage ? copyMessage.toLowerCase() : 'copy link'} />
        </button>
      </div>
    </SceneBackdrop>
  );
}

// Same layout as the results screen: card on the left, choices on the right.
const LEFT = 24;
const TOP = 30;
const CARD_W = 232;
const SIDE_X = LEFT + CARD_W + 16;

const styles: Record<string, React.CSSProperties> = {
  center: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: u(8),
  },
  card: {
    width: u(CARD_W),
    padding: `${u(7)} ${u(10)} ${u(8)}`,
    display: 'flex',
    flexDirection: 'column',
    gap: u(2),
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
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
    alignItems: 'flex-start',
    marginLeft: u(-9),
  },
};
