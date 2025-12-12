-- Grants usage on schemas to authenticated users
GRANT USAGE ON SCHEMA dw TO authenticated;
GRANT USAGE ON SCHEMA mart TO authenticated;

-- Grants select on all tables in schemas to authenticated users
-- (In a production environment with strict RLS, you might be more selective)
GRANT SELECT ON ALL TABLES IN SCHEMA dw TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA mart TO authenticated;

-- Ensure future tables also get these permissions
ALTER DEFAULT PRIVILEGES IN SCHEMA dw GRANT SELECT ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA mart GRANT SELECT ON TABLES TO authenticated;

-- Grant execute on RPC functions explicitly (though SECURITY INVOKER usually usually covers it if they have underlying access)
GRANT EXECUTE ON FUNCTION public.get_sales_overview TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_yoy_comparison TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_breakdown TO authenticated;

-- Grant access to the view in public
GRANT SELECT ON public.vw_statement_details TO authenticated;
