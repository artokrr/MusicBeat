# Audio/picture sync of the cassette sounds, from a `cassette-sound.mjs --pass measure` run.
#   python3 -I tools/cassette-sound-sync.py [tools/out/cassette-sound-measure]
# For each sound: the frame where its visual event shows (from pixel changes in
# the captured frames) and the attack in the captured audio. The capture paths
# for picture and sound have different delays, so both are referred to a
# clapperboard: a white frame and a click started in the same animation frame.
import json, math, sys, wave
import numpy as np
from PIL import Image

prefix = sys.argv[1] if len(sys.argv) > 1 else 'tools/out/cassette-sound-measure'
run = json.load(open(prefix + '.json'))
cap = run['capture']
frame_t = np.array(run['frames'])  # epoch seconds
frames = np.stack([np.asarray(Image.open(f'{prefix}-frames/{i:05d}.png').convert('L'), dtype=np.float32) for i in range(len(frame_t))])

w = wave.open(prefix + '-audio.wav'); sr = w.getframerate()
audio = np.frombuffer(w.readframes(w.getnframes()), np.int16).reshape(-1, w.getnchannels()).mean(1) / 32768
hop = sr // 1000
env = 20 * np.log10(np.sqrt(np.mean(audio[:len(audio) // hop * hop].reshape(-1, hop) ** 2, axis=1)) + 1e-9)  # 1 ms RMS
a0 = cap['audioStart']  # epoch of audio sample 0 (approximate; the clapperboard removes the error)

# performance.now() ms -> epoch s, from the paired stamps the page logged every change.
k = np.median([e['epoch'] - e['ms'] / 1000 for e in cap['events']])
epoch = lambda perf_ms: perf_ms / 1000 + k

def attack(t_lo, t_hi, strongest=True, jump=12):
    """Epoch of the strongest (or first) attack in an audio window: a 1 ms step over the preceding 20 ms floor."""
    i0, i1 = max(25, int((t_lo - a0) * 1000)), min(len(env), int((t_hi - a0) * 1000))
    best, best_i = -1e9, None
    for i in range(i0, i1):
        rise = env[i] - np.median(env[i - 22:i - 2])
        if rise > jump and env[i] > -60:
            if not strongest: return a0 + i / 1000
            score = env[i:i + 6].max()
            if score > best: best, best_i = score, i
    return None if best_i is None else a0 + best_i / 1000

def changes(region, t_lo, t_hi, threshold=2, normalise=True, skip_jumps=False):
    """Frames in a time window where more than `threshold` pixels of the region changed from the previous frame.
    Normalised by the region's brightness, so the screens' dimming fades are not read as motion."""
    x0, y0, x1, y1 = region
    out = []
    for i in range(1, len(frame_t)):
        # Skip frames where the whole screen jumps in brightness (a screen change): not motion.
        if t_lo <= frame_t[i] <= t_hi and (not skip_jumps or abs(frames[i].mean() / max(frames[i - 1].mean(), 1) - 1) < .15):
            a, b = frames[i, y0:y1, x0:x1], frames[i - 1, y0:y1, x0:x1]
            if normalise: a, b = a * (128 / max(a.mean(), 1)), b * (128 / max(b.mean(), 1))
            if (np.abs(a - b) > 10).sum() > threshold: out.append(i)
    return out

# Clapperboard.
claps = []
for c in cap['claps']:
    lit = [i for i in range(len(frame_t)) if abs(frame_t[i] - epoch(c['perf'])) < 0.3 and frames[i].mean() > 200]
    heard = attack(epoch(c['perf']) - 0.2, epoch(c['perf']) + 0.4, strongest=False)
    if lit and heard: claps.append(heard - frame_t[lit[0]])
clap = float(np.median(claps))

# Same projection as client/src/game/scene/camera.ts (read for the deck position).
yaw, pitch, S, T, oy = .2, .75, 44, (.1, .1, .6), 6
def project(x, y, z):
    x, y, z = x - T[0], y - T[1], z - T[2]
    return 192 + (x * math.cos(yaw) - y * math.sin(yaw)) * S, 108 + oy - (x * math.sin(yaw) * math.sin(pitch) + y * math.cos(yaw) * math.sin(pitch) + z * math.cos(pitch)) * S
src = open('client/src/game/anim/recorder.ts').read()
RX = float(src.split('RECORDER_X = ')[1].split(';')[0]); RY = float(src.split('RECORDER_Y = ')[1].split(';')[0])
dx, dy = project(RX, RY, .1)
deck = (int(dx) - 10, int(dy) - 11, int(dx) + 11, int(dy) + 7)  # the deck alone; wider picks up falling snow
lx, ly = project(RX + .08 - .29, RY - .068 - .25, .017)
landing = (int(lx) - 9, int(ly) - 9, int(lx) + 9, int(ly) + 6)
whole = (0, 0, frames.shape[2], frames.shape[1])

mark = {m['name']: m for m in cap['marks']}
rows = []
def row(name, frame_i, t_audio, note=''):
    if frame_i is None or t_audio is None:
        rows.append((name, None, None, None, note or 'not found')); return
    seen = frame_t[frame_i]
    rows.append((name, (seen - frame_t[0]) * 1000, (t_audio - clap - frame_t[0]) * 1000, (t_audio - clap - seen) * 1000, note))

inserts = []
for e in cap['events']:
    if e['inserting'] and (not inserts or e['startedMs'] != inserts[-1]): inserts.append(e['startedMs'])
for n, started in enumerate(inserts):
    s = epoch(started); tag = f'insert {n + 1}'
    first = changes(deck, s, s + .25)
    row(f'{tag}: door starts opening', first[0] if first else None, attack(s - .05, s + .2), 'latch')
    if n == 1:
        moved = changes(landing, s + .25, s + .8, skip_jumps=True)
        row(f'{tag}: old tape lands in snow', moved[-1] if moved else None, attack(s + .35, s + .7, jump=6), 'last frame the old tape moves')
    moved = changes(deck, s + .6, s + 1.18, skip_jumps=True)
    row(f'{tag}: tape seated', moved[-1] if moved else None, attack(s + 1.0, s + 1.2), 'last frame the tape moves')
    moved = changes(deck, s + 1.19, s + 1.7, skip_jumps=True)
    row(f'{tag}: door shut', moved[-1] if moved else None, attack(s + 1.3, s + 1.55), 'last frame the door moves')
starts = [e for i, e in enumerate(cap['events']) if e['phase'] == 'playing' and cap['events'][i - 1]['phase'] == 'countdown']
for n, e in enumerate(starts):
    s = e['epoch'] - 0.05
    moved = changes(deck, s, s + .3)
    row(f'PLAY {n + 1}', moved[0] if moved else None, attack(s, s + .3), 'first frame the deck changes (key, reels)')
for name in ('pause', 'resume'):
    s = epoch(mark[name]['ms'])
    moved = changes(whole, s, s + .3, 20000, normalise=False)
    row(name, moved[0] if moved else None, attack(s, s + .3), 'first frame of the pause menu appearing/going')

# Sounds scheduled ahead are aimed at the speakers (getOutputTimestamp), but the
# capture taps them when rendered, output latency earlier; sounds started "now"
# (and the clapperboard) have that latency at the speakers too, so for them the
# captured offset already stands.
lag = float(np.median([x['currentTime'] - x['contextTime'] for x in cap['starts'] if x.get('contextTime')]))
ahead = lambda name: any(w in name for w in ('seated', 'shut', 'lands'))
print(f'clapperboard: audio minus picture = {clap * 1000:.1f} ms (n={len(claps)}, spread {np.ptp(claps) * 1000:.1f} ms); median frame interval {np.median(np.diff(frame_t)) * 1000:.1f} ms; output latency {lag * 1000:.1f} ms')
print(f"{'event':34s} {'frame (ms)':>10s} {'sound (ms)':>10s} {'captured':>9s} {'speakers':>9s}  how the frame was found")
for name, f, a, d, note in rows:
    est = None if d is None else d + (lag * 1000 if ahead(name) else 0)
    print(f"{name:34s} {'' if f is None else f'{f:10.1f}'} {'' if a is None else f'{a:10.1f}'} {'' if d is None else f'{d:+9.1f}'} {'' if est is None else f'{est:+9.1f}'}  {note}")
json.dump({'clapMs': clap * 1000, 'claps': [c * 1000 for c in claps], 'rows': rows}, open(prefix + '-sync.json', 'w'), indent=2)
