import { z } from "zod";

export const normalizePhone = value => {
    let v = value.replace(/[\s\-()]/g, "");
    if (v.startsWith("+91")) v = v.slice(3);
    else if (v.startsWith("91") && v.length === 12) v = v.slice(2);
    else if (v.startsWith("0") && v.length === 11) v = v.slice(1);
    return v;
};

export const registerSchema = z.object({
    username: z
        .string()
        .trim()
        .toLowerCase()
        .min(3, "Username must be at least 3 characters")
        .max(20, "Username must be at most 20 characters")
        .regex(
            /^[a-z][a-z0-9_]*$/,
            "Username must start with a letter and use only letters, numbers, underscore"
        ),

    fullName: z
        .string()
        .trim()
        .min(3, "Full name must be at least 3 characters")
        .max(50, "Full name must be at most 50 characters"),

    email: z.string().trim().toLowerCase().email("Enter a valid email address"),

    phoneNumber: z
        .string()
        .trim()
        .transform(normalizePhone)
        .refine(
            v => /^[6-9]\d{9}$/.test(v),
            "Enter a valid 10-digit Indian mobile number"
        ),

    password: z
        .string()
        .min(8, "Password must be at least 8 characters")
        .max(64, "Password must be at most 64 characters"),

    avatar: z.string().url("Avatar must be a valid URL").optional()
});

// Super Admin নতুন Admin বানানোর সময়: register-এর মতোই, শুধু avatar লাগে না
export const createAdminSchema = registerSchema.omit({ avatar: true });

export const loginSchema = z.object({
    identifier: z
        .string()
        .trim()
        .min(1, "Username, email or phone number is required")
        .transform(v => {
            if (v.includes("@")) return v.toLowerCase();
            if (/^\+?[\d\s\-()]+$/.test(v)) return normalizePhone(v);
            return v.toLowerCase();
        }),

    password: z.string().min(1, "Password is required")
});
