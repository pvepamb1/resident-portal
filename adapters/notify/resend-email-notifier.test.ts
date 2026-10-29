import { beforeEach, describe, expect, it, vi } from 'vitest';

const send = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn(function Resend() {
    return { emails: { send } };
  }),
}));

const { createResendEmailNotifier } = await import('./resend-email-notifier');

describe('createResendEmailNotifier attachments', () => {
  beforeEach(() => send.mockReset());

  it("maps attachments onto Resend's attachments field", async () => {
    send.mockResolvedValue({ data: { id: 'x' }, error: null });
    const notifier = createResendEmailNotifier({ apiKey: 're_test', fromAddress: 'a@example.com' });
    const content = Buffer.from('a,b\r\n');

    const result = await notifier.sendEmail({
      to: 't@example.com',
      subject: 's',
      html: '<p>h</p>',
      attachments: [{ filename: 'tenancy-payment-history.csv', content, contentType: 'text/csv' }],
    });

    expect(result.ok).toBe(true);
    expect(send.mock.calls[0]![0].attachments).toEqual([
      { filename: 'tenancy-payment-history.csv', content, contentType: 'text/csv' },
    ]);
  });

  it('fails the send when Resend rejects it (e.g. a bad attachment)', async () => {
    send.mockResolvedValue({ data: null, error: { message: 'attachment rejected' } });
    const notifier = createResendEmailNotifier({ apiKey: 're_test', fromAddress: 'a@example.com' });

    const result = await notifier.sendEmail({
      to: 't@example.com',
      subject: 's',
      html: 'h',
      attachments: [{ filename: 'f.csv', content: 'x', contentType: 'text/csv' }],
    });

    expect(result.ok).toBe(false);
  });

  it('omits the attachments field when there are none', async () => {
    send.mockResolvedValue({ data: { id: 'x' }, error: null });
    const notifier = createResendEmailNotifier({ apiKey: 're_test', fromAddress: 'a@example.com' });
    await notifier.sendEmail({ to: 't@example.com', subject: 's', html: 'h' });
    expect(send.mock.calls[0]![0]).not.toHaveProperty('attachments');
  });
});
