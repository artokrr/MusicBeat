"""Pinned parity, causal/adjacent shadow-colour gates and delivery sheet.
Run after look3 probes and look2 fixed-frame/perf captures into look3-* folders.
"""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw
out=Path(__file__).resolve().parent/'out'
def image(folder,name='fixed-150.png'):return Image.open(out/folder/name).convert('RGB')
def read(folder,name):return np.array(image(folder,name+'.png'),float)
def y(a):return a@np.array([.2126,.7152,.0722])
def saturation(a):return (a.max(-1)-a.min(-1))/np.maximum(1,a.max(-1))
def warmth(a):return np.maximum(0,a[...,0]-a[...,2])/np.maximum(1,y(a))
def colour(s,l,mask):
 return dict(samples=int(mask.sum()),brighter=int(((y(s)>y(l)+2)&mask).sum()),
  warmer=int(((warmth(s)>warmth(l)+.02)&mask).sum()),
  moreSaturated=int(((saturation(s)>saturation(l)+.02)&mask).sum()))
metrics={}
for version in ['base-old','current','new']:
 folder='look3-'+version
 im=read(folder,'fixed-150');s=read(folder,'shadows');l=read(folder,'lit');m=read(folder,'snow-mask').min(-1)>245
 diff=y(l)-y(s);mask=m&(np.abs(diff)>3)
 regions={'pool':(240,118,320,151),'courtyard':(5,175,105,210),'tableMoon':(110,120,139,157),'benchMoon':(64,145,88,176),'farCourtyard':(80,18,145,48)}
 data={'regions':{k:dict(mean=round(float(y(im[y0:y1,x0:x1]).mean()),2),peak=round(float(y(im[y0:y1,x0:x1]).max()),2)) for k,(x0,y0,x1,y1) in regions.items()},'colour':colour(s,l,mask)}
 # Clipping is before depth haze, which otherwise hides a clipped byte below 255.
 pre=read(folder,'pre-haze')[114:151,240:380];data['poolClippedBeforeHaze']=int((pre.max(-1)>=254).sum())
 data['poolUniqueRGB']=int(len(np.unique(im[118:151,240:320].reshape(-1,3),axis=0)))
 region=np.zeros(m.shape,bool);region[145:176,64:88]=True;sample=region&mask
 data['moonContrast']=dict(samples=int(sample.sum()),shadowMean=round(float(y(s)[sample].mean()),2),litMean=round(float(y(l)[sample].mean()),2),loss=round(float(diff[sample].mean()),2))
 # Nearest adjacent unshadowed snow, within 12 pixels, matched in the unoccluded
 # image to exactly in RGB. This avoids treating texture/falloff as shadow.
 pairs=[]
 offsets=sorted([(dx,dy) for dy in range(-12,13) for dx in range(-12,13) if 0<dx*dx+dy*dy<=144],key=lambda t:t[0]**2+t[1]**2)
 for yy,xx in np.argwhere(mask):
  for dx,dy in offsets:
   x2,y2=xx+dx,yy+dy
   if 0<=x2<384 and 0<=y2<216 and m[y2,x2] and abs(diff[y2,x2])<1 and np.max(np.abs(l[yy,xx]-l[y2,x2]))==0:
    pairs.append((s[yy,xx],s[y2,x2]));break
 if pairs:
  a,b=np.array(pairs).transpose(1,0,2);data['adjacentColour']=colour(a,b,np.ones(len(a),bool))
 data['balls']=[]
 for i in range(4):
  a,b=read(folder,'ball-'+str(i)),read(folder,'ball-lit-'+str(i));d=y(b)-y(a);sel=d>2
  ys,xs=np.where(sel)
  data['balls'].append(dict(pixels=int(sel.sum()),bounds=[int(np.ptp(xs)+1),int(np.ptp(ys)+1)] if len(xs) else [0,0],meanContrast=round(float(d[sel].mean()),2) if sel.any() else 0,colour=colour(a,b,sel)))
 metrics[version]=data
cpuS,cpuL=[read('look3-new-cpu',n) for n in ['shadows','lit']]
metrics['cpuColour']=colour(cpuS,cpuL,np.abs(y(cpuS)-y(cpuL))>3)
parity=[]
for mode,before,after in [('GL','base-old','old'),('CPU','base-old-cpu','old-cpu')]:
 for f in sorted((out/('look3-'+before)).glob('fixed-*.png')):
  d=np.array(ImageChops.difference(image('look3-'+before,f.name),image('look3-'+after,f.name)))
  parity.append(dict(mode=mode,frame=f.name,changedPixels=int(np.any(d,axis=2).sum()),maxChannelDifference=int(d.max())))
# Reconstructed movie baseline must also match the original pre-edit capture.
if (out/'look3-replay/fixed-150.png').exists():
 replay=[]
 for f in sorted((out/'look3-current').glob('fixed-*.png')):
  d=np.array(ImageChops.difference(image('look3-current',f.name),image('look3-replay',f.name)))
  replay.append(dict(frame=f.name,changedPixels=int(np.any(d,axis=2).sum()),maxChannelDifference=int(d.max())))
 (out/'look3-baseline-parity.json').write_text(json.dumps(replay,indent=2)+'\n')
 assert len(replay)==8 and all(p['changedPixels']==0 for p in replay),replay
if (out/'look3-perf-optimized/fixed-150.png').exists():
 optimized=[]
 for f in sorted((out/'look3-new').glob('fixed-*.png')):
  d=np.array(ImageChops.difference(image('look3-new',f.name),image('look3-perf-optimized',f.name)))
  optimized.append(dict(frame=f.name,changedPixels=int(np.any(d,axis=2).sum()),maxChannelDifference=int(d.max())))
 (out/'look3-optimization-parity.json').write_text(json.dumps(optimized,indent=2)+'\n')
 assert len(optimized)==8 and all(p['changedPixels']==0 for p in optimized),optimized
(out/'look3-old-parity.json').write_text(json.dumps(parity,indent=2)+'\n')
(out/'look3-metrics.json').write_text(json.dumps({'method':'Display RGB Y=.2126R+.7152G+.0722B. Saturation=(max-min)/max; warm excess=max(0,R-B)/Y. Colour tolerances 2 bytes Y, .02 chroma. Causal samples change visibility only; adjacent samples match unoccluded texture/falloff exactly in RGB. Snow only, no props. CPU compares all changed receivers.','measurements':metrics},indent=2)+'\n')
assert len(parity)==16 and all(p['changedPixels']==0 for p in parity),parity
for check in [metrics['new']['colour'],metrics['new']['adjacentColour'],metrics['cpuColour']]:
 assert check['samples']>100 and not any(check[k] for k in ['brighter','warmer','moreSaturated']),check
assert metrics['current']['colour']['warmer']>0 # proves the gate detects the reported defect
assert metrics['new']['balls'][0]['pixels']<metrics['current']['balls'][0]['pixels']
assert metrics['new']['balls'][3]['pixels']==0
assert metrics['new']['poolClippedBeforeHaze']<=4 # isolated ice glints, not a flat pool
sheet=Image.new('RGB',(4608,1310),(17,19,27));draw=ImageDraw.Draw(sheet)
crops=[('lamppost base',(270,101,315,131)),('pool ball + cue',(294,122,316,143)),('table + moon shadow',(101,101,232,167)),('bench',(24,84,91,178)),('far courtyard',(80,18,145,48))]
for i,(folder,label) in enumerate([('look3-base-old','old'),('look3-current','573b8f1 current'),('look3-new','new')]):
 im=image(folder);x=i*1536;draw.text((x+16,14),label,fill='white');sheet.paste(im.resize((1536,864),Image.Resampling.NEAREST),(x,40))
 for j,(title,box) in enumerate(crops):
  xx=x+j*305;draw.text((xx+8,925),title+' (native / 2x)',fill='white')
  crop=(image(folder,'ball-0.png') if j==1 else im).crop(box)
  sheet.paste(crop,(xx+8,950));sheet.paste(crop.resize((crop.width*2,crop.height*2),Image.Resampling.NEAREST),(xx+8,1060))
sheet.save(out/'look3-three-way.png')
image('look3-new-cpu').save(out/'look3-cpu.png')
print(json.dumps(metrics,indent=2));print('PASS: parity, causal/adjacent colour, CPU colour, ball fade and no clipped plateau')
