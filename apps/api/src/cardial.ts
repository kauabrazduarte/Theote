import { db } from './database';
import type { ToolDefinition } from './openrouter';
import { emotionById, emotionCatalog } from '@theote/npcs/emotions';
import { recordSocialInteraction } from './coins';

export function withReaction(available:ToolDefinition[]):ToolDefinition[] {
  return available.map(tool=>{
    const parameters=tool.function.parameters as {type:string;properties:Record<string,unknown>;required:string[];additionalProperties:boolean};
    return {type:'function',function:{...tool.function,parameters:{...parameters,properties:{...parameters.properties,reaction:{type:'object',description:'Seu sentimento neste instante. Há afetos como passion, love e affection; alegria, dúvida, dor e conflito. Use neutral com intensidade 0 se nada o afetou.',properties:{emotion:{type:'string',enum:emotionCatalog.map(emotion=>emotion.id)},intensity:{type:'integer',minimum:0,maximum:4},personId:{type:'string',description:'ID da pessoa relacionada ao sentimento, ou string vazia.'}},required:['emotion','intensity','personId'],additionalProperties:false}},required:[...parameters.required,'reaction']}}};
  });
}

async function readInnerState(npcId:string) {
  const [affect]=await db`SELECT mood,pressure,valence FROM npc_affect WHERE npc_id=${npcId}`;
  const bonds=await db`SELECT b.other_id,n.name,warmth,trust,tension FROM npc_bonds b JOIN npc_state n ON n.id=b.other_id WHERE b.npc_id=${npcId} ORDER BY n.name`;
  return {affect:affect??{mood:'neutral',pressure:0,valence:0},bonds};
}

async function saveReaction(npcId:string,worldDay:number,args:Record<string,unknown>,knownIds:string[]) {
  const reaction=args.reaction as {emotion?:unknown;intensity?:unknown;personId?:unknown}|undefined;
  if(!reaction||typeof reaction.emotion!=='string')return;
  const feeling=emotionById.get(reaction.emotion);
  if(!feeling)return;
  const emotion=feeling.id;
  const intensity=typeof reaction.intensity==='number'&&Number.isInteger(reaction.intensity)?Math.max(0,Math.min(4,reaction.intensity)):0;
  if(emotion==='neutral'||intensity===0)return;
  const relatedPerson=typeof reaction.personId==='string'&&reaction.personId.trim()?reaction.personId:args.personId;
  const other=typeof relatedPerson==='string'?knownIds.find(id=>id.toLowerCase()===relatedPerson.toLowerCase()&&id!==npcId):undefined;
  const [pressure,warmth,valence,trust,tension,expression]=feeling.effect;
  const pressureDelta=pressure*intensity,valenceDelta=valence*intensity;
  const warmthDelta=warmth*intensity,trustDelta=trust*intensity,tensionDelta=tension*intensity;
  const cause=String(args.reason??args.topic??'O que aconteceu agora.').slice(0,300);
  await db.begin(async tx=>{
    await tx`UPDATE npc_affect SET mood=${emotion},pressure=LEAST(100,GREATEST(0,pressure+${pressureDelta})),valence=LEAST(100,GREATEST(-100,valence+${valenceDelta})),updated_at=now() WHERE npc_id=${npcId}`;
    if(other)await tx`UPDATE npc_bonds SET warmth=LEAST(100,GREATEST(-100,warmth+${warmthDelta})),trust=LEAST(100,GREATEST(0,trust+${trustDelta})),tension=LEAST(100,GREATEST(0,tension+${tensionDelta})),updated_at=now() WHERE npc_id=${npcId} AND other_id=${other}`;
    await tx`INSERT INTO npc_feeling_events(npc_id,other_id,world_day,emotion,intensity,cause) VALUES (${npcId},${other??null},${worldDay},${emotion},${intensity},${cause})`;
    if(intensity>=2)await tx`UPDATE npc_state SET emotion=${expression},updated_at=now() WHERE id=${npcId}`;
  });
}

async function saveUnanswered(npcId:string,otherId:string,worldDay:number,messageId:number) {
  await db.begin(async tx=>{
    await tx`UPDATE npc_affect SET pressure=LEAST(100,pressure+12),valence=GREATEST(-100,valence-6),updated_at=now() WHERE npc_id=${npcId}`;
    await tx`UPDATE npc_bonds SET trust=GREATEST(0,trust-2),tension=LEAST(100,tension+5),updated_at=now() WHERE npc_id=${npcId} AND other_id=${otherId}`;
    await tx`INSERT INTO npc_feeling_events(npc_id,other_id,world_day,emotion,intensity,cause) VALUES (${npcId},${otherId},${worldDay},'unanswered',2,'Ficou sem resposta depois de falar.')`;
  });
  await recordSocialInteraction(npcId,otherId,worldDay,'unanswered',messageId);
}

async function lowerPressure(npcId:string) {
  await db`UPDATE npc_affect SET pressure=GREATEST(0,pressure-15),updated_at=now() WHERE npc_id=${npcId}`;
}

/** Cardial keeps the inner state and relationships of one resident. */
export class CardialService {
  constructor(readonly npcId:string, readonly identityPrompt='') {}
  innerState() { return readInnerState(this.npcId); }
  recordReaction(worldDay:number,args:Record<string,unknown>,knownIds:string[]) { return saveReaction(this.npcId,worldDay,args,knownIds); }
  recordUnanswered(otherId:string,worldDay:number,messageId:number) { return saveUnanswered(this.npcId,otherId,worldDay,messageId); }
  relievePressure() { return lowerPressure(this.npcId); }
}
