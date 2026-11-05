"""Nearest-neighbour enlargements and contact sheets; never edits model geometry."""
from pathlib import Path
import json
from PIL import Image,ImageDraw

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'tools/out'
POSES=['rest','forehand','crouch'];VIEWS=['front','side','back']

def sheet(filename,cases,columns=3):
    rows=(len(cases)+columns-1)//columns
    result=Image.new('RGB',(384*columns,244*rows),(24,27,36));draw=ImageDraw.Draw(result)
    for i,(file,label) in enumerate(cases):
        x=i%columns*384;y=i//columns*244
        image=Image.open(OUT/file).convert('RGB')
        assert image.size==(384,216),(file,image.size)
        result.paste(image,(x,y+28));draw.text((x+12,y+8),label,fill=(220,225,237))
    result.save(OUT/filename)

for kind in ['stranger','player']:
    sheet(f'{kind}_poses.png',[(f'{kind}_{pose}_{view}.png',f'{kind} / {pose} / {view}') for pose in POSES for view in VIEWS])
    sheet(f'three_{kind}_poses.png',[(f'three_{kind}_{pose}_{view}.png',f'three r170 / {pose} / {view}') for pose in POSES for view in VIEWS])
    sheet(f'three_{kind}_game_poses.png',[(f'three_{kind}_{pose}_{view}.png',f'44 px/m, pitch .75 / {pose} / {view}') for view in ['game-front','game-back'] for pose in POSES])
    if (OUT/f'{kind}_grip_rest.png').exists():
        sheet(f'{kind}_grips.png',[(f'{kind}_grip_{pose}.png',f'{kind} / {pose} / paddle grip') for pose in POSES])
props=['paddle','table','bench','lamppost','tree_bare_a','tree_bare_b','building_facade']
sheet('props-sheet.png',[(name+'.png',name) for name in props])
sheet('three-props-sheet.png',[(f'three_{name}_rest_front.png',f'three r170 / {name}') for name in props])
# Every raw PNG gets a 3x nearest enlargement, including the individual views.
for path in sorted(OUT.glob('*.png')):
    im=Image.open(path)
    if im.size!=(384,216) or path.stem.endswith('_3x'):continue
    im.resize((1152,648),Image.Resampling.NEAREST).save(path.with_stem(path.stem+'_3x'))
# Simple stable name for the game-size browser proof.
Image.open(OUT/'three_courtyard_rest_front_3x.png').save(OUT/'three_courtyard_3x.png')
report=json.loads((OUT/'three-report.json').read_text())
assert report['passed'],report
print(f"Packaged PNGs. three.js max joint error: {report['maxJointError']:.12g} m")
