# PingCLI-PoC

A Node.js CLI tool to perform OIDC authentication (with PKCE) and display the user's access_token.

## Usage

1. Copy `.env.example` to `.env` and fill in your OIDC details.
2. Install dependencies:
   ```sh
   npm install dotenv open axios
   ```
3. Run the CLI:
   ```sh
   node index.js
   ```

## Environment Variables
- `OIDC_CLIENT_ID`: Your OIDC client ID
- `OIDC_ISSUER`: OIDC issuer URL (e.g., https://accounts.google.com)
- `OIDC_REDIRECT_PORT`: Port for local redirect (e.g., 3000)
- `OIDC_SCOPE`: (optional) OIDC scopes (default: openid profile email)
