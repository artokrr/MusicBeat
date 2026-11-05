import { GLSL3, MeshDepthMaterial, RGBADepthPacking, ShaderMaterial, UniformsLib, UniformsUtils } from 'three';
// The CPU palette is authored in display RGB. Write it directly, with no
// tone mapping or linear-to-sRGB conversion after quantization.
const common = /* glsl */ `
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
 if(surface.x==6. && vNormalWorld.z>.9) {
  worldPosition.xyz+=vec3(.145364,.717104,-.681639)*(worldPosition.z/.681639);
 }
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
uniform vec4 contactBalls[64];
uniform int contactCount;
${common}
void main() {
 vec2 pixel=vec2(floor(gl_FragCoord.x),215.-floor(gl_FragCoord.y));
 float dither=bayer(pixel);
 if(dither>=vCoverage) discard;
 float kind=vSurface.x;
 vec3 p=vWorld, n=normalize(vNormalWorld), base=vBase;
 bool receiver=kind==4. || (kind==6. && n.z>0.9) || vSurface.w==3.;
 bool emissive=kind==3.;
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
 float warm=max(0.,dot(n,lv/dist))*3.2*pow(max(0.,lv.z/dist),6.)/(1.+pow(dist/2.2,2.));
 float light=.34+max(0.,dot(n,normalize(vec3(-.45,.55,.7))))*.42+warm;
 warm=clamp(warm,0.,1.);
 if(kind==1.) light+=(hash21(pixel)-.5)*.4;
 if(vSurface.y>0.) light+=(noise21(vec2(p.x*vSurface.y+p.z*3.,p.y*vSurface.y+p.z*9.))-.5)*.35;
 vec3 color;
 if(kind==4.) {
  vec3 snow=texture2D(snowPattern,(pixel+.5)/vec2(384.,216.)).rgb*255.;
  float k=clamp(light/.75,.35,1.6);
  color=mix(snow*k,vec3(255,196,140)*k*.9,min(.5,warm*.7))/255.;
 } else {
  int tone=int(clamp(floor(light*4.2+.3+(dither-.5)*vSurface.z),0.,4.));
  const float tones[5]=float[5](.32,.52,.74,.95,1.15);
  const float cool[5]=float[5](.45,.3,.15,.05,0.);
  float m=tones[tone];
  color=mix(base*m,vec3(18,20,40)/255.,cool[tone]);
  if(warm>.12+(dither-.5)*.15) color=mix(color,vec3(255,190,116)/255.*m,min(.45,warm*.7));
  if(kind==2. && light>.85) color=vec3(252,250,244)/255.;
  if(emissive) color=base;
 }
 // The original casts only on snow/table, then tints the already quantized
 // colour. Keep that rule, but derive occlusion from real shadow maps.
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
 // CPU clamps to its byte buffer before haze, including the bright lamp pool.
 color=clamp(color,0.,1.);
 if(vSurface.w==1. || vSurface.w==2.) {
  vec3 f=vec3(.145364,.717104,-.681639);
  float depth=-dot(p-vec3(.1,.1,.6),f);
  float nearDepth=-dot(vec3(0,-3,0)-vec3(.1,.1,.6),f);
  float farDepth=-dot(vec3(0,4.6,0)-vec3(.1,.1,.6),f);
  float t=clamp((nearDepth-depth)/(nearDepth-farDepth),0.,1.);
  color=mix(color,vec3(34,38,58)/255.,t*t*.55);
 }
 // Keep the ball's small contact cue directly below it, independently of
 // the two physical light directions (same rule as CPU dropShadow).
 if(receiver) for(int i=0;i<64;i++) {
  if(i>=contactCount) break;
  vec2 delta=p.xy-contactBalls[i].xy;
  if(abs(p.z-contactBalls[i].z)<.01 && dot(delta,delta)<.0049) { color*=vec3(.64,.65,.76);break; }
 }
 outColor=vec4(color,1.);
 outSurface=vec4(n*.5+.5,receiver?1.:0.);
}
`;
export function pixelMaterial(capsules = false) {
  return new ShaderMaterial({
    glslVersion: GLSL3, lights: true,
    uniforms: { ...UniformsUtils.merge([UniformsLib.lights]), windowPattern: { value: null }, snowPattern: { value: null }, contactBalls: { value: new Float32Array(64 * 4) }, contactCount: { value: 0 } },
    defines: capsules ? { CAPSULE: 1 } : {}, vertexShader: vertex, fragmentShader: fragment,
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
