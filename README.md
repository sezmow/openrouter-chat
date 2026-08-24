# OpenRouter Chat

A simple, ChatGPT-style chat interface that talks directly to [OpenRouter](https://openrouter.ai) and [NVIDIA](https://build.nvidia.com) from your browser — no backend, no build step, no framework. Bring your own API key(s) and chat with any model either provider offers.

Runs entirely client-side: your API keys are stored only in your browser's `localStorage`. OpenRouter calls go straight from your browser to `openrouter.ai`; NVIDIA calls go through a small proxy you deploy yourself (see below — NVIDIA's API has no CORS support, so a browser can't call it directly). Nobody but you ever sees your keys.

## Features

- **Two providers, one picker** — OpenRouter and NVIDIA models both show up in the same model list, tagged by provider; a Provider filter lets you isolate one or the other
- **Model filters** — narrow the catalog by free/paid pricing, image generation support, or reasoning ("thinking") support. NVIDIA's API doesn't expose this metadata itself, so its models are matched against a hand-curated list in `app.js` (`NVIDIA_NON_CHAT`, `NVIDIA_THINKING`) — best-effort, and may go stale as NVIDIA's catalog changes
- **Streaming responses** with a status indicator that reflects what the model is actually doing (thinking, reasoning, searching the web, generating an image)
- **Reasoning effort control** — an "Effort" dropdown next to the message box, populated from each model's own supported effort levels (OpenRouter models only — NVIDIA doesn't expose this the same way)
- **Web search** — toggle button that lets an OpenRouter model search the web for its answer, with sources shown as citations under the reply
- **Image generation** — for OpenRouter models that support image output, generated images render inline in the chat
- **Per-message cost & token tracking**, edit/regenerate/copy on messages, renameable conversations, LaTeX math, markdown tables — see the in-app history for the full feature list
- **Conversation history** in a left sidebar, ChatGPT-style — new chat, switch, delete, auto-titled from your first message, each remembering its own model/provider
- Everything (keys, conversations, model, settings) persists locally across reloads

## Getting started

1. **OpenRouter** (simpler — works immediately): get a key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. **NVIDIA** (needs a one-time proxy setup — see below): get a key at [build.nvidia.com](https://build.nvidia.com).
3. Open `index.html` in a browser (double-click it, or serve the folder with any static file server). A setup popup appears on first run.
4. Add a key for either provider (or both), plus the NVIDIA proxy URL if you're using NVIDIA. Models fetch automatically.
5. Pick a model and start chatting.

No install, no dependencies, no build step for the app itself.

## NVIDIA setup: the CORS proxy

NVIDIA's hosted model API (`integrate.api.nvidia.com`) doesn't send CORS headers, so a browser will block direct requests to it no matter what — this isn't a bug in this app, it's how their API is configured. The fix is a tiny relay that adds those headers. A free Cloudflare Worker is the simplest option:

1. Go to [workers.cloudflare.com](https://workers.cloudflare.com), sign up (free), and create a new Worker.
2. Open the Worker's editor and replace its contents with [`nvidia-proxy-worker.js`](nvidia-proxy-worker.js) from this repo.
3. Deploy. Cloudflare gives you a URL like `https://your-worker-name.your-subdomain.workers.dev`.
4. Paste that URL into this app's settings under **NVIDIA → CORS proxy URL**.

The worker only forwards to `integrate.api.nvidia.com` and doesn't log or store anything — your key passes through on each request, same as it would with a direct call.

## Deploying to GitHub Pages

This is a static site (`index.html`, `style.css`, `app.js`), so GitHub Pages can serve it as-is:

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch".
4. Set **Branch** to `main` (or whichever branch you pushed) and folder to `/ (root)`.
5. Save. GitHub will give you a URL like `https://<username>.github.io/<repo>/` — that's your live chat app.

Since everything runs client-side, publishing this on Pages is safe: each visitor enters their *own* key into their *own* browser's local storage. Nobody's key is ever bundled into the site or visible to anyone else.

## Notes

- Web search and image generation may add extra cost per OpenRouter's pricing, even on free models — see the tooltip on the web-search toggle.
- Generated images are stored as base64 in `localStorage` alongside your conversations. Browser storage has limits (typically 5–10MB per site); a long conversation full of generated images can eventually hit that ceiling. If it does, you'll see a warning banner instead of losing your chat.
- NVIDIA's catalog is free to use with a personal API key, but some accounts need "Public API Endpoints" enabled before `/chat/completions` works (`/models` can succeed while chat still 403s) — if you hit that, check your account settings at build.nvidia.com.
- A model id can exist on both providers (e.g. several Meta/Llama models). When that happens, the picker prefers OpenRouter by default; set the Provider filter to NVIDIA to reach that provider's version instead. The small badge next to the model field always shows which provider a selection actually resolved to.

## License

MIT — see [LICENSE](LICENSE).
