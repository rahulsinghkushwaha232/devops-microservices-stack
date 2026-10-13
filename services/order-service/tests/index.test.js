const request = require('supertest');
const { createApp } = require('../index');

describe('order service', () => {
  let app;
  let OrderModel;
  let fetchMock;
  const originalUserServiceTimeout = process.env.USER_SERVICE_TIMEOUT_MS;
  const validOrder = { userId: 'user-1', item: 'Keyboard', quantity: 2, price: 29.5 };

  beforeEach(() => {
    delete process.env.USER_SERVICE_TIMEOUT_MS;
    OrderModel = {
      create: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findByIdAndDelete: jest.fn()
    };
    fetchMock = jest.fn();
    app = createApp({
      OrderModel,
      fetchImpl: fetchMock,
      userServiceUrl: () => 'http://users.test',
      dbReady: () => true
    });
  });

  afterEach(() => {
    if (originalUserServiceTimeout === undefined) delete process.env.USER_SERVICE_TIMEOUT_MS;
    else process.env.USER_SERVICE_TIMEOUT_MS = originalUserServiceTimeout;
    jest.restoreAllMocks();
  });

  function userExists() {
    fetchMock.mockResolvedValue(new Response('{"_id":"user-1","name":"Ada"}', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
  }

  test('health and readiness report service state', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
    await request(app).get('/ready').expect(200, { status: 'ready', database: 'connected' });
  });

  test('readiness returns 503 without a database connection', async () => {
    app = createApp({ OrderModel, dbReady: () => false, userServiceUrl: () => 'http://users.test' });
    await request(app).get('/ready').expect(503, { status: 'not_ready', database: 'disconnected' });
  });

  test('creates an order after confirming the user exists', async () => {
    userExists();
    const order = { _id: 'o1', ...validOrder, userName: 'Ada', status: 'placed' };
    OrderModel.create.mockResolvedValue(order);
    await request(app).post('/api/orders').send(validOrder).expect(201, order);
    expect(fetchMock).toHaveBeenCalledWith('http://users.test/api/users/user-1',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) }));
    expect(OrderModel.create).toHaveBeenCalledWith({
      ...validOrder, userName: 'Ada', status: 'placed'
    });
  });

  test('uses the configured user-service timeout', async () => {
    process.env.USER_SERVICE_TIMEOUT_MS = '1234';
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    userExists();
    OrderModel.create.mockResolvedValue({ _id: 'o1', ...validOrder, userName: 'Ada', status: 'placed' });

    await request(app).post('/api/orders').send(validOrder).expect(201);

    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(1234);
  });

  test('defaults the user-service timeout to 5000 milliseconds', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout')
      .mockReturnValue(new AbortController().signal);
    userExists();
    OrderModel.create.mockResolvedValue({ _id: 'o1', ...validOrder, userName: 'Ada', status: 'placed' });

    await request(app).post('/api/orders').send(validOrder).expect(201);

    expect(timeoutSpy).toHaveBeenCalledWith(5000);
  });

  test('retries once after a user-service network error', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('connection reset'));
    userExists();
    OrderModel.create.mockResolvedValue({ _id: 'o1', ...validOrder, userName: 'Ada', status: 'placed' });

    await request(app).post('/api/orders').send(validOrder).expect(201);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(OrderModel.create).toHaveBeenCalledTimes(1);
  });

  test('retries successfully after a user-service timeout', async () => {
    const timeoutError = new DOMException('The operation timed out', 'TimeoutError');
    fetchMock.mockRejectedValueOnce(timeoutError);
    userExists();
    OrderModel.create.mockResolvedValue({ _id: 'o1', ...validOrder, userName: 'Ada', status: 'placed' });

    await request(app).post('/api/orders').send(validOrder).expect(201);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(OrderModel.create).toHaveBeenCalledTimes(1);
  });

  test('rejects invalid order fields without contacting user-service', async () => {
    await request(app).post('/api/orders').send({ ...validOrder, quantity: 0 }).expect(400);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(OrderModel.create).not.toHaveBeenCalled();
  });

  test('returns not found when user-service says user is missing', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"User not found"}', { status: 404 }));
    await request(app).post('/api/orders').send(validOrder).expect(404, { error: 'User not found' });
    expect(OrderModel.create).not.toHaveBeenCalled();
  });

  test('returns 502 when user-service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    await request(app).post('/api/orders').send(validOrder)
      .expect(502, { error: 'User service is unavailable' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(OrderModel.create).not.toHaveBeenCalled();
  });

  test('lists, gets, and reports missing orders', async () => {
    const orders = [{ _id: 'o1', item: 'Keyboard', userName: 'Ada' }];
    OrderModel.find.mockReturnValue({ sort: jest.fn().mockResolvedValue(orders) });
    OrderModel.findById.mockResolvedValueOnce(orders[0]).mockResolvedValueOnce(null);
    await request(app).get('/api/orders').expect(200, orders);
    await request(app).get('/api/orders/o1').expect(200, orders[0]);
    await request(app).get('/api/orders/missing').expect(404, { error: 'Order not found' });
  });

  test('updates order status and rejects an invalid status', async () => {
    OrderModel.findByIdAndUpdate.mockResolvedValue({ _id: 'o1', status: 'paid' });
    await request(app).patch('/api/orders/o1').send({ status: 'paid' })
      .expect(200, { _id: 'o1', status: 'paid' });
    await request(app).patch('/api/orders/o1').send({ status: 'refunded' }).expect(400);
  });

  test('deletes orders and reports missing order', async () => {
    OrderModel.findByIdAndDelete.mockResolvedValueOnce({ _id: 'o1' }).mockResolvedValueOnce(null);
    await request(app).delete('/api/orders/o1').expect(204);
    await request(app).delete('/api/orders/missing').expect(404);
  });

  test('publishes Prometheus metrics', async () => {
    const response = await request(app).get('/metrics').expect(200);
    expect(response.text).toContain('http_requests_total');
    expect(response.text).toContain('http_request_duration_seconds');
  });
});
