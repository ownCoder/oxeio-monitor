-- Synthetic preview database only; never apply to production.
UPDATE office_entries SET version = 2 WHERE kind = 'checklist_template';
SELECT id, kind, version FROM office_entries WHERE kind = 'checklist_template';
