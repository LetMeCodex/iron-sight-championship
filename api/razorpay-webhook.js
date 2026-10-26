// POST /api/razorpay-webhook — Razorpay calls this server-to-server after every payment.
// This is the safety net: even if the athlete's browser closes after paying, the seat is confirmed here.
// Configure in Razorpay Dashboard -> Webhooks: events payment.captured, payment.failed, order.paid.

import { fail, handler, onlyMethods, readBody, send } from './_lib/http.js';
import { verifyWebhookSignature } from './_lib/razorpay.js';
import { confirmOrder, logPaymentEvent } from './_lib/registrations.js';

export default handler(async (req, res) => {
  if (!onlyMethods(req, res, ['POST'])) return;
  const { raw, json } = await readBody(req);
  const signature = req.headers['x-razorpay-signature'];

  // When we have the exact raw body, reject bad signatures outright.
  // Either way, confirmOrder() re-checks the payment with Razorpay's API before marking anything paid.
  if (raw && process.env.RAZORPAY_WEBHOOK_SECRET && !verifyWebhookSignature(raw, signature)) {
    return fail(res, 400, 'Invalid signature');
  }

  const event = json.event || '';
  const payment = json.payload && json.payload.payment && json.payload.payment.entity;
  const order = json.payload && json.payload.order && json.payload.order.entity;
  const orderId = (payment && payment.order_id) || (order && order.id);

  await logPaymentEvent('webhook', event, orderId || null, payment ? payment.id : null, { event, status: payment && payment.status });

  if (orderId && ['payment.captured', 'payment.authorized', 'order.paid', 'payment.failed'].includes(event)) {
    const result = await confirmOrder(orderId, 'webhook');
    return send(res, 200, { success: true, result: result.ok ? 'confirmed' : result.reason });
  }
  send(res, 200, { success: true, ignored: true });
});
