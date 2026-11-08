import { atmosphereUniforms, atmosphereFragment } from './atmosphere';
import { PREMIUM_LOOK } from '../scene/look';
import { updateGroundContacts } from './contacts';
import { WorldRecorderNotes } from './recorder-notes';
import { CassetteRecorder } from './recorder';
import { Color, DepthTexture, DirectionalLight, Mesh, NearestFilter, NoToneMapping, OrthographicCamera, PCFSoftShadowMap, PlaneGeometry, Scene, ShaderMaterial, SpotLight, UnsignedIntType, Vector3, WebGLRenderer, WebGLRenderTarget, } from 'three';
import { TABLE_HALF_L, TABLE_HALF_W, TABLE_Z } from '../pixel/courtyard';
import { LOW_H, LOW_W } from '../pixel/stage';
import { CAMERA, VIEW_FORWARD, openingCamera } from '../scene/camera';
import { buildCourtyard } from './geometry';
import { Figure, PrimitiveBatch } from './figures';
import { GPUTimer } from './timing';
import { AuthoredCourtyard } from './props';
import { PaddleBatch } from './paddles';
import { lampLevel } from './lamp';
import { WorldSnow } from './weather';
import { Breath } from './breath';
import { Footprints } from './footprints';
import { lampUniform, pixelNoise } from './material';
import type { Vec3 } from '../rig/joints';
import type { SceneBackend, SceneFrame } from '../scene/types';
const near = .1, far = 40, distance = 20;
const PRESSED: Vec3 = [236, 150, 166], UNPRESSED: Vec3 = [178, 204, 198];
const outlineFragment = /* glsl */ `
 uniform sampler2D colorMap;
 uniform sampler2D surfaceMap;
 uniform sampler2D depthMap;
 uniform vec3 lampScreen;
 uniform float lampLevel;
 ${pixelNoise}
 ${PREMIUM_LOOK ? atmosphereUniforms : ''}
 varying vec2 vUv;
 float depth(vec2 uv) { return texture2D(depthMap,uv).r; }
 bool background(vec2 uv) { return depth(uv)>.99999 || texture2D(surfaceMap,uv).a>.9; }
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
  // Three hard rings at game resolution; add only sparse Bayer pixels.
  float radius=length(floor(uv*vec2(384.,216.))+.5-lampScreen.xy);
  float coverage=radius<2.5?.75:radius<4.5?.30:radius<6.5?.12:0.;
  float strength=radius<2.5?.25:radius<4.5?.13:.065;
  if(d>=lampScreen.z-.0001 && bayer(floor(uv*vec2(384.,216.)))<coverage)
   color+=vec3(1.,.66,.29)*strength*lampLevel;
  ${PREMIUM_LOOK ? atmosphereFragment : ''}
  gl_FragColor=vec4(min(color,1.),1.);
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
  readonly props = new AuthoredCourtyard(this.yard);
  readonly musicNotes = new WorldRecorderNotes(this.scene);
  readonly recorder = new CassetteRecorder(this.scene);
  readonly paddles = new PaddleBatch(this.scene);
  readonly snow = new WorldSnow(this.scene);
  readonly breath = new Breath(this.scene);
  readonly footprints = new Footprints();
  private readonly caps: PrimitiveBatch;
  private readonly spheres: PrimitiveBatch;
  readonly player: Figure;
  readonly stranger: Figure;
  private readonly point: Vec3 = [0, 0, 0];
  private readonly gameplayCamera: OrthographicCamera;
  private readonly bulb = new Vector3();
  private readonly cameraTarget = new Vector3();
  private opening = false;
  private lost = false;
  private readonly onLost = (event: Event) => { event.preventDefault(); this.lost = true; };
  private readonly onRestored = () => { this.timing = new GPUTimer(this.renderer.getContext() as WebGL2RenderingContext); this.lost = false; };
  constructor() {
    this.props.material.uniforms.footprints.value = this.footprints.texture;
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
    this.camera.updateMatrixWorld(true);
    this.gameplayCamera = this.camera.clone();
    const bulb = this.bulb.set(1.95, .35, 3.275).project(this.camera);
    bulb.set((bulb.x*.5+.5)*LOW_W, (bulb.y*.5+.5)*LOW_H, bulb.z*.5+.5);
    const material = new ShaderMaterial({
      uniforms: { colorMap: { value: this.target.textures[0] }, surfaceMap: { value: this.target.textures[1] }, depthMap: { value: this.target.depthTexture }, lampScreen: { value: bulb }, lampLevel: lampUniform, cameraWorld: { value: this.camera.matrixWorld }, inverseProjection: { value: this.camera.projectionMatrixInverse } },
      vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: outlineFragment, depthTest: false, depthWrite: false,
    });
    this.outputScene.add(new Mesh(new PlaneGeometry(2, 2), material));
  }
  get available() { return !this.lost && !this.renderer.getContext().isContextLost(); }
  render(frame: SceneFrame) {
    if (PREMIUM_LOOK) updateGroundContacts(frame);
    const cameraChanged = frame.introProgress !== undefined || this.opening;
    if (frame.introProgress !== undefined) {
      const view = openingCamera(frame.introProgress);
      const halfW = LOW_W / 2 / view.scale, halfH = LOW_H / 2 / view.scale;
      const ox = (view.offsetX ?? 0) / view.scale, oy = (view.offsetY ?? 0) / view.scale;
      this.camera.left = -halfW - ox; this.camera.right = halfW - ox;
      this.camera.top = halfH + oy; this.camera.bottom = -halfH + oy;
      this.camera.updateProjectionMatrix();
      const cp = Math.cos(view.pitch);
      this.camera.position.set(view.target[0] - Math.sin(view.yaw) * cp * distance,
        view.target[1] - Math.cos(view.yaw) * cp * distance, view.target[2] + Math.sin(view.pitch) * distance);
      this.camera.lookAt(this.cameraTarget.set(...view.target));
      this.opening = true;
    } else if (this.opening) {
      this.camera.copy(this.gameplayCamera);
      this.opening = false;
    }
    if (cameraChanged) {
      // Reuse the uniform vector: the halo follows the bulb during the tilt.
      this.camera.updateMatrixWorld(true);
      this.bulb.set(1.95, .35, 3.275).project(this.camera);
      this.bulb.set((this.bulb.x * .5 + .5) * LOW_W, (this.bulb.y * .5 + .5) * LOW_H, this.bulb.z * .5 + .5);
    }
    lampUniform.value = lampLevel(frame.timeMs);
    this.recorder.update(frame.recorder);
    this.musicNotes.update(frame);
    this.snow.update(frame.timeMs, frame.introProgress);
    this.breath.update(frame);
    this.footprints.update(frame);
    this.paddles.begin();
    this.caps.begin();
    this.spheres.begin();
    this.stranger.update(frame.stranger.pose, frame.stranger.look, frame.stranger.visible, this.caps, this.spheres, this.paddles);
    this.player.update(frame.player.pose, frame.player.look, frame.player.visible, this.caps, this.spheres, this.paddles);
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
    this.paddles.flush();
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
    this.recorder.dispose();
    this.musicNotes.dispose();
    this.footprints.dispose();
    this.breath.dispose();
    this.snow.dispose();
    this.props.dispose();
    this.paddles.dispose();
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
