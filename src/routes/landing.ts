import { Hono } from 'hono'

import type { AuthEnv } from '../auth/types.js'

const landingPage = `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light">
    <meta name="theme-color" content="#0b1f3a">
    <title>Tareeq Academy API</title>
    <style>
      :root {
        color-scheme: light;
        --navy: #0b1f3a;
        --navy-soft: #17365d;
        --gold: #c7a45a;
        --gold-soft: #ead9ad;
        --paper: #fbfaf6;
        --ink: #172033;
        --muted: #5f6978;
      }

      * { box-sizing: border-box; }

      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 2rem;
        color: var(--ink);
        background:
          radial-gradient(circle at 12% 10%, rgba(199, 164, 90, 0.16), transparent 28rem),
          linear-gradient(145deg, #f5f3ec 0%, var(--paper) 48%, #eef2f7 100%);
        font-family: Tahoma, Arial, sans-serif;
      }

      main {
        width: min(100%, 54rem);
        overflow: hidden;
        border: 1px solid rgba(11, 31, 58, 0.12);
        border-radius: 1.25rem;
        background: rgba(255, 255, 255, 0.94);
        box-shadow: 0 1.5rem 4rem rgba(11, 31, 58, 0.13);
      }

      .accent { height: 0.35rem; background: linear-gradient(90deg, var(--navy), var(--gold)); }

      .content { padding: clamp(2rem, 7vw, 4.5rem); }

      .brand {
        display: inline-flex;
        align-items: center;
        gap: 0.65rem;
        margin: 0 0 2.2rem;
        color: var(--navy);
        font-size: 0.82rem;
        font-weight: 700;
        letter-spacing: 0.12em;
        text-transform: uppercase;
      }

      .brand-mark {
        display: grid;
        width: 2.35rem;
        height: 2.35rem;
        place-items: center;
        border: 1px solid var(--gold);
        border-radius: 50%;
        color: var(--gold);
        font-family: Georgia, serif;
        font-size: 1.15rem;
      }

      .eyebrow {
        margin: 0 0 0.8rem;
        color: var(--gold);
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.14em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0;
        color: var(--navy);
        font-family: Georgia, 'Times New Roman', serif;
        font-size: clamp(2.15rem, 7vw, 4.25rem);
        font-weight: 600;
        line-height: 1.05;
        letter-spacing: -0.035em;
      }

      .intro {
        max-width: 40rem;
        margin: 1.35rem 0 0;
        color: var(--muted);
        font-size: clamp(1rem, 2.5vw, 1.15rem);
        line-height: 1.9;
      }

      nav {
        display: flex;
        flex-wrap: wrap;
        gap: 0.75rem;
        margin-top: 2.25rem;
      }

      a {
        display: inline-flex;
        min-height: 2.9rem;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(11, 31, 58, 0.18);
        border-radius: 0.7rem;
        padding: 0.72rem 1rem;
        color: var(--navy);
        background: #fff;
        font-family: Arial, sans-serif;
        font-size: 0.9rem;
        font-weight: 700;
        text-decoration: none;
        transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
      }

      a.primary {
        border-color: var(--navy);
        padding-inline: 1.3rem;
        color: #fff;
        background: var(--navy);
      }

      a.download { border-color: var(--gold); background: #fffcf3; }

      a:hover { border-color: var(--gold); box-shadow: 0 0.5rem 1.2rem rgba(11, 31, 58, 0.1); transform: translateY(-1px); }
      a:focus-visible { outline: 3px solid var(--gold-soft); outline-offset: 3px; }

      footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1rem;
        margin-top: 3rem;
        padding-top: 1.25rem;
        border-top: 1px solid rgba(11, 31, 58, 0.1);
        color: var(--muted);
        font-size: 0.78rem;
      }

      .service-label { display: inline-flex; align-items: center; gap: 0.5rem; }
      .service-label::before { width: 0.45rem; height: 0.45rem; border-radius: 50%; background: var(--gold); content: ''; }

      @media (max-width: 38rem) {
        body { padding: 1rem; }
        .content { padding: 2rem 1.35rem; }
        .brand { margin-bottom: 1.7rem; }
        nav { flex-direction: column; }
        a { width: 100%; }
        footer { align-items: flex-start; flex-direction: column; }
      }

      @media (prefers-reduced-motion: reduce) {
        a { transition: none; }
      }
    </style>
  </head>
  <body>
    <main>
      <div class="accent" aria-hidden="true"></div>
      <div class="content">
        <div class="brand" dir="ltr">
          <span class="brand-mark" aria-hidden="true">T</span>
          <span>Tareeq Academy</span>
        </div>
        <p class="eyebrow" dir="ltr">Backend API</p>
        <h1 dir="ltr">Tareeq Academy API</h1>
        <p class="intro">
          هذه هي الواجهة البرمجية الخلفية لمنصة طريق أكاديمي، وتوفّر خدمات المحتوى والتكامل الآمن لتطبيقات المنصة.
        </p>
        <nav aria-label="روابط الواجهة البرمجية" dir="ltr">
          <a class="primary" href="/docs">API Documentation</a>
          <a class="download" href="/postman/collection.json" download>Download Postman Collection</a>
          <a class="download" href="/postman/download.zip" download>Download Postman Package (ZIP)</a>
          <a href="/openapi.json">OpenAPI JSON</a>
          <a href="/api/v1/health">Health Endpoint</a>
        </nav>
        <footer>
          <span class="service-label">واجهة الخدمة الرسمية</span>
          <span dir="ltr">api.tareeq-academy.com</span>
        </footer>
      </div>
    </main>
  </body>
</html>`

export const landingRoutes = new Hono<AuthEnv>()

landingRoutes.get('/', (c) => c.html(landingPage))
