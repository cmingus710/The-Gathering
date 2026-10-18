import { z } from "zod";

export const PASSWORD_MIN = 10;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Enter your email address.")
  .max(254, "That email address is too long.")
  .pipe(z.email("Enter a valid email address, like name@example.com."));

const newPassword = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(128, "Use 128 characters or fewer.")
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Include at least one letter and one number.");

export const signUpSchema = z
  .object({
    fullName: z.string().trim().min(1, "Enter your name.").max(120, "Use 120 characters or fewer."),
    email,
    password: newPassword,
    confirmPassword: z.string(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  });

export const signInSchema = z.object({
  email,
  password: z.string().min(1, "Enter your password."),
});

export const forgotPasswordSchema = z.object({ email });

export const resetPasswordSchema = z
  .object({ password: newPassword, confirmPassword: z.string() })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords don't match.",
  });

export const profileSchema = z.object({
  fullName: z.string().trim().min(1, "Enter your name.").max(120, "Use 120 characters or fewer."),
  preferredName: z
    .string()
    .trim()
    .max(60, "Use 60 characters or fewer.")
    .transform((v) => v || null),
  phone: z
    .string()
    .trim()
    .max(40, "Use 40 characters or fewer.")
    .refine((v) => v === "" || /^[0-9+().\-\s]{7,40}$/.test(v), "Enter a phone number using digits, spaces, and + ( ) - only.")
    .transform((v) => v || null),
});
