import { clockFromElapsedSeconds } from '@theote/npcs/worldClock';

const STORAGE_KEY = 'theote-world-start-v1';
let cachedStart: number | null = null;

/** One in-world day passes per thirty real minutes; the stored start time makes visits continuous. */
export function getWorldTime(now = Date.now()) {
  if (cachedStart === null) {
    cachedStart = now;
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(saved) && saved > 0) cachedStart = saved;
      else localStorage.setItem(STORAGE_KEY, String(now));
    } catch { /* The world clock still works for this visit when storage is unavailable. */ }
  }
  const start = cachedStart;
  const elapsed = Math.max(0, now - start);
  const {day,phase,hour,minute}=clockFromElapsedSeconds(elapsed/1000);
  return {day,phase,hour,minute};
}

export function formatWorldClock(hour: number, minute: number) {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}
