export function createAuthController(service) {
  return {
    async register(req, res) {
      const data = await service.register(req.body);
      res.status(201).json({ data });
    },
    async login(req, res) {
      res.json({ data: await service.login(req.body) });
    },
    async logout(req, res) {
      res.json({ data: await service.logout(req.session) });
    },
    async me(req, res) {
      res.json({ data: await service.getCurrentUser(req.user) });
    },
    async verifyEmail(req, res) {
      res.json({ data: await service.verifyEmail(req.body) });
    },
    async forgotPassword(req, res) {
      res.json({ data: await service.forgotPassword(req.body) });
    },
    async resetPassword(req, res) {
      res.json({ data: await service.resetPassword(req.body) });
    },
  };
}
