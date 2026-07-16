import { NotificationsService } from './notifications.service';
import type { PrismaService } from '../../prisma/prisma.service';
import type { SmsProviderService } from './sms.provider';

/**
 * Regression tests for the production error:
 *   "Argument `phoneNumber` must not be null."
 *
 * Root cause: `phoneNumber` is a required (non-nullable) column
 * (`phoneNumber String @unique` in schema.prisma). The query built a
 * `NOT: { phoneNumber: null }` filter, which Prisma's query engine rejects
 * for a required `String` column (that filter shape only exists for `String?`
 * columns) — throwing before a single conversation/admin was examined, so
 * the *entire* hourly batch failed, not just the offending row.
 */
describe('NotificationsService.notifyInactiveUsers', () => {
  function buildPrisma(conversations: unknown[]) {
    return {
      conversation: {
        findMany: jest.fn().mockResolvedValue(conversations),
      },
      notificationLog: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
  }

  it('does not build a query-level null filter on the non-nullable phoneNumber column', async () => {
    const prisma = buildPrisma([]);
    const sms = { sendNotification: jest.fn() } as unknown as SmsProviderService;
    const service = new NotificationsService(prisma, sms);

    await (service as any).notifyInactiveUsers(new Date());

    const where = (prisma as any).conversation.findMany.mock.calls[0][0].where;
    expect(where.user).not.toHaveProperty('NOT');
    expect(where.user).not.toHaveProperty('phoneNumber');
  });

  it('excludes a user with a null phoneNumber and still notifies the rest', async () => {
    const conversations = [
      { id: 'conv-1', user: { id: 'user-1', phoneNumber: '09120000001', lastSeenAt: null, firstName: 'علی' } },
      { id: 'conv-2', user: { id: 'user-2', phoneNumber: null, lastSeenAt: null, firstName: 'رضا' } },
    ];
    const prisma = buildPrisma(conversations);
    const sms = {
      sendNotification: jest.fn().mockResolvedValue({ success: true, messageId: 'm1' }),
    } as unknown as SmsProviderService;
    const service = new NotificationsService(prisma, sms);

    await (service as any).notifyInactiveUsers(new Date());

    expect(sms.sendNotification).toHaveBeenCalledTimes(1);
    expect(sms.sendNotification).toHaveBeenCalledWith('09120000001', 'علی');
  });

  it('does not let one recipient failure abort the rest of the batch', async () => {
    const conversations = [
      { id: 'conv-1', user: { id: 'user-1', phoneNumber: '09120000001', lastSeenAt: null, firstName: 'علی' } },
      { id: 'conv-2', user: { id: 'user-2', phoneNumber: '09120000002', lastSeenAt: null, firstName: 'رضا' } },
    ];
    const prisma = buildPrisma(conversations);
    const sms = {
      sendNotification: jest
        .fn()
        .mockRejectedValueOnce(new Error('sms provider down'))
        .mockResolvedValueOnce({ success: true, messageId: 'm2' }),
    } as unknown as SmsProviderService;
    const service = new NotificationsService(prisma, sms);

    await expect((service as any).notifyInactiveUsers(new Date())).resolves.toBeUndefined();

    expect(sms.sendNotification).toHaveBeenCalledTimes(2);
  });
});
