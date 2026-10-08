import { db, homeEntrance } from './database';
import { aiEnabled, completeConversation, rankDecisions, type ChatMessage, type DecisionQuestion } from './openrouter';
import { getWorldClock } from './clock';
import landmarks from '../../../packages/npcs/data/landmarks.json';
import { broadcast } from './realtime';
import { CardialService } from './cardial';
import { emotionCatalog } from '@theote/npcs/emotions';
import { elapsedSecondsForWorldTime } from '@theote/npcs/worldClock';
import { isWalkable, segmentWalkable } from '@theote/npcs/navigation';
import lore from '@theote/npcs/data/lore.json';
import { giveCoin } from './coins';
import { recordSocialInteraction } from './coins';
import { buyItem, consumeItem, donateItem, leaveWorld, GOODS, MARKET } from './commerce';
import { decideAgreement, proposeAgreement } from './agreements';
import { CHAINED_GOBLIN, EXPLORE_SITES } from '@theote/npcs/worldLayout';
import { exploreSite } from './exploration';
import { recall } from './memory';
import { considerGoblinTorment, talkToGoblin } from './goblin';
import { createInvitation, decideTravel, respondInvitation } from './invitations';
import { ANIMALS, animalPosition, type AnimalSpec } from '@theote/npcs/animals';

const worldStory=`${lore.history}\n${lore.outside}\n${lore.resources}\n${lore.currency}\n${lore.goals}`;

const EMOTIONS=['neutral','happy','sad','angry','surprised','worried','thinking'] as const;
type Candidate={id:string;action:string;args:Record<string,unknown>;description:string};
type VisibleAnimal={spec:AnimalSpec;x:number;z:number;flying:boolean;distance:number};
type Row={id:string;name:string;home_id:string;profile:any;x:number;z:number;goal_x:number|null;goal_z:number|null;goal_person_id:string|null;mode:string;sleep_on_arrival:boolean;emotion:string;stamina:number;hunger:number;thirst:number;coins:number;next_thought_at:Date|string|null};
type PendingDialogue={id:number;dialogue_message_id:number;from_npc_id:string|null;to_npc_id:string|null;speaker_name:string;content:string;participants:string[]};
const bounded=(value:unknown)=>{
  if(typeof value!=='number'||!Number.isFinite(value))throw new Error('A caminhada precisa de coordenadas numéricas válidas.');
  return Math.max(-20,Math.min(20,value));
};
const safeText=(value:unknown,max=300)=>String(value??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').slice(0,max).trim();
function spokenText(value:unknown,speakerName:string,listenerNames:string[]) {
  let content=safeText(value,320).replace(new RegExp(`^${speakerName}:\\s*`,'i'),'');
  const addressee=['pessoal','gente',...listenerNames].map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  content=content.replace(new RegExp(`^(?:bom dia|boa tarde|boa noite|olá|oi)(?:,?\\s+(?:${addressee}))?[!,.]*\\s*`,'i'),'').trim();
  return content.charAt(0).toLocaleUpperCase('pt-BR')+content.slice(1);
}
function repeatsRecentSpeech(content:string,previous:string[]) {
  const words=(text:string)=>new Set(text.toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z]{4,}/g)??[]);
  const current=words(content);
  if(current.size<5)return false;
  return previous.some(text=>{const older=words(text);if(older.size<5)return false;let shared=0;for(const word of current)if(older.has(word))shared++;return shared/Math.min(current.size,older.size)>=0.78;});
}
const activeThoughts=new Map<string,AbortController>();
export function interruptThought(npcId:string,reason='Atenção: alguém chegou perto.') { activeThoughts.get(npcId)?.abort(new Error(reason)); }
function conversationCircle(rows:Row[],npcId:string):Row[] {
  const present=rows.filter(row=>row.mode!=='sleeping'&&row.mode!=='departed');
  const joined=new Set([npcId]);
  for(let changed=true;changed;){changed=false;for(const person of present){if(joined.has(person.id))continue;if(present.some(other=>joined.has(other.id)&&Math.hypot(person.x-other.x,person.z-other.z)<=2)){joined.add(person.id);changed=true;}}}
  return present.filter(row=>joined.has(row.id));
}
function findPerson(rows:Row[],value:unknown):Row|undefined {
  const requested=safeText(value,24).toLocaleLowerCase('pt-BR');
  return rows.find(row=>row.id.toLocaleLowerCase('pt-BR')===requested||row.name.toLocaleLowerCase('pt-BR')===requested);
}

async function handlePendingDialogue(self:Row,rows:Row[],pending:PendingDialogue) {
  if(pending.speaker_name==='Duende') {
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(new Error('A decisão sobre o duende passou de 25 segundos.')),25_000);
    activeThoughts.set(self.id,controller);
    try {
      await considerGoblinTorment(self.id,Number(pending.dialogue_message_id),controller.signal);
      await db`UPDATE npc_notifications SET conversation_response='considered',delivered_at=now() WHERE id=${pending.id} AND conversation_response IS NULL`;
      await db`UPDATE npc_state SET last_decision_at=now(),updated_at=now() WHERE id=${self.id}`;
    } catch(error) {
      if(!controller.signal.aborted||!/Nova mensagem|Atenção: alguém chegou perto/.test(String(controller.signal.reason))) {
        console.error(`[Theote] decisão sobre o duende de ${self.id}:`,error);
        await db`UPDATE npc_state SET next_thought_at=now()+interval '8 seconds' WHERE id=${self.id}`;
      }
    } finally {
      clearTimeout(timer);
      if(activeThoughts.get(self.id)===controller)activeThoughts.delete(self.id);
    }
    return;
  }
  const sender=rows.find(person=>person.id===pending.from_npc_id);
  if(!sender||sender.mode==='departed') {
    await db`UPDATE npc_notifications SET conversation_response='unavailable',delivered_at=now() WHERE id=${pending.id} AND conversation_response IS NULL`;
    return;
  }
  if(self.mode==='walking'&&self.goal_person_id===sender.id)return;
  const close=Math.hypot(self.x-sender.x,self.z-sender.z)<=2&&segmentWalkable(self,sender);
  const {day,hour,minute}=await getWorldClock();
  if(!close&&hour===12&&minute<15) {
    await db`UPDATE npc_state SET next_thought_at=now()+interval '3 seconds' WHERE id=${self.id}`;
    return;
  }
  const group=pending.to_npc_id===null;
  const history=await db`SELECT speaker_name,content FROM dialogue_messages WHERE participants @> ${db.json([self.id,sender.id])} ORDER BY id DESC LIMIT 7`;
  const [{recent_replies:recentReplies}]=await db`SELECT COUNT(*)::int AS recent_replies FROM npc_decisions
    WHERE npc_id=${self.id} AND action='reply_to_message' AND arguments->>'personId'=${sender.id} AND created_at>=now()-interval '3 minutes'`;
  const choices:DecisionQuestion[]=close?[
    {id:'reply',instructions:`Responder agora a ${sender.name}: “${safeText(pending.content,220)}”.`,yes:'Consigo acrescentar um fato, sentimento, discordância ou resposta concreta que ainda não apareceu na conversa.',no:'Eu só repetiria o mesmo plano, pergunta ou concordância.'},
    {id:'ignore',instructions:`Encerrar conscientemente esta troca sem outra fala com ${sender.name}.`,yes:'O assunto já foi respondido, preciso agir no que combinamos, quero silêncio ou não desejo continuar.',no:'Tenho algo novo e importante a dizer agora.'},
  ]:[
    {id:'walk',instructions:`Ir encontrar ${sender.name} para responder à fala pendente.`,yes:'Quero continuar essa conversa e vale a pena ir até a pessoa.',no:'Prefiro não ir atrás dela para responder.'},
    {id:'ignore',instructions:`Deixar conscientemente sem resposta a fala de ${sender.name}.`,yes:'Não quero procurar essa pessoa ou retomar esta conversa.',no:'Quero tentar falar com ela.'},
  ];
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error('A atenção à mensagem passou de 45 segundos.')),45_000);
  activeThoughts.set(self.id,controller);
  try {
    const identity=new CardialService(self.id,self.profile.systemPrompt).identityPrompt;
    const state=`${identity}\nÉ dia ${day}, ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}. ${sender.name} falou com você${group?' numa roda':''}: “${safeText(pending.content,280)}”. Você ouviu a mensagem e precisa escolher o que fazer com ela. Não é obrigatório responder; silêncio deve ser uma escolha consciente, por exemplo se o assunto terminou, você está cansado ou não quer falar com essa pessoa. Se vocês já combinaram ir a algum lugar, repetir “vamos” não faz a viagem acontecer: encerre a troca e execute o plano no próximo passo. Você já respondeu ${recentReplies} vez(es) a ${sender.name} nos últimos três minutos. Se houver algo concreto e novo a acrescentar, responda. Conversa recente, da mais antiga para a mais nova:\n${history.reverse().map(item=>`${item.speaker_name}: ${safeText(item.content,220)}`).join('\n')}. Você está ${close?'perto':'longe'} de ${sender.name}. Fome ${self.hunger.toFixed(2)}%, sede ${self.thirst.toFixed(2)}%.`;
    const scores=await rankDecisions(self.id,state,choices,controller.signal);
    controller.signal.throwIfAborted();
    if(!choices.some(choice=>Number(scores[choice.id]??0)>0))throw new Error('A decisão sobre a conversa não veio completa; a mensagem continua pendente.');
    const responseMargin=Math.min(0.35,Math.max(0,Number(recentReplies)-1)*0.12);
    const action=Number(scores[choices[0].id]??0)>Number(scores[choices[1].id]??0)+responseMargin?choices[0].id:choices[1].id;
    let outcome:string;
    if(action==='reply') {
      await speak(self.id,group&&conversationCircle(rows,self.id).length>=3?null:sender.id,`Responder ao que ${sender.name} disse: ${pending.content}`,false,controller.signal,group?Number(pending.dialogue_message_id):null);
      outcome=`Respondeu à mensagem de ${sender.name}.`;
    } else if(action==='walk') {
      const current=await db<Row[]>`SELECT * FROM npc_state WHERE mode<>'departed' ORDER BY id`;
      const actor=current.find(person=>person.id===self.id);
      if(!actor)throw new Error('O morador não está mais disponível.');
      outcome=await executeAction(actor,current,'walk_to_person',{personId:sender.id},controller.signal);
    } else outcome=`Escolheu não responder à mensagem de ${sender.name}.`;
    if(action!=='walk') {
      await db`UPDATE npc_notifications AS n SET conversation_response=${action==='reply'?'replied':'ignored'},delivered_at=now()
        FROM dialogue_messages AS m WHERE n.dialogue_message_id=m.id AND n.npc_id=${self.id} AND n.id<=${pending.id}
        AND n.conversation_response IS NULL AND ((${group} AND m.to_npc_id IS NULL) OR (NOT ${group} AND m.from_npc_id=${sender.id} AND m.to_npc_id=${self.id}))`;
    } else await db`UPDATE npc_notifications SET delivered_at=now() WHERE id=${pending.id}`;
    const recordedAction=action==='reply'?'reply_to_message':action==='ignore'?'ignore_message':'walk_to_person';
    const [saved]=await db`INSERT INTO npc_decisions(npc_id,world_day,action,arguments,outcome) VALUES (${self.id},${day},${recordedAction},${db.json({messageId:pending.dialogue_message_id,personId:sender.id})},${outcome}) RETURNING id`;
    await db`UPDATE npc_state SET last_decision_at=now(),updated_at=now() WHERE id=${self.id}`;
    broadcast('agent_event',{eventId:Number(saved.id),npcId:self.id,npcName:self.name,stage:'decision',status:'completed',tool:recordedAction,outcome,at:new Date().toISOString()});
  } catch(error) {
    if(controller.signal.aborted&&/Nova mensagem|Atenção: alguém chegou perto/.test(String(controller.signal.reason)))return;
    const message=safeText(error instanceof Error?error.message:'Falha ao considerar a mensagem.',300);
    await db`UPDATE npc_state SET next_thought_at=now()+interval '8 seconds' WHERE id=${self.id}`;
    console.error(`[Theote] atenção à mensagem de ${self.id}: ${message}`);
  } finally {
    clearTimeout(timer);
    if(activeThoughts.get(self.id)===controller)activeThoughts.delete(self.id);
  }
}

function actionCandidates(self:Row,rows:Row[],recent:any[],dialogue:any[],hour:number,minute:number,pressure:number,hasNotice:boolean,inventory:Record<string,number>,agreements:any[],explored:Set<string>,invitations:any[],day:number,wildlife:VisibleAnimal[]):Candidate[] {
  const others=rows.filter(person=>person.id!==self.id&&person.mode!=='departed');
  const nearby=others.filter(person=>person.mode!=='sleeping'&&Math.hypot(person.x-self.x,person.z-self.z)<=2);
  const lastDialogue=dialogue.slice().reverse().find(message=>nearby.some(person=>person.id===message.from_npc_id)&&Date.now()-new Date(message.created_at).getTime()<45_000);
  const inConversation=Boolean(lastDialogue);
  const recentTalks=recent.filter(row=>['say_to_person','say_to_group','vent_to_person'].includes(row.action)&&Date.now()-new Date(row.created_at).getTime()<90_000);
  const conversationTired=recentTalks.length>=5||dialogue.filter(message=>Date.now()-new Date(message.created_at).getTime()<90_000).length>=10;
  const candidates:Candidate[]=[];
  const add=(id:string,action:string,args:Record<string,unknown>,description:string)=>candidates.push({id,action,args,description});
  const meeting=hour===12&&minute<15;
  const worldMinute=day*1440+hour*60+minute;
  if(!meeting)for(const invite of invitations.filter(item=>item.response==='accepted'&&!item.travel_decision&&Number(item.target_day)*1440+Number(item.target_hour)*60+Number(item.target_minute)-worldMinute<=15&&worldMinute-(Number(item.target_day)*1440+Number(item.target_hour)*60+Number(item.target_minute))<=10)){
    add(`attend_${invite.id}`,'attend_invitation',{invitationId:Number(invite.id),reason:`Ir ao encontro #${invite.id} em ${invite.site_id}.`},`Ir ao encontro #${invite.id}, em ${invite.site_id}, dia ${invite.target_day} às ${String(invite.target_hour).padStart(2,'0')}:${String(invite.target_minute).padStart(2,'0')}.`);
    add(`skip_${invite.id}`,'skip_invitation',{invitationId:Number(invite.id),reason:`Não ir ao encontro #${invite.id}.`},`Decidir não comparecer ao encontro #${invite.id}.`);
  }
  if(candidates.length)return candidates;
  if(!meeting)for(const agreement of agreements.filter(item=>item.status==='proposed'&&item.recipient_id===self.id)) {
    add(`sign_${agreement.id}`,'sign_agreement',{agreementId:Number(agreement.id),reason:`Aceitar por escrito a proposta de ${agreement.proposer_name}.`},`Assinar a proposta #${agreement.id} de ${agreement.proposer_name}: “${safeText(agreement.terms,180)}”. Só aceite se quiser assumir esse compromisso.`);
    add(`decline_${agreement.id}`,'decline_agreement',{agreementId:Number(agreement.id),reason:`Recusar a proposta de ${agreement.proposer_name}.`},`Recusar a proposta #${agreement.id} de ${agreement.proposer_name}: “${safeText(agreement.terms,180)}”.`);
  }
  if(!meeting)for(const invite of invitations.filter(item=>item.response==='pending')){
    add(`accept_invite_${invite.id}`,'accept_invitation',{invitationId:Number(invite.id),reason:`Aceitar conversar no dia ${invite.target_day} às ${invite.target_hour}:${String(invite.target_minute).padStart(2,'0')}.`},`Aceitar o convite #${invite.id} de ${invite.host_name} para conversar em ${invite.site_id}, dia ${invite.target_day}, às ${String(invite.target_hour).padStart(2,'0')}:${String(invite.target_minute).padStart(2,'0')}.`);
    add(`decline_invite_${invite.id}`,'decline_invitation',{invitationId:Number(invite.id),reason:`Recusar o convite #${invite.id}.`},`Recusar o convite #${invite.id} de ${invite.host_name}.`);
  }
  if(candidates.length)return candidates;
  const lastTalk=recentTalks[0];
  const lastVisit=recent.find(row=>row.action==='walk_to_person');
  const samePartner=recentTalks.length>=6&&recentTalks.slice(0,6).every(row=>row.action==='say_to_person'&&row.arguments?.personId===lastTalk?.arguments?.personId);
  if(!meeting&&self.mode!=='walking'&&self.mode!=='following'&&self.hunger<75&&self.thirst<75&&samePartner&&(!lastVisit||new Date(lastVisit.created_at)<new Date(lastTalk.created_at))){
    const lessKnown=others.filter(person=>Math.hypot(person.x-self.x,person.z-self.z)>2).sort((a,b)=>recentTalks.filter(row=>row.arguments?.personId===a.id).length-recentTalks.filter(row=>row.arguments?.personId===b.id).length);
    if(lessKnown.length){const person=lessKnown[0];add(`meet_${person.id}`,'walk_to_person',{personId:person.id,reason:`Quero conhecer melhor ${person.name} depois de conversar bastante com a mesma pessoa.`},`Ir encontrar ${person.name} para variar as conversas.`);return candidates;}
  }
  if((self.mode==='walking'||self.mode==='following')&&!meeting) {
    add('continue','continue_journey',{reason:'Terminar o caminho que já comecei.'},'Continuar até o destino escolhido, sem mudar de rumo.');
  }
  for(const person of nearby) {
    const recentlyAddressed=recent.some(row=>row.action==='say_to_person'&&String(row.arguments?.personId).toLowerCase()===person.id&&Date.now()-new Date(row.created_at).getTime()<45_000);
    const replying=lastDialogue?.from_npc_id===person.id;
    if(meeting||!conversationTired&&(replying||!recentlyAddressed))add(`talk_${person.id}`,'say_to_person',{personId:person.id,topic:replying?'Reagir ao detalhe mais recente sem saudação, elogio automático nem repetição.':'Falar de algo concreto que está acontecendo agora.',reason:`Conversar com ${person.name}.`},replying?`Responder a ${person.name} sem repetir a ideia: “${safeText(lastDialogue.content,100)}”.`:`Conversar com ${person.name} sobre algo concreto do momento.`);
    const askedForCoin=lastDialogue?.from_npc_id===person.id&&/\b(?:me\s+(?:d[áa]|empresta)|pode\s+me\s+dar|preciso\s+de|tem\s+uma?)\b.{0,32}\bmoed/i.test(String(lastDialogue.content));
    const gaveRecently=recent.some(row=>row.action==='give_coin'&&String(row.arguments?.personId).toLowerCase()===person.id&&Date.now()-new Date(row.created_at).getTime()<300_000);
    if(!meeting&&self.coins>0&&askedForCoin&&!gaveRecently)add(`give_${person.id}`,'give_coin',{personId:person.id,amount:1,reason:`Responder ao pedido de ${person.name} por uma moeda.`},`Dar uma moeda a ${person.name}, que acabou de pedir, se você quiser.`);
    if(!meeting&&pressure>=55)add(`vent_${person.id}`,'vent_to_person',{personId:person.id,topic:'Contar o que está pesando por dentro.',reason:`Confio em ${person.name} para ouvir.`},`Desabafar com ${person.name} sobre emoções acumuladas.`);
    if(!meeting)for(const good of GOODS)if((inventory[good.id]??0)>0&&(good.kind==='food'?person.hunger:person.thirst)>=35)add(`donate_${good.id}_${person.id}`,'donate_item',{personId:person.id,itemId:good.id,amount:1,reason:`Ajudar ${person.name} com ${good.name}.`},`Doar ${good.name} a ${person.name}, que precisa ${good.kind==='food'?'comer':'beber'}.`);
  }
  const circle=conversationCircle(rows,self.id);
  const sharedConversation=dialogue.slice().reverse().find(message=>message.participants?.includes(self.id)&&message.participants?.length>=2&&Date.now()-new Date(message.created_at).getTime()<90_000);
  if(!meeting&&sharedConversation&&!invitations.some(item=>item.host_id===self.id&&Date.now()-new Date(item.created_at).getTime()<600_000)){
    const guests=nearby.filter(person=>sharedConversation.participants.includes(person.id));
    const hourNext=hour>=18?10:Math.max(10,hour+1),targetHour=hourNext===12?13:hourNext,targetDay=day+(hour>=18?1:0);
    const site=EXPLORE_SITES.find(place=>Math.hypot(place.x-self.x,place.z-self.z)<16)??EXPLORE_SITES[0];
    if(guests.length)add(`invite_${guests[0].id}`,'invite_to_talk',{inviteeIds:[guests[0].id],sourceMessageId:Number(sharedConversation.id),siteId:site.id,targetDay,targetHour,targetMinute:0,reason:`Convidar ${guests[0].name} para conversar em ${site.name}.`},`Convidar ${guests[0].name} para uma conversa em ${site.name}, dia ${targetDay}, ${String(targetHour).padStart(2,'0')}:00. A pessoa decidirá se aceita.`);
    if(guests.length>=2)add('invite_group','invite_to_talk',{inviteeIds:guests.map(person=>person.id),sourceMessageId:Number(sharedConversation.id),siteId:'largo',targetDay,targetHour,targetMinute:0,reason:'Combinar uma conversa com todos da roda.'},`Convidar ${guests.map(person=>person.name).join(', ')} para conversar no largo, dia ${targetDay}, ${String(targetHour).padStart(2,'0')}:00. Cada um decide se aceita e depois se comparece.`);
  }
  if(!meeting){
    const ownPlan=dialogue.slice().reverse().find(message=>message.from_npc_id===self.id&&Date.now()-new Date(message.created_at).getTime()<90_000&&/\b(vamos|combinamos|prometo|eu vou|eu posso|podemos|quero ajudar)\b/i.test(message.content));
    if(ownPlan)for(const person of nearby.filter(person=>ownPlan.participants?.includes(person.id)&&!agreements.some(agreement=>agreement.proposer_id===self.id&&agreement.recipient_id===person.id&&(agreement.status==='proposed'||Date.now()-new Date(agreement.created_at).getTime()<600_000))))
      add(`agreement_${ownPlan.id}_${person.id}`,'propose_agreement',{personId:person.id,messageId:Number(ownPlan.id),reason:`Convidar ${person.name} a firmar por escrito o plano que acabei de dizer.`},`Propor a ${person.name} um acordo escrito com o plano da sua fala: “${safeText(ownPlan.content,180)}”. Só ficará firmado se ela/ele aceitar.`);
  }
  if(circle.length>=3&&(meeting||!conversationTired))add('group','say_to_group',{topic:'Dizer algo próprio e concreto à roda, sem repetir uma proposta já discutida.',reason:'Participar da conversa com todos.'},'Falar para a roda com uma posição própria, uma resposta específica ou uma observação do momento.');
  if(circle.length>=3&&(meeting||!conversationTired)){
    const latestGroupMessage=dialogue.slice().reverse().find(message=>message.from_npc_id!==self.id&&message.participants?.length===circle.length&&circle.every(person=>message.participants.includes(person.id))&&Date.now()-new Date(message.created_at).getTime()<90_000);
    if(latestGroupMessage)add('reply_group','say_to_group',{replyToMessageId:Number(latestGroupMessage.id),topic:`Responder diretamente à fala de ${latestGroupMessage.speaker_name}.`,reason:`Responder a ${latestGroupMessage.speaker_name} diante da roda.`},`Responder diretamente à mensagem de ${latestGroupMessage.speaker_name}: “${safeText(latestGroupMessage.content,130)}”. O grupo verá a mensagem citada e ${latestGroupMessage.speaker_name} será avisado.`);
  }
  if(meeting)return candidates.filter(candidate=>candidate.action=== (circle.length>=3?'say_to_group':'say_to_person'));
  const distinctWildlife=wildlife.filter((item,index,array)=>array.findIndex(other=>other.spec.kind===item.spec.kind)===index);
  for(const animal of distinctWildlife){
    const recentlyObserved=recent.some(row=>row.action==='observe_animal'&&row.arguments?.animalId===animal.spec.id&&String(row.outcome).startsWith('Observou')&&Date.now()-new Date(row.created_at).getTime()<180_000);
    if(!recentlyObserved)add(`observe_${animal.spec.id}`,'observe_animal',{animalId:animal.spec.id,reason:`Observar ${animal.spec.name.toLowerCase()} que está ${animal.flying?'voando':'por perto'}.`},`Aproximar-se e observar ${animal.spec.name.toLowerCase()} a ${animal.distance.toFixed(1)} quadrados${animal.flying?' enquanto voa ou pousa':''}.`);
    if(animal.distance<=10&&nearby.length&&distinctWildlife.indexOf(animal)<3){const person=nearby[0],invitedRecently=recent.some(row=>row.action==='invite_to_see_animal'&&row.arguments?.animalId===animal.spec.id&&row.arguments?.personId===person.id&&Date.now()-new Date(row.created_at).getTime()<180_000);if(!invitedRecently)add(`show_${animal.spec.id}_${person.id}`,'invite_to_see_animal',{animalId:animal.spec.id,personId:person.id,topic:`Convidar ${person.name} a observar ${animal.spec.name.toLowerCase()} que está por perto.`,reason:`Quero mostrar ${animal.spec.name.toLowerCase()} a ${person.name}.`},`Convidar ${person.name}, em conversa, para ver ${animal.spec.name.toLowerCase()} perto daqui. ${person.name} decide se vai.`);}
  }
  for(const site of EXPLORE_SITES)if(!explored.has(site.id)){
    if(Math.hypot(self.x-site.x,self.z-site.z)<=2.2)add(`explore_${site.id}`,'explore_place',{siteId:site.id,reason:`Investigar ${site.name}.`},`Explorar ${site.name} e registrar o que encontrar.`);
    else if(self.mode!=='walking'&&self.mode!=='following')add(`discover_${site.id}`,'visit_landmark',{landmarkId:site.id,reason:`Ir investigar ${site.name}.`},`Ir até ${site.name} para explorar uma área ainda desconhecida.`);
  }
  const goblinRecently=recent.some(row=>row.action==='talk_to_goblin'&&Date.now()-new Date(row.created_at).getTime()<600_000);
  if(!goblinRecently){
    if(Math.hypot(self.x-CHAINED_GOBLIN.approachX,self.z-CHAINED_GOBLIN.approachZ)<=2.2)add('goblin_talk','talk_to_goblin',{reason:'Ouvir o duende preso sem atravessar a barreira.'},'Conversar com o duende acorrentado à distância; ele pode tentar mudar suas opiniões.');
    else if(self.mode!=='walking'&&self.mode!=='following')add('goblin_visit','visit_landmark',{landmarkId:'duende',reason:'Ir ao ponto seguro diante do duende.'},'Ir até a barreira no canto da muralha e observar o duende de longe.');
  }
  for(const good of GOODS)if((inventory[good.id]??0)>0&&(good.kind==='food'?self.hunger:self.thirst)>=25)add(`consume_${good.id}`,'consume_item',{itemId:good.id,reason:`Preciso ${good.kind==='food'?'comer':'beber'}.`},`Consumir ${good.name} para aliviar ${good.kind==='food'?'a fome':'a sede'}.`);
  if(Math.hypot(self.x-MARKET.x,self.z-MARKET.z)<=2){for(const good of GOODS.filter(item=>self.coins>=item.price&&(item.kind==='food'?self.hunger:self.thirst)>=25&&(inventory[item.id]??0)<2).sort((a,b)=>b.relief/b.price-a.relief/a.price).slice(0,6))add(`buy_${good.id}`,'buy_item',{itemId:good.id,amount:1,reason:`Comprar ${good.name} para ${good.kind==='food'?'comer':'beber'}.`},`Comprar ${good.name} por ${good.price} moeda(s): alivia ${good.relief}% e dá ${good.joy} de alegria.`);}
  else if(self.coins>=1&&(self.hunger>=30||self.thirst>=30)&&Object.values(inventory).reduce((sum,n)=>sum+n,0)<3)add('market','visit_landmark',{landmarkId:'banca',reason:'Ir à banca comprar comida ou bebida.'},'Ir à banca do vale para suprir fome ou sede.');
  if(self.coins>=1000)add('outside','leave_world',{reason:'Pagar 1000 moedas e conhecer o mundo exterior sozinho.'},'Pagar 1000 moedas para visitar o mundo exterior; somente você sairá do vale.');
  if(self.mode!=='walking'&&self.mode!=='following') {
    for(const person of others.filter(person=>Math.hypot(person.x-self.x,person.z-self.z)>2||!segmentWalkable(self,person))) {
      add(`visit_${person.id}`,'walk_to_person',{personId:person.id,reason:`Ir encontrar ${person.name}.`},`Encontrar ${person.name}: acompanhar a posição atual dela/dele até ficar perto, mesmo se ela/ele se mover.`);
      if(isWalkable(person.x,person.z))add(`last_position_${person.id}`,'walk_to_point',{x:person.x,z:person.z,reason:`Ir à posição (${person.x}, ${person.z}) onde ${person.name} estava agora.`},`Ir até a coordenada fixa (${person.x}, ${person.z}); esse destino não muda se ${person.name} andar.`);
    }
    const recentPlaces=new Set(recent.filter(row=>Date.now()-new Date(row.created_at).getTime()<180_000).map(row=>row.action==='visit_landmark'?row.arguments?.landmarkId:null));
    const places=landmarks.filter(place=>!EXPLORE_SITES.some(site=>site.id===place.id)&&Math.hypot(place.x-self.x,place.z-self.z)>2.2&&!recentPlaces.has(place.id));
    for(const place of places.slice(0,7))add(`place_${place.id}`,'visit_landmark',{landmarkId:place.id,reason:`Passar um tempo em ${place.name}.`},`Ir até ${place.name}; ainda não esteve lá há pouco.`);
    const restingRecently=recent.some(row=>row.action==='rest'&&Date.now()-new Date(row.created_at).getTime()<180_000);
    if(conversationTired&&!restingRecently)add('rest','rest',{reason:'Já falei bastante; vou deixar espaço para os outros e fazer uma pausa breve.'},'Encerrar minha participação na conversa por alguns segundos.');
  }
  if(hour>=20||hour<8||self.stamina<35)add('sleep','go_home_to_sleep',{wakeHour:9,reason:'Ir para minha cama descansar.'},'Ir dormir na própria cama e acordar até as 09:00.');
  if(!candidates.length||hasNotice&&self.mode==='walking'&&candidates.length===1)add('pause','rest',{reason:'Parar brevemente para prestar atenção ao que aconteceu.'},'Parar por alguns segundos para prestar atenção.');
  return candidates;
}

export async function makeDecision(npcId:string) {
  const rows=await db<Row[]>`SELECT * FROM npc_state WHERE mode<>'departed' ORDER BY id`;
  const self=rows.find(row=>row.id===npcId);if(!self)return;
  if(self.mode==='sleeping')return;
  const [pendingDialogue]=await db<PendingDialogue[]>`SELECT n.id,n.dialogue_message_id,m.from_npc_id,m.to_npc_id,m.speaker_name,m.content,m.participants
    FROM npc_notifications n JOIN dialogue_messages m ON m.id=n.dialogue_message_id
    WHERE n.npc_id=${npcId} AND n.conversation_response IS NULL AND n.dialogue_message_id IS NOT NULL
    ORDER BY (m.to_npc_id=${npcId}) DESC,n.id ASC LIMIT 1`;
  if(pendingDialogue) {
    await handlePendingDialogue(self,rows,pendingDialogue);
    return;
  }
  const cardial=new CardialService(npcId,self.profile.systemPrompt);
  const notifications=await db`SELECT id,message FROM npc_notifications WHERE npc_id=${npcId} AND delivered_at IS NULL ORDER BY id LIMIT 8`;
  if(self.next_thought_at&&new Date(self.next_thought_at)>new Date()&&!notifications.length)return;
  if(self.mode==='sleeping'||!notifications.length&&(self.mode==='walking'||self.mode==='following'))return;
  if(self.mode==='waiting'||self.mode==='resting')await db`UPDATE npc_state SET mode='wandering',next_thought_at=NULL,updated_at=now() WHERE id=${npcId}`;
  const others=rows.filter(row=>row.id!==npcId);
  const nearby=others.filter(person=>Math.hypot(person.x-self.x,person.z-self.z)<=2);
  const seen=others;
  const circle=conversationCircle(rows,npcId);
  const inner=await cardial.innerState();
  const [{summary}]=await db`SELECT summary FROM npc_memories WHERE npc_id=${npcId}`;
  const inventoryRows=await db`SELECT item_id,quantity FROM npc_inventory WHERE npc_id=${npcId} AND quantity>0`;
  const inventory=Object.fromEntries(inventoryRows.map(row=>[row.item_id,Number(row.quantity)])) as Record<string,number>;
  const exploredRows=await db`SELECT site_id FROM npc_explorations WHERE npc_id=${npcId}`;
  const explored=new Set<string>(exploredRows.map(row=>String(row.site_id)));
  const decisions=await db`SELECT action,arguments,outcome,world_day,created_at FROM npc_decisions WHERE npc_id=${npcId}
    AND (action<>'consider_goblin_claim' OR arguments->>'remembered'='true') ORDER BY id DESC LIMIT 40`;
  const dialogue=await db`SELECT m.id,m.from_npc_id,m.participants,m.speaker_name,m.content,m.world_day,m.created_at
    FROM dialogue_messages m LEFT JOIN goblin_torments t ON t.message_id=m.id OR t.message_id=m.reply_to_message_id
    WHERE m.participants @> ${db.json([npcId])} AND (t.message_id IS NULL OR t.remembered=true) ORDER BY m.id DESC LIMIT 12`;
  const agreements=await db`SELECT a.id,a.proposer_id,a.recipient_id,a.source_message_id,a.terms,a.status,a.created_at,p.name AS proposer_name,r.name AS recipient_name FROM npc_agreements a JOIN npc_state p ON p.id=a.proposer_id JOIN npc_state r ON r.id=a.recipient_id WHERE a.proposer_id=${npcId} OR a.recipient_id=${npcId} ORDER BY a.id DESC LIMIT 20`;
  const invitations=await db`SELECT i.*,p.response,p.travel_decision,h.name AS host_name FROM conversation_invitations i JOIN conversation_invitees p ON p.invitation_id=i.id JOIN npc_state h ON h.id=i.host_id WHERE p.npc_id=${npcId} ORDER BY i.id DESC LIMIT 20`;
  const seenChoices=new Set<string>();
  const distinctChoices=decisions.filter(item=>{const key=`${item.action}:${item.arguments?.landmarkId??item.arguments?.personId??item.outcome}`;if(seenChoices.has(key))return false;seenChoices.add(key);return true;}).slice(0,7).reverse();
  const {day,hour,minute,elapsedSeconds}=await getWorldClock();
  const wildlife:VisibleAnimal[]=ANIMALS.map(spec=>{const position=animalPosition(spec,elapsedSeconds);return {spec,...position,distance:Math.hypot(position.x-self.x,position.z-self.z)};}).filter(item=>item.distance<=15).sort((a,b)=>a.distance-b.distance);
  const placeList=landmarks.map(place=>`${place.id}: ${place.name} (${place.x}, ${place.z}) — ${place.description}`).join('\n');
  const activeConversation=dialogue.some(message=>nearby.some(person=>person.id===message.from_npc_id)&&Date.now()-new Date(message.created_at).getTime()<45_000);
  const conversationContext=circle.length>=3?`Você está numa roda com ${circle.filter(person=>person.id!==self.id).map(person=>person.name).join(', ')}. Todos nessa roda ouvem cada fala e podem participar. Se quiser sair, afaste-se caminhando.`:nearby.length?`Você está perto de ${nearby.map(person=>person.name).join(', ')} e pode conversar.`:'';
  const pressure=Number(inner.affect.pressure);
  const recollection=await recall(npcId,nearby.map(person=>person.id));
  const feelingContext=pressure>=70?'Você tem muita coisa guardada e isso está pesando.':pressure>=40?'Algumas emoções recentes ainda estão pesando em você.':'Você se sente relativamente à vontade neste momento.';
  const bondsContext=inner.bonds.map(b=>`${b.name}: ${Number(b.warmth)>=35?'muito carinho':Number(b.warmth)<=-20?'distância':'relação em construção'}, ${Number(b.trust)>=60?'confiança':Number(b.trust)<=25?'pouca confiança':'alguma confiança'}${Number(b.tension)>=30?', tensão recente':''}`).join('; ');
  const agreementContext=agreements.length?`Acordos escritos: ${agreements.slice(0,6).map(a=>`#${a.id} com ${a.proposer_id===self.id?a.recipient_name:a.proposer_name}: ${a.status==='signed'?'firmado':a.status==='declined'?'recusado':'aguardando resposta'} — ${safeText(a.terms,120)}`).join(' | ')}.`:'Ainda não há acordos escritos seus.';
  const prompt=`Sua lembrança duradoura:\n${summary||'Você ainda está começando a conhecer seus dias.'}\n\nEpisódios que você recorda: ${recollection.text}\nOpiniões atuais: ${recollection.beliefs||'Ainda não formou opiniões firmes.'}\nDescobertas próprias: ${recollection.discoveries||'Ainda não explorou áreas novas.'}\n\nEscolhas recentes distintas, da mais antiga para a mais nova:\n${distinctChoices.map(d=>`Dia ${d.world_day}: ${d.action} — ${d.outcome}`).join('\n')||'Ainda não há escolhas anteriores registradas.'}\n\nConversas recentes, em ordem:\n${dialogue.slice().reverse().map(d=>`${d.speaker_name}: <fala>${d.content}</fala>`).join('\n')||'Você ainda não conversou com ninguém.'}\n\nSão ${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}, dia ${day}. Sua energia está em ${Math.round(self.stamina)} de 100, fome ${self.hunger.toFixed(4)}% e sede ${self.thirst.toFixed(4)}%. Você tem ${self.coins} moeda(s). Inventário: ${inventoryRows.map(item=>`${item.item_id} ×${item.quantity}`).join(', ')||'vazio'}. Na banca em (${MARKET.x}, ${MARKET.z}), pode comprar comida e bebida. Pode consumir o que possui ou doar a quem está perto. Fome e sede só diminuem quando você consome o item certo; comprar, dormir ou esperar não recupera essas necessidades. A maioria dos 50 produtos da banca alivia pouco, e você se lembra do efeito real dos que experimentou. Sabe que 1000 moedas permitem a você, individualmente, sair para ver o mundo exterior; todos serão avisados. Seu horário habitual de dormir é por volta de ${String(self.profile.sleepHour).padStart(2,'0')}:00. ${self.mode==='walking'?'Você já está a caminho de um lugar.':'Você está livre para escolher seu próximo passo.'}\n${nearby.length?`Perto de você estão: ${nearby.map(p=>p.name).join(', ')}.`:'Agora você está só; ninguém pode ouvir uma conversa daqui.'}\nAnimais a até 15 quadrados: ${wildlife.slice(0,8).map(animal=>`${animal.spec.name} (${animal.distance.toFixed(1)} quadrados, ${animal.flying?'voando':'no chão'})`).join('; ')||'nenhum agora'}. Eles vivem e se movem por conta própria. Você pode se aproximar para observar ou convidar alguém próximo a vê-los.\n\nVocê sabe as coordenadas atuais exatas de todos: ${seen.map(person=>`${person.name} (x=${person.x}, z=${person.z})`).join('; ')}. Ir até a pessoa acompanha sua posição atual até encontrá-la; ir a uma coordenada mantém o ponto fixo. Conversar exige proximidade de 2 quadrados.\nLugares conhecidos:\n${placeList}\n${feelingContext} Seus vínculos: ${bondsContext}.\n${conversationContext} ${activeConversation?'Há uma conversa em andamento. Você pode responder, trazer um fato novo, fazer uma pergunta ou encerrar com naturalidade; não precisa concordar nem prolongar o mesmo assunto.':''}\n${agreementContext}\n${notifications.length?`Aconteceu agora: ${notifications.map(n=>n.message).join(' | ')}.`:''}\n\nEscolha o próximo passo como ${self.name}, respeitando o que você já fez. Chegar a um lugar é diferente de decidir visitá-lo de novo. Evite repetir uma viagem recém-concluída sem um motivo novo.`;
  const candidates=actionCandidates(self,rows,decisions,dialogue.slice().reverse(),hour,minute,pressure,notifications.length>0,inventory,agreements,explored,invitations,day,wildlife);
  if(!candidates.length){
    if(notifications.length)await db`UPDATE npc_notifications SET delivered_at=now() WHERE id IN ${db(notifications.map(n=>n.id))}`;
    await db`UPDATE npc_state SET next_thought_at=now()+interval '10 seconds' WHERE id=${npcId}`;
    return;
  }
  const socialPerson=others.find(person=>notifications.some(notice=>String(notice.message).includes(person.name)));
  const questions:DecisionQuestion[]=candidates.map(candidate=>({id:candidate.id,instructions:`Próximo passo de ${self.name}: ${candidate.description}`,yes:`Esta é a escolha mais coerente agora para ${self.name}, considerando sua personalidade, o lugar onde está e suas escolhas anteriores.`,no:'Outra das opções disponíveis atende melhor ao momento.'}));
  if(socialPerson)for(const emotion of emotionCatalog.filter(item=>item.id!=='neutral'))questions.push({id:`feeling_${emotion.id}`,instructions:`${self.name} sente ${emotion.label.toLowerCase()} por ${socialPerson.name} neste momento? ${emotion.description}`,yes:`O sentimento de ${self.name} por ${socialPerson.name} agora corresponde especificamente a ${emotion.label.toLowerCase()}.`,no:`${emotion.label} não descreve o que ${self.name} sente por ${socialPerson.name} agora.`});
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(new Error('A decisão passou do limite de 20 segundos.')),20_000);
  activeThoughts.set(npcId,controller);
  try {
    broadcast('agent_event',{npcId,npcName:self.name,stage:'decision',status:'started',at:new Date().toISOString()});
    const scores=await rankDecisions(npcId,`${cardial.identityPrompt}\n\nO mundo em que você vive:\n${worldStory}\n\n${prompt}`,questions,controller.signal);
    controller.signal.throwIfAborted();
    const choice=candidates.reduce((best,candidate)=>Number(scores[candidate.id]??0)>Number(scores[best.id]??0)?candidate:best,candidates[0]);
    if(!choice)throw new Error('Nenhuma ação disponível neste momento.');
    if(notifications.length)await db`UPDATE npc_notifications SET delivered_at=now() WHERE id IN ${db(notifications.map(n=>n.id))}`;
    const action=choice.action,args={...choice.args};
    if(socialPerson){
      const feelings=emotionCatalog.filter(item=>item.id!=='neutral').sort((a,b)=>Number(scores[`feeling_${b.id}`]??0)-Number(scores[`feeling_${a.id}`]??0));
      const feeling=feelings[0],score=Number(scores[`feeling_${feeling?.id}`]??0);
      if(feeling&&score>=0.55)args.reaction={emotion:feeling.id,intensity:Math.max(1,Math.min(4,Math.round(score*4))),personId:socialPerson.id};
    }
    broadcast('agent_event',{npcId,npcName:self.name,stage:'tool',status:'started',tool:action,arguments:args,at:new Date().toISOString()});
    const freshRows=await db<Row[]>`SELECT * FROM npc_state ORDER BY id`;
    const current=freshRows.find(row=>row.id===npcId);if(!current)throw new Error('O morador não está mais disponível.');
    controller.signal.throwIfAborted();
    const outcome=await executeAction(current,freshRows,action,args,controller.signal);
    controller.signal.throwIfAborted();
    if(action==='say_to_person'||action==='say_to_group'||action==='vent_to_person'||action==='invite_to_see_animal')await speak(npcId,action==='say_to_group'?null:findPerson(rows,args.personId)?.id??String(args.personId),safeText(args.topic,240),action==='vent_to_person',controller.signal,action==='say_to_group'?Number(args.replyToMessageId)||null:null);
    if(['wander','walk_to_point','walk_to_person','walk_together','visit_landmark','go_home_to_sleep'].includes(action)||action==='observe_animal'&&outcome.startsWith('Começou'))broadcast('agent_event',{npcId,npcName:self.name,stage:'movement',status:'started',tool:action,outcome,at:new Date().toISOString()});
    const thought=safeText(args.reason??args.topic??outcome,300);
    const [saved]=await db`INSERT INTO npc_decisions(npc_id,world_day,action,arguments,outcome,thought) VALUES (${npcId},${day},${action},${db.json(args)},${outcome},${thought}) RETURNING id`;
    await db`UPDATE npc_state SET last_decision_at=now(),updated_at=now() WHERE id=${npcId}`;
    if(args.reaction)await cardial.recordReaction(day,args,rows.map(row=>row.id));
    if(action==='vent_to_person')await cardial.relievePressure();
    broadcast('agent_event',{npcId,npcName:self.name,stage:'tool',status:'completed',tool:action,outcome,at:new Date().toISOString()});
    broadcast('agent_event',{eventId:Number(saved.id),npcId,npcName:self.name,stage:'decision',status:'completed',tool:action,outcome,thought,arguments:args,at:new Date().toISOString()});
  } catch(error) {
    if(controller.signal.aborted&&/Nova mensagem|Atenção: alguém chegou perto/.test(String(controller.signal.reason)))return;
    const outcome=safeText(error instanceof Error?error.message:'A escolha não pôde ser realizada.',500);
    if(notifications.length)await db`UPDATE npc_notifications SET delivered_at=now() WHERE id IN ${db(notifications.map(n=>n.id))}`;
    const retrySeconds=outcome==='Não foi possível compor uma fala agora.'?3:8;
    await db`UPDATE npc_state SET last_decision_at=now(),next_thought_at=now()+(${retrySeconds}*interval '1 second'),updated_at=now() WHERE id=${npcId}`;
    await db`INSERT INTO npc_decisions(npc_id,world_day,action,arguments,outcome) VALUES (${npcId},${day},'decision_error','{}'::jsonb,${outcome})`;
    broadcast('agent_event',{npcId,npcName:self.name,stage:'decision',status:'error',outcome,at:new Date().toISOString()});
    console.error(`[Theote] decisão de ${npcId}: ${outcome}`);
  } finally {
    clearTimeout(timer);
    activeThoughts.delete(npcId);
  }
}

async function executeAction(self:Row,rows:Row[],action:string,args:Record<string,unknown>,signal?:AbortSignal) {
  const person=findPerson(rows,args.personId);
  const clock=await getWorldClock();
  if(clock.hour===12&&clock.minute<15&&!['say_to_person','say_to_group'].includes(action))throw new Error('Durante a reunião, fique no largo e participe da conversa até 12:15.');
  switch(action) {
    case 'continue_journey': return 'Continuou o caminho que já havia escolhido.';
    case 'visit_landmark': {
      const place=landmarks.find(item=>item.id===args.landmarkId);if(!place)throw new Error('Esse lugar não foi encontrado.');
      if(!isWalkable(place.x,place.z))throw new Error(`${place.name} está bloqueado neste momento.`);
      if(Math.hypot(place.x-self.x,place.z-self.z)<2.2)throw new Error(`Já está em ${place.name}.`);
      if(self.mode==='walking'&&self.goal_x===place.x&&self.goal_z===place.z)return `Já estava a caminho de ${place.name}.`;
      await db`UPDATE npc_state SET goal_x=${place.x},goal_z=${place.z},goal_person_id=NULL,mode='walking',sleep_on_arrival=false,next_thought_at=NULL,updated_at=now() WHERE id=${self.id}`;
      return `Começou a caminhar até ${place.name}.`;
    }
    case 'wander':case 'walk_to_point': {
      const x=bounded(args.x),z=bounded(args.z);
      if(!isWalkable(x,z))throw new Error('Esse ponto está ocupado por uma parede, objeto ou água.');
      await db`UPDATE npc_state SET goal_x=${x},goal_z=${z},goal_person_id=NULL,mode='walking',sleep_on_arrival=false,updated_at=now() WHERE id=${self.id}`;
      return `Começou a caminhar até um ponto próximo (${x.toFixed(1)}, ${z.toFixed(1)}).`;
    }
    case 'walk_to_person': {
      if(!person||person.id===self.id)throw new Error('Essa pessoa não foi encontrada.');
      if(Math.hypot(person.x-self.x,person.z-self.z)<=2&&segmentWalkable(self,person))throw new Error(`${person.name} já está perto.`);
      await db.begin(async tx=>{
        await tx`UPDATE npc_state SET goal_x=${person.x},goal_z=${person.z},goal_person_id=${person.id},mode='walking',sleep_on_arrival=false,updated_at=now() WHERE id=${self.id}`;
        await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${person.id},${`${self.name} está vindo encontrar você. Se quiser, vá ao encontro; vocês podem se encontrar no caminho.`})`;
        await tx`UPDATE npc_state SET next_thought_at=NULL,updated_at=now() WHERE id=${person.id}`;
      });
      interruptThought(person.id,'Atenção: alguém está vindo encontrar você.');
      return `Começou a buscar ${person.name}; seguirá a posição atual até encontrá-la/lo.`;
    }
    case 'follow_person': {
      if(!person||person.id===self.id)throw new Error('Essa pessoa não foi encontrada.');
      await db`UPDATE npc_state SET goal_x=NULL,goal_z=NULL,goal_person_id=${person.id},mode='following',sleep_on_arrival=false,updated_at=now() WHERE id=${self.id}`;
      return `Começou a acompanhar ${person.name}.`;
    }
    case 'walk_together': {
      if(!person||person.id===self.id)throw new Error('Essa pessoa não foi encontrada.');
      if(Math.hypot(person.x-self.x,person.z-self.z)>2)throw new Error('Converse com a pessoa de perto antes de caminharem juntos.');
      const x=bounded(args.x),z=bounded(args.z);
      await db.begin(async tx=>{
        await tx`UPDATE npc_state SET goal_x=${x},goal_z=${z},goal_person_id=NULL,mode='walking',sleep_on_arrival=false,updated_at=now() WHERE id=${self.id}`;
        await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${person.id},${`${self.name} começou a caminhar para (${x.toFixed(1)}, ${z.toFixed(1)}) depois de convidar você. Você decide se quer acompanhar.`})`;
        await tx`UPDATE npc_state SET next_thought_at=NULL,updated_at=now() WHERE id=${person.id}`;
      });
      interruptThought(person.id);
      return `Começou a caminhar; ${person.name} decidirá se acompanha.`;
    }
    case 'express': {
      if(!EMOTIONS.includes(args.emotion as typeof EMOTIONS[number]))throw new Error('Essa expressão não está disponível.');
      await db`UPDATE npc_state SET emotion=${String(args.emotion)},updated_at=now() WHERE id=${self.id}`;
      return `Expressou ${String(args.emotion)}: ${safeText(args.reason)}.`;
    }
    case 'say_to_person':case 'vent_to_person': {
      if(!person||person.id===self.id)throw new Error('Essa pessoa não está aqui.');
      const distance=Math.hypot(person.x-self.x,person.z-self.z);
      if(distance>2)throw new Error('Só consegue conversar quando está a menos de dois metros.');
      if(action==='vent_to_person'){const [feel]=await db`SELECT pressure FROM npc_affect WHERE npc_id=${self.id}`;if(Number(feel?.pressure)<55)throw new Error('Ainda não sente necessidade de desabafar.');}
      return `Está falando com ${person.name}.`;
    }
    case 'say_to_group': {
      if(conversationCircle(rows,self.id).length<3)throw new Error('Não há um grupo perto para ouvir.');
      return 'Está falando com o grupo próximo.';
    }
    case 'observe_animal': {
      const animal=ANIMALS.find(item=>item.id===args.animalId);
      if(!animal)throw new Error('Esse animal não está mais no vale.');
      const position=animalPosition(animal,clock.elapsedSeconds),distance=Math.hypot(position.x-self.x,position.z-self.z);
      if(distance>15)throw new Error('O animal está longe demais para ser visto.');
      if(distance>2.8){
        const goal=position.flying?{x:animal.x,z:animal.z}:position;
        await db`UPDATE npc_state SET goal_x=${goal.x},goal_z=${goal.z},goal_person_id=NULL,mode='walking',sleep_on_arrival=false,next_thought_at=NULL,updated_at=now() WHERE id=${self.id}`;
        return `Começou a se aproximar para observar ${animal.name.toLowerCase()}.`;
      }
      await db`INSERT INTO npc_memory_events(npc_id,kind,subject,summary,importance,world_day) VALUES (${self.id},'animal',${animal.id},${`Observei ${animal.name.toLowerCase()} ${position.flying?'em voo':'no chão'} perto de mim.`},2,${clock.day}) ON CONFLICT (npc_id,kind,subject,world_day) DO UPDATE SET summary=EXCLUDED.summary,created_at=now()`;
      await db`UPDATE npc_affect SET mood='curiosity',valence=LEAST(100,valence+2),updated_at=now() WHERE npc_id=${self.id}`;
      return `Observou ${animal.name.toLowerCase()} ${position.flying?'voando':'no chão'} e guardou a lembrança.`;
    }
    case 'invite_to_see_animal': {
      const animal=ANIMALS.find(item=>item.id===args.animalId);
      if(!animal||!person||person.id===self.id||Math.hypot(person.x-self.x,person.z-self.z)>2)throw new Error('A pessoa ou o animal já se afastou.');
      const position=animalPosition(animal,clock.elapsedSeconds);
      if(Math.hypot(position.x-self.x,position.z-self.z)>15)throw new Error('O animal já se afastou.');
      return `Convidou ${person.name} a observar ${animal.name.toLowerCase()}.`;
    }
    case 'give_coin': {
      if(!person||person.id===self.id)throw new Error('Essa pessoa não está aqui.');
      const {day}=await getWorldClock();
      return giveCoin(self.id,person.id,Number(args.amount),day);
    }
    case 'propose_agreement': {
      if(!person||person.id===self.id)throw new Error('Escolha outra pessoa para o acordo.');
      return proposeAgreement(self.id,person.id,Number(args.messageId));
    }
    case 'sign_agreement': return decideAgreement(self.id,Number(args.agreementId),true);
    case 'decline_agreement': return decideAgreement(self.id,Number(args.agreementId),false);
    case 'buy_item': return buyItem(self.id,args.itemId,args.amount);
    case 'explore_place': return exploreSite(self.id,args.siteId);
    case 'talk_to_goblin': return talkToGoblin(self.id,signal);
    case 'invite_to_talk': return createInvitation(self.id,Array.isArray(args.inviteeIds)?args.inviteeIds.map(String):[],Number(args.sourceMessageId),String(args.siteId),Number(args.targetDay),Number(args.targetHour),Number(args.targetMinute));
    case 'accept_invitation': return respondInvitation(self.id,Number(args.invitationId),true);
    case 'decline_invitation': return respondInvitation(self.id,Number(args.invitationId),false);
    case 'attend_invitation': return decideTravel(self.id,Number(args.invitationId),true);
    case 'skip_invitation': return decideTravel(self.id,Number(args.invitationId),false);
    case 'consume_item': return consumeItem(self.id,args.itemId);
    case 'donate_item': {
      if(!person)throw new Error('Essa pessoa não está aqui.');
      return donateItem(self.id,person.id,args.itemId,args.amount);
    }
    case 'leave_world': return leaveWorld(self.id);
    case 'go_home_to_sleep': {
      const [x,z]=self.profile.bedPosition??homeEntrance(self.home_id);
      const wakeHour=Math.max(0,Math.min(23,Math.floor(Number(args.wakeHour))));
      const {day,hour,elapsedSeconds}=await getWorldClock();
      const wakeElapsed=elapsedSecondsForWorldTime(day+(wakeHour<=hour?1:0),wakeHour);
      const wakeIn=Math.max(60,wakeElapsed-elapsedSeconds);
      await db`UPDATE npc_state SET goal_x=${x},goal_z=${z},goal_person_id=NULL,mode='walking',sleep_on_arrival=true,planned_wake_at=now()+(${wakeIn}*interval '1 second'),next_thought_at=NULL,updated_at=now() WHERE id=${self.id}`;
      return `Está indo para a própria cama e programou o despertar para ${String(wakeHour).padStart(2,'0')}:00.`;
    }
    case 'wake_up': {
      if(self.stamina<25)throw new Error('Ainda está cansado demais para levantar.');
      const [x,z]=homeEntrance(self.home_id);
      await db`UPDATE npc_state SET x=${x},z=${z+1.4},goal_x=NULL,goal_z=NULL,goal_person_id=NULL,mode='wandering',sleep_on_arrival=false,updated_at=now() WHERE id=${self.id}`;
      return 'Levantou-se e saiu de casa.';
    }
    case 'rest':
      await db`UPDATE npc_state SET mode='resting',goal_x=NULL,goal_z=NULL,goal_person_id=NULL,next_thought_at=now()+interval '12 seconds',updated_at=now() WHERE id=${self.id}`;
      return 'Fez uma pausa breve de 12 segundos.';
    default: throw new Error('Ação não reconhecida.');
  }
}

async function speak(fromId:string,toId:string|null,topic:string,venting=false,signal?:AbortSignal,replyToMessageId:number|null=null) {
  const rows=await db<Row[]>`SELECT * FROM npc_state WHERE mode<>'departed' ORDER BY id`;
  const speaker=rows.find(row=>row.id===fromId),listener=toId?rows.find(row=>row.id===toId):null;
  if(!speaker||toId&&!listener)throw new Error('A outra pessoa não está disponível.');
  if(listener&&Math.hypot(speaker.x-listener.x,speaker.z-listener.z)>2)throw new Error('A outra pessoa já está longe demais para ouvir.');
  const circle=conversationCircle(rows,fromId);
  if(circle.length<2||!toId&&circle.length<3)throw new Error('Não há pessoas perto para ouvir.');
  const participants=circle.map(person=>person.id).sort(),listeners=circle.filter(person=>person.id!==fromId);
  const [quoted]=!toId&&replyToMessageId!==null&&Number.isSafeInteger(replyToMessageId)&&replyToMessageId>0?await db`SELECT id,from_npc_id,speaker_name,content,participants FROM dialogue_messages WHERE id=${replyToMessageId}`:[];
  const reply=quoted&&quoted.from_npc_id!==fromId&&quoted.participants?.length===participants.length&&participants.every(id=>quoted.participants.includes(id))&&listeners.some(person=>person.id===quoted.from_npc_id)?quoted:null;
  const history=await db`SELECT speaker_name,content FROM dialogue_messages WHERE participants @> ${db.json(participants)} AND created_at>=now()-interval '12 minutes' ORDER BY id DESC LIMIT 12`;
  const recentEvents=await db`SELECT n.name,d.outcome FROM npc_decisions d JOIN npc_state n ON n.id=d.npc_id WHERE d.npc_id IN ${db(participants)} AND d.created_at>=now()-interval '12 minutes' AND d.action IN ('visit_landmark','walk_to_person','go_home_to_sleep','walk_together','express') ORDER BY d.id DESC LIMIT 8`;
  const [memory]=await db`SELECT summary FROM npc_memories WHERE npc_id=${fromId}`;
  const learned=await recall(fromId,listeners.map(person=>person.id));
  const written=await db`SELECT terms,status FROM npc_agreements WHERE (proposer_id=${fromId} OR recipient_id=${fromId}) AND status IN ('proposed','signed') ORDER BY id DESC LIMIT 4`;
  const writtenContext=written.length?`Seus acordos por escrito: ${written.map(item=>`${item.status==='signed'?'firmado':'aguardando aceite'}: ${safeText(item.terms,100)}`).join(' | ')}.`:'Você não tem acordos escritos em andamento.';
  const cardial=new CardialService(fromId,speaker.profile.systemPrompt);
  const inner=await cardial.innerState();
  const recent=history.reverse().map(item=>`${item.speaker_name}: <fala>${item.content}</fala>`).join('\n');
  const {day:currentDay,hour:currentHour,minute:currentMinute}=await getWorldClock();
  const closePlaces=landmarks.filter(place=>Math.hypot(place.x-speaker.x,place.z-speaker.z)<=5).sort((a,b)=>Math.hypot(a.x-speaker.x,a.z-speaker.z)-Math.hypot(b.x-speaker.x,b.z-speaker.z)).slice(0,3).map(place=>place.name);
  const messages:ChatMessage[]=[
    {role:'system',content:`${cardial.identityPrompt}\n\nA história que você conhece: ${worldStory} Ela é parte da sua vida, mas não precisa virar o assunto de toda conversa.\n\nLembranças: ${memory?.summary||'Vocês ainda estão começando a viver neste vale.'} Episódios marcantes: ${learned.text}. Suas opiniões atuais: ${learned.beliefs}. Descobertas suas: ${learned.discoveries}. Você tem ${speaker.coins} moeda(s) agora. ${writtenContext} Você sabe que sua fome está em ${speaker.hunger.toFixed(4)}% e sua sede em ${speaker.thirst.toFixed(4)}%. Pode falar do saldo e pedir moedas a quem estiver perto. Seu estado agora: ${inner.affect.mood}; ${Number(inner.affect.pressure)>=55?'há sentimentos acumulados que podem aparecer se o assunto tocar nisso':'sem necessidade de desabafar'}. Seu jeito próprio de falar: ${speaker.profile.speechStyle??speaker.profile.personality.join(", ")}. Use seus cacoetes só quando couber; não repita a mesma expressão em falas seguidas. Fale em português cotidiano, como alguém conversando ao vivo: uma ou duas frases curtas, até 190 caracteres. Entre direto no assunto: não comece com bom dia, boa tarde, boa noite, oi, elogio automático ou o nome da pessoa. Responda ao detalhe específico da fala mais recente, sem repetir a proposta com outras palavras. Você pode discordar, pedir um detalhe, assumir uma tarefa possível, lembrar um fato real ou encerrar o assunto. Não termine toda fala com pergunta e não proponha mais objetos ou atividades só para manter a conversa. Se o grupo já concordou, avance para uma ação real ou deixe o tema descansar. Não transforme tudo em metáfora, lição de vida ou debate filosófico. Não concorde por hábito nem provoque sem motivo. Pode usar humor quando couber; evite emoji frequente. Só afirme como acontecimento o que está nas falas compartilhadas, nos fatos recentes ou na história comum. Não invente acontecimentos novos; você pode falar de hipótese ou plano usando “e se”, “talvez” ou “vamos”. Escreva somente sua fala, sem narração nem aspas. Não mencione modelos, ferramentas nem uma simulação.`},
    {role:'user',content:`Agora é dia ${currentDay}, ${String(currentHour).padStart(2,'0')}:${String(currentMinute).padStart(2,'0')}. Você está com ${listeners.map(person=>person.name).join(', ')}. ${circle.length>=3?'Todos na roda ouvem.':'Vocês dois podem se ouvir.'} ${closePlaces.length?`Lugares próximos: ${closePlaces.join(', ')}.`:'Você está entre os caminhos do vale.'}\nVocê sabe as posições exatas agora: ${rows.map(person=>`${person.name} (x=${person.x}, z=${person.z})`).join('; ')}.\n\nCoisas que estas pessoas fizeram recentemente:\n${recentEvents.length?recentEvents.reverse().map(event=>`- ${event.name}: ${event.outcome}`).join('\n'):'- Nenhum acontecimento novo registrado.'}\n\nFalas que todos os presentes realmente ouviram, da mais antiga para a mais nova:\n${recent||'Ainda não disseram nada nesta conversa.'}\n\n${reply?`Você escolheu responder diretamente à mensagem de ${reply.speaker_name}: “${reply.content}”. Ela será citada no chat, e ${reply.speaker_name} será avisado. Responda ao conteúdo dessa fala.\n`:''}${venting?'Você decidiu contar algo que vinha guardando. Fale com sinceridade, sem dramatizar.':'Você decidiu falar agora.'} Sua intenção era: ${safeText(topic,240)}. Essa intenção é só uma pista, não uma frase a repetir. Se houver uma fala recente, responda a ela sem saudação e sem recapitular toda a conversa. Se a mesma ideia apareceu várias vezes, mude para um detalhe prático que exista neste mundo, diga que não há mais o que decidir ou pare de falar sobre ela. Não invente ferramentas, suprimentos, lugares, preparativos ou planos já acertados. Se não houver fala recente, observe algo que você realmente vê ou sente agora.`},
  ];
  let result=await completeConversation({npcId:fromId,maxTokens:512,signal,messages});
  let content=spokenText(result.message?.content,speaker.name,listeners.map(person=>person.name));
  const ownRecent=history.filter(item=>item.speaker_name===speaker.name).map(item=>String(item.content));
  if(content&&repeatsRecentSpeech(content,ownRecent)) {
    result=await completeConversation({npcId:fromId,maxTokens:384,signal,messages:[...messages,{role:'assistant',content},{role:'user',content:'Essa resposta repete quase a mesma fala que você já deu. Escreva outra reação curta e específica, sem saudação, elogio automático, lista de novos itens ou pergunta genérica. Se o tema acabou, diga isso naturalmente.'}]});
    content=spokenText(result.message?.content,speaker.name,listeners.map(person=>person.name));
  }
  if(!content)throw new Error('Não foi possível compor uma fala agora.');
  if(repeatsRecentSpeech(content,ownRecent))throw new Error('A conversa estava se repetindo; é melhor fazer uma pausa.');
  signal?.throwIfAborted();
  const {day,hour,minute}=await getWorldClock();
  const preservedJourneys=new Set<string>();
  const saved=await db.begin(async tx=>{
    const [message]=await tx`INSERT INTO dialogue_messages(world_day,world_hour,world_minute,from_npc_id,to_npc_id,speaker_name,content,participants,reply_to_message_id) VALUES (${day},${hour},${minute},${fromId},${toId},${speaker.name},${content},${tx.json(participants)},${reply?.id??null}) RETURNING id,created_at`;
    for(const id of participants)await tx`INSERT INTO npc_memory_events(npc_id,kind,subject,summary,importance,world_day) VALUES (${id},'conversation',${participants.join(':')},${`${speaker.name} disse: ${safeText(content,230)}`},1,${day}) ON CONFLICT (npc_id,kind,subject,world_day) DO UPDATE SET summary=EXCLUDED.summary,created_at=now()`;
    if(toId||reply)await tx`INSERT INTO npc_conversation_waits(message_id,sender_id,recipient_id,deadline_at) VALUES (${message.id},${fromId},${toId??reply.from_npc_id},now()+interval '30 seconds')`;
    for(const person of listeners) {
      const notice=reply?.from_npc_id===person.id?`${speaker.name} respondeu diretamente à sua mensagem na roda: “${content}”. Mensagem citada: “${reply.content}”.`:circle.length>=3?`${speaker.name} falou na roda, diante de todos: “${content}”. Você pode responder ou seguir com outra coisa.`:`${speaker.name} falou com você: “${content}”. Você pode responder ou seguir com outra coisa.`;
      await tx`INSERT INTO npc_notifications(npc_id,message,dialogue_message_id) VALUES (${person.id},${notice},${toId===null||toId===person.id?message.id:null})`;
      interruptThought(person.id,'Nova mensagem recebida.');
      // The noon gathering is compulsory; hearing someone on the way interrupts
      // the model call but does not erase the scripted trip to the square.
      // The same applies to a meeting the resident already chose to attend.
      const [invitedJourney]=await tx`SELECT 1 FROM conversation_invitations i JOIN conversation_invitees p ON p.invitation_id=i.id JOIN npc_state n ON n.id=p.npc_id WHERE p.npc_id=${person.id} AND p.travel_decision='going' AND n.mode='walking' AND abs(n.goal_x-i.x)<0.01 AND abs(n.goal_z-i.z)<0.01 AND i.target_day*1440+i.target_hour*60+i.target_minute BETWEEN ${day*1440+hour*60+minute-15} AND ${day*1440+hour*60+minute+30} LIMIT 1`;
      const preserveJourney=Boolean(invitedJourney);
      if(preserveJourney)preservedJourneys.add(person.id);
      await tx`UPDATE npc_state SET next_thought_at=NULL,
        goal_x=CASE WHEN ${preserveJourney} OR (${hour===12} AND mode='walking' AND goal_z=0 AND goal_x BETWEEN -2 AND 2) THEN goal_x ELSE NULL END,
        goal_z=CASE WHEN ${preserveJourney} OR (${hour===12} AND mode='walking' AND goal_z=0 AND goal_x BETWEEN -2 AND 2) THEN goal_z ELSE NULL END,
        goal_person_id=CASE WHEN ${preserveJourney} OR (${hour===12} AND mode='walking' AND goal_z=0 AND goal_x BETWEEN -2 AND 2) THEN goal_person_id ELSE NULL END,
        mode=CASE WHEN ${preserveJourney} OR (${hour===12} AND mode='walking' AND goal_z=0 AND goal_x BETWEEN -2 AND 2) THEN mode WHEN mode IN ('walking','following','resting') THEN 'wandering' ELSE mode END,
        updated_at=now() WHERE id=${person.id}`;
      if(!reply)await tx`UPDATE npc_conversation_waits AS w SET resolved_at=now() FROM dialogue_messages AS original WHERE original.id=w.message_id AND w.sender_id=${person.id} AND original.participants @> ${tx.json([fromId])} AND w.resolved_at IS NULL`;
    }
    if(reply)await tx`UPDATE npc_conversation_waits SET resolved_at=now() WHERE message_id=${reply.id} AND resolved_at IS NULL`;
    await tx`UPDATE npc_state SET thirst=LEAST(100,thirst+0.0005),next_thought_at=NULL,updated_at=now() WHERE id=${fromId}`;
    return message;
  });
  for(const person of circle)await recordSocialInteraction(person.id,person.id===fromId?listeners[0].id:fromId,day,'dialogue',Number(saved.id));
  for(const person of listeners) {
    if(['walking','following','resting'].includes(person.mode)&&!preservedJourneys.has(person.id))broadcast('agent_event',{npcId:person.id,npcName:person.name,stage:'tool',status:'interrupted',outcome:`Parou para ouvir ${speaker.name}.`,at:new Date().toISOString()});
    broadcast('agent_event',{npcId:person.id,npcName:person.name,stage:'message_arrived',status:'started',outcome:`${speaker.name} falou na conversa.`,at:new Date().toISOString()});
  }
  broadcast('dialogue',{id:Number(saved.id),world_day:day,world_hour:hour,world_minute:minute,from_npc_id:fromId,to_npc_id:toId,participants,speaker_name:speaker.name,content,created_at:saved.created_at,reply_to_message_id:reply?Number(reply.id):null,reply_to_speaker_name:reply?.speaker_name??null,reply_to_content:reply?.content??null});
  if(reply)broadcast('agent_event',{npcId:reply.from_npc_id,npcName:reply.speaker_name,stage:'reply_received',status:'started',outcome:`${speaker.name} respondeu diretamente à mensagem de ${reply.speaker_name}.`,at:new Date().toISOString()});
}

export async function summarizeClosedDays() {
  if(!aiEnabled)return;
  const {day}=await getWorldClock();if(day<=1)return;
  const completedDay=day-1;
  const [state]=await db`SELECT last_summary_day FROM world_state WHERE id=1`;
  if(Number(state.last_summary_day)>=completedDay)return;
  for(const npc of await db`SELECT id,name,profile FROM npc_state ORDER BY id`) {
    const [memory]=await db`SELECT summary,last_summarized_day FROM npc_memories WHERE npc_id=${npc.id}`;
    if(Number(memory.last_summarized_day)>=completedDay)continue;
    const decisions=await db`SELECT action,outcome FROM npc_decisions WHERE npc_id=${npc.id} AND world_day=${completedDay}
      AND action NOT IN ('continue_journey','rest','decision_error') AND (action<>'consider_goblin_claim' OR arguments->>'remembered'='true') ORDER BY id`;
    const conversations=await db`SELECT m.speaker_name,m.content FROM dialogue_messages m LEFT JOIN goblin_torments t ON t.message_id=m.id OR t.message_id=m.reply_to_message_id
      WHERE m.world_day=${completedDay} AND m.participants @> ${db.json([npc.id])} AND (t.message_id IS NULL OR t.remembered=true) ORDER BY m.id`;
    const choices=[...new Set(decisions.map(d=>`${d.action}: ${d.outcome}`))].slice(-8);
    const exchanges=conversations.slice(-10).map(c=>`${c.speaker_name}: ${safeText(c.content,120)}`);
    if(choices.length||exchanges.length) {
      const previous=safeText(memory.summary,700);
      const summary=safeText(`${previous?`${previous}\n`:''}Dia ${completedDay}. Lugares e ações: ${choices.join(' ')} Conversas: ${exchanges.join(' | ')}`,2200);
      await db`UPDATE npc_memories SET summary=${summary},last_summarized_day=${completedDay},updated_at=now() WHERE npc_id=${npc.id}`;
    } else await db`UPDATE npc_memories SET last_summarized_day=${completedDay},updated_at=now() WHERE npc_id=${npc.id}`;
  }
  await db`UPDATE world_state SET last_summary_day=${completedDay},updated_at=now() WHERE id=1`;
}

export function schedulerReady() { return aiEnabled; }
