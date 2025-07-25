#!/usr/bin/env node
import 'dotenv/config';
import http from 'http';
import open from 'open';
import crypto from 'crypto';
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { colorize as jsonColorizer } from 'json-colorizer';

// Load env vars

let {
  OIDC_CLIENT_ID,
  OIDC_ISSUER,
  OIDC_REDIRECT_PORT,
  OIDC_ENV_ID,
  API_ENV_ID
} = process.env;

// Substitute OIDC_ENV_ID in OIDC_ISSUER if needed
if (OIDC_ISSUER && OIDC_ENV_ID && OIDC_ISSUER.includes('${OIDC_ENV_ID}')) {
  OIDC_ISSUER = OIDC_ISSUER.replace('${OIDC_ENV_ID}', OIDC_ENV_ID);
}

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


const CACHE_FILE = path.join(process.cwd(), '.token_cache.json');

function readTokenCache() {
  try {
    const data = fs.readFileSync(CACHE_FILE, 'utf8');
    const { access_token, expires_at, refresh_token, refresh_expires_at } = JSON.parse(data);
    return { access_token, expires_at, refresh_token, refresh_expires_at };
  } catch {}
  return {};
}

function writeTokenCache(access_token, expires_in, refresh_token, refresh_expires_in) {
  const expires_at = Date.now() + (expires_in * 1000) - 10000; // 10s early
  let refresh_expires_at = undefined;
  if (refresh_token && refresh_expires_in) {
    refresh_expires_at = Date.now() + (refresh_expires_in * 1000) - 10000;
  }
  fs.writeFileSync(CACHE_FILE, JSON.stringify({ access_token, expires_at, refresh_token, refresh_expires_at }));
}

async function main() {
  // Parse CLI args
  const argv = process.argv.slice(2);
  const useDevice = argv.includes('--device');
  // Remove all flags (starting with --)
  const endpointArg = argv.find(arg => !arg.startsWith('--'));
  const apiEndpoint = endpointArg || null;
  if (!API_ENV_ID) {
    console.error('Missing API_ENV_ID in environment.');
    process.exit(1);
  }

  // Discover OIDC endpoints
  const { data: discovery } = await axios.get(`${OIDC_ISSUER}/.well-known/openid-configuration`);
  const authUrl = discovery.authorization_endpoint;
  const tokenUrl = discovery.token_endpoint;
  const deviceEndpoint = discovery.device_authorization_endpoint;

  let triedReauth = false;
  while (true) {
    let { access_token, expires_at, refresh_token, refresh_expires_at } = readTokenCache();
    // If access_token is valid, use it
    if (access_token && expires_at && Date.now() < expires_at) {
      try {
        let apiUrl, apiRes;
        if (!apiEndpoint) {
          // Decode JWT to get sub
          const [, payloadB64] = access_token.split('.');
          const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
          const sub = payload.sub;
          apiUrl = `https://api.pingone.com/v1/environments/${API_ENV_ID}/users/${sub}`;
          apiRes = await axios.get(apiUrl, {
            headers: {
              Authorization: `Bearer ${access_token}`
            }
          });
          const email = apiRes.data.email || apiRes.data.username || apiRes.data.name || 'unknown';
          console.log(`Authenticated as ${email}`);
        } else {
          apiUrl = `https://api.pingone.com/v1/environments/${API_ENV_ID}/${apiEndpoint.replace(/^\/+/,'')}`;
          apiRes = await axios.get(apiUrl, {
            headers: {
              Authorization: `Bearer ${access_token}`
            }
          });
          const jsonString = JSON.stringify(apiRes.data, null, 2);
          console.log('API Response:\n' + jsonColorizer(jsonString));
        }
        return;
      } catch (err) {
        // If unauthorized, clear cache and continue to re-auth
        if (err.response && err.response.status === 401 && !triedReauth) {
          fs.unlinkSync(CACHE_FILE);
          console.log('Cached token expired or invalid, re-authenticating...');
          triedReauth = true;
          continue;
        } else {
          console.error('API call failed:', err.response?.data || err.message);
          process.exit(1);
        }
      }
    }
    // If refresh_token is present and valid, try to refresh
    if (refresh_token && (!refresh_expires_at || Date.now() < refresh_expires_at)) {
      try {
        const refreshRes = await axios.post(tokenUrl, new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token,
          client_id: OIDC_CLIENT_ID
        }), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        const new_access_token = refreshRes.data.access_token;
        const new_expires_in = refreshRes.data.expires_in;
        const new_refresh_token = refreshRes.data.refresh_token || refresh_token;
        const new_refresh_expires_in = refreshRes.data.refresh_expires_in || null;
        writeTokenCache(new_access_token, new_expires_in, new_refresh_token, new_refresh_expires_in);
        // Try API call again with new token
        try {
          let apiUrl, apiRes;
          if (!apiEndpoint) {
            // Decode JWT to get sub
            const [, payloadB64] = new_access_token.split('.');
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
            const sub = payload.sub;
            apiUrl = `https://api.pingone.com/v1/environments/${API_ENV_ID}/users/${sub}`;
            apiRes = await axios.get(apiUrl, {
              headers: {
                Authorization: `Bearer ${new_access_token}`
              }
            });
            const email = apiRes.data.email || apiRes.data.username || apiRes.data.name || 'unknown';
            console.log(`Authenticated as ${email}`);
          } else {
            apiUrl = `https://api.pingone.com/v1/environments/${API_ENV_ID}/${apiEndpoint.replace(/^\/+/,'')}`;
            apiRes = await axios.get(apiUrl, {
              headers: {
                Authorization: `Bearer ${new_access_token}`
              }
            });
            const jsonString = JSON.stringify(apiRes.data, null, 2);
            console.log('API Response:\n' + jsonColorizer(jsonString));
          }
          return;
        } catch (err) {
          if (err.response && err.response.status === 401 && !triedReauth) {
            fs.unlinkSync(CACHE_FILE);
            console.log('Refreshed token invalid, re-authenticating...');
            triedReauth = true;
            continue;
          } else {
            console.error('API call failed:', err.response?.data || err.message);
            process.exit(1);
          }
        }
      } catch (err) {
        // If refresh fails, clear cache and continue to re-auth
        fs.unlinkSync(CACHE_FILE);
        console.log('Refresh token expired or invalid, re-authenticating...');
        triedReauth = true;
        continue;
      }
    }
    break;
  }

  if (useDevice) {
    // Device Authorization Grant
    if (!deviceEndpoint) {
      console.error('Device Authorization endpoint not found in OIDC discovery.');
      process.exit(1);
    }
    // Request device code
    let deviceRes;
    try {
      deviceRes = await axios.post(deviceEndpoint, new URLSearchParams({
        client_id: OIDC_CLIENT_ID
      }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
    } catch (err) {
      console.error('Device authorization request failed:', err.response?.data || err.message);
      process.exit(1);
    }
    const { device_code, user_code, verification_uri, verification_uri_complete, interval = 5 } = deviceRes.data;
    console.log('==== DEVICE AUTHORIZATION ====');
    console.log('User Code:', user_code);
    console.log('Verification URI:', verification_uri);
    if (verification_uri_complete) {
      console.log('Or open:', verification_uri_complete);
    }
    // Poll for token
    let accessToken, expires_in, refresh_token, refresh_expires_in;
    let pollInterval = interval;
    while (true) {
      await new Promise(r => setTimeout(r, pollInterval * 1000));
      try {
        const pollRes = await axios.post(tokenUrl, new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          device_code,
          client_id: OIDC_CLIENT_ID
        }), {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        accessToken = pollRes.data.access_token;
        expires_in = pollRes.data.expires_in;
        refresh_token = pollRes.data.refresh_token;
        refresh_expires_in = pollRes.data.refresh_expires_in;
        if (accessToken) break;
      } catch (err) {
        if (err.response && err.response.data && err.response.data.error === 'authorization_pending') {
          // keep polling
          continue;
        } else if (err.response && err.response.data && err.response.data.error === 'slow_down') {
          // increase interval
          pollInterval += 5;
          continue;
        } else {
          console.error('Device token polling failed:', err.response?.data || err.message);
          process.exit(1);
        }
      }
    }
    // Cache token
    if (accessToken && expires_in) writeTokenCache(accessToken, expires_in, refresh_token, refresh_expires_in);
    // Use the access token in a GET call to the provided URL
    try {
      let apiUrl, apiRes;
      if (!apiEndpoint) {
        // Decode JWT to get sub
        const [, payloadB64] = accessToken.split('.');
        const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
        const sub = payload.sub;
        apiUrl = `https://api.pingone.com/v1/environments/${API_ENV_ID}/users/${sub}`;
        apiRes = await axios.get(apiUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });
        const email = apiRes.data.email || apiRes.data.username || apiRes.data.name || 'unknown';
        console.log(`Authenticated as ${email}`);
      } else {
        apiUrl = `https://api.pingone.com/v1/environments/${API_ENV_ID}/${apiEndpoint.replace(/^\/+/,'')}`;
        apiRes = await axios.get(apiUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`
          }
        });
        const jsonString = JSON.stringify(apiRes.data, null, 2);
        console.log('API Response:\n' + jsonColorizer(jsonString));
      }
    } catch (apiErr) {
      console.error('API call failed:', apiErr.response?.data || apiErr.message);
      process.exit(1);
    }
    return;
  }

  // Browser-based PKCE flow (default)
  // Generate PKCE
  const codeVerifier = base64URLEncode(crypto.randomBytes(32));
  const codeChallenge = base64URLEncode(sha256(codeVerifier));

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
        const expires_in = tokenRes.data.expires_in;
        const refresh_token = tokenRes.data.refresh_token;
        const refresh_expires_in = tokenRes.data.refresh_expires_in;
        if (!accessToken) {
          console.error('No access token received.');
          process.exit(1);
        }
        // Cache token
        if (accessToken && expires_in) writeTokenCache(accessToken, expires_in, refresh_token, refresh_expires_in);
        // Use the access token in a GET call to the provided URL
        const apiUrl = `https://api.pingone.com/v1/environments/${API_ENV_ID}/${apiEndpoint.replace(/^\/+/,'')}`;
        console.log('Using API URL:', apiUrl);
        try {
          let apiUrl, apiRes;
          if (!apiEndpoint) {
            // Decode JWT to get sub
            const [, payloadB64] = accessToken.split('.');
            const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
            const sub = payload.sub;
            apiUrl = `https://api.pingone.com/v1/environments/${API_ENV_ID}/users/${sub}`;
            apiRes = await axios.get(apiUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            });
            const email = apiRes.data.email || apiRes.data.username || apiRes.data.name || 'unknown';
            console.log(`Authenticated as ${email}`);
          } else {
            apiUrl = `https://api.pingone.com/v1/environments/${API_ENV_ID}/${apiEndpoint.replace(/^\/+/,'')}`;
            apiRes = await axios.get(apiUrl, {
              headers: {
                Authorization: `Bearer ${accessToken}`
              }
            });
            const jsonString = JSON.stringify(apiRes.data, null, 2);
            console.log('API Response:\n' + jsonColorizer(jsonString));
          }
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
      code_challenge: codeChallenge,
      code_challenge_method: 'S256'
    });
    const url = `${authUrl}?${params}`;
    console.log('Opening browser for authentication...');
    open(url);
  });
}

main();
