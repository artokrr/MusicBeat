#!/usr/bin/env python3
"""Conventional Pillow rendering of the animator's sampled world-space joints."""
import json, math
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
out = Path('tools/out')
data = json.loads((out / 'animation.json').read_text())
font = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 13)
small = ImageFont.truetype('/System/Library/Fonts/Menlo.ttc', 11)
bones = [('pelvis','chest'),('chest','neck'),('neck','head'),('head','headTop')]
for side in ['L','R']:
    bones += [('chest','shoulder'+side),('shoulder'+side,'elbow'+side),('elbow'+side,'wrist'+side),('wrist'+side,'hand'+side),('pelvis','hip'+side),('hip'+side,'knee'+side),('knee'+side,'ankle'+side),('ankle'+side,'toe'+side)]
W,H,CW,RH = 1920,890,240,270
colors={'player':(174,203,231),'stranger':(159,157,182)}
def draw_pose(d, pose, actor, project):
    j=pose['joints']
    for a,b in bones:
        color=(232,176,112) if a.endswith('R') or b.endswith('R') else colors[actor]
        d.line([project(j[a]),project(j[b])],fill=color,width=3)
    for p in j.values():
        x,y=project(p); d.ellipse((x-2,y-2,x+2,y+2), fill=colors[actor])
    p=pose['paddle']; c=p['center']; u=p['up']; n=p['normal']
    a=[c[i]-.09*u[i] for i in range(3)]; b=[c[i]+.09*u[i] for i in range(3)]
    d.line([project(a),project(b)], fill=(244,108,126),width=6)
    d.line([project(c),project([c[i]+n[i]*.14 for i in range(3)])], fill=(244,108,126),width=1)
for scenario in data['scenarios']:
    im=Image.new('RGB',(W,H),(20,25,36)); d=ImageDraw.Draw(im)
    d.text((14,10),f"{scenario['name']}  |  orange = right arm/leg; red = paddle + normal; green = contact", font=font,fill='white')
    for col,s in enumerate(scenario['snapshots']):
        ox=col*CW
        d.text((ox+12,38),f"{s['t']:.3f} s",font=font,fill=(217,221,233))
        for row in range(3):
            oy=68+row*RH
            d.rectangle((ox+2,oy,ox+CW-2,oy+RH-4),outline=(50,57,73))
            if row == 0:
                # Exact courtyard camera axes: yaw .2, pitch .75 (ortho).
                def project(p):
                    x,y,z=p; scale=44
                    return (ox+120+(math.cos(.2)*x-math.sin(.2)*y)*scale,
                      oy+135-(math.sin(.2)*math.sin(.75)*x+math.cos(.2)*math.sin(.75)*y+math.cos(.75)*(z-.6))*scale)
                for actor in ['stranger','player']: draw_pose(d,s[actor],actor,project)
                table=[[-.76,-1.37,.76],[.76,-1.37,.76],[.76,1.37,.76],[-.76,1.37,.76],[-.76,-1.37,.76]]
                d.line([project(p) for p in table], fill=(73,105,100),width=1)
                d.text((ox+8,oy+8),'GAME CAMERA',font=small,fill=(150,159,174))
            else:
                actor='player' if row==1 else 'stranger'; f=1 if actor=='player' else -1; fy=-2.3 if f==1 else 2.05
                def project(p): return (ox+52+f*(p[1]-fy)*137, oy+243-p[2]*125)
                d.line([(ox+5,oy+243),(ox+CW-5,oy+243)], fill=(60,70,83))
                # Table edge and contact marker, side view.
                q=project([0,-1.5 if f==1 else 1.5,1.055]);d.ellipse((q[0]-4,q[1]-4,q[0]+4,q[1]+4),outline=(112,224,164))
                draw_pose(d,s[actor],actor,project)
                d.text((ox+8,oy+8),actor.upper()+' / SIDE',font=small,fill=(150,159,174))
    path=out/f"anim-{scenario['name']}.png";im.save(path);print(path)
# A single readable trajectory chart: feet have flat planted intervals.
im=Image.new('RGB',(1100,600),(20,25,36));d=ImageDraw.Draw(im)
s=next(s for s in data['scenarios'] if s['name']=='dense')
d.text((30,18),'8 notes/s alternating outside lanes: world x trajectories (metres)',font=font,fill='white')
for y in [-.8,-.4,0,.4,.8]:
    sy=300-y*240;d.line([(55,sy),(1060,sy)],fill=(50,57,73));d.text((10,sy-6),str(y),font=small,fill='white')
for key,color in [('player',(244,108,126)),('pelvis',(174,203,231)),('left',(119,212,177)),('right',(232,176,112))]:
    pts=[(55+p['t']/3*1005,300-p[key][0]*240) for p in s['trajectory']]
    d.line(pts,fill=color,width=2); i=['player','pelvis','left','right'].index(key);d.text((65+i*250,560),key,font=font,fill=color)
im.save(out/'anim-trajectories.png')
