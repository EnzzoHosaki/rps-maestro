-- Add queue_name column to automations table
ALTER TABLE automations 
ADD COLUMN queue_name VARCHAR(255) NOT NULL DEFAULT 'automation_jobs';
