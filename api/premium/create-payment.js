const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { userId, planId, userEmail, amount, currency = 'RUB' } = req.body || {};
    if (!userId || !planId || !userEmail || !amount) return res.status(400).json({ error: 'Missing required fields' });
    const { data: payment, error } = await supabase
      .from('payments')
      .insert({ user_id: userId, plan_id: planId, amount, currency, status: 'pending', email: userEmail })
      .select()
      .single();
    if (error) return res.status(500).json({ error: 'Failed to create payment' });
    return res.status(200).json({ success: true, paymentId: payment.id, payment });
  } catch (e) {
    console.error('API error:', e);
    return res.status(500).json({ error: 'Internal server error' });
  }
};


