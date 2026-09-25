import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';
import { createAuthRepository } from './auth.repository.js';
import { createAuthService } from './auth.service.js';
import { createAuthController } from './auth.controller.js';

export function createAuthRouter(database, { tokens, loginLimiter }) {
  const router = Router();
  const repository = createAuthRepository(database);
  const service = createAuthService({ repository, tokens, loginLimiter });
  const controller = createAuthController(service);
  router.post('/register', controller.register);
  router.post('/login', controller.login);
  router.post('/verify-email', controller.verifyEmail);
  router.post('/forgot-password', controller.forgotPassword);
  router.post('/reset-password', controller.resetPassword);
  router.post('/logout', requireAuth, controller.logout);
  router.get('/me', requireAuth, controller.me);
  return router;
}
