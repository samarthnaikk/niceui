import { z } from 'zod';

// external: https://developers.google.com/identity/protocols/oauth2#installed Installed-app clients embed credentials in source.
// This fork ships none: set your own client for the provider you use.
const clients = () => ({
  gemini: {
    clientId: process.env.OPENCHAMBER_GOOGLE_GEMINI_CLIENT_ID ?? '',
    clientSecret: process.env.OPENCHAMBER_GOOGLE_GEMINI_CLIENT_SECRET ?? '',
  },
  antigravity: {
    clientId: process.env.OPENCHAMBER_GOOGLE_ANTIGRAVITY_CLIENT_ID ?? '',
    clientSecret: process.env.OPENCHAMBER_GOOGLE_ANTIGRAVITY_CLIENT_SECRET ?? '',
  },
});

const CLIENT_KEYS = ['gemini', 'antigravity'];

const tokenResponse = z.object({ access_token: z.string().trim().min(1) });
const oauthError = z.object({ error: z.enum(['unauthorized_client', 'invalid_grant', 'invalid_client']) });

const exchange = async (refreshToken, client) => {
  let status = null;
  const signal = AbortSignal.timeout(15000);
  try {
    if (!CLIENT_KEYS.includes(client)) return { ok: false, status: null, error: 'unknown_client' };
    const { clientId, clientSecret } = clients()[client];
    if (!clientId || !clientSecret) return { ok: false, status: null, error: 'not_configured' };
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
      redirect: 'error',
      signal,
    });
    status = response.status;
    let data;
    try {
      data = await response.json();
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { ok: false, status, error: response.ok ? 'invalid_response' : 'http' };
      }
      throw error;
    }
    if (!response.ok) {
      return { ok: false, status, error: oauthError.safeParse(data).data?.error ?? 'http' };
    }
    const token = tokenResponse.safeParse(data);
    if (!token.success) return { ok: false, status, error: 'invalid_response' };
    return { ok: true, accessToken: token.data.access_token };
  } catch (error) {
    return { ok: false, status, error: signal.aborted || error?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
};

export const refreshGoogleAccessToken = async (refreshToken, client, { fallbackToAntigravity = false } = {}) => {
  const result = await exchange(refreshToken, client);
  if (!result.ok && client === 'gemini' && fallbackToAntigravity
    && (result.status === 400 || result.status === 401) && result.error === 'unauthorized_client') {
    return exchange(refreshToken, 'antigravity');
  }
  return result;
};
