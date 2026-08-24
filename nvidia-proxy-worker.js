// Cloudflare Worker: minimal CORS proxy for NVIDIA's hosted model API.
//
// NVIDIA's API (integrate.api.nvidia.com) sends no CORS headers, so browsers
// block direct requests to it from a page hosted anywhere else (including
// GitHub Pages). This worker sits in between: it forwards whatever request
// it gets straight to NVIDIA, unmodified, and adds the CORS headers to the
// response on the way back. Your API key passes through on each request —
// this worker does not see, log, or store it anywhere.
//
// Deploy: workers.cloudflare.com -> Create Worker -> paste this file's
// contents into the editor -> Deploy. Copy the resulting *.workers.dev URL
// into this app's settings under "NVIDIA proxy URL".

const NVIDIA_BASE = "https://integrate.api.nvidia.com";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const targetUrl = NVIDIA_BASE + url.pathname + url.search;

    const proxied = await fetch(targetUrl, {
      method: request.method,
      headers: {
        Authorization: request.headers.get("Authorization") || "",
        "Content-Type": request.headers.get("Content-Type") || "application/json",
        Accept: request.headers.get("Accept") || "application/json",
      },
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
    });

    const responseHeaders = new Headers(proxied.headers);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => responseHeaders.set(k, v));

    return new Response(proxied.body, {
      status: proxied.status,
      statusText: proxied.statusText,
      headers: responseHeaders,
    });
  },
};
