import { Types } from "mongoose";
import { SupportConversation, SupportMessage } from "./support.model";
import { ISupportConversation, ISupportMessage, TicketStatus } from "./support.interface";

export const SupportRepository = {
  async findActiveByUserId(userId: string | Types.ObjectId): Promise<ISupportConversation | null> {
    return SupportConversation.findOne({
      userId,
      status: { $in: ["OPEN", "ASSIGNED"] },
    })
      .populate("userId", "fullName avatar email phone countryId countryName createdAt")
      .populate("assignedAgentId", "fullName email avatar")
      .populate("countryId", "name code flag timezone")
      .exec();
  },

  async findById(id: string | Types.ObjectId): Promise<ISupportConversation | null> {
    return SupportConversation.findById(id)
      .populate("userId", "fullName avatar email phone countryId countryName createdAt")
      .populate("assignedAgentId", "fullName email avatar")
      .populate("countryId", "name code flag timezone")
      .exec();
  },

  async createConversation(data: Partial<ISupportConversation>): Promise<ISupportConversation> {
    const conversation = await SupportConversation.create(data);
    return conversation.toObject();
  },

  async updateConversationStatus(
    id: string | Types.ObjectId,
    status: TicketStatus,
    updateFields: Partial<ISupportConversation> = {},
  ): Promise<ISupportConversation | null> {
    return SupportConversation.findByIdAndUpdate(
      id,
      { status, ...updateFields },
      { new: true },
    )
      .populate("userId", "fullName avatar email phone countryId countryName createdAt")
      .populate("assignedAgentId", "fullName email avatar")
      .populate("countryId", "name code flag timezone")
      .exec();
  },

  async findMessagesByConversationId(
    conversationId: string | Types.ObjectId,
    page = 1,
    limit = 50,
  ): Promise<ISupportMessage[]> {
    const skip = (page - 1) * limit;
    return SupportMessage.find({ conversationId })
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .exec();
  },

  async createMessage(data: Partial<ISupportMessage>): Promise<ISupportMessage> {
    const msg = await SupportMessage.create(data);
    return msg.toObject();
  },
};
