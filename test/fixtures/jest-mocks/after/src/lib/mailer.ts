export interface Mail {
  to: string;
  subject: string;
}

export function sendMail(mail: Mail): string {
  return `sent:${mail.to}:${mail.subject}`;
}
