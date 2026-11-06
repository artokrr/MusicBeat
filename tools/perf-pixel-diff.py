"""Compare the deterministic 384x216 fixtures; Pillow is already available locally."""
import json
from pathlib import Path
from PIL import Image, ImageChops

root = Path(__file__).resolve().parent / 'out' / 'perf'
rows = []
for mode, before, after in [
    ('gl', 'before-pixels', 'final-pixels'),
    ('cpu', 'before-pixels-cpu', 'after-pixels-cpu'),
    ('disabled-webgl', 'before-pixels-cpu', 'after-no-webgl'),
]:
    for path in sorted((root / before).glob('fixed-*.png')):
        a = Image.open(path).convert('RGBA')
        b = Image.open(root / after / path.name).convert('RGBA')
        difference = ImageChops.difference(a, b)
        pixels = list(difference.get_flattened_data())
        rows.append({'mode': mode, 'frame': path.name,
                     'pixels': sum(p != (0, 0, 0, 0) for p in pixels),
                     'maxChannelDifference': max(max(p) for p in pixels)})
(root / 'pixel-diff.json').write_text(json.dumps(rows, indent=2) + '\n')
print(json.dumps({'comparisons': len(rows), 'changedPixels': sum(r['pixels'] for r in rows)}))
assert len(rows) == 24 and all(r['pixels'] == 0 for r in rows)
