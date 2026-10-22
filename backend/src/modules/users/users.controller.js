export function createUsersController(service) {
  return {
    async list(req, res) {
      res.json({ data: await service.listUsers(req.query) });
    },
    async get(req, res) {
      res.json({ data: await service.getUser(req.params.id) });
    },
    async setStatus(req, res) {
      res.json({ data: await service.setUserActive(req.user, req.params.id, req.body, { ip: req.ip, userAgent: req.get('user-agent') }) });
    },
  };
}
