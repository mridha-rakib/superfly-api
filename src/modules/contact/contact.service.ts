import { EmailService } from "@/services/email.service";

type SendPublicContactMessagePayload = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

export class ContactService {
  private emailService: EmailService;

  constructor() {
    this.emailService = new EmailService();
  }

  async sendPublicContactMessage(
    payload: SendPublicContactMessagePayload,
  ): Promise<{ sent: boolean }> {
    await this.emailService.sendPublicContactMessage(payload);
    return { sent: true };
  }
}

