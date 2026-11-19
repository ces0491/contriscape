import { LIGHT_SLOTS } from './lights';
import { PLINTH } from './map';

const PLINTH_GLSL = PLINTH.toFixed(2);

/**
 * Light from the flashes in the scene, such as a badge going up, falling off to nothing at each one's reach. Most frames
 * have none, and `uLights` counts them, so those frames skip the loop. An empty slot has no colour and is skipped too.
 */
const FLASHES = /* glsl */ `uniform vec4 uLightPos[${LIGHT_SLOTS}];uniform vec3 uLightCol[${LIGHT_SLOTS}];uniform float uLights;
vec3 flashes(vec3 p,vec3 n){vec3 sum=vec3(0.);if(uLights<.5)return sum;
for(int i=0;i<${LIGHT_SLOTS};i++){vec3 c=uLightCol[i];if(c.r+c.g+c.b<=0.)continue;
vec3 l=uLightPos[i].xyz-p;float d=length(l);float fall=max(1.-d/uLightPos[i].w,0.);if(fall<=0.)continue;
sum+=c*fall*fall*(.25+.75*max(dot(n,l/max(d,1e-4)),0.));}
return sum;}`;

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
uniform vec3 uFog,uRamp[4],uWindow;
uniform float uFogD,uTime,uDim,uMirror;
varying vec3 vW,vN,vV;
varying float vMag,vSeed,vGrow,vFresh,vIn,vH,vHover,vHit;
${FLASHES}
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
vec3 ramp(float t){
  t=clamp(t,0.,1.)*3.;
  return t<1.?mix(uRamp[0],uRamp[1],t):t<2.?mix(uRamp[1],uRamp[2],t-1.):mix(uRamp[2],uRamp[3],t-2.);
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
      col+=mix(base*1.8,uWindow,.22+.38*t)*glow*(.86+.5*t);
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
  // Walls catch the light of anything bright nearby, tinted a little by their own colour. The dim reflection goes without.
  if(uMirror>0.)col+=flashes(vec3(vW.x,y,vW.z),n)*(vMag>0.?.45+.8*ramp(pow(vMag,.72)):vec3(.35));
  col+=vec3(1.,.66,.26)*.07*vHover;
  col+=vec3(.9,.42,.16)*vHit*.28;
  float d=length(vV);
  col=mix(col,uFog,1.-exp(-d*d*uFogD*uFogD));
  if(uMirror<0.)col*=.32*exp(-y*.2);
  gl_FragColor=vec4(col,1.);
}`;

/* The length is held off zero because straight up and straight down have no heading, and dividing by nothing is NaN. */
const DUSK = /* glsl */ `vec3 dusk(vec3 d){float a=pow(clamp(-d.z/max(length(d.xz),1e-5),0.,1.),5.);
  return vec3(.2,.13,.16)*a*exp(-abs(d.y)*13.);}`;

export const SOLID_VERTEX = /* glsl */ `varying vec3 vN,vV;
void main(){vN=normal;vec4 mv=modelViewMatrix*vec4(position,1.);vV=mv.xyz;gl_Position=projectionMatrix*mv;}`;

export const SOLID_FRAGMENT = /* glsl */ `uniform vec3 uFog;uniform float uFogD;varying vec3 vN,vV;
void main(){vec3 c=vec3(.042,.058,.08)*(.62+.38*max(normalize(vN).y,0.));float d=length(vV);
gl_FragColor=vec4(mix(c,uFog,1.-exp(-d*d*uFogD*uFogD)),1.);}`;

export const GROUND_VERTEX = /* glsl */ `varying vec3 vV,vP;
void main(){vec4 w=modelMatrix*vec4(position,1.);vP=w.xyz;vec4 mv=viewMatrix*w;vV=mv.xyz;gl_Position=projectionMatrix*mv;}`;

export const GROUND_FRAGMENT = /* glsl */ `uniform vec3 uFog;uniform float uFogD;varying vec3 vV,vP;${DUSK}${FLASHES}
void main(){float d=length(vV);float f=1.-exp(-d*d*uFogD*uFogD);
vec3 lit=flashes(vP,vec3(0.,1.,0.))*.32;
gl_FragColor=vec4(mix(vec3(.018,.028,.042)+lit,uFog+dusk(normalize(vP-cameraPosition)),f),mix(.7,1.,f)+min(dot(lit,vec3(.3)),.3));}`;

export const SKY_VERTEX = /* glsl */ `varying vec3 vP;
void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/** Value noise and a few octaves of it, for the Milky Way. */
const NOISE = /* glsl */ `float h3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vnoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vnoise(p);p*=2.03;a*=.5;}return s;}`;

/**
 * The night: a glow over the horizon in the buildings' colour, as a city lights its own sky, and a faint band of the
 * Milky Way with dark lanes of dust through it. `uDetail` drops the band on a slow GPU.
 */
export const SKY_FRAGMENT = /* glsl */ `uniform vec3 uFog,uGlow;uniform float uDetail;varying vec3 vP;${DUSK}${NOISE}
void main(){vec3 d=normalize(vP);float h=max(d.y,0.);
vec3 c=mix(uFog,vec3(.03,.066,.125),smoothstep(0.,.17,h));
c=mix(c,vec3(.012,.018,.044),smoothstep(.1,.62,h));
c+=uGlow*.05*exp(-h*12.)+uGlow*.012*exp(-h*3.);
if(uDetail>0.){float band=1.-abs(dot(d,normalize(vec3(.42,.5,-.76))));
float core=pow(band,7.);
if(core>.002){float cloud=fbm(d*5.+3.);float lanes=fbm(d*11.);
float m=core*(.45+.9*cloud)*(1.-.75*smoothstep(.42,.7,lanes)*pow(band,16.))*smoothstep(0.,.3,h);
c+=vec3(.15,.14,.22)*m*.42*uDetail;}}
gl_FragColor=vec4(c+dusk(d),1.);}`;

/** Stars of different sizes and colours, each twinkling at its own pace. */
export const STAR_VERTEX = /* glsl */ `attribute float aSize,aPhase;attribute vec3 aTint;uniform float uTime,uPx;varying vec3 vC;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);
float twinkle=.72+.28*sin(uTime*(.9+aPhase*.8)+aPhase*40.);
vC=aTint*twinkle;gl_PointSize=aSize*uPx;gl_Position=projectionMatrix*mv;}`;

export const STAR_FRAGMENT = /* glsl */ `varying vec3 vC;
void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(vC*smoothstep(1.,.15,r),1.);}`;

/**
 * Shooting stars: each is a short line of points that crosses its patch of sky for under a second, then waits out the
 * rest of its period. The head is brightest and the tail fades behind it.
 */
export const METEOR_VERTEX = /* glsl */ `attribute vec3 aEnd;attribute float aLag,aPeriod,aPhase;
uniform float uTime,uPx;varying float vA;
void main(){const float RUN=.75;float t=mod(uTime+aPhase,aPeriod);float k=t/RUN-aLag*.22;
bool on=t<RUN&&k>0.;vec3 p=normalize(mix(position,aEnd,clamp(k,0.,1.)))*2300.;
vec4 mv=modelViewMatrix*vec4(p,1.);vA=on?(1.-aLag)*sin(3.14159*clamp(t/RUN,0.,1.)):0.;
gl_PointSize=on?(2.6-aLag*1.6)*uPx:0.;gl_Position=projectionMatrix*mv;}`;

export const METEOR_FRAGMENT = /* glsl */ `varying float vA;
void main(){float r=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(vec3(.85,.92,1.)*vA*smoothstep(1.,.1,r)*1.4,1.);}`;

/** The light that falls on the planet and its rings, from the same side as the moon on the ship. */
const PLANET_LIGHT = 'normalize(vec3(-.74,.34,.58))';

export const PLANET_VERTEX = /* glsl */ `varying vec3 vN,vP,vR;
void main(){vN=normal;vP=position;vR=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/** A gas giant: banded clouds, a soft line between day and night, and a blue edge of atmosphere. */
export const PLANET_FRAGMENT = /* glsl */ `varying vec3 vN,vP,vR;
void main(){vec3 n=normalize(vN);float l=dot(n,${PLANET_LIGHT});
float day=smoothstep(-.06,.4,l);
float lat=vP.y/330.+.05*sin(vP.x*.018+sin(vP.z*.014)*2.);
float b=.5+.5*sin(lat*24.);float fine=.5+.5*sin(lat*67.+1.3);
vec3 base=mix(vec3(.15,.12,.21),vec3(.42,.3,.31),b);base=mix(base,vec3(.6,.47,.38),fine*.22);
vec3 c=base*(.018+1.05*day*pow(max(l,0.)+.05,.85));
float rim=pow(clamp(1.-normalize(vR).z,0.,1.),3.);
c+=vec3(.22,.42,.85)*rim*(.1+.9*smoothstep(-.35,.5,l));
gl_FragColor=vec4(c,1.);}`;

export const RING_VERTEX = /* glsl */ `varying vec3 vP;varying vec3 vW;
void main(){vP=position;vW=(modelMatrix*vec4(position,1.)).xyz-(modelMatrix*vec4(0.,0.,0.,1.)).xyz;
gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/**
 * The rings: bands of ice and dust by distance from the planet, lit from the planet's light, and dark where the planet's
 * shadow falls across them.
 */
export const RING_FRAGMENT = /* glsl */ `uniform float uInner,uOuter,uPlanet;varying vec3 vP;varying vec3 vW;
void main(){float t=(length(vP.xy)-uInner)/(uOuter-uInner);
float dens=.55+.25*sin(t*41.)+.2*sin(t*97.+2.)+.15*sin(t*13.);
dens*=smoothstep(0.,.06,t)*smoothstep(1.,.9,t)*(1.-.85*smoothstep(.6,.62,t)*smoothstep(.67,.65,t));
vec3 L=${PLANET_LIGHT};float behind=dot(vW,L);
float shade=behind<0.&&length(vW-behind*L)<uPlanet?.12:1.;
vec3 c=mix(vec3(.5,.42,.38),vec3(.78,.7,.6),.5+.5*sin(t*23.))*shade*.62;
gl_FragColor=vec4(c,clamp(dens,0.,1.)*.75);}`;

/** Lamps along the streets, small warm points that stay a few pixels across at any distance. */
export const LAMP_VERTEX = /* glsl */ `uniform float uPx;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(46./-mv.z,1.4,7.)*uPx;
gl_Position=projectionMatrix*mv;}`;

export const LAMP_FRAGMENT = /* glsl */ `void main(){float r=length(gl_PointCoord-.5)*2.;
gl_FragColor=vec4(vec3(1.,.62,.28)*smoothstep(1.,.1,r)*1.25,1.);}`;

export const BEACON_VERTEX = /* glsl */ `attribute float aDay,aPhase;uniform float uPlay,uRise,uMax,uTime,uPx;varying float vOn;
void main(){float g=aDay>uMax?1.:clamp((uPlay-aDay)/uRise,0.,1.);
vec4 mv=modelViewMatrix*vec4(position,1.);
vOn=step(1.,g)*(.22+.78*pow(clamp(.5+.5*sin(uTime*2.3+aPhase),0.,1.),5.));
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

/**
 * What the ship's metal and glass reflect: night sky above with a moon highlight, a band of lit windows in the
 * buildings' colour around the horizon, and the street below.
 */
export const ENV_VERTEX = /* glsl */ `varying vec3 vP;
void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

export const ENV_FRAGMENT = /* glsl */ `uniform vec3 uGlow,uWindow;varying vec3 vP;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){vec3 d=normalize(vP);float h=d.y;
vec3 c=mix(vec3(.05,.085,.13),vec3(.012,.02,.045),smoothstep(0.,.6,h));
vec3 moon=normalize(vec3(-.5,.8,.6));float m=max(dot(d,moon),0.);
c+=vec3(.9,.95,1.)*pow(m,220.)*3.+vec3(.25,.3,.42)*pow(m,9.)*.3;
float band=smoothstep(.42,.02,h)*smoothstep(-.42,-.04,h);
vec2 g=vec2(atan(d.z,d.x)*34.,h*46.);vec2 f=fract(g);
float pane=step(.62,hash(floor(g)))*step(.2,f.x)*step(f.x,.8)*step(.25,f.y)*step(f.y,.75);
c+=(uGlow*.32+uWindow*pane*1.4)*band;
if(h<0.)c=mix(c,vec3(.012,.016,.024)+uGlow*.05,smoothstep(-.05,-.5,h));
gl_FragColor=vec4(c,1.);}`;

/**
 * The exhaust: a cone from the nozzle, longer and brighter with throttle, white at the nozzle and blue at the tip.
 * It flickers so it reads as burning rather than as a solid.
 */
export const FLAME_VERTEX = /* glsl */ `uniform float uThrottle,uTime,uSeed;varying float vT;varying vec3 vN,vV;
void main(){vT=uv.y;vec3 p=position;
float flicker=1.+.1*sin(uTime*61.+uSeed)+.07*sin(uTime*97.+uSeed*3.);
p.z*=(.08+.24*min(uThrottle,2.7))*flicker;p.xy*=.75+.25*min(uThrottle,1.2);
vec4 mv=modelViewMatrix*vec4(p,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);
gl_Position=projectionMatrix*mv;}`;

/* `along` is clamped because interpolation can take it just below zero at the tip, and pow() of a negative is NaN, which
 * the bloom pass then spreads over the whole frame. */
export const FLAME_FRAGMENT = /* glsl */ `uniform float uThrottle;varying float vT;varying vec3 vN,vV;
void main(){float along=clamp(1.-vT,0.,1.);float edge=pow(abs(dot(normalize(vN),normalize(vV))),1.4);
vec3 c=mix(vec3(.2,.42,1.1),vec3(1.1,1.25,1.5),pow(along,3.));
gl_FragColor=vec4(c*pow(along,1.8)*edge*(.3+.35*min(uThrottle,2.)),1.);}`;

/**
 * A laser bolt: a stretched ellipsoid that glows along its whole length, with a white-hot core where it faces the camera,
 * dimmer towards its tail. Being closed, it still shows as a bright dot seen end-on from behind. `uScale` is the stretch,
 * which the normals undo. The colour sits above the bloom threshold, so the bolt glows.
 */
export const BOLT_VERTEX = /* glsl */ `uniform vec3 uScale;varying vec3 vN,vV;varying float vAlong;
void main(){vAlong=position.z*.5+.5;vec4 w=modelMatrix*instanceMatrix*vec4(position,1.);
vN=normalize(mat3(modelMatrix*instanceMatrix)*(normal/(uScale*uScale)));vV=normalize(cameraPosition-w.xyz);
gl_Position=projectionMatrix*viewMatrix*w;}`;

export const BOLT_FRAGMENT = /* glsl */ `uniform vec3 uColour;varying vec3 vN,vV;varying float vAlong;
void main(){float nv=abs(dot(normalize(vN),normalize(vV)));
float fade=mix(.45,1.,smoothstep(0.,.6,vAlong));
vec3 c=uColour*(.62+.38*nv)+vec3(1.,.82,.76)*pow(nv,4.)*2.;
gl_FragColor=vec4(c*fade,1.);}`;

/** A soft round glow that grows and fades over its life, for a muzzle or a bolt striking something. */
export const FLASH_VERTEX = /* glsl */ `attribute float aAge;attribute vec3 aColour;uniform float uPx,uLife,uSize;
varying vec3 vC;varying float vA;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);float k=clamp(aAge/uLife,0.,1.);
bool on=aAge>=0.&&aAge<uLife;vA=on?pow(1.-k,1.5):0.;vC=aColour;
gl_PointSize=on?clamp(uSize*(.6+k*.9)*900./-mv.z,2.,320.)*uPx:0.;gl_Position=projectionMatrix*mv;}`;

export const FLASH_FRAGMENT = /* glsl */ `varying vec3 vC;varying float vA;
void main(){float r=length(gl_PointCoord-.5)*2.;float a=pow(max(1.-r,0.),2.2);
gl_FragColor=vec4(vC*vA*a*2.2,1.);}`;

/** A ribbon of vapour off a wingtip, faded by age and soft at its edges. */
export const TRAIL_VERTEX = /* glsl */ `attribute float aAlpha,aSide;varying float vA,vSide;
void main(){vSide=aSide;
// Close to the camera a ribbon would fill the view like a searchlight, so it fades out there
vA=aAlpha*smoothstep(1.5,5.,distance(cameraPosition,position));
gl_Position=projectionMatrix*viewMatrix*vec4(position,1.);}`;

/* Both are clamped because a ribbon seen nearly edge on is drawn as slivers, and multisampling shades a pixel from its
 * centre even where only a corner of it is covered. That far outside a sliver the values run to hundreds, and one such
 * pixel is enough for the bloom pass to put a white ball over the wingtip. */
export const TRAIL_FRAGMENT = /* glsl */ `uniform vec3 uColour;varying float vA,vSide;
void main(){float a=clamp(vA,0.,1.);float s=clamp(vSide,-1.,1.);gl_FragColor=vec4(uColour*a*(1.-s*s),1.);}`;

export const BADGE_GLOW_VERTEX = /* glsl */ `attribute float aLit;uniform float uPx,uTime;varying float vLit;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vLit=aLit*(.7+.3*sin(uTime*3.));
gl_PointSize=clamp(2100./-mv.z,16.,420.)*uPx;gl_Position=projectionMatrix*mv;}`;

/** A ring around the medallion rather than a glow over it, so the artwork stays readable. */
export const BADGE_GLOW_FRAGMENT = /* glsl */ `varying float vLit;
void main(){float r=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,.68,r)*smoothstep(.5,.66,r);
gl_FragColor=vec4(vec3(1.,.68,.22)*vLit*a*.7,1.);}`;

export const BLAST_VERTEX = /* glsl */ `varying vec3 vN,vV;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);
gl_Position=projectionMatrix*mv;}`;

/** White at the heart and red at the rim, fading to nothing at the edge so a ball of fire has no outline. */
export const BLAST_FRAGMENT = /* glsl */ `uniform float uFade;varying vec3 vN,vV;
void main(){float core=pow(max(dot(normalize(vN),normalize(vV)),0.),1.8);
gl_FragColor=vec4(mix(vec3(1.5,.32,.06),vec3(3.,2.1,1.),core)*core*uFade,1.);}`;

/**
 * The fireworks. Every point starts at its shell's burst, and `aKind` says what it is.
 * Sparks (0) flash at the burst and slow as they spread, then sag and shrink. They hold their brightness until late, so
 * a shell reads as a shell for most of its life, and some glitter as they die. Each spark has fainter copies a moment
 * behind it (`aLag`), which draw its streak.
 * Rockets (1) climb from below in the seconds before the burst, fast off the ground and slowing at the top, trailing
 * fainter copies of themselves.
 * Flashes (2) light the sky for an instant as a shell bursts.
 * Anything not yet started, or finished, has no size.
 */
export const FIREWORK_VERTEX = /* glsl */ `attribute vec3 aVelocity,aColour;attribute float aDelay,aLag,aKind,aLife,aSeed;
uniform float uAge,uPx,uClimb,uRise;varying vec3 vC;varying float vA,vKind;
void main(){vec3 p=position;float a=0.;float size=0.;float t=uAge-aDelay-aLag;
if(aKind<.5){float k=t/aLife;
p+=aVelocity*(1.-exp(-2.2*t))/2.2;p.y-=1.4*t*t*(aLife>2.5?1.6:1.);
if(t>=0.&&k<1.){a=(1.-k*k*k)*(1.-aLag*5.5);
float glitter=step(.6,aSeed)*smoothstep(.5,.75,k);
a*=mix(1.,step(.45,fract(sin(aSeed*917.+floor(t*24.))*43758.5)),glitter);
size=(1.+1.6*exp(-8.*t))*(1.-.45*k)*(1.-aLag*4.);}}
else if(aKind<1.5){float k=(t+uClimb)/uClimb;
if(k>=0.&&k<1.){float rise=1.-(1.-k)*(1.-k);p.y-=uRise*(1.-rise);p.x+=sin(aSeed*40.+k*9.)*.5*(1.-k);
a=(.55+.45*k)*(1.-aLag*5.);size=.8*(1.-aLag*4.);}}
else if(t>=0.&&t<aLife){float k=t/aLife;a=1.-k;size=5.*(.6+k);}
vec4 mv=modelViewMatrix*vec4(p,1.);vC=aColour;vA=a;vKind=aKind;
gl_PointSize=a>0.?clamp(size*1000./-mv.z,2.,200.)*uPx:0.;gl_Position=projectionMatrix*mv;}`;

export const FIREWORK_FRAGMENT = /* glsl */ `varying vec3 vC;varying float vA,vKind;
void main(){float r=length(gl_PointCoord-.5)*2.;
float a=vKind>1.5?pow(max(1.-r,0.),2.)*1.6:smoothstep(1.,.1,r);gl_FragColor=vec4(vC*vA*a*3.,1.);}`;

export const FINISH_VERTEX = /* glsl */ `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/**
 * The last pass: at speed the view streaks outward from the centre with colour fringes at the edges, then a vignette,
 * the jump's flash, the red of a collision, and a fine grain that stops the dark sky banding.
 */
export const FINISH_FRAGMENT = /* glsl */ `uniform sampler2D tDiffuse;uniform float uFlash,uRed,uSpeed,uTime,uGrain;varying vec2 vUv;
float grain(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
void main(){vec2 q=vUv-.5;float r=dot(q,q);vec3 c;
if(uSpeed>.001){vec2 reach=q*uSpeed*.045;c=vec3(0.);
for(int i=0;i<8;i++){c+=texture2D(tDiffuse,vUv-reach*float(i)/7.).rgb;}c/=8.;
vec2 fringe=q*uSpeed*.012;c.r=mix(c.r,texture2D(tDiffuse,vUv+fringe).r,.7);c.b=mix(c.b,texture2D(tDiffuse,vUv-fringe).b,.7);}
else c=texture2D(tDiffuse,vUv).rgb;
c*=1.-r*.85;
c=mix(c,vec3(.86,.93,1.),uFlash);c+=vec3(.75,.06,.03)*uRed*smoothstep(.06,.5,r);
c+=(grain(gl_FragCoord.xy+fract(uTime*7.)*91.)-.5)*uGrain;
gl_FragColor=vec4(c,1.);}`;
