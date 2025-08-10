import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

const YOOKASSA_SHOP_ID = process.env.YOOKASSA_SHOP_ID;
const YOOKASSA_SECRET_KEY = process.env.YOOKASSA_SECRET_KEY;
const APP_URL = process.env.APP_URL || 'https://backend-tau-flame.vercel.app';

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
    const { userId, planId, amount, currency } = req.body as any;
    if (!userId || !planId || !amount || !currency) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const planDetails = {
      'premium-monthly': { name: 'Premium (Месяц)', duration: 30, type: 'premium' },
      'premium-yearly': { name: 'Premium (Год)', duration: 365, type: 'premium' },
      'ultra-monthly': { name: 'Ultra (Месяц)', duration: 30, type: 'ultra' },
      'ultra-yearly': { name: 'Ultra (Год)', duration: 365, type: 'ultra' }
    } as const;

    const plan = (planDetails as any)[planId];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    const paymentData = {
      amount: { value: amount.toString(), currency },
      confirmation: { type: 'redirect', return_url: `${APP_URL}/payment-success` },
      capture: true,
      description: `${plan.name} - Prilojenie ${plan.type === 'ultra' ? 'Ultra' : 'Premium'}`,
      metadata: { userId, planId, duration: plan.duration },
    };

    const response = await fetch('https://api.yookassa.ru/v3/payments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`${YOOKASSA_SHOP_ID}:${YOOKASSA_SECRET_KEY}`).toString('base64')}`
      },
      body: JSON.stringify(paymentData)
    } as any);

    if (!(response as any).ok) {
      throw new Error(`YooKassa API error: ${(response as any).statusText}`);
    }

    const payment = await (response as any).json();

    await supabase
      .from('payments')
      .upsert({
        user_id: userId,
        payment_id: payment.id,
        plan_id: planId,
        amount,
        currency,
        status: 'pending',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'payment_id' });

    return res.status(200).json({ success: true, paymentId: payment.id, confirmationUrl: payment.confirmation?.confirmation_url });
  } catch (error: any) {
    console.error('Error creating payment:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}


