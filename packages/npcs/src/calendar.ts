/** Day 1 begins on 1 January in year 05 after the Grito. */
export function worldDate(worldDay:number) {
  const date=new Date(0);
  date.setUTCFullYear(5,0,Math.max(1,Math.floor(worldDay)));
  date.setUTCHours(0,0,0,0);
  return {day:date.getUTCDate(),month:date.getUTCMonth()+1,year:date.getUTCFullYear()};
}

export function formatWorldDate(worldDay:number) {
  const date=worldDate(worldDay);
  return `${String(date.day).padStart(2,'0')}/${String(date.month).padStart(2,'0')}/${String(date.year).padStart(2,'0')} A.G.`;
}
