export type EmailMessage = {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>; // the List-Unsubscribe headers when the template has them
  idempotencyKey: string; // 'signin-<email_codes.id>-<send_count>' from the API; 'job:<job id>' from the worker
  replyTo?: string;
};
export type Mailer = { sendEmail(message: EmailMessage): Promise<void> };
