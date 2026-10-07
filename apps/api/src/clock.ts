import { db } from './database';
import { clockFromElapsedSeconds } from '@theote/npcs/worldClock';

export async function getWorldClock() {
  const [row]=await db`SELECT GREATEST(0,EXTRACT(EPOCH FROM now()-started_at))::float8 AS elapsed_seconds FROM world_state WHERE id=1`;
  const elapsedSeconds=Number(row?.elapsed_seconds??0);
  return clockFromElapsedSeconds(elapsedSeconds);
}
