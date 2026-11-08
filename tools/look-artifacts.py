"""Pixel identity gate and same-frame contact sheet (Pillow only)."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
root=Path(__file__).resolve().parent/'out'
rows=[]
for mode,before,after in [('gl','look-head','look-old-fixed'),('cpu','look-baseline-cpu','look-old-cpu')]:
 for p in sorted((root/before).glob('fixed-*.png')):
  a=Image.open(p).convert('RGB');b=Image.open(root/after/p.name).convert('RGB')
  diff=list(ImageChops.difference(a,b).get_flattened_data())
  rows.append(dict(mode=mode,frame=p.name,changedPixels=sum(c!=(0,0,0) for c in diff),maxChannelDifference=max(map(max,diff))))
(root/'look-old-parity.json').write_text(json.dumps(rows,indent=2)+'\n')
assert len(rows)==16 and all(r['changedPixels']==0 for r in rows),rows
old=Image.open(root/'look-old-fixed/fixed-150.png').convert('RGB')
new=Image.open(root/'look-new-fixed/fixed-150.png').convert('RGB')
sheet=Image.new('RGB',(3072,1230),(19,21,30));draw=ImageDraw.Draw(sheet)
draw.text((18,16),'OLD - original branch head 816fcbc',fill='white');draw.text((1554,16),'NEW - same pose and presentation clock',fill='white')
sheet.paste(old.resize((1536,864),Image.Resampling.NEAREST),(0,44));sheet.paste(new.resize((1536,864),Image.Resampling.NEAREST),(1536,44))
regions=[('table / legs',(152,135,237,185)),('former pink ghost',(218,76,253,137)),('lamp cone / snow',(253,0,305,110)),('recorder',(290,154,327,186)),('bench', (23,85,79,174))]
for i,(name,box) in enumerate(regions):
 x=i*614;draw.text((x+12,922),name+' | native old / new, then 2x',fill='white')
 a=old.crop(box);b=new.crop(box);sheet.paste(a,(x+12,948));sheet.paste(b,(x+115,948));
 sheet.paste(a.resize((a.width*2,a.height*2),Image.Resampling.NEAREST),(x+226,948));sheet.paste(b.resize((b.width*2,b.height*2),Image.Resampling.NEAREST),(x+418,948))
sheet.save(root/'look-before-after.png')
print('16 frames, zero changed pixels; contact sheet written')
