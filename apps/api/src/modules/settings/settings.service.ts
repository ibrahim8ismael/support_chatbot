import { Injectable } from '@nestjs/common';

/**
 * Settings — owns the `settings` key/value table (typed accessors, values
 * validated on write; cached 60s with explicit invalidation).
 * Exposes to other modules: typed get/set of runtime settings.
 * Does NOT do: secrets — those are env-only (docs/operations/security.md).
 *
 * TODO(settings): schema from docs/architecture/data-model.md § settings
 * (bot_enabled, thresholds, models, ...), defaults applied on first read.
 */
@Injectable()
export class SettingsService {}
