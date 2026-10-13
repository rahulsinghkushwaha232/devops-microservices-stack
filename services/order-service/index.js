const express = require('express');
const mongoose = require('mongoose');
const { Registry, collectDefaultMetrics, Counter, Histogram } = require('prom-client');

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  userName: { type: String, required: true },
  item: { type: String, required: true, trim: true, maxlength: 150 },
  quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
  price: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ['placed', 'paid', 'shipped', 'cancelled'], default: 'placed' },
  createdAt: { type: Date, default: Date.now }
});
const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

function getUserServiceTimeoutMs() {
  const configuredTimeout = process.env.USER_SERVICE_TIMEOUT_MS;
  if (configuredTimeout === undefined || configuredTimeout === '') return 5000;
  const timeoutMs = Number(configuredTimeout);
  return Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : null;
}

function createMetrics() {
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
  return { registry, requestsTotal, requestDuration };
}

function createApp({
  OrderModel = Order,
  dbReady = () => mongoose.connection.readyState === 1,
  fetchImpl = global.fetch,
  userServiceUrl = () => process.env.USER_SERVICE_URL
} = {}) {
  const app = express();
  const metrics = createMetrics();
  app.use(express.json());
  app.use((req, res, next) => {
    const end = metrics.requestDuration.startTimer();
    res.once('finish', () => {
      const route = req.route ? `${req.baseUrl}${req.route.path}` : req.path;
      const labels = { method: req.method, route, status: String(res.statusCode) };
      metrics.requestsTotal.inc(labels);
      end(labels);
    });
    next();
  });

  app.get('/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/ready', (req, res) => {
    if (!dbReady()) return res.status(503).json({ status: 'not_ready', database: 'disconnected' });
    return res.json({ status: 'ready', database: 'connected' });
  });
  app.get('/metrics', async (req, res, next) => {
    try {
      res.set('Content-Type', metrics.registry.contentType);
      res.send(await metrics.registry.metrics());
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/orders', async (req, res, next) => {
    const { userId, item, quantity, price } = req.body || {};
    if (typeof userId !== 'string' || !userId.trim() || typeof item !== 'string' || !item.trim()
      || !Number.isInteger(quantity) || quantity < 1
      || typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'userId, item, positive integer quantity, and non-negative price are required' });
    }

    const serviceUrl = userServiceUrl();
    if (!serviceUrl) return res.status(502).json({ error: 'USER_SERVICE_URL is not configured' });
    const timeoutMs = getUserServiceTimeoutMs();
    if (timeoutMs === null) {
      return res.status(500).json({ error: 'USER_SERVICE_TIMEOUT_MS must be a positive integer' });
    }
    let userResponse;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        userResponse = await fetchImpl(`${serviceUrl.replace(/\/$/, '')}/api/users/${encodeURIComponent(userId)}`, {
          method: 'GET',
          signal: AbortSignal.timeout(timeoutMs)
        });
        break;
      } catch (error) {
        if (attempt === 1) return res.status(502).json({ error: 'User service is unavailable' });
      }
    }
    if (userResponse.status === 404) return res.status(404).json({ error: 'User not found' });
    if (!userResponse.ok) return res.status(502).json({ error: 'User service returned an unexpected response' });

    let user;
    try {
      user = await userResponse.json();
    } catch (error) {
      return res.status(502).json({ error: 'User service returned an invalid response' });
    }
    if (!user || typeof user.name !== 'string' || !user.name) {
      return res.status(502).json({ error: 'User service returned an invalid response' });
    }
    try {
      const order = await OrderModel.create({
        userId, userName: user.name, item, quantity, price, status: 'placed'
      });
      return res.status(201).json(order);
    } catch (error) {
      if (error.name === 'ValidationError' || error.name === 'CastError') {
        return res.status(400).json({ error: error.message });
      }
      return next(error);
    }
  });

  app.get('/api/orders', async (req, res, next) => {
    try {
      return res.json(await OrderModel.find().sort({ createdAt: -1 }));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/orders/:id', async (req, res, next) => {
    try {
      const order = await OrderModel.findById(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      return res.json(order);
    } catch (error) {
      if (error.name === 'CastError') return res.status(404).json({ error: 'Order not found' });
      return next(error);
    }
  });

  const updateOrderStatus = async (req, res, next) => {
    const { status } = req.body || {};
    if (!['placed', 'paid', 'shipped', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'status must be placed, paid, shipped, or cancelled' });
    }
    try {
      const order = await OrderModel.findByIdAndUpdate(req.params.id, { status }, {
        new: true,
        runValidators: true
      });
      if (!order) return res.status(404).json({ error: 'Order not found' });
      return res.json(order);
    } catch (error) {
      if (error.name === 'CastError') return res.status(404).json({ error: 'Order not found' });
      if (error.name === 'ValidationError') return res.status(400).json({ error: error.message });
      return next(error);
    }
  };
  app.route('/api/orders/:id').put(updateOrderStatus).patch(updateOrderStatus);

  app.delete('/api/orders/:id', async (req, res, next) => {
    try {
      const order = await OrderModel.findByIdAndDelete(req.params.id);
      if (!order) return res.status(404).json({ error: 'Order not found' });
      return res.status(204).end();
    } catch (error) {
      if (error.name === 'CastError') return res.status(404).json({ error: 'Order not found' });
      return next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status : 500;
    if (status === 500) console.error('Order service request failed:', error);
    return res.status(status).json({ error: status === 400 ? 'Invalid request body' : 'Internal server error' });
  });
  return app;
}

const app = createApp();

if (require.main === module) {
  const port = Number(process.env.PORT || 3002);
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) throw new Error('MONGO_URL must be configured');
  mongoose.connect(mongoUrl, { dbName: 'orderdb' })
    .then(() => app.listen(port, () => console.log(`Order service listening on port ${port}`)))
    .catch((error) => {
      console.error('Unable to connect order service to MongoDB:', error);
      process.exitCode = 1;
    });
}

module.exports = app;
module.exports.app = app;
module.exports.createApp = createApp;
module.exports.Order = Order;
