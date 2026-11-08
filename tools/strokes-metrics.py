"""Native camera projection; resample real song-clock observations at 60 Hz.
Finite differences are screen-space diagnostics, not physics forces. All peaks
include mode transitions. Initial two seconds excluded; no smoothing filter.
"""
import json, sys, numpy as np
from pathlib import Path

def measure(file):
    data=json.loads(Path(file).read_text()); rows=data['rows']; t=np.array([r['t'] for r in rows]); keep=np.r_[True,np.diff(t)>0]; t=t[keep]; rows=[r for r,k in zip(rows,keep) if k]
    grid=np.arange(3,min(30,t[-1]),1/60); out={'frames':len(rows),'seconds':len(grid)/60,'renderMs':dict(zip(['median','p95'],np.percentile([r['cost'] for r in rows if r['t']>3],[50,95]))),'joints':{}}
    for name in ['pelvis','head','handR','handL','ankleL','ankleR','paddle']:
        p=np.array([r['pose']['paddle']['center'] if name=='paddle' else r['pose']['joints'][name] for r in rows]); p=np.array([np.interp(grid,t,p[:,i]) for i in range(3)]).T
        x,y,z=p.T; screen=np.array([44*(x*np.cos(.2)-y*np.sin(.2)), -44*(x*np.sin(.2)*np.sin(.75)+y*np.cos(.2)*np.sin(.75)+z*np.cos(.75))]).T
        v=np.diff(screen,axis=0)*60;a=np.diff(v,axis=0)*60;j=np.diff(a,axis=0)*60
        # Count meaningful horizontal reversals (ignore subpixel-speed noise).
        significant=v[:,0][abs(v[:,0])>2]; changes=np.count_nonzero(significant[1:]*significant[:-1]<0)
        out['joints'][name]={'peakPxS':float(np.linalg.norm(v,axis=1).max()),'peakPxS2':float(np.linalg.norm(a,axis=1).max()),'peakPxS3':float(np.linalg.norm(j,axis=1).max()),'jerkOver100k':int((np.linalg.norm(j,axis=1)>100000).sum()),'verticalCm':float(np.ptp(z)*100),'verticalPx':float(np.ptp(z)*44*np.cos(.75)), 'xReversalsPerSec':changes/(len(grid)/60)}
    return out
if __name__=='__main__':
    for file in sys.argv[1:]:
        result=measure(file); Path(file.replace('-motion.json','-metrics.json')).write_text(json.dumps(result,indent=2)); print(file,json.dumps(result,indent=2))
