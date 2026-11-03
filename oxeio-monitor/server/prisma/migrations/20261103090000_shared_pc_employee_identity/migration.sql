-- Preserve all existing IDs and historical ownership. Only one active login per Windows slot.
DROP INDEX "devices_hostname_windows_username_key";
CREATE UNIQUE INDEX "devices_hostname_windows_username_employee_id_key"
  ON "devices"("hostname", "windows_username", "employee_id");
CREATE UNIQUE INDEX "devices_active_windows_slot_key"
  ON "devices"("hostname", "windows_username") WHERE "status" = 'active';
