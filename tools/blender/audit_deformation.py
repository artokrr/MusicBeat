"""Measure actual linear-skinned GLB elbow/knee rings through the test poses.

This guards against collapsed cross-sections; it is not a collision solver.
The pose renders remain the check for shoulder seams and cloth intersections.
"""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import json
import numpy as np
import bpy
from common import OUT, reset
from render_check import load, test_pose


def section(points,order=None):
    points=np.array(points,dtype=float)
    centered=points-points.mean(axis=0)
    _,singular,basis=np.linalg.svd(centered,full_matrices=False)
    if order is None:
        projected=centered @ basis[:2].T
        order=np.argsort(np.arctan2(projected[:,1],projected[:,0]))
    polygon=centered[order]
    area=np.linalg.norm(np.cross(polygon,np.roll(polygon,-1,axis=0)).sum(axis=0))*.5
    return area,singular[:2],order


report={'assets':{},'passed':True}
for kind in ('stranger','player'):
    reset();objects=load(kind)
    meshes=[obj for obj in objects if obj.type=='MESH']
    joints={}
    for joint,first,second in [('elbow','upperArm','foreArm'),('knee','thigh','shin')]:
        for side in ('L','R'):
            found=[]
            for obj in meshes:
                groups={g.index:g.name for g in obj.vertex_groups}
                seen=set();indices=[]
                for v in obj.data.vertices:
                    weights={groups[g.group]:g.weight for g in v.groups if g.weight>1e-5}
                    if set(weights)!={first+side,second+side}:continue
                    if any(abs(w-.5)>1e-5 for w in weights.values()):continue
                    key=tuple(round(float(x),6) for x in v.co)
                    if key not in seen:indices.append(v.index);seen.add(key)
                if indices:found.append((obj,indices))
            assert len(found)==1,(kind,joint,side,'ambiguous ring')
            obj,indices=found[0]
            assert len(indices)==8,(kind,joint,side,len(indices))
            points=[list(obj.matrix_world @ obj.data.vertices[i].co) for i in indices]
            area,diameters,order=section(points)
            joints[joint+side]=(obj,indices,area,diameters,order)
    poses={}
    for pose in ('rest','forehand','crouch'):
        test_pose(objects,pose)
        deps=bpy.context.evaluated_depsgraph_get()
        evaluations={obj.name:obj.evaluated_get(deps) for obj in meshes}
        assert all(np.isfinite([list(v.co) for v in obj.data.vertices]).all() for obj in evaluations.values())
        metrics={}
        for joint,(obj,indices,area,diameters,order) in joints.items():
            evaluated=evaluations[obj.name]
            points=[list(evaluated.matrix_world @ evaluated.data.vertices[i].co) for i in indices]
            posed_area,posed_diameters,_=section(points,order)
            ratio=float(posed_area/area)
            thickness=float(posed_diameters.min()/diameters.min())
            assert .65<ratio<1.06,(kind,pose,joint,'collapsed/expanded area',ratio)
            assert thickness>.65,(kind,pose,joint,'collapsed diameter',thickness)
            metrics[joint]={'areaRatio':ratio,'minimumDiameterRatio':thickness}
        poses[pose]=metrics
    report['assets'][kind]=poses
report['minAreaRatio']=min(m['areaRatio'] for poses in report['assets'].values() for joints in poses.values() for m in joints.values())
report['minDiameterRatio']=min(m['minimumDiameterRatio'] for poses in report['assets'].values() for joints in poses.values() for m in joints.values())
(OUT/'deformation-report.json').write_text(json.dumps(report,indent=2)+'\n')
print('DEFORMATION',json.dumps(report))
