"""Shared, deterministic low-poly modelling primitives (Blender Python only)."""
from pathlib import Path
import json
import math
import re
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / 'client/public/models'
OUT = ROOT / 'tools/out'
PALETTE = {
    'coat': (40,40,48), 'trousers': (30,30,38), 'shoes': (26,26,30),
    'stranger_skin': (190,160,146), 'face_void': (14,14,20),
    'hoodie': (52,62,82), 'jeans': (36,38,46), 'sneakers': (190,190,196),
    'player_skin': (206,170,150), 'hair': (30,26,26),
    'rubber_red': (150,46,50), 'rubber_black': (22,23,28), 'wood': (96,78,66),
    'table_green': (42,88,84), 'court_line': (214,218,226), 'metal': (58,60,70),
    'net_mesh': (40,42,52), 'snow': (196,202,220), 'bark': (52,48,50),
    'wall': (104,106,118), 'panel_seam': (78,80,92), 'window_frame': (128,130,140),
    'window_lit': (214,172,116), 'window_dark': (30,32,44), 'door': (24,22,26),
    'emissive_bulb': (255,190,116),
}

def reset():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials):
        for block in list(collection):
            if block.users == 0: collection.remove(block)


def linear(c):
    c = c / 255
    return c / 12.92 if c <= .04045 else ((c+.055)/1.055)**2.4


def material(name):
    if name in bpy.data.materials: return bpy.data.materials[name]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*[linear(c) for c in PALETTE[name]], 1)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = mat.diffuse_color
    p.inputs['Roughness'].default_value = .88
    p.inputs['Metallic'].default_value = .15 if name == 'metal' else 0
    if name in ('emissive_bulb', 'window_lit'):
        p.inputs['Emission Color'].default_value = mat.diffuse_color
        p.inputs['Emission Strength'].default_value = 2 if name == 'emissive_bulb' else .55
    mat['base_color_srgb_255'] = list(PALETTE[name])
    return mat


def mesh(name, verts, faces, mat, weights=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(material(mat))
    # Consistent outward normals, including caps and the inside of the hood rim.
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    if weights:
        for i, row in enumerate(weights):
            total = sum(row.values())
            for bone, value in row.items():
                group = obj.vertex_groups.get(bone) or obj.vertex_groups.new(name=bone)
                group.add([i], value/total, 'REPLACE')
    return obj


def loft(name, rings, mat, ring_weights=None, caps=True):
    """rings: equally sized ordered 3D contours; optional weights per ring/vertex."""
    n = len(rings[0]); verts = [p for ring in rings for p in ring]
    faces = []
    for j in range(len(rings)-1):
        for i in range(n):
            faces.append((j*n+i, j*n+(i+1)%n, (j+1)*n+(i+1)%n, (j+1)*n+i))
    if caps:
        faces += [tuple(reversed(range(n))), tuple((len(rings)-1)*n+i for i in range(n))]
    weights = None
    if ring_weights:
        weights = []
        for row in ring_weights:
            weights.extend([row]*n if isinstance(row, dict) else row)
    return mesh(name, verts, faces, mat, weights)


def ring(z, rx, ry, cy=0, n=12):
    return [(rx*math.cos(2*math.pi*i/n), cy+ry*math.sin(2*math.pi*i/n), z) for i in range(n)]


def box(name, center, size, mat, weights=None, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=center)
    obj = bpy.context.object; obj.name = name
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(material(mat))
    if bevel:
        mod = obj.modifiers.new('One broad bevel', 'BEVEL'); mod.width=bevel; mod.segments=1
        mod.affect = 'EDGES'
        bpy.ops.object.modifier_apply(modifier=mod.name)
    # Bake coordinates so every character component shares armature origin.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if weights:
        for bone, weight in weights.items():
            group=obj.vertex_groups.new(name=bone)
            group.add(list(range(len(obj.data.vertices))), weight, 'REPLACE')
    obj.select_set(False)
    return obj


def tube(name, points, radii, mat, sides=8):
    rings=[]
    for j, p in enumerate(points):
        p=Vector(p)
        tangent=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(j-1,0)])
        tangent.normalize()
        ref=Vector((0,1,0)) if abs(tangent.y)<.9 else Vector((1,0,0))
        u=tangent.cross(ref).normalized(); v=tangent.cross(u).normalized()
        rings.append([p+radii[j]*(math.cos(i*2*math.pi/sides)*u+math.sin(i*2*math.pi/sides)*v) for i in range(sides)])
    return loft(name, rings, mat)


def contract():
    text=(ROOT/'client/src/game/rig/joints.ts').read_text()
    bones=[dict(name=a, **{'from':b,'to':c,'parent':None if d=='null' else d.strip("'")})
           for a,b,c,d in re.findall(r"name: '([^']+)', from: '([^']+)', to: '([^']+)', parent: (null|'[^']+')",text)]
    rest=text.split('export const REST_JOINTS')[1]
    joints={name:[float(x) for x in nums.split(',')] for name,nums in re.findall(r'(\w+): \[([^]]+)\]',rest)}
    assert len(bones)==17 and len(joints)==21, 'Unexpected rig contract; review generator'
    return bones,joints


def make_rig(name):
    bones,joints=contract()
    data=bpy.data.armatures.new(name+'_skeleton')
    rig=bpy.data.objects.new(name+'_rig',data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active=rig; rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for d in bones:
        bone=data.edit_bones.new(d['name'])
        bone.head=joints[d['from']]; bone.tail=joints[d['to']]
        if d['parent']: bone.parent=data.edit_bones[d['parent']]
        bone.use_connect=False
        # Blender local +Y is head->tail. Project world forward onto normal plane.
        direction=(bone.tail-bone.head).normalized()
        roll_ref=Vector((0,1,0))
        if abs(direction.dot(roll_ref))>.999: roll_ref=Vector((0,0,1))
        bone.align_roll(roll_ref)
    bpy.ops.object.mode_set(mode='OBJECT'); rig.select_set(False)
    for d in bones:
        b=data.bones[d['name']]
        b['from_joint']=d['from']; b['to_joint']=d['to']; b['rest_length_m']=b.length
        b['rest_head_zup']=list(b.head_local); b['rest_tail_zup']=list(b.tail_local)
    rig['coordinate_contract']='metres; Blender X,Y,Z = game X,Y,Z; forward +Y; glTF (x,z,-y)'
    rig['roll_convention']='local +Y=head to tail; local +Z=projected world +Y; +Z world fallback only if parallel'
    return rig


def bind(obj,rig):
    obj.parent=rig
    mod=obj.modifiers.new('Rig deformation','ARMATURE'); mod.object=rig
    mod.use_deform_preserve_volume=False  # Match glTF linear blend skinning.


def consolidate_materials(name):
    """One draw per material; retain facade window panes for runtime relighting."""
    groups={}
    for obj in list(bpy.context.scene.objects):
        if obj.type!='MESH': continue
        if name=='building_facade' and re.fullmatch(r'window_\d+_\d+',obj.name): continue
        key=tuple(m.name for m in obj.data.materials)
        groups.setdefault(key,[]).append(obj)
    for key,objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for obj in objects:obj.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        part_names=sorted(obj.name for obj in objects)
        if len(objects)>1:bpy.ops.object.join()
        obj=bpy.context.object
        obj.name=name+'_'+key[0]
        obj['source_parts']=part_names
        obj.select_set(False)


def export_asset(name, objects=None):
    MODELS.mkdir(parents=True,exist_ok=True)
    if objects is None:
        consolidate_materials(name)
        objects=list(bpy.context.scene.objects)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects: obj.select_set(True)
    tris=0
    for obj in objects:
        if obj.type=='MESH':
            obj.data.calc_loop_triangles(); tris+=len(obj.data.loop_triangles)
    limit=4000 if name in ('stranger','player') else 3000
    assert name=='building_facade' or tris<=limit,(name,tris)
    bpy.ops.export_scene.gltf(filepath=str(MODELS/(name+'.glb')), export_format='GLB',
        use_selection=True, export_yup=True, export_apply=False, export_animations=False,
        export_extras=True, export_skins=True, export_all_influences=False,
        export_def_bones=True, export_leaf_bone=False, export_materials='EXPORT')
    result={'triangles':tris,'materials':sorted({m.name for o in objects if o.type=='MESH' for m in o.data.materials}),
            'bytes':(MODELS/(name+'.glb')).stat().st_size}
    return result
