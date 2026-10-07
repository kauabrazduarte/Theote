import * as THREE from 'three';
import { Npc, type CharacterProfile } from '@theote/npcs';
import profiles from '@theote/npcs/data/characters.json';
import houses from '@theote/npcs/data/houses.json';
import { CHAINED_GOBLIN, EXPLORE_SITES, FENCES, MARKET_STALL, ORCHARD_SPOTS, POND, TREE_SPOTS, WELL, WATER_WHEEL, WORLD_HALF_SIZE } from '@theote/npcs/worldLayout';
import { isWalkable } from '@theote/npcs/navigation';
import { ANIMALS, animalPosition, isBird, type AnimalSpec } from '@theote/npcs/animals';
import { secondsPerWorldHour } from '@theote/npcs/worldClock';
import { groundTexture, stoneTexture } from './materials';

const GOBLIN_PATROLS:[number,number][]=[[-38,-25],[38,-13],[-39,10],[20,38],[4,-39],[-38,-3],[39,5],[-21,39],[39,24],[-38,27],[-9,-38],[38,-27],[13,38],[-39,-28],[-3,39],[30,37]];

export class World {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly npcs: Npc[];
  private clock = new THREE.Clock();
  private frame = 0;
  private resizeObserver: ResizeObserver;
  private readonly element: HTMLElement;
  private target = new THREE.Vector3(0, 0, 0);
  private skyColor = new THREE.Color('#dce9e1');
  private skyNight = new THREE.Color('#263a50');
  private skyDay = new THREE.Color('#dce9e1');
  private sunDay = new THREE.Color('#fff2d4');
  private skyDawn = new THREE.Color('#e9ac83');
  private dayPhase = 0;
  private hemisphere!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private readonly onZoom?: (zoom:number) => void;
  private readonly onNpcClick?: (id:string) => void;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly animals:Array<{spec:AnimalSpec;group:THREE.Group;wings:[THREE.Group,THREE.Group]|null}>=[];
  private worldElapsed=0;
  private readonly goblins: THREE.Group[] = [];
  private readonly nightLights: Array<{light:THREE.PointLight;bulb:THREE.MeshStandardMaterial}> = [];
  private waterWheel: THREE.Group | null = null;
  private pointerDown: {id:number;x:number;y:number;world:THREE.Vector3}|null=null;
  private readonly groundPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);
  private readonly onResize = () => this.resize();
  private readonly onWheel = (event: WheelEvent) => {
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1), 0.72, 1.8);
    this.camera.updateProjectionMatrix();
    this.onZoom?.(this.camera.zoom);
  };
  private readonly onKeyDown = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const directions: Record<string, [number, number]> = { w: [0,-1], s: [0,1], a: [-1,0], d: [1,0], arrowup: [0,-1], arrowdown: [0,1], arrowleft: [-1,0], arrowright: [1,0] };
    const direction = directions[key];
    if (!direction || (event.target instanceof HTMLElement && /input|textarea|select/i.test(event.target.tagName))) return;
    event.preventDefault(); this.pan(direction[0] * 1.2, direction[1] * 1.2);
  };
  private groundAt(event:PointerEvent) {
    const rect=this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    return this.raycaster.ray.intersectPlane(this.groundPlane,new THREE.Vector3());
  }
  private readonly onPointerDown = (event: PointerEvent) => {
    if(event.button!==0)return;
    const world=this.groundAt(event);if(!world)return;
    this.pointerDown={id:event.pointerId,x:event.clientX,y:event.clientY,world};
    this.renderer.domElement.setPointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor='grabbing';
  };
  private readonly onPointerMove = (event: PointerEvent) => {
    if(!this.pointerDown||this.pointerDown.id!==event.pointerId)return;
    const world=this.groundAt(event);
    if(world)this.pan(this.pointerDown.world.x-world.x,this.pointerDown.world.z-world.z);
  };
  private readonly onPointerUp = (event:PointerEvent) => {
    if(!this.pointerDown||this.pointerDown.id!==event.pointerId)return;
    if(this.pointerDown&&Math.hypot(event.clientX-this.pointerDown.x,event.clientY-this.pointerDown.y)<5&&this.onNpcClick){
      const rect=this.renderer.domElement.getBoundingClientRect();
      this.pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
      this.raycaster.setFromCamera(this.pointer,this.camera);
      const hits=this.raycaster.intersectObjects(this.npcs.map(npc=>npc.group),true);
      const selected=this.npcs.find(npc=>hits.some(hit=>{let object:THREE.Object3D|null=hit.object;while(object){if(object===npc.group)return true;object=object.parent;}return false;}));
      if(selected)this.onNpcClick(selected.profile.id);
    }
    this.pointerDown=null;
    if(this.renderer.domElement.hasPointerCapture(event.pointerId))this.renderer.domElement.releasePointerCapture(event.pointerId);
    this.renderer.domElement.style.cursor='grab';
  };
  private readonly onPointerCancel=(event:PointerEvent)=>{if(this.pointerDown?.id===event.pointerId){this.pointerDown=null;this.renderer.domElement.style.cursor='grab';}};
  constructor(element: HTMLElement, onZoom?: (zoom:number)=>void, onNpcClick?: (id:string)=>void) {
    this.element = element;
    this.onZoom = onZoom;
    this.onNpcClick=onNpcClick;
    this.camera = new THREE.OrthographicCamera(-13, 13, 13, -13, 0.1, 180);
    this.camera.zoom = 0.76;
    this.target.set(0,0,-1.5);
    this.camera.position.set(19, 58, 22.5); this.camera.lookAt(this.target);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.96;
    element.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.cursor = 'grab';
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerCancel);
    window.addEventListener('keydown', this.onKeyDown);
    this.scene.background = this.skyColor; this.scene.fog = new THREE.Fog('#dce9e1', 95, 160);
    this.hemisphere = new THREE.HemisphereLight('#e4e6db', '#4b5749', 1.45);this.scene.add(this.hemisphere);
    this.sun = new THREE.DirectionalLight('#fff0ce', 2.2); this.sun.position.set(-12, 24, 8); this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.camera.left = -43; this.sun.shadow.camera.right = 43; this.sun.shadow.camera.top = 43; this.sun.shadow.camera.bottom = -43;
    this.sun.shadow.bias = -0.0004; this.scene.add(this.sun);
    this.makeIsland(); this.makeWalls(); this.makeOuterForest(); this.makeTrees(); this.makeHomes(); this.makeFarm(); this.makeDetails(); this.makeExplorationSites(); this.makeWildlife();
    this.npcs = (profiles as unknown as CharacterProfile[]).map(profile => new Npc(profile));
    this.npcs.forEach(npc => this.scene.add(npc.group));
    this.resizeObserver = new ResizeObserver(this.onResize); this.resizeObserver.observe(element);
    element.addEventListener('wheel', this.onWheel, { passive: true }); this.resize(); this.animate();
  }
  private box(parent: THREE.Object3D, w: number, h: number, d: number, color: string, x: number, y: number, z: number, cast = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    mesh.position.set(x, y, z); mesh.castShadow = cast; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  private makeIsland() {
    const outerGrass=groundTexture();outerGrass.repeat.set(74,74);
    const outside=new THREE.Mesh(new THREE.PlaneGeometry(220,220),new THREE.MeshStandardMaterial({map:outerGrass,color:'#7c916d',roughness:1}));
    outside.rotation.x=-Math.PI/2;outside.position.y=-2.25;outside.receiveShadow=true;this.scene.add(outside);
    const bedrock=this.box(this.scene,WORLD_HALF_SIZE*2,1.8,WORLD_HALF_SIZE*2,'#666960',0,-1.05,0,false);
    bedrock.material=new THREE.MeshStandardMaterial({map:stoneTexture(),color:'#b9b7a9',roughness:1});
    const ground=this.box(this.scene,WORLD_HALF_SIZE*2-0.3,0.18,WORLD_HALF_SIZE*2-0.3,'#6e8055',0,0.03,0,false);
    ground.material=new THREE.MeshStandardMaterial({map:groundTexture(),roughness:1});ground.receiveShadow=true;
    const trail=new THREE.MeshStandardMaterial({color:'#dbd9cb',map:stoneTexture(),roughness:1});
    const path=(ax:number,az:number,bx:number,bz:number,width:number)=>{
      const dx=bx-ax,dz=bz-az,length=Math.hypot(dx,dz);
      const slab=new THREE.Mesh(new THREE.BoxGeometry(width,0.07,length),trail);
      slab.position.set((ax+bx)/2,0.16,(az+bz)/2);slab.rotation.y=Math.atan2(dx,dz);slab.receiveShadow=true;this.scene.add(slab);
      const count=Math.floor(length/0.8);
      for(let i=0;i<count;i++){
        const t=(i+0.5)/count;
        const edgeX=ax+dx*t,edgeZ=az+dz*t;
        const chip=this.box(this.scene,0.14+(i%3)*0.04,0.05,0.17,'#a8a99a',edgeX+Math.cos(slab.rotation.y)*width*0.52,0.18,edgeZ-Math.sin(slab.rotation.y)*width*0.52,false);
        chip.rotation.y=i*0.7;
      }
    };
    const route=(points:[number,number][],width=1.05)=>{for(let i=1;i<points.length;i++)path(...points[i-1],...points[i],width);};
    // Two residential lanes connect at the square; the western lakeside road
    // stays outside the water and meets its shore at a separate spur.
    route([[-23,-5.1],[-23,-2],[-21,-2],[-8,-2],[-5,0],[0,0]],1.15);
    route([[-10,-5.1],[-10,-3],[-8,-2]],1.05);
    route([[0,0],[6,0],[10,-3],[10,-5.1]],1.15);
    route([[6,0],[16,-3],[16,-5.1],[22,-5.1]],1.05);
    route([[-10,13.1],[-16,13.1],[-20,10],[-21,6],[-21,-2]],1.0);
    route([[10,13.1],[16,13.1],[22,13.1]],1.05);
    route([[16,13.1],[16,5],[6,0]],1.0);
    route([[0,0],[-5,-5],[-5,-11.2],[-5,-20],[-5,-25]],0.95);
    route([[-5,-11.2],[0.5,-11.2]],0.8);
    route([[16,-5.1],[16,-18.1]],0.9);
    route([[-23,-2],[-27,-14],[-26,-25]],0.85);
    route([[-21,6],[-26,9]],0.85);
    route([[-16,13.1],[-18,19],[-19.7,23.8]],0.85);
    route([[16,13.1],[16,20],[2,25]],0.85);
    route([[16,20],[24,24]],0.85);
    const square=this.box(this.scene,7.2,0.07,7.2,'#b5ae98',0,0.21,0,false);
    square.material=new THREE.MeshStandardMaterial({map:stoneTexture(),color:'#bdbbaa',roughness:1});
    const rockColors=['#81877c','#93998a','#666f66'];
    for(let i=0;i<75;i++){
      const x=((i*137)%605)/10-30.2,z=((i*89)%599)/10-29.9;
      if(!isWalkable(x,z)||Math.hypot(x,z)<4.5)continue;
      const size=0.12+(i%5)*0.045;
      const rock=this.box(this.scene,size,0.08+size*0.28,size*0.76,rockColors[i%3],x,0.17,z,false);
      rock.rotation.y=i*1.73;
    }
  }
  private makeWalls() {
    const edge=WORLD_HALF_SIZE-0.55;
    const masonry=new THREE.MeshStandardMaterial({map:stoneTexture(),color:'#c0c3b8',roughness:1});
    const cap=new THREE.MeshStandardMaterial({color:'#adb1a6',roughness:1});
    const wall=(x:number,z:number,w:number,d:number)=>{
      const height=9.6;
      const body=this.box(this.scene,w,height,d,'#858b80',x,height/2,z,false);
      body.material=masonry;body.receiveShadow=true;
      const ledge=this.box(this.scene,w+0.36,0.35,d+0.36,'#858a80',x,height+0.02,z,false);ledge.material=cap;
      const horizontal=w>d,length=horizontal?w:d;
      for(let p=-length/2+0.75;p<length/2-0.2;p+=1.35){
        const merlon=this.box(this.scene,horizontal?0.8:w+0.2,0.92,horizontal?d+0.2:0.8,'#b5b8ac',x+(horizontal?p:0),height+0.65,z+(horizontal?0:p),false);
        merlon.material=cap;
      }
      for(let p=-length/2+3.7;p<length/2-2.2;p+=6.2){
        const support=this.box(this.scene,horizontal?1.15:2.0,height,horizontal?2.0:1.15,'#727970',x+(horizontal?p:0),height/2,z+(horizontal?0:p),false);
        support.material=masonry;
        this.box(this.scene,horizontal?1.45:2.3,0.4,horizontal?2.3:1.45,'#a4a99e',support.position.x,height+0.15,support.position.z,false);
      }
    };
    const span=edge*2;
    wall(0,-edge,span,1.45);wall(0,edge,span,1.45);
    wall(-edge,0,1.45,span);wall(edge,0,1.45,span);
    for(const x of [-edge,edge])for(const z of [-edge,edge]){
      const height=11.3;
      const tower=this.box(this.scene,3.5,height,3.5,'#7b8179',x,height/2,z,false);tower.material=masonry;
      this.box(this.scene,3.9,0.43,3.9,'#afb3a8',x,height+0.05,z,false);
      for(const dx of [-1.4,0,1.4])for(const dz of [-1.4,0,1.4]){
        if(dx===0&&dz===0)continue;
        this.box(this.scene,0.68,0.95,0.68,'#b7baaf',x+dx,height+0.74,z+dz,false);
      }
    }
    for(const x of [-9,9]){
      this.box(this.scene,1.55,0.1,0.22,'#5e4733',x,8.25,-edge+0.86,false);
      this.box(this.scene,1.24,2.35,0.08,'#873c35',x,7.02,-edge+0.88,false);
      const crest=this.box(this.scene,0.55,0.55,0.1,'#d0ae66',x,7.36,-edge+0.96,false);
      crest.rotation.z=Math.PI/4;
    }
    const goblin=(x:number,z:number,index:number)=>{
      const creature=new THREE.Group();creature.position.set(x,-2.12,z);
      this.box(creature,0.48,0.72,0.37,'#4a7650',0,0.66,0);
      this.box(creature,0.64,0.55,0.5,'#688d54',0,1.23,0);
      for(const side of [-1,1]){
        this.box(creature,0.17,0.24,0.17,'#496a45',side*0.18,0.17,0);
        this.box(creature,0.17,0.25,0.11,'#728d58',side*0.39,1.26,0);
        this.box(creature,0.095,0.095,0.05,'#f4dc7f',side*0.18,1.29,0.27,false);
      }
      const hood=this.box(creature,0.75,0.2,0.6,index%2?'#463d37':'#57483c',0,1.56,-0.04);hood.rotation.z=index%2?0.15:-0.12;
      this.scene.add(creature);this.goblins.push(creature);
    };
    GOBLIN_PATROLS.forEach(([x,z],index)=>goblin(x,z,index));
  }
  private makeOuterForest() {
    const spots:[number,number][]=[[-43,-35],[-45,-12],[-40,11],[-44,35],[-30,-44],[-8,-42],[10,-43],[39,-42],[45,-27],[44,-5],[42,19],[45,39],[29,43],[8,43],[-12,44],[-36,41],[-47,3],[47,7]];
    const trunk=new THREE.MeshStandardMaterial({color:'#514b36',roughness:1});
    const foliage=['#36573c','#456a47','#2d4d36'].map(color=>new THREE.MeshStandardMaterial({color,roughness:1}));
    spots.forEach(([x,z],index)=>{
      const scale=0.85+(index%5)*0.16;
      const tree=new THREE.Group();tree.position.set(x,-2.2,z);tree.scale.setScalar(scale);
      const bole=new THREE.Mesh(new THREE.BoxGeometry(0.78,5.5,0.78),trunk);bole.position.y=2.75;bole.castShadow=true;tree.add(bole);
      for(let level=0;level<3;level++){
        const width=4.3-level*0.82;
        const crown=new THREE.Mesh(new THREE.BoxGeometry(width,1.48,width),foliage[(index+level)%foliage.length]);
        crown.position.y=4.3+level*1.23;crown.castShadow=true;crown.receiveShadow=true;tree.add(crown);
      }
      const tip=new THREE.Mesh(new THREE.BoxGeometry(1.18,1.1,1.18),foliage[index%foliage.length]);tip.position.y=8.05;tip.castShadow=true;tree.add(tip);
      this.scene.add(tree);
    });
  }
  private makeTrees() {
    const spots=TREE_SPOTS;
    spots.forEach(([x,z,s],i) => {
      const tree = new THREE.Group(); tree.position.set(x,0,z); tree.scale.setScalar(s);
      const trunk=new THREE.Mesh(new THREE.BoxGeometry(0.34,1.42,0.34),new THREE.MeshStandardMaterial({color:'#76583e',roughness:1}));trunk.position.y=0.7;trunk.castShadow=true;tree.add(trunk);
      const greens=['#477c50','#578c58','#689b60'];
      for(let cluster=0;cluster<5;cluster++){
        const crown=new THREE.Mesh(new THREE.BoxGeometry(1.25,0.73,1.2),new THREE.MeshStandardMaterial({color:greens[(i+cluster)%greens.length],roughness:1}));
        crown.position.set(Math.cos(cluster*2.51)*0.47,1.55+(cluster===0?0.4:0),Math.sin(cluster*2.51)*0.43);crown.scale.set(1,0.84,1);crown.castShadow=true;crown.receiveShadow=true;tree.add(crown);
      }
      this.scene.add(tree);
    });
    // Rounded hedge clumps soften the island edge without blocking the view into the village.
    [[-16,-7],[-17,2],[16,-10],[17,6],[-15,12],[15,14]].forEach(([x,z],i)=> {
      for(let part=0;part<3;part++){
        const bush=new THREE.Mesh(new THREE.SphereGeometry(0.43,10,8),new THREE.MeshStandardMaterial({color:i%2?'#6da475':'#78ae7e',roughness:1}));
        bush.position.set(x+(part-1)*0.38,0.28,z+(part%2)*0.12);bush.scale.y=0.75;bush.castShadow=true;this.scene.add(bush);
      }
    });
  }
  private makeHomes() {
    const home=(x:number,z:number,number:string,walls:string)=>{
      const width=6.2,depth=5.7,wallH=2.7,wallY=1.43;
      const floor=this.box(this.scene,width-0.18,0.16,depth-0.18,'#8e7051',x,0.12,z,false);floor.material=new THREE.MeshStandardMaterial({color:'#8e7051',roughness:1});
      this.box(this.scene,width+0.3,0.28,depth+0.3,'#777d75',x,0.03,z,false);
      for(let row=0;row<11;row++)this.box(this.scene,width-0.42,0.025,0.46,row%3===0?'#b18b60':'#a67f58',x,0.215,z-depth/2+0.34+row*0.49,false);
      const wallMat=new THREE.MeshStandardMaterial({map:stoneTexture(),color:walls,roughness:1,transparent:true,opacity:0.39,depthWrite:false,side:THREE.DoubleSide});
      const addWall=(w:number,h:number,d:number,px:number,py:number,pz:number)=>{const wall=this.box(this.scene,w,h,d,walls,px,py,pz,false);wall.material=wallMat.clone();wall.renderOrder=2;wall.receiveShadow=false;};
      addWall(width,wallH,0.16,x,wallY,z-depth/2);
      addWall(0.16,wallH,depth,x-width/2,wallY,z);addWall(0.16,wallH,depth,x+width/2,wallY,z);
      addWall(2.45,wallH,0.16,x-1.86,wallY,z+depth/2);addWall(2.45,wallH,0.16,x+1.86,wallY,z+depth/2);
      for(const dx of [-width/2,width/2])for(const dz of [-depth/2,depth/2]){
        const pillar=this.box(this.scene,0.38,wallH,0.38,'#858b80',x+dx,wallY,z+dz,false);
        pillar.material=new THREE.MeshStandardMaterial({color:'#665444',roughness:1,transparent:true,opacity:0.58,depthWrite:false});
      }
      // Roofs are omitted so the separate rooms and each resident's bed remain visible from above.
      // Interior divider creates a quiet bedroom and a living / kitchen room.
      addWall(0.13,2.3,2.45,x-0.25,1.23,z-1.6);addWall(0.13,2.3,0.72,x-0.25,1.23,z+0.78);
      const front=z+depth/2;
      const porch=this.box(this.scene,1.95,0.15,0.92,number==='1'?'#ad845c':'#b28d61',x,0.16,front+0.38,false);porch.material=new THREE.MeshStandardMaterial({color:number==='1'?'#ad845c':'#b28d61',roughness:0.92});
      this.box(this.scene,1.95,0.1,0.38,'#c3a173',x,0.09,front+0.99,false);
      // A real open leaf leaves a clear passage for residents walking into the room.
      for(const dx of [-0.68,0.68])this.box(this.scene,0.14,1.85,0.18,'#78583d',x+dx,0.94,front,false);
      this.box(this.scene,1.5,0.16,0.19,'#78583d',x,1.79,front,false);
      const leaf=new THREE.Group();leaf.position.set(x-0.61,0.82,front-0.07);leaf.rotation.y=0.82;const panel=this.box(leaf,1.1,1.52,0.12,'#8b6442',0.55,0,0,false);panel.material=new THREE.MeshStandardMaterial({color:'#8b6442',roughness:0.9});this.scene.add(leaf);
      const bed=(bx:number,bz:number,blanket:string)=>{
        this.box(this.scene,1.55,0.25,0.86,'#8d674b',bx,0.34,bz);
        this.box(this.scene,1.47,0.25,0.78,blanket,bx,0.57,bz+0.025);
        this.box(this.scene,0.53,0.12,0.58,'#f4ead8',bx,0.75,bz-0.06);
        this.box(this.scene,1.66,0.18,0.11,'#805d45',bx,0.78,bz-0.48);
      };
      const blankets:Record<string,string>={'1':'#71899a','2':'#a8868e','3':'#9e7782','4':'#728f85'};
      bed(x-1.85,z-1.5,blankets[number]??'#71899a');
      // A low counter, cupboards and dining table make the main room legible at a glance.
      this.box(this.scene,1.65,0.68,0.5,'#967356',x+1.95,0.52,z-2.05);
      this.box(this.scene,1.72,0.12,0.57,'#e3d1ab',x+1.95,0.92,z-2.05);
      this.box(this.scene,0.92,0.56,0.82,'#967356',x+1.72,0.4,z+0.42);
      for(const sx of [-0.48,0.48])this.box(this.scene,0.13,0.45,0.13,'#795a43',x+1.72+sx,0.22,z+0.42);
      this.box(this.scene,0.54,0.46,0.46,'#d2b18a',x+1.15,0.38,z-2.1);
      const windowMat=new THREE.MeshStandardMaterial({color:'#bde1dc',emissive:'#659e91',emissiveIntensity:0.22,transparent:true,opacity:0.82});
      for(const wx of [-2.2,2.2]) { const w=new THREE.Mesh(new THREE.BoxGeometry(0.64,0.68,0.08),windowMat); w.position.set(x+wx,1.72,z+depth/2-0.055); this.scene.add(w); }
      const path=new THREE.Mesh(new THREE.BoxGeometry(1.3,0.04,3.4),new THREE.MeshStandardMaterial({color:'#d1ba8a',roughness:1})); path.position.set(x,0.08,z+depth/2+1.65); this.scene.add(path);
      const sign=this.box(this.scene,0.8,0.65,0.12,'#f3e8cb',x+3.15,1.45,z+1.5);
      const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#f3e8cb';ctx.fillRect(0,0,128,128);ctx.fillStyle='#49644e';ctx.font='bold 74px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(number,64,68);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;sign.material=new THREE.MeshStandardMaterial({map:texture});
    };
    for(const house of houses)home(house.center[0],house.center[1],house.number,house.wall);
  }
  private makeFarm() {
    const mat=(color:string,roughness=0.94)=>new THREE.MeshStandardMaterial({color,roughness});
    const sphere=(parent:THREE.Object3D,color:string,pos:[number,number,number],scale:[number,number,number],cast=true)=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,14,10),mat(color));mesh.position.set(...pos);mesh.scale.set(...scale);mesh.castShadow=cast;mesh.receiveShadow=true;parent.add(mesh);return mesh;
    };
    const fence=(x:number,z:number,w:number,d:number,color='#806544')=>{
      const postMat=mat(color),railMat=mat('#a9895f');
      for(const side of [-1,1])for(let i=0;i<=Math.ceil((side===-1?w:d)/1.7);i++){
        const along=i*1.7-(side===-1?w:d)/2;
        const px=side===-1?x+along:x+side*w/2,pz=side===-1?z+side*d/2:z+along;
        const post=new THREE.Mesh(new THREE.BoxGeometry(0.14,0.72,0.14),postMat);post.position.set(px,0.36,pz);post.castShadow=true;this.scene.add(post);
      }
      for(const side of [-1,1])for(const y of [0.3,0.56]){
        if(side===1){for(const gateSide of [-1,1]){const segment=(w-1.05)/2;const horizontal=new THREE.Mesh(new THREE.BoxGeometry(segment,0.09,0.1),railMat);horizontal.position.set(x+gateSide*(0.525+segment/2),y,z+d/2);this.scene.add(horizontal);}}
        else {const horizontal=new THREE.Mesh(new THREE.BoxGeometry(w,0.09,0.1),railMat);horizontal.position.set(x,y,z+side*d/2);this.scene.add(horizontal);}
        const vertical=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.09,d),railMat);vertical.position.set(x+side*w/2,y,z);this.scene.add(vertical);
      }
    };
    // A roofed stone well makes the path junction feel like the village green.
    const well=new THREE.Group();well.position.set(WELL.x,0,WELL.z);
    const stone=mat('#9d9277');const base=new THREE.Mesh(new THREE.CylinderGeometry(0.72,0.82,0.65,12),stone);base.position.y=0.35;base.castShadow=true;well.add(base);
    const water=new THREE.Mesh(new THREE.CircleGeometry(0.55,16),mat('#548c8b',0.38));water.rotation.x=-Math.PI/2;water.position.y=0.69;well.add(water);
    const timber=mat('#71543b');for(const side of [-1,1]){const post=new THREE.Mesh(new THREE.CylinderGeometry(0.07,0.09,2.15,6),timber);post.position.set(side*0.73,1.3,0);well.add(post);}
    const roof=new THREE.Mesh(new THREE.ConeGeometry(1.25,0.72,4),mat('#85543d'));roof.position.set(0,2.68,0);roof.rotation.y=Math.PI/4;roof.castShadow=true;well.add(roof);
    const spindle=new THREE.Mesh(new THREE.CylinderGeometry(0.055,0.055,1.35,7),mat('#9a7952'));spindle.position.set(0,1.72,0);spindle.rotation.z=Math.PI/2;well.add(spindle);
    const rope=new THREE.Mesh(new THREE.CylinderGeometry(0.018,0.018,0.65,5),mat('#d0b78c'));rope.position.set(0,1.28,0.1);well.add(rope);
    const bucket=this.box(well,0.32,0.28,0.28,'#a77c4f',0,0.79,0.1,false);bucket.material=mat('#a77c4f');this.scene.add(well);
    const bedSoil=mat('#775d3f');
    // A kitchen garden with raised beds, leafy rows and a small timber gate.
    fence(FENCES[0].x,FENCES[0].z,FENCES[0].width,FENCES[0].depth,'#806447');
    for(let row=0;row<3;row++){
      const bed=new THREE.Mesh(new THREE.BoxGeometry(1.25,0.16,4.6),bedSoil);bed.position.set(-17+row*2.1,0.16,2.8);this.scene.add(bed);
      for(let i=0;i<7;i++){
        const z=0.9+i*0.63;
        sphere(this.scene,row===1?'#88b653':'#6d9d4f',[-17+row*2.1,0.34,z],[0.22,0.15,0.24],false);
      }
    }
    const coop=new THREE.Group();coop.position.set(-3.7,0,11.6);
    const coopWall=this.box(coop,2.2,1.5,1.8,'#c88b59',0,0.83,0);coopWall.material=mat('#b8794e');
    const coopRoof=this.box(coop,2.55,0.22,2.1,'#75483a',0,1.72,0);coopRoof.rotation.z=0.16;
    this.box(coop,0.58,0.85,0.08,'#523f31',0,0.48,0.94,false);
    this.box(coop,0.09,1.2,0.12,'#e8d3a6',0.42,0.6,1.02,false);
    this.scene.add(coop);fence(FENCES[1].x,FENCES[1].z,FENCES[1].width,FENCES[1].depth,'#806447');
    // A proper pasture occupies the quieter edge of the island.
    fence(FENCES[2].x,FENCES[2].z,FENCES[2].width,FENCES[2].depth,'#705b3d');
    const pondBank=new THREE.Mesh(new THREE.CircleGeometry(1,40),mat('#b5a276'));pondBank.rotation.x=-Math.PI/2;pondBank.scale.set(POND.radiusX+0.5,POND.radiusZ+0.45,1);pondBank.position.set(POND.x,0.12,POND.z);this.scene.add(pondBank);
    const pond=new THREE.Mesh(new THREE.CircleGeometry(1,40),new THREE.MeshStandardMaterial({color:'#6faeb0',roughness:0.28,metalness:0.05}));pond.rotation.x=-Math.PI/2;pond.scale.set(POND.radiusX,POND.radiusZ,1);pond.position.set(POND.x,0.15,POND.z);this.scene.add(pond);
    for(let i=0;i<13;i++){
      const angle=i*Math.PI*2/13,r=3.15+(i%3)*0.16;
      sphere(this.scene,i%3?'#85856b':'#9b9a77',[POND.x+Math.cos(angle)*r*1.18,0.18,POND.z+Math.sin(angle)*r*0.73],[0.22+(i%2)*0.1,0.13,0.18],false);
    }
    const reedMat=mat('#668b4f');
    for(let i=0;i<7;i++){
      const reed=new THREE.Mesh(new THREE.CylinderGeometry(0.025,0.04,0.54,5),reedMat);reed.position.set(POND.x-POND.radiusX-0.35+(i%3)*0.27,0.36,POND.z+Math.floor(i/3)*0.23);reed.rotation.z=(i%2?0.18:-0.16);this.scene.add(reed);
    }
    // Fruit trees give the lower meadow a small orchard and shade the garden edge.
    for(const [x,z] of ORCHARD_SPOTS){
      const trunk=new THREE.Mesh(new THREE.BoxGeometry(0.35,1.45,0.35),mat('#73533a'));trunk.position.set(x,0.72,z);trunk.castShadow=true;this.scene.add(trunk);
      this.box(this.scene,1.8,1.45,1.8,'#57894e',x,1.76,z);
      for(const [dx,dz] of [[-0.52,0],[0.48,0.18],[0.1,-0.55]] as [number,number][]){sphere(this.scene,'#d9754c',[x+dx,1.52,z+dz],[0.13,0.14,0.13],false);}
    }
  }
  private makeWildlife() {
    const colors:Record<AnimalSpec['kind'],string>={cow:'#e9e5d8',sheep:'#f5efdf',chicken:'#e8d6a6',goat:'#ae9b7b',pig:'#dba99e',rabbit:'#d8c7ad',fox:'#b66c3e',sparrow:'#9e8059',dove:'#d8d7cf',crow:'#333a40'};
    const material=(color:string)=>new THREE.MeshStandardMaterial({color,roughness:0.95});
    const oval=(parent:THREE.Group,color:string,x:number,y:number,z:number,sx:number,sy:number,sz:number)=>{
      const mesh=new THREE.Mesh(new THREE.SphereGeometry(1,10,8),material(color));mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;parent.add(mesh);return mesh;
    };
    for(const spec of ANIMALS){
      const group=new THREE.Group(),color=colors[spec.kind],bird=isBird(spec.kind);
      let wings:[THREE.Group,THREE.Group]|null=null;
      if(bird||spec.kind==='chicken'){
        const scale=spec.kind==='chicken'?1.35:1;
        group.scale.setScalar(scale);
        oval(group,color,0,0.34,0,0.27,0.25,0.35);
        oval(group,color,0,0.58,0.22,0.17,0.17,0.17);
        const beak=new THREE.Mesh(new THREE.ConeGeometry(0.075,0.18,5),material('#d5a052'));beak.rotation.x=Math.PI/2;beak.position.set(0,0.56,0.43);group.add(beak);
        for(const side of [-1,1]){
          oval(group,'#222421',side*0.095,0.61,0.33,0.025,0.028,0.02);
          oval(group,'#9c6b48',side*0.1,0.1,0.02,0.025,0.12,0.03);
        }
        wings=[new THREE.Group(),new THREE.Group()];
        for(const [index,side] of [-1,1].entries()){
          const wing=wings[index];wing.position.set(side*0.23,0.42,0);oval(wing,color,side*0.15,0,0,0.2,0.055,0.2);group.add(wing);
        }
        if(spec.kind==='chicken')oval(group,'#b95746',0,0.76,0.17,0.08,0.11,0.08);
      } else {
        const rabbit=spec.kind==='rabbit',fox=spec.kind==='fox';
        const sx=rabbit?0.3:fox?0.48:spec.kind==='cow'?0.67:0.48;
        const sy=rabbit?0.28:0.4;
        oval(group,color,0,0.52,0,sx,sy,rabbit?0.4:0.67);
        oval(group,color,0,0.61,0.56,rabbit?0.21:0.31,rabbit?0.24:0.28,0.3);
        for(const side of [-1,1]){
          oval(group,'#282927',side*0.14,0.67,0.82,0.03,0.03,0.02);
          const ear=oval(group,color,side*0.22,rabbit?1.03:0.94,0.55,rabbit?0.08:0.12,rabbit?0.34:0.17,0.09);ear.rotation.z=side*0.18;
          for(const z of [-0.39,0.35])oval(group,color,side*sx*0.72,0.21,z,0.09,0.23,0.1);
        }
        if(spec.kind==='pig')oval(group,'#bf8b84',0,0.52,0.87,0.21,0.14,0.12);
        if(spec.kind==='cow'){for(const side of [-1,1])oval(group,'#4b5149',side*0.34,0.78,side*0.18,0.18,0.17,0.22);}
        if(spec.kind==='goat'){for(const side of [-1,1]){const horn=new THREE.Mesh(new THREE.ConeGeometry(0.075,0.28,6),material('#dfd3aa'));horn.position.set(side*0.17,1.02,0.58);group.add(horn);}}
        oval(group,fox?'#e8d6ae':color,0,0.55,-0.75,fox?0.23:0.09,fox?0.22:0.13,fox?0.45:0.22);
      }
      this.scene.add(group);this.animals.push({spec,group,wings});
    }
  }
  private makeDetails() {
    const stall=new THREE.Group();stall.position.set(MARKET_STALL.x,0,MARKET_STALL.z);
    this.box(stall,1.9,0.8,0.75,'#916b46',0,0.62,0);
    for(const x of [-0.78,0.78])this.box(stall,0.12,1.6,0.12,'#705137',x,1.3,0);
    const awning=this.box(stall,2.2,0.14,1.3,'#c77856',0,2.06,0);awning.rotation.z=-0.08;
    for(const x of [-0.5,0,0.5])this.box(stall,0.42,0.24,0.35,x===0?'#d8bb72':'#a4b66a',x,1.13,0.08,false);
    this.scene.add(stall);
    // Warm lantern posts line the paths and switch on with the village night.
    for(const [x,z] of [[-7,-1.8],[0,1.2],[7,3.4],[3,8.5],[-11,0.5],[11,-5.5]] as [number,number][]) {
      const post=new THREE.Group();post.position.set(x,0,z);
      this.box(post,0.16,2.25,0.16,'#624a35',0,1.12,0);
      this.box(post,0.65,0.1,0.1,'#624a35',0.22,2.15,0);
      const shade=new THREE.Mesh(new THREE.ConeGeometry(0.36,0.32,6),new THREE.MeshStandardMaterial({color:'#554735',roughness:0.8}));shade.position.set(0.46,2.06,0);post.add(shade);
      const bulbMaterial=new THREE.MeshStandardMaterial({color:'#ffe6a1',emissive:'#ffc85c',emissiveIntensity:0,roughness:0.35});
      const bulb=new THREE.Mesh(new THREE.SphereGeometry(0.12,10,8),bulbMaterial);bulb.position.set(0.46,1.86,0);post.add(bulb);
      const light=new THREE.PointLight('#ffd987',0,9,1.5);light.position.set(0.46,1.82,0);post.add(light);this.scene.add(post);this.nightLights.push({light,bulb:bulbMaterial});
    }
    // A small timber waterwheel turns beside the lake.
    const wheel=new THREE.Group();wheel.position.set(WATER_WHEEL.x,0.84,WATER_WHEEL.z);
    const rimMat=new THREE.MeshStandardMaterial({color:'#76553a',roughness:0.9});
    const rim=new THREE.Mesh(new THREE.TorusGeometry(0.9,0.09,8,16),rimMat);wheel.add(rim);
    const axle=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,1.65,10),new THREE.MeshStandardMaterial({color:'#8c6948'}));axle.rotation.z=Math.PI/2;wheel.add(axle);
    for(let i=0;i<10;i++){const angle=i*Math.PI/5;const spoke=new THREE.Mesh(new THREE.BoxGeometry(1.62,0.11,0.13),rimMat);spoke.rotation.z=angle;wheel.add(spoke);const paddle=new THREE.Mesh(new THREE.BoxGeometry(0.25,0.34,0.12),new THREE.MeshStandardMaterial({color:'#b18a5e'}));paddle.position.set(Math.cos(angle)*0.9,Math.sin(angle)*0.9,0);paddle.rotation.z=angle;wheel.add(paddle);}
    this.waterWheel=wheel;this.scene.add(wheel);
    const colors=['#e8a779','#f0d582','#8fb8a1','#df8d7e','#829fc3'];
    const positions=[[-2.2,-4.8],[-3.2,-4.7],[-1.6,-4.1],[-2.6,-3.9],[5.8,2.6],[6.4,2.1],[5.6,1.7]];
    positions.forEach(([x,z],i)=>{
      const flower=new THREE.Group(); flower.position.set(x,0,z);
      this.box(flower,0.045,0.3,0.045,'#557b50',0,0.15,0,false);
      const bloom=new THREE.Mesh(new THREE.BoxGeometry(0.18,0.16,0.18),new THREE.MeshStandardMaterial({color:colors[i%colors.length]})); bloom.position.y=0.35; bloom.castShadow=true; flower.add(bloom); this.scene.add(flower);
    });
    // Tiny stepping stones and a simple bench, useful landmarks from the high camera.
    for(let i=0;i<5;i++){const stone=this.box(this.scene,0.5,0.09,0.36,'#c6bd9e',-1.4+i*0.4,0.08,4.5,false);stone.rotation.y=-0.25;}
    const bench=new THREE.Group(); bench.position.set(-5.7,0,-1.8);
    this.box(bench,1.6,0.16,0.52,'#98704e',0,0.62,0); for(const x of [-0.58,0.58]) this.box(bench,0.14,0.62,0.42,'#745943',x,0.31,0);
    this.scene.add(bench);
  }
  private makeExplorationSites() {
    const stone='#9c9f93',timber='#795a40';
    for(const site of EXPLORE_SITES){
      const marker=new THREE.Mesh(new THREE.TorusGeometry(0.48,0.045,6,20),new THREE.MeshStandardMaterial({color:'#d2bd83',roughness:0.9}));
      marker.rotation.x=Math.PI/2;marker.position.set(site.x,0.22,site.z);this.scene.add(marker);
    }
    // A lookout, older than the new houses, faces the dangerous outer forest.
    this.box(this.scene,4,0.35,3.2,timber,-27,0.38,-27);
    for(const x of [-28.8,-25.2])for(const z of [-28.3,-25.7])this.box(this.scene,0.22,1.35,0.22,timber,x,1.05,z);
    this.box(this.scene,4.1,0.14,0.16,'#ad956f',-27,1.72,-28.4);
    this.box(this.scene,0.8,0.22,0.8,stone,-26,0.19,-25.7);
    // The old counting stones hold an inscription and a place to sit.
    for(let i=0;i<8;i++){const angle=i*Math.PI/4;const x=-26+Math.cos(angle)*1.8,z=9+Math.sin(angle)*1.8;const height=0.65+(i%3)*0.35;this.box(this.scene,0.62,height,0.45,i%2?'#aaa99a':'#92998b',x,height/2,z);}
    this.box(this.scene,1.3,0.25,0.7,timber,-26,0.25,6.5);
    // Broken columns and a half-standing arch mark Cesar's ruined outpost.
    for(const x of [0,3.2])for(const z of [27,29])this.box(this.scene,0.62,1.5+(x+z)%2,0.62,stone,x,0.9,z);
    this.box(this.scene,3.7,0.28,0.65,'#b2ae9d',1.6,2.1,29);
    for(const [x,z] of [[-0.5,25.5],[3.6,26.2],[1.3,29.3]])this.box(this.scene,0.6,0.28,0.5,stone,x,0.19,z);
    // A small spring and floating lights make the far clearing readable at night.
    const spring=new THREE.Mesh(new THREE.CircleGeometry(1.25,20),new THREE.MeshStandardMaterial({color:'#7baeb3',emissive:'#315e68',emissiveIntensity:0.2,side:THREE.DoubleSide}));spring.rotation.x=-Math.PI/2;spring.position.set(23,0.2,27);this.scene.add(spring);
    for(let i=0;i<9;i++){const angle=i*2.4;const glow=new THREE.Mesh(new THREE.SphereGeometry(0.07,6,6),new THREE.MeshBasicMaterial({color:'#d9e9a3'}));glow.position.set(23+Math.cos(angle)*1.6,0.8+(i%3)*0.34,27+Math.sin(angle)*1.6);this.scene.add(glow);}
    // A weathered workbench hints at useful plans without supplying free items.
    this.box(this.scene,3.3,0.2,1.1,timber,-6.6,0.75,-27.2);
    for(const x of [-8,-5.2])this.box(this.scene,0.2,0.7,0.2,timber,x,0.36,-27.2);
    this.box(this.scene,1.4,0.08,0.8,'#d4c59e',-6.8,0.9,-27.2,false);
    // The prisoner stands inside the southwest wall, facing the village.
    // A floor anchor and an ankle cuff make the restraint legible in 3D.
    const {x,z}=CHAINED_GOBLIN;
    this.box(this.scene,5.7,0.26,5.7,'#63695f',x,0.13,z,false);
    for(const dx of [-2.75,-1.38,0,1.38,2.75])this.box(this.scene,0.12,1.25,0.12,'#484f4d',x+dx,0.66,z-2.75);
    this.box(this.scene,5.7,0.1,0.15,'#555b54',x,1.32,z-2.75);
    this.box(this.scene,0.24,0.24,0.24,'#303737',x+2.18,0.32,z+1.6);
    const prisoner=new THREE.Group();prisoner.position.set(x,0,z);prisoner.scale.setScalar(1.35);this.scene.add(prisoner);
    this.box(prisoner,0.83,1.02,0.57,'#354638',0,1.08,0);
    this.box(prisoner,0.79,0.72,0.68,'#74885c',0,1.96,0);
    this.box(prisoner,0.86,0.24,0.74,'#30353a',0,2.38,-0.05);
    for(const side of [-1,1]){
      this.box(prisoner,0.2,0.84,0.22,'#455c3e',side*0.53,1.11,0);
      this.box(prisoner,0.23,0.69,0.24,'#354638',side*0.23,0.36,0);
      this.box(prisoner,0.19,0.25,0.14,'#718c58',side*0.51,2.04,0.08);
      this.box(prisoner,0.1,0.1,0.065,'#f7d06b',side*0.19,2.03,0.355,false);
      this.box(prisoner,0.25,0.08,0.26,'#3f4b4a',side*0.23,0.26,0);
    }
    this.box(prisoner,0.17,0.06,0.05,'#28392c',0,1.79,0.36,false);
    const chainMaterial=new THREE.MeshStandardMaterial({color:'#9aa4a2',metalness:0.75,roughness:0.28});
    for(let i=0;i<9;i++){
      const t=i/8,link=new THREE.Mesh(new THREE.TorusGeometry(0.16,0.045,6,10),chainMaterial);
      link.rotation.y=i%2?0:Math.PI/2;
      link.position.set(x+0.25+(2.18-0.25)*t,0.3+Math.sin(t*Math.PI)*0.12,z+1.6*t);
      this.scene.add(link);
    }
    const cuff=new THREE.Mesh(new THREE.TorusGeometry(0.17,0.055,6,12),chainMaterial);cuff.rotation.x=Math.PI/2;cuff.position.set(x+0.31,0.34,z);this.scene.add(cuff);
    const eerie=new THREE.PointLight('#c3d393',3.2,11,2);eerie.position.set(x,2.8,z);this.scene.add(eerie);
  }
  private resize() {
    const w=this.element.clientWidth,h=this.element.clientHeight;if(!w||!h)return;
    const aspect=w/h, span=54; this.camera.left=-span*aspect/2;this.camera.right=span*aspect/2;this.camera.top=span/2;this.camera.bottom=-span/2;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);
  }
  private pan(dx: number, dz: number) {
    const limit=WORLD_HALF_SIZE-8;
    const nextX=THREE.MathUtils.clamp(this.target.x+dx,-limit,limit),nextZ=THREE.MathUtils.clamp(this.target.z+dz,-limit,limit);
    this.camera.position.x+=nextX-this.target.x;this.camera.position.z+=nextZ-this.target.z;this.target.set(nextX,0,nextZ);this.camera.lookAt(this.target);
  }
  centerOn(x=0,z=0) { const limit=WORLD_HALF_SIZE-8,dx=THREE.MathUtils.clamp(x,-limit,limit)-this.target.x,dz=THREE.MathUtils.clamp(z,-limit,limit)-this.target.z;this.target.x+=dx;this.target.z+=dz;this.camera.position.x+=dx;this.camera.position.z+=dz;this.camera.lookAt(this.target); }
  setZoom(zoom:number) { this.camera.zoom=THREE.MathUtils.clamp(zoom,0.72,1.8);this.camera.updateProjectionMatrix();this.onZoom?.(this.camera.zoom); }
  setDayPhase(phase:number) { this.dayPhase=((phase%1)+1)%1; }
  setWorldElapsedSeconds(seconds:number) { this.worldElapsed=Math.max(0,seconds); }
  applyNpcState(npcs:Array<{id:string;x:number;z:number;emotion:string;mode:string}>) {
    for(const state of npcs){const npc=this.npcs.find(item=>item.profile.id===state.id);if(!npc)continue;npc.group.visible=state.mode!=='departed';if(npc.group.visible)npc.setServerState(state.x,state.z,state.emotion);}
  }
  private animate = () => {
    this.frame=requestAnimationFrame(this.animate); const dt=Math.min(this.clock.getDelta(),0.05);
    const hour=this.dayPhase*24;this.dayPhase=(this.dayPhase+dt/(secondsPerWorldHour(hour)*24))%1;this.npcs.forEach(npc=>npc.update(dt));
    const seconds=this.clock.elapsedTime;this.worldElapsed+=dt;this.animals.forEach(({spec,group,wings})=>{
      const position=animalPosition(spec,this.worldElapsed),next=animalPosition(spec,this.worldElapsed+0.2);
      group.position.set(position.x,position.y+(position.flying?0:Math.max(0,Math.sin(seconds*4+spec.x)*0.013)),position.z);
      if(Math.hypot(next.x-position.x,next.z-position.z)>0.005)group.rotation.y=Math.atan2(next.x-position.x,next.z-position.z);
      if(wings){wings[0].rotation.z=position.flying?Math.sin(seconds*13+spec.z)*0.65:0.08;wings[1].rotation.z=-wings[0].rotation.z;}
    });
    this.goblins.forEach((goblin,index)=>{
      const [x,z]=GOBLIN_PATROLS[index],phase=seconds*0.7+index*1.8;
      goblin.position.x=x+Math.sin(phase)*1.25;
      goblin.position.z=z+Math.cos(phase*0.8)*0.95;
      goblin.rotation.y=phase+Math.PI/2;
    });
    if(this.waterWheel)this.waterWheel.rotation.z=-seconds*0.9;
    this.updateDaylight(this.dayPhase);this.renderer.render(this.scene,this.camera);
  };
  private updateDaylight(phase:number) {
    const hour=phase*24, daylight=THREE.MathUtils.smoothstep(Math.sin((hour-6)*Math.PI/12),-0.16,0.42);
    const dawn=Math.max(1-THREE.MathUtils.smoothstep(Math.abs(hour-6),0,3),1-THREE.MathUtils.smoothstep(Math.abs(hour-18),0,3));
    this.hemisphere.intensity=0.4+1.0*daylight;this.sun.intensity=0.12+1.85*daylight;
    const night=1-daylight;this.nightLights.forEach(({light,bulb})=>{light.intensity=night*4.2;bulb.emissiveIntensity=night*2.6;});
    this.sun.color.set('#ffc681').lerp(this.sunDay,daylight);
    const angle=phase*Math.PI*2-Math.PI/2;this.sun.position.set(Math.cos(angle)*22,Math.max(2,Math.sin(angle)*26),8);
    this.skyColor.copy(this.skyNight).lerp(this.skyDay,daylight).lerp(this.skyDawn,dawn*(1-daylight)*0.56);
    this.scene.background=this.skyColor;(this.scene.fog as THREE.Fog).color.copy(this.skyColor);
  }
  dispose() {
    cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); this.element.removeEventListener('wheel',this.onWheel); window.removeEventListener('keydown',this.onKeyDown);
    this.renderer.domElement.removeEventListener('pointerdown',this.onPointerDown); this.renderer.domElement.removeEventListener('pointermove',this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup',this.onPointerUp); this.renderer.domElement.removeEventListener('pointercancel',this.onPointerCancel);
    this.renderer.dispose(); this.renderer.domElement.remove();
  }
}
