-- Add account_code to fct_sales_line for GL tracking
alter table dw.fct_sales_line add column if not exists account_code text;
