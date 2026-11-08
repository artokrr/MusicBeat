"""Build review artifacts from the real muted captures, without opening media."""
import json, subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
OUT=Path('tools/out'); ff='/opt/homebrew/bin/ffmpeg'
def run(args):subprocess.run([ff,'-v','error','-y',*map(str,args)],check=True)
def label(name,text,width=1152):
 im=Image.new('RGBA',(width,36),(12,15,24,235)); d=ImageDraw.Draw(im);font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',20);d.text((14,7),text,font=font,fill='white');p=OUT/name;im.save(p);return p
header=label('strokes-compare-label.png','BEFORE                                                         AFTER | compact strokes, quiet head',2304)
run(['-i',OUT/'strokes-before-jasmine.mp4','-i',OUT/'strokes-after-jasmine.mp4','-i',header,'-filter_complex','[0:v][1:v]hstack[v];[v][2:v]overlay=0:0[out]','-map','[out]','-map','1:a','-t','20','-r','60','-c:v','libx264','-crf','16','-pix_fmt','yuv420p','-c:a','aac',OUT/'strokes-before-after.mp4'])
data=json.loads((OUT/'strokes-after-jasmine-motion.json').read_text());notes=data['notes']
events=[('forehand drive',notes[20]['time']),('backhand drive',notes[16]['time']),('hold chop',next(n['time'] for n in notes if n['type']=='hold')),('combo 25 smash',notes[24]['time'])]
font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',24)
sheet=Image.new('RGB',(130*6*4,4*(108*4+42)),(18,20,30));draw=ImageDraw.Draw(sheet)
for row,(name,t) in enumerate(events):
 h=label(f'strokes-label-{row}.png',f'{name.upper()} | song {t:.3f}s | half speed')
 duration=1.5 if row!=2 else 2.1
 run(['-ss',str(t-3-.4),'-t',str(duration),'-i',OUT/'strokes-after-jasmine-native.mp4','-i',h,'-filter_complex','[0:v]setpts=2*(PTS-STARTPTS),scale=1152:648:flags=neighbor,fps=60[v];[v][1:v]overlay=0:0[out];[0:a]atempo=0.5[a]','-map','[out]','-map','[a]','-t',str(duration*2),'-c:v','libx264','-crf','14','-pix_fmt','yuv420p','-c:a','aac',OUT/f'strokes-clip-{row}.mp4'])
 draw.text((12,row*474+8),f'{name} | song {t:.3f}s | native crop x4, nearest neighbour',font=font,fill='white')
 for col,dt in enumerate([-.24,-.13,-.05,.03,.1,.23]):
  png=OUT/f'strokes-pose-{row}-{col}.png';run(['-ss',str(t-3+dt),'-i',OUT/'strokes-after-jasmine-native.mp4','-frames:v','1',png]);im=Image.open(png).crop((130,108,260,216)).resize((520,432),Image.Resampling.NEAREST);sheet.paste(im,(col*520,row*474+42))
sheet.save(OUT/'strokes-sheet.png')
(OUT/'strokes-clips.txt').write_text(''.join(f"file 'strokes-clip-{i}.mp4'\n" for i in range(4)))
run(['-f','concat','-safe','0','-i',OUT/'strokes-clips.txt','-c','copy',OUT/'strokes-half-speed.mp4'])
(OUT/'strokes-events.json').write_text(json.dumps(events,indent=2))
