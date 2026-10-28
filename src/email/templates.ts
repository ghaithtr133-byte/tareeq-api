import type { EmailMessage, EmailNotificationJob } from './types.js'

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

const layout = (heading: string, paragraphs: string[]) => `<!doctype html>
<html lang="ar" dir="rtl">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f5f7fa;color:#17233c;font-family:Tahoma,Arial,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f7fa;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #e3e8ef;border-radius:12px;overflow:hidden">
        <tr><td style="background:#102a43;color:#ffffff;padding:22px 28px;border-bottom:3px solid #c7a64a">
          <div style="font-size:14px;color:#f2dc9b">أكاديمية طريق</div>
          <h1 style="margin:6px 0 0;font-size:22px">${heading}</h1>
        </td></tr>
        <tr><td style="padding:26px 28px;font-size:16px;line-height:1.9">
          ${paragraphs.map((paragraph) => `<p style="margin:0 0 14px">${paragraph}</p>`).join('')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

const applicationLabel = (type: 'UNIVERSITY_ADMISSION' | 'SCHOLARSHIP_ASSISTANCE') =>
  type === 'UNIVERSITY_ADMISSION' ? 'القبول الجامعي' : 'المساعدة في المنح الدراسية'

const applicationStudent = (job: EmailNotificationJob): EmailMessage => {
  if (!job.application) throw new Error('Application notification is missing its source record.')
  const name = escapeHtml(job.application.fullName)
  const type = applicationLabel(job.application.applicationType)
  const subject = 'تأكيد استلام طلب المساعدة — أكاديمية طريق'
  return {
    to: job.recipient,
    subject,
    html: layout('تم استلام طلبك', [
      `مرحباً ${name}،`,
      `استلمنا طلبك المتعلق بـ <strong>${type}</strong>.`,
      'هذا الطلب هو طلب مساعدة عبر أكاديمية طريق، ولا يُعد قبولاً أو تأكيداً من جامعة أو جهة مانحة.',
      'سيتم التعامل مع المعلومات المقدمة وفق مسار المتابعة المتاح، دون ضمان مدة معالجة محددة.',
    ]),
    text: `مرحباً ${job.application.fullName}،\n\nاستلمنا طلبك المتعلق بـ ${type}.\n\nهذا الطلب هو طلب مساعدة عبر أكاديمية طريق، ولا يُعد قبولاً أو تأكيداً من جامعة أو جهة مانحة.\n\nسيتم التعامل مع المعلومات المقدمة وفق مسار المتابعة المتاح، دون ضمان مدة معالجة محددة.`,
  }
}

const applicationAdmin = (job: EmailNotificationJob): EmailMessage => {
  if (!job.application) throw new Error('Application notification is missing its source record.')
  const type = applicationLabel(job.application.applicationType)
  const id = escapeHtml(job.application.id)
  return {
    to: job.recipient,
    subject: 'طلب مساعدة طلابية جديد — أكاديمية طريق',
    html: layout('طلب مساعدة جديد', [
      `تم استلام طلب جديد من نوع <strong>${type}</strong>.`,
      `معرّف السجل: <span dir="ltr">${id}</span>`,
      'راجع الطلب من لوحة الإدارة. لا يحتوي هذا الإشعار على بيانات الاتصال أو نص الرسالة.',
    ]),
    text: `تم استلام طلب جديد من نوع ${type}.\nمعرّف السجل: ${job.application.id}\nراجع الطلب من لوحة الإدارة. لا يحتوي هذا الإشعار على بيانات الاتصال أو نص الرسالة.`,
  }
}

const inquiryStudent = (job: EmailNotificationJob): EmailMessage => {
  if (!job.inquiry) throw new Error('Inquiry notification is missing its source record.')
  const name = escapeHtml(job.inquiry.fullName)
  return {
    to: job.recipient,
    subject: 'تأكيد استلام استفسارك — أكاديمية طريق',
    html: layout('تم استلام استفسارك', [
      `مرحباً ${name}،`,
      'استلمنا استفسارك المرسل إلى أكاديمية طريق.',
      'هذا التأكيد يعني أن الاستفسار حُفظ بنجاح، ولا يتضمن وعداً بمدة رد محددة.',
    ]),
    text: `مرحباً ${job.inquiry.fullName}،\n\nاستلمنا استفسارك المرسل إلى أكاديمية طريق.\n\nهذا التأكيد يعني أن الاستفسار حُفظ بنجاح، ولا يتضمن وعداً بمدة رد محددة.`,
  }
}

const inquiryAdmin = (job: EmailNotificationJob): EmailMessage => {
  if (!job.inquiry) throw new Error('Inquiry notification is missing its source record.')
  const id = escapeHtml(job.inquiry.id)
  return {
    to: job.recipient,
    subject: 'استفسار طلابي جديد — أكاديمية طريق',
    html: layout('استفسار جديد', [
      'تم استلام استفسار طلابي جديد.',
      `معرّف السجل: <span dir="ltr">${id}</span>`,
      'راجع الاستفسار من لوحة الإدارة. لا يحتوي هذا الإشعار على بيانات الاتصال أو نص الرسالة.',
    ]),
    text: `تم استلام استفسار طلابي جديد.\nمعرّف السجل: ${job.inquiry.id}\nراجع الاستفسار من لوحة الإدارة. لا يحتوي هذا الإشعار على بيانات الاتصال أو نص الرسالة.`,
  }
}

export const renderEmailNotification = (job: EmailNotificationJob): EmailMessage => {
  switch (job.type) {
    case 'APPLICATION_ADMIN': return applicationAdmin(job)
    case 'APPLICATION_STUDENT': return applicationStudent(job)
    case 'INQUIRY_ADMIN': return inquiryAdmin(job)
    case 'INQUIRY_STUDENT': return inquiryStudent(job)
  }
}
