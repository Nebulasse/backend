const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const signature = req.headers['x-yookassa-signature'];
    const body = JSON.stringify(req.body || {});
    if (!signature) return res.status(400).json({ error: 'Missing signature' });
    const expected = crypto.createHmac('sha256', YOOKASSA_SECRET_KEY || '').update(body).digest('hex');
    if (signature !== expected) return res.status(400).json({ error: 'Invalid signature' });

    const { event, object } = req.body || {};
    if (event !== 'payment.succeeded') return res.status(200).json({ success: true, message: 'Event ignored' });

    const paymentId = object?.id;
    const userId = object?.metadata?.userId;
    if (!paymentId || !userId) return res.status(400).json({ error: 'Missing required fields' });

    const { data: payment, error: paymentError } = await supabase.from('payments').select('*').eq('payment_id', paymentId).single();
    if (paymentError || !payment) return res.status(404).json({ error: 'Payment not found' });
    if (payment.status === 'completed') return res.status(200).json({ success: true, message: 'Payment already processed' });

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

    const { error: updatePaymentError } = await supabase.from('payments').update({ status: 'completed', updated_at: new Date().toISOString() }).eq('payment_id', paymentId);
    if (updatePaymentError) throw updatePaymentError;

    const { error: premiumError } = await supabase
      .from('user_premium')
      .upsert([{ user_id: userId, plan_type: plan.planType, is_active: true, expires_at: expiresAt.toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]);
    if (premiumError) throw premiumError;

    const { error: limitsError } = await supabase
      .from('user_limits')
      .upsert([{ user_id: userId, subscription_type: plan.planType, updated_at: new Date().toISOString() }]);
    if (limitsError) throw limitsError;

    return res.status(200).json({ success: true, message: 'Payment processed successfully', paymentId, userId });
  } catch (e) {
    console.error('Webhook processing error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
};


