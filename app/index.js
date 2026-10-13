const path = require('node:path');
const express = require('express');
const { Registry, collectDefaultMetrics, Counter, Histogram } = require('prom-client');

const registry = new Registry();
collectDefaultMetrics({ register: registry });
const requestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
  registers: [registry]
});
const requestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  registers: [registry]
});

function createApp({ fetchImpl = global.fetch } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const end = requestDuration.startTimer();
    res.once('finish', () => {
      const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path;
      const labels = { method: req.method, route, status: String(res.statusCode) };
      requestsTotal.inc(labels);
      end(labels);
    });
    next();
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', registry.contentType);
      res.send(await registry.metrics());
    } catch (error) {
      next(error);
    }
  });

  const demoUsers = [
    { _id: '1', name: 'Rahul Singh Kushwaha', email: 'rahul@example.com', role: 'admin' },
    { _id: '2', name: 'DevOps Engineer', email: 'engineer@cloud.io', role: 'user' }
  ];
  const demoOrders = [
    { _id: '101', userId: '1', userName: 'Rahul Singh Kushwaha', item: 'Kubernetes EKS Cluster', quantity: 1, price: 120.00, status: 'completed' },
    { _id: '102', userId: '2', userName: 'DevOps Engineer', item: 'Trivy Scanner License', quantity: 2, price: 45.00, status: 'pending' }
  ];

  function handleDemoUsers(req, res) {
    if (req.method === 'GET') {
      return res.json(demoUsers);
    }
    if (req.method === 'POST') {
      const { name, email, role = 'user' } = req.body || {};
      if (!name || !email) return res.status(400).json({ error: 'Name and email are required' });
      const newUser = { _id: String(Date.now()), name, email, role };
      demoUsers.push(newUser);
      return res.status(201).json(newUser);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  function handleDemoOrders(req, res) {
    if (req.method === 'GET') {
      return res.json(demoOrders);
    }
    if (req.method === 'POST') {
      const { userId, item, quantity = 1, price = 0 } = req.body || {};
      if (!userId || !item) return res.status(400).json({ error: 'User and item are required' });
      const user = demoUsers.find(u => u._id === userId);
      const newOrder = {
        _id: String(Date.now()),
        userId,
        userName: user ? user.name : 'Demo User',
        item,
        quantity: Number(quantity),
        price: Number(price),
        status: 'pending'
      };
      demoOrders.push(newOrder);
      return res.status(201).json(newOrder);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  }

  function proxy(prefix, targetEnvironmentVariable) {
    return async (req, res) => {
      const baseUrl = process.env[targetEnvironmentVariable];
      if (!baseUrl) {
        if (prefix === 'user') return handleDemoUsers(req, res);
        if (prefix === 'order') return handleDemoOrders(req, res);
        return res.status(502).json({ error: `${targetEnvironmentVariable} is not configured` });
      }

      const target = `${baseUrl.replace(/\/$/, '')}${req.originalUrl}`;
      const headers = {};
      if (req.get('content-type')) headers['content-type'] = req.get('content-type');
      if (req.get('accept')) headers.accept = req.get('accept');

      try {
        const response = await fetchImpl(target, {
          method: req.method,
          headers,
          body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body ?? {})
        });
        const contentType = response.headers.get('content-type');
        if (contentType) res.set('content-type', contentType);
        res.status(response.status);
        const body = await response.text();
        return body ? res.send(body) : res.end();
      } catch (error) {
        return res.status(502).json({ error: `Unable to reach ${prefix} service` });
      }
    };
  }

  app.all('/api/users', proxy('user', 'USER_SERVICE_URL'));
  app.all('/api/users/*', proxy('user', 'USER_SERVICE_URL'));
  app.all('/api/orders', proxy('order', 'ORDER_SERVICE_URL'));
  app.all('/api/orders/*', proxy('order', 'ORDER_SERVICE_URL'));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status : 500;
    if (status === 500) console.error('Gateway request failed:', error);
    return res.status(status).json({ error: status === 400 ? 'Invalid request' : 'Internal server error' });
  });
  return app;
}

const app = createApp();

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Gateway listening on port ${port}`));
}

module.exports = app;
module.exports.app = app;
module.exports.createApp = createApp;
