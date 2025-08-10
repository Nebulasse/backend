const { createClient } = require('@supabase/supabase-js');

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { paymentId } = req.query || {};
    if (!paymentId) return res.status(400).json({ error: 'Payment ID is required' });

    const { data: payment } = await supabase.from('payments').select('*').eq('payment_id', paymentId).single();
    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const response = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      method: 'GET',
      headers: { 'Authorization': `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64')}` }
    });
    if (!response.ok) throw new Error(`YooKassa API error: ${response.statusText}`);
    const yooKassaPayment = await response.json();
    if (yooKassaPayment.status !== 'succeeded') return res.status(400).json({ success: false, error: 'Payment not completed' });

    await supabase.from('payments').update({ status: 'completed' }).eq('payment_id', paymentId);

    const planDetails = {
      'premium-monthly': { duration: 30, planType: 'premium' },
      'premium-yearly': { duration: 365, planType: 'premium' },
      'ultra-monthly': { duration: 30, planType: 'ultra' },
      'ultra-yearly': { duration: 365, planType: 'ultra' },
    };
    const plan = planDetails[payment.plan_id];
    if (!plan) return res.status(400).json({ error: 'Invalid plan ID' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.duration);

    const { error: premiumError } = await supabase
      .from('user_premium')
      .upsert([{ user_id: payment.user_id, plan_type: plan.planType, is_active: true, expires_at: expiresAt.toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]);
    if (premiumError) throw premiumError;

    await supabase.from('user_limits').update({ subscription_type: plan.planType }).eq('user_id', payment.user_id);
    return res.status(200).json({ success: true, message: 'Premium subscription activated successfully' });
  } catch (e) {
    console.error('Error confirming payment:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};


