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

      res.status(result.repeated ? 200 : 201).json({ data: result });
    },

    async renew(req, res) {
      const result = await service.renew({
        userId: req.user.id,
        card: req.body?.card,
        idempotencyKey: req.get("Idempotency-Key"),
      });

      res.status(result.repeated ? 200 : 201).json({
        data: result,
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
        data: result,
      });
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
