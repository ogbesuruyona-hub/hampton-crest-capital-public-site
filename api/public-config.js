module.exports = function handler(_request, response) {
  response.setHeader("Cache-Control", "no-store, max-age=0");
  response.status(200).json({
    SUPABASE_URL: process.env.SUPABASE_URL || "",
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || "",
    PUBLIC_APP_URL: process.env.PUBLIC_APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  });
};
