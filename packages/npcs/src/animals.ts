import { isWalkable, segmentWalkable } from './navigation';

export type AnimalKind='cow'|'sheep'|'chicken'|'goat'|'pig'|'rabbit'|'fox'|'sparrow'|'dove'|'crow';
export type AnimalSpec={id:string;kind:AnimalKind;name:string;x:number;z:number};
const herd:[AnimalKind,string,Array<[number,number]>][]=[
  ['cow','Vaca',[[13,-22],[18,-22],[-5,-17]]],
  ['sheep','Ovelha',[[12,-23],[17,-20],[-18,-18]]],
  ['chicken','Galinha',[[-5.4,13],[-2,14],[2,12]]],
  ['goat','Cabra',[[-26,-17],[-18,-24],[25,-20]]],
  ['pig','Porco',[[15,-25],[24,-22],[-10,-23]]],
  ['rabbit','Coelho',[[-3,-8],[3,-8],[25,3]]],
  ['fox','Raposa',[[-23,4],[23,21],[-2,22]]],
  ['sparrow','Pardal',[[5,5],[-15,17],[20,1]]],
  ['dove','Pomba',[[3,19],[-26,0],[23,-2]]],
  ['crow','Corvo',[[-17,-2],[13,21],[-12,-25]]],
];
export const ANIMALS:AnimalSpec[]=herd.flatMap(([kind,name,positions])=>positions.map(([x,z],index)=>({id:`${kind}-${index+1}`,kind,name,x,z})));
export const isBird=(kind:AnimalKind)=>kind==='sparrow'||kind==='dove'||kind==='crow';
const wanderPaths=ANIMALS.map((animal,index)=>{
  const anchor={x:animal.x,z:animal.z},points=[anchor];
  if(isBird(animal.kind))return points;
  for(let step=0;step<8;step++){
    const angle=step*2.399+index*0.7,radius=4.2+(index%3)*0.7;
    const point={x:animal.x+Math.sin(angle)*radius,z:animal.z+Math.cos(angle)*radius};
    if(isWalkable(point.x,point.z)&&segmentWalkable(anchor,point))points.push(point,anchor);
    if(points.length>=7)break;
  }
  return points;
});

/** Shared clock keeps what a resident can see aligned with the rendered bot. */
export function animalPosition(animal:AnimalSpec,elapsedSeconds:number) {
  const index=ANIMALS.indexOf(animal),bird=isBird(animal.kind);
  if(!bird){
    const path=wanderPaths[index],step=(elapsedSeconds/11+index*1.7)%path.length;
    const from=path[Math.floor(step)],to=path[(Math.floor(step)+1)%path.length];
    const fraction=step-Math.floor(step),smooth=fraction*fraction*(3-2*fraction);
    return {x:from.x+(to.x-from.x)*smooth,z:from.z+(to.z-from.z)*smooth,y:0,flying:false};
  }
  const phase=elapsedSeconds*0.23+index*2.4;
  const flight=((elapsedSeconds+index*3.7)%25+25)%25;
  const lift=Math.max(0,Math.min(1,(flight-7)/3,(19-flight)/3));
  const flying=lift>0.1;
  const radius=0.55+2.65*lift;
  const x=animal.x+Math.sin(phase)*radius,z=animal.z+Math.cos(phase*0.79)*radius;
  const safe=isWalkable(x,z);
  return {x:safe||flying?x:animal.x,z:safe||flying?z:animal.z,y:lift*(2.6+Math.sin(phase*1.9)*0.55),flying};
}
