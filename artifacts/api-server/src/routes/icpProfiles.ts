// Controlled server-side endpoints for ICP profile lifecycle management
// (create/list/retrieve/edit-draft/clone/publish/activate). No evaluation,
// decision, routing, or action logic lives here — this route only manages
// icp_profiles / icp_profile_versions / icp_profile_activation_events rows
// via ../services/icpProfiles.ts.
//
// Mounted at /api/internal/icp-profiles behind the existing requireAuth
// session boundary (see ./index.ts) — the same authenticated boundary
// already guarding /api/n8n, /api/sheets, and
// /api/internal/account-evaluations. No new auth mechanism is introduced.
//
// Only imports from @workspace/db/schema, never @workspace/db itself — the
// database instance is a required constructor argument
// (IcpProfilesRouterDeps.db), so this module has no import-time side
// effects and route tests can inject fake service implementations without
// a real Postgres connection. See ./icpProfiles.route.test.ts.

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@workspace/db/schema";
import {
  createProfile,
  listProfiles,
  getProfile,
  updateDraft,
  cloneVersionIntoDraft,
  publishDraft,
  activateVersion,
  ProfileNotFoundError,
  VersionNotFoundError,
  VersionBelongsToAnotherProfileError,
  DraftAlreadyExistsError,
  NoDraftVersionError,
  VersionNotPublishedError,
  InvalidProfileConfigError,
  type CreateProfileArgs,
  type UpdateDraftArgs,
  type CloneVersionArgs,
  type ActivateVersionArgs,
} from "../services/icpProfiles.js";

// Required but deliberately typed `unknown` — the canonical profile-config
// shape is owned exclusively by @workspace/evaluator's
// IcpProfileConfigV1Schema, validated once inside the service
// (validateProfileConfig). This route must not re-implement or narrow
// that validation itself; it only enforces that the field is present at
// all (a missing config is a 400 invalid_request, not a 422 — the 422
// path is reserved for a present-but-canonically-invalid config).
const RequiredUnknownSchema = z
  .unknown()
  .refine((value) => value !== undefined, { message: "Required" });

// createdBy/performedBy are deliberately NOT part of any request schema
// below. They are never accepted from the client — always derived
// server-side from req.operator (see deriveCreatedBy), exactly like
// ../routes/accountEvaluations.ts's deriveCreatedBy and n8n.ts's
// withOperatorStamp(). A body containing one of these fields is rejected
// by .strict() as an unknown field, same as any other unrecognized field.
const CreateIcpProfileRequestSchema = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().nullable().optional(),
    config: RequiredUnknownSchema,
  })
  .strict();

const UpdateDraftRequestSchema = z
  .object({
    config: RequiredUnknownSchema,
    // Omitted entirely -> leave the stored notes untouched. Present
    // (including null) -> full replacement of notes.
    notes: z.string().nullable().optional(),
  })
  .strict();

const VersionIdRequestSchema = z
  .object({ versionId: z.string().uuid() })
  .strict();

// Publish acts on "the profile's current draft" implicitly — no body
// fields are accepted.
const EmptyRequestSchema = z.object({}).strict();

const ProfileIdParamsSchema = z
  .object({ profileId: z.string().uuid() })
  .strict();

function sendError(
  res: Response,
  status: number,
  code: string,
  message: string,
): void {
  res.status(status).json({ error: message, code });
}

// ---------------------------------------------------------------------
// LIMITATION (see slice report, and ../routes/accountEvaluations.ts's
// identical note): requireAuth guarantees req.operator is set, but its
// per-individual specificity depends on whether OPERATORS is configured.
//   - OPERATORS configured: req.operator.email uniquely, verifiably
//     identifies the signed-in person -> used as the actor identity.
//   - OPERATORS NOT configured (single shared APP_PASSWORD fallback), or
//     no req.operator at all (defensive only): null.
// ---------------------------------------------------------------------
function deriveCreatedBy(req: Request): string | null {
  const email = req.operator?.email?.trim();
  return email || null;
}

export interface IcpProfilesRouterDeps {
  db: NodePgDatabase<typeof schema>;
  createProfileFn?: typeof createProfile;
  listProfilesFn?: typeof listProfiles;
  getProfileFn?: typeof getProfile;
  updateDraftFn?: typeof updateDraft;
  cloneVersionIntoDraftFn?: typeof cloneVersionIntoDraft;
  publishDraftFn?: typeof publishDraft;
  activateVersionFn?: typeof activateVersion;
}

/**
 * Factory (not a bare router) so callers must supply a db instance
 * explicitly and tests can inject fake service implementations, running
 * these routes with no PostgreSQL connection at all. Production wiring
 * (routes/index.ts) passes the real @workspace/db singleton.
 */
export function createIcpProfilesRouter(deps: IcpProfilesRouterDeps): IRouter {
  const router: IRouter = Router();
  const {
    db,
    createProfileFn = createProfile,
    listProfilesFn = listProfiles,
    getProfileFn = getProfile,
    updateDraftFn = updateDraft,
    cloneVersionIntoDraftFn = cloneVersionIntoDraft,
    publishDraftFn = publishDraft,
    activateVersionFn = activateVersion,
  } = deps;

  // POST / — create a profile and its initial draft version atomically.
  router.post("/", async (req: Request, res: Response) => {
    const parsed = CreateIcpProfileRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      req.log?.info(
        { issues: parsed.error.issues },
        "POST /internal/icp-profiles: invalid request body",
      );
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const args: CreateProfileArgs = {
      db,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      config: parsed.data.config,
      createdBy: deriveCreatedBy(req),
    };

    try {
      const result = await createProfileFn(args);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof InvalidProfileConfigError) {
        sendError(res, 422, "invalid_profile_config", err.message);
        return;
      }
      req.log?.error({ err }, "POST /internal/icp-profiles failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET / — list profiles with lifecycle-summary version metadata.
  router.get("/", async (req: Request, res: Response) => {
    try {
      const result = await listProfilesFn(db);
      res.status(200).json(result);
    } catch (err) {
      req.log?.error({ err }, "GET /internal/icp-profiles failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // GET /:profileId — the profile and its ordered versions (exact stored config).
  router.get("/:profileId", async (req: Request, res: Response) => {
    const parsed = ProfileIdParamsSchema.safeParse(req.params);
    if (!parsed.success) {
      sendError(res, 400, "invalid_request", "profileId must be a valid UUID.");
      return;
    }

    try {
      const result = await getProfileFn(db, parsed.data.profileId);
      if (!result) {
        sendError(
          res,
          404,
          "profile_not_found",
          "No ICP profile exists with that ID.",
        );
        return;
      }
      res.status(200).json(result);
    } catch (err) {
      req.log?.error({ err }, "GET /internal/icp-profiles/:profileId failed");
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // PUT /:profileId/draft — replace the current draft's config (full replacement).
  router.put("/:profileId/draft", async (req: Request, res: Response) => {
    const paramsParsed = ProfileIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      sendError(res, 400, "invalid_request", "profileId must be a valid UUID.");
      return;
    }
    const bodyParsed = UpdateDraftRequestSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      req.log?.info(
        { issues: bodyParsed.error.issues },
        "PUT /internal/icp-profiles/:profileId/draft: invalid request body",
      );
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const args: UpdateDraftArgs = {
      db,
      profileId: paramsParsed.data.profileId,
      config: bodyParsed.data.config,
      notes: bodyParsed.data.notes,
    };

    try {
      const updated = await updateDraftFn(args);
      res.status(200).json(updated);
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        sendError(res, 404, "profile_not_found", err.message);
        return;
      }
      if (err instanceof NoDraftVersionError) {
        sendError(res, 409, "no_draft_version", err.message);
        return;
      }
      if (err instanceof InvalidProfileConfigError) {
        sendError(res, 422, "invalid_profile_config", err.message);
        return;
      }
      req.log?.error(
        { err },
        "PUT /internal/icp-profiles/:profileId/draft failed",
      );
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // POST /:profileId/clone — clone an existing version of the same profile into a new draft.
  router.post("/:profileId/clone", async (req: Request, res: Response) => {
    const paramsParsed = ProfileIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      sendError(res, 400, "invalid_request", "profileId must be a valid UUID.");
      return;
    }
    const bodyParsed = VersionIdRequestSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const args: CloneVersionArgs = {
      db,
      profileId: paramsParsed.data.profileId,
      sourceVersionId: bodyParsed.data.versionId,
      createdBy: deriveCreatedBy(req),
    };

    try {
      const cloned = await cloneVersionIntoDraftFn(args);
      res.status(201).json(cloned);
    } catch (err) {
      if (
        err instanceof ProfileNotFoundError ||
        err instanceof VersionNotFoundError
      ) {
        sendError(res, 404, errorCodeFor(err), err.message);
        return;
      }
      if (
        err instanceof DraftAlreadyExistsError ||
        err instanceof VersionBelongsToAnotherProfileError
      ) {
        sendError(res, 409, errorCodeFor(err), err.message);
        return;
      }
      req.log?.error(
        { err },
        "POST /internal/icp-profiles/:profileId/clone failed",
      );
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // POST /:profileId/publish — publish the current draft. Does not activate it.
  router.post("/:profileId/publish", async (req: Request, res: Response) => {
    const paramsParsed = ProfileIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      sendError(res, 400, "invalid_request", "profileId must be a valid UUID.");
      return;
    }
    const bodyParsed = EmptyRequestSchema.safeParse(req.body ?? {});
    if (!bodyParsed.success) {
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    try {
      const published = await publishDraftFn(db, paramsParsed.data.profileId);
      res.status(200).json(published);
    } catch (err) {
      if (err instanceof ProfileNotFoundError) {
        sendError(res, 404, "profile_not_found", err.message);
        return;
      }
      if (err instanceof NoDraftVersionError) {
        sendError(res, 409, "no_draft_version", err.message);
        return;
      }
      req.log?.error(
        { err },
        "POST /internal/icp-profiles/:profileId/publish failed",
      );
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  // POST /:profileId/activate — activate a published version belonging to this profile.
  router.post("/:profileId/activate", async (req: Request, res: Response) => {
    const paramsParsed = ProfileIdParamsSchema.safeParse(req.params);
    if (!paramsParsed.success) {
      sendError(res, 400, "invalid_request", "profileId must be a valid UUID.");
      return;
    }
    const bodyParsed = VersionIdRequestSchema.safeParse(req.body);
    if (!bodyParsed.success) {
      sendError(res, 400, "invalid_request", "The request body is invalid.");
      return;
    }

    const args: ActivateVersionArgs = {
      db,
      profileId: paramsParsed.data.profileId,
      versionId: bodyParsed.data.versionId,
      performedBy: deriveCreatedBy(req),
    };

    try {
      const result = await activateVersionFn(args);
      res.status(200).json(result);
    } catch (err) {
      if (
        err instanceof ProfileNotFoundError ||
        err instanceof VersionNotFoundError
      ) {
        sendError(res, 404, errorCodeFor(err), err.message);
        return;
      }
      if (
        err instanceof VersionBelongsToAnotherProfileError ||
        err instanceof VersionNotPublishedError
      ) {
        sendError(res, 409, errorCodeFor(err), err.message);
        return;
      }
      req.log?.error(
        { err },
        "POST /internal/icp-profiles/:profileId/activate failed",
      );
      sendError(res, 500, "internal_error", "An unexpected error occurred.");
    }
  });

  return router;
}

// Deterministic, stable machine-readable code per error class — keeps the
// per-route catch blocks above from hand-duplicating a code string next to
// every instanceof check.
function errorCodeFor(err: Error): string {
  switch (err.constructor) {
    case ProfileNotFoundError:
      return "profile_not_found";
    case VersionNotFoundError:
      return "version_not_found";
    case DraftAlreadyExistsError:
      return "draft_already_exists";
    case NoDraftVersionError:
      return "no_draft_version";
    case VersionBelongsToAnotherProfileError:
      return "version_belongs_to_another_profile";
    case VersionNotPublishedError:
      return "version_not_published";
    case InvalidProfileConfigError:
      return "invalid_profile_config";
    default:
      return "internal_error";
  }
}
