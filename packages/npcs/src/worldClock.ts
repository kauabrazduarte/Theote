// One world day is thirty real minutes. Relative to 06:00–18:00, 18:00–23:00
// advances twice as fast and 23:00–06:00 advances ten times as fast.
export const REAL_SECONDS_PER_DAY=1800;
export const DAY_SECONDS_PER_HOUR=REAL_SECONDS_PER_DAY/(12+5/2+7/10);
export const EVENING_SECONDS_PER_HOUR=DAY_SECONDS_PER_HOUR/2;
export const NIGHT_SECONDS_PER_HOUR=DAY_SECONDS_PER_HOUR/10;
const SIX=6*NIGHT_SECONDS_PER_HOUR;
const EIGHTEEN=SIX+12*DAY_SECONDS_PER_HOUR;
const TWENTY_THREE=EIGHTEEN+5*EVENING_SECONDS_PER_HOUR;

export function secondsPerWorldHour(hour:number) {
  return hour<6||hour>=23?NIGHT_SECONDS_PER_HOUR:hour>=18?EVENING_SECONDS_PER_HOUR:DAY_SECONDS_PER_HOUR;
}

export function clockFromElapsedSeconds(elapsedSeconds:number) {
  const elapsed=Math.max(0,elapsedSeconds);
  const dayIndex=Math.floor(elapsed/REAL_SECONDS_PER_DAY);
  const second=elapsed%REAL_SECONDS_PER_DAY;
  const hourOfDay=second<SIX?second/NIGHT_SECONDS_PER_HOUR:second<EIGHTEEN?6+(second-SIX)/DAY_SECONDS_PER_HOUR:second<TWENTY_THREE?18+(second-EIGHTEEN)/EVENING_SECONDS_PER_HOUR:23+(second-TWENTY_THREE)/NIGHT_SECONDS_PER_HOUR;
  const totalMinutes=Math.floor(hourOfDay*60);
  return {day:dayIndex+1,hour:Math.floor(totalMinutes/60),minute:totalMinutes%60,phase:hourOfDay/24,elapsedSeconds:elapsed};
}

export function elapsedSecondsForWorldTime(day:number,hour:number,minute=0) {
  const time=hour+minute/60;
  const withinDay=time<6?time*NIGHT_SECONDS_PER_HOUR:time<18?SIX+(time-6)*DAY_SECONDS_PER_HOUR:time<23?EIGHTEEN+(time-18)*EVENING_SECONDS_PER_HOUR:TWENTY_THREE+(time-23)*NIGHT_SECONDS_PER_HOUR;
  return (day-1)*REAL_SECONDS_PER_DAY+withinDay;
}

export function worldHoursAtElapsed(elapsedSeconds:number) {
  const clock=clockFromElapsedSeconds(elapsedSeconds);
  return (clock.day-1)*24+clock.phase*24;
}
