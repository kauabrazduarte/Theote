-- Residents inside moved houses keep their relative position in the new rooms.
-- Residents already elsewhere continue their current activity.
UPDATE npc_state SET
  z=CASE WHEN abs(x-10)<3.15 AND abs(z-8)<3 THEN z+1.5 ELSE z END,
  goal_z=CASE WHEN goal_person_id IS NULL AND abs(goal_x-10)<3.2 AND abs(goal_z-8)<4 THEN goal_z+1.5 ELSE goal_z END
WHERE home_id='casa-2';
UPDATE npc_state SET
  z=CASE WHEN abs(x-10)<3.15 AND abs(z+1.5)<3 THEN z-6.5 ELSE z END,
  goal_z=CASE WHEN goal_person_id IS NULL AND abs(goal_x-10)<3.2 AND abs(goal_z+1.5)<4 THEN goal_z-6.5 ELSE goal_z END
WHERE home_id='casa-4';
UPDATE npc_state SET
  z=CASE WHEN abs(x-22)<3.15 AND abs(z-7.5)<3 THEN z+2 ELSE z END,
  goal_z=CASE WHEN goal_person_id IS NULL AND abs(goal_x-22)<3.2 AND abs(goal_z-7.5)<4 THEN goal_z+2 ELSE goal_z END
WHERE home_id='casa-6';
UPDATE npc_state SET
  z=CASE WHEN abs(x-22)<3.15 AND abs(z+16)<3 THEN z+8 ELSE z END,
  goal_z=CASE WHEN goal_person_id IS NULL AND abs(goal_x-22)<3.2 AND abs(goal_z+16)<4 THEN goal_z+8 ELSE goal_z END
WHERE home_id='casa-7';
