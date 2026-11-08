import { PREMIUM_LOOK } from '../scene/look';
import { GLSL3, MeshDepthMaterial, RGBADepthPacking, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
// The CPU palette is authored in display RGB. Write it directly, with no
// tone mapping or linear-to-sRGB conversion after quantization.
export const pixelNoise = /* glsl */ `
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise21(vec2 p) {
 vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
 return mix(mix(hash21(i),hash21(i+vec2(1,0)),f.x),mix(hash21(i+vec2(0,1)),hash21(i+vec2(1)),f.x),f.y);
}
float bayer(vec2 p) {
 ivec2 q=ivec2(p)&3;
 const float m[16]=float[16](0.,8.,2.,10.,12.,4.,14.,6.,3.,11.,1.,9.,15.,7.,13.,5.);
 return (m[q.y*4+q.x]+0.5)/16.;
}
`;
export const capsuleDeform = /* glsl */ `
#ifdef CAPSULE
 float end = step(0.0, position.y);
 float radius = mix(capsule.x, capsule.y, end);
 transformed = vec3(position.x*radius, (end-0.5)*capsule.z + (position.y-(end-0.5))*radius, position.z*radius);
#endif
`;
const vertex = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
#include <shadowmap_pars_vertex>
attribute vec3 baseColor;
attribute vec4 surface;
attribute float coverage;
#ifdef CAPSULE
attribute vec3 capsule;
#endif
varying vec3 vBase;
varying vec4 vSurface;
varying float vCoverage;
varying vec3 vWorld;
varying vec3 vNormalWorld;
void main() {
 #include <beginnormal_vertex>
 #include <skinbase_vertex>
 #include <skinnormal_vertex>
 #include <defaultnormal_vertex>
 #include <begin_vertex>
 ${capsuleDeform}
 #include <skinning_vertex>
 #include <project_vertex>
 // Always needed, even when WebGL shadow maps have been disabled.
 vec4 worldPosition=vec4(transformed,1.0);
 #ifdef USE_INSTANCING
 worldPosition=instanceMatrix*worldPosition;
 #endif
 worldPosition=modelMatrix*worldPosition;
 vWorld=worldPosition.xyz;
 vNormalWorld=inverseTransformDirection(transformedNormal,viewMatrix);
 vBase=baseColor;
 vSurface=surface;
 vCoverage=coverage;
 // The software renderer stamps shadows in screen space, onto whichever
 // receiver is visible there. Project table receivers back onto that ground
 // ray before looking up the real light-space maps to preserve this look.
 #ifndef PREMIUM_LOOK
 if((surface.x==6. || surface.x==9.) && vNormalWorld.z>.9) {
  worldPosition.xyz+=vec3(.145364,.717104,-.681639)*(worldPosition.z/.681639);
 }
 #endif
 #include <shadowmap_vertex>
}
`;
const fragment = /* glsl */ `
#include <common>
#include <packing>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
layout(location=0) out vec4 outColor;
layout(location=1) out vec4 outSurface;
varying vec3 vBase;
varying vec4 vSurface;
varying float vCoverage;
varying vec3 vWorld;
varying vec3 vNormalWorld;
uniform sampler2D windowPattern;
uniform sampler2D snowPattern;
uniform sampler2D footprints;
uniform vec4 contactBalls[64];
uniform int contactCount;
uniform float lampLevel;
uniform float openingWall;
uniform vec4 groundContacts[20];
${pixelNoise}
// Blocker/receiver distance controls the filter, never a screen blur.
float visibility(sampler2D map, vec4 coord, float bias, bool spot) {
 vec3 sc=coord.xyz/coord.w; sc.z+=bias;
 if(any(lessThan(sc,vec3(0))) || any(greaterThan(sc,vec3(1)))) return 1.;
 float blocker=unpackRGBAToDepth(texture2D(map,sc.xy));
 float gap=spot ? max(0.,(.08*20./(20.-sc.z*19.92))-(.08*20./(20.-blocker*19.92))) : max(0.,sc.z-blocker)*29.9;
 float radius=clamp(gap*(spot?2.5:3.),.45,7.);
 float sum=texture2DCompare(map,sc.xy,sc.z);
 for(int y=-1;y<=1;y+=2) for(int x=-1;x<=1;x+=2)
  sum+=texture2DCompare(map,sc.xy+vec2(float(x),float(y))*radius/1024.,sc.z);
 return sum/5.;
}
void main() {
 vec2 pixel=vec2(floor(gl_FragCoord.x),215.-floor(gl_FragCoord.y));
 float dither=bayer(pixel);
 if(dither>=vCoverage) discard;
 float kind=vSurface.x;
 vec3 p=vWorld, n=normalize(vNormalWorld), base=vBase;
 bool receiver=kind==4. || ((kind==6. || kind==9.) && n.z>0.9) || vSurface.w==3.;
 bool emissive=kind==3. || kind==8.;
 if(kind==5.) {
  if(n.y<-.9) {
   float col=floor((p.x+12.)/1.6), row=floor(p.z/2.4);
   float lx=mod(p.x+12.,1.6)/1.6, lz=mod(p.z,2.4)/2.4;
   if(p.z<.4) base=vec3(70,70,80)/255.;
   else if(lx>.28 && lx<.72 && lz>.35 && lz<.75) {
    base=texture2D(windowPattern,vec2((col+.5)/15.,(row+.5)/4.)).rgb; emissive=true;
   } else if(col==7. && p.z<2.2 && lx>.2 && lx<.8) { base=vec3(24,22,26)/255.; emissive=true; }
  }
 }
 if(kind==6.) {
  if(n.z<.9) base=vec3(30,60,58)/255.;
  else if(abs(abs(p.x)-.7625)<.025 || abs(abs(p.y)-1.37)<.025 || abs(p.x)<.01) base=vec3(214,218,226)/255.;
 }
 if(kind==7.) {
  if(p.z>.865) base=vec3(220,222,230)/255.;
  else if(abs(abs(p.x)-.7925)<.02) base=vec3(58,60,70)/255.;
  else { if(mod(floor(p.x*60.)+floor(p.z*60.),2.)!=0.) discard; base=vec3(40,42,52)/255.; }
 }
 vec3 lv=vec3(1.95,.35,3.25)-p;
 float dist=length(lv);
 float warm=max(0.,dot(n,lv/dist))*3.2*lampLevel*pow(max(0.,lv.z/dist),6.)/(1.+pow(dist/2.2,2.));
 float unblockedWarm=warm*1.05;
 float moonVisibility=1., lampVisibility=1.;
 #ifdef PREMIUM_LOOK
 #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
 moonVisibility=visibility(directionalShadowMap[0],vDirectionalShadowCoord[0],directionalLightShadows[0].shadowBias,false);
 #endif
 #if defined(USE_SHADOWMAP) && NUM_SPOT_LIGHT_SHADOWS > 0
 lampVisibility=visibility(spotShadowMap[0],vSpotLightCoord[0],spotLightShadows[0].shadowBias,true);
 #endif
 // Solid core and three visibility bands, Bayer only at the transitions.
 moonVisibility=floor(moonVisibility*3.+dither)/3.;
 lampVisibility=floor(lampVisibility*3.+dither)/3.;
 warm*=lampVisibility*1.05;
 // Keep the black hood closure out of direct sodium tint as well as bounce.
 if(max(base.r,max(base.g,base.b))<=.09) warm=0.;
 #endif
 float light=.34+max(0.,dot(n,normalize(vec3(-.45,.55,.7))))*.42*moonVisibility+warm;
 #ifdef PREMIUM_LOOK
 float pool=exp(-dot(p.xy-vec2(1.95,.35),p.xy-vec2(1.95,.35))*.32);
 float bounce=.065*pool*max(0.,1.-p.z/1.5)*(1.-max(0.,n.z))*lampLevel;
 // Never add bounce to the stranger's black hood closure.
 if(max(base.r,max(base.g,base.b))>.09) { light+=bounce; warm+=bounce; }
 #endif
 warm=clamp(warm,0.,1.);
 if(kind==1.) light+=(hash21(pixel)-.5)*.4;
 if(vSurface.y>0.) {
  float grain=(noise21(vec2(p.x*vSurface.y+p.z*3.,p.y*vSurface.y+p.z*9.))-.5)*.35;
  // Close-up wall grain must follow the wall plane, not its fixed Y coordinate.
  // Keep the historical expression untouched in gameplay, including look=old.
  if((kind==12. || kind==5.) && openingWall>0.)
   grain=mix(grain,(noise21(p.xz*2.)-.5)*.08,openingWall);
  light+=grain;
 }
 vec3 color;
 #ifdef PREMIUM_LOOK
 vec3 snowLit=vec3(0.);
 #endif
 if(kind==4.) {
  vec3 snow=texture2D(snowPattern,(pixel+.5)/vec2(384.,216.)).rgb*255.;
  float k=clamp(light/.75,.35,1.6);
  color=mix(snow*k,vec3(255,196,140)*k*.9,min(.5,warm*.7))/255.;
  #ifdef PREMIUM_LOOK
  // Sum independently occluded light, then roll off the pool highlights.
  float moon=max(0.,dot(n,normalize(vec3(-.45,.55,.7))))*.40;
  float sky=.19+moon*moonVisibility;
  // Preserve drift texture through the shoulder; ground the far building edge.
  snow=mix(vec3(176,182,202),snow,1.2);
  float edge=1.-smoothstep(2.8,4.6,p.y)*.18;
  vec3 lit=snow/255.*(.19+moon)*edge/.75 + vec3(.85,.68,.43)*min(1.,unblockedWarm);
  color=snow/255.*sky*edge/.75 + vec3(.85,.68,.43)*warm;
  color=color/(1.+max(vec3(0.),color-.65)*.65);
  lit=lit/(1.+max(vec3(0.),lit-.65)*.65);
  snowLit=lit;
  #endif
 } else {
  int tone=int(clamp(floor(light*4.2+.3+(dither-.5)*vSurface.z),0.,4.));
  const float tones[5]=float[5](.32,.52,.74,.95,1.15);
  const float cool[5]=float[5](.45,.3,.15,.05,0.);
  float m=tones[tone];
  color=mix(base*m,vec3(18,20,40)/255.,cool[tone]);
  if(warm>.12+(dither-.5)*.15) color=mix(color,vec3(255,190,116)/255.*m,min(.45,warm*.7));
  if(kind==2. && light>.85) color=vec3(252,250,244)/255.;
  if(emissive) color=base;
  if(kind==8.) color=base*lampLevel;
  if(kind==11.) color=base*.92;
 }
 // The original casts only on snow/table, then tints the already quantized
 // colour. Keep that rule, but derive occlusion from real shadow maps.
 #ifndef PREMIUM_LOOK
 if(receiver && kind!=3.) {
  float moon=1., lamp=1.;
  #if defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
  DirectionalLightShadow ds=directionalLightShadows[0];
  moon=getShadow(directionalShadowMap[0],ds.shadowMapSize,1.,ds.shadowBias,ds.shadowRadius,vDirectionalShadowCoord[0]);
  #endif
  #if defined(USE_SHADOWMAP) && NUM_SPOT_LIGHT_SHADOWS > 0
  vec3 sc=vSpotLightCoord[0].xyz/vSpotLightCoord[0].w;
  sc.z+=spotLightShadows[0].shadowBias;
  if(all(greaterThanEqual(sc,vec3(0))) && all(lessThanEqual(sc,vec3(1)))) lamp=texture2DCompare(spotShadowMap[0],sc.xy,sc.z);
  #endif
  if(lamp<.5) color*=vec3(.64,.65,.76);
  else if(moon<1.-dither*.65) color*=dither>.5?vec3(.8,.8,.87):vec3(.64,.65,.76);
 }
 #endif
 if(kind==4. && abs(p.x)<3. && abs(p.y)<4.) {
  float wear=texture2D(footprints,(p.xy+vec2(3.,4.))/vec2(6.,8.)).r;
  // Three trample levels, with Bayer transitions rather than blended decals.
  float stepWear=floor(wear*3.+dither)/3.;
  color*=mix(vec3(1.),vec3(.68,.70,.78),stepWear);
  #ifdef PREMIUM_LOOK
  snowLit*=mix(vec3(1.),vec3(.68,.70,.78),stepWear);
  #endif
 }
 #ifdef PREMIUM_LOOK
 if(kind==4.) {
  float ao=0.;
  for(int i=0;i<20;i++) {
   vec4 c=groundContacts[i];
   vec2 q=(p.xy-c.xy)/max(c.zw,vec2(.001));
   ao=max(ao,1.-smoothstep(.2,1.,dot(q,q)));
  }
  color*=1.-floor(ao*3.+dither)/3.*.28;
  snowLit*=1.-floor(ao*3.+dither)/3.*.28;
  // Fixed world cells; no animation clock in the ice glints.
  if(warm>.3 && hash21(floor(p.xy*48.))>.996 && dither<.35) {
   color+=vec3(.16,.14,.09)*lampVisibility;
   snowLit+=vec3(.16,.14,.09)*lampVisibility;
  }
 }
 if((kind==6. || kind==9.) && n.z>.9) {
  vec3 h=normalize(normalize(lv)+normalize(vec3(-.145364,-.717104,.681639)));
  float sheen=pow(max(0.,dot(n,h)),28.)*.10*lampVisibility;
  color+=vec3(1.,.85,.65)*floor(sheen*32.+dither)/32.;
 }
 if(!emissive && kind!=2. && max(base.r,max(base.g,base.b))>.09)
  color=mix(color,color*vec3(.97,.99,1.035),.35);
 snowLit=mix(snowLit,snowLit*vec3(.97,.99,1.035),.35);
 snowLit=clamp(snowLit,0.,1.);
 #endif
 // CPU clamps to its byte buffer before haze, including the bright lamp pool.
 color=clamp(color,0.,1.);
 if(vSurface.w==1. || vSurface.w==2.) {
  vec3 f=vec3(.145364,.717104,-.681639);
  float depth=-dot(p-vec3(.1,.1,.6),f);
  float nearDepth=-dot(vec3(0,-3,0)-vec3(.1,.1,.6),f);
  float farDepth=-dot(vec3(0,4.6,0)-vec3(.1,.1,.6),f);
  float t=clamp((nearDepth-depth)/(nearDepth-farDepth),0.,1.);
  color=mix(color,vec3(34,38,58)/255.,t*t*.55);
  #ifdef PREMIUM_LOOK
  snowLit=mix(snowLit,vec3(34,38,58)/255.,t*t*.55);
  #endif
 }
 #ifdef PREMIUM_LOOK
 // Constrain after wear, contact and haze: otherwise fog can re-saturate a
 // dark shadow. Preserve energy from independent visibility, not a tinted stamp.
 if(kind==4. && min(moonVisibility,lampVisibility)<.99) {
  float Y=dot(color,vec3(.2126,.7152,.0722));
  float litY=max(.001,dot(snowLit,vec3(.2126,.7152,.0722)));
  color=mix(vec3(Y),snowLit*(Y/litY),.55);
 }
 #endif
 // Keep the ball's small contact cue directly below it, independently of
 // the two physical light directions (same rule as CPU dropShadow).
 if(receiver) for(int i=0;i<64;i++) {
  if(i>=contactCount) break;
  vec2 delta=p.xy-contactBalls[i].xy;
  #ifdef PREMIUM_LOOK
  float height=contactBalls[i].w;
  float radius=mix(.038,.052,clamp(height/.8,0.,1.));
  float fade=1.-smoothstep(.45,1.8,height);
  float edge=1.-smoothstep(.3,1.,dot(delta,delta)/(radius*radius));
  if(abs(p.z-contactBalls[i].z)<.01 && edge*fade>.01) {
   float Y=dot(color,vec3(.2126,.7152,.0722));
   color=vec3(.985,.995,1.)*Y*(1.-.30*edge*fade);
   break;
  }
  #else
  if(abs(p.z-contactBalls[i].z)<.01 && dot(delta,delta)<.0049) { color*=vec3(.64,.65,.76);break; }
  #endif
 }
 outColor=vec4(color,1.);
 outSurface=vec4(n*.5+.5,(receiver || kind==10. || kind==11.)?1.:0.);
 #ifdef PREMIUM_LOOK
 if(emissive && base.r>.6 && base.r>base.b*1.3) outSurface.a=.6;
 #endif
}
`;
/** Shared by every pixel material, including asynchronously loaded skins. */
export const groundContactUniform = { value: new Float32Array(20 * 4) };
export const openingWallUniform = { value: 0 };
export const lampUniform = { value: 1 };
export function pixelMaterial(capsules = false) {
  return new ShaderMaterial({
    glslVersion: GLSL3, lights: true,
    uniforms: { ...UniformsUtils.merge([UniformsLib.lights]), windowPattern: { value: null }, snowPattern: { value: null }, footprints: { value: null }, contactBalls: { value: new Float32Array(64 * 4) }, contactCount: { value: 0 }, lampLevel: lampUniform, openingWall: openingWallUniform, groundContacts: groundContactUniform },
    defines: { ...(capsules ? { CAPSULE: 1 } : {}), ...(PREMIUM_LOOK ? { PREMIUM_LOOK: 1 } : {}) }, vertexShader: vertex, fragmentShader: fragment,
  });
}
/** Shadow silhouettes use exactly the same capsule deformation as colour. */
export function capsuleDepthMaterial() {
  const material = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  material.onBeforeCompile = shader => {
    shader.vertexShader = '#define CAPSULE\nattribute vec3 capsule;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n' + capsuleDeform);
  };
  material.customProgramCacheKey = () => 'pixel-capsule-depth-v1';
  return material;
}
