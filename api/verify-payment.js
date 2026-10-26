// POST /api/verify-payment — called by the browser right after Razorpay checkout succeeds.
// Checks the checkout signature, then confirms with Razorpay's API (amount + status) before marking paid.

import { fail, handler, onlyMethods, readBody, send } from './_lib/http.js';
import { verifyCheckoutSignature } from './_lib/razorpay.js';
import { confirmOrder, logPaymentEvent, relaysMap, toPass } from './_lib/registrations.js';

export default handler(async (req, res) => {
  if (!onlyMethods(req, res, ['POST'])) return;
  const { json } = await readBody(req);
  const orderId = String(json.razorpay_order_id || '');
  const paymentId = String(json.razorpay_payment_id || '');
  const signature = String(json.razorpay_signature || '');

  if (!orderId || !paymentId || !signature) return fail(res, 400, 'Missing payment details.');
  if (!verifyCheckoutSignature(orderId, paymentId, signature)) {
    await logPaymentEvent('verify', 'bad_signature', orderId, paymentId, null);
    return fail(res, 400, 'Payment could not be verified. If money was deducted, it will be confirmed automatically or refunded — contact the helpline with your payment ID.');
  }

  const result = await confirmOrder(orderId, 'verify');
  if (result.ok) {
    return send(res, 200, { success: true, pass: toPass(result.registration, await relaysMap()) });
  }
  if (result.reason === 'NOT_PAID_YET') {
    // Rare: Razorpay hasn't marked it captured yet. The webhook will confirm it.
    return send(res, 202, { success: false, pending: true, error: 'Payment received. Confirmation is taking a little longer — check "Track Booking" in 2 minutes.' });
  }
  if (result.reason === 'AMOUNT_MISMATCH') {
    return fail(res, 409, 'Payment amount does not match the entry fee. Our team will review it — please contact the helpline.');
  }
  return fail(res, 400, 'Payment was not successful. No seat has been booked.');
});
