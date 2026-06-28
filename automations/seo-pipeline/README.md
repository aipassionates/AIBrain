# SEO pipeline (canonical backup)

The live copy runs from C:\tools. These are the source scripts for disaster recovery.

## Secrets (NOT in git - restore from Bitwarden)
- SUPABASE_ANON_KEY_PASSIONATES - set as env var (scripts read process.env.SUPABASE_ANON_KEY_PASSIONATES)
- WP_APP_PASS_PASSIONATES - WordPress app password, env var

Data/logs/import-batches/transcripts are regenerable and intentionally excluded.
