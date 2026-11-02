import { z } from "zod";

export const registerSchema = z.object({
    username: z.string().trim().toLowerCase().min(3).max(20),
    fullName: z.string().trim().min(3).max(20),
    email: z.string().trim().toLowerCase().email(),
    phoneNumber: z
        .string()
        .regex(/^\d{10}$/, "Must be a valid 10-digit number"),
    password: z.string().min(8).max(64),
    avatar: z.string().url().optional()
});

export const loginSchema = z.object({
    identifier: z
        .string()
        .trim()
        .min(3, "Username, email or phone number is required"),
    password: z.string().min(8, "Password is required")
});