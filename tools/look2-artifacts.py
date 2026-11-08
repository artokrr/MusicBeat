"""Pinned-frame parity, display-RGB luminance gates, and native/nearest sheets."""
import json
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
out = Path(__file__).resolve().parent / 'out'
regions = {'lamp pool': (240,118,320,151), 'away from lamp': (5,175,105,210),
           'table shadow': (110,120,139,157), 'former ghost': (219,83,246,123)}
def read(folder, name='fixed-150.png'):
    return Image.open(out / folder / name).convert('RGB')
def luminance(im):
    return [.2126*r + .7152*g + .0722*b for r,g,b in im.get_flattened_data()]
images = [read('look2-'+n) for n in ['base-old','previous','retuned']]
labels = ['old (a1871a6)', 'previous new (a1871a6)', 'retuned']
metrics = {}
for name,im in zip(labels,images):
    metrics[name] = {r: {'mean': round(sum(v)/len(v),2), 'peak':round(max(v),2)}
                     for r,box in regions.items() for v in [luminance(im.crop(box))]}
    # Horizontal falloff through the pool, fixed 10x7-pixel bins. The lamp pole
    # shadow crosses the old profile near x320; keep it rather than cherry-pick.
    metrics[name]['falloff y132:139'] = {str(x):round(sum(luminance(im.crop((x,132,x+10,139))))/70,2) for x in range(240,380,10)}
    # Bright footprint on exposed snow, bounded away from table/recorder.
    metrics[name]['pool pixels >=220'] = sum(v>=220 for v in luminance(im.crop((240,114,380,151))))
parity=[]
for mode,before,after in [('gl','look2-base-old','look2-old'),('cpu','look2-base-cpu','look2-old-cpu')]:
    for p in sorted((out/before).glob('fixed-*.png')):
        d=ImageChops.difference(read(before,p.name),read(after,p.name))
        values=list(d.get_flattened_data())
        parity.append(dict(mode=mode,frame=p.name,changedPixels=sum(v!=(0,0,0) for v in values),maxChannelDifference=max(map(max,values))))
(out/'look2-old-parity.json').write_text(json.dumps(parity,indent=2)+'\n')
(out/'look2-luminance.json').write_text(json.dumps({'method':'display RGB Y = .2126R+.7152G+.0722B, 0..255; fixed-150, native 384x216, rectangle endpoints exclusive','regions':regions,'measurements':metrics},indent=2)+'\n')
assert len(parity)==16 and all(r['changedPixels']==0 for r in parity),parity
old,previous,new=[metrics[x] for x in labels]
assert new['lamp pool']['mean']>=old['lamp pool']['mean']
assert new['lamp pool']['peak']>=old['lamp pool']['peak']
assert new['pool pixels >=220']>=old['pool pixels >=220']
assert new['away from lamp']['mean']<old['away from lamp']['mean']
assert new['table shadow']['mean']<previous['table shadow']['mean']
sheet=Image.new('RGB',(4608,1300),(17,19,27));d=ImageDraw.Draw(sheet)
crops=[('pool',(240,118,320,151)),('table shadow',(100,104,150,175)),('former ghost',(218,76,253,137)),('bench',(23,85,79,174)),('recorder',(290,154,327,186))]
for i,(name,im) in enumerate(zip(labels,images)):
    x=i*1536;d.text((x+16,14),name,fill='white');sheet.paste(im.resize((1536,864),Image.Resampling.NEAREST),(x,40))
    for j,(label,box) in enumerate(crops):
        xx=x+j*305;d.text((xx+10,930),label+' (native, then 2x)',fill='white');c=im.crop(box)
        sheet.paste(c,(xx+10,960));sheet.paste(c.resize((c.width*2,c.height*2),Image.Resampling.NEAREST),(xx+10,1060))
sheet.save(out/'look2-three-way.png')
intro=Image.new('RGB',(4608,904),(17,19,27));d=ImageDraw.Draw(intro)
for i,name in enumerate(['start','mid','end']):
    d.text((i*1536+16,14),'retuned opening: '+name,fill='white')
    intro.paste(read('look2-retuned','intro-'+name+'.png').resize((1536,864),Image.Resampling.NEAREST),(i*1536,40))
intro.save(out/'look2-intro-frames.png')
read('look2-cpu').save(out/'look2-cpu.png')
print(json.dumps(metrics,indent=2));print('PASS: 16 identical old frames; luminance, footprint and contrast gates')
