import * as THREE from 'three';

function seeded(seed:number) { return () => { seed=(Math.imul(seed,1664525)+1013904223)|0; return (seed>>>0)/4294967296; }; }

/** Tileable painted surfaces keep the voxel geometry legible without flat colors. */
export function stoneTexture() {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
  const ctx=canvas.getContext('2d')!,random=seeded(51);
  ctx.fillStyle='#555a55';ctx.fillRect(0,0,512,512);
  const courses=8,course=512/courses;
  for(let row=0;row<courses;row++){
    const offset=row%2?-54:0;
    for(let col=-1;col<8;col++){
      const x=col*82+offset,y=row*course+2;
      const shade=Math.floor(104+random()*43);
      ctx.fillStyle=`rgb(${shade},${shade+2},${shade-2})`;
      ctx.fillRect(x+3,y+2,77,course-6);
      ctx.fillStyle='rgba(233,230,213,.12)';ctx.fillRect(x+4,y+3,74,3);
      ctx.fillStyle='rgba(31,38,35,.16)';ctx.fillRect(x+4,y+course-10,74,3);
      for(let n=0;n<16;n++){
        ctx.fillStyle=random()>.5?'rgba(38,44,41,.12)':'rgba(219,215,195,.13)';
        ctx.fillRect(x+5+random()*69,y+5+random()*(course-16),1+random()*6,1+random()*3);
      }
    }
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(6,2);
  texture.anisotropy=8;
  return texture;
}

export function groundTexture() {
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
  const ctx=canvas.getContext('2d')!,random=seeded(119);
  ctx.fillStyle='#667b50';ctx.fillRect(0,0,512,512);
  for(let i=0;i<16000;i++){
    const value=random();
    ctx.fillStyle=value<.27?'rgba(43,62,41,.23)':value<.68?'rgba(166,168,112,.17)':'rgba(106,89,62,.16)';
    ctx.fillRect(random()*512,random()*512,2+random()*8,1+random()*5);
  }
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(9,9);
  texture.anisotropy=8;
  return texture;
}
