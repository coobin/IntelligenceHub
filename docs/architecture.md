# Architecture Notes

## Frontend

The first version is a dependency-free static frontend:

- `index.html` defines the shell, navigation area, catalog area, and assistant panel.
- `styles.css` owns the formal enterprise visual system and responsive layout.
- `app.js` loads catalog data, renders filters, search, metrics, cards, and optional assistant iframe.
- `data/catalog.json` stores public navigation metadata.

## Local-only configuration

`config.local.js` and `.env.local` are intentionally ignored by Git. Use them for local share links, deployment-only values, or future backend proxy secrets.

## FastGPT integration path

For a quick integration, configure a public FastGPT share or embedded chat URL in `config.local.js`.

For a production integration, add a backend endpoint that holds `FASTGPT_API_KEY` server-side, validates the current user, proxies chat requests to FastGPT, and streams the answer to the browser.
