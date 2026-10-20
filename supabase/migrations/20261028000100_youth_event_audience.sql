-- Phase 10 · Youth ministry and families, step 1: the youth event audience.
--
-- A new enum value can't be used in the transaction that adds it, so this
-- migration does nothing else. Youth events reuse the Phase 4 events system
-- (series, occurrences, capacity, deadlines, waitlists) with
-- `audience = 'youth'`; who may see and register for them is decided by the
-- youth schema in the following migrations. Until a youth group is attached
-- (youth.event_settings), a youth-audience event is visible to nobody.
alter type events.audience add value if not exists 'youth';
