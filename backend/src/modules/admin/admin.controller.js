import { parseJobsQuery, parseSubscriptionsQuery, parseSummaryQuery, parseUsageQuery } from './admin.validation.js';

export function createAdminController(service) {
  return {
    async subscriptions(req, res) {
      res.json({ data: await service.listSubscriptions(parseSubscriptionsQuery(req.query)) });
    },
    async jobs(req, res) {
      res.json({ data: await service.listJobs(parseJobsQuery(req.query)) });
    },
    async usage(req, res) {
      res.json({ data: await service.listUsage(parseUsageQuery(req.query)) });
    },
    async summary(req, res) {
      parseSummaryQuery(req.query);
      res.json({ data: await service.summary() });
    },
  };
}
