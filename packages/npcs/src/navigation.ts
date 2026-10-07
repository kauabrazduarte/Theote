import houses from '../data/houses.json';
import { BENCH, CHAINED_GOBLIN, FENCES, MARKET_STALL, ORCHARD_SPOTS, POND, TREE_SPOTS, WELL, WORLD_HALF_SIZE } from './worldLayout';

type Point={x:number;z:number};
type Rect={minX:number;maxX:number;minZ:number;maxZ:number};
const BODY_RADIUS=0.24;
const GRID=0.5;
const GRID_LIMIT=Math.floor((WORLD_HALF_SIZE-1.1)/GRID);
const rects:Rect[]=[];
const circles:Array<{x:number;z:number;radius:number}>=[];
const addRect=(x:number,z:number,width:number,depth:number)=>rects.push({minX:x-width/2,maxX:x+width/2,minZ:z-depth/2,maxZ:z+depth/2});

for(const house of houses) {
  const [x,z]=house.center,[width,depth]=house.size,front=z+depth/2;
  addRect(x,z-depth/2,width,0.18);
  addRect(x-width/2,z,0.18,depth);addRect(x+width/2,z,0.18,depth);
  const segment=(width-1.5)/2;
  addRect(x-(1.5+segment)/2,front,segment,0.18);
  addRect(x+(1.5+segment)/2,front,segment,0.18);
  addRect(x-0.25,z-1.6,0.13,2.45);addRect(x-0.25,z+0.78,0.13,0.72);
  addRect(x+1.95,z-2.05,1.65,0.5);addRect(x+1.72,z+0.42,0.92,0.82);
}
for(const fence of FENCES) {
  const {x,z,width,depth}=fence;
  addRect(x,z-depth/2,width,0.12);
  addRect(x-width/2,z,0.12,depth);addRect(x+width/2,z,0.12,depth);
  const segment=(width-1.05)/2;
  addRect(x-(1.05+segment)/2,z+depth/2,segment,0.12);
  addRect(x+(1.05+segment)/2,z+depth/2,segment,0.12);
}
addRect(-3.7,11.6,2.2,1.8);
addRect(BENCH.x,BENCH.z,1.6,0.52);
addRect(MARKET_STALL.x,MARKET_STALL.z,1.8,1.1);
for(const [x,z,scale] of TREE_SPOTS)circles.push({x,z,radius:0.22*scale});
for(const [x,z] of ORCHARD_SPOTS)circles.push({x,z,radius:0.24});
circles.push({x:WELL.x,z:WELL.z,radius:WELL.radius});
circles.push({x:CHAINED_GOBLIN.x,z:CHAINED_GOBLIN.z,radius:2.7});

export function isWalkable(x:number,z:number) {
  if(!Number.isFinite(x)||!Number.isFinite(z)||Math.abs(x)>WORLD_HALF_SIZE-1.05||Math.abs(z)>WORLD_HALF_SIZE-1.05)return false;
  const pondX=(x-POND.x)/(POND.radiusX+BODY_RADIUS),pondZ=(z-POND.z)/(POND.radiusZ+BODY_RADIUS);
  if(pondX*pondX+pondZ*pondZ<1)return false;
  if(rects.some(rect=>x>=rect.minX-BODY_RADIUS&&x<=rect.maxX+BODY_RADIUS&&z>=rect.minZ-BODY_RADIUS&&z<=rect.maxZ+BODY_RADIUS))return false;
  if(circles.some(circle=>Math.hypot(x-circle.x,z-circle.z)<circle.radius+BODY_RADIUS))return false;
  return true;
}

export function segmentWalkable(start:Point,end:Point) {
  const distance=Math.hypot(end.x-start.x,end.z-start.z);
  for(let i=1,steps=Math.ceil(distance/0.18);i<=steps;i++) {
    const t=i/steps;
    if(!isWalkable(start.x+(end.x-start.x)*t,start.z+(end.z-start.z)*t))return false;
  }
  return true;
}

const dirs=[[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]] as const;
const gridPoint=(gx:number,gz:number):Point=>({x:gx*GRID,z:gz*GRID});
const cellKey=(gx:number,gz:number)=>`${gx}:${gz}`;
function nearestFree(point:Point) {
  const gx=Math.max(-GRID_LIMIT,Math.min(GRID_LIMIT,Math.round(point.x/GRID)));
  const gz=Math.max(-GRID_LIMIT,Math.min(GRID_LIMIT,Math.round(point.z/GRID)));
  for(let radius=0;radius<=10;radius++)for(let dx=-radius;dx<=radius;dx++)for(let dz=-radius;dz<=radius;dz++) {
    if(Math.max(Math.abs(dx),Math.abs(dz))!==radius)continue;
    const x=gx+dx,z=gz+dz;
    if(Math.abs(x)<=GRID_LIMIT&&Math.abs(z)<=GRID_LIMIT&&isWalkable(x*GRID,z*GRID))return {gx:x,gz:z};
  }
  return null;
}

/** Find a short route around buildings, fences, trees, furniture and water. */
export function findRoute(start:Point,goal:Point):Point[] {
  if(segmentWalkable(start,goal))return [goal];
  const from=nearestFree(start),to=nearestFree(goal);
  if(!from||!to)return [];
  const startKey=cellKey(from.gx,from.gz),goalKey=cellKey(to.gx,to.gz);
  const open=new Set([startKey]);
  const points=new Map([[startKey,from]]);
  const distance=new Map([[startKey,0]]);
  const previous=new Map<string,string>();
  const heuristic=(gx:number,gz:number)=>Math.hypot(gx-to.gx,gz-to.gz);
  while(open.size) {
    let current='';let best=Infinity;
    for(const key of open){const cell=points.get(key)!;const score=(distance.get(key)??Infinity)+heuristic(cell.gx,cell.gz);if(score<best){best=score;current=key;}}
    if(current===goalKey){
      const route:Point[]=[];
      for(let key=current;key!==startKey;key=previous.get(key)!) {const cell=points.get(key)!;route.push(gridPoint(cell.gx,cell.gz));}
      route.reverse();
      if(isWalkable(goal.x,goal.z)&&segmentWalkable(route.at(-1)??start,goal))route.push(goal);
      return route;
    }
    open.delete(current);
    const here=points.get(current)!;
    for(const [dx,dz] of dirs) {
      const gx=here.gx+dx,gz=here.gz+dz;
      if(Math.abs(gx)>GRID_LIMIT||Math.abs(gz)>GRID_LIMIT||!isWalkable(gx*GRID,gz*GRID))continue;
      if(dx&&dz&&(!isWalkable((here.gx+dx)*GRID,here.gz*GRID)||!isWalkable(here.gx*GRID,(here.gz+dz)*GRID)))continue;
      const next=cellKey(gx,gz),cost=(distance.get(current)??Infinity)+Math.hypot(dx,dz);
      if(cost>=(distance.get(next)??Infinity))continue;
      previous.set(next,current);distance.set(next,cost);points.set(next,{gx,gz});open.add(next);
    }
  }
  return [];
}

export function advanceOnRoute(start:Point,goal:Point,maxDistance:number):Point {
  const route=findRoute(start,goal);
  let at={...start},remaining=Math.max(0,maxDistance);
  for(const point of route) {
    const length=Math.hypot(point.x-at.x,point.z-at.z);
    if(length<0.001)continue;
    const travel=Math.min(length,remaining);
    at={x:at.x+(point.x-at.x)*travel/length,z:at.z+(point.z-at.z)*travel/length};
    remaining-=travel;
    if(remaining<=0.001||travel<length)break;
  }
  return at;
}
