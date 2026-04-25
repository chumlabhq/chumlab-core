# chumlab-be

Node.js + Express + MongoDB backend for [chumlab](https://chumlab.com).
Powers the kern-ui frontend.

- **Razorpay Standard Checkout** (create order + verify signature + webhook)
- **Feedback** API (matches `BuyMeCoffee.tsx` payload)
- **Support** API
- **AI Playground onboarding** API with Google OAuth verification
  (matches `PlaygroundOnboarding.tsx` + `mockApi.ts`)

## Stack

- Node.js >= 18
- Express 4 + Mongoose 8
- Razorpay Node SDK
- google-auth-library (Google OAuth ID-token verification)
- Helmet, CORS, Morgan, express-rate-limit

## Quick start

```bash
cd /Users/adityaagarwal/Developer/chumlab-be
npm install
npm run dev    # http://localhost:5000 (nodemon)
# or
npm start
```

Demo Razorpay checkout: `http://localhost:5000/public/checkout.html`

## Environment

`.env`:

```
PORT=5000
MONGODB_URI=mongodb+srv://...

RAZORPAY_KEY_ID=rzp_test_...
RAZORPAY_KEY_SECRET=...

GOOGLE_CLIENT_ID=xxxxxx-xxxx.apps.googleusercontent.com
GOOGLE_OAUTH_VERIFY=true        # set to "false" only in local dev to skip verification

CORS_ORIGIN=*
RAZORPAY_WEBHOOK_SECRET=optional
```

`KEY_SECRET` and `RAZORPAY_WEBHOOK_SECRET` are server-only; the `key_id` is
returned in the body of `POST /api/create-order` so the frontend can pass it
to the Razorpay modal.

## API

### Health

| Method | Path          |
| ------ | ------------- |
| GET    | `/api/health` |
| GET    | `/`           |

### Razorpay

| Method | Path                       | Description                                |
| ------ | -------------------------- | ------------------------------------------ |
| POST   | `/api/create-order`        | Create order (`amount` in paise, min 100)  |
| POST   | `/api/verify-payment`      | HMAC-SHA256 signature verify               |
| GET    | `/api/orders/:id`          | Fetch saved order by Razorpay order id     |
| POST   | `/api/razorpay/webhook`    | Webhook receiver (needs webhook secret)    |

### Feedback (matches `BuyMeCoffee.tsx`)

```http
POST /api/feedback
Content-Type: application/json

{
  "rating": 5,                         // 0-5, optional
  "feedback": "Love the components!",  // string, max 500, optional
  "amount": 15,                        // USD, required, min 5
  "currency": "USD",                   // default "USD"
  "selected": 1,                       // chip index from UI, optional
  "user": { "name": "...", "email": "..." }   // optional
}
```

| Method | Path                | Description       |
| ------ | ------------------- | ----------------- |
| POST   | `/api/feedback`     | Submit            |
| GET    | `/api/feedback`     | List (paginated)  |
| GET    | `/api/feedback/:id` | Get one           |

### Support

```http
POST /api/support
Content-Type: application/json

{
  "name": "...",
  "email": "...",
  "subject": "...",
  "message": "...",
  "priority": "low|normal|high|urgent"   // optional, default "normal"
}
```

| Method | Path                       | Description       |
| ------ | -------------------------- | ----------------- |
| POST   | `/api/support`             | Open ticket       |
| GET    | `/api/support`             | List (paginated)  |
| GET    | `/api/support/:id`         | Get one           |
| PATCH  | `/api/support/:id/status`  | Update status     |

### Playground onboarding (matches `PlaygroundOnboarding.tsx`)

#### Step 1 — Google sign-in (replaces `mockSignInWithGoogle`)

```http
POST /api/playground/auth/google
Content-Type: application/json

{
  "credential": "<Google ID token from @react-oauth/google>"
}
```

Response:

```json
{
  "success": true,
  "user": {
    "sub": "112233...",
    "name": "Aditya Sharma",
    "email": "aditya@gmail.com",
    "picture": "https://...",
    "initials": "AS"
  }
}
```

#### Step 2 — Submit onboarding (replaces `mockSubmitOnboarding`)

```http
POST /api/playground/onboard
Content-Type: application/json

{
  "credential": "<Google ID token>",      // re-verified server-side
  "role": "student | developer | designer | founder | company | other",
  "context": "full-time",
  "contextLabel": "Full-time founder",
  "budgetTier": "none | low | medium | high | enterprise",
  "budgetLabel": "$10 - $25 / mo",
  "organization": "Acme Inc",             // optional
  "phone": "+919999999999",               // optional, E.164
  "requirements": "Need API access ..."   // optional, max 500
}
```

Response (matches the mock `OnboardingResult` shape exactly):

```json
{
  "success": true,
  "alreadyOnboarded": false,
  "submittedAt": "2026-04-25T03:48:34.701Z",
  "position": 1,
  "estimatedWait": "Within 1 week",
  "submission": { ... }
}
```

A repeat submission with the same Google identity returns
`alreadyOnboarded: true` with the original `submittedAt`/`position` —
matching the spirit of a waitlist that doesn't double-count.

#### Read

| Method | Path                                | Description                |
| ------ | ----------------------------------- | -------------------------- |
| GET    | `/api/playground/onboardings`       | List (paginated, ordered)  |
| GET    | `/api/playground/onboardings/count` | Total signups              |

## Frontend wiring (kern-ui)

### Replace `mockSignInWithGoogle` in `src/pages/playground/mockApi.ts`

Install `@react-oauth/google` in the frontend, wrap the app with
`<GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>`,
then in the onboarding step 1 use the `credential` returned by `<GoogleLogin />`:

```ts
// frontend
const res = await fetch(`${API_BASE}/api/playground/auth/google`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ credential }),
});
const { user } = await res.json();
// user => { sub, name, email, picture, initials }
```

### Replace `mockSubmitOnboarding`

Pass the same `credential` along with the form fields:

```ts
const res = await fetch(`${API_BASE}/api/playground/onboard`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ credential, ...submission }),
});
const { submittedAt, position, estimatedWait } = await res.json();
```

### BuyMeCoffee `handleSubmit`

```ts
await fetch(`${API_BASE}/api/feedback`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ rating, feedback, amount, selected }),
});
```

## Manual steps

1. Create a Google OAuth 2.0 Web Client ID
   ([console.cloud.google.com](https://console.cloud.google.com/apis/credentials))
   and add `http://localhost:5173` (Vite default) and your production origin to
   **Authorized JavaScript origins**. Put the client id in:
   - backend `.env` -> `GOOGLE_CLIENT_ID`
   - frontend `.env` -> `VITE_GOOGLE_CLIENT_ID`
2. Whitelist the Mongo Atlas access for the deploy environment.
3. For production set `CORS_ORIGIN` to your real frontend domain(s) and put the
   service behind HTTPS.
4. (Optional) Configure a Razorpay webhook URL pointing at
   `/api/razorpay/webhook` and copy the secret into `RAZORPAY_WEBHOOK_SECRET`.

## File layout

```
chumlab-be/
  server.js
  package.json
  .env / .env.example
  public/checkout.html
  src/
    app.js
    config/{db.js, razorpay.js, google.js}
    middleware/errorHandler.js
    models/{Order, Feedback, Support, PlaygroundOnboarding}.js
    controllers/{payment, feedback, support, playground}.controller.js
    routes/{payment, feedback, support, playground}.routes.js
    utils/{asyncHandler, ApiError}.js
```
# chumlab-core
