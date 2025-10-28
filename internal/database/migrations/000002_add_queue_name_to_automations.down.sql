-- Remove queue_name column from automations table
ALTER TABLE automations 
DROP COLUMN queue_name;
