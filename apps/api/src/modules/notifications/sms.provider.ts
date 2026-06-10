/**
 * SmsProviderService — PishgamRayan OTP gateway
 *
 * sendOtp(mobile, code) → POST https://smsapi.pishgamrayan.com/Messages/SendOtp
 *
 * Used for:
 *   - Login OTP verification (code = 6-digit number)
 *   - Inactivity notification (code = "1" as fixed placeholder parameter)
 *
 * Environment variables:
 *   MESSAGE_PROVIDER_API_KEY         — API key from PishgamRayan panel
 *   MESSAGE_PROVIDER_SENDER_NUMBER   — sender number (e.g. "50003975")
 *   MESSAGE_PROVIDER_OTP_TEMPLATE_ID — integer template id (e.g. "100393")
 *   NODE_ENV                         — "development" → log only; no real API call
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
  if (d.startsWith('9')  && d.length === 10) return '98' + d;
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

  /**
   * Send via PishgamRayan OTP template.
   *
   * Login:        sendOtp(mobile, "123456")
   * Notification: sendOtp(mobile, "1")  — template already contains the message text
   *
   * Development: logs to console only, no real API call.
   */
  async sendOtp(mobile: string, otpCode: string): Promise<SmsSendResult> {
    this.logger.log(`Sending OTP to ${mask(mobile)}`);

    if (this.config.get<string>('NODE_ENV') === 'development') {
      this.logger.warn('=== DEVELOPMENT MODE ===');
      this.logger.warn(`OTP for ${mask(mobile)}: ${otpCode}`);
      return { success: false, error: 'dev-mode — SMS not sent' };
    }

    const token = this.config.get<string>('MESSAGE_PROVIDER_API_KEY', '');
    const senderNumber = this.config.get<string>('MESSAGE_PROVIDER_SENDER_NUMBER', '');
    const otpTemplateIdStr = this.config.get<string>('MESSAGE_PROVIDER_OTP_TEMPLATE_ID', '');

    if (!token) {
      this.logger.error('MESSAGE_PROVIDER_API_KEY not set');
      return { success: false, error: 'missing api key' };
    }
    if (!senderNumber) {
      this.logger.error('MESSAGE_PROVIDER_SENDER_NUMBER not set');
      return { success: false, error: 'missing sender number' };
    }
    const otpTemplateId = parseInt(otpTemplateIdStr, 10);
    if (!otpTemplateIdStr || isNaN(otpTemplateId)) {
      this.logger.error('MESSAGE_PROVIDER_OTP_TEMPLATE_ID not set or invalid');
      return { success: false, error: 'missing/invalid template id' };
    }

    const body = {
      otpId: otpTemplateId,
      parameters: [otpCode],
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

  /** Called by NotificationsService — passes "1" as the fixed parameter */
  async send(payload: { to: string; message: string }): Promise<SmsSendResult> {
    return this.sendOtp(payload.to, '1');
  }
}
