import { groundContactUniform } from './material';
import type { SceneFrame, FigureView } from '../scene/types';
// World-space ellipses in metres; ground only, never overlaid on bodies.
const STATIC = [
 -.6,-1,.14,.14, .6,-1,.14,.14, -.6,1,.14,.14, .6,1,.14,.14,
 -3,-.2,.27,.22, -3,1.4,.27,.22,
 2.35,-1.85,.34,.19, 2.25,.35,.20,.20,
 .54,1.73,.12,.12, 1.02,1.73,.12,.12, .54,2.17,.12,.12, 1.02,2.17,.12,.12,
 -3.4,3.6,.35,.35, 3.9,3.9,.35,.35,
];
groundContactUniform.value.set(STATIC);
function feet(body: FigureView, offset: number) {
 const j=body.pose.joints, data=groundContactUniform.value;
 for(let side=0;side<2;side++) {
  const a=side===0?j.ankleL:j.ankleR, t=side===0?j.toeL:j.toeR;
  const i=offset+side*4;
  data[i]=(a[0]+t[0])*.5; data[i+1]=(a[1]+t[1])*.5;
  const contact=body.visible && a[2]<.14 && t[2]<.08;
  data[i+2]=contact?.13:0; data[i+3]=contact?.18:0;
 }
}
export function updateGroundContacts(frame: SceneFrame) {
 feet(frame.player,56); feet(frame.stranger,64);
}
