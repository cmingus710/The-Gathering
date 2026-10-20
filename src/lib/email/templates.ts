import { getSiteUrl } from "@/lib/site-url";

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function layout(churchName: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#F7F4ED;font-family:Arial,Helvetica,sans-serif;color:#363430">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4ED;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border-radius:12px;padding:32px">
<tr><td style="border-top:3px solid #AD8C53;padding-top:24px;font-size:16px;line-height:1.6">${bodyHtml}</td></tr>
<tr><td style="padding-top:24px;font-size:13px;color:#716B61">${escape(churchName)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function membershipApprovedEmail(opts: { name: string; churchName: string }) {
  const url = `${getSiteUrl()}/sign-in`;
  const greeting = opts.name ? `Hello ${opts.name},` : "Hello,";
  return {
    subject: `Welcome to ${opts.churchName}`,
    text: `${greeting}\n\nYour membership has been approved. You can now sign in to the ${opts.churchName} app:\n${url}\n\nWe're glad you're here.`,
    html: layout(
      opts.churchName,
      `<p>${escape(greeting)}</p><p>Your membership has been approved. You can now sign in to the ${escape(opts.churchName)} app.</p>
<p><a href="${escape(url)}" style="display:inline-block;background:#80642F;color:#FFFFFF;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">Sign in</a></p>
<p>We're glad you're here.</p>`,
    ),
  };
}
