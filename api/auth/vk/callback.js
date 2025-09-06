const { createClient } = require('@supabase/supabase-js');

// Helper to build small HTML page that posts message back to opener and closes
function postMessageAndClose(payload) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!doctype html>
<html><head><meta charset="utf-8" /></head>
<body>
<script>
  (function(){
    try {
      const data = ${json};
      if (window.opener && window.opener.postMessage) {
        window.opener.postMessage({ source: 'storiesoff-auth', provider: 'vk', data }, '*');
      }
    } catch(e) {}
    window.close();
  })();
</script>
</body></html>`;
}

module.exports = async function handler(req, res) {
  try {
    const code = req.query.code;
    const error = req.query.error;
    const stateParam = req.query.state;

    if (error) {
      res.status(400).send(postMessageAndClose({ error: String(error) }));
      return;
    }

    const {
      VK_CLIENT_ID,
      VK_CLIENT_SECRET,
      PUBLIC_BASE_URL,
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_ANON_KEY,
      VK_PASSWORD_SALT
    } = process.env;

    if (!VK_CLIENT_ID || !VK_CLIENT_SECRET || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      res.status(500).send(postMessageAndClose({ error: 'Server is not configured' }));
      return;
    }

    const redirectUri = `${PUBLIC_BASE_URL || ''}/api/auth/vk/callback`;

    // Exchange code for access token
    const tokenResp = await fetch('https://oauth.vk.com/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: VK_CLIENT_ID,
        client_secret: VK_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code: String(code || '')
      })
    });

    const tokenData = await tokenResp.json();
    if (tokenData.error) {
      res.status(400).send(postMessageAndClose({ error: tokenData.error_description || tokenData.error }));
      return;
    }

    // Fetch VK user data
    const userResp = await fetch(
      `https://api.vk.com/method/users.get?user_ids=${tokenData.user_id}&fields=photo_200&access_token=${tokenData.access_token}&v=5.131`
    );
    const userData = await userResp.json();
    if (userData.error) {
      res.status(400).send(postMessageAndClose({ error: userData.error.error_msg || 'VK user fetch failed' }));
      return;
    }

    const vkUser = userData.response && userData.response[0];
    if (!vkUser) {
      res.status(400).send(postMessageAndClose({ error: 'VK user not found' }));
      return;
    }

    const email = tokenData.email || `vk_${vkUser.id}@vk.local`;
    const password = `vk_${vkUser.id}_${(VK_PASSWORD_SALT || 's').slice(0,8)}`;

    // Create or update user via Admin API
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Try to create user (if exists, update password to deterministic one)
    let created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        provider: 'vk',
        vk_id: vkUser.id,
        name: `${vkUser.first_name} ${vkUser.last_name}`,
        avatar: vkUser.photo_200,
      }
    });

    if (created.error && !String(created.error.message || '').includes('already registered')) {
      // Try update existing user password and metadata
      const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1, email });
      const existing = list.data?.users?.[0];
      if (!existing) {
        res.status(500).send(postMessageAndClose({ error: 'Cannot create or locate user' }));
        return;
      }
      await admin.auth.admin.updateUserById(existing.id, {
        password,
        user_metadata: {
          provider: 'vk',
          vk_id: vkUser.id,
          name: `${vkUser.first_name} ${vkUser.last_name}`,
          avatar: vkUser.photo_200,
          updated_at: new Date().toISOString(),
        }
      });
    }

    // Sign in server-side to fetch session tokens
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) {
      res.status(500).send(postMessageAndClose({ error: signIn.error?.message || 'Failed to create session' }));
      return;
    }

    const session = signIn.data.session;

    // Check if state contains RN deep link to redirect
    let appRedirect = '';
    if (stateParam) {
      try {
        const decoded = JSON.parse(Buffer.from(String(stateParam), 'base64').toString('utf-8'));
        if (decoded && typeof decoded.app_redirect === 'string') appRedirect = decoded.app_redirect;
      } catch {}
    }

    if (appRedirect) {
      const url = new URL(appRedirect);
      url.searchParams.set('provider', 'vk');
      url.searchParams.set('access_token', session.access_token);
      url.searchParams.set('refresh_token', session.refresh_token);
      url.searchParams.set('expires_in', String(session.expires_in));
      url.searchParams.set('token_type', session.token_type);
      res.writeHead(302, { Location: url.toString() });
      res.end();
      return;
    }

    // Web popup flow: return HTML with postMessage
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(postMessageAndClose({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type,
      provider_token: tokenData.access_token,
      user: signIn.data.user
    }));
  } catch (e) {
    console.error('VK callback error', e);
    res.status(500).send(postMessageAndClose({ error: 'VK callback failed' }));
  }
}
