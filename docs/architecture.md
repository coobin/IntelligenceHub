# Architecture Notes

## Frontend

The first version is a dependency-free static frontend:

- `index.html` defines the shell, navigation area, catalog area, and assistant panel.
- `styles.css` owns the formal enterprise visual system and responsive layout.
- `app.js` loads catalog data, renders filters, search, metrics, cards, and optional assistant iframe.
- `data/catalog.json` stores public navigation metadata.

## Local-only configuration

`config.local.js` and `.env.local` are intentionally ignored by Git. Use them for local share links, deployment-only values, or future backend proxy secrets.

## Assistant integration path

For a quick integration, configure a public assistant share or embedded chat URL in `config.local.js`.

For a production integration, add a backend endpoint that holds the assistant API key server-side, validates the current user, proxies chat requests to the assistant platform, and streams the answer to the browser.

The chat client handles both SSE `error` events and `workflow_finished` events with a `failed` status. Workflow failures display a user-facing error and stop the reader, including when some reply text has already arrived. A recoverable node failure does not terminate a workflow that continues successfully. Update the entry asset versions and the Service Worker cache name when changing this client behavior.

If the Dify workflow filters `sys.files` to audio before selecting a branch, keep the list operator's positional extraction disabled. Its `first_record` output safely becomes empty when an uploaded PDF or image is removed by the audio filter. The next condition can then test whether an audio file exists and route other attachments to the invoice branch. Enabling extraction of item 1 after this filter aborts document uploads on an empty list.
