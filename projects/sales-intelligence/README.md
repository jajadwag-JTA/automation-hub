# Sales Intelligence

Python tool that turns sales workbooks into management reports and a Streamlit
dashboard. It is a local, on-demand project. Its code lives in its own repository;
this page is the hub's record of it.

Status: completed local version. Not hosted and not scheduled.

## Two scopes, kept separate

- Phase 16: transaction-level analysis (Clean Transactions sheet and summaries).
- Phase 18: official multi-year source reporting, aggregated by selling type and
  region. It is not customer-level or transaction-level data.

Do not add the two together or compare them without checking period and coverage first.

## Run it

Install once, from the project root:

    py -m pip install -r .\Phase18_Dashboard\requirements.txt

Launch the dashboard:

    py -m streamlit run .\Phase18_Dashboard\phase18_dashboard.py

Open http://localhost:8501 and stop with Ctrl+C. The dashboard reads existing Excel
outputs and does not rerun the engine. To refresh the workbooks, run
phase18c_corrected_engine.py separately, after fixing its hardcoded paths.

## Known issues

- Hardcoded Windows source and output paths in the processing scripts.
- Some dashboard headline figures and chart data are hardcoded.
- Ask MIKA is keyword-based, not an AI assistant.
- The Dev Container looks for a root requirements.txt, but the file is in Phase18_Dashboard.
- Stockist results on the Phase 18 data are not a customer-level audit.
- Partial-year (2026) against full-year comparisons need a clear cut-off date.
- No automated tests yet.

## Next

1. Bind dashboard figures to the workbook sheets.
2. Make file paths configurable.
3. Pin dependency versions and align the Dev Container.
4. Log data-quality issues before cleaning.
5. Add tests.