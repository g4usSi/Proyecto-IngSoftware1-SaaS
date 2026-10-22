// Datos de contexto para la bitácora (RF-AUT-12); nunca incluyen credenciales.
const metaOf = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') });

export function createAuthController(service) {
  return {
    async register(req, res) {
      const data = await service.register(req.body);
      res.status(201).json({ data });
    },
    async login(req, res) {
      res.json({ data: await service.login(req.body, metaOf(req)) });
    },
    async logout(req, res) {
      res.json({ data: await service.logout(req.session, metaOf(req), req.user) });
    },
    async me(req, res) {
      res.json({ data: await service.getCurrentUser(req.user) });
    },
    async updateMe(req, res) {
      res.json({ data: await service.updateProfile(req.user, req.body) });
    },
    async verifyEmail(req, res) {
      res.json({ data: await service.verifyEmail(req.body) });
    },
    async resendVerification(req, res) {
      res.json({ data: await service.resendVerification(req.body) });
    },
    async forgotPassword(req, res) {
      res.json({ data: await service.forgotPassword(req.body) });
    },
    async resetPassword(req, res) {
      res.json({ data: await service.resetPassword(req.body, metaOf(req)) });
    },
    async changePassword(req, res) {
      res.json({ data: await service.changePassword(req.user, req.body, metaOf(req)) });
    },
  };
}
