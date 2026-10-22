// Respuesta pública de pagos y suscripciones: camelCase y sin columnas internas de la base.
function iso(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}

function publicPayment(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    status: payment.status,
    amount: String(payment.amount),
    currency: payment.currency,
    reference: payment.reference,
  };
}

function publicSubscription(subscription) {
  if (!subscription) return null;
  return {
    id: subscription.id,
    status: subscription.status,
    startedAt: iso(subscription.startedAt ?? subscription.started_at),
    expiresAt: iso(subscription.expiresAt ?? subscription.expires_at),
  };
}

function present(result) {
  const { payment, subscription, ...rest } = result;
  const body = { ...rest };
  if (payment !== undefined) body.payment = publicPayment(payment);
  if (subscription !== undefined) body.subscription = publicSubscription(subscription);
  return body;
}

function sendPdf(res, { filename, pdf }) {
  res
    .set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    })
    .send(pdf);
}

export function createSubscriptionsController(service) {
  return {
    async listPlans(_req, res) {
      res.json({ data: await service.listPlans() });
    },

    async me(req, res) {
      res.json({
        data: await service.getMySubscription(req.user.id),
      });
    },

    async checkout(req, res) {
      const result = await service.checkout({
        userId: req.user.id,
        planCode: req.body?.planCode,
        card: req.body?.card,
        idempotencyKey: req.get("Idempotency-Key"),
      });

      res.status(result.repeated ? 200 : 201).json({ data: present(result) });
    },

    async renew(req, res) {
      const result = await service.renew({
        userId: req.user.id,
        card: req.body?.card,
        idempotencyKey: req.get("Idempotency-Key"),
      });

      res.status(result.repeated ? 200 : 201).json({
        data: present(result),
      });
    },

    async changePlan(req, res) {
      const result = await service.changePlan({
        userId: req.user.id,
        planCode: req.body?.planCode,
        card: req.body?.card,
        idempotencyKey: req.get("Idempotency-Key"),
      });

      res.status(200).json({
        data: present(result),
      });
    },

    async receipt(req, res) {
      sendPdf(res, await service.getReceipt(req.user.id, req.params.paymentId));
    },

    async allReceipts(req, res) {
      sendPdf(res, await service.getAllReceipts(req.user.id));
    },

    async paymentHistory(req, res) {
      const result = await service.getPaymentHistory(
        req.user.id,
        req.query.page ?? 1,
        req.query.limit ?? 10,
      );

      res.json({ data: result });
    },
  };
}
