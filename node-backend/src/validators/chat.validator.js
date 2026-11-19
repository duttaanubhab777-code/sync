import { z } from "zod";

const objectId = z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid id");

export const directConversationSchema = z.object({
    partnerId: objectId
});

export const createGroupSchema = z.object({
    groupName: z.string().trim().min(1, "Group name is required").max(100),
    groupDescription: z.string().trim().max(500).optional().default(""),
    groupIcon: z.string().trim().optional().default(""),
    memberIds: z
        .array(objectId)
        .min(1, "Add at least one more member")
        .max(255, "Too many members")
});

export const updateMembersSchema = z.object({
    action: z.enum(["add", "remove", "make_admin", "remove_admin"]),
    targetUserId: objectId
});

export const updateGroupSchema = z
    .object({
        groupName: z.string().trim().min(1).max(100).optional(),
        groupDescription: z.string().trim().max(500).optional(),
        groupIcon: z.string().trim().optional(),
        onlyAdminCanMessage: z.boolean().optional()
    })
    .refine(v => Object.keys(v).length > 0, "Nothing to update");

const mediaSchema = z.object({
    url: z.string().trim().min(1),
    publicId: z.string().optional(),
    mime: z.string().optional(),
    fileName: z.string().trim().max(180).optional(),
    bytes: z.number().nonnegative().optional(),
    width: z.number().nonnegative().optional(),
    height: z.number().nonnegative().optional(),
    duration: z.number().nonnegative().optional()
});

export const locationSchema = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    accuracy: z.number().nonnegative().max(1_000_000).optional(),
    address: z.string().trim().max(240).optional()
});

export const contactSchema = z.object({
    name: z.string().trim().min(1, "Contact name is required").max(100),
    phones: z
        .array(
            z
                .string()
                .trim()
                .min(3)
                .max(32)
                .regex(/^[+\d][\d\s().\-]{2,31}$/, "Invalid phone number")
        )
        .min(1, "At least one phone number is required")
        .max(10, "Too many phone numbers")
});

export const sendMessageSchema = z.object({
    conversationId: objectId,
    clientMsgId: z.string().trim().min(1).max(100),
    type: z
        .enum(["text", "image", "video", "audio", "file", "location", "contact"])
        .default("text"),
    text: z.string().max(4000).optional().default(""),
    media: mediaSchema.nullable().optional(),
    location: locationSchema.nullable().optional(),
    contact: contactSchema.nullable().optional(),
    replyTo: objectId.nullable().optional()
});

export const createStorySchema = z.object({
    type: z.enum(["text", "image", "video"]).default("text"),
    caption: z.string().trim().max(700).optional().default(""),
    backgroundColor: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/, "backgroundColor must be like #0F4C3A")
        .optional()
        .default("#0F4C3A"),
    media: mediaSchema.optional(),
    // ফ্রন্টএন্ডের দেওয়া ইউনিক আইডি: একই story একাধিকবার ট্যাপ/রিট্রাই হলেও একবারই সেভ হবে
    clientStoryId: z
        .string()
        .trim()
        .min(8)
        .max(64)
        .regex(/^[\w-]+$/, "Invalid clientStoryId")
        .optional()
});

// story-তে react: emoji = null বা "" হলে নিজের react সরে যাবে
export const reactStorySchema = z.object({
    emoji: z.string().trim().max(16).nullable().optional()
});

export const replyStorySchema = z.object({
    text: z.string().trim().min(1, "Reply cannot be empty").max(1000)
});

export const updateProfileSchema = z
    .object({
        fullName: z.string().trim().min(3).max(50).optional(),
        about: z.string().trim().max(140).optional(),
        avatar: z.string().trim().optional()
    })
    .refine(v => Object.keys(v).length > 0, "Nothing to update");
