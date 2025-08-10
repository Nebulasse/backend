import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL as string,
  process.env.SUPABASE_SERVICE_ROLE_KEY as string
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { paymentId } = req.query as { paymentId?: string };
    if (!paymentId) return res.status(400).json({ error: 'Payment ID is required' });

    const { data: payment } = await supabase
      .from('payments')
      .select('*')
      .eq('payment_id', paymentId)
      .single();

    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const response = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64')}`
      }
    } as any);

    if (!(response as any).ok) {
      throw new Error(`YooKassa API error: ${(response as any).statusText}`);
    }

    const yooKassaPayment = await (response as any).json();
    if (yooKassaPayment.status !== 'succeeded') {
      return res.status(400).json({ success: false, error: 'Payment not completed' });
    }

    await supabase
      .from('payments')
      .update({ status: 'completed' })
      .eq('payment_id', paymentId);

    const planDetails = {
      'premium-monthly': { duration: 30, planType: 'premium' },
      'premium-yearly': { duration: 365, planType: 'premium' },
      'ultra-monthly': { duration: 30, planType: 'ultra' },
      'ultra-yearly': { duration: 365, planType: 'ultra' },
    } as const;

    const plan = (planDetails as any)[payment.plan_id];
    if (!plan) return res.status(400).json({ error: 'Invalid plan ID' });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + plan.duration);

    const { error: premiumError } = await supabase
      .from('user_premium')
      .upsert([{ user_id: payment.user_id, plan_type: plan.planType, is_active: true, expires_at: expiresAt.toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }]);
    if (premiumError) throw premiumError;

    await supabase
      .from('user_limits')
      .update({ subscription_type: plan.planType })
      .eq('user_id', payment.user_id);

    return res.status(200).json({ success: true, message: 'Premium subscription activated successfully' });
  } catch (error: any) {
    console.error('Error confirming payment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}


