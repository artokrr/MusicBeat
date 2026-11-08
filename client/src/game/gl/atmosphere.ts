/** Native-pixel atmospheric integration, appended to the existing outline pass.
 * Twelve fixed height slices, clipped against scene depth. No framebuffer blur. */
export const atmosphereUniforms = /* glsl */ `
 uniform mat4 cameraWorld;
 uniform mat4 inverseProjection;
`;
export const atmosphereFragment = /* glsl */ `
 vec4 startView=inverseProjection*vec4(uv*2.-1.,-1.,1.);
 vec3 origin=(cameraWorld*vec4(startView.xyz/startView.w,1.)).xyz;
 vec3 ray=normalize((cameraWorld*vec4(0.,0.,-1.,0.)).xyz);
 vec4 endView=inverseProjection*vec4(uv*2.-1.,d*2.-1.,1.);
 vec3 end=(cameraWorld*vec4(endView.xyz/endView.w,1.)).xyz;
 float travel=length(end-origin), density=0.;
 for(int i=0;i<12;i++) {
  float z=(float(i)+.5)*3.25/12.;
  float t=(z-origin.z)/ray.z;
  vec3 p=origin+ray*t;
  float radius=.12+(3.25-z)*.63;
  float r=length(p.xy-vec2(1.95,.35))/radius;
  if(t>0. && t<travel && r<1.)
   density+=(1.-r*r)*(.27/max(.2,abs(ray.z)))*.024;
 }
 float grain=bayer(floor(uv*vec2(384.,216.)));
 color+=vec3(1.,.69,.34)*floor(density*lampLevel*48.+grain)/48.;
 // Warm emissive panes alone seed short, stepped pixel halation. Dark windows,
 // balls, lane markers and flakes are excluded by the dedicated surface tag.
 float halo=0.;
 for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++) {
  if(x==0 && y==0) continue;
  vec2 tap=uv+vec2(float(x),float(y))*px*2.;
  vec4 s=texture2D(surfaceMap,tap);
  if(s.a>.54 && s.a<.64 && depth(tap)<=d+.0005) halo+=.012;
 }
 color+=vec3(1.,.68,.32)*floor(halo*32.+grain)/32.;
`;
