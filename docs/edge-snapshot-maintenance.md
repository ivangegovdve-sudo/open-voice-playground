# Edge metadata snapshot maintenance

The Edge catalog is a static, maintainer-reviewed metadata snapshot. The public application never
fetches the service voice list and never synthesizes through Edge.

## Review workflow

1. A maintainer obtains a raw JSON export through an independently authorized process. Do not add a
   fetch, credential, service call, or synthesis path to the importer.
2. Save the export outside committed paths. It may use normalized fields (`upstreamId`, `locale`,
   `gender`, `styles`) or the source export fields (`ShortName`, `Locale`, `Gender`,
   `VoiceTag.ContentCategories`).
3. Normalize and review the candidate without writing:

   ```powershell
   npm.cmd run catalog:review:edge-snapshot -- --input C:\path\to\maintainer-export.json
   ```

   The command prints the candidate count, SHA-256, and added/removed/changed IDs. A difference exits
   nonzero intentionally.

4. Inspect the complete raw provenance, normalized change list, locale/gender/styles, and service
   terms. Record the printed candidate hash in the review.
5. Only after explicit approval, write using the exact printed hash:

   ```powershell
   npm.cmd run catalog:review:edge-snapshot -- --input C:\path\to\maintainer-export.json --write --approve-hash sha256:<reviewed-digest>
   ```

   A missing or mismatched hash refuses the write.

6. Regenerate and verify all deterministic artifacts:

   ```powershell
   npm.cmd run catalog:generate
   git diff -- packages/catalog/src/launch-data.ts packages/catalog/data/launch-catalog.public.json
   npm.cmd run test:catalog
   npm.cmd run catalog:check
   npm.cmd run typecheck:catalog
   ```

7. Keep every Edge voice `terms-not-cleared`, metadata-only, with no asset set and no synthesis
   action. Updating metadata never authorizes runtime use.

Do not commit the raw service export unless a separate provenance/privacy review explicitly approves
it. The deterministic public artifact is the normalized static snapshot and its content hash.
