"""Courtyard props; all origins at local ground centre unless documented."""
import math
import random
from common import *


def paddle():
    # Grip centre is (0,0,0); blade is above it along +Z; red normal +Y.
    n=20
    outline=[(.075*math.cos(math.tau*i/n), .145+.08*math.sin(math.tau*i/n)) for i in range(n)]
    loft('blade_wood_edge',[[(x,y,z) for x,z in outline] for y in (-.005,.005)],'wood')
    for name,y,mat in [('red_rubber',.006,'rubber_red'),('black_rubber',-.006,'rubber_black')]:
        # Both sides are individually thin solids to remain one-sided glTF materials.
        loft(name,[[(x*.975,yy,.145+(z-.145)*.975) for x,z in outline] for yy in (y-.0008,y+.0008)],mat)
    box('wood_grip',(0,0,.005),(.029,.022,.116),'wood',bevel=.004)


def table():
    box('tabletop',(0,0,.74),(1.525,2.74,.04),'table_green')
    # Flat colour surfaces, no textures or UV-dependent lines.
    for s in (-1,1):
        box('sideline_'+str(s),(s*(.7625-.0125),0,.7605),(.025,2.74,.001),'court_line')
        box('endline_'+str(s),(0,s*(1.37-.0125),.7605),(1.475,.025,.001),'court_line')
    box('centreline',(0,0,.7605),(.02,2.69,.001),'court_line')
    for x in (-.6,.6):
        for y in (-1,1):
            box('table_leg',(x,y,.36),(.05,.05,.72),'metal')
        box('long_frame',(x,0,.674),(.04,2.1,.07),'metal')
    for y in (-1,1):
        box('cross_frame',(0,y,.66),(1.24,.04,.07),'metal')
        box('low_brace',(0,y,.25),(1.2,.035,.035),'metal')
    for x in (-.7925,.7925):
        box('net_post',(x,0,.838),(.026,.026,.156),'metal')
        box('net_clamp',(x,0,.738),(.07,.05,.045),'metal')
    # Actual open net: 38 vertical strands and 5 horizontal strands, no alpha map.
    for i in range(39):
        x=-.78+i*1.56/38
        box('net_vertical',(x,0,.832),(.003,.004,.134),'net_mesh')
    for z in (.77,.798,.826,.854,.882):
        box('net_horizontal',(0,0,z),(1.58,.004,.003),'net_mesh')
    box('net_top_tape',(0,0,.901),(1.60,.014,.019),'court_line')


def bench():
    # Long axis Y; front +X; back at X=-.29. Place at (-3,.6,0).
    for x in (-.18,0,.18):
        box('seat_slat',(x,0,.45),(.162,1.8,.06),'wood',bevel=.008)
    for z in (.61,.78):
        box('backrest_slat',(-.29,0,z),(.06,1.8,.14),'wood',bevel=.008)
    for y in (-.8,.8):
        box('bench_trestle',(0,y,.21),(.4,.06,.42),'metal',bevel=.009)
        box('back_support',(-.285,y,.59),(.035,.04,.53),'metal')
    # Broad angular snow caps; does not bury the wood silhouette.
    box('seat_snow',(0,0,.493),(.482,1.76,.027),'snow',bevel=.012)
    box('back_snow',(-.29,0,.858),(.082,1.76,.022),'snow',bevel=.008)


def lamppost():
    tube('pole',[(0,0,0),(0,0,.18),(0,0,3.13),(0,0,3.3)],[.06,.05,.04,.04],'metal',8)
    tube('curved_arm',[(0,0,3.25),(-.025,0,3.325),(-.085,0,3.367),(-.18,0,3.37),(-.30,0,3.34)],
         [.036,.035,.033,.03,.027],'metal',8)
    box('lamp_housing',(-.30,0,3.32),(.24,.16,.08),'metal',bevel=.025)
    box('sodium_bulb',(-.30,0,3.275),(.18,.115,.018),'emissive_bulb',bevel=.008)
    box('pole_foot',(0,0,.03),(.16,.16,.06),'metal',bevel=.015)


def tree(seed,height):
    rng=random.Random(seed)
    trunk=[(0,0,0),(.025,-.015,1.1),(-.07,.03,2.05),(.04,.075,3.03),(-.11,.1,height)]
    tube('angular_trunk',trunk,[.14,.11,.082,.049,.008],'bark',7)
    for k in range(8):
        z=1.48+k*.30
        a=k*2.399+seed*.2
        length=(1-(z/height)*.55)*rng.uniform(1.3,1.75)
        start=Vector((-.02,.03,z)); d=Vector((math.cos(a),math.sin(a),rng.uniform(.45,.83)))
        elbow=start+d*length*.54; tip=start+d*length+Vector((0,0,.30))
        tube('bough_'+str(k),[start,elbow,tip],[.055*(1-k*.055),.028,.006],'bark',6)
        for t in range(2):
            origin=start.lerp(tip,.43+t*.22)
            aa=a+(-.65 if t==0 else .7)
            finish=origin+Vector((math.cos(aa)*.62,math.sin(aa)*.62,.60-t*.08))
            tube('fork_'+str(k)+'_'+str(t),[origin,origin.lerp(finish,.57)+Vector((0,0,.05)),finish],[.025,.015,.004],'bark',5)
            spur=origin.lerp(finish,.60)
            tube('twig',[spur,spur+Vector((math.cos(aa+.8)*.3,math.sin(aa+.8)*.3,.34))],[.011,.003],'bark',5)
    for dx,dy in [(.22,0),(-.18,.1),(.02,-.2)]:
        tube('root_flare',[(0,0,.24),(dx,dy,.018)],[.07,.023],'bark',6)


def facade():
    # Origin is bottom centre of front wall. Front faces -Y, wall depth +Y.
    # Five 2.4 m storeys: requested height supersedes CPU wall's 9 m placeholder.
    box('panel_block',(0,.3,6),(24,.6,12),'wall')
    box('concrete_plinth',(0,-.017,.2),(24,.035,.4),'panel_seam')
    for z in (2.4,4.8,7.2,9.6):
        box('horizontal_panel_joint',(0,-.007,z),(24,.012,.028),'panel_seam')
    for i in range(16):
        x=-12+i*1.6
        box('vertical_panel_joint',(x,-.007,6),(.018,.012,12),'panel_seam')
    for row in range(5):
        for col in range(15):
            x=-11.2+col*1.6; z=row*2.4+1.32
            if row==0 and col==7: continue
            box('window_reveal',(x,-.018,z),(.79,.045,1.02),'panel_seam')
            mat='window_lit' if ((col*17+row*23+7)%19)<4 else 'window_dark'
            box(f'window_{row}_{col}',(x,-.045,z),(.704,.025,.96),mat)
            for dx in (-.37,0,.37):
                box('window_mullion',(x+dx,-.066,z),(.026,.035,.99),'window_frame')
            for dz in (-.49,.49):
                box('window_frame_rail',(x,-.066,z+dz),(.766,.035,.028),'window_frame')
            box('concrete_sill',(x,-.102,z-.515),(.83,.19,.045),'wall')
            box('sill_snow',(x,-.116,z-.487),(.79,.18,.013),'snow')
    box('entrance_surround',(0,-.04,1.12),(1.36,.12,2.24),'panel_seam')
    box('entrance_door',(0,-.115,1.06),(1.14,.045,2.12),'door')
    box('door_divider',(.22,-.146,1.06),(.025,.02,2.1),'metal')
    box('door_handle',(.10,-.18,1.02),(.025,.035,.24),'metal')
    box('entrance_canopy',(0,-.50,2.32),(1.74,1.04,.12),'metal')
    box('canopy_snow',(0,-.50,2.395),(1.75,1.05,.03),'snow')
    box('entrance_step',(0,-.38,.06),(1.52,.8,.12),'panel_seam')

BUILDERS={'paddle':paddle,'table':table,'bench':bench,'lamppost':lamppost,
          'tree_bare_a':lambda:tree(11,4.8),'tree_bare_b':lambda:tree(23,4.35),'building_facade':facade}

def main():
    stats={}
    for name,builder in BUILDERS.items():
        reset();builder();stats[name]=export_asset(name)
    print('PROP_STATS',json.dumps(stats))
    return stats

if __name__=='__main__':main()
