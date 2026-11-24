const project = import.meta.env.VITE_ZENTRO_FIREBASE_PROJECT;
const apiKey = import.meta.env.VITE_ZENTRO_FIREBASE_WEB_API_KEY;
export const servicesEnabled = Boolean(project && apiKey);

async function request(url, options) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(12000) });
  if (!response.ok) {
    const messages = {
      401: 'Your services session expired. Sign out and sign in again.',
      403: 'Firestore access was denied. Check the Zentro services rules.',
    };
    const result = await response.json().catch(() => ({}));
    const authMessages = {
      EMAIL_EXISTS: 'This email already has a Zentro login. Use Application sign-in to continue.',
      OPERATION_NOT_ALLOWED: 'Enable Email/Password in Firebase Authentication to use Zentro registration.',
      INVALID_LOGIN_CREDENTIALS: 'Check your email and password, then try again.',
      WEAK_PASSWORD: 'Choose a stronger password that meets your Firebase password policy.',
    };
    const code = result.error?.message?.split(' : ')[0];
    const error = new Error(authMessages[code] || messages[response.status] || 'The services request failed. Try again.');
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export async function sendPasswordReset(email) {
  const response = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=' + encodeURIComponent(apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
    signal: AbortSignal.timeout(12000),
  });
  if (response.ok) return;
  const result = await response.json().catch(() => ({}));
  const code = result.error?.message?.split(' : ')[0];
  if (['EMAIL_NOT_FOUND', 'USER_DISABLED'].includes(code)) return;
  if (response.status === 429 || code?.startsWith('TOO_MANY_ATTEMPTS')) {
    throw new Error('Too many reset requests. Wait a while before trying again.');
  }
  throw new Error('Could not request a reset email. Check the address and try again.');
}

export async function startServices(email, password, expectedUid, register = false) {
  const auth = await request('https://identitytoolkit.googleapis.com/v1/accounts:' + (register ? 'signUp' : 'signInWithPassword') + '?key=' + encodeURIComponent(apiKey), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (expectedUid && auth.localId !== expectedUid) throw new Error('Zentro services and SharedBank returned different user accounts.');
  const uid = auth.localId;
  let session = { idToken: auth.idToken, refreshToken: auth.refreshToken, expiresAt: Date.now() + Number(auth.expiresIn) * 1000 };
  let renewal;

  async function token() {
    if (Date.now() < session.expiresAt - 60000) return session.idToken;
    renewal ??= request('https://securetoken.googleapis.com/v1/token?key=' + encodeURIComponent(apiKey), {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: session.refreshToken }),
    }).then(next => {
      if (next.user_id !== uid) throw new Error('The Zentro services session no longer belongs to this account.');
      session = { idToken: next.id_token, refreshToken: next.refresh_token, expiresAt: Date.now() + Number(next.expires_in) * 1000 };
    }).finally(() => { renewal = undefined; });
    await renewal;
    return session.idToken;
  }

  const root = 'https://firestore.googleapis.com/v1/projects/' + encodeURIComponent(project) + '/databases/(default)/documents/';
  const api = async (collection, { id, fields, create = false, pageToken } = {}) => {
    const path = 'zentroServices/' + encodeURIComponent(uid) + '/' + collection;
    const query = new URLSearchParams();
    if (create) query.set('documentId', id);
    if (pageToken) query.set('pageToken', pageToken);
    const destination = root + path + (id && !create ? '/' + encodeURIComponent(id) : '') + (query.size ? '?' + query : '');
    const headers = { Authorization: 'Bearer ' + await token() };
    if (fields) headers['Content-Type'] = 'application/json';
    return request(destination, {
      method: fields ? (create ? 'POST' : 'PATCH') : 'GET', headers,
      ...(fields && { body: JSON.stringify({ fields }) }),
    });
  };

  api.uid = uid;
  api.addon = async (path, { method = 'GET', body, query } = {}) => {
    const headers = { Authorization: 'Bearer ' + await token() };
    if (body) headers['Content-Type'] = 'application/json';
    return request(root + 'zentroServices/' + path + (query ? '?' + query : ''), {
      method, headers, ...(body && { body: JSON.stringify(body) }),
    });
  };
  return api;
}

export async function listServiceRecords(api, collection) {
  const documents = [];
  let pageToken;
  do {
    const page = await api(collection, { pageToken });
    documents.push(...(page.documents || []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return documents.map(document => ({
    id: document.name.split('/').at(-1),
    ...Object.fromEntries(Object.entries(document.fields || {}).map(([name, value]) =>
      [name, value.integerValue === undefined ? value.stringValue : Number(value.integerValue)])),
  }));
}
