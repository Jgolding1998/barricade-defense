# Security

## Design

- The game runs entirely in the browser. It makes no network requests, stores nothing, and uses no cookies, accounts, analytics, microphone or camera.
- Sound is created only after you press the Sound button.
- A Content Security Policy (meta tag and server header) allows only the game's own scripts, styles and images.
- The page builds all dynamic text with `textContent`, and builds icons with `createElementNS` from fixed shape data.

## Local server (`serve.py`)

- Binds to 127.0.0.1 only, and serves a fixed allowlist of files. Request paths are never mapped onto the filesystem.
- Accepts only GET and HEAD over HTTP/1.0 or 1.1. Other methods get 405, and versionless or unknown versions get 400.
- Requires a matching loopback `Host`, and refuses cross-origin `Origin` or `Sec-Fetch-Site` values.
- Limits request size and header count, enforces a total deadline for the request line and headers plus a per-read timeout, and caps concurrent connections.
- Error responses are fixed text and never echo the request.
- Sends `nosniff`, `no-store`, `X-Frame-Options: DENY`, `frame-ancestors 'none'`, same-origin COOP/CORP, `no-referrer` and a restrictive `Permissions-Policy`.

It is a convenience server for playing on your own machine, not a production web server.

## Reporting a problem

Please use the [central feedback form](https://github.com/Jgolding1998/Jgolding1998/issues/new?template=feedback.yml). Do not include personal information or secrets.
