import * as THREE from 'three';

export type Emotion = 'neutral'|'happy'|'sad'|'angry'|'surprised'|'worried'|'thinking';
export interface CharacterProfile {
  id: string; name: string; gender: string; home: string;
  position: [number, number, number]; personality: string[]; interests: string[];
  speechStyle?: string;
  relationships: Record<string, string>;
  systemPrompt: string; sleepHour: number; staminaHours: number;
  defaultEmotion?: Emotion;
  appearance: { skin: string; hair: string; hairStyle: 'short'|'medium'|'long'; clothing: string; bottomColor?: string; style?: 'masculine'|'feminine'; glasses: boolean };
}

/** Creates a block-shaped character whose look is driven by its JSON profile. */
export class Npc {
  readonly group = new THREE.Group();
  readonly name: string;
  private phase = Math.random() * Math.PI * 2;
  private readonly legs: THREE.Group[] = [];
  private readonly arms: THREE.Group[] = [];
  private readonly eyes: THREE.Mesh[] = [];
  private readonly brows: THREE.Mesh[] = [];
  private mouth: THREE.Mesh | null = null;
  emotion: Emotion = 'neutral';
  private readonly origin: THREE.Vector3;
  private authoritativePosition=false;
  private targetPosition=new THREE.Vector2();
  constructor(readonly profile: CharacterProfile) {
    this.name = profile.name;
    this.group.position.set(...profile.position); this.origin = this.group.position.clone();
    const labelCanvas=document.createElement('canvas');labelCanvas.width=256;labelCanvas.height=70;
    const labelContext=labelCanvas.getContext('2d')!;
    labelContext.fillStyle='rgba(22,35,30,0.86)';labelContext.beginPath();labelContext.roundRect(12,8,232,52,12);labelContext.fill();
    labelContext.strokeStyle='rgba(216,232,204,0.7)';labelContext.lineWidth=2;labelContext.stroke();
    labelContext.fillStyle='#f5f5e8';labelContext.font='bold 34px sans-serif';labelContext.textAlign='center';labelContext.textBaseline='middle';labelContext.fillText(profile.name,128,34);
    const labelTexture=new THREE.CanvasTexture(labelCanvas);labelTexture.colorSpace=THREE.SRGBColorSpace;
    const nameplate=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture,transparent:true,depthTest:false}));
    nameplate.position.set(0,2.55,0);nameplate.scale.set(2.1,0.57,1);nameplate.renderOrder=30;this.group.add(nameplate);
    const feminine = profile.appearance.style === 'feminine';
    const mat = (color: string, roughness = 0.78) => new THREE.MeshStandardMaterial({ color, roughness });
    const softBox = (w:number,h:number,d:number,color:string,_r=0.055) => new THREE.Mesh(new THREE.BoxGeometry(w,h,d),mat(color));
    const put = (parent:THREE.Object3D,mesh:THREE.Object3D,x:number,y:number,z:number) => { mesh.position.set(x,y,z);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh; };
    const pants = profile.appearance.bottomColor ?? '#30383a';

    // A softly shaped torso, a visible collar, and short rounded sleeves.
    const torso = softBox(feminine?0.69:0.75,0.73,0.48,profile.appearance.clothing,0.09);
    put(this.group,torso,0,0.91,0);
    const collar = softBox(0.25,0.13,0.1,feminine?'#fff0e8':'#e6e8e3',0.035);
    put(this.group,collar,0,1.27,0.24);
    for(const side of [-1,1]) {
      const armGroup=new THREE.Group();armGroup.position.set(side*(feminine?0.42:0.45),1.12,0);this.group.add(armGroup);this.arms.push(armGroup);
      const sleeve=softBox(0.23,0.3,0.4,profile.appearance.clothing,0.075);
      put(armGroup,sleeve,0,-0.09,0);
      const arm=softBox(0.18,0.4,0.21,profile.appearance.skin,0.075);
      put(armGroup,arm,0,-0.42,0.015);
      const hand=new THREE.Mesh(new THREE.BoxGeometry(0.19,0.19,0.19),mat(profile.appearance.skin));
      put(armGroup,hand,0,-0.65,0.03);
    }
    for(const x of [-0.2,0.2]) {
      const leg=new THREE.Group(); leg.position.set(x,0.22,0);this.group.add(leg);this.legs.push(leg);
      put(leg,softBox(0.22,0.43,0.25,pants,0.055),0,0.015,0);
      put(leg,softBox(0.25,0.14,0.36,'#eee9e1',0.055),0,-0.19,0.055);
    }

    // Head and neck have gentle corners, keeping the familiar block-world style.
    put(this.group,softBox(0.17,0.19,0.18,profile.appearance.skin,0.045),0,1.31,0.015);
    const head=softBox(feminine?0.66:0.7,0.65,0.61,profile.appearance.skin,0.105);
    put(this.group,head,0,1.67,0.015);
    const hairMat=mat(profile.appearance.hair);
    const hair=(w:number,h:number,d:number,x:number,y:number,z:number,rz=0)=>{
      const piece=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),hairMat);
      piece.position.set(x,y,z);piece.rotation.z=rz;piece.castShadow=true;piece.receiveShadow=true;this.group.add(piece);return piece;
    };
    // Rounded cap, shaped fringe, and layered side/back locks replace the old square helmet.
    hair(0.76,0.22,0.69,0,2.0,-0.005);
    if(feminine) {
      hair(0.23,0.19,0.19,-0.2,1.91,0.29,-0.28);
      hair(0.23,0.19,0.19,0.04,1.94,0.31,0.04);
      hair(0.23,0.19,0.19,0.25,1.9,0.29,0.27);
      const long=profile.appearance.hairStyle==='long';
      // A layered rear curtain with tapered-looking rounded strands and a soft silhouette.
      hair(0.64,long?0.94:0.55,0.23,0, long?1.42:1.62,-0.27);
      for(const side of [-1,1]) {
        hair(0.19,long?0.95:0.58,0.3,side*0.3,long?1.48:1.63,-0.08,side*-0.035);
        hair(0.14,long?0.76:0.42,0.2,side*0.36,long?1.57:1.68,0.02,side*0.08);
      }
      // A slim hairband/detail helps the chestnut style read as a designed hairstyle.
      if(profile.appearance.hairStyle==='medium') {
        hair(0.36,0.055,0.71,0,2.015,0.005);
      }
    } else {
      hair(0.35,0.13,0.22,-0.17,1.91,0.28,-0.16);
      hair(0.31,0.12,0.2,0.14,1.92,0.29,0.12);
      hair(0.15,0.23,0.22,-0.34,1.79,0.03);
      hair(0.15,0.23,0.22,0.34,1.79,0.03);
    }

    // Expressive eyes, eyebrows and a small nose remain visible from the game's high camera.
    const eyeMat=mat('#263436',0.42);
    for(const x of [-0.155,0.155]) {
      const eye=new THREE.Mesh(new THREE.BoxGeometry(0.085,0.085,0.045),eyeMat);put(this.group,eye,x,1.68,0.325);this.eyes.push(eye);
      const brow=softBox(0.14,0.035,0.04,profile.appearance.hair,0.015);put(this.group,brow,x,1.79,0.329);this.brows.push(brow);
      const glint=new THREE.Mesh(new THREE.BoxGeometry(0.022,0.022,0.012),new THREE.MeshBasicMaterial({color:'#fffaf0'}));put(this.group,glint,x-0.012,1.696,0.37);
    }
    const nose=softBox(0.075,0.08,0.075,profile.appearance.skin,0.025);put(this.group,nose,0,1.57,0.35);
    this.setEmotion(profile.defaultEmotion ?? 'neutral');
    if(profile.appearance.glasses) {
      const frame=mat('#252b2d',0.35),lensMat=new THREE.MeshStandardMaterial({color:'#c8e0dc',transparent:true,opacity:0.35,roughness:0.18,metalness:0.1});
      for(const x of [-0.155,0.155]) {
        const lens=new THREE.Mesh(new THREE.BoxGeometry(0.235,0.18,0.035),lensMat);put(this.group,lens,x,1.69,0.379);
        for(const [w,h,px,py] of [[0.235,0.035,x,1.78],[0.235,0.035,x,1.6],[0.035,0.18,x-0.1,1.69],[0.035,0.18,x+0.1,1.69]] as [number,number,number,number][]) {
          const rim=softBox(w,h,0.045,'#252b2d',0.012);put(this.group,rim,px,py,0.408);
        }
      }
      const bridge=softBox(0.12,0.03,0.04,'#252b2d',0.012);put(this.group,bridge,0,1.7,0.414);
      for(const side of [-1,1]){const arm=softBox(0.24,0.035,0.035,'#252b2d',0.012);put(this.group,arm,side*0.33,1.7,0.28);}
    }
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(0.48,24),new THREE.MeshBasicMaterial({color:'#314c45',transparent:true,opacity:0.16}));
    shadow.rotation.x=-Math.PI/2;shadow.position.y=0.015;this.group.add(shadow);
  }
  /** Switches the face between the built-in, profile-independent expressions. */
  setEmotion(emotion:Emotion) {
    this.emotion=emotion;
    for(const eye of this.eyes) eye.scale.y=emotion==='happy'?0.52:emotion==='surprised'?1.3:1;
    const browAngle=emotion==='angry'?0.32:emotion==='sad'||emotion==='worried'?0.2:emotion==='thinking'?0.12:0;
    this.brows[0].rotation.z=browAngle;this.brows[1].rotation.z=-browAngle;
    if(this.mouth) {
      this.group.remove(this.mouth);this.mouth.geometry.dispose();
      const material=this.mouth.material;if(Array.isArray(material))material.forEach(item=>item.dispose());else material.dispose();
    }
    const material=new THREE.MeshStandardMaterial({color:'#8b5d50',roughness:0.72});
    if(emotion==='surprised') {
      this.mouth=new THREE.Mesh(new THREE.SphereGeometry(0.045,12,10),material);
      this.mouth.scale.set(0.72,1.3,0.45);this.mouth.position.set(0,1.47,0.354);
    } else {
      const centerY=emotion==='happy'?1.43:emotion==='sad'||emotion==='worried'?1.51:emotion==='angry'?1.49:emotion==='thinking'?1.46:1.45;
      const curve=new THREE.QuadraticBezierCurve3(new THREE.Vector3(-0.072,1.48,0.35),new THREE.Vector3(0,centerY,0.36),new THREE.Vector3(0.072,1.48,0.35));
      this.mouth=new THREE.Mesh(new THREE.TubeGeometry(curve,10,0.012,5,false),material);
    }
    this.group.add(this.mouth);
  }
  setServerState(x:number,z:number,emotion:string) {
    if(Number.isFinite(x)&&Number.isFinite(z)) {
      // The persisted server position is authoritative on the first sync; do not animate
      // from the profile's spawn point after a browser refresh.
      if(!this.authoritativePosition)this.group.position.set(x,this.group.position.y,z);
      this.authoritativePosition=true;this.targetPosition.set(x,z);
    }
    if(EMOTIONS.includes(emotion as Emotion)&&this.emotion!==emotion)this.setEmotion(emotion as Emotion);
  }
  update(dt:number) {
    const distance=this.authoritativePosition?Math.hypot(this.targetPosition.x-this.group.position.x,this.targetPosition.y-this.group.position.z):1;
    const moving=distance>0.015;
    this.phase+=dt*(moving?8:2);
    if(this.authoritativePosition) {
      const dx=this.targetPosition.x-this.group.position.x,dz=this.targetPosition.y-this.group.position.z,step=0.92*dt;
      if(distance>0.01){this.group.position.x+=dx/distance*Math.min(step,distance);this.group.position.z+=dz/distance*Math.min(step,distance);this.group.rotation.y=Math.atan2(dx,dz);}
    } else {
      this.group.position.x=this.origin.x+Math.sin(this.phase*0.37)*1.4;
      this.group.position.z=this.origin.z+Math.cos(this.phase*0.29)*1.15;
      this.group.rotation.y=Math.atan2(Math.cos(this.phase*0.37),-Math.sin(this.phase*0.29));
    }
    const step=moving?Math.sin(this.phase)*0.34:0;
    this.legs[0].rotation.x=step;this.legs[1].rotation.x=-step;
    this.arms[0].rotation.x=-step*0.75;this.arms[1].rotation.x=step*0.75;
    this.group.position.y=moving?Math.max(0,Math.sin(this.phase*2))*0.035:0;
  }
}

const EMOTIONS:Emotion[]=['neutral','happy','sad','angry','surprised','worried','thinking'];
