"""Render the exported GLBs, not alternate source meshes. Blender 5.2/Cycles CPU, 24 samples."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import math
import argparse
import bpy
from mathutils import Vector
from common import *


def load(name,location=(0,0,0),yaw=0):
    before=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(MODELS/(name+'.glb')))
    objects=list(set(bpy.context.scene.objects)-before)
    roots=[o for o in objects if o.parent not in objects]
    # Blender importer converts glTF back to our Z-up modelling coordinates.
    for root in roots:
        root.rotation_euler.z+=yaw;root.location+=Vector(location)
    return objects


def test_pose(objects,name):
    rig=next(o for o in objects if o.type=='ARMATURE')
    for b in rig.pose.bones:
        b.rotation_mode='XYZ';b.rotation_euler=(0,0,0);b.location=(0,0,0)
    def rotate(b,x=0,y=0,z=0):rig.pose.bones[b].rotation_euler=tuple(math.radians(v) for v in (x,y,z))
    if name=='forehand':
        rotate('spine',10,-24,0)
        rotate('upperArmR',36,0,-62);rotate('foreArmR',78,0,-8)
        rotate('handR',0,0,8)
        rotate('upperArmL',28,0,16);rotate('foreArmL',67)
        rotate('thighR',20,0,-10);rotate('shinR',-25)
        rotate('thighL',-9,0,9);rotate('shinL',-8)
        rig.location.z-=.015
    elif name=='crouch':
        rotate('spine',20)
        for s,sgn in [('L',1),('R',-1)]:
            rotate('thigh'+s,48,0,sgn*9);rotate('shin'+s,-83);rotate('foot'+s,35)
            rotate('upperArm'+s,24,0,sgn*10);rotate('foreArm'+s,72)
        rig.location.z-=.21
    elif name!='rest':raise ValueError(name)
    bpy.context.view_layer.update()
    # Present test poses with the lowest deformed sole at ground level.
    # This changes only verification placement, never exported rest transforms.
    deps=bpy.context.evaluated_depsgraph_get()
    min_z=min((o.matrix_world @ v.co).z for o in objects if o.type=='MESH'
              and any(m.type=='ARMATURE' for m in o.modifiers)
              for v in o.evaluated_get(deps).data.vertices)
    rig.location.z+=.006-min_z
    bpy.context.view_layer.update()


def settings():
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.samples=24
    scene.cycles.use_denoising=True
    scene.render.resolution_x=384;scene.render.resolution_y=216;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.film_transparent=False
    scene.view_settings.view_transform='Standard'
    scene.view_settings.look='None';scene.view_settings.exposure=0;scene.view_settings.gamma=1
    scene.world.color=(.18,.18,.18)
    scene.world.use_nodes=True
    bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.40,.47,.65,1);bg.inputs[1].default_value=.5


def light(name,kind,location,color,energy,size=5):
    data=bpy.data.lights.new(name,kind);data.energy=energy;data.color=color
    if kind=='AREA':data.shape='DISK';data.size=size
    elif kind=='POINT':data.shadow_soft_size=.16
    obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=location
    if kind in ('AREA','SUN'):obj.rotation_euler=(Vector((0,0,1))-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj


def camera(location,target,width,shift=0):
    data=bpy.data.cameras.new('verification_camera');obj=bpy.data.objects.new('verification_camera',data)
    bpy.context.collection.objects.link(obj);obj.location=location
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    data.type='ORTHO';data.ortho_scale=width;data.shift_y=shift
    bpy.context.scene.camera=obj


def render(path):
    bpy.context.scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)


def character_checks(kind,poses):
    for pose in poses:
        for view,loc in [('front',(0,6,1.05)),('side',(6,0,1.05)),('back',(0,-6,1.05))]:
            reset();settings();objs=load(kind);test_pose(objs,pose)
            box('studio_floor',(0,0,-.035),(200,200,.05),'snow')
            light('soft_key','AREA',(-3,4,5),(1,.86,.74),650,4)
            light('cool_rim','AREA',(2,-3,4),(.57,.68,1),450,3)
            camera(loc,(0,0,.92),3.95)
            render(OUT/f'{kind}_{pose}_{view}.png')


def courtyard():
    reset();settings()
    bg=bpy.context.scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.3,.36,.55,1);bg.inputs[1].default_value=.45
    box('snow_ground',(0,0,-.055),(50,50,.1),'snow')
    load('table');load('bench',(-3,.6,0));load('lamppost',(2.25,.35,0))
    load('tree_bare_a',(-3.4,3.6,0));load('tree_bare_b',(3.9,3.9,0));load('building_facade',(0,4.6,0))
    p=load('player',(0,-2.05,0));test_pose(p,'forehand')
    p=load('stranger',(0,2.13,0),math.pi);test_pose(p,'crouch')
    light('sodium','POINT',(1.95,.35,3.25),(1,.66,.34),170)
    light('moon','SUN',(-4.5,5.5,7),(.67,.72,1),1.4)
    yaw=.2;pitch=.75
    f=Vector((math.sin(yaw)*math.cos(pitch),math.cos(yaw)*math.cos(pitch),-math.sin(pitch)))
    target=Vector((.1,.1,.6))
    # ortho_scale is horizontal span. shift_y is measured in horizontal span.
    camera(target-f*16,target,384/44,6/384)
    render(OUT/'courtyard.png')


def prop_checks():
    specs=[('paddle',(0,.8,.4),(0,0,.09),.55),('table',(4,-5,3),(0,0,.5),4.2),
           ('bench',(3,-4,2),(0,0,.45),2.7),('lamppost',(4,-6,4),(0,0,1.7),6.3),
           ('tree_bare_a',(6,-8,5),(0,0,2.3),9.4),('tree_bare_b',(6,-8,5),(0,0,2.2),9.1),
           ('building_facade',(13,-32,15),(0,0,5.8),29)]
    for name,loc,target,width in specs:
        reset();settings();load(name)
        box('studio_floor',(0,0,-.06),(100,100,.1),'snow')
        light('prop_key','AREA',(-3,-4,8),(1,.88,.75),1500,6)
        light('prop_fill','SUN',(4,-6,8),(.65,.75,1),1)
        camera(loc,target,width);render(OUT/(name+'.png'))

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--quick',action='store_true')
    parser.add_argument('--courtyard-only',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    OUT.mkdir(exist_ok=True,parents=True)
    if not args.courtyard_only:
        for kind in ('stranger','player'):character_checks(kind,['rest'] if args.quick else ['rest','forehand','crouch'])
        prop_checks()
    courtyard()
