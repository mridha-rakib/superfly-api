import { asyncHandler } from "@/middlewares/async-handler.middleware";
import { ApiResponse } from "@/utils/response.utils";
import { zParse } from "@/utils/validators.utils";
import { sendPublicContactMessageSchema } from "./contact.schema";
import { ContactService } from "./contact.service";

export class ContactController {
  private contactService: ContactService;

  constructor() {
    this.contactService = new ContactService();
  }

  sendPublicContactMessage = asyncHandler(async (req, res) => {
    const validated = await zParse(sendPublicContactMessageSchema, req);
    const result = await this.contactService.sendPublicContactMessage(
      validated.body,
    );

    ApiResponse.success(res, result, "Message sent successfully");
  });
}

