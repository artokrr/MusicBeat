"""Waist-height multiball basket; run Blender --background --python this_file."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import *


def basket():
    # Local ground centre. Rim is at 0.98m, beside the stranger's free hand.
    for x in (-.16, .16):
        for y in (-.14, .14):
            tube('folding_leg', [(x*1.3,y*1.3,.02),(x,y,.75)], [.014,.014], 'metal', 6)
    box('basket_floor',(0,0,.74),(.38,.32,.025),'metal',bevel=.008)
    for z in (.76,.86,.98):
        for y in (-.17,.17):
            box('basket_long_rim',(0,y,z),(.42,.022,.025),'metal',bevel=.004)
        for x in (-.20,.20):
            box('basket_short_rim',(x,0,z),(.022,.34,.025),'metal',bevel=.004)
    for i in range(7):
        x=-.18+i*.06
        for y in (-.17,.17):
            box('basket_vertical',(x,y,.865),(.009,.014,.22),'metal')
    for y in (-.12,-.06,0,.06,.12):
        for x in (-.20,.20):
            box('basket_vertical',(x,y,.865),(.014,.009,.22),'metal')
    # A few faceted off-white balls catch the lamp, with dark gaps between them.
    for i,(x,y,z) in enumerate([(-.13,-.10,.91),(-.03,-.10,.92),(.08,-.10,.91),(.14,.01,.94),
                               (-.13,.01,.95),(-.02,.01,.94),(.07,.09,.95),(-.09,.10,.94)]):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=.047, location=(x,y,z))
        obj=bpy.context.object; obj.name='practice_ball_'+str(i)
        obj.data.materials.append(material('court_line'))
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.select_set(False)

if __name__ == '__main__':
    reset(); basket(); print('BASKET_STATS', json.dumps(export_asset('ball_basket')))
