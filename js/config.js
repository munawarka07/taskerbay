// TaskerBay configuration
// 1. Create a free project at https://supabase.com
// 2. Project Settings → API: copy the Project URL and the "anon public" key below.
// Leave both empty to run TaskerBay in demo mode (data stays in this browser only).
export const SUPABASE_URL = "https://qjuhoknmsveumdxadsgz.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqdWhva25tc3ZldW1keGFkc2d6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUzNjU5NDksImV4cCI6MjExMDk0MTk0OX0.JW29p1qXaXQ89kd5Zc-yl22K4R2YHoWZjdL9bHicDh0";

// Show "Continue with Google" on the sign-in screen (enable Google in Supabase → Authentication → Providers first).
export const ENABLE_GOOGLE = false;

// AI features call the Supabase Edge Function "ai" (see supabase/functions/ai). Set to false to hide them.
export const ENABLE_AI = false; // switch on after deploying supabase/functions/ai with an Anthropic API key

// Popup notifications (Web Push). Public key only; the private key lives in the database.
export const VAPID_PUBLIC_KEY = "BDITUFK4uOFnXQAuVwMQ-mq5DpkFepbykiyQfTsT8xcMuBG76STlX35DTj3CsJebJWqnRY3bpqoGXxlKFEHt3DY";

export const APP_NAME = "TaskerBay";
export const CURRENCY = "AED";
