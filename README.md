# DreamGift Lite

Pool money with friends for a wedding gift on one elegant shared page. Friends chip in by UPI **directly to the organiser** and leave a blessing. The organiser confirms what arrived, and the couple gets a keepsake of every name and blessing.

> DreamGift Lite never handles money. Nothing counts as paid until the organiser confirms it.

Stack: plain HTML, CSS and vanilla JavaScript (ES modules) with no build step · Supabase (Postgres, RLS, RPC, magic-link auth) · Vercel static hosting.

## Status

| Phase | State |
|---|---|
| 1. Foundation (tokens, components, `/styleguide`, `vercel.json`) | ✅ Done |
| 2. Database (`schema.sql`, `tests.sql`) | ✅ Done (70/70 checks pass on Supabase) |
| 3. Organiser auth + create gift | Next |
| 4. Public gift page | — |
| 5. Dashboard | — |
| 6. Keepsake + polish | — |
| 7. Deploy | — |

## Run it locally

You need Node 20 or newer. There are no packages to install.

```bash
node tools/dev-server.mjs        # http://localhost:5173/styleguide
node --test tests/               # unit tests
```

The dev server applies the clean URLs, rewrites and security headers (including the Content-Security-Policy) from `vercel.json`, so what works locally works on Vercel. VS Code Live Server also works for single pages, but it won't apply the headers or the `/g/{slug}` rewrites.

## Supabase setup

1. In the Supabase dashboard, open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**. It is safe to run again.
2. In a new query, paste [`supabase/tests.sql`](supabase/tests.sql) and run it. You should see one row: `PASS: all 70 checks passed`. It creates throwaway test organisers and deletes them afterwards.
3. Put the project URL and **publishable** (or legacy anon) key in [`assets/js/config.js`](assets/js/config.js). Never use the `service_role` / secret key in the front end.

How the data is protected:

- RLS is on for both tables. Organisers can read and change only their own gifts and those gifts' contributions. Column grants stop them reading friends' token hashes or changing `owner_id` and `slug`.
- The `anon` role has no table access at all. Friends use five `SECURITY DEFINER` functions: `get_public_gift`, `get_public_blessings`, `create_pledge`, `mark_paid` and `get_my_pledge`.
- A friend's pledge token is stored only as a SHA-256 hash. The raw token lives on the friend's phone.
- Progress counts **confirmed** money only. The blessings wall shows friends who have marked their pledge as paid or been confirmed, never hidden blessings, and amounts only when the organiser allows it and the money is confirmed.
- `authenticated` cannot `select *` from `contributions` (the token-hash column is private), so the front end always names its columns.

## Project structure

```
assets/css/tokens.css        colours, type scale, spacing, radius, motion
assets/css/base.css          reset, typography, layout helpers, focus rings
assets/css/components.css    buttons, fields, chips, toggle, progress, cards, badges,
                             blessings, sheet/modal, toast, skeletons, states, table
assets/css/pages/            per-page styles
assets/js/format.js          ₹ formatting (en-IN, paise in / rupees out), dates
assets/js/ui.js              toast, sheet, busy buttons, progress, field errors, copy
assets/js/pages/             one module per page
assets/img/                  favicon set, Open Graph image
tools/dev-server.mjs         local server that mirrors vercel.json
tests/                       node:test unit tests
vercel.json                  clean URLs, rewrites, security headers
```

## Design notes

- Brand colours are exactly as specified. Sage (4.1:1) and amber (3.4:1) are too light for small text on ivory, so badges keep the brand colour for the dot and use darker ink shades for the text (6.2:1 and 5.1:1). Champagne is never used for text.
- All user text is written with `textContent`. The codebase has no `innerHTML`.
- The CSP allows no inline scripts or `style=""` attributes. Dynamic values (for example the progress width) are set through CSS custom properties from JavaScript.
