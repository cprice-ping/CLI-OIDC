# PingCLI-PoC

A Node.js CLI tool to perform OIDC authentication (with PKCE or Device Authorization) and display results from a PingOne API.

## Usage

1. Copy `.env.example` to `.env` and fill in your OIDC details.
2. Install dependencies:
   ```sh
   npm install
   ```
3. Run the CLI for browser-based PKCE flow:
   ```sh
   node index.js
   ```
4. Or run with device authorization flow:
   ```sh
   node index.js --device
   ```

## Options
- `--device`: Use OIDC Device Authorization Grant (for headless or remote environments)

## Environment Variables
- `OIDC_CLIENT_ID`: Your OIDC client ID
- `ENV_ID`: Your PingOne environment ID
- `OIDC_ISSUER`: OIDC issuer URL (e.g., https://auth.pingone.com/${ENV_ID}/as)
- `OIDC_REDIRECT_PORT`: Port for local redirect (e.g., 3000)
- `OIDC_SCOPE`: (optional) OIDC scopes (default: openid profile email)

## How it works
- By default, launches a browser for OIDC login (PKCE), receives the code, exchanges for an access token, and calls the PingOne API.
- With `--device`, shows a user code and verification URL for device login, polls for the token, and calls the PingOne API.

## API Call
After authentication, the tool uses the access token to call:
```
https://api.pingone.com/v1/environments/{ENV_ID}/{apiEndpoint}
```
where `{apiEndpoint}` is provided as a CLI argument (e.g., `users`, `populations`, `users/{id}`), and prints the JSON response.
