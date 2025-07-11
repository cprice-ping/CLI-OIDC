# PingCLI-PoC

A Node.js CLI tool to perform OIDC authentication (with PKCE or Device Authorization) and display results from a PingOne API.

## Usage

1. Copy `.env.example` to `.env` and fill in your OIDC details.
2. Install dependencies:
   ```sh
   npm install
   ```
3. Run the CLI for browser-based PKCE flow (default endpoint is `users`):
   ```sh
   node index.js
   ```
4. To call a specific API endpoint (e.g., a user):
   ```sh
   node index.js users/b11fcccd-c517-4fbb-8912-84628b6dea61
   ```
5. Or run with device authorization flow:
   ```sh
   node index.js users --device
   ```

## Options
- `--device`: Use OIDC Device Authorization Grant (for headless or remote environments)
- `[apiEndpoint]`: The PingOne API path after `/environments/{API_ENV_ID}/` (e.g., `users`, `users/{id}`, `populations`)

## Environment Variables
- `OIDC_CLIENT_ID`: Your OIDC client ID
- `OIDC_ENV_ID`: The environment ID for OIDC authentication (used in OIDC_ISSUER)
- `API_ENV_ID`: The environment ID for API calls
- `OIDC_ISSUER`: OIDC issuer URL (e.g., https://auth.pingone.com/${OIDC_ENV_ID}/as)
- `OIDC_REDIRECT_PORT`: Port for local redirect (e.g., 3000)
- `OIDC_SCOPE`: (optional) OIDC scopes (default: openid profile email)

## How it works
- By default, launches a browser for OIDC login (PKCE), receives the code, exchanges for an access token, and calls the PingOne API.
- With `--device`, shows a user code and verification URL for device login, polls for the token, and calls the PingOne API.
- The tool caches the access token in `.token_cache.json` and reuses it until it expires, reducing the need for repeated logins.
- If a refresh_token is available, it will be used to renew the access_token silently.

## API Call
After authentication, the tool uses the access token to call:
```
https://api.pingone.com/v1/environments/{API_ENV_ID}/{apiEndpoint}
```
where `{apiEndpoint}` is provided as a CLI argument (e.g., `users`, `populations`, `users/{id}`), and prints the JSON response.
