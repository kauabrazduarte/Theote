-- Translate the existing clock without changing its displayed day or hour.
-- Recalculate planned wake timestamps against the new clock at the same time.
DO $$
DECLARE
  old_start timestamptz;
  old_elapsed double precision;
  old_second double precision;
  old_hour double precision;
  new_elapsed double precision;
  planned record;
  planned_elapsed double precision;
  planned_second double precision;
  planned_hour double precision;
  new_planned double precision;
  day_rate constant double precision := 3600.0 / 15.2;
  evening_rate constant double precision := 3600.0 / 30.4;
  night_rate constant double precision := 3600.0 / 152.0;
BEGIN
  SELECT started_at INTO old_start FROM world_state WHERE id=1 FOR UPDATE;
  old_elapsed := GREATEST(0, EXTRACT(EPOCH FROM now()-old_start));
  old_second := old_elapsed - FLOOR(old_elapsed/3600)*3600;
  old_hour := CASE
    WHEN old_second<600 THEN old_second/100
    WHEN old_second<3000 THEN 6+(old_second-600)/200
    ELSE 18+(old_second-3000)/100 END;
  new_elapsed := FLOOR(old_elapsed/3600)*3600 + CASE
    WHEN old_hour<6 THEN old_hour*night_rate
    WHEN old_hour<18 THEN 6*night_rate+(old_hour-6)*day_rate
    WHEN old_hour<23 THEN 6*night_rate+12*day_rate+(old_hour-18)*evening_rate
    ELSE 6*night_rate+12*day_rate+5*evening_rate+(old_hour-23)*night_rate END;

  FOR planned IN SELECT id,planned_wake_at FROM npc_state WHERE planned_wake_at IS NOT NULL LOOP
    planned_elapsed := GREATEST(0,EXTRACT(EPOCH FROM planned.planned_wake_at-old_start));
    planned_second := planned_elapsed - FLOOR(planned_elapsed/3600)*3600;
    planned_hour := CASE
      WHEN planned_second<600 THEN planned_second/100
      WHEN planned_second<3000 THEN 6+(planned_second-600)/200
      ELSE 18+(planned_second-3000)/100 END;
    new_planned := FLOOR(planned_elapsed/3600)*3600 + CASE
      WHEN planned_hour<6 THEN planned_hour*night_rate
      WHEN planned_hour<18 THEN 6*night_rate+(planned_hour-6)*day_rate
      WHEN planned_hour<23 THEN 6*night_rate+12*day_rate+(planned_hour-18)*evening_rate
      ELSE 6*night_rate+12*day_rate+5*evening_rate+(planned_hour-23)*night_rate END;
    UPDATE npc_state SET planned_wake_at=now()+((new_planned-new_elapsed)*interval '1 second') WHERE id=planned.id;
  END LOOP;

  UPDATE world_state SET started_at=now()-(new_elapsed*interval '1 second'),updated_at=now() WHERE id=1;
END $$;
