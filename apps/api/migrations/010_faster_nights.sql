-- Preserve the current world day and hour while changing the rate of night.
WITH old_clock AS (
  SELECT id,
    GREATEST(0,EXTRACT(EPOCH FROM now()-started_at))::double precision AS elapsed
  FROM world_state
), translated AS (
  SELECT id, FLOOR(elapsed/3600)*3600 AS completed_days,
    ((elapsed-FLOOR(elapsed/3600)*3600)/150) AS old_hour
  FROM old_clock
)
UPDATE world_state AS world SET started_at=now()-
  ((translated.completed_days+CASE
    WHEN translated.old_hour<6 THEN translated.old_hour*100
    WHEN translated.old_hour<18 THEN 600+(translated.old_hour-6)*200
    ELSE 3000+(translated.old_hour-18)*100
  END)*interval '1 second'),updated_at=now()
FROM translated WHERE world.id=translated.id;
