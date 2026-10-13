const request = require('supertest');
const { createApp } = require('../index');

describe('gateway', () => {
  let app;
  let fetchMock;
  const originalUsersUrl = process.env.USER_SERVICE_URL;
  const originalOrdersUrl = process.env.ORDER_SERVICE_URL;

  beforeEach(() => {
    process.env.USER_SERVICE_URL = 'http://users.test';
    process.env.ORDER_SERVICE_URL = 'http://orders.test';
    fetchMock = jest.fn();
    app = createApp({ fetchImpl: fetchMock });
  });

  afterAll(() => {
    if (originalUsersUrl === undefined) delete process.env.USER_SERVICE_URL;
    else process.env.USER_SERVICE_URL = originalUsersUrl;
    if (originalOrdersUrl === undefined) delete process.env.ORDER_SERVICE_URL;
    else process.env.ORDER_SERVICE_URL = originalOrdersUrl;
  });

  test('serves health', async () => {
    await request(app).get('/health').expect(200, { status: 'ok' });
  });

  test('serves the web UI', async () => {
    const response = await request(app).get('/').expect(200);
    expect(response.text).toContain('DevOps Demo');
  });

  test('serves default and request metrics', async () => {
    const response = await request(app).get('/metrics').expect(200);
    expect(response.text).toContain('http_requests_total');
    expect(response.text).toContain('process_cpu');
  });

  test('proxies a user list request and preserves query parameters', async () => {
    fetchMock.mockResolvedValue(new Response('[{"name":"Ada"}]', {
      status: 200,
      headers: { 'content-type': 'application/json' }
    }));
    await request(app).get('/api/users?role=admin').expect(200, [{ name: 'Ada' }]);
    expect(fetchMock).toHaveBeenCalledWith('http://users.test/api/users?role=admin',
      expect.objectContaining({ method: 'GET' }));
  });

  test('proxies JSON bodies to the order service', async () => {
    fetchMock.mockResolvedValue(new Response('{"id":"1"}', {
      status: 201,
      headers: { 'content-type': 'application/json' }
    }));
    await request(app).post('/api/orders')
      .send({ userId: 'u1', item: 'Book' })
      .expect(201, { id: '1' });
    expect(fetchMock.mock.calls[0][1].body).toBe('{"userId":"u1","item":"Book"}');
  });

  test('preserves service errors', async () => {
    fetchMock.mockResolvedValue(new Response('{"error":"missing"}', {
      status: 404,
      headers: { 'content-type': 'application/json' }
    }));
    await request(app).get('/api/users/missing').expect(404, { error: 'missing' });
  });

  test('returns 502 when an upstream is unavailable', async () => {
    fetchMock.mockRejectedValue(new Error('connection refused'));
    await request(app).get('/api/orders').expect(502, { error: 'Unable to reach order service' });
  });
});
