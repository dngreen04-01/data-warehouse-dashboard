-- Add date range support for on-demand report sending
-- Date: 2026-01-12
-- Purpose: Allow users to send reports for any week, not just the previous week

-- ============================================================================
-- 1. Add Date Columns to Report Queue
-- ============================================================================
ALTER TABLE dw.report_queue ADD COLUMN IF NOT EXISTS start_date DATE;
ALTER TABLE dw.report_queue ADD COLUMN IF NOT EXISTS end_date DATE;

-- ============================================================================
-- 2. Update queue_instant_report RPC to Accept Date Parameters
-- ============================================================================
-- Drop the old function signature first to avoid ambiguity
DROP FUNCTION IF EXISTS queue_instant_report(TEXT, TEXT);

-- Default NULL means "use last week" (backward compatible)
CREATE OR REPLACE FUNCTION queue_instant_report(
  p_email TEXT,
  p_report_type TEXT,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
)
RETURNS dw.report_queue
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result dw.report_queue;
BEGIN
  INSERT INTO dw.report_queue (email, report_type, start_date, end_date)
  VALUES (p_email, p_report_type, p_start_date, p_end_date)
  RETURNING * INTO v_result;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION queue_instant_report IS 'Queue a report for immediate sending. If dates are NULL, worker uses previous week.';
