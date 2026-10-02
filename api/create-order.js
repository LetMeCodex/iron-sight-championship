// Vercel Serverless API: /api/create-order
// Creates a Razorpay order for NexShot Technologies Shooting Championship registrations

import Razorpay from 'razorpay';
import 'dotenv/config';

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;

  if (!key_id || !key_secret) {
    console.error('Razorpay credentials missing from environment variables.');
    return res.status(500).json({
      success: false,
      error: 'Payment gateway configuration error: Razorpay API keys missing.'
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (err) {
        body = {};
      }
    }
    body = body || {};

    let { amount, currency, receipt, notes } = body;

    // Validate amount
    const parsedAmount = Number(amount);
    if (!parsedAmount || isNaN(parsedAmount)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid amount. Amount in paise is required.'
      });
    }

    // Minimum amount: 100 paise (₹1)
    if (parsedAmount < 100) {
      return res.status(400).json({
        success: false,
        error: 'Amount must be at least 100 paise (₹1).'
      });
    }

    currency = currency || 'INR';
    receipt = receipt || `rcpt_nst_${Date.now()}`;

    const razorpay = new Razorpay({
      key_id,
      key_secret
    });

    const orderOptions = {
      amount: Math.round(parsedAmount),
      currency,
      receipt: String(receipt).slice(0, 40), // Razorpay receipt max 40 chars
      notes: notes || {}
    };

    const order = await razorpay.orders.create(orderOptions);

    return res.status(200).json({
      success: true,
      order_id: order.id,
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: key_id
    });
  } catch (error) {
    console.error('Razorpay order creation error:', error);

    // Auth error handling
    if (error.statusCode === 401 || (error.error && error.error.code === 'BAD_REQUEST_ERROR' && error.statusCode === 401)) {
      return res.status(401).json({
        success: false,
        error: 'Authentication failed with payment gateway.'
      });
    }

    return res.status(500).json({
      success: false,
      error: error.error?.description || error.message || 'Failed to create payment order.'
    });
  }
}
