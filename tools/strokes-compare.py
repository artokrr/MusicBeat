"""Assert the motion symptoms reduced; retain all peak metrics, even increases."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
out=Path('tools/out')
checks=[('pelvis','verticalCm',.5),('head','peakPxS',.7),('handL','verticalCm',.5),('ankleL','peakPxS',.65),('ankleR','peakPxS',.65)]
def check(before,after):
 for joint,metric,ratio in checks:assert after['joints'][joint][metric]<before['joints'][joint][metric]*ratio,(joint,metric)
report={};lines=[]
for song in ['jasmine','shagi']:
 before=json.loads((out/f'strokes-before-{song}-metrics.json').read_text());after=json.loads((out/f'strokes-after-{song}-metrics.json').read_text())
 try:check(before,before)
 except AssertionError:pass
 else:raise AssertionError('negative control did not fail')
 check(before,after);report[song]={'before':before,'after':after}
 lines+=['',f'### {song}: song seconds 3–30','', '| Joint | Peak px/s | Peak px/s² | Peak px/s³ | Z range cm | Horizontal reversals/s |','|---|---:|---:|---:|---:|---:|']
 for joint in before['joints']:
  a=before['joints'][joint];b=after['joints'][joint]
  lines.append('| '+joint+' | '+' | '.join(f'{a[k]:.1f} → {b[k]:.1f}' for k in ['peakPxS','peakPxS2','peakPxS3','verticalCm','xReversalsPerSec'])+' |')
(out/'strokes-comparison.json').write_text(json.dumps(report,indent=2));(out/'strokes-metrics.md').write_text('\n'.join(lines)+'\n')
image=Image.new('RGB',(1100,700),(18,22,32));d=ImageDraw.Draw(image);font=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',21);small=ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc',17)
d.text((28,20),'Real-game motion | before / after',font=font,fill='white');d.text((28,55),'Native-pixel measurements, song seconds 3–30. Each pair has its own scale.',font=small,fill='#bac2d0')
for col,song in enumerate(report):
 x=28+col*540;d.text((x,100),'Night, Blooming Jasmine' if song=='jasmine' else 'Буерак — Шаги',font=font,fill='white')
 for row,(joint,metric,_) in enumerate(checks):
  a=report[song]['before']['joints'][joint][metric];b=report[song]['after']['joints'][joint][metric];y=155+row*103
  name={'pelvis':'Pelvis vertical range (cm)','head':'Head peak speed (px/s)','handL':'Free hand vertical range (cm)','ankleL':'Left foot peak speed (px/s)','ankleR':'Right foot peak speed (px/s)'}[joint]
  d.text((x,y),name,font=small,fill='#ccd4df')
  for k,(v,c) in enumerate([(a,'#c18484'),(b,'#8dbeb1')]):
   yy=y+27+k*23;width=360*v/max(a,b);d.rectangle((x,yy,x+width,yy+15),fill=c);d.text((x+width+8,yy-2),f'{v:.1f}',font=small,fill='white')
image.save(out/'strokes-metrics.png');print('Two-song motion regression checks pass; baseline-vs-baseline negative control fails as expected.')
