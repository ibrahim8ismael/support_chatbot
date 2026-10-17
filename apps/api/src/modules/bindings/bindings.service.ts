import { Injectable } from '@nestjs/common';

/**
 * Bindings — owns `inbox_bindings`.
 * Exposes to other modules: inbox ↔ KB mapping.
 * Does NOT do: KB CRUD itself.
 *
 * TODO(bindings): CRUD endpoints per docs/api/rest-api.md; cache invalidation
 * on change (docs/architecture/caching.md).
 */
@Injectable()
export class BindingsService {}
