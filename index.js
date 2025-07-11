#!/usr/bin/env node
import 'dotenv/config';
import http from 'http';
import open from 'open';
import crypto from 'crypto';
import axios from 'axios';

// Load env vars
const {
  OIDC_CLIENT_ID,
  OIDC_ISSUER,
  OIDC_REDIRECT_PORT,
  OIDC_SCOPE
} = process.env;

if (!OIDC_CLIENT_ID || !OIDC_ISSUER || !OIDC_REDIRECT_PORT) {
  console.error('Missing required env vars. See .env.example.');
  process.exit(1);
}

const REDIRECT_URI = `http://localhost:${OIDC_REDIRECT_PORT}/callback`;

// PKCE helpers
function base64URLEncode(str) {
  return str.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

async function main() {
  // Generate PKCE
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  const codeChallenge = base64URLEncode(sha256(codeVerifier));

  // Discover OIDC endpoints
  const { data: discovery } = await axios.get(`${OIDC_ISSUER}/.well-known/openid-configuration`);
  const authUrl = discovery.authorization_endpoint;
  const tokenUrl = discovery.token_endpoint;

  // Start local server
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/callback')) {
      const url = new URL(req.url, `http://localhost:${OIDC_REDIRECT_PORT}`);
      const code = url.searchParams.get('code');
      res.end('Authentication complete. You can close this window.');
      server.close();
      if (!code) {
        console.error('No code received.');
        process.exit(1);
      }
      // Exchange code for token
      try {
        const tokenRes = await axios.post(tokenUrl, new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          redirect_uri: REDIRECT_URI,
          client_id: OIDC_CLIENT_ID,
          code_verifier: codeVerifier
        }), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const accessToken = tokenRes.data.access_token;
        if (!accessToken) {
          console.error('No access token received.');
          process.exit(1);
        }
        // Use the access token in a GET call to the provided URL
        const apiUrl = 'https://api.pingone.com/v1/environments/490b9f38-f20b-4afa-b02e-3cc1315e29ab/users';
        try {
          const apiRes = await axios.get(apiUrl, {
            headers: {
              Authorization: `Bearer ${accessToken}`
            }
          });
          console.log('API Response:', JSON.stringify(apiRes.data, null, 2));
        } catch (apiErr) {
          console.error('API call failed:', apiErr.response?.data || apiErr.message);
          process.exit(1);
        }
      } catch (err) {
        console.error('Token exchange failed:', err.response?.data || err.message);
        process.exit(1);
      }
    }
  });
  server.listen(OIDC_REDIRECT_PORT, () => {
    // Open browser
    const params = new URLSearchParams({
      client_id: OIDC_CLIENT_ID,
      response_type: 'code',
      redirect_uri: REDIRECT_URI,
      scope: OIDC_SCOPE || 'openid profile email',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    const url = `${authUrl}?${params}`;
    console.log('Opening browser for authentication...');
    open(url);
  });
}

main();
