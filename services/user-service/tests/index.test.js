const request = require('supertest');
const { createApp } = require('../index');

describe('user service', () => {
  let app;
  let UserModel;

  beforeEach(() => {
    UserModel = {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn()
    };
    app = createApp({ UserModel, dbReady: () => true });
  });

  test('health and readiness report service state', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
    await request(app).get('/ready').expect(200, { status: 'ready', database: 'connected' });
  });

  test('readiness returns 503 without a database connection', async () => {
    app = createApp({ UserModel, dbReady: () => false });
    await request(app).get('/ready').expect(503, { status: 'not_ready', database: 'disconnected' });
  });

  test('creates a valid user', async () => {
    UserModel.create.mockResolvedValue({ _id: 'u1', name: 'Ada', email: 'ada@example.test', role: 'admin' });
    await request(app).post('/api/users').send({ name: 'Ada', email: 'ada@example.test', role: 'admin' })
      .expect(201, { _id: 'u1', name: 'Ada', email: 'ada@example.test', role: 'admin' });
    expect(UserModel.create).toHaveBeenCalledWith({ name: 'Ada', email: 'ada@example.test', role: 'admin' });
  });

  test('rejects invalid user input', async () => {
    await request(app).post('/api/users').send({ name: 'Ada', email: 'bad', role: 'user' })
      .expect(400);
    expect(UserModel.create).not.toHaveBeenCalled();
  });

  test('returns conflict for duplicate email', async () => {
    UserModel.create.mockRejectedValue({ code: 11000 });
    await request(app).post('/api/users').send({ name: 'Ada', email: 'ada@example.test' })
      .expect(409, { error: 'A user with that email already exists' });
  });

  test('lists users', async () => {
    const users = [{ _id: 'u1', name: 'Ada' }];
    UserModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(users) });
    await request(app).get('/api/users').expect(200, users);
  });

  test('gets a user or returns not found', async () => {
    UserModel.findById.mockResolvedValueOnce({ _id: 'u1', name: 'Ada' }).mockResolvedValueOnce(null);
    await request(app).get('/api/users/u1').expect(200, { _id: 'u1', name: 'Ada' });
    await request(app).get('/api/users/missing').expect(404, { error: 'User not found' });
  });

  test('updates and deletes users, returning not found when absent', async () => {
    UserModel.findByIdAndUpdate.mockResolvedValueOnce({ _id: 'u1', name: 'Ada Lovelace' }).mockResolvedValueOnce(null);
    UserModel.findByIdAndDelete.mockResolvedValueOnce({ _id: 'u1' }).mockResolvedValueOnce(null);
    await request(app).patch('/api/users/u1').send({ name: 'Ada Lovelace' })
      .expect(200, { _id: 'u1', name: 'Ada Lovelace' });
    await request(app).patch('/api/users/missing').send({ name: 'Nobody' }).expect(404);
    await request(app).delete('/api/users/u1').expect(204);
    await request(app).delete('/api/users/missing').expect(404);
  });

  test('publishes Prometheus metrics', async () => {
    const response = await request(app).get('/metrics').expect(200);
    expect(response.text).toContain('http_requests_total');
    expect(response.text).toContain('http_request_duration_seconds');
  });
});
