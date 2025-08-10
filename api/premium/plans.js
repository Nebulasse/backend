module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const plans = [
      { id: 'premium-monthly', name: 'Премиум (Месяц)', price: 299, currency: 'RUB', duration: 30, features: ['150 генераций в месяц', 'Выбор стилей', 'Быстрые генерации', 'Эксклюзивные стили', 'Приоритетная поддержка'] },
      { id: 'premium-yearly', name: 'Премиум (Год)', price: 2990, currency: 'RUB', duration: 365, features: ['150 генераций в месяц', 'Выбор стилей', 'Быстрые генерации', 'Эксклюзивные стили', 'Приоритетная поддержка', 'Экономия 17% при годовой подписке'] },
      { id: 'ultra-monthly', name: 'Ultra (Месяц)', price: 999, currency: 'RUB', duration: 30, features: ['Безлимитные генерации', 'Создание кастомных стилей', 'Быстрые генерации', 'VIP поддержка'] },
      { id: 'ultra-yearly', name: 'Ultra (Год)', price: 9990, currency: 'RUB', duration: 365, features: ['Безлимитные генерации', 'Создание кастомных стилей', 'Быстрые генерации', 'VIP поддержка', 'Экономия 17% при годовой подписке'] }
    ];
    return res.status(200).json(plans);
  } catch (error) {
    console.error('Error getting premium plans:', error);
    return res.status(500).json({ error: error.message });
  }
};


