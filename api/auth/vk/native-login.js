const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const {
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_ANON_KEY,
      VK_PASSWORD_SALT,
    } = process.env;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
      return res.status(500).json({ error: 'Server is not configured' });
    }

    const { access_token: vkAccessToken, user_id: vkUserId, email: vkEmail } = req.body || {};

    if (!vkAccessToken) {
      return res.status(400).json({ error: 'Missing VK access_token' });
    }

    // 1) Получаем данные пользователя VK по access_token
    const userResp = await fetch(
      `https://api.vk.com/method/users.get?fields=photo_200&v=5.131&access_token=${encodeURIComponent(
        vkAccessToken
      )}`
    );
    const userData = await userResp.json();
    if (userData.error) {
      return res.status(400).json({ error: userData.error?.error_msg || 'VK user fetch failed' });
    }
    const vkUser = userData.response && userData.response[0];
    if (!vkUser || !vkUser.id) {
      return res.status(400).json({ error: 'VK user not found' });
    }

    // 2) Готовим email/пароль для Supabase (детерминированные для повторного входа)
    const email = vkEmail || `vk_${vkUser.id}@vk.local`;
    const password = `vk_${vkUser.id}_${(VK_PASSWORD_SALT || 's').slice(0, 8)}`;

    // 3) Создаём/обновляем пользователя через Admin API
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Пытаемся создать пользователя; если уже существует — обновим пароль и метаданные
    let created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        provider: 'vk',
        vk_id: vkUser.id,
        name: `${vkUser.first_name || ''} ${vkUser.last_name || ''}`.trim(),
        avatar: vkUser.photo_200 || null,
      },
    });

    if (created.error && !String(created.error.message || '').includes('already registered')) {
      const list = await admin.auth.admin.listUsers({ page: 1, perPage: 1, email });
      const existing = list.data?.users?.[0];
      if (!existing) {
        return res.status(500).json({ error: 'Cannot create or locate user' });
      }
      const upd = await admin.auth.admin.updateUserById(existing.id, {
        password,
        user_metadata: {
          provider: 'vk',
          vk_id: vkUser.id,
          name: `${vkUser.first_name || ''} ${vkUser.last_name || ''}`.trim(),
          avatar: vkUser.photo_200 || null,
          updated_at: new Date().toISOString(),
        },
      });
      if (upd.error) {
        return res.status(500).json({ error: upd.error.message || 'Failed to update user' });
      }
    }

    // 4) Серверный вход для получения session токенов
    const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const signIn = await anon.auth.signInWithPassword({ email, password });
    if (signIn.error || !signIn.data.session) {
      return res.status(500).json({ error: signIn.error?.message || 'Failed to create session' });
    }

    const session = signIn.data.session;
    return res.status(200).json({
      provider: 'vk',
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: session.token_type,
      user: signIn.data.user,
    });
  } catch (e) {
    console.error('VK native-login error', e);
    return res.status(500).json({ error: 'VK native-login failed' });
  }
}
