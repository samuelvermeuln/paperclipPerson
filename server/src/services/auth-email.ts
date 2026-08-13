import { logger } from "../middleware/logger.js";

export type AuthOtpType = "sign-in" | "email-verification" | "forget-password" | "change-email";

function authEmailFrom() {
  return process.env.AUTH_EMAIL_FROM?.trim() || process.env.RESEND_FROM_EMAIL?.trim() || null;
}

function authEmailReplyTo() {
  return process.env.AUTH_EMAIL_REPLY_TO?.trim() || null;
}

function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim() && authEmailFrom());
}

function subjectForType(type: AuthOtpType) {
  switch (type) {
    case "email-verification":
      return "Paperclip verification code";
    case "forget-password":
      return "Paperclip password reset code";
    case "change-email":
      return "Paperclip email change code";
    case "sign-in":
      return "Paperclip sign-in code";
    default:
      return "Paperclip verification code";
  }
}

function bodyForType(type: AuthOtpType, otp: string) {
  switch (type) {
    case "email-verification":
      return `Seu código de verificação do Paperclip é: ${otp}\n\nEste código expira em 10 minutos.`;
    case "forget-password":
      return `Seu código para redefinir a senha do Paperclip é: ${otp}\n\nEste código expira em 10 minutos.`;
    case "change-email":
      return `Seu código para alterar e-mail no Paperclip é: ${otp}\n\nEste código expira em 10 minutos.`;
    case "sign-in":
      return `Seu código de acesso do Paperclip é: ${otp}\n\nEste código expira em 10 minutos.`;
    default:
      return `Seu código do Paperclip é: ${otp}`;
  }
}

export async function sendAuthOtpEmail(input: { email: string; otp: string; type: AuthOtpType }) {
  if (!isResendConfigured()) {
    logger.info(
      {
        email: input.email,
        type: input.type,
        otp: input.otp,
        delivery: "log_fallback",
      },
      "Auth OTP email fallback: Resend not configured",
    );
    return;
  }

  const from = authEmailFrom();
  if (!from) {
    throw new Error("Auth email sender address is not configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: subjectForType(input.type),
      text: bodyForType(input.type, input.otp),
      ...(authEmailReplyTo() ? { reply_to: authEmailReplyTo() } : {}),
    }),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => "");
    throw new Error(`Resend email request failed: ${response.status} ${payload}`);
  }
}
