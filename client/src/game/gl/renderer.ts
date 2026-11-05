import { Color, DepthTexture, DirectionalLight, Mesh, NearestFilter, NoToneMapping, OrthographicCamera, PCFSoftShadowMap, PlaneGeometry, Scene, ShaderMaterial, SpotLight, UnsignedIntType, Vector3, WebGLRenderer, WebGLRenderTarget, } from 'three';
import { TABLE_HALF_L, TABLE_HALF_W, TABLE_Z } from '../pixel/courtyard';
import { LOW_H, LOW_W } from '../pixel/stage';
import { CAMERA, VIEW_FORWARD } from '../scene/camera';
import { buildCourtyard } from './geometry';
import { Figure, PrimitiveBatch } from './figures';
import { GPUTimer } from './timing';
import type { Vec3 } from '../rig/joints';
import type { SceneBackend, SceneFrame } from '../scene/types';
const near = .1, far = 40, distance = 20;
const PRESSED: Vec3 = [236, 150, 166], UNPRESSED: Vec3 = [178, 204, 198];
const outlineFragment = /* glsl */ `
 uniform sampler2D colorMap;
 uniform sampler2D surfaceMap;
 uniform sampler2D depthMap;
 varying vec2 vUv;
 float depth(vec2 uv) { return texture2D(depthMap,uv).r; }
 bool background(vec2 uv) { return depth(uv)>.99999 || texture2D(surfaceMap,uv).a>.5; }
 void main() {
  vec2 uv=vUv,px=vec2(1./384.,1./216.);
  vec3 color=texture2D(colorMap,uv).rgb;
  float d=depth(uv);
  vec4 surface=texture2D(surfaceMap,uv);
  if(d<.99999 && surface.a<.5 && all(greaterThan(uv,px)) && all(lessThan(uv,1.-px))) {
   if(background(uv+vec2(px.x,0)) || background(uv-vec2(px.x,0)) || background(uv+vec2(0,px.y)) || background(uv-vec2(0,px.y))) color*=vec3(.62,.62,.74);
   else {
    float jump=max(max(depth(uv+vec2(0,px.y)),depth(uv-vec2(px.x,0))),depth(uv+vec2(px.x,0)))-d;
    vec3 n=surface.rgb*2.-1.;
    vec3 up=texture2D(surfaceMap,uv+vec2(0,px.y)).rgb*2.-1.;
    // Depth breaks are the primary rule; normals suppress flat-plane
    // precision noise and catch creases only when there is a real step.
    if(jump*39.9>.35 || (jump*39.9>.2 && dot(n,up)<-.2)) color*=vec3(.82,.82,.9);
   }
  }
  gl_FragColor=vec4(color,1.);
 }
`;
export class GLBackend implements SceneBackend {
  readonly kind = 'gl' as const;
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  timing: GPUTimer;
  readonly camera: OrthographicCamera;
  private readonly target: WebGLRenderTarget;
  private readonly outputScene = new Scene();
  private readonly outputCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly yard = buildCourtyard();
  private readonly caps: PrimitiveBatch;
  private readonly spheres: PrimitiveBatch;
  readonly player: Figure;
  readonly stranger: Figure;
  private readonly point: Vec3 = [0, 0, 0];
  private lost = false;
  private readonly onLost = (event: Event) => { event.preventDefault(); this.lost = true; };
  private readonly onRestored = () => { this.timing = new GPUTimer(this.renderer.getContext() as WebGL2RenderingContext); this.lost = false; };
  constructor() {
    this.renderer = new WebGLRenderer({ antialias: false, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.timing = new GPUTimer(this.renderer.getContext() as WebGL2RenderingContext);
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(LOW_W, LOW_H, false);
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(new Color(12 / 255, 13 / 255, 22 / 255), 1);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.info.autoReset = false;
    this.renderer.domElement.addEventListener('webglcontextlost', this.onLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.onRestored);
    const halfW = LOW_W / 2 / CAMERA.scale, halfH = LOW_H / 2 / CAMERA.scale;
    const ox = (CAMERA.offsetX ?? 0) / CAMERA.scale, oy = (CAMERA.offsetY ?? 0) / CAMERA.scale;
    this.camera = new OrthographicCamera(-halfW - ox, halfW - ox, halfH + oy, -halfH + oy, near, far);
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(CAMERA.target[0] - VIEW_FORWARD[0] * distance, CAMERA.target[1] - VIEW_FORWARD[1] * distance, CAMERA.target[2] - VIEW_FORWARD[2] * distance);
    this.camera.lookAt(new Vector3(...CAMERA.target));
    const moon = new DirectionalLight(0xffffff, 1);
    moon.position.set(-.45 * 12, .55 * 12, .7 * 12);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1024, 1024);
    moon.shadow.camera.left = -8;
    moon.shadow.camera.right = 8;
    moon.shadow.camera.top = 8;
    moon.shadow.camera.bottom = -8;
    moon.shadow.camera.near = .1;
    moon.shadow.camera.far = 30;
    moon.shadow.bias = -.00015;
    moon.shadow.normalBias = .015;
    moon.shadow.radius = 1.5;
    const lamp = new SpotLight(0xffffff, 1, 20, Math.PI * .43, 0, 0);
    lamp.position.set(1.95, .35, 3.25);
    lamp.target.position.set(1.95, .35, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.camera.near = .08;
    lamp.shadow.camera.far = 20;
    lamp.shadow.bias = -.0001;
    lamp.shadow.normalBias = .008;
    this.scene.add(this.yard, moon, moon.target, lamp, lamp.target);
    this.caps = new PrimitiveBatch(this.scene, true, 128);
    this.spheres = new PrimitiveBatch(this.scene, false, 2048);
    const procedural = new URLSearchParams(location.search).get('rig') === 'procedural';
    this.player = new Figure(this.scene, 'player', procedural);
    this.stranger = new Figure(this.scene, 'stranger', procedural);
    this.target = new WebGLRenderTarget(LOW_W, LOW_H, { count: 2, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: true });
    this.target.depthTexture = new DepthTexture(LOW_W, LOW_H, UnsignedIntType);
    const material = new ShaderMaterial({
      uniforms: { colorMap: { value: this.target.textures[0] }, surfaceMap: { value: this.target.textures[1] }, depthMap: { value: this.target.depthTexture } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: outlineFragment, depthTest: false, depthWrite: false,
    });
    this.outputScene.add(new Mesh(new PlaneGeometry(2, 2), material));
  }
  get available() { return !this.lost && !this.renderer.getContext().isContextLost(); }
  render(frame: SceneFrame) {
    this.caps.begin();
    this.spheres.begin();
    this.stranger.update(frame.stranger.pose, frame.stranger.look, frame.stranger.visible, this.caps, this.spheres);
    this.player.update(frame.player.pose, frame.player.look, frame.player.visible, this.caps, this.spheres);
    for (let i = 0; i < frame.laneCount; i++) {
      const lane = frame.lanes[i], color = lane.pressed ? PRESSED : UNPRESSED;
      for (let k = 0; k < 40; k++) {
        const a = k * Math.PI / 20;
        this.point[0] = lane.x + Math.cos(a) * .13;
        this.point[1] = -TABLE_HALF_L + .16 + Math.sin(a) * .09;
        this.point[2] = TABLE_Z + .002;
        this.spheres.sphere(this.point, .6 / CAMERA.scale, color, 3);
      }
      if (lane.pressed)
        for (let k = 0; k < 20; k++) {
          const a = k * Math.PI / 10;
          this.point[0] = lane.x + Math.cos(a) * .07;
          this.point[1] = -TABLE_HALF_L + .16 + Math.sin(a) * .045;
          this.spheres.sphere(this.point, .03, color, 3);
        }
    }
    const groundMaterial = (this.yard.children[0] as Mesh).material as ShaderMaterial;
    const contacts = groundMaterial.uniforms.contactBalls.value as Float32Array;
    groundMaterial.uniforms.contactCount.value = Math.min(frame.ballCount, 64);
    for (let i = 0; i < frame.ballCount; i++) {
      const b = frame.balls[i];
      this.spheres.sphere(b.pos, .055, b.color, 2, b.alpha);
      if (i < 64) {
        contacts[i * 4] = b.pos[0];
        contacts[i * 4 + 1] = b.pos[1];
        contacts[i * 4 + 2] = Math.abs(b.pos[0]) <= TABLE_HALF_W && Math.abs(b.pos[1]) <= TABLE_HALF_L && b.pos[2] >= TABLE_Z ? TABLE_Z : 0;
      }
    }
    this.caps.flush();
    this.spheres.flush();
    this.renderer.info.reset();
    this.timing.begin();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.outputScene, this.outputCamera);
    this.timing.end();
    return this.renderer.domElement;
  }
  dispose() {
    this.player.dispose();
    this.stranger.dispose();
    this.caps.dispose();
    this.spheres.dispose();
    this.yard.traverse(o => { if (o instanceof Mesh) {
      o.geometry.dispose();
      o.customDepthMaterial?.dispose();
      const m = o.material as ShaderMaterial;
      m.uniforms.windowPattern?.value?.dispose();
      m.uniforms.snowPattern?.value?.dispose();
      m.dispose();
    } });
    this.scene.traverse(o => { if (o instanceof DirectionalLight || o instanceof SpotLight)
      o.shadow.dispose(); });
    this.outputScene.traverse(o => { if (o instanceof Mesh) {
      o.geometry.dispose();
      o.material.dispose();
    } });
    this.target.dispose();
    this.timing.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.onLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.onRestored);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
