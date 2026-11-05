"""Construct tailored, weighted adult silhouettes from coarse polygon rings."""
import math
import bpy
from mathutils import Vector
from common import *


def torso(kind):
    coat=kind=='stranger'; mat='coat' if coat else 'hoodie'
    sections=[(.88,.145,.091),(.96,.15,.10),(1.08,.143,.096),(1.25,.167,.106),
              (1.36,.191,.105),(1.425,.184,.09),(1.465,.075,.065)]
    if not coat: sections[0]=(.88,.158,.096)
    rings=[ring(z,rx,ry) for z,rx,ry in sections]
    weights=[]
    for points in rings:
        row=[]
        for x,y,z in points:
            shoulder=max(0,min(.48,(z-1.24)*2.2))*min(1,abs(x)/.16)
            clav='clavicleL' if x<0 else 'clavicleR'
            row.append({'spine':1-shoulder,clav:shoulder})
        weights.append(row)
    loft('coat_body' if coat else 'hoodie_body',rings,mat,weights)
    # Neck is deliberately hidden inside the stranger's collar and hood.
    if not coat:
        loft('neck_skin',[ring(1.43,.047,.045,.014,8),ring(1.58,.052,.047,.02,8)],'player_skin',
             [{'spine':.15,'neck':.85},{'neck':1}])
        loft('hoodie_waistband',[ring(.87,.158,.096),ring(.92,.151,.096)],mat,[{'spine':1}]*2)
    else:
        # A deep hem with a front and rear vent. The shallow V is deliberate,
        # so each leg has its own hanging coat panel when it strides.
        rings=[ring(.365,.237,.163),ring(.56,.222,.15),ring(.78,.185,.12),ring(.97,.151,.101)]
        rings[0]=[(x,y,.54 if abs(x)<.001 and y>0 else .46 if abs(x)<.001 else z) for x,y,z in rings[0]]
        weights=[]
        for j,points in enumerate(rings):
            amount=[.38,.30,.17,.04][j]
            weights.append([{'spine':1-amount, 'thighL' if x<0 else 'thighR':amount} for x,y,z in points])
        loft('split_coat_skirt',rings,'coat',weights,caps=False)
        # Broad collar planes provide tailoring without drawn-on surface detail.
        for s in (-1,1):
            mesh('coat_lapel_'+str(s),[(s*.06,.065,1.46),(s*.15,.096,1.35),(s*.035,.116,1.16),(s*.02,.108,1.38)],
                 [(0,1,2,3)],'coat',[{'spine':1}]*4)
        loft('raised_coat_collar',[ring(1.405,.085,.076,.012,8),ring(1.54,.078,.074,.012,8)],'coat',
             [{'spine':.8,'neck':.2},{'neck':1}],caps=False)


def limbs(kind):
    _,j=contract(); coat=kind=='stranger'
    for side in ('L','R'):
        sign=-1 if side=='L' else 1
        shoulder,elbow,wrist=[Vector(j[n+side]) for n in ('shoulder','elbow','wrist')]
        centers=[shoulder+(shoulder-elbow)*.08,shoulder.lerp(elbow,.12),shoulder.lerp(elbow,.77),
                 elbow,elbow.lerp(wrist,.23),elbow.lerp(wrist,.79),wrist]
        radii=[(.069,.073),(.071,.069),(.055,.057),(.052,.054),(.049,.051),(.039,.043),(.037,.038)]
        armrings=[]
        # X/Z sideways axis follows the limb; Y axis gives controlled sleeve depth.
        for i,c in enumerate(centers):
            direction=(centers[min(i+1,6)]-centers[max(0,i-1)]).normalized()
            u=direction.cross(Vector((0,1,0))).normalized(); v=Vector((0,1,0))
            armrings.append([c+u*(radii[i][0]*math.cos(a*math.tau/8))+v*(radii[i][1]*math.sin(a*math.tau/8)) for a in range(8)])
        aw=[{f'clavicle{side}':.45,f'upperArm{side}':.55}, {f'clavicle{side}':.15,f'upperArm{side}':.85},
            {f'upperArm{side}':.9,f'foreArm{side}':.1},{f'upperArm{side}':.5,f'foreArm{side}':.5},
            {f'upperArm{side}':.1,f'foreArm{side}':.9},{f'foreArm{side}':1},{f'foreArm{side}':.9,f'hand{side}':.1}]
        loft('sleeve_'+side,armrings,'coat' if coat else 'hoodie',aw)
        # A mitten palm and single thumb; small enough to read as adult hands.
        hand=Vector(j['hand'+side]); direction=(hand-wrist).normalized()
        u=direction.cross(Vector((0,1,0))).normalized(); v=Vector((0,1,0))
        handrings=[]
        for c,rx,ry in [(wrist,.029,.027),(wrist.lerp(hand,.48),.038,.027),(hand,.027,.022),(hand+direction*.012,.016,.015)]:
            handrings.append([c+u*rx*math.cos(a*math.tau/8)+v*ry*math.sin(a*math.tau/8) for a in range(8)])
        skin='stranger_skin' if coat else 'player_skin'
        loft('mitten_'+side,handrings,skin,[{f'hand{side}':1}]*4)
        thumbbase=wrist.lerp(hand,.3)+Vector((-sign*.027,.006,0))
        thumb=tube('thumb_'+side,[thumbbase,thumbbase+Vector((-sign*.018,.012,-.025)),thumbbase+Vector((-sign*.014,.016,-.043))],[.016,.016,.009],skin,6)
        g=thumb.vertex_groups.new(name='hand'+side);g.add(list(range(len(thumb.data.vertices))),1,'REPLACE')
        hip,knee,ankle=[Vector(j[n+side]) for n in ('hip','knee','ankle')]
        centers=[hip+Vector((0,0,.005)),hip.lerp(knee,.2),hip.lerp(knee,.78),knee,knee.lerp(ankle,.22),knee.lerp(ankle,.8),ankle]
        radii=[(.073,.085),(.072,.078),(.061,.064),(.059,.062),(.055,.056),(.043,.048),(.041,.047)]
        legrings=[[(c.x+rx*math.cos(a*math.tau/10),c.y+ry*math.sin(a*math.tau/10),c.z) for a in range(10)] for c,(rx,ry) in zip(centers,radii)]
        lw=[{'spine':.25,'thigh'+side:.75},{'thigh'+side:1},{'thigh'+side:.9,'shin'+side:.1},
            {'thigh'+side:.5,'shin'+side:.5},{'thigh'+side:.1,'shin'+side:.9},{'shin'+side:1},{'shin'+side:.85,'foot'+side:.15}]
        loft('trouser_leg_'+side,legrings,'trousers' if coat else 'jeans',lw)
        # Squared heel and toe, clearly distinct from lower leg, sole on z=0.
        outline=[(-.049,-.07),(.049,-.07),(.057,.04),(.053,.17),(.033,.195),(-.033,.195),(-.053,.17),(-.057,.04)]
        shoerings=[]
        for z,scale,dy in [(.006,1,0),(.035,1,0),(.085,.90,-.006),(.115,.65,-.034)]:
            shoerings.append([(ankle.x+x*scale, y*scale+dy,z) for x,y in outline])
        loft('shoe_'+side,shoerings,'shoes' if coat else 'sneakers',[{'foot'+side:1}]*4)
    if not coat:
        # Pelvis fills the joint between trousers, underneath hoodie waistband.
        loft('jeans_pelvis',[ring(.80,.150,.088),ring(.94,.149,.09)],'jeans',[{'spine':1}]*2)


def hood_up():
    n=12
    def contour(rx,rz,y,cz=1.635):
        pts=[]
        for i in range(n):
            a=math.tau*i/n
            x=rx*math.cos(a); z=cz+rz*math.sin(a)
            if i==3:z+=.012  # sewn crown, not a round helmet
            pts.append((x,y,z))
        return pts
    rings=[contour(.035,.08,-.133),contour(.108,.146,-.095),contour(.137,.171,.025),
           contour(.129,.166,.113),contour(.092,.125,.132)]
    loft('hood_shell',rings,'coat',[{'head':1}]*5,caps=False)
    mesh('hood_back',rings[0],[tuple(range(n))],'coat',[{'head':1}]*n)
    # Dark funnel, recessed by 8 cm: no eyeballs, face plane, or nose geometry.
    inner=[rings[-1],contour(.081,.112,.055),contour(.055,.087,.021)]
    loft('hood_inner_void',inner,'face_void',[{'head':1}]*3,caps=False)
    mesh('hood_void_back',inner[-1],[tuple(range(n))],'face_void',[{'head':1}]*n)


def player_head():
    # Faceted cranium, jaw and subtle nose; no painted eyes or cartoon features.
    sections=[(1.535,.045,.052,.044),(1.565,.071,.073,.033),(1.63,.091,.084,.023),
              (1.70,.089,.079,.01),(1.75,.067,.061,.004),(1.765,.035,.034,.004)]
    loft('head_skin',[ring(z,rx,ry,cy,10) for z,rx,ry,cy in sections],'player_skin',[{'head':1}]*6)
    mesh('nose', [(-.017,.099,1.645),(.017,.099,1.645),(0,.128,1.616),(-.018,.096,1.604),(.018,.096,1.604)],
         [(0,1,2),(0,2,3),(1,4,2),(2,4,3)],'player_skin',[{'head':1}]*5)
    for s in (-1,1):
        box('ear_'+str(s),(s*.091,.004,1.638),(.018,.035,.052),'player_skin',{'head':1},.007)
    # Angular hairline: lower at back/sides, higher at forehead, cropped top.
    bottom=[]
    for i in range(10):
        a=math.tau*i/10; front=math.sin(a)
        bottom.append((.094*math.cos(a),.012+.087*math.sin(a),1.66+max(0,front)*.045-max(0,-front)*.038))
    loft('cropped_hair',[bottom,ring(1.742,.085,.076,.004,10),ring(1.783,.049,.047,0,10)],'hair',[{'head':1}]*3)
    # Collapsed hood: open U resting between shoulder blades, not a second head.
    contour=[(-.115,-.044,1.444),(-.142,-.076,1.402),(-.128,-.12,1.323),(-.074,-.145,1.282),
             (0,-.152,1.267),(.074,-.145,1.282),(.128,-.12,1.323),(.142,-.076,1.402),(.115,-.044,1.444)]
    inner=[(x*.68,y+.025,z+.01) for x,y,z in contour]
    vertices=contour+inner
    faces=[(i,i+1,9+i+1,9+i) for i in range(8)]
    faces.append(tuple(range(9,18)))
    mesh('hood_down',vertices,faces,'hoodie',[{'spine':1}]*len(vertices))


def build(kind):
    reset()
    torso(kind); limbs(kind)
    hood_up() if kind=='stranger' else player_head()
    rig=make_rig(kind)
    for obj in list(bpy.context.scene.objects):
        if obj.type=='MESH': bind(obj,rig)
    return rig


def main():
    stats={}
    for kind in ('stranger','player'):
        build(kind); stats[kind]=export_asset(kind)
    print('CHARACTER_STATS',json.dumps(stats))
    return stats

if __name__=='__main__': main()
