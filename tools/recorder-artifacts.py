"""Compose native-resolution review evidence; never opens or plays media."""
import json
import subprocess
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent / 'out'
NEAREST = Image.Resampling.NEAREST
before = Image.open(OUT / 'recorder-before.png').convert('RGB')
after = Image.open(OUT / 'recorder-after.png').convert('RGB')
board = Image.new('RGB', (1536, 1164), '#202029')
draw = ImageDraw.Draw(board)
draw.text((20, 10), 'BEFORE: 16 px / AFTER: 25 px   |   native crops, 4x nearest neighbour', fill='#ddd7c7')
for x, im, box in [(24, before, (270, 148, 320, 186)), (280, after, (282, 145, 332, 183))]:
    board.paste(im.crop(box).resize((200, 152), NEAREST), (x, 36))
draw.text((560, 38), 'Before - native full frame', fill='#ddd7c7')
board.paste(before, (560, 64))
draw.text((980, 38), 'After - native full frame', fill='#ddd7c7')
board.paste(after, (980, 64))
draw.text((20, 276), 'After - full frame, 4x nearest neighbour', fill='#ddd7c7')
board.paste(after.resize((1536, 864), NEAREST), (0, 300))
board = board.crop((0, 0, 1536, 1164))
board.save(OUT / 'recorder-before-after.png')

record = json.loads((OUT / 'cassette-sequence.json').read_text())
start = record['frames'][0]
playing = next(e['epoch'] for e in record['events'] if e['phase'] == 'playing')
ffmpeg = '/opt/homebrew/bin/ffmpeg'
def ff(args):
    subprocess.run([ffmpeg, '-hide_banner', '-loglevel', 'error', '-y', *args], check=True)
ff(['-ss', str(playing - start + 1), '-i', str(OUT / 'cassette-native.mp4'), '-t', '20',
    '-vf', 'fps=60,scale=1152:648:flags=neighbor', '-c:v', 'libx264', '-crf', '15', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', str(OUT / 'recorder-notes.mp4')])
ff(['-i', str(OUT / 'cassette-sequence.mp4'), '-c', 'copy', str(OUT / 'cassette-sequence-v2.mp4')])

# Full-song views retain the HUD, so clearance can be reviewed rather than inferred.
files = sorted(OUT.glob('recorder-full-song-*.png'))
sheet = Image.new('RGB', (384 * 4, 240 * ((len(files) + 3) // 4)), '#202029')
d = ImageDraw.Draw(sheet)
for i, file in enumerate(files):
    im = Image.open(file).convert('RGB')
    # Verified CDP canvas rect for shot.mjs: (192,64.5), 768x432.
    if im.size == (1152, 561):
        im = im.crop((192, 65, 960, 497))
    im = im.resize((384, 216), NEAREST)
    x, y = i % 4 * 384, i // 4 * 240
    sheet.paste(im, (x, y + 20)); d.text((x + 8, y + 3), f'{i * 10}s after initial capture', fill='#ddd7c7')
if files:
    sheet.save(OUT / 'recorder-whole-song.png')
