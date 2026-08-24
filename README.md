# OpenRouter Chat

A simple, ChatGPT-style chat interface that talks directly to [OpenRouter](https://openrouter.ai) from your browser — no backend, no build step, no framework. Bring your own OpenRouter API key and chat with any model OpenRouter offers.

Runs entirely client-side: your API key is stored only in your browser's `localStorage` and is sent only in direct requests from your browser to `openrouter.ai`. Nobody but you ever sees it.

## Features

- **Any OpenRouter model** — fetches the live model catalog for your key, pick from the dropdown or just type a model ID
- **Model filters** — narrow the catalog by free/paid pricing, image generation support, or reasoning ("thinking") support
- **Streaming responses** with a status indicator that reflects what the model is actually doing (thinking, reasoning, searching the web, generating an image)
- **Reasoning effort control** — an "Effort" dropdown next to the message box, populated from each model's own supported effort levels (only shown for models that support it)
- **Web search** — toggle button that lets any model search the web for its answer, with sources shown as citations under the reply
- **Image generation** — for models that support image output, generated images render inline in the chat
- **Conversation history** in a left sidebar, ChatGPT-style — new chat, switch, delete, auto-titled from your first message
- Everything (API key, conversations, model, settings) persists locally across reloads

## Getting started

1. Get an OpenRouter API key at [openrouter.ai/keys](https://openrouter.ai/keys).
2. Open `index.html` in a browser (double-click it, or serve the folder with any static file server).
3. Paste your key into the settings modal that appears. It'll fetch your available models automatically.
4. Pick a model and start chatting.

No install, no dependencies, no build step.

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

## License

MIT — see [LICENSE](LICENSE).
