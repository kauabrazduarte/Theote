import { db } from './database';
import { getWorldClock } from './clock';
import { broadcast } from './realtime';

export async function listAgreements() {
  return db`SELECT a.id,a.proposer_id,a.recipient_id,p.name AS proposer_name,r.name AS recipient_name,
    a.source_message_id,a.terms,a.status,a.proposed_day,a.decided_day,a.created_at,a.decided_at
    FROM npc_agreements a JOIN npc_state p ON p.id=a.proposer_id JOIN npc_state r ON r.id=a.recipient_id
    ORDER BY a.id DESC LIMIT 200`;
}

export async function proposeAgreement(proposerId:string,recipientId:string,messageId:number) {
  if(!Number.isSafeInteger(messageId)||messageId<=0||proposerId===recipientId)throw new Error('Proposta de acordo inválida.');
  const {day}=await getWorldClock();
  const agreement=await db.begin(async tx=>{
    const [source]=await tx`SELECT id,from_npc_id,content,participants,created_at FROM dialogue_messages WHERE id=${messageId}`;
    const [proposer]=await tx`SELECT id,name,x,z,mode FROM npc_state WHERE id=${proposerId}`;
    const [recipient]=await tx`SELECT id,name,x,z,mode FROM npc_state WHERE id=${recipientId}`;
    if(!source||source.from_npc_id!==proposerId||!source.participants.includes(recipientId)||Date.now()-new Date(source.created_at).getTime()>120_000)throw new Error('A proposta precisa partir de uma fala recente sua, ouvida pela outra pessoa.');
    if(!proposer||!recipient||['sleeping','departed'].includes(proposer.mode)||['sleeping','departed'].includes(recipient.mode)||Math.hypot(proposer.x-recipient.x,proposer.z-recipient.z)>2)throw new Error('As duas pessoas precisam estar próximas para propor o acordo.');
    const terms=String(source.content).trim().slice(0,320);
    if(terms.length<12)throw new Error('A proposta precisa ter um compromisso escrito.');
    const [saved]=await tx`INSERT INTO npc_agreements(proposer_id,recipient_id,source_message_id,terms,proposed_day)
      VALUES (${proposerId},${recipientId},${messageId},${terms},${day}) ON CONFLICT (source_message_id,recipient_id) DO NOTHING RETURNING id`;
    if(!saved)throw new Error('Essa proposta já foi registrada.');
    await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${recipientId},${`${proposer.name} propôs um acordo por escrito (#${saved.id}): “${terms}”. Leia e decida se aceita ou recusa; ainda não está firmado.`})`;
    await tx`UPDATE npc_state SET next_thought_at=NULL,updated_at=now() WHERE id=${recipientId}`;
    return {id:Number(saved.id),recipientName:recipient.name};
  });
  broadcast('agreement_changed',{id:agreement.id});
  return `Registrou a proposta de acordo #${agreement.id} para ${agreement.recipientName}; aguarda a resposta.`;
}

export async function decideAgreement(recipientId:string,agreementId:number,accept:boolean) {
  if(!Number.isSafeInteger(agreementId)||agreementId<=0)throw new Error('Acordo inválido.');
  const {day}=await getWorldClock();
  const agreement=await db.begin(async tx=>{
    const [saved]=await tx`UPDATE npc_agreements SET status=${accept?'signed':'declined'},decided_day=${day},decided_at=now()
      WHERE id=${agreementId} AND recipient_id=${recipientId} AND status='proposed' RETURNING proposer_id,recipient_id,terms`;
    if(!saved)throw new Error('A proposta já foi decidida ou não pertence a você.');
    const [recipient]=await tx`SELECT name FROM npc_state WHERE id=${recipientId}`;
    await tx`INSERT INTO npc_notifications(npc_id,message) VALUES (${saved.proposer_id},${`${recipient.name} ${accept?'aceitou e assinou':'recusou'} o acordo #${agreementId}: “${saved.terms}”.`})`;
    await tx`UPDATE npc_state SET next_thought_at=NULL,updated_at=now() WHERE id=${saved.proposer_id}`;
    return saved;
  });
  broadcast('agreement_changed',{id:agreementId});
  return accept?`Assinou o acordo #${agreementId}; as duas pessoas agora têm um compromisso escrito.`:`Recusou a proposta de acordo #${agreementId}.`;
}
