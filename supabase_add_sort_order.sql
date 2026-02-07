-- Add sort_order column for plan ordering
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS sort_order integer;

-- Optional: backfill sort_order for existing rows (per date)
-- This uses time/updated_at/created_at/id as a stable fallback ordering.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY date
      ORDER BY
        CASE WHEN time IS NULL THEN 1 ELSE 0 END,
        time NULLS LAST,
        COALESCE(updated_at, created_at) NULLS LAST,
        id
    ) - 1 AS rn
  FROM public.plans
  WHERE deleted_at IS NULL
)
UPDATE public.plans p
SET sort_order = ranked.rn
FROM ranked
WHERE p.id = ranked.id
  AND p.sort_order IS NULL;

-- Optional index for faster per-date ordering
CREATE INDEX IF NOT EXISTS plans_date_sort_order_idx
  ON public.plans (date, sort_order);

-- Add end_time column for time-range schedules (e.g. 14:00-17:00)
-- Keep this as text to match existing plans.time column type.
ALTER TABLE public.plans
  ADD COLUMN IF NOT EXISTS end_time text;

-- If end_time already exists as time, normalize it to text for compatibility.
ALTER TABLE public.plans
  ALTER COLUMN end_time TYPE text USING end_time::text;

-- Optional guard: disallow start/end equality when both are set.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'plans_time_not_equal_chk'
  ) THEN
    ALTER TABLE public.plans
      ADD CONSTRAINT plans_time_not_equal_chk
      CHECK (
        time IS NULL OR btrim(time) = '' OR
        end_time IS NULL OR btrim(end_time) = '' OR
        btrim(time) <> btrim(end_time)
      ) NOT VALID;
  END IF;
END
$$;
