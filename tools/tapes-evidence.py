"""Compose native-pixel evidence; never smooth or redraw the game images."""
import json
from pathlib import Path
from PIL import Image, ImageDraw
out=Path('tools/out')
board=Image.new('RGB',(1152,980),(20,22,29));d=ImageDraw.Draw(board)
items=[('1','one ejected tape'),('3','three ejected tapes'),('6','six ejected tapes'),('snow','nine minutes of snowfall'),('mixed','fresh tape among buried tapes'),('buried','fully buried')]
for i,(name,label) in enumerate(items):
 x=(i%3)*384;y=(i//3)*250
 d.text((x+12,y+10),label,fill=(220,220,218))
 im=Image.open(out/f'tapes-gl-{name}.png').convert('RGB')
 board.paste(im.crop((268,156,364,208)).resize((384,208),Image.Resampling.NEAREST),(x,y+28))
# One complete gameplay frame and CPU comparison at the same native scale.
d.text((12,516),'full gameplay frame (2x nearest)',fill='white')
board.paste(Image.open(out/'tapes-gl-mixed.png').resize((768,432),Image.Resampling.NEAREST),(0,540))
d.text((780,516),'CPU fallback / nine minutes (4x)',fill='white')
board.paste(Image.open(out/'tapes-cpu-snow.png').crop((268,156,364,208)).resize((384,208),Image.Resampling.NEAREST),(768,540))
board.save(out/'tapes-pile.png')
run=json.load(open(out/'cassette-sound-session.json'))
cap=run['capture'];mark=next(m['epoch'] for m in cap['marks'] if m['name']=='upload2')
insert=next(e for e in cap['events'] if e['inserting'] and e['epoch']>mark)
k=insert['epoch']-insert['ms']/1000
strip=Image.new('RGB',(6*384,216+24),(20,22,29));draw=ImageDraw.Draw(strip)
for i,ms in enumerate([100,250,450,650,820,1080]):
 target=k+(insert['startedMs']+ms)/1000
 n=min(range(len(run['frames'])),key=lambda n:abs(run['frames'][n]-target))
 im=Image.open(out/f'cassette-sound-session-frames/{n:05d}.png')
 strip.paste(im,(i*384,24));draw.text((i*384+8,6),f'{ms} ms / native frame {n}',fill='white')
strip.save(out/'tapes-eject-frames.png')
