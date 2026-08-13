import { z } from "zod";

const authUserStatuses = ["ACTIVE", "BLOCKED"] as const;
const registrationKinds = ["PF", "PJ"] as const;
const adminMembershipRoles = ["owner", "admin", "operator", "viewer"] as const;

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeCpf(value: string) {
  return digitsOnly(value);
}

export function normalizeCnpj(value: string) {
  return digitsOnly(value);
}

export function normalizePhone(value: string) {
  return digitsOnly(value);
}

export function normalizePostalCode(value: string) {
  return digitsOnly(value);
}

export function isValidCpf(value: string) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(cpf[index]) * (10 - index);
  }
  let digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  if (digit !== Number(cpf[9])) return false;

  sum = 0;
  for (let index = 0; index < 10; index += 1) {
    sum += Number(cpf[index]) * (11 - index);
  }
  digit = (sum * 10) % 11;
  if (digit === 10) digit = 0;
  return digit === Number(cpf[10]);
}

export function isValidCnpj(value: string) {
  const cnpj = normalizeCnpj(value);
  if (cnpj.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(cnpj)) return false;

  const calculateDigit = (base: string, factors: number[]) => {
    const sum = base
      .split("")
      .reduce((total, char, index) => total + Number(char) * factors[index], 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const firstDigit = calculateDigit(cnpj.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  if (firstDigit !== Number(cnpj[12])) return false;

  const secondDigit = calculateDigit(cnpj.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return secondDigit === Number(cnpj[13]);
}

function isValidPhone(value: string) {
  const phone = normalizePhone(value);
  return phone.length >= 10 && phone.length <= 15;
}

function isValidPostalCode(value: string) {
  const postalCode = normalizePostalCode(value);
  return postalCode.length >= 8 && postalCode.length <= 12;
}

const normalizedEmailSchema = z
  .string()
  .trim()
  .email()
  .transform(normalizeEmail);

const normalizedCpfSchema = z
  .string()
  .trim()
  .transform(normalizeCpf)
  .refine(isValidCpf, "CPF inválido");

const normalizedCnpjSchema = z
  .string()
  .trim()
  .transform(normalizeCnpj)
  .refine(isValidCnpj, "CNPJ inválido");

const normalizedPhoneSchema = z
  .string()
  .trim()
  .transform(normalizePhone)
  .refine(isValidPhone, "Telefone inválido");

const normalizedPostalCodeSchema = z
  .string()
  .trim()
  .transform(normalizePostalCode)
  .refine(isValidPostalCode, "CEP inválido");

const passwordSchema = z.string().min(8).max(128);

export const addressInputSchema = z.object({
  postalCode: normalizedPostalCodeSchema,
  street: z.string().trim().min(1).max(200),
  number: z.string().trim().min(1).max(40),
  complement: z.string().trim().max(200).optional().nullable().transform((value) => value?.trim() || null),
  neighborhood: z.string().trim().min(1).max(120),
  city: z.string().trim().min(1).max(120),
  state: z.string().trim().min(2).max(60),
  country: z.string().trim().min(2).max(80).default("Brasil"),
});

const basePfRegistrationSchema = z.object({
  registrationKind: z.literal("PF"),
  fullName: z.string().trim().min(3).max(160),
  cpf: normalizedCpfSchema,
  email: normalizedEmailSchema,
  phone: normalizedPhoneSchema,
  address: addressInputSchema,
});

const basePjRegistrationSchema = z.object({
  registrationKind: z.literal("PJ"),
  companyName: z.string().trim().min(2).max(160),
  legalName: z.string().trim().max(200).optional().nullable().transform((value) => value?.trim() || null),
  cnpj: normalizedCnpjSchema,
  companyPhone: normalizedPhoneSchema,
  companyAddress: addressInputSchema,
  responsibleFullName: z.string().trim().min(3).max(160),
  responsibleCpf: normalizedCpfSchema,
  responsibleEmail: normalizedEmailSchema,
  responsiblePhone: normalizedPhoneSchema,
  responsibleAddress: addressInputSchema,
});

const registerPfBaseSchema = basePfRegistrationSchema.extend({
  password: passwordSchema,
  confirmPassword: passwordSchema,
});

const registerPjBaseSchema = basePjRegistrationSchema.extend({
  password: passwordSchema,
  confirmPassword: passwordSchema,
});

export const registerPfSchema = registerPfBaseSchema.superRefine((value, ctx) => {
  if (value.password !== value.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "As senhas não coincidem",
      path: ["confirmPassword"],
    });
  }
});

export const registerPjSchema = registerPjBaseSchema.superRefine((value, ctx) => {
  if (value.password !== value.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "As senhas não coincidem",
      path: ["confirmPassword"],
    });
  }
});

export const registerRequestSchema = z.discriminatedUnion("registrationKind", [
  registerPfBaseSchema,
  registerPjBaseSchema,
]).superRefine((value, ctx) => {
  const password = "password" in value ? value.password : null;
  const confirmPassword = "confirmPassword" in value ? value.confirmPassword : null;
  if (password !== confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "As senhas não coincidem",
      path: ["confirmPassword"],
    });
  }
});

export const completePfRegistrationSchema = basePfRegistrationSchema.omit({
  email: true,
});

export const completePjRegistrationSchema = basePjRegistrationSchema.omit({
  responsibleEmail: true,
});

export const completeRegistrationSchema = z.discriminatedUnion("registrationKind", [
  completePfRegistrationSchema,
  completePjRegistrationSchema,
]);

export const forgotPasswordRequestSchema = z.object({
  email: normalizedEmailSchema,
});

export const verifyPasswordResetCodeSchema = z.object({
  email: normalizedEmailSchema,
  code: z.string().trim().regex(/^\d{6}$/),
});

export const resetPasswordWithCodeSchema = z.object({
  email: normalizedEmailSchema,
  code: z.string().trim().regex(/^\d{6}$/),
  newPassword: passwordSchema,
  confirmPassword: passwordSchema,
}).superRefine((value, ctx) => {
  if (value.newPassword !== value.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "As senhas não coincidem",
      path: ["confirmPassword"],
    });
  }
});

export const meCompanySchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  role: z.enum(adminMembershipRoles).nullable(),
  status: z.string().min(1),
});

export const meResponseSchema = z.object({
  id: z.string().min(1),
  fullName: z.string().nullable(),
  email: z.string().email().nullable(),
  phone: z.string().nullable(),
  cpf: z.string().nullable(),
  registrationKind: z.enum(registrationKinds).nullable(),
  status: z.enum(authUserStatuses),
  isSuperAdmin: z.boolean(),
  emailVerified: z.boolean(),
  emailVerifiedAt: z.string().datetime().nullable(),
  companies: z.array(meCompanySchema),
});

export const adminCreateUserSchema = z.object({
  fullName: z.string().trim().min(3).max(160),
  email: normalizedEmailSchema,
  password: passwordSchema,
  cpf: normalizedCpfSchema.optional().nullable(),
  phone: normalizedPhoneSchema.optional().nullable(),
  status: z.enum(authUserStatuses).default("ACTIVE"),
  companyId: z.string().uuid().optional().nullable(),
  membershipRole: z.enum(adminMembershipRoles).optional().nullable(),
});

export const adminUpdateUserSchema = z.object({
  fullName: z.string().trim().min(3).max(160).optional(),
  cpf: normalizedCpfSchema.optional().nullable(),
  phone: normalizedPhoneSchema.optional().nullable(),
  status: z.enum(authUserStatuses).optional(),
}).refine(
  (value) =>
    value.fullName !== undefined ||
    value.cpf !== undefined ||
    value.phone !== undefined ||
    value.status !== undefined,
  "At least one field must be provided",
);

export const adminResetUserPasswordSchema = z.object({
  newPassword: passwordSchema,
  confirmPassword: passwordSchema,
}).superRefine((value, ctx) => {
  if (value.newPassword !== value.confirmPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "As senhas não coincidem",
      path: ["confirmPassword"],
    });
  }
});

export const adminSetUserBlockedSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable().transform((value) => value?.trim() || null),
});

export type AddressInput = z.infer<typeof addressInputSchema>;
export type RegisterPfInput = z.infer<typeof registerPfSchema>;
export type RegisterPjInput = z.infer<typeof registerPjSchema>;
export type RegisterRequest = z.infer<typeof registerRequestSchema>;
export type CompletePfRegistrationInput = z.infer<typeof completePfRegistrationSchema>;
export type CompletePjRegistrationInput = z.infer<typeof completePjRegistrationSchema>;
export type CompleteRegistrationInput = z.infer<typeof completeRegistrationSchema>;
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;
export type VerifyPasswordResetCodeInput = z.infer<typeof verifyPasswordResetCodeSchema>;
export type ResetPasswordWithCodeInput = z.infer<typeof resetPasswordWithCodeSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type AdminCreateUserInput = z.infer<typeof adminCreateUserSchema>;
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;
export type AdminResetUserPasswordInput = z.infer<typeof adminResetUserPasswordSchema>;
export type AdminSetUserBlockedInput = z.infer<typeof adminSetUserBlockedSchema>;
export type AuthUserStatus = (typeof authUserStatuses)[number];
export type RegistrationKind = (typeof registrationKinds)[number];
