import { PLINTH } from './map';

const PLINTH_GLSL = PLINTH.toFixed(2);

export const TOWER_VERTEX = /* glsl */ `
attribute float aDay,aMag,aSeed;
uniform float uPlay,uRise,uMin,uMax,uMirror,uHover,uHit,uHitGlow;
varying vec3 vW,vN,vV;
varying float vMag,vSeed,vGrow,vFresh,vIn,vH,vHover,vHit;
void main(){
  float age=(uPlay-aDay)/uRise;
  float g=aDay>uMax?1.:clamp(age,0.,1.);
  float t=g-1.;
  float e=1.+2.4*t*t*t+1.4*t*t;
  float s=aMag>0.?mix(.04,1.,e):1.;
  vec3 p=position;p.y*=s;
  vec4 w=modelMatrix*instanceMatrix*vec4(p,1.);
  vH=instanceMatrix[1][1]*s;
  if(uMirror<0.)w.y=-w.y;
  vW=w.xyz;vN=normal;vMag=aMag;vSeed=aSeed;vGrow=aMag>0.?g:1.;
  vFresh=(age>=0.&&aDay<=uMax)?exp(-max(age-1.,0.)*1.1):0.;
  vIn=step(uMin,aDay)*step(aDay,uMax);
  vHover=1.-step(.5,abs(aDay-uHover));
  vHit=(1.-step(.5,abs(aDay-uHit)))*uHitGlow;
  vec4 mv=viewMatrix*w;vV=mv.xyz;
  gl_Position=projectionMatrix*mv;
}`;

export const TOWER_FRAGMENT = /* glsl */ `
uniform vec3 uFog;
uniform float uFogD,uTime,uDim,uMirror;
varying vec3 vW,vN,vV;
varying float vMag,vSeed,vGrow,vFresh,vIn,vH,vHover,vHit;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 ramp(float t){
  vec3 a=vec3(.055,.267,.161),b=vec3(.0,.427,.196),c=vec3(.149,.651,.255),d=vec3(.224,.827,.325);
  t=clamp(t,0.,1.)*3.;
  return t<1.?mix(a,b,t):t<2.?mix(b,c,t-1.):mix(c,d,t-2.);
}
void main(){
  vec3 n=normalize(vN);
  float side=1.-abs(n.y);
  vec3 col;
  float y=abs(vW.y);
  if(vMag<=0.){
    col=vec3(.086,.106,.133)*(.7+.3*max(n.y,0.));
  }else{
    float t=pow(vMag,.72);
    vec3 base=ramp(t);
    float moon=.55+.45*dot(n,normalize(vec3(-.45,.7,.55)));
    col=base*(.09+.2*moon);
    if(side>.5){
      vec2 uv=abs(n.x)>.5?vec2(vW.z,y):vec2(vW.x,y);
      vec2 g=uv*vec2(8.,5.5);
      vec2 id=floor(g),f=fract(g);
      float pane=smoothstep(.13,.2,f.x)*smoothstep(.87,.8,f.x)*smoothstep(.16,.24,f.y)*smoothstep(.84,.76,f.y);
      float r=hash(id+vSeed*91.7);
      float share=.3+.25*t;
      float lit=step(r,share)*(.72+.28*sin(uTime*(.25+r)+r*40.));
      float crisp=1.-clamp(fwidth(g.y)*1.15,0.,1.);
      float glow=mix(share*.46,pane*lit,crisp);
      col+=mix(base*1.8,vec3(.82,1.,.86),.22+.38*t)*glow*(.86+.5*t);
    }else if(n.y>.5){
      col=base*(.74+.3*t);
    }
    float rim=smoothstep(.09,.0,abs(y-${PLINTH_GLSL}-vH))*side;
    col+=base*rim*1.1;
    col*=mix(.5,1.,clamp((y-${PLINTH_GLSL})/max(vH,.001)*1.3+.25,0.,1.));
    col*=mix(.42,1.,vGrow);
  }
  col*=1.+.3*vFresh*vIn;
  col*=mix(uDim,1.,vIn);
  col+=vec3(1.,.66,.26)*.07*vHover;
  col+=vec3(.9,.42,.16)*vHit*.28;
  float d=length(vV);
  col=mix(col,uFog,1.-exp(-d*d*uFogD*uFogD));
  if(uMirror<0.)col*=.32*exp(-y*.2);
  gl_FragColor=vec4(col,1.);
}`;

const DUSK = /* glsl */ `vec3 dusk(vec3 d){float a=pow(max(dot(normalize(vec3(d.x,0.,d.z)),vec3(0.,0.,-1.)),0.),5.);
  return vec3(.2,.13,.16)*a*exp(-abs(d.y)*13.);}`;

export const SOLID_VERTEX = /* glsl */ `varying vec3 vN,vV;
void main(){vN=normal;vec4 mv=modelViewMatrix*vec4(position,1.);vV=mv.xyz;gl_Position=projectionMatrix*mv;}`;

export const SOLID_FRAGMENT = /* glsl */ `uniform vec3 uFog;uniform float uFogD;varying vec3 vN,vV;
void main(){vec3 c=vec3(.042,.058,.08)*(.62+.38*max(normalize(vN).y,0.));float d=length(vV);
gl_FragColor=vec4(mix(c,uFog,1.-exp(-d*d*uFogD*uFogD)),1.);}`;

export const GROUND_VERTEX = /* glsl */ `varying vec3 vV,vP;
void main(){vec4 w=modelMatrix*vec4(position,1.);vP=w.xyz;vec4 mv=viewMatrix*w;vV=mv.xyz;gl_Position=projectionMatrix*mv;}`;

export const GROUND_FRAGMENT = /* glsl */ `uniform vec3 uFog;uniform float uFogD;varying vec3 vV,vP;${DUSK}
void main(){float d=length(vV);float f=1.-exp(-d*d*uFogD*uFogD);
gl_FragColor=vec4(mix(vec3(.018,.028,.042),uFog+dusk(normalize(vP-cameraPosition)),f),mix(.7,1.,f));}`;

export const SKY_VERTEX = /* glsl */ `varying vec3 vP;
void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

export const SKY_FRAGMENT = /* glsl */ `uniform vec3 uFog;varying vec3 vP;${DUSK}
void main(){vec3 d=normalize(vP);float h=max(d.y,0.);
vec3 c=mix(uFog,vec3(.03,.066,.125),smoothstep(0.,.17,h));
c=mix(c,vec3(.012,.018,.044),smoothstep(.1,.62,h));
gl_FragColor=vec4(c+dusk(d),1.);}`;

export const PLANET_VERTEX = /* glsl */ `varying vec3 vN,vP,vR;
void main(){vN=normal;vP=position;vR=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

export const PLANET_FRAGMENT = /* glsl */ `varying vec3 vN,vP,vR;
void main(){vec3 n=normalize(vN);float l=max(dot(n,normalize(vec3(-.74,.34,.58))),0.);
float b=.5+.5*sin(vP.y*.045+sin(vP.x*.016)*1.5);
vec3 c=mix(vec3(.17,.15,.23),vec3(.34,.27,.31),b)*(.025+.9*pow(l,1.15));
c+=vec3(.2,.36,.6)*pow(1.-max(normalize(vR).z,0.),3.)*(.12+l);
gl_FragColor=vec4(c,1.);}`;

export const BEACON_VERTEX = /* glsl */ `attribute float aDay,aPhase;uniform float uPlay,uRise,uMax,uTime,uPx;varying float vOn;
void main(){float g=aDay>uMax?1.:clamp((uPlay-aDay)/uRise,0.,1.);
vec4 mv=modelViewMatrix*vec4(position,1.);
vOn=step(1.,g)*(.22+.78*pow(.5+.5*sin(uTime*2.3+aPhase),5.));
gl_PointSize=clamp(220./-mv.z,5.,26.)*uPx;gl_Position=projectionMatrix*mv;}`;

export const BEACON_FRAGMENT = /* glsl */ `varying float vOn;
void main(){float r=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,0.,r);
gl_FragColor=vec4(vec3(1.,.26,.17)*vOn*a*a*1.9,1.);}`;

export const TRAFFIC_VERTEX = /* glsl */ `attribute vec3 aB;attribute float aRate,aPhase,aWarm;uniform float uTime,uPx;varying vec3 vC;
void main(){vec4 mv=viewMatrix*vec4(mix(position,aB,fract(aPhase+uTime*aRate)),1.);
vC=mix(vec3(.9,.95,1.),vec3(1.,.42,.16),aWarm);
gl_PointSize=clamp(60./-mv.z,.9,10.)*uPx;gl_Position=projectionMatrix*mv;}`;

export const TRAFFIC_FRAGMENT = /* glsl */ `varying vec3 vC;
void main(){float r=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,.1,r);gl_FragColor=vec4(vC*a*1.5,1.);}`;

export const DUST_VERTEX = /* glsl */ `attribute float aEnd;uniform vec3 uCam,uVel;varying float vA;
void main(){const float S=44.;vec3 w=uCam+(fract(position-uCam/S)-.5)*S;
vA=smoothstep(22.,7.,length(w-uCam))*clamp(length(uVel)/12.-.4,0.,1.);
w-=uVel*aEnd*.03;gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}`;

export const DUST_FRAGMENT = /* glsl */ `varying float vA;void main(){gl_FragColor=vec4(vec3(.72,.85,.95)*vA*.42,1.);}`;

export const WARP_VERTEX = /* glsl */ `attribute float aEnd;uniform float uWarp,uTime;varying float vA;
void main(){const float L=1000.;float z=-L+mod(position.z*L+uTime*640.,L);
vA=uWarp*smoothstep(-L,-L*.55,z);
gl_Position=projectionMatrix*vec4(position.xy,z-aEnd*(8.+520.*uWarp*uWarp),1.);}`;

export const WARP_FRAGMENT = /* glsl */ `varying float vA;void main(){gl_FragColor=vec4(vec3(.72,.85,1.)*vA*1.5,1.);}`;

export const BADGE_GLOW_VERTEX = /* glsl */ `attribute float aLit;uniform float uPx,uTime;varying float vLit;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vLit=aLit*(.7+.3*sin(uTime*3.));
gl_PointSize=clamp(2100./-mv.z,16.,420.)*uPx;gl_Position=projectionMatrix*mv;}`;

/** A ring around the medallion rather than a glow over it, so the artwork stays readable. */
export const BADGE_GLOW_FRAGMENT = /* glsl */ `varying float vLit;
void main(){float r=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,.68,r)*smoothstep(.5,.66,r);
gl_FragColor=vec4(vec3(1.,.68,.22)*vLit*a*.7,1.);}`;

export const FINISH_VERTEX = /* glsl */ `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

export const FINISH_FRAGMENT = /* glsl */ `uniform sampler2D tDiffuse;uniform float uFlash,uRed;varying vec2 vUv;
void main(){vec3 c=texture2D(tDiffuse,vUv).rgb;vec2 q=vUv-.5;float r=dot(q,q);c*=1.-r*.85;
c=mix(c,vec3(.86,.93,1.),uFlash);c+=vec3(.75,.06,.03)*uRed*smoothstep(.06,.5,r);
gl_FragColor=vec4(c,1.);}`;
