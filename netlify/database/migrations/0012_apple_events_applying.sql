-- 0012: an App Store Server Notification counts as seen only once it has been applied.
-- Until then its row holds applying_since, the moment a delivery took it, and a second
-- delivery that finds it held is turned away, so two at once apply it once; a hold older
-- than ten minutes is a delivery that never finished, and the next one takes it over.
-- NULL is applied: every row from before this column, and every row the code before it
-- writes, as that code counted a notification seen the moment it arrived.
ALTER TABLE apple_events ADD COLUMN IF NOT EXISTS applying_since TIMESTAMPTZ;
