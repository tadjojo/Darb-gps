import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

const enabled = Boolean(process.env.REDIS_URL);
(enabled ? describe : describe.skip)('Redis multi-instance fanout integration', () => {
  let redis: Redis;
  const stream = `darb:test:${randomUUID()}`;
  const groupA = `gateway:${randomUUID()}`;
  const groupB = `gateway:${randomUUID()}`;

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!, { maxRetriesPerRequest: 1 });
    await redis.ping();
    await redis.xgroup('CREATE', stream, groupA, '0-0', 'MKSTREAM');
    await redis.xgroup('CREATE', stream, groupB, '0-0');
  });
  afterAll(async () => {
    if (redis) {
      await redis.del(stream);
      await redis.quit();
    }
  });

  it('delivers the same stream event independently to each replica consumer group', async () => {
    const eventId = randomUUID();
    const streamId = await redis.xadd(stream, '*', 'eventType', 'vehicle.location.updated', 'aggregateId', randomUUID(), 'payload', JSON.stringify({ eventId }));
    const readA = await redis.xreadgroup('GROUP', groupA, 'replica-a', 'COUNT', 1, 'STREAMS', stream, '>');
    const readB = await redis.xreadgroup('GROUP', groupB, 'replica-b', 'COUNT', 1, 'STREAMS', stream, '>');
    expect(readA?.[0]?.[1]?.[0]?.[0]).toBe(streamId);
    expect(readB?.[0]?.[1]?.[0]?.[0]).toBe(streamId);
    await redis.xack(stream, groupA, streamId!);
    await redis.xack(stream, groupB, streamId!);
  });
});
