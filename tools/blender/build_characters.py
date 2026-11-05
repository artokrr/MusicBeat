"""Tailored low-poly silhouettes; the shared rest skeleton is never reshaped."""
import math
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import bpy
from mathutils import Vector
from common import *


# Verification attachment only, in source metres. No extra bone or prop is
# exported with a character. The grip bore fits paddle.glb's 29 x 22 mm handle.
GRIP_CENTER = Vector((.323, .034, .813))
GRIP_UP = Vector((.94, 0, .342)).normalized()
GRIP_NORMAL = Vector((0, 1, 0))


def torso(kind):
    coat = kind == 'stranger'
    mat = 'coat' if coat else 'hoodie'
    # The upper rings taper all the way to the neck. There is no horizontal
    # shoulder shelf: trapezius -> deltoid -> sleeve forms one descending line.
    sections = [(.88,.145,.092),(.96,.15,.10),(1.10,.148,.099),
                (1.26,.170,.112),(1.345,.180,.106),(1.392,.158,.092),
                (1.435,.108,.073),(1.473,.054,.054)]
    if not coat:
        sections[:4] = [(.89,.157,.098),(.98,.165,.109),(1.13,.163,.111),(1.26,.175,.116)]
    rings = [ring(z,rx,ry) for z,rx,ry in sections]
    weights = []
    for points in rings:
        row = []
        for x,y,z in points:
            side = 'L' if x < 0 else 'R'
            shoulder = min(.34,max(0,(z-1.22)*2))*min(1,abs(x)/.15)
            # A little arm influence keeps the outer chest joined to raised
            # sleeves. The neck end stays with spine rather than being dragged.
            arm = max(0,1-abs(z-1.355)/.095)*max(0,(abs(x)-.115)/.07)*.19
            row.append({'spine':1-shoulder-arm,'clavicle'+side:shoulder,'upperArm'+side:arm})
        weights.append(row)
    loft('coat_body' if coat else 'hoodie_body',rings,mat,weights)
    if not coat:
        loft('neck_skin',[ring(1.44,.046,.044,.014,8),ring(1.58,.05,.046,.02,8)],'player_skin',
             [{'spine':.15,'neck':.85},{'neck':1}])
        loft('hoodie_waistband',[ring(.875,.153,.096),ring(.91,.158,.101),ring(.935,.16,.104)],mat,[{'spine':1}]*3)
    else:
        coat_skirt()
        # Broad standing collar, partly exposed below the low hood rim. No trim.
        loft('raised_coat_collar',[ring(1.395,.087,.081,.005,10),ring(1.49,.084,.080,.005,10),
                                  ring(1.548,.069,.073,.008,10)],'coat',
             [{'spine':.8,'neck':.2},{'spine':.25,'neck':.75},{'neck':1}],caps=False)


def coat_skirt():
    # Two broad pleats flank a narrow rear vent. Most of the hem is level, so
    # this reads as a heavy A-line coat, rather than pointed/splayed coat tails.
    angles = [0,30,60,82,90,98,120,150,180,210,240,260,270,280,300,330]
    rings=[]; weights=[]
    for z,rx,ry,amount in [(.345,.255,.169,.40),(.54,.230,.154,.32),
                           (.76,.188,.126,.16),(.96,.150,.100,.035)]:
        points=[]; row=[]
        for deg in angles:
            a=math.radians(deg); x=rx*math.cos(a); y=ry*math.sin(a)
            fold=(.96-z)/.615
            if deg in (240,300): y-=.021*fold
            if deg in (60,120): y+=.010*fold
            zz=z
            if z==.345:
                if deg==270: zz=.525
                if deg==90: zz=.378
            points.append((x,y,zz))
            right=max(0,min(1,.5+x/(rx*1.25)))
            row.append({'spine':1-amount,'thighL':amount*(1-right),'thighR':amount*right})
        rings.append(points); weights.append(row)
    loft('heavy_vented_coat_skirt',rings,'coat',weights,caps=False)
    # Inturned hem provides thickness and keeps the underside from disappearing.
    inner=[(x*.978,y*.978,z+.009) for x,y,z in rings[0]]
    loft('coat_hem_turnback',[inner,rings[0]],'coat',[weights[0],weights[0]],caps=False)


def limb_rings(centers,radii,sides=8,start_direction=None):
    rings=[]
    for i,c in enumerate(centers):
        direction=(centers[min(i+1,len(centers)-1)]-centers[max(0,i-1)]).normalized()
        if start_direction is not None and i<3:direction=start_direction.normalized()
        u=direction.cross(Vector((0,1,0))).normalized()
        v=u.cross(direction).normalized()
        rx,ry=radii[i]
        rings.append([c+u*(rx*math.cos(a*math.tau/sides))+v*(ry*math.sin(a*math.tau/sides)) for a in range(sides)])
    return rings


def mittens(side,wrist,hand,skin):
    direction=(hand-wrist).normalized()
    if side=='R':
        # Closed mitten wraps a real, open 18 mm radius grip channel. Four
        # axial rings round the knuckles; the thumb bridges the top/front.
        up=GRIP_UP; normal=GRIP_NORMAL; across=normal.cross(up).normalized()
        rings=[]
        for t,outer in [(-.034,.027),(-.023,.036),(.019,.037),(.034,.028)]:
            c=GRIP_CENTER+up*t
            rings.append([c+normal*(outer*math.cos(a*math.tau/10))+across*(outer*math.sin(a*math.tau/10)) for a in range(10)])
        # Reverse along the bore, joining outer and inner surfaces at each end.
        for t in (.034,-.034):
            c=GRIP_CENTER+up*t
            rings.append([c+normal*(.0185*math.cos(a*math.tau/10))+across*(.0185*math.sin(a*math.tau/10)) for a in range(10)])
        rings.append(rings[0])
        loft('right_grip_mitten',rings,skin,[{'handR':1}]*len(rings),caps=False)
        # Wrist/palm merges with the back of the fist without blocking its bore.
        centers=[wrist-direction*.008,wrist+direction*.019,GRIP_CENTER-normal*.027]
        loft('right_palm',limb_rings(centers,[(.026,.026),(.030,.026),(.026,.015)]),skin,[{'handR':1}]*3)
        points=[GRIP_CENTER-up*.025-across*.022,
                GRIP_CENTER-up*.013+normal*.030-across*.017,
                GRIP_CENTER+up*.015+normal*.031-across*.003]
        thumb=tube('gripping_thumb',points,[.014,.015,.011],skin,6)
    else:
        centers=[wrist, wrist.lerp(hand,.45),hand,hand+direction*.009]
        loft('mitten_L',limb_rings(centers,[(.027,.025),(.034,.027),(.027,.023),(.017,.016)]),skin,[{'handL':1}]*4)
        base=wrist.lerp(hand,.30)+Vector((.025,.006,0))
        thumb=tube('thumb_L',[base,base+Vector((.015,.015,-.023)),base+Vector((.011,.019,-.040))],[.014,.014,.009],skin,6)
    group=thumb.vertex_groups.new(name='hand'+side)
    group.add(list(range(len(thumb.data.vertices))),1,'REPLACE')


def limbs(kind):
    _,j=contract();coat=kind=='stranger';mat='coat' if coat else 'hoodie'
    for side in ('L','R'):
        sign=-1 if side=='L' else 1
        shoulder,elbow,wrist=[Vector(j[n+side]) for n in ('shoulder','elbow','wrist')]
        # The first sleeve ring/cap is buried under the sloping torso, not
        # perched above the shoulder joint. The deltoid sits below the neck.
        centers=[Vector((sign*.151,0,1.389)),shoulder.lerp(elbow,.18),shoulder.lerp(elbow,.36),
                 shoulder.lerp(elbow,.70),shoulder.lerp(elbow,.91),elbow,
                 elbow.lerp(wrist,.09),elbow.lerp(wrist,.26),elbow.lerp(wrist,.67),
                 elbow.lerp(wrist,.91),wrist]
        radii=[(.039,.056),(.058,.066),(.061,.064),(.052,.054),(.048,.050),(.051,.052),
               (.047,.049),(.047,.048),(.038,.039),(.032,.034),(.030,.032)]
        if not coat:
            radii=[(.041,.058),(.061,.072),(.069,.074),(.063,.063),(.055,.056),(.056,.057),
                   (.053,.054),(.054,.055),(.046,.046),(.033,.035),(.030,.032)]
        clav='clavicle'+side;upper='upperArm'+side;fore='foreArm'+side
        aw=[{'spine':.20,clav:.55,upper:.25},{clav:.32,upper:.68},{clav:.06,upper:.94},
            {upper:1},{upper:.84,fore:.16},{upper:.5,fore:.5},{upper:.16,fore:.84},
            {fore:1},{fore:1},{fore:1},{fore:1}]
        armrings=limb_rings(centers,radii,start_direction=elbow-shoulder)
        loft('sleeve_'+side,armrings,mat,aw)
        if not coat:
            # Narrow ribless cuff: a single quiet fabric break, no decoration.
            loft('hoodie_cuff_'+side,limb_rings([elbow.lerp(wrist,.91),wrist+Vector((0,0,-.005))],[(.034,.036),(.031,.033)]),mat,[{fore:1}]*2)
        mittens(side,wrist,Vector(j['hand'+side]),'stranger_skin' if coat else 'player_skin')
        hip,knee,ankle=[Vector(j[n+side]) for n in ('hip','knee','ankle')]
        centers=[hip+Vector((0,0,.008)),hip.lerp(knee,.19),hip.lerp(knee,.65),hip.lerp(knee,.91),knee,
                 knee.lerp(ankle,.09),knee.lerp(ankle,.32),knee.lerp(ankle,.63),knee.lerp(ankle,.91),ankle]
        radii=[(.074,.088),(.077,.085),(.063,.069),(.052,.059),(.054,.062),
               (.050,.055),(.060,.064),(.048,.052),(.036,.042),(.035,.040)]
        thigh='thigh'+side;shin='shin'+side
        lw=[{'spine':.25,thigh:.75},{thigh:1},{thigh:1},{thigh:.86,shin:.14},{thigh:.5,shin:.5},
            {thigh:.14,shin:.86},{shin:1},{shin:1},{shin:1},{shin:.9,'foot'+side:.1}]
        loft('trouser_leg_'+side,limb_rings(centers,radii),'trousers' if coat else 'jeans',lw)
        # Sneaker upper reuses jeans' existing dark material, leaving the pale
        # sneaker material on a distinct 27 mm sole. No new material names.
        outline=[(-.049,-.07),(.049,-.07),(.057,.04),(.053,.17),(.033,.195),(-.033,.195),(-.053,.17),(-.057,.04)]
        def shoe_ring(z,scale,dy=0):return [(ankle.x+x*scale,y*scale+dy,z) for x,y in outline]
        foot={'foot'+side:1}
        loft('sole_'+side,[shoe_ring(.006,.96),shoe_ring(.016,1),shoe_ring(.034,1)],
             'shoes' if coat else 'sneakers',[foot]*3)
        loft('shoe_upper_'+side,[shoe_ring(.034,.97),shoe_ring(.070,.92,-.005),shoe_ring(.114,.67,-.032)],
             'shoes' if coat else 'jeans',[foot]*3)
    if not coat:
        loft('jeans_pelvis',[ring(.80,.150,.088),ring(.94,.149,.09)],'jeans',[{'spine':1}]*2)


def hood_up():
    n=12
    def contour(rx,rz,y,cz=1.635,peak=0):
        points=[]
        for i in range(n):
            a=math.tau*i/n
            x=rx*math.cos(a);z=cz+rz*math.sin(a)
            yy=y
            if i==3:z+=peak;yy+=peak*.6
            if i==9:z+=.012
            points.append((x,yy,z))
        return points
    # A deep cowl: back -> crown -> forward peak -> thick rolled opening.
    # The lower rim projects too, exposing the cavity to a front-above camera.
    rings=[contour(.035,.075,-.153),contour(.104,.142,-.111,peak=.008),
           contour(.134,.167,-.020,peak=.033),contour(.132,.166,.135,peak=.040),
           contour(.099,.132,.162,peak=.029)]
    loft('peaked_deep_hood',rings,'coat',[{'head':1}]*5,caps=False)
    mesh('hood_back',rings[0],[tuple(range(n))],'coat',[{'head':1}]*n)
    # Deep black cavity and a full recessed closure, rigid together with hood.
    inner=[rings[-1],contour(.087,.119,.077,peak=.018),contour(.056,.090,-.042,peak=.010)]
    loft('hood_inner_void',inner,'face_void',[{'head':1}]*3,caps=False)
    mesh('hood_void_back',inner[-1],[tuple(range(n))],'face_void',[{'head':1}]*n)


def player_head():
    sections=[(1.535,.045,.052,.044),(1.565,.071,.073,.033),(1.63,.091,.084,.023),
              (1.70,.089,.079,.01),(1.75,.067,.061,.004),(1.765,.035,.034,.004)]
    loft('head_skin',[ring(z,rx,ry,cy,10) for z,rx,ry,cy in sections],'player_skin',[{'head':1}]*6)
    mesh('nose',[(-.017,.099,1.645),(.017,.099,1.645),(0,.128,1.616),(-.018,.096,1.604),(.018,.096,1.604)],
         [(0,1,2),(0,2,3),(1,4,2),(2,4,3)],'player_skin',[{'head':1}]*5)
    for s in (-1,1):box('ear_'+str(s),(s*.091,.004,1.638),(.018,.035,.052),'player_skin',{'head':1},.007)
    # Cropped nape and sides; irregular diagonal hairline and swept crown.
    bottom=[];middle=[];top=[]
    for i in range(12):
        a=math.tau*i/12;front=math.sin(a);x=math.cos(a)
        z=1.670+max(0,front)*(.040+.009*x)-max(0,-front)*.039
        if i in (2,5):z-=.012
        bottom.append((.093*x,.012+.087*front,z))
        middle.append((.096*x-.003,.008+.084*front,1.742+.008*x+.006*front))
        top.append((.059*x-.009,.005+.053*front,1.777+.010*x+.007*front))
    loft('shaped_short_hair',[bottom,middle,top],'hair',[{'head':1}]*3)
    # Broad, collapsed hood with a thick rolled U and a shaded inner well.
    # Its upper rim sits on the shoulder slope and the bowl bulges down/back.
    outer=[(-.075,-.025,1.470),(-.136,-.055,1.426),(-.145,-.120,1.369),(-.110,-.142,1.320),
           (0,-.157,1.295),(.110,-.142,1.320),(.145,-.120,1.369),(.136,-.055,1.426),(.075,-.025,1.470)]
    lip=[(x*.82,y-.012,z+.015) for x,y,z in outer]
    inner=[(x*.60,y+.025,z+.023) for x,y,z in outer]
    vertices=outer+lip+inner
    faces=[]
    for row in range(2):
        for i in range(8):faces.append((row*9+i,row*9+i+1,(row+1)*9+i+1,(row+1)*9+i))
    vertices.append((0,-.124,1.350));center=len(vertices)-1
    for i in range(8):faces.append((18+i,18+i+1,center))
    # Close the outer backing; the actual visible surface is the above U/bowl.
    vertices.append((0,-.193,1.365));back=len(vertices)-1
    for i in range(8):faces.append((i+1,i,back))
    faces.extend([(0,9,18,center,back),(8,back,center,26,17)])
    mesh('bunched_hood_down',vertices,faces,'hoodie',[{'spine':1}]*len(vertices))


def build(kind):
    reset()
    torso(kind);limbs(kind)
    hood_up() if kind=='stranger' else player_head()
    rig=make_rig(kind)
    rig['right_hand_grip_center_zup']=list(GRIP_CENTER)
    rig['right_hand_grip_up_zup']=list(GRIP_UP)
    rig['right_hand_grip_normal_zup']=list(GRIP_NORMAL)
    for obj in list(bpy.context.scene.objects):
        if obj.type=='MESH':bind(obj,rig)
    return rig


def main():
    stats={}
    for kind in ('stranger','player'):
        build(kind);stats[kind]=export_asset(kind)
    # A character-only pass updates their manifest entries without rebuilding
    # or changing any of the seven props.
    manifest_path=MODELS/'manifest.json'
    if manifest_path.exists():
        manifest=json.loads(manifest_path.read_text());manifest['assets'].update(stats)
        manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
    print('CHARACTER_STATS',json.dumps(stats))
    return stats

if __name__=='__main__':main()
