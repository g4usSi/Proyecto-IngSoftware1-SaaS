import { Router } from "express";
import { requireAuth } from "../../middleware/require-auth.js";
import { createSubscriptionsRepository } from "./subscriptions.repository.js";
import { createSubscriptionsService } from "./subscriptions.service.js";
import { createSubscriptionsController } from "./subscriptions.controller.js";

export function createSubscriptionsRouter(database) {
  const router = Router();
  const repository = createSubscriptionsRepository(database);
  const service = createSubscriptionsService(repository);
  const controller = createSubscriptionsController(service);

  router.get("/plans", controller.listPlans);
  router.get("/subscriptions/me", requireAuth, controller.me);
  router.post("/subscriptions/checkout", requireAuth, controller.checkout);
  router.post("/subscriptions/renew", requireAuth, controller.renew);
  router.post("/subscriptions/change-plan", requireAuth, controller.changePlan);
  router.get("/payments", requireAuth, controller.paymentHistory);
  router.get("/payments/receipts", requireAuth, controller.allReceipts);
  router.get("/payments/:paymentId/receipt", requireAuth, controller.receipt);

  return router;
}
