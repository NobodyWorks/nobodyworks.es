/**
 * Contact form endpoint — Cloudflare Pages Function.
 *
 * The form posts here as a normal HTML form, so it keeps working with JavaScript
 * disabled: success redirects to /gracias, failure redirects back to the form with
 * an error code in the query string.
 *
 * Required environment variables (Pages project -> Settings -> Variables and secrets):
 *   RESEND_API_KEY  secret, from resend.com
 *   CONTACT_TO      inbox that receives the messages, e.g. hola@nobodyworks.es
 *   CONTACT_FROM    verified sender, e.g. "NobodyWorks <web@send.nobodyworks.es>"
 *
 * Verify a SUBDOMAIN with Resend (send.nobodyworks.es), never the root domain: the
 * root MX belongs to Google Workspace and pointing it elsewhere would break the mail.
 */

const FIELD_LIMITS = {
  nombre: 120,
  email: 200,
  mensaje: 4000,
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

export async function onRequestPost({ request, env }) {
  const origin = new URL(request.url).origin;

  let form;
  try {
    form = await request.formData();
  } catch {
    return back(origin, 'formato');
  }

  // Honeypot: a real person never sees this field, so anything in it is a bot.
  // Answer 303 as if it had worked — telling a bot it failed only invites a retry.
  if (read(form, 'empresa')) return done(origin);

  const nombre = read(form, 'nombre');
  const email = read(form, 'email');
  const mensaje = read(form, 'mensaje');

  if (!nombre || !email || !mensaje) return back(origin, 'incompleto');
  if (!EMAIL_PATTERN.test(email)) return back(origin, 'correo');
  if (tooLong({ nombre, email, mensaje })) return back(origin, 'largo');

  const to = env.CONTACT_TO;
  const from = env.CONTACT_FROM;
  const key = env.RESEND_API_KEY;

  if (!key || !to || !from) {
    console.error('contact: missing RESEND_API_KEY, CONTACT_TO or CONTACT_FROM');
    return back(origin, 'configuracion');
  }

  const body = [
    `Nombre:  ${nombre}`,
    `Correo:  ${email}`,
    '',
    mensaje,
  ].join('\n');

  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: email,
        subject: `Web · ${nombre}`,
        text: body,
      }),
    });
  } catch (error) {
    console.error('contact: request to the mail provider failed', error);
    return back(origin, 'envio');
  }

  if (!response.ok) {
    console.error('contact: mail provider returned', response.status, await safeText(response));
    return back(origin, 'envio');
  }

  return done(origin);
}

// A GET here means someone opened the URL directly; send them to the form.
export function onRequestGet({ request }) {
  return back(new URL(request.url).origin, null);
}

function read(form, field) {
  const value = form.get(field);
  return typeof value === 'string' ? value.trim() : '';
}

function tooLong(values) {
  return Object.entries(values).some(([field, value]) => value.length > FIELD_LIMITS[field]);
}

function done(origin) {
  return Response.redirect(`${origin}/gracias`, 303);
}

function back(origin, code) {
  const target = code ? `${origin}/?error=${code}#contacto` : `${origin}/#contacto`;
  return Response.redirect(target, 303);
}

async function safeText(response) {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '(sin cuerpo)';
  }
}
