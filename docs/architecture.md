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

Pass ordinary chat text directly from `sys.query` through the variable aggregator; prefer the ASR text when the audio branch ran. An LLM used as a pass-through can echo its instructions or add reasoning to the text seen by the intent classifier. Route explicit invoice confirmation directly to `confirmLatestInvoice` before the classifier. The client sends an explicit invoice confirmation from its button and expands a short confirmation only when the current chat contains an unresolved invoice receipt, preserving meeting confirmation priority. Display the confirmation tool's actual response and mark the button confirmed only after an `ok` response with an invoice ID; a failed attempt remains retryable.
# Parallel assistant preview

`/new` uses the same dashboard and an independent chat history. Its `/api/new` endpoints require an authenticated gateway user, the configured browser origin and a trusted immediate proxy. The hub forwards only the SSO session cookie to the portal MCP endpoint. The center independently verifies the employee and checks current grants on execution. Set `PORTAL_ORIGIN`, `PORTAL_PROXY_IPS`, `PORTAL_MCP_URL` and a matching `PORTAL_MCP_SECRET` on both services (the shared secret alone does not identify an employee).

Configure `PORTAL_MODEL_BASE`, `PORTAL_MODEL`, `PORTAL_MODEL_KEY`, and the independent transcription endpoint `PORTAL_ASR_URL`, `PORTAL_ASR_MODEL`, `PORTAL_ASR_KEY` in private server settings. The assistant searches an unpublished `data/portal-policy.json` array of `{documentName, content}` records. Replace this file atomically from the approved policy corpus. Search-only mode can return original passages before a model is connected.

Meeting confirmations are one-use, scoped to the employee and conversation. An application restart invalidates the outstanding preview. Invoice attachments use the original-file preview endpoint and an employee-bound confirmation reference. An indeterminate result requires checking the business record. The legacy root and its existing history stay available independently.
