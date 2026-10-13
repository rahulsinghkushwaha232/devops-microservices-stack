const express = require('express');
const mongoose = require('mongoose');
const { Registry, collectDefaultMetrics, Counter, Histogram } = require('prom-client');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, unique: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true });
const User = mongoose.models.User || mongoose.model('User', userSchema);

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

function createApp({ UserModel = User, dbReady = () => mongoose.connection.readyState === 1 } = {}) {
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

  app.post('/api/users', async (req, res, next) => {
    const { name, email, role } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim()
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
      || (role !== undefined && !['user', 'admin'].includes(role))) {
      return res.status(400).json({ error: 'name and valid email are required; role must be user or admin' });
    }
    try {
      const user = await UserModel.create({ name, email, role });
      return res.status(201).json(user);
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'A user with that email already exists' });
      if (error.name === 'ValidationError') return res.status(400).json({ error: error.message });
      return next(error);
    }
  });

  app.get('/api/users', async (req, res, next) => {
    try {
      return res.json(await UserModel.find().sort({ createdAt: -1 }));
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/users/:id', async (req, res, next) => {
    try {
      const user = await UserModel.findById(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(user);
    } catch (error) {
      if (error.name === 'CastError') return res.status(404).json({ error: 'User not found' });
      return next(error);
    }
  });

  const updateUser = async (req, res, next) => {
    const updates = {};
    for (const key of ['name', 'email', 'role']) {
      if (Object.hasOwn(req.body || {}, key)) updates[key] = req.body[key];
    }
    if (Object.keys(updates).length === 0
      || (updates.name !== undefined && (typeof updates.name !== 'string' || !updates.name.trim()))
      || (updates.email !== undefined && (typeof updates.email !== 'string'
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email.trim())))
      || (updates.role !== undefined && !['user', 'admin'].includes(updates.role))) {
      return res.status(400).json({ error: 'Provide valid name, email, or role fields to update' });
    }
    try {
      const user = await UserModel.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.json(user);
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'A user with that email already exists' });
      if (error.name === 'CastError') return res.status(404).json({ error: 'User not found' });
      if (error.name === 'ValidationError') return res.status(400).json({ error: error.message });
      return next(error);
    }
  };
  app.route('/api/users/:id').put(updateUser).patch(updateUser);

  app.delete('/api/users/:id', async (req, res, next) => {
    try {
      const user = await UserModel.findByIdAndDelete(req.params.id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      return res.status(204).end();
    } catch (error) {
      if (error.name === 'CastError') return res.status(404).json({ error: 'User not found' });
      return next(error);
    }
  });

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 500
      ? error.status : 500;
    if (status === 500) console.error('User service request failed:', error);
    return res.status(status).json({ error: status === 400 ? 'Invalid request body' : 'Internal server error' });
  });
  return app;
}

const app = createApp();

if (require.main === module) {
  const port = Number(process.env.PORT || 3001);
  const mongoUrl = process.env.MONGO_URL;
  if (!mongoUrl) throw new Error('MONGO_URL must be configured');
  mongoose.connect(mongoUrl, { dbName: 'userdb' })
    .then(() => app.listen(port, () => console.log(`User service listening on port ${port}`)))
    .catch((error) => {
      console.error('Unable to connect user service to MongoDB:', error);
      process.exitCode = 1;
    });
}

module.exports = app;
module.exports.app = app;
module.exports.createApp = createApp;
module.exports.User = User;
