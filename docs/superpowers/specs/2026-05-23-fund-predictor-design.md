# Fund Predictor Mobile Web Design

## Goal

Build a small public mobile web page that shows daily 14:30 predictions for the user's watched funds:

- 019633
- 016874
- 020744
- 015903

The page should be readable on a phone outside the home network. It can be public to anyone with the link. It is an estimate tool only and must not present results as investment advice.

## Recommended Approach

Use GitHub Pages for the static site and GitHub Actions for the daily scheduled job.

This keeps the system free, low-maintenance, and easy to open from a phone. The scheduled job updates JSON data in the repository, and GitHub Pages serves the static page from the latest committed data.

## User Experience

The first screen is a mobile-first dashboard with one card per fund. Each card shows:

- Fund code and name
- Last available official unit NAV
- Current intraday estimate, when available
- Predicted closing unit NAV
- Predicted daily change percentage
- Data update time
- A small confidence/status label

Below the cards, the page shows a compact history section with recent predictions and actual NAV values when available. The page includes clear wording that predictions are estimates for reference only and actual NAV may differ.

## Data Sources

The first implementation uses public fund quote/estimate endpoints from Eastmoney/Tiantian Fund when reachable. The tool stores only the response fields needed for display and history:

- Fund code
- Fund name
- Last official NAV date
- Last official unit NAV
- Intraday estimated NAV
- Intraday estimated change percentage
- Quote update time

If a quote endpoint is unavailable or returns incomplete data, the fund card should show a stale/error state instead of inventing a value.

## Prediction Model

Version 1 uses a conservative transparent model:

1. Read the 14:30 intraday estimated NAV.
2. Treat that estimate as the baseline predicted closing unit NAV.
3. Apply a small historical calibration only after enough local history exists.
4. Store both the raw estimate and adjusted prediction so the user can compare them.

The model is intentionally simple at first because fund real-time estimates are already model-based and may be revised. The software should improve only from observed local prediction error, not opaque claims.

## Scheduling

GitHub Actions runs once per trading day at approximately 14:30 Beijing time. Because GitHub Actions schedules use UTC and may start a few minutes late, the workflow should:

- Schedule around 06:30 UTC.
- Record the actual run time.
- Allow manual runs from the GitHub Actions UI.
- Avoid duplicate entries for the same date and fund by updating the existing record.

## Storage

Generated data lives in repository files:

- `data/latest.json`: latest prediction snapshot for the page.
- `data/history.json`: recent and historical prediction records.

The history file should remain compact. If it grows too large later, the implementation can split it by year.

## Site Architecture

The static web app contains:

- `index.html`: mobile page shell.
- `src` or `assets` files for CSS and client-side rendering if needed.
- A data loader that fetches `data/latest.json` and `data/history.json`.

The page should work without a backend server. All dynamic updates happen when the GitHub Actions job commits regenerated JSON files.

## Error Handling

The update script should handle:

- Network failure
- Missing or malformed quote data
- Non-trading days
- Funds with unavailable intraday estimates
- GitHub Actions schedule delay

Errors should be recorded in `latest.json` so the page can show a useful status. A failed fetch for one fund should not prevent the other funds from updating.

## Testing And Validation

Implementation should include:

- Unit tests for quote parsing and prediction calculations.
- A fixture-based test so parsing does not depend on live network access.
- A local build or static smoke check.
- A mobile viewport check before handoff.

Live network fetching can be smoke-tested manually because public quote endpoints may be unstable.

## Deployment

Deployment target is GitHub Pages. The user will open the published Pages URL on their phone. The repository can remain public or private depending on GitHub Pages availability for the account, but the page content itself is acceptable to be public to anyone with the link.

## Out Of Scope For Version 1

- Password login
- WeChat push notifications
- Buy/sell recommendations
- Complex machine learning
- Broker or fund account login
- Automatic trading
