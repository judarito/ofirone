-- Reverse only the schema owned by this package; preserve existing taxes.
DROP TABLE public.reference_regional_settings;
DROP TABLE public.reference_currencies;
DROP INDEX public.taxes_code_page_idx;
