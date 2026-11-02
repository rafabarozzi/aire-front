/** Table layout and inline styles keep the invitation usable in email clients.
 * No remote images, tracking pixels, fonts, scripts or provider-hosted redirects.
 */
function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export function invitationEmail(organization: string, link: string) {
  const url = new URL(link);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Invalid invitation URL");
  const name = escapeHtml(organization),
    href = escapeHtml(link);
  return {
    subject: `Seu convite para o AIRE — ${organization.replace(/[\r\n]+/g, " ")}`,
    text: `Bem-vindo ao AIRE\n\nA organização ${organization} está pronta para configurar o acesso corporativo.\n\nConfigure o acesso da sua organização:\n${link}\n\n1. Crie seu acesso temporário usando o e-mail que recebeu este convite.\n2. Conecte e teste o Single Sign-On (SSO) da sua empresa.\n3. Confirme o administrador para concluir a configuração.\n\nConvite de uso único, válido por 24 horas. O acesso temporário permite somente configurar o SSO, por até 7 dias a partir do convite, e é encerrado ao concluir.\n\nSe não esperava este convite, ignore esta mensagem.\n\nAIRE by Northeia\nContexto para decidir. Confiança para evoluir.`,
    html: `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Convite para o AIRE</title></head>
<body style="margin:0;padding:0;background-color:#f1f5fb;color:#21354e;font-family:Arial,Helvetica,sans-serif;">
<div style="display:none;font-size:1px;line-height:1px;color:#f1f5fb;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">Configure o acesso corporativo da ${name}. Seu convite é válido por 24 horas.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5fb"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background-color:#ffffff;border:1px solid #e0e7f1;border-radius:16px;overflow:hidden;">
<tr><td bgcolor="#112d50" style="padding:30px 28px;color:#ffffff;">
<p style="margin:0;font-size:34px;line-height:38px;font-weight:bold;letter-spacing:3px;color:#ffffff;">AIRE</p>
<p style="margin:4px 0 28px;font-size:12px;line-height:18px;letter-spacing:1px;color:#c4d6ed;">by Northeia</p>
<p style="margin:0;font-size:22px;line-height:30px;font-weight:bold;color:#ffffff;">Contexto para decidir.</p>
<p style="margin:0;font-size:22px;line-height:30px;color:#a9c8f0;">Confiança para evoluir.</p>
</td></tr>
<tr><td style="padding:30px 28px 20px;">
<p style="margin:0 0 12px;font-size:12px;line-height:18px;font-weight:bold;letter-spacing:2px;color:#1b5dcb;">SEU PRIMEIRO PASSO NO AIRE</p>
<h1 style="margin:0 0 18px;font-size:28px;line-height:36px;color:#152944;">Bem-vindo à sua organização.</h1>
<p style="margin:0 0 22px;font-size:16px;line-height:26px;color:#41546e;">Você recebeu um convite para configurar o acesso corporativo da <strong style="color:#152944;">${name}</strong> ao AIRE.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f8fd" style="border:1px solid #e5ecf6;border-radius:10px;"><tr><td style="padding:20px;">
<p style="margin:0 0 12px;font-size:16px;line-height:24px;color:#152944;font-weight:bold;">Tudo começa com um acesso seguro.</p>
<p style="margin:0 0 10px;font-size:15px;line-height:24px;color:#41546e;"><strong style="color:#1b5dcb;">01.</strong> Crie seu acesso temporário.</p>
<p style="margin:0 0 10px;font-size:15px;line-height:24px;color:#41546e;"><strong style="color:#1b5dcb;">02.</strong> Conecte e teste o SSO da sua empresa.</p>
<p style="margin:0;font-size:15px;line-height:24px;color:#41546e;"><strong style="color:#1b5dcb;">03.</strong> Confirme quem administrará a organização.</p>
</td></tr></table>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 16px;"><tr><td align="center" bgcolor="#1b5dcb" style="border-radius:8px;mso-padding-alt:16px 24px;">
<a href="${href}" style="display:inline-block;padding:16px 24px;border:1px solid #1b5dcb;border-radius:8px;color:#ffffff;text-decoration:none;font-size:16px;line-height:22px;font-weight:bold;mso-padding-alt:0;">Configurar meu acesso</a>
</td></tr></table>
<p style="margin:0 0 22px;font-size:14px;line-height:22px;color:#5d6d83;">Use o mesmo e-mail que recebeu este convite para criar seu acesso.</p>
<p style="margin:0;padding:16px 0;border-top:1px solid #e5ecf6;font-size:14px;line-height:22px;color:#41546e;"><strong>Convite válido por 24 horas e de uso único.</strong><br>O acesso temporário permite somente configurar o SSO, por até 7 dias a partir do convite. Ele será encerrado quando você concluir a configuração.</p>
</td></tr>
<tr><td style="padding:0 28px 28px;">
<p style="margin:0 0 8px;font-size:12px;line-height:20px;color:#65758a;">Se o botão não funcionar, copie e cole este endereço no navegador:</p>
<p style="margin:0;font-size:12px;line-height:20px;word-break:break-all;overflow-wrap:anywhere;"><a href="${href}" style="color:#1b5dcb;text-decoration:underline;word-break:break-all;">${href}</a></p>
</td></tr>
<tr><td bgcolor="#f8fafd" style="padding:22px 28px;border-top:1px solid #e5ecf6;">
<p style="margin:0 0 8px;font-size:13px;line-height:20px;font-weight:bold;color:#152944;">AIRE by Northeia</p>
<p style="margin:0;font-size:12px;line-height:20px;color:#65758a;">Se não esperava este convite, ignore esta mensagem.</p>
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`,
  };
}
