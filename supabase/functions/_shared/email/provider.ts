// Swap the email provider by changing one import in runner.ts. Nothing else knows Brevo exists.
export interface SendEmailInput {
  to: { email: string; name?: string | null };
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
  tags?: string[];
}
export type SendResult = { ok: true; id?: string } | { ok: false; status: number; error: string; rateLimited: boolean };
export interface EmailProvider { name: string; send(input: SendEmailInput): Promise<SendResult>; }
