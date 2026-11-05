"""Compare saved baseline and current PNGs without rescaling the source pixels.

Before rebuilding, copy the previous render PNGs into tools/out/before/.
Run verify_three.mjs on the baseline as well for matching game-front/back views.
"""
from pathlib import Path
from PIL import Image, ImageDraw

OUT=Path(__file__).resolve().parents[2]/'tools/out'
BEFORE=OUT/'before'
BG=(24,27,36);FG=(220,225,237)


def read(folder,name):
    image=Image.open(folder/name).convert('RGB')
    assert image.size==(384,216),(name,image.size)
    return image


def save(image,name):
    image.save(OUT/(name+'.png'))
    image.resize((image.width*3,image.height*3),Image.Resampling.NEAREST).save(OUT/(name+'_3x.png'))


# Full courtyard, followed by isolated silhouettes at exactly the same 44 px/m.
result=Image.new('RGB',(768,440),BG);draw=ImageDraw.Draw(result)
for column,(folder,label) in enumerate([(BEFORE,'BEFORE / e6d6b76'),(OUT,'AFTER / second modelling pass')]):
    x=column*384
    draw.text((x+12,8),label,fill=FG)
    result.paste(read(folder,'three_courtyard_rest_front.png'),(x,28))
    draw.text((x+12,254),'44 px/m, pitch .75 / stranger front + player back',fill=FG)
    for i,(kind,view) in enumerate([('stranger','game-front'),('player','game-back')]):
        raw=read(folder,f'three_{kind}_rest_{view}.png')
        # Crop only; retain source pixels at their original game resolution.
        result.paste(raw.crop((112,48,272,192)),(x+16+i*192,282))
save(result,'before_after_game')

# Per-character tests at game scale: each adjacent pair is before / after.
for kind,view in [('stranger','game-front'),('player','game-back')]:
    result=Image.new('RGB',(576,180),BG);draw=ImageDraw.Draw(result)
    for i,pose in enumerate(('rest','forehand','crouch')):
        draw.text((i*192+8,8),pose+' / old | new',fill=FG)
        for j,folder in enumerate((BEFORE,OUT)):
            raw=read(folder,f'three_{kind}_{pose}_{view}.png')
            result.paste(raw.crop((144,40,240,184)),(i*192+j*96,28))
    save(result,'before_after_'+kind+'_game')
print('Saved full courtyard and per-character game-resolution comparisons.')
