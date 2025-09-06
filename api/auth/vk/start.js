module.exports = async function handler(req, res) {
  try {
    const clientId = process.env.VK_CLIENT_ID;
    const redirectUri = `${process.env.PUBLIC_BASE_URL || ''}/api/auth/vk/callback`;
    const appRedirect = typeof req.query.app_redirect === 'string' ? req.query.app_redirect : '';

    if (!clientId || !redirectUri) {
      return res.status(500).json({ error: 'VK OAuth env not configured' });
    }

    // Прокидываем app_redirect через state (base64), чтобы callback знал, куда вернуть пользователя в RN
    const state = appRedirect ? Buffer.from(JSON.stringify({ app_redirect: appRedirect })).toString('base64') : undefined;

    const params = new URLSearchParams({
      client_id: clientId,
      display: 'mobile',
      redirect_uri: redirectUri,
      scope: 'email',
      response_type: 'code',
      v: '5.131',
    });

    if (state) params.set('state', state);

    const authUrl = `https://oauth.vk.com/authorize?${params.toString()}`;

    // Redirect to VK authorize in popup
    res.writeHead(302, { Location: authUrl });
    res.end();
  } catch (e) {
    console.error('VK start error', e);
    res.status(500).json({ error: 'VK start failed' });
  }
}
