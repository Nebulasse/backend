import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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
    const signature = req.headers['x-yookassa-signature'] as string;
    const body = JSON.stringify(req.body);
    if (!signature) return res.status(400).json({ error: 'Missing signature' });

    const expectedSignature = crypto
      .createHmac('sha256', YOOKASSA_SECRET_KEY || '')
      .update(body)
      .digest('hex');
    if (signature !== expectedSignature) return res.status(400).json({ error: 'Invalid signature' });

    const { event, object } = req.body as any;
    if (event !== 'payment.succeeded') return res.status(200).json({ success: true, message: 'Event ignored' });

    const paymentId = object.id;
    const userId = object.metadata?.userId;
    if (!paymentId || !userId) return res.status(400).json({ error: 'Missing required fields' });

    const { data: payment, error: paymentError } = await supabase
      .from('payments')
      .select('*')
      .eq('payment_id', paymentId)
      .single();
    if (paymentError || !payment) return res.status(404).json({ error: 'Payment not found' });

    if (payment.status === 'completed') return res.status(200).json({ success: true, message: 'Payment already processed' });

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

    const { error: updatePaymentError } = await supabase
      .from('payments')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('payment_id', paymentId);
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
  } catch (error: any) {
    console.error('Webhook processing error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}


