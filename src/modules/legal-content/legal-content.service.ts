import type { Types } from "mongoose";
import type { ILegalContent } from "./legal-content.interface";
import { LegalContentRepository } from "./legal-content.repository";
import type {
  LegalContentResponse,
  LegalContentSlug,
  LegalContentUpdatePayload,
} from "./legal-content.type";

const DEFAULT_LEGAL_CONTENT: Record<
  LegalContentSlug,
  { title: string; content: string }
> = {
  "privacy-policy": {
    title: "Privacy Policy",
    content: [
      "Introduction",
      "Superfly Services respects your privacy and protects the information you share with us when requesting quotes, booking services, or contacting our team.",
      "",
      "Information We Collect",
      "We may collect your full name, phone number, email address, service address, booking preferences, payment information, and communications with our team.",
      "",
      "How We Use Information",
      "We use your information to provide quotes, schedule services, process payments, communicate about bookings, improve our operations, and comply with legal obligations.",
      "",
      "Sharing of Information",
      "We only share information with team members, contractors, payment providers, and service partners when required to fulfill your request or operate the business.",
      "",
      "Data Retention",
      "We retain records for as long as needed for service delivery, accounting, dispute resolution, security, and other legitimate business needs.",
      "",
      "Your Choices",
      "You may contact us to review or update your information, request corrections, or ask questions about how your data is handled.",
      "",
      "Contact",
      "For privacy questions, please contact Superfly Services through the contact information provided on our website.",
    ].join("\n"),
  },
  "terms-and-conditions": {
    title: "Terms and Conditions",
    content: [
      "General",
      "These terms govern your use of the Superfly Services website and any quote, booking, or service request submitted through our platform.",
      "",
      "Quotes and Bookings",
      "All quotes are estimates based on the information provided. Final pricing, scope, and availability may change after review, inspection, or confirmation with our team.",
      "",
      "Scheduling",
      "Requested dates and times are subject to cleaner availability, travel time, access conditions, and operational approval.",
      "",
      "Payments",
      "Payments must be made according to the agreed invoice, booking confirmation, or payment link. Late or failed payments may delay or cancel service.",
      "",
      "Cancellations and Changes",
      "Booking changes or cancellations should be requested as early as possible. Additional charges may apply when changes affect labor, supplies, or scheduling.",
      "",
      "Property Access and Safety",
      "Customers must provide safe access to the property and disclose any hazards, restrictions, or special instructions before the appointment.",
      "",
      "Liability",
      "Superfly Services is not responsible for delays or service limitations caused by unsafe conditions, inaccessible areas, inaccurate booking details, or events outside reasonable control.",
      "",
      "Updates",
      "We may update these terms from time to time. Continued use of the website or services after updates means you accept the revised terms.",
    ].join("\n"),
  },
};

export class LegalContentService {
  private repository: LegalContentRepository;

  constructor() {
    this.repository = new LegalContentRepository();
  }

  async getContent(slug: LegalContentSlug): Promise<LegalContentResponse> {
    const content = await this.findOrCreateDefault(slug);
    return this.toResponse(content);
  }

  async updateContent(
    slug: LegalContentSlug,
    payload: LegalContentUpdatePayload,
    adminId?: string
  ): Promise<LegalContentResponse> {
    const content = await this.findOrCreateDefault(slug);
    content.title = payload.title.trim();
    content.content = payload.content.trim();
    content.updatedBy = adminId as Types.ObjectId | undefined;
    await content.save();
    return this.toResponse(content);
  }

  private async findOrCreateDefault(
    slug: LegalContentSlug
  ): Promise<ILegalContent> {
    const existing = await this.repository.findBySlug(slug);
    if (existing) {
      return existing;
    }

    return this.repository.create({
      slug,
      title: DEFAULT_LEGAL_CONTENT[slug].title,
      content: DEFAULT_LEGAL_CONTENT[slug].content,
    } as Partial<ILegalContent>);
  }

  private toResponse(content: ILegalContent): LegalContentResponse {
    return {
      slug: content.slug,
      title: content.title,
      content: content.content,
      createdAt: content.createdAt,
      updatedAt: content.updatedAt,
    };
  }
}
