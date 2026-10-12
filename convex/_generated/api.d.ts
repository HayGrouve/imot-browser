/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as crons from "../crons.js";
import type * as geocache from "../geocache.js";
import type * as importer from "../importer.js";
import type * as imports from "../imports.js";
import type * as lib_errors from "../lib/errors.js";
import type * as lib_fetcher from "../lib/fetcher.js";
import type * as lib_jobs from "../lib/jobs.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_store from "../lib/store.js";
import type * as lib_workspace from "../lib/workspace.js";
import type * as listings from "../listings.js";
import type * as searchForm from "../searchForm.js";
import type * as searchForms from "../searchForms.js";
import type * as sources from "../sources.js";
import type * as validators from "../validators.js";
import type * as workspaces from "../workspaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  geocache: typeof geocache;
  importer: typeof importer;
  imports: typeof imports;
  "lib/errors": typeof lib_errors;
  "lib/fetcher": typeof lib_fetcher;
  "lib/jobs": typeof lib_jobs;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/store": typeof lib_store;
  "lib/workspace": typeof lib_workspace;
  listings: typeof listings;
  searchForm: typeof searchForm;
  searchForms: typeof searchForms;
  sources: typeof sources;
  validators: typeof validators;
  workspaces: typeof workspaces;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
