import { bayer } from './engine3d';
import { movingParts, RecorderBoxes } from '../scene/recorder';
import { project, VIEW_FORWARD, LIGHT } from '../scene/camera';
import type { Renderer3D, Vec3 } from './engine3d';
import type { RecorderState } from '../scene/recorder';

const FACES = [[0,2,3,1,2,-1],[4,5,7,6,2,1],[0,1,5,4,1,-1],[2,6,7,3,1,1],[0,4,6,2,0,-1],[1,3,7,5,0,1]];
const TONE = [.32,.52,.74,.95,1.15], COOL = [.45,.3,.15,.05,0];
const moonLength = Math.hypot(...LIGHT.moon);
/** Small depth-tested box rasterizer for the moving parts. Fixed scratch storage;
 * the CPU's existing five-tone palette and Bayer rule also apply to the tape. */
export class CPURecorder {
  readonly boxes = new RecorderBoxes();
  private readonly vertices = new Float64Array(24);
  private readonly point: Vec3 = [0,0,0];
  private readonly projected = {sx:0, sy:0, d:0};
  draw(R: Renderer3D, state: RecorderState) {
    this.boxes.update(state);
    const m = this.boxes.matrices, v = this.vertices;
    for (let i=0;i<movingParts.length;i++) {
      if (!this.boxes.visible[i]) continue;
      const at=i*16, color=movingParts[i].color;
      for (let k=0;k<8;k++) {
        const x=(k&1)?.5:-.5, y=(k&2)?.5:-.5, z=(k&4)?.5:-.5;
        for(let j=0;j<3;j++)this.point[j]=m[at+j]*x+m[at+4+j]*y+m[at+8+j]*z+m[at+12+j];
        project(this.point,this.projected);
        v[k*3]=this.projected.sx;v[k*3+1]=this.projected.sy;v[k*3+2]=this.projected.d;
      }
      for(let f=0;f<6;f++) {
        const face=FACES[f], axis=face[4]*4, sign=face[5];
        const len=Math.hypot(m[at+axis],m[at+axis+1],m[at+axis+2]);
        const nx=m[at+axis]/len*sign,ny=m[at+axis+1]/len*sign,nz=m[at+axis+2]/len*sign;
        if(nx*VIEW_FORWARD[0]+ny*VIEW_FORWARD[1]+nz*VIEW_FORWARD[2]>=0)continue;
        let light=LIGHT.ambient+Math.max(0,(nx*LIGHT.moon[0]+ny*LIGHT.moon[1]+nz*LIGHT.moon[2])/moonLength)*LIGHT.moonStrength;
        let warm=0;
        for(let l=0;l<LIGHT.lamps.length;l++) {
          const lamp=LIGHT.lamps[l], dx=lamp.pos[0]-m[at+12],dy=lamp.pos[1]-m[at+13],dz=lamp.pos[2]-m[at+14];
          const d=Math.hypot(dx,dy,dz);
          const level=Math.max(0,(nx*dx+ny*dy+nz*dz)/d)*lamp.strength*Math.max(0,dz/d)**6/(1+(d/lamp.radius)**2);
          light+=level;warm+=level;
        }
        warm=Math.min(1,warm);
        for(let tri=0;tri<2;tri++) {
          const a=face[0]*3,b=face[tri+1]*3,c=face[tri+2]*3;
          const ax=v[a],ay=v[a+1],bx=v[b],by=v[b+1],cx=v[c],cy=v[c+1];
          const den=(by-cy)*(ax-cx)+(cx-bx)*(ay-cy);
          if(Math.abs(den)<1e-8)continue;
          const minX=Math.max(0,Math.floor(Math.min(ax,bx,cx))),maxX=Math.min(383,Math.ceil(Math.max(ax,bx,cx)));
          const minY=Math.max(0,Math.floor(Math.min(ay,by,cy))),maxY=Math.min(215,Math.ceil(Math.max(ay,by,cy)));
          for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++) {
            const wa=((by-cy)*(x+.5-cx)+(cx-bx)*(y+.5-cy))/den;
            const wb=((cy-ay)*(x+.5-cx)+(ax-cx)*(y+.5-cy))/den,wc=1-wa-wb;
            if(wa<0||wb<0||wc<0)continue;
            const depth=wa*v[a+2]+wb*v[b+2]+wc*v[c+2],p=y*384+x;
            if(depth<=R.zb[p])continue;
            R.zb[p]=depth;R.recvZ[p]=-Infinity;
            const noise=bayer(x,y)-.5,tone=Math.max(0,Math.min(4,Math.floor(light*4.2+.3+noise*.25)));
            const scale=TONE[tone],cool=COOL[tone],w=warm>.12+noise*.15?Math.min(.45,warm*.7):0;
            for(let j=0;j<3;j++) {
              const value=color[j]*scale*(1-cool)+LIGHT.cool[j]*cool;
              R.pix[p*4+j]=value*(1-w)+LIGHT.warm[j]*scale*w;
            }
            R.pix[p*4+3]=255;
          }
        }
      }
    }
  }
}
