/**
 * SmsProviderService — PishgamRayan SMS gateway
 *
 * PishgamRayan only sends pre-approved templates ("پترن"): POST to
 * /Messages/SendOtp with a templateId + positional parameters ({0}, {1}, ...).
 * There is no free-text/raw-SMS endpoint — every message, OTP or not, must go
 * through a registered template.
 *
 * Templates in use:
 *   - MESSAGE_PROVIDER_OTP_TEMPLATE_ID          (login OTP, e.g. "کد ورود: {0}")
 *   - MESSAGE_PROVIDER_NOTIFICATION_TEMPLATE_ID
 *     "{0} عزیز، در کارآموزیار پیام خوانده‌نشده دارید. وارد شوید." (template id 100562)
 *     Used for the 24h-inactivity "unread message" reminder — this used to
 *     incorrectly reuse the OTP template (sending literal "کد تأیید شما: 1"
 *     SMS instead of an actual reminder). Fixed by giving it its own template.
 *
 * Environment variables:
 *   MESSAGE_PROVIDER_API_KEY                    — API key from PishgamRayan panel
 *   MESSAGE_PROVIDER_SENDER_NUMBER               — sender number (e.g. "50003975")
 *   MESSAGE_PROVIDER_OTP_TEMPLATE_ID             — template id for login OTP
 *   MESSAGE_PROVIDER_NOTIFICATION_TEMPLATE_ID    — template id for inactivity reminder
 *   NODE_ENV                                     — "development" → log only; no real API call
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

function toIntlPhone(raw: string): string {
  const d = raw.replace(/\D/g, '');
  if (d.startsWith('98') && d.length === 12) return d;
  if (d.startsWith('09') && d.length === 11) return '98' + d.slice(1);
  if (d.startsWith('9') && d.length === 10) return '98' + d;
  return d;
}

function mask(mobile: string): string {
  if (!mobile || mobile.length < 4) return '***';
  return `${mobile.slice(0, 4)}***${mobile.slice(-2)}`;
}

@Injectable()
export class SmsProviderService {
  private readonly logger = new Logger(SmsProviderService.name);

  constructor(private readonly config: ConfigService) {}

  /** Login OTP — template renders "کد ورود: {0}" with the 6-digit code. */
  async sendOtp(mobile: string, otpCode: string): Promise<SmsSendResult> {
    const templateId = this.config.get<string>('MESSAGE_PROVIDER_OTP_TEMPLATE_ID', '');
    return this.sendTemplate(mobile, templateId, [otpCode], `OTP for ${mask(mobile)}: ${otpCode}`);
  }

  /**
   * 24h-inactivity "unread message" reminder — template renders
   * "{0} عزیز، در کارآموزیار پیام خوانده‌نشده دارید. وارد شوید." with the
   * recipient's first name.
   */
  async sendNotification(mobile: string, firstName: string): Promise<SmsSendResult> {
    const templateId = this.config.get<string>('MESSAGE_PROVIDER_NOTIFICATION_TEMPLATE_ID', '');
    return this.sendTemplate(
      mobile,
      templateId,
      [firstName || 'کاربر'],
      `Inactivity reminder for ${mask(mobile)}: firstName="${firstName}"`,
    );
  }

  /** Kept for backward compatibility with callers still using the old generic shape. */
  async send(payload: { to: string; firstName: string }): Promise<SmsSendResult> {
    return this.sendNotification(payload.to, payload.firstName);
  }

  /**
   * Shared PishgamRayan template dispatch. `devLogLine` is only used for the
   * development-mode console log, so each call site can log something
   * meaningful (an OTP code vs. a first name) without the shared method
   * needing to know which template it's sending.
   */
  private async sendTemplate(
    mobile: string,
    templateIdStr: string,
    parameters: string[],
    devLogLine: string,
  ): Promise<SmsSendResult> {
    this.logger.log(`Sending SMS (template ${templateIdStr || 'unset'}) to ${mask(mobile)}`);

    if (this.config.get<string>('NODE_ENV') === 'development') {
      this.logger.warn('=== DEVELOPMENT MODE ===');
      this.logger.warn(devLogLine);
      return { success: false, error: 'dev-mode — SMS not sent' };
    }

    const token = this.config.get<string>('MESSAGE_PROVIDER_API_KEY', '');
    const senderNumber = this.config.get<string>('MESSAGE_PROVIDER_SENDER_NUMBER', '');

    if (!token) {
      this.logger.error('MESSAGE_PROVIDER_API_KEY not set');
      return { success: false, error: 'missing api key' };
    }
    if (!senderNumber) {
      this.logger.error('MESSAGE_PROVIDER_SENDER_NUMBER not set');
      return { success: false, error: 'missing sender number' };
    }
    const templateId = parseInt(templateIdStr, 10);
    if (!templateIdStr || isNaN(templateId)) {
      this.logger.error(`Template id not set or invalid: "${templateIdStr}"`);
      return { success: false, error: 'missing/invalid template id' };
    }

    const body = {
      otpId: templateId,
      parameters,
      senderNumber,
      recipientNumbers: [toIntlPhone(mobile)],
    };

    try {
      const response = await fetch('https://smsapi.pishgamrayan.com/Messages/SendOtp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: token,
        },
        body: JSON.stringify(body),
      });

      const responseBody = await response.text();

      if (response.ok) {
        this.logger.log(`✅ SMS sent to ${mask(mobile)}. Response: ${responseBody}`);
        return { success: true, messageId: responseBody };
      }

      this.logger.error(`❌ SMS failed. Status: ${response.status}, Body: ${responseBody}`);
      return { success: false, error: `HTTP ${response.status}: ${responseBody}` };
    } catch (err) {
      this.logger.error(`SMS error for ${mask(mobile)}`, err);
      return { success: false, error: String(err) };
    }
  }
}
