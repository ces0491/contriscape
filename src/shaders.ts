import { LIGHT_SLOTS } from './lights';
import { CELL, DEPTH, PLINTH, ROAD, TOWER, YEAR_PITCH } from './map';

const PLINTH_GLSL = PLINTH.toFixed(2);
/** The side of one block in the Blocks look: two to a tower's width. */
const BLOCK_GLSL = (TOWER / 2).toFixed(3);
/** Where the sun stands by day. It is the direction the night's moonlight comes from, so the same faces are lit. */
const SUN = 'normalize(vec3(-.45,.7,.55))';

/** A number from 0 to 1 that is settled by a point and looks unrelated to its neighbours'. */
const HASH = 'float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}';

/** Light that falls off with distance `d` in steps, the way a shooter of the early 1990s lit a room. */
const STEPPED = 'floor(clamp(1.1-d/800.,.6,1.)*10.+.5)/10.';

/*
 * A shader that draws differently from look to look carries each version under a name that `dress` in `skins.ts`
 * defines: `BLOCKS`, `POSTER`, `VECTOR`, `CONSOLE` or `SHOOTER` for the scene, `DAY` for any scene with a bright sky,
 * and `PIXELS` and `LEVELS` for the pass over the finished frame. Each look then compiles to its own program, so none
 * pays for another, and the night's shaders run as they did before there was a choice.
 */

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
varying vec2 vL;
varying float vMag,vSeed,vGrow,vFresh,vIn,vH,vHover,vHit;
void main(){
  vL=position.xz;
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
varying vec2 vL;
varying float vMag,vSeed,vGrow,vFresh,vIn,vH,vHover,vHit;
${FLASHES}
${HASH}
vec3 ramp(float t){
  t=clamp(t,0.,1.)*3.;
  return t<1.?mix(uRamp[0],uRamp[1],t):t<2.?mix(uRamp[1],uRamp[2],t-1.):mix(uRamp[2],uRamp[3],t-2.);
}
#ifdef DAY
/*
 * What is done last to any wall under a bright sky. Years outside the one being flown lose their colour and sink into
 * the haze. A flash brightens a wall by a share of its own colour, because added on top it would bleach the wall white.
 */
vec3 daylit(vec3 col,vec3 n,float y){
  col=mix(col,vec3(1.),.3*vFresh*vIn);
  col=mix(mix(vec3(dot(col,vec3(.3,.59,.11))),uFog,.45),col,mix(uDim,1.,vIn));
  col*=1.+min(flashes(vec3(vW.x,y,vW.z),n),vec3(1.))*.5;
  col=mix(col,vec3(1.,.74,.3),.42*vHover);
  col=mix(col,vec3(1.,.5,.2),.55*clamp(vHit,0.,1.));
  float d=length(vV);
  return mix(col,uFog,1.-exp(-d*d*uFogD*uFogD));
}
#endif
#if defined(BLOCKS)
/*
 * By day a tower is a stack of blocks, two across each face, in the buildings' colour: pale for a quiet day and full for
 * a busy one. Each face has one flat shade by how it stands to the sun, each block its own slight tone, and a seam
 * runs between blocks. Seams and tones fade with distance, where they would shimmer.
 */
void main(){
  vec3 n=normalize(vN);
  float y=abs(vW.y);
  float up=y-${PLINTH_GLSL};
  float shade=n.y>.5?1.:n.z>.5?.86:n.x<-.5?.74:n.x>.5?.6:.52;
  // Clamped, because multisampling can read a varying from outside the face it is on
  vec2 l=clamp(vL,-.5,.5)+.5;
  vec2 g=n.y>.5?l*2.:vec2((abs(n.x)>.5?l.y:l.x)*2.,up/${BLOCK_GLSL});
  vec2 id=floor(g),f=fract(g);
  float crisp=1.-clamp(max(fwidth(g.x),fwidth(g.y))*1.6,0.,1.);
  float seam=(1.-smoothstep(0.,.07,min(min(f.x,1.-f.x),min(f.y,1.-f.y))))*crisp;
  float tone=1.+(hash(id+vSeed*91.7+n.xz*3.)-.5)*.14*crisp;
  vec3 col;
  if(vMag<=0.){
    col=vec3(.74,.76,.71)*shade;
  }else{
    float t=pow(vMag,.72);
    col=mix(mix(vec3(1.),uRamp[3],.42),uRamp[3],t)*shade*tone;
    col*=1.-.22*seam;
    col*=mix(.84,1.,clamp(up/1.6,0.,1.));
    col*=mix(.8,1.,vGrow);
  }
  gl_FragColor=vec4(daylit(col,n,y),1.);
}
#elif defined(POSTER)
/*
 * A poster of a city: flat colour, seven of them, one to a tower, whatever the buildings' colour is set to. Three flat
 * shades tell the faces apart, and a day with nothing on it is a slab of the paper's own grey.
 */
vec3 flat7(float seed){
  float k=floor(clamp(seed,0.,.999)*7.);
  return k<1.?vec3(.345,.227,.969):k<2.?vec3(.969,.212,.471):k<3.?vec3(.373,.929,.514):k<4.?vec3(.733,.627,.039)
    :k<5.?vec3(.682,.522,1.):k<6.?vec3(.753,.322,0.):vec3(.094,.055,.153);
}
void main(){
  vec3 n=normalize(vN);
  float y=abs(vW.y);
  float shade=n.y>.5?1.:(n.z>.5||n.x<-.5)?.9:.76;
  vec3 col=vMag<=0.?vec3(.84,.86,.85)*shade:flat7(vSeed)*shade*mix(.82,1.,vGrow);
  gl_FragColor=vec4(daylit(col,n,y),1.);
}
#elif defined(VECTOR)
/*
 * A tower as a vector display would draw it: its edges, glowing, and nothing else. The faces are filled almost black,
 * which takes out the lines behind them. An edge is found from how far a pixel is from the side of its face, counted in
 * pixels so a line is as wide far off as it is close. A busier day's lines are brighter, and past white, so they glow.
 */
void main(){
  vec3 n=normalize(vN);
  float y=abs(vW.y);
  float up=y-${PLINTH_GLSL};
  vec2 l=clamp(vL,-.5,.5)+.5;
  vec2 e=min(l,1.-l)/max(fwidth(l),vec2(1e-5));
  float edge=n.y>.5?min(e.x,e.y):min(abs(n.x)>.5?e.y:e.x,min(up,vH-up)/max(fwidth(up),1e-5));
  float line=1.-smoothstep(.6,1.6,edge);
  float t=pow(vMag,.72);
  vec3 ink=vMag<=0.?uRamp[1]*.45:mix(uRamp[2],uRamp[3],t)*(1.+1.3*t);
  vec3 col=mix(uRamp[0]*.06,ink,line);
  col*=mix(.4,1.,vGrow);
  col*=1.+.7*vFresh*vIn;
  col*=mix(uDim,1.,vIn);
  col+=flashes(vec3(vW.x,y,vW.z),n)*(.08+.5*line);
  col+=vec3(1.,.66,.26)*vHover*(.12+.9*line);
  col+=vec3(.9,.42,.16)*vHit*(.2+.6*line);
  float d=length(vV);
  col=mix(col,uFog,1.-exp(-d*d*uFogD*uFogD));
  gl_FragColor=vec4(col,1.);
}
#elif defined(CONSOLE)
/*
 * A tower as a 16-bit console's artist shaded a pillar: the buildings' colour in flat bands across each face, lightest
 * at one edge and darkest at the other, a dark line at each storey, and a pale roof with a rim. Nothing is blended from
 * one shade to the next. The bands and lines fade out where a face is only a few pixels wide, where they would flicker.
 */
void main(){
  vec3 n=normalize(vN);
  float y=abs(vW.y);
  float up=y-${PLINTH_GLSL};
  vec2 l=clamp(vL,-.5,.5)+.5;
  float face=n.y>.5?1.:n.z>.5?.94:n.x<-.5?.8:n.x>.5?.66:.58;
  vec3 col;
  if(vMag<=0.){
    col=vec3(.5,.74,.34)*face;
  }else{
    float t=pow(vMag,.72);
    vec3 base=mix(mix(vec3(1.),uRamp[3],.45),uRamp[3],t);
    if(n.y>.5){
      float rim=1.-step(.16,min(min(l.x,1.-l.x),min(l.y,1.-l.y)));
      col=mix(base,vec3(1.),.35)*mix(1.,.78,rim);
    }else{
      float u=abs(n.x)>.5?l.y:l.x;
      float storey=up/${BLOCK_GLSL};
      float wide=1.-clamp(fwidth(u)*9.,0.,1.);
      float tall=1.-clamp(fwidth(storey)*3.,0.,1.);
      float band=u<.2?1.2:u<.62?1.:u<.84?.82:.66;
      col=base*face*mix(1.,band,wide)*(1.-.28*step(fract(storey),.14)*tall);
      col*=mix(.84,1.,clamp(up/1.6,0.,1.));
    }
    col*=mix(.8,1.,vGrow);
  }
  gl_FragColor=vec4(daylit(min(col,vec3(.98)),n,y),1.);
}
#elif defined(SHOOTER)
/*
 * A tower as a shooter of the early 1990s textured a wall: plates of dull metal, laid like bricks and bolted at the
 * corners, with a strip of light up the middle in the buildings' colour, brighter for a busier day. Walls facing north
 * and south are a step brighter than those facing east and west, and all of it dims with distance in steps.
 */
void main(){
  vec3 n=normalize(vN);
  float y=abs(vW.y);
  float up=y-${PLINTH_GLSL};
  vec2 l=clamp(vL,-.5,.5)+.5;
  float d=length(vV);
  float t=pow(max(vMag,0.),.72);
  vec3 col=vec3(.26,.24,.22);
  vec3 lamp=vec3(0.);
  if(vMag>0.){
    if(n.y>.5){
      float rim=1.-step(.13,min(min(l.x,1.-l.x),min(l.y,1.-l.y)));
      col=vec3(.42,.38,.34)*mix(.82,1.12,rim);
    }else{
      float u=abs(n.x)>.5?l.y:l.x;
      vec2 g=vec2(u*2.,up/${BLOCK_GLSL});
      g.x+=.5*mod(floor(g.y),2.);
      vec2 id=floor(g),e=min(fract(g),1.-fract(g));
      float crisp=1.-clamp(max(fwidth(u)*2.,fwidth(g.y))*2.4,0.,1.);
      float seam=(1.-step(.07,min(e.x,e.y)))*crisp;
      float bolt=(1.-step(.055,length(e-.17)))*crisp;
      col=mix(vec3(.47,.39,.31),vec3(.37,.38,.42),step(.5,hash(vec2(vSeed*17.3,2.))));
      col*=1.+(hash(id+vSeed*91.7)-.5)*.2*crisp;
      col*=(1.-.5*seam)*(1.+.6*bolt)*(abs(n.z)>.5?1.:.72);
      float strip=(1.-step(.1,abs(u-.5)))*step(.18,fract(up/${BLOCK_GLSL}));
      lamp=mix(uRamp[2],uRamp[3],t)*(.45+1.2*t)*strip;
      col*=1.-strip;
    }
    col*=mix(.5,1.,vGrow);lamp*=vGrow;
  }
  float light=${STEPPED};
  col=col*light+lamp*(.5+.5*light);
  col*=1.+.4*vFresh*vIn;
  col*=mix(uDim,1.,vIn);
  col+=flashes(vec3(vW.x,y,vW.z),n)*.6;
  col+=vec3(1.,.66,.26)*.14*vHover;
  col+=vec3(.9,.42,.16)*vHit*.3;
  gl_FragColor=vec4(mix(col,uFog,1.-exp(-d*d*uFogD*uFogD)),1.);
}
#else
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
      // A roof: one flat deck, a shade darker inside its parapet. A plant room drawn on each read as a green square
      // on every tower from above.
      vec2 l=clamp(vL,-.5,.5)+.5;
      float deck=smoothstep(.06,.1,min(min(l.x,1.-l.x),min(l.y,1.-l.y)));
      col=base*(.6+.26*t)*mix(1.,.8,deck);
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
}
#endif`;

/* The length is held off zero because straight up and straight down have no heading, and dividing by nothing is NaN. */
const DUSK = /* glsl */ `vec3 dusk(vec3 d){float a=pow(clamp(-d.z/max(length(d.xz),1e-5),0.,1.),5.);
  return vec3(.2,.13,.16)*a*exp(-abs(d.y)*13.);}`;

export const SOLID_VERTEX = /* glsl */ `varying vec3 vN,vV;
void main(){vN=normal;vec4 mv=modelViewMatrix*vec4(position,1.);vV=mv.xyz;gl_Position=projectionMatrix*mv;}`;

/**
 * The slab a year's towers stand on: dark by night, pale stone in Blocks, near black on the poster's paper, packed earth
 * in 16-bit and a metal plate in VGA.
 */
export const SOLID_FRAGMENT = /* glsl */ `uniform vec3 uFog;uniform float uFogD;varying vec3 vN,vV;
void main(){
#if defined(BLOCKS)
vec3 c=vec3(.79,.8,.75)*(.72+.28*max(normalize(vN).y,0.));
#elif defined(POSTER)
vec3 c=vec3(.094,.055,.153)+.05*max(normalize(vN).y,0.);
#elif defined(VECTOR)
vec3 c=vec3(.003,.007,.01);
#elif defined(CONSOLE)
vec3 c=vec3(.6,.36,.22)*(.76+.24*max(normalize(vN).y,0.));
#elif defined(SHOOTER)
vec3 c=vec3(.26,.24,.22)*(.6+.4*max(normalize(vN).y,0.));
#else
vec3 c=vec3(.042,.058,.08)*(.62+.38*max(normalize(vN).y,0.));
#endif
float d=length(vV);
gl_FragColor=vec4(mix(c,uFog,1.-exp(-d*d*uFogD*uFogD)),1.);}`;

export const GROUND_VERTEX = /* glsl */ `varying vec3 vV,vP;
void main(){vec4 w=modelMatrix*vec4(position,1.);vP=w.xyz;vec4 mv=viewMatrix*w;vV=mv.xyz;gl_Position=projectionMatrix*mv;}`;

/** How close a point is to a line of a grid with one square to a tower's plot, as 1 on a line and 0 away from it. */
const GRID = /* glsl */ `float grid(vec2 p,float width){vec2 g=p/${CELL.toFixed(2)};vec2 w=max(fwidth(g),vec2(1e-5));
vec2 a=abs(fract(g-.5)-.5)/w;
return (1.-smoothstep(width*.5,width*.5+1.,min(a.x,a.y)))*(1.-clamp(max(w.x,w.y)*1.6,0.,1.));}`;

/**
 * The ground under a sun, before any light or haze: sand in squares the size of a tower's plot with paved streets
 * between the years in Blocks, paper ruled with hairlines in Poster, and in 16-bit baked earth in slanted stripes of
 * two tans with paths of pale stone, each with a darker edge. Grass was tried and green towers were lost against it. The ground draws it, and so do the towers' shadows, which
 * are this again a shade darker. `uCity` is the city's width and depth.
 */
const SURFACE = /* glsl */ `
#if defined(BLOCKS)
${HASH}
vec3 surface(vec3 p){vec2 g=p.xz/${CELL.toFixed(2)};vec2 id=floor(g);
float crisp=1.-clamp(max(fwidth(g.x),fwidth(g.y))*1.4,0.,1.);
vec3 sand=vec3(.88,.81,.62)*(1.+((mod(id.x+id.y,2.)-.5)*.07+(hash(id)-.5)*.05)*crisp);
float z=mod(p.z+${ROAD.toFixed(1)},${YEAR_PITCH.toFixed(1)});
float street=step(-1.5,p.x)*step(p.x,uCity.x+1.5)*step(-${ROAD.toFixed(1)},p.z)*step(p.z,uCity.y+${ROAD.toFixed(1)})
  *step(.6,z)*step(z,${(ROAD - 0.6).toFixed(1)});
vec2 s=floor(g*2.);
return mix(sand,vec3(.7,.73,.76)*(1.+(mod(s.x+s.y,2.)-.5)*.07*crisp),street);}
#elif defined(POSTER)
vec3 surface(vec3 p){return mix(vec3(.914,.929,.925),vec3(.77,.8,.78),grid(p.xz,1.)*.9);}
#elif defined(CONSOLE)
vec3 surface(vec3 p){vec2 g=p.xz/${CELL.toFixed(2)};
float crisp4=1.-clamp(max(fwidth(g.x),fwidth(g.y))*4.,0.,1.);
vec3 grass=mix(vec3(.84,.63,.38),vec3(.9,.71,.45),step(.5,fract((g.x+g.y)*.125))*crisp4);
float z=mod(p.z+${ROAD.toFixed(1)},${YEAR_PITCH.toFixed(1)});
float street=step(-1.5,p.x)*step(p.x,uCity.x+1.5)*step(-${ROAD.toFixed(1)},p.z)*step(p.z,uCity.y+${ROAD.toFixed(1)})
  *step(.5,z)*step(z,${(ROAD - 0.5).toFixed(1)});
float middle=step(1.,z)*step(z,${(ROAD - 1).toFixed(1)});
return mix(grass,mix(vec3(.58,.5,.44),vec3(.93,.9,.82),middle),street);}
#endif`;

/**
 * By night the ground is wet tarmac, see-through enough to show the towers' reflection, with its streets painted. In
 * the other looks it is solid. Vector has a grid of dim lines on black. VGA has a floor of stone flags two plots to a
 * side, with the streets plated in metal and edged in warning stripes, dimming with distance in the walls' steps.
 */
export const GROUND_FRAGMENT = /* glsl */ `uniform vec3 uFog,uRamp[4];uniform float uFogD;uniform vec2 uCity;varying vec3 vV,vP;${DUSK}${FLASHES}${GRID}${SURFACE}
#ifdef DAY
void main(){float d=length(vV);
vec3 c=surface(vP)*(1.+min(flashes(vP,vec3(0.,1.,0.)),vec3(1.))*.4);
gl_FragColor=vec4(mix(c,uFog,1.-exp(-d*d*uFogD*uFogD)),1.);}
#elif defined(VECTOR)
void main(){float d=length(vV);float f=1.-exp(-d*d*uFogD*uFogD);
vec3 c=uRamp[1]*.6*grid(vP.xz,1.2)+flashes(vP,vec3(0.,1.,0.))*.12;
gl_FragColor=vec4(mix(c,uFog,f),1.);}
#elif defined(SHOOTER)
${HASH}
void main(){float d=length(vV);
vec2 g=vP.xz/${(CELL * 2).toFixed(2)};vec2 e=min(fract(g),1.-fract(g));
float crisp=1.-clamp(max(fwidth(g.x),fwidth(g.y))*2.,0.,1.);
vec3 c=vec3(.36,.32,.28)*(1.+(hash(floor(g))-.5)*.22*crisp)*(1.-.5*(1.-step(.04,min(e.x,e.y)))*crisp);
float z=mod(vP.z+${ROAD.toFixed(1)},${YEAR_PITCH.toFixed(1)});
float street=step(-1.5,vP.x)*step(vP.x,uCity.x+1.5)*step(-${ROAD.toFixed(1)},vP.z)*step(vP.z,uCity.y+${ROAD.toFixed(1)})*step(z,${ROAD.toFixed(1)});
float kerb=step(.7,z)*(1.-step(1.2,z))+step(${(ROAD - 1.2).toFixed(1)},z)*(1.-step(${(ROAD - 0.7).toFixed(1)},z));
float stripes=step(.5,fract((vP.x+z)*.7))*(1.-clamp(fwidth(vP.x)*2.4,0.,1.));
c=mix(c,vec3(.22,.22,.25),street);
c=mix(c,vec3(.78,.6,.1),street*kerb*stripes*.9);
c=c*${STEPPED}+flashes(vP,vec3(0.,1.,0.))*.3;
gl_FragColor=vec4(mix(c,uFog,1.-exp(-d*d*uFogD*uFogD)),1.);}
#else
/* The night's streets are painted: a broken line down the middle and a solid one along each kerb, fading where they would be finer than a pixel. */
void main(){float d=length(vV);float f=1.-exp(-d*d*uFogD*uFogD);
vec3 lit=flashes(vP,vec3(0.,1.,0.))*.32;
float z=mod(vP.z+${ROAD.toFixed(1)},${YEAR_PITCH.toFixed(1)});
float street=step(-1.5,vP.x)*step(vP.x,uCity.x+1.5)*step(-${ROAD.toFixed(1)},vP.z)*step(vP.z,uCity.y+${ROAD.toFixed(1)})*step(z,${ROAD.toFixed(1)});
float middle=(1.-smoothstep(.05,.1,abs(z-${(ROAD / 2).toFixed(2)})))*step(.42,fract(vP.x/${CELL.toFixed(2)}));
float kerbs=(1.-smoothstep(.03,.07,abs(z-.34)))+(1.-smoothstep(.03,.07,abs(z-${(ROAD - 0.34).toFixed(2)})));
float paint=street*(.6*middle+.3*kerbs)*(1.-clamp(fwidth(vP.z)*7.,0.,1.));
gl_FragColor=vec4(mix(vec3(.018,.028,.042)+vec3(.5,.56,.5)*paint*.34+lit,uFog+dusk(normalize(vP-cameraPosition)),f),mix(.7,1.,f)+min(dot(lit,vec3(.3)),.3)+paint*.25);}
#endif`;

/**
 * A tower's shadow: the tower itself, grown as far as the date has grown it, pressed flat onto the ground along the
 * sun's rays. It lies a hair above the slab the towers stand on, which over a street leaves it floating by the slab's
 * height, too little to see.
 */
export const SHADOW_VERTEX = /* glsl */ `attribute float aDay,aMag;uniform float uPlay,uRise,uMax;
varying float vOn;varying vec3 vV,vP;
void main(){float age=(uPlay-aDay)/uRise;float g=aDay>uMax?1.:clamp(age,0.,1.);float t=g-1.;
float s=aMag>0.?mix(.04,1.,1.+2.4*t*t*t+1.4*t*t):1.;
vec3 p=position;p.y*=s;vec4 w=modelMatrix*instanceMatrix*vec4(p,1.);
const float LIFT=${(PLINTH + 0.02).toFixed(2)};vec3 sun=${SUN};
w.xyz-=sun*((w.y-LIFT)/sun.y);w.y=LIFT;
vOn=aMag>0.?1.:0.;vP=w.xyz;vec4 mv=viewMatrix*w;vV=mv.xyz;gl_Position=projectionMatrix*mv;}`;

/**
 * A shadow is drawn as what it falls on, a shade darker: the slab under a year's towers, or the ground beyond it.
 * Painted that way, two shadows that overlap paint the same colour twice, where darkening what is already there would
 * darken it twice. The other way to stop that is a stencil buffer, which cost this scene four frames in ten on an
 * integrated GPU. A day with nothing on it has a slab too low to throw a shadow.
 */
export const SHADOW_FRAGMENT = /* glsl */ `uniform vec3 uFog;uniform float uShade,uFogD;uniform vec2 uCity;
varying float vOn;varying vec3 vV,vP;${GRID}${SURFACE}
void main(){
#ifdef DAY
if(vOn<.5)discard;
float z=mod(vP.z+.5,${YEAR_PITCH.toFixed(1)});
float slab=step(-.5,vP.x)*step(vP.x,uCity.x+.5)*step(-.5,vP.z)*step(vP.z,uCity.y+.5)*step(z,${(DEPTH + 1).toFixed(1)});
#if defined(BLOCKS)
vec3 under=vec3(.79,.8,.75);
#elif defined(CONSOLE)
vec3 under=vec3(.6,.36,.22);
#else
vec3 under=vec3(.144,.105,.203);
#endif
vec3 c=mix(surface(vP),under,slab)*(1.-uShade);
float d=length(vV);gl_FragColor=vec4(mix(c,uFog,1.-exp(-d*d*uFogD*uFogD)),1.);
#else
discard;
#endif
}`;

export const SKY_VERTEX = /* glsl */ `varying vec3 vP;
void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/** Columns round the whole horizon for an angle from `atan`, as a factor: a whole number of them, so none is cut at the seam. */
const around = (columns: number): string => (columns / (2 * Math.PI)).toFixed(5);

/** Value noise and a few octaves of it, for the Milky Way. */
const NOISE = /* glsl */ `float h3(vec3 p){p=fract(p*.3183099+.1);p*=17.;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float vnoise(vec3 x){vec3 i=floor(x),f=fract(x);f=f*f*(3.-2.*f);
return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float s=0.,a=.5;for(int i=0;i<4;i++){s+=a*vnoise(p);p*=2.03;a*=.5;}return s;}`;

/**
 * The night: a glow over the horizon in the buildings' colour, as a city lights its own sky, and a faint band of the
 * Milky Way with dark lanes of dust through it. `uDetail` drops the band on a slow GPU. Along the horizon stands the
 * rest of the city, far off: dark towers in clumps, a few windows lit, so the streets don't run out into nothing.
 */
export const SKY_FRAGMENT = /* glsl */ `uniform vec3 uFog,uGlow;uniform float uDetail,uTime,uAurora;varying vec3 vP;${DUSK}${NOISE}
#if defined(BLOCKS)
/*
 * The day: haze at the horizon rising to blue, a square sun, and clouds made of squares. The clouds are a flat layer far
 * overhead, cut into a grid, with each square wholly cloud or wholly sky. The sun is brighter than white, so it is one
 * of the few things that glow by day. Along the horizon stand flat-topped hills in steps, pale with distance, each
 * capped with a strip of green.
 */
void main(){vec3 d=normalize(vP);float h=max(d.y,0.);
vec3 c=mix(uFog,vec3(.4,.66,.97),smoothstep(0.,.3,h));
c=mix(c,vec3(.2,.46,.9),smoothstep(.25,.95,h));
vec3 sun=${SUN};float facing=dot(d,sun);
if(facing>0.){vec3 sx=normalize(cross(vec3(0.,1.,0.),sun));vec3 sy=cross(sun,sx);
float m=max(abs(dot(d,sx)),abs(dot(d,sy)))/facing;
c+=vec3(1.,.9,.62)*.3*smoothstep(.26,.06,m);
c=mix(c,vec3(1.5,1.42,1.12),step(m,.06));}
if(d.y>.02){vec2 p=d.xz/d.y*5.+vec2(uTime*.012,0.);vec2 id=floor(p);
float cloud=step(.6,vnoise(vec3(id*.31,4.)))*smoothstep(.04,.16,d.y);
c=mix(c,vec3(.97+.03*h3(vec3(id,1.))),cloud*.93);}
float col=floor(atan(d.z,d.x)*${around(96)});
float top=floor((.012+.075*h3(vec3(floor(col/4.),2.,5.))*h3(vec3(floor(col/11.),7.,1.))+.012*h3(vec3(col,3.,9.)))/.008)*.008;
if(d.y<top&&d.y>-.002)c=mix(d.y>top-.006?vec3(.5,.72,.42):vec3(.8,.74,.6),uFog,.5);
gl_FragColor=vec4(c,1.);}
#elif defined(POSTER)
/*
 * The poster's sky is its paper, a shade lighter overhead, with one flat disc low in it, cut by bands of paper that
 * widen towards the horizon.
 */
void main(){vec3 d=normalize(vP);
vec3 c=mix(uFog,vec3(.955,.965,.96),smoothstep(0.,.6,max(d.y,0.)));
vec3 at=normalize(vec3(-.45,.13,.55));
float disc=step(.955,dot(d,at))*step(0.,d.y);
float cut=step(fract(d.y*26.),.5*(1.-smoothstep(.02,.26,d.y)));
c=mix(c,vec3(.969,.212,.471),disc*(1.-cut));
gl_FragColor=vec4(c,1.);}
#elif defined(VECTOR)
/*
 * A vector display's sky is the unlit tube, with one line of the buildings' colour along the horizon and two ranges of
 * mountains beyond it, each drawn as its outline alone. A line is as thick as a pixel or two wherever it runs.
 */
float ridge(float a,float f,float p){return abs(fract(a*f+p)-.5)*2.;}
void main(){vec3 d=normalize(vP);float a=atan(d.z,d.x)/6.28319;
vec3 c=uFog+uGlow*(.5*exp(-abs(d.y)*150.)+.04*exp(-abs(d.y)*9.));
float far=.02+.085*ridge(a,7.,.2)*ridge(a,3.,.6)+.02*ridge(a,23.,.1);
float near=.006+.05*ridge(a,11.,.45)*ridge(a,5.,.1)+.012*ridge(a,31.,.7);
float w=max(fwidth(d.y),1e-5)*1.6;
c+=uGlow*.34*(1.-smoothstep(0.,w,abs(d.y-far)))*step(near,d.y);
c+=uGlow*.6*(1.-smoothstep(0.,w,abs(d.y-near)));
gl_FragColor=vec4(c,1.);}
#elif defined(CONSOLE)
/*
 * An afternoon as a 16-bit console drew one: the sky in flat bands that deepen overhead, a round sun brighter than
 * white, clouds each made of three round puffs with a flat grey foot, and two ranges of hills along the horizon.
 */
void main(){vec3 d=normalize(vP);float h=max(d.y,0.);float a=atan(d.z,d.x);
vec3 c=mix(uFog,vec3(.2,.46,.92),floor(clamp(h*1.5,0.,.999)*9.)/8.);
float facing=dot(d,${SUN});
c=mix(c,vec3(1.,.96,.74),step(.9955,facing)*.55);
c=mix(c,vec3(1.5,1.42,1.),step(.9978,facing));
if(d.y>.1&&d.y<.62){vec2 p=vec2(a*${(8 / Math.PI).toFixed(4)}+uTime*.004,d.y*8.);float id=mod(floor(p.x),16.);
vec2 q=vec2((fract(p.x)-.5)*2.4,p.y-(1.6+3.*h3(vec3(id,3.,2.))));
float puff=max(max(step(length(q),.42),step(length(q-vec2(-.5,-.1)),.3)),step(length(q-vec2(.52,-.08)),.34));
puff*=step(-.3,q.y)*step(.42,h3(vec3(id,7.,1.)));
c=mix(c,q.y<-.14?vec3(.8,.89,.98):vec3(1.),puff);}
c=mix(c,vec3(.5,.76,.74),step(d.y,.03+.02*sin(a*5.+1.)+.012*sin(a*11.+4.)));
c=mix(c,vec3(.36,.66,.44),step(d.y,.014+.014*sin(a*7.+2.5)+.007*sin(a*17.)));
gl_FragColor=vec4(c,1.);}
#elif defined(SHOOTER)
/*
 * A painted backdrop, as those games hung behind a level: dusk in flat bands, the buildings' colour low in the sky and
 * near black overhead, behind two ridges of bare rock.
 */
void main(){vec3 d=normalize(vP);float h=max(d.y,0.);float a=atan(d.z,d.x);
float band=floor(clamp(h*2.6,0.,.999)*10.)/9.;
vec3 c=mix(uGlow*.28+vec3(.16,.08,.06),vec3(.14,.07,.16),smoothstep(0.,.4,band));
c=mix(c,vec3(.025,.02,.045),smoothstep(.35,1.,band));
c=mix(c,vec3(.15,.08,.12),step(d.y,.03+.05*(1.-abs(sin(a*3.+1.)))+.022*(1.-abs(sin(a*8.+2.)))+.008*(1.-abs(sin(a*21.)))));
c=mix(c,uFog,step(d.y,.008+.034*(1.-abs(sin(a*5.+4.)))+.012*(1.-abs(sin(a*13.+1.)))));
gl_FragColor=vec4(c,1.);}
#else
void main(){vec3 d=normalize(vP);float h=max(d.y,0.);
vec3 c=mix(uFog,vec3(.03,.066,.125),smoothstep(0.,.17,h));
c=mix(c,vec3(.012,.018,.044),smoothstep(.1,.62,h));
c+=uGlow*.05*exp(-h*12.)+uGlow*.012*exp(-h*3.);
if(uDetail>0.){float band=1.-abs(dot(d,normalize(vec3(.42,.5,-.76))));
float core=pow(band,7.);
if(core>.002){float cloud=fbm(d*5.+3.);float lanes=fbm(d*11.);
float m=core*(.45+.9*cloud)*(1.-.75*smoothstep(.42,.7,lanes)*pow(band,16.))*smoothstep(0.,.3,h);
c+=vec3(.15,.14,.22)*m*.42*uDetail;}}
c+=dusk(d);
/*
 * A year's flight has an aurora: a band of light that waves along the sky, green below and violet above, in fine
 * upright rays. It fades out well above the horizon, because the night's ground lets the sky show through.
 */
if(uAurora>0.){float a=atan(d.z,d.x);
float wave=.16+.04*sin(a*3.+uTime*.06)+.025*sin(a*7.-uTime*.09);
float x=(h-wave)*9.;
float rays=.55+.45*sin(a*60.+3.*sin(a*5.+uTime*.15));
float glow=exp(-x*x)*rays*smoothstep(.05,.12,h);
c+=mix(vec3(.06,.5,.3),vec3(.32,.14,.48),smoothstep(-.02,.1,h-wave))*glow*.5*uAurora;}
float a=atan(d.z,d.x)*${around(520)};float col=floor(a);
float top=.004+.05*h3(vec3(floor(col/9.),4.,2.))*h3(vec3(floor(col/31.),1.,6.))*(.35+.65*h3(vec3(col,8.,3.)));
if(d.y<top&&d.y>-.002){vec2 w=vec2(fract(a),d.y*900.);
float lit=step(.9,h3(vec3(col,floor(w.y),5.)))*step(.2,w.x)*step(w.x,.8)*step(.35,fract(w.y));
c=mix(vec3(.016,.024,.036)+uGlow*.012,uGlow*.5+vec3(.2,.17,.1),lit*.8);}
gl_FragColor=vec4(c,1.);}
#endif`;

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
 * The rings: bands of ice and dust by distance from the planet, lit from the planet's light, and dimmer where the
 * planet's shadow falls across them. The shadow has a soft edge and leaves the ring a third as bright. With a hard edge
 * and an eighth, the ring looked as if it stopped short.
 */
export const RING_FRAGMENT = /* glsl */ `uniform float uInner,uOuter,uPlanet;varying vec3 vP;varying vec3 vW;
void main(){float t=(length(vP.xy)-uInner)/(uOuter-uInner);
float dens=.55+.25*sin(t*41.)+.2*sin(t*97.+2.)+.15*sin(t*13.);
dens*=smoothstep(0.,.06,t)*smoothstep(1.,.9,t)*(1.-.85*smoothstep(.6,.62,t)*smoothstep(.67,.65,t));
vec3 L=${PLANET_LIGHT};float behind=dot(vW,L);
float shade=behind<0.?mix(.34,1.,smoothstep(uPlanet*.86,uPlanet*1.14,length(vW-behind*L))):1.;
vec3 c=mix(vec3(.5,.42,.38),vec3(.78,.7,.6),.5+.5*sin(t*23.))*shade*.62;
gl_FragColor=vec4(c,clamp(dens,0.,1.)*.75);}`;

/** Lamps along the streets, small warm points that stay a few pixels across at any distance. */
export const LAMP_VERTEX = /* glsl */ `uniform float uPx;
void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(46./-mv.z,1.4,7.)*uPx;
gl_Position=projectionMatrix*mv;}`;

export const LAMP_FRAGMENT = /* glsl */ `void main(){float r=length(gl_PointCoord-.5)*2.;
gl_FragColor=vec4(vec3(1.,.62,.28)*smoothstep(1.,.1,r)*1.25,1.);}`;

/** The lights on the busiest towers: a red glow by night, and by day a small red block that blinks. */
export const BEACON_VERTEX = /* glsl */ `attribute float aDay,aPhase;uniform float uPlay,uRise,uMax,uTime,uPx;varying float vOn;
void main(){float g=aDay>uMax?1.:clamp((uPlay-aDay)/uRise,0.,1.);
vec4 mv=modelViewMatrix*vec4(position,1.);
vOn=step(1.,g)*(.22+.78*pow(clamp(.5+.5*sin(uTime*2.3+aPhase),0.,1.),5.));
#ifdef DAY
gl_PointSize=clamp(90./-mv.z,3.,10.)*uPx;
#else
gl_PointSize=clamp(220./-mv.z,5.,26.)*uPx;
#endif
gl_Position=projectionMatrix*mv;}`;

export const BEACON_FRAGMENT = /* glsl */ `varying float vOn;
void main(){
#ifdef DAY
gl_FragColor=vec4(mix(vec3(.6,.1,.08),vec3(1.4,.3,.2),clamp(vOn,0.,1.)),step(.01,vOn));
#else
float r=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,0.,r);
gl_FragColor=vec4(vec3(1.,.26,.17)*vOn*a*a*1.9,1.);
#endif
}`;

/** Traffic in the air lanes: points of light by night, and by day small solid squares, dark one way and orange the other. */
export const TRAFFIC_VERTEX = /* glsl */ `attribute vec3 aB;attribute float aRate,aPhase,aWarm;uniform float uTime,uPx;varying vec3 vC;
void main(){vec4 mv=viewMatrix*vec4(mix(position,aB,fract(aPhase+uTime*aRate)),1.);
#ifdef DAY
vC=mix(vec3(.2,.26,.34),vec3(.96,.5,.16),aWarm);
gl_PointSize=clamp(46./-mv.z,1.,7.)*uPx;
#else
vC=mix(vec3(.9,.95,1.),vec3(1.,.42,.16),aWarm);
gl_PointSize=clamp(60./-mv.z,.9,10.)*uPx;
#endif
gl_Position=projectionMatrix*mv;}`;

export const TRAFFIC_FRAGMENT = /* glsl */ `varying vec3 vC;
void main(){
#ifdef DAY
gl_FragColor=vec4(vC,.9);
#else
float r=length(gl_PointCoord-.5)*2.;float a=smoothstep(1.,.1,r);gl_FragColor=vec4(vC*a*1.5,1.);
#endif
}`;

/*
 * Specks in the air around the camera, which streak past at speed. In a year's flight they are snow instead: they fall
 * and drift, show at any speed, and each is a short white stroke.
 */
export const DUST_VERTEX = /* glsl */ `attribute float aEnd;uniform vec3 uCam,uVel;uniform float uTime,uSnow;varying float vA;
void main(){const float S=44.;
vec3 fall=vec3(sin(uTime*.4)*1.2,-uTime*2.2,cos(uTime*.3)*.8)*uSnow;
vec3 w=uCam+(fract(position+(fall-uCam)/S)-.5)*S;
vA=smoothstep(22.,7.,length(w-uCam))*max(clamp(length(uVel)/12.-.4,0.,1.),uSnow*.9);
w-=uVel*aEnd*.03*(1.-.7*uSnow);w.y-=aEnd*.18*uSnow;
gl_Position=projectionMatrix*viewMatrix*vec4(w,1.);}`;

/* By day the streaks are drawn over the view, where by night they are added to it, so their strength is in the alpha. */
export const DUST_FRAGMENT = /* glsl */ `uniform float uSnow;varying float vA;
void main(){
#ifdef DAY
gl_FragColor=vec4(vec3(1.),clamp(vA,0.,1.)*mix(.4,.8,uSnow));
#else
gl_FragColor=vec4(mix(vec3(.3,.36,.4),vec3(.7,.72,.75),uSnow)*vA,1.);
#endif
}`;

export const WARP_VERTEX = /* glsl */ `attribute float aEnd;uniform float uWarp,uTime;varying float vA;
void main(){const float L=1000.;float z=-L+mod(position.z*L+uTime*640.,L);
vA=uWarp*smoothstep(-L,-L*.55,z);
gl_Position=projectionMatrix*vec4(position.xy,z-aEnd*(8.+520.*uWarp*uWarp),1.);}`;

export const WARP_FRAGMENT = /* glsl */ `varying float vA;
void main(){
#ifdef DAY
gl_FragColor=vec4(vec3(1.),clamp(vA,0.,1.)*.85);
#else
gl_FragColor=vec4(vec3(.72,.85,1.)*vA*1.5,1.);
#endif
}`;

/**
 * What the ship's metal and glass reflect: night sky above with a moon highlight, a band of lit windows in the
 * buildings' colour around the horizon, and the street below.
 */
export const ENV_VERTEX = /* glsl */ `varying vec3 vP;
void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

export const ENV_FRAGMENT = /* glsl */ `uniform vec3 uGlow,uWindow;varying vec3 vP;
${HASH}
#ifdef DAY
/* By day the ship reflects a blue sky with the sun in it, a pale horizon, and ground tinted by the buildings on it. */
void main(){vec3 d=normalize(vP);float h=d.y;
vec3 c=mix(vec3(.82,.91,1.),vec3(.24,.5,.92),smoothstep(0.,.7,h));
float m=max(dot(d,normalize(vec3(-.5,.8,.6))),0.);
c+=vec3(1.,.95,.8)*pow(m,220.)*5.+vec3(1.,.9,.7)*pow(m,9.)*.22;
if(h<0.)c=mix(c,mix(vec3(.62,.57,.42),uGlow,.3),smoothstep(-.02,-.3,h));
gl_FragColor=vec4(c,1.);}
#else
void main(){vec3 d=normalize(vP);float h=d.y;
vec3 c=mix(vec3(.05,.085,.13),vec3(.012,.02,.045),smoothstep(0.,.6,h));
vec3 moon=normalize(vec3(-.5,.8,.6));float m=max(dot(d,moon),0.);
c+=vec3(.9,.95,1.)*pow(m,220.)*3.+vec3(.25,.3,.42)*pow(m,9.)*.3;
float band=smoothstep(.42,.02,h)*smoothstep(-.42,-.04,h);
vec2 g=vec2(atan(d.z,d.x)*34.,h*46.);vec2 f=fract(g);
float pane=step(.62,hash(floor(g)))*step(.2,f.x)*step(f.x,.8)*step(.25,f.y)*step(f.y,.75);
c+=(uGlow*.32+uWindow*pane*1.4)*band;
if(h<0.)c=mix(c,vec3(.012,.016,.024)+uGlow*.05,smoothstep(-.05,-.5,h));
gl_FragColor=vec4(c,1.);}
#endif`;

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
#ifdef DAY
size*=.42;
#endif
gl_PointSize=a>0.?clamp(size*1000./-mv.z,2.,200.)*uPx:0.;gl_Position=projectionMatrix*mv;}`;

/*
 * By day a spark is a square of solid colour, like confetti, fading out as it dies. The flash that lights a night sky
 * has nothing to add to a bright one, so it isn't drawn.
 */
export const FIREWORK_FRAGMENT = /* glsl */ `varying vec3 vC;varying float vA,vKind;
void main(){
#ifdef DAY
if(vKind>1.5)discard;
gl_FragColor=vec4(vC,clamp(vA*1.8,0.,1.));
#else
float r=length(gl_PointCoord-.5)*2.;
float a=vKind>1.5?pow(max(1.-r,0.),2.)*1.6:smoothstep(1.,.1,r);gl_FragColor=vec4(vC*vA*a*3.,1.);
#endif
}`;

export const FINISH_VERTEX = /* glsl */ `varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;

/**
 * The last pass: at speed the view streaks outward from the centre with colour fringes at the edges, then a vignette,
 * the jump's flash, the red of a collision, and a fine grain that stops the dark sky banding.
 *
 * A look with an old screen then cuts the frame down to it. `PIXELS` reads the frame in big squares, `uGrid` being one
 * square's size as a share of the view. A square takes four readings spread over it, so a tower a pixel wide dims
 * rather than flickering in and out as the view moves. While the view streaks at speed it takes two readings at each
 * of four steps along the streak, which costs what the eight single readings of the other looks do. `LEVELS` keeps
 * that many steps each of red, green and blue.
 * Nothing is dithered and no grain is laid over it, because both put noise inside the squares, and the vignette is left
 * off because those screens had none.
 */
export const FINISH_FRAGMENT = /* glsl */ `uniform sampler2D tDiffuse;uniform float uFlash,uRed,uSpeed,uTime,uGrain;uniform vec2 uGrid;varying vec2 vUv;
float grain(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
#ifdef PIXELS
vec2 at(vec2 uv){return (floor(uv/uGrid)+.5)*uGrid;}
vec3 still(vec2 uv){vec2 o=uGrid*.25;
return (texture2D(tDiffuse,uv+o).rgb+texture2D(tDiffuse,uv-o).rgb+texture2D(tDiffuse,uv+vec2(o.x,-o.y)).rgb+texture2D(tDiffuse,uv+vec2(-o.x,o.y)).rgb)*.25;}
vec3 streak(vec2 uv,vec2 reach){vec2 o=uGrid*.25;vec3 sum=vec3(0.);
for(int i=0;i<4;i++){vec2 p=at(uv-reach*float(i)/3.);sum+=texture2D(tDiffuse,p+o).rgb+texture2D(tDiffuse,p-o).rgb;}
return sum/8.;}
#else
vec2 at(vec2 uv){return uv;}
vec3 still(vec2 uv){return texture2D(tDiffuse,uv).rgb;}
vec3 streak(vec2 uv,vec2 reach){vec3 sum=vec3(0.);
for(int i=0;i<8;i++){sum+=texture2D(tDiffuse,uv-reach*float(i)/7.).rgb;}
return sum/8.;}
#endif
void main(){vec2 uv=at(vUv);vec2 q=uv-.5;float r=dot(q,q);vec3 c;
if(uSpeed>.001){c=streak(uv,q*uSpeed*.045);
vec2 fringe=q*uSpeed*.012;c.r=mix(c.r,texture2D(tDiffuse,at(uv+fringe)).r,.7);c.b=mix(c.b,texture2D(tDiffuse,at(uv-fringe)).b,.7);}
else c=still(uv);
#ifndef PIXELS
c*=1.-r*.85;
#endif
c=mix(c,vec3(.86,.93,1.),uFlash);c+=vec3(.75,.06,.03)*uRed*smoothstep(.06,.5,r);
#ifdef PIXELS
#ifdef LEVELS
c=floor(clamp(c,0.,1.)*float(LEVELS)+.5)/float(LEVELS);
#endif
#else
c+=(grain(gl_FragCoord.xy+fract(uTime*7.)*91.)-.5)*uGrain;
#endif
gl_FragColor=vec4(c,1.);}`;
